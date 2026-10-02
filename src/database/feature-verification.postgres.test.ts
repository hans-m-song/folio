import { createHash, randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { BankRepository } from "./bank-repository";
import { requiredMigrationIds } from "./migrations";
import { FolioRepository } from "./repository";
import { RecurringBillRepository } from "./recurring-bill-repository";
import { recurringBillScheduleInputSchema } from "../domain/recurring-bills";
import { transactionInputSchema } from "../domain/types";

const schema = "folio_t28_verify";
const databaseUrl =
  "postgres://folio_test:folio_test_postgres_password@127.0.0.1:55432/folio_test";
const table = (name: string) => `"${schema}"."${name}"`;

const usersTable = table("users");
const transactionsTable = table("transactions");
const schedulesTable = table("recurring_bill_schedules");
const linksTable = table("recurring_bill_links");
const bankTransactionsTable = table("bank_transactions");
const bankArtifactsTable = table("bank_transaction_artifacts");
const sourceArtifactsTable = table("source_artifacts");

let pool: Pool;
let actorId: string;
let ownerId: string;
let bankRepository: BankRepository;
let folioRepository: FolioRepository;
let recurringBillRepository: RecurringBillRepository;

const createdTransactionIds: string[] = [];
const createdScheduleIds: string[] = [];
const createdBankTransactionIds: string[] = [];
const createdArtifactIds: string[] = [];

const scheduleInput = (overrides: Record<string, unknown> = {}) =>
  recurringBillScheduleInputSchema.parse({
    label: "Synthetic hosting subscription",
    counterparty: "Example Cloud Services",
    descriptionMatchText: "hosting",
    documentCurrency: "AUD",
    expectedAmount: "25.0000",
    frequency: "monthly",
    anchorDate: "2026-09-15",
    daysEarly: 3,
    daysLate: 3,
    responsibleUserId: null,
    ...overrides,
  });

const repaymentInput = (overrides: Record<string, unknown> = {}) =>
  transactionInputSchema.parse({
    ownerId,
    kind: "owner_loan_repayment",
    status: "recorded",
    documentCurrency: "AUD",
    documentAmount: "100.0000",
    taxTreatment: "no_tax",
    settlementCurrency: "AUD",
    settlementAmount: "25.0000",
    settledAt: "2026-09-22T00:00:00.000Z",
    gstCreditStatus: "not_registered",
    ...overrides,
  });

const createExpense = async (invoiceDate: string) => {
  const transaction = await folioRepository.createManual(
    actorId,
    transactionInputSchema.parse({
      kind: "supplier_expense",
      status: "recorded",
      counterparty: "Example Cloud Services",
      description: "Synthetic hosting charge",
      invoiceDate,
      documentCurrency: "AUD",
      documentAmount: "25.0000",
      taxTreatment: "no_tax",
    }),
  );
  createdTransactionIds.push(transaction.id);
  return transaction;
};

const scheduleViewFor = async (scheduleId: string) => {
  const views = await recurringBillRepository.list(actorId, {
    timeZone: "Australia/Brisbane",
    asOfDate: "2026-10-03",
  });
  const view = views.find(({ schedule }) => schedule.id === scheduleId);
  if (!view) throw new Error(`Missing synthetic schedule ${scheduleId}`);
  return view;
};

const createBankArtifact = async () => {
  const id = randomUUID();
  const checksum = createHash("sha256").update(id).digest("base64");
  await pool.query(
    `INSERT INTO ${sourceArtifactsTable} (id, owner_id, created_by_id, artifact_profile, object_key, version_id, filename, media_type, byte_size, checksum_sha256, state, confirmed_at)
     VALUES ($1,$2,$2,'commbank_transaction_history_csv_v1',$3,$4,'synthetic-bank-history.csv','text/csv',1,$5,'available',now())`,
    [id, actorId, `tests/bill-t86/${id}`, `synthetic-version-${id}`, checksum],
  );
  createdArtifactIds.push(id);
  return id;
};

const queueIdPrefix = () => actorId.replaceAll("-", "").slice(0, 24);

const queueId = (sequence: number) => {
  const hexadecimal = `${queueIdPrefix()}${sequence.toString(16).padStart(8, "0")}`;
  return `${hexadecimal.slice(0, 8)}-${hexadecimal.slice(8, 12)}-${hexadecimal.slice(12, 16)}-${hexadecimal.slice(16, 20)}-${hexadecimal.slice(20)}`;
};

const insertBankRow = async (input: {
  postedDate: string;
  amountAud?: string;
  classification?: "private" | "transfer" | "duplicate" | null;
  id?: string;
  artifactId?: string;
}) => {
  const id = input.id ?? randomUUID();
  createdBankTransactionIds.push(id);
  await pool.query(
    `INSERT INTO ${bankTransactionsTable} (id, posted_date, amount_aud, description, classification, created_by_id, updated_by_id)
     VALUES ($1,$2::date,$3,'Synthetic reconciliation fixture',$4,$5,$5)`,
    [
      id,
      input.postedDate,
      input.amountAud ?? "-1.0000",
      input.classification ?? null,
      actorId,
    ],
  );
  if (input.artifactId) {
    await pool.query(
      `INSERT INTO ${bankArtifactsTable} (bank_transaction_id, source_artifact_id, metadata) VALUES ($1,$2,$3)`,
      [id, input.artifactId, { row: createdBankTransactionIds.length }],
    );
  }
  return id;
};

const insertRawRepayment = async (input: {
  ownerId: string | null;
  documentAmount: string;
  taxTreatment: string;
}) => {
  const id = randomUUID();
  createdTransactionIds.push(id);
  await pool.query(
    `INSERT INTO ${transactionsTable} (id, owner_id, created_by_id, updated_by_id, source_system, kind, status, document_currency, document_amount, tax_treatment, settlement_currency, settlement_amount, settled_at, gst_credit_status, claimable_gst_aud)
     VALUES ($1,$2,$3,$3,'manual','owner_loan_repayment','recorded','AUD',$4,$5,'AUD',25,'2026-09-22T00:00:00Z','not_registered',0)`,
    [id, input.ownerId, actorId, input.documentAmount, input.taxTreatment],
  );
};

describe("feature regressions against disposable PostgreSQL", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 8 });
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== "folio_test")
      throw new Error("PostgreSQL integration tests require folio_test");

    const migrations = await pool.query(
      `SELECT id FROM ${table("_migrations")} ORDER BY id`,
    );
    expect(migrations.rows.map((row) => row.id)).toEqual([
      ...requiredMigrationIds,
    ]);

    actorId = randomUUID();
    ownerId = randomUUID();
    await pool.query(
      `INSERT INTO ${usersTable} (id, email, role) VALUES ($1,$2,'administrator'),($3,$4,'member')`,
      [
        actorId,
        `synthetic-${actorId}@example.invalid`,
        ownerId,
        `synthetic-${ownerId}@example.invalid`,
      ],
    );
    bankRepository = new BankRepository(pool, schema);
    folioRepository = new FolioRepository(pool, schema, false);
    recurringBillRepository = new RecurringBillRepository(pool, schema);
  });

  afterEach(async () => {
    if (createdBankTransactionIds.length) {
      await pool.query(
        `DELETE FROM ${bankArtifactsTable} WHERE bank_transaction_id=ANY($1::uuid[])`,
        [createdBankTransactionIds],
      );
      await pool.query(
        `DELETE FROM ${bankTransactionsTable} WHERE id=ANY($1::uuid[])`,
        [createdBankTransactionIds],
      );
      createdBankTransactionIds.length = 0;
    }
    if (createdArtifactIds.length) {
      await pool.query(
        `DELETE FROM ${bankArtifactsTable} WHERE source_artifact_id=ANY($1::uuid[])`,
        [createdArtifactIds],
      );
      await pool.query(
        `DELETE FROM ${sourceArtifactsTable} WHERE id=ANY($1::uuid[])`,
        [createdArtifactIds],
      );
      createdArtifactIds.length = 0;
    }
    if (createdScheduleIds.length) {
      await pool.query(
        `DELETE FROM ${linksTable} WHERE schedule_id=ANY($1::uuid[])`,
        [createdScheduleIds],
      );
      await pool.query(
        `DELETE FROM ${schedulesTable} WHERE id=ANY($1::uuid[])`,
        [createdScheduleIds],
      );
      createdScheduleIds.length = 0;
    }
    if (createdTransactionIds.length) {
      await pool.query(
        `DELETE FROM ${linksTable} WHERE transaction_id=ANY($1::uuid[])`,
        [createdTransactionIds],
      );
      await pool.query(
        `DELETE FROM ${transactionsTable} WHERE id=ANY($1::uuid[])`,
        [createdTransactionIds],
      );
      createdTransactionIds.length = 0;
    }
  });

  afterAll(async () => {
    if (actorId && ownerId)
      await pool.query(`DELETE FROM ${usersTable} WHERE id=ANY($1::uuid[])`, [
        [actorId, ownerId],
      ]);
    await pool.end();
  });

  it("links and unlinks an occurrence and rejects a stale schedule revision", async () => {
    const schedule = await recurringBillRepository.save(actorId, {
      schedule: scheduleInput(),
    });
    createdScheduleIds.push(schedule.id);
    const transaction = await createExpense("2026-09-15");

    const link = await recurringBillRepository.linkOccurrence(actorId, {
      scheduleId: schedule.id,
      expectedDate: "2026-09-15",
      transactionId: transaction.id,
      expectedUpdatedAt: schedule.updatedAt,
      timeZone: "Australia/Brisbane",
    });
    expect(link).toMatchObject({
      scheduleId: schedule.id,
      expectedDate: "2026-09-15",
      transactionId: transaction.id,
      createdById: actorId,
    });

    const linkedOccurrence = (
      await scheduleViewFor(schedule.id)
    ).occurrences.find(({ expectedDate }) => expectedDate === "2026-09-15");
    expect(linkedOccurrence).toMatchObject({
      isComplete: true,
      transactionId: transaction.id,
      association: { transactionId: transaction.id, eligible: true },
    });
    await expect(
      recurringBillRepository.save(actorId, {
        id: schedule.id,
        expectedUpdatedAt: schedule.updatedAt,
        schedule: scheduleInput({ label: "Stale update" }),
      }),
    ).rejects.toMatchObject({
      diagnostic: { category: "database", code: "REVISION_CONFLICT" },
    });

    const currentSchedule = (await scheduleViewFor(schedule.id)).schedule;
    await recurringBillRepository.unlinkOccurrence(actorId, {
      scheduleId: schedule.id,
      expectedDate: "2026-09-15",
      expectedUpdatedAt: currentSchedule.updatedAt,
    });
    const persisted = await pool.query(
      `SELECT (SELECT count(*)::integer FROM ${linksTable} WHERE schedule_id=$1) AS link_count,
              (SELECT count(*)::integer FROM ${transactionsTable} WHERE id=$2) AS transaction_count`,
      [schedule.id, transaction.id],
    );
    expect(persisted.rows[0]).toEqual({ link_count: 0, transaction_count: 1 });
  });

  it.each([
    ["anchor date", { anchorDate: "2026-09-16" }],
    ["frequency", { frequency: "annual" }],
  ])(
    "clears occurrence links after a %s reset while preserving transactions",
    async (_label, change) => {
      const schedule = await recurringBillRepository.save(actorId, {
        schedule: scheduleInput(),
      });
      createdScheduleIds.push(schedule.id);
      const transaction = await createExpense("2026-09-15");
      await recurringBillRepository.linkOccurrence(actorId, {
        scheduleId: schedule.id,
        expectedDate: "2026-09-15",
        transactionId: transaction.id,
        expectedUpdatedAt: schedule.updatedAt,
        timeZone: "Australia/Brisbane",
      });

      const currentSchedule = (await scheduleViewFor(schedule.id)).schedule;
      const updated = await recurringBillRepository.save(actorId, {
        id: schedule.id,
        expectedUpdatedAt: currentSchedule.updatedAt,
        schedule: scheduleInput(change),
      });
      expect(updated).toMatchObject(change);
      const persisted = await pool.query(
        `SELECT (SELECT count(*)::integer FROM ${linksTable} WHERE schedule_id=$1) AS link_count,
              (SELECT count(*)::integer FROM ${transactionsTable} WHERE id=$2) AS transaction_count`,
        [schedule.id, transaction.id],
      );
      expect(persisted.rows[0]).toEqual({
        link_count: 0,
        transaction_count: 1,
      });
    },
  );

  it("persists valid owner repayments and enforces principal, owner, and no-tax checks", async () => {
    const repayment = await folioRepository.createManual(
      actorId,
      repaymentInput(),
    );
    createdTransactionIds.push(repayment.id);
    expect(repayment).toMatchObject({
      kind: "owner_loan_repayment",
      ownerId,
      documentAmount: "100.0000",
      taxTreatment: "no_tax",
    });

    await expect(
      insertRawRepayment({
        ownerId,
        documentAmount: "0.0000",
        taxTreatment: "no_tax",
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "transactions_owner_loan_repayment_amount_check",
    });
    await expect(
      insertRawRepayment({
        ownerId: null,
        documentAmount: "100.0000",
        taxTreatment: "no_tax",
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "transactions_owner_loan_repayment_owner_check",
    });
    await expect(
      insertRawRepayment({
        ownerId,
        documentAmount: "100.0000",
        taxTreatment: "gst_included",
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "transactions_owner_tax_check",
    });
  });

  it("matches an owner loan repayment to a negative AUD bank movement", async () => {
    const repayment = await folioRepository.createManual(
      actorId,
      repaymentInput(),
    );
    createdTransactionIds.push(repayment.id);
    const bankId = await insertBankRow({
      postedDate: "2026-09-22",
      amountAud: "-25.0000",
    });

    await expect(
      bankRepository.reconcile({
        actorId,
        bankTransactionId: bankId,
        expectedRevision: "1",
        command: { type: "match", transactionId: repayment.id },
      }),
    ).resolves.toMatchObject({ status: "applied", revision: "2" });

    const persisted = await pool.query(
      `SELECT amount_aud::text AS amount_aud, matched_transaction_id::text AS matched_transaction_id FROM ${bankTransactionsTable} WHERE id=$1`,
      [bankId],
    );
    expect(persisted.rows[0]).toEqual({
      amount_aud: "-25.0000",
      matched_transaction_id: repayment.id,
    });
  });

  it("advances by descending date and UUID order among tied dates", async () => {
    const artifactId = await createBankArtifact();
    const olderTie = queueId(9);
    const earlierTie = queueId(8);
    const anchor = queueId(10);

    await insertBankRow({
      id: queueId(5),
      postedDate: "2026-09-21",
      artifactId,
    });
    await insertBankRow({
      id: queueId(12),
      postedDate: "2026-09-20",
      artifactId,
    });
    await insertBankRow({
      id: queueId(11),
      postedDate: "2026-09-20",
      artifactId,
    });
    await insertBankRow({
      id: anchor,
      postedDate: "2026-09-20",
      classification: "private",
      artifactId,
    });
    await insertBankRow({ id: olderTie, postedDate: "2026-09-20", artifactId });
    await insertBankRow({
      id: earlierTie,
      postedDate: "2026-09-20",
      artifactId,
    });
    await insertBankRow({
      id: queueId(20),
      postedDate: "2026-09-19",
      artifactId,
    });

    await expect(
      bankRepository.nextReconciliationTarget(
        actorId,
        anchor,
        artifactId,
        true,
      ),
    ).resolves.toEqual({ status: "target", bankId: olderTie, page: 1 });
  });

  it("wraps to the newest unresolved row when no older row remains", async () => {
    const artifactId = await createBankArtifact();
    const anchor = queueId(10);
    const newestTie = queueId(9);

    await insertBankRow({
      id: anchor,
      postedDate: "2026-09-01",
      classification: "private",
      artifactId,
    });
    await insertBankRow({
      id: queueId(8),
      postedDate: "2026-09-04",
      artifactId,
    });
    await insertBankRow({
      id: newestTie,
      postedDate: "2026-09-04",
      artifactId,
    });
    await insertBankRow({
      id: queueId(99),
      postedDate: "2026-09-03",
      artifactId,
    });

    await expect(
      bankRepository.nextReconciliationTarget(
        actorId,
        anchor,
        artifactId,
        true,
      ),
    ).resolves.toEqual({ status: "target", bankId: newestTie, page: 1 });
  });

  it("returns the one-based page for the next queue target", async () => {
    const artifactId = await createBankArtifact();
    const anchor = queueId(50);
    const target = queueId(101);

    for (let sequence = 1; sequence <= 100; sequence += 1) {
      await insertBankRow({
        id: queueId(sequence),
        postedDate: "2026-08-02",
        classification: "private",
        artifactId,
      });
    }
    await insertBankRow({ id: target, postedDate: "2026-08-01", artifactId });

    await expect(
      bankRepository.nextReconciliationTarget(
        actorId,
        anchor,
        artifactId,
        false,
      ),
    ).resolves.toEqual({ status: "target", bankId: target, page: 2 });
  });
});
