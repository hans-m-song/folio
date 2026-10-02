import { createHash, randomUUID } from "node:crypto";

import { Pool } from "pg";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { BankRepository } from "./bank-repository";
import { requiredMigrationIds } from "./migrations";
import { FolioRepository } from "./repository";
import { transactionInputSchema } from "../domain/types";

const schema = "folio_t28_verify";
const databaseUrl =
  "postgres://folio_test:folio_test_postgres_password@127.0.0.1:55432/folio_test";
const table = (name: string) => `"${schema}"."${name}"`;

const bankTransactionsTable = table("bank_transactions");
const bankArtifactsTable = table("bank_transaction_artifacts");
const sourceArtifactsTable = table("source_artifacts");
const transactionArtifactsTable = table("transaction_artifacts");
const transactionsTable = table("transactions");
const usersTable = table("users");

let pool: Pool;
let actorId: string;
let bankRepository: BankRepository;
let folioRepository: FolioRepository;

const createdBankTransactionIds: string[] = [];
const createdTransactionIds: string[] = [];
const createdArtifactIds: string[] = [];

const insertArtifact = async (
  artifactProfile:
    | "commbank_transaction_history_csv_v1"
    | "stripe_balance_itemised_csv_v1"
    | "manual_invoice_pdf_v1",
) => {
  const id = randomUUID();
  const isPdf = artifactProfile === "manual_invoice_pdf_v1";
  const checksum = createHash("sha256").update(id).digest("base64");

  await pool.query(
    `INSERT INTO ${sourceArtifactsTable} (id, owner_id, created_by_id, artifact_profile, object_key, version_id, filename, media_type, byte_size, checksum_sha256, state, confirmed_at)
     VALUES ($1,$2,$2,$3,$4,$5,$6,$7,1,$8,'available',now())`,
    [
      id,
      actorId,
      artifactProfile,
      `tests/bill-t28/${id}`,
      `synthetic-version-${id}`,
      isPdf ? "synthetic-invoice.pdf" : "synthetic-bank-history.csv",
      isPdf ? "application/pdf" : "text/csv",
      checksum,
    ],
  );
  createdArtifactIds.push(id);
  return id;
};

const insertAwaitingBankArtifact = async () => {
  const id = randomUUID();
  const checksum = createHash("sha256").update(id).digest("base64");

  await pool.query(
    `INSERT INTO ${sourceArtifactsTable} (id, owner_id, created_by_id, artifact_profile, object_key, version_id, filename, media_type, byte_size, checksum_sha256, state, confirmed_at)
     VALUES ($1,$2,$2,'commbank_transaction_history_csv_v1',$3,$4,'synthetic-bank-history.csv','text/csv',1,$5,'awaiting_review',now())`,
    [id, actorId, `tests/bill-t41/${id}`, `synthetic-version-${id}`, checksum],
  );
  createdArtifactIds.push(id);
  return id;
};

const importedBankRow = (artifactId: string) => ({
  sourceRow: 2,
  postedDate: "2026-09-22",
  amountAud: "-15.2500",
  description: `Synthetic CommBank row ${artifactId}`,
  metadata: {
    sourceRow: 2,
    postedDate: "2026-09-22",
    amountAud: "-15.2500",
    description: `Synthetic CommBank row ${artifactId}`,
    runningBalance: "100.0000",
  },
});

const insertBankActivity = async (amountAud: string) => {
  const id = randomUUID();
  const artifactId = await insertArtifact(
    "commbank_transaction_history_csv_v1",
  );

  await pool.query(
    `INSERT INTO ${bankTransactionsTable} (id, posted_date, amount_aud, description, metadata, created_by_id, updated_by_id)
     VALUES ($1,'2026-09-22',$2,'Synthetic transfer to Example Supplier',$3,$4,$4)`,
    [
      id,
      amountAud,
      {
        sourceRow: 1,
        postedDate: "2026-09-22",
        amountAud,
        description: "Synthetic transfer to Example Supplier",
        runningBalance: "1000.0000",
      },
      actorId,
    ],
  );
  await pool.query(
    `INSERT INTO ${bankArtifactsTable} (bank_transaction_id, source_artifact_id, metadata)
     VALUES ($1,$2,$3)`,
    [id, artifactId, { row: 1 }],
  );
  createdBankTransactionIds.push(id);
  return id;
};

const manualInput = (input: {
  kind: "sale" | "supplier_expense" | "transfer";
  amount: string;
  currency?: string;
  status?: "draft" | "recorded";
}) =>
  transactionInputSchema.parse({
    ownerId: actorId,
    kind: input.kind,
    status: input.status ?? "recorded",
    settledAt: "2026-09-22T00:00:00.000Z",
    settlementCurrency: input.currency ?? "AUD",
    settlementAmount: input.amount,
    counterparty: "Example Supplier",
    description: "Synthetic transaction",
  });

const createManualTransaction = async (input: {
  kind: "sale" | "supplier_expense" | "transfer";
  amount: string;
  currency?: string;
  status?: "draft" | "recorded";
}) => {
  const transaction = await folioRepository.createManual(
    actorId,
    manualInput(input),
  );
  createdTransactionIds.push(transaction.id);
  return transaction;
};

const match = (
  bankTransactionId: string,
  transactionId: string,
  expectedRevision = "1",
) =>
  bankRepository.reconcile({
    actorId,
    bankTransactionId,
    expectedRevision,
    command: { type: "match", transactionId },
  });

const waitForLockWait = async (pid: number) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const activity = await pool.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
      [pid],
    );
    if (activity.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`PostgreSQL backend ${pid} did not wait on a lock`);
};

const insertStripeTransaction = async (client: PoolClient, id: string) => {
  await client.query(
    `INSERT INTO ${transactionsTable} (id, owner_id, created_by_id, updated_by_id, source_system, kind, reference, description, status, occurred_at, source_currency, source_gross, source_fee, source_net, metadata)
     VALUES ($1,$2,$2,$2,'stripe','sale',$3,'Synthetic source artifact race','recorded','2026-09-22T00:00:00Z','AUD',1,0,1,'{}')`,
    [id, actorId, `synthetic-artifact-race-${id}`],
  );
};

describe("bank reconciliation against disposable PostgreSQL", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 12 });
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
    await pool.query(
      `INSERT INTO ${usersTable} (id, email, role) VALUES ($1,$2,'administrator')`,
      [actorId, `synthetic-${actorId}@example.invalid`],
    );
    bankRepository = new BankRepository(pool, schema);
    folioRepository = new FolioRepository(pool, schema, false);
  });

  afterEach(async () => {
    await pool.query(
      `DROP TRIGGER IF EXISTS "test_t28_reject_match" ON ${bankTransactionsTable}`,
    );
    await pool.query(
      `DROP FUNCTION IF EXISTS ${table("test_t28_reject_match")}()`,
    );
    await pool.query(
      `DROP TRIGGER IF EXISTS "test_t41_reject_bank_artifact_link" ON ${bankArtifactsTable}`,
    );
    await pool.query(
      `DROP FUNCTION IF EXISTS ${table("test_t41_reject_bank_artifact_link")}()`,
    );

    if (createdBankTransactionIds.length) {
      await pool.query(
        `DELETE FROM ${bankTransactionsTable} WHERE id=ANY($1::uuid[])`,
        [createdBankTransactionIds],
      );
      createdBankTransactionIds.length = 0;
    }
    if (createdTransactionIds.length) {
      await pool.query(
        `DELETE FROM ${transactionArtifactsTable} WHERE transaction_id=ANY($1::uuid[])`,
        [createdTransactionIds],
      );
      await pool.query(
        `DELETE FROM ${transactionsTable} WHERE id=ANY($1::uuid[])`,
        [createdTransactionIds],
      );
      createdTransactionIds.length = 0;
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
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM ${usersTable} WHERE id=$1`, [actorId]);
    await pool.end();
  });

  it("publishes an awaiting-review CommBank artifact with its imported rows", async () => {
    const artifactId = await insertAwaitingBankArtifact();
    const row = importedBankRow(artifactId);

    const result = await bankRepository.confirmImport({
      actorId,
      artifactId,
      versionId: `synthetic-version-${artifactId}`,
      rows: [row],
      earliestDate: row.postedDate,
      latestDate: row.postedDate,
      acknowledgedOverlapFingerprint: null,
    });
    const links = await pool.query(
      `SELECT bank_transaction_id FROM ${bankArtifactsTable} WHERE source_artifact_id=$1`,
      [artifactId],
    );
    createdBankTransactionIds.push(
      ...links.rows.map((linkedRow) => String(linkedRow.bank_transaction_id)),
    );
    const imported = await pool.query(
      `SELECT state, version_id, confirmed_at,
         (SELECT count(*)::integer FROM ${bankArtifactsTable} WHERE source_artifact_id=$1) AS link_count
       FROM ${sourceArtifactsTable} WHERE id=$1`,
      [artifactId],
    );

    expect(result).toEqual({ status: "imported", artifactId, rowCount: 1 });
    expect(imported.rows[0]).toMatchObject({
      state: "available",
      version_id: `synthetic-version-${artifactId}`,
      link_count: 1,
      confirmed_at: expect.any(Date),
    });
    expect(links.rows).toHaveLength(1);
  });

  it("rolls back artifact confirmation and inserted rows when a bank link fails", async () => {
    const artifactId = await insertAwaitingBankArtifact();
    const row = importedBankRow(artifactId);

    await pool.query(`
      CREATE FUNCTION ${table("test_t41_reject_bank_artifact_link")}() RETURNS trigger LANGUAGE plpgsql AS $test_t41$
      BEGIN
        RAISE EXCEPTION 'Synthetic CommBank link failure';
      END;
      $test_t41$;
    `);
    await pool.query(
      `CREATE TRIGGER "test_t41_reject_bank_artifact_link" BEFORE INSERT ON ${bankArtifactsTable}
       FOR EACH ROW EXECUTE FUNCTION ${table("test_t41_reject_bank_artifact_link")}()`,
    );

    await expect(
      bankRepository.confirmImport({
        actorId,
        artifactId,
        versionId: `synthetic-version-${artifactId}`,
        rows: [row],
        earliestDate: row.postedDate,
        latestDate: row.postedDate,
        acknowledgedOverlapFingerprint: null,
      }),
    ).rejects.toThrow("Synthetic CommBank link failure");

    const persisted = await pool.query(
      `SELECT state, version_id, confirmed_at,
         (SELECT count(*)::integer FROM ${bankArtifactsTable} WHERE source_artifact_id=$1) AS link_count,
         (SELECT count(*)::integer FROM ${bankTransactionsTable} WHERE description=$2) AS bank_row_count
       FROM ${sourceArtifactsTable} WHERE id=$1`,
      [artifactId, row.description],
    );
    expect(persisted.rows[0]).toMatchObject({
      state: "awaiting_review",
      version_id: `synthetic-version-${artifactId}`,
      confirmed_at: expect.any(Date),
      link_count: 0,
      bank_row_count: 0,
    });
  });

  it("enforces signed AUD eligibility, one-to-one matching, and reset before reassignment", async () => {
    const outflow = await insertBankActivity("-27.0000");
    const inflow = await insertBankActivity("27.0000");
    const duplicateOutflow = await insertBankActivity("-27.0000");
    const expense = await createManualTransaction({
      kind: "supplier_expense",
      amount: "27.0000",
    });
    const sale = await createManualTransaction({
      kind: "sale",
      amount: "27.0000",
    });
    const alternateExpense = await createManualTransaction({
      kind: "supplier_expense",
      amount: "27.0000",
    });
    const wrongSign = await createManualTransaction({
      kind: "sale",
      amount: "27.0000",
    });
    const wrongAmount = await createManualTransaction({
      kind: "supplier_expense",
      amount: "27.0001",
    });
    const foreignSettlement = await createManualTransaction({
      kind: "supplier_expense",
      amount: "27.0000",
      currency: "USD",
    });
    const draft = await createManualTransaction({
      kind: "supplier_expense",
      amount: "27.0000",
      status: "draft",
    });

    await expect(
      pool.query(
        `UPDATE ${bankTransactionsTable} SET matched_transaction_id=$2 WHERE id=$1`,
        [outflow, wrongSign.id],
      ),
    ).rejects.toThrow("Transaction cash effect does not equal bank movement");
    await expect(match(outflow, wrongAmount.id)).rejects.toThrow(
      "Transaction is not an exact eligible AUD match",
    );
    await expect(match(outflow, foreignSettlement.id)).rejects.toThrow(
      "Transaction is not an exact eligible AUD match",
    );
    await expect(match(outflow, draft.id)).rejects.toThrow(
      "Transaction is not an exact eligible AUD match",
    );

    await expect(match(outflow, expense.id)).resolves.toMatchObject({
      status: "applied",
      revision: "2",
    });
    await expect(match(inflow, sale.id)).resolves.toMatchObject({
      status: "applied",
      revision: "2",
    });

    await expect(match(outflow, alternateExpense.id, "2")).rejects.toThrow(
      "Reset this bank transaction before applying a different resolution",
    );
    await expect(
      pool.query(
        `UPDATE ${bankTransactionsTable} SET matched_transaction_id=$2 WHERE id=$1`,
        [outflow, alternateExpense.id],
      ),
    ).rejects.toThrow(
      "Reset the bank transaction before assigning a different match",
    );
    await expect(
      pool.query(
        `UPDATE ${bankTransactionsTable} SET matched_transaction_id=$2 WHERE id=$1`,
        [duplicateOutflow, expense.id],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      bankRepository.reconcile({
        actorId,
        bankTransactionId: outflow,
        expectedRevision: "2",
        command: { type: "reset" },
      }),
    ).resolves.toMatchObject({ status: "applied", revision: "3" });
    await expect(
      match(outflow, alternateExpense.id, "3"),
    ).resolves.toMatchObject({
      status: "applied",
      revision: "4",
    });
  });

  it("revalidates matched financial identity while allowing safe edits", async () => {
    const bankTransactionId = await insertBankActivity("-41.0000");
    const input = manualInput({ kind: "supplier_expense", amount: "41.0000" });
    const transaction = await folioRepository.createManual(actorId, input);
    createdTransactionIds.push(transaction.id);
    await match(bankTransactionId, transaction.id);

    const unrelatedEdit = transactionInputSchema.parse({
      ...input,
      counterparty: "Edited Synthetic Supplier",
      description: "Updated synthetic description",
      reference: "SYNTHETIC-REF-41",
      category: "Software and subscriptions",
      notes: "Non-financial correction",
    });
    const updated = await folioRepository.updateManual(
      actorId,
      transaction.id,
      unrelatedEdit,
      transaction.updatedAt,
      "save_recorded",
    );
    expect(updated).toMatchObject({
      counterparty: "Edited Synthetic Supplier",
      description: "Updated synthetic description",
      reference: "SYNTHETIC-REF-41",
      category: "Software and subscriptions",
      notes: "Non-financial correction",
    });

    await pool.query(
      `UPDATE ${transactionsTable} SET kind='processing_fee' WHERE id=$1`,
      [transaction.id],
    );
    await pool.query(
      `UPDATE ${transactionsTable} SET settled_at='2026-09-23T00:00:00.000Z' WHERE id=$1`,
      [transaction.id],
    );
    const safelyEditedMatch = await pool.query(
      `SELECT transaction.kind,
         transaction.settled_at = '2026-09-23T00:00:00.000Z'::timestamptz AS settlement_date_changed,
         bank.matched_transaction_id::text AS match_id,
         bank.amount_aud::text AS bank_amount
       FROM ${transactionsTable} transaction
       JOIN ${bankTransactionsTable} bank ON bank.matched_transaction_id=transaction.id
       WHERE transaction.id=$1`,
      [transaction.id],
    );
    expect(safelyEditedMatch.rows[0]).toMatchObject({
      kind: "processing_fee",
      settlement_date_changed: true,
      match_id: transaction.id,
      bank_amount: "-41.0000",
    });

    const guardedUpdates: Array<[string, string | null]> = [
      ["source_system", "stripe"],
      ["status", "void"],
      ["kind", "sale"],
      ["kind", "transfer"],
      ["settled_at", null],
      ["settlement_currency", "USD"],
      ["settlement_amount", "42.0000"],
    ];
    for (const [column, value] of guardedUpdates) {
      await expect(
        pool.query(`UPDATE ${transactionsTable} SET ${column}=$1 WHERE id=$2`, [
          value,
          transaction.id,
        ]),
      ).rejects.toThrow(
        "Keep the recorded AUD amount and direction, or unmatch the bank transaction before this edit",
      );
    }
  });

  it("serializes concurrent matches of one bank row and one transaction", async () => {
    const sharedBank = await insertBankActivity("-53.0000");
    const first = await createManualTransaction({
      kind: "supplier_expense",
      amount: "53.0000",
    });
    const second = await createManualTransaction({
      kind: "supplier_expense",
      amount: "53.0000",
    });

    const sameBankRace = await Promise.allSettled([
      match(sharedBank, first.id),
      match(sharedBank, second.id),
    ]);
    expect(
      sameBankRace.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      sameBankRace.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const selected = await pool.query(
      `SELECT matched_transaction_id::text AS id, revision::text AS revision FROM ${bankTransactionsTable} WHERE id=$1`,
      [sharedBank],
    );
    expect([first.id, second.id]).toContain(selected.rows[0]?.id);
    expect(selected.rows[0]?.revision).toBe("2");

    const firstBank = await insertBankActivity("-59.0000");
    const secondBank = await insertBankActivity("-59.0000");
    const sharedTransaction = await createManualTransaction({
      kind: "supplier_expense",
      amount: "59.0000",
    });
    const sameTransactionRace = await Promise.allSettled([
      match(firstBank, sharedTransaction.id),
      match(secondBank, sharedTransaction.id),
    ]);
    expect(
      sameTransactionRace.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      sameTransactionRace.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const matchedCount = await pool.query(
      `SELECT count(*)::integer AS count FROM ${bankTransactionsTable} WHERE matched_transaction_id=$1`,
      [sharedTransaction.id],
    );
    expect(matchedCount.rows[0]?.count).toBe(1);
  });

  it("rolls back create-and-match failures and retries without duplicates", async () => {
    const bankTransactionId = await insertBankActivity("-67.0000");
    const invoiceId = await insertArtifact("manual_invoice_pdf_v1");
    const transactionId = randomUUID();
    const input = manualInput({ kind: "supplier_expense", amount: "67.0000" });
    const before = await pool.query(
      `SELECT posted_date::text, amount_aud::text, description, metadata FROM ${bankTransactionsTable} WHERE id=$1`,
      [bankTransactionId],
    );

    await pool.query(`
      CREATE FUNCTION ${table("test_t28_reject_match")}() RETURNS trigger
      LANGUAGE plpgsql AS $test$
      BEGIN
        IF NEW.id = '${bankTransactionId}'::uuid AND NEW.matched_transaction_id IS NOT NULL THEN
          RAISE EXCEPTION 'Synthetic failure after transaction insert';
        END IF;
        RETURN NEW;
      END
      $test$
    `);
    await pool.query(
      `CREATE TRIGGER "test_t28_reject_match" BEFORE UPDATE OF matched_transaction_id ON ${bankTransactionsTable} FOR EACH ROW EXECUTE FUNCTION ${table("test_t28_reject_match")}()`,
    );

    try {
      await expect(
        bankRepository.createAndMatch({
          actorId,
          bankTransactionId,
          expectedRevision: "1",
          transactionId,
          transaction: input,
          artifactIds: [invoiceId],
        }),
      ).rejects.toThrow("Synthetic failure after transaction insert");
    } finally {
      await pool.query(
        `DROP TRIGGER IF EXISTS "test_t28_reject_match" ON ${bankTransactionsTable}`,
      );
      await pool.query(
        `DROP FUNCTION IF EXISTS ${table("test_t28_reject_match")}()`,
      );
    }

    const rolledBack = await pool.query(
      `SELECT bank.matched_transaction_id::text AS match_id, bank.revision::text AS revision,
         (SELECT count(*)::integer FROM ${transactionsTable} WHERE id=$2) AS transaction_count,
         (SELECT count(*)::integer FROM ${transactionArtifactsTable} WHERE transaction_id=$2) AS artifact_link_count
       FROM ${bankTransactionsTable} bank WHERE bank.id=$1`,
      [bankTransactionId, transactionId],
    );
    expect(rolledBack.rows[0]).toMatchObject({
      match_id: null,
      revision: "1",
      transaction_count: 0,
      artifact_link_count: 0,
    });

    await expect(
      bankRepository.createAndMatch({
        actorId,
        bankTransactionId,
        expectedRevision: "1",
        transactionId,
        transaction: input,
        artifactIds: [invoiceId],
      }),
    ).resolves.toMatchObject({
      status: "applied",
      revision: "2",
      transactionId,
    });
    await expect(
      bankRepository.createAndMatch({
        actorId,
        bankTransactionId,
        expectedRevision: "1",
        transactionId,
        transaction: input,
        artifactIds: [invoiceId],
      }),
    ).resolves.toMatchObject({
      status: "already_applied",
      revision: "2",
      transactionId,
    });
    createdTransactionIds.push(transactionId);

    const persisted = await pool.query(
      `SELECT bank.matched_transaction_id::text AS match_id, bank.revision::text AS revision,
         bank.posted_date::text, bank.amount_aud::text, bank.description, bank.metadata,
         (SELECT count(*)::integer FROM ${transactionsTable} WHERE id=$2) AS transaction_count,
         (SELECT count(*)::integer FROM ${transactionArtifactsTable} WHERE transaction_id=$2) AS artifact_link_count
       FROM ${bankTransactionsTable} bank WHERE bank.id=$1`,
      [bankTransactionId, transactionId],
    );
    expect(persisted.rows[0]).toMatchObject({
      match_id: transactionId,
      revision: "2",
      transaction_count: 1,
      artifact_link_count: 1,
      posted_date: before.rows[0]?.posted_date,
      amount_aud: before.rows[0]?.amount_aud,
      description: before.rows[0]?.description,
      metadata: before.rows[0]?.metadata,
    });

    const activity = await bankRepository.listTransactions(actorId, {
      limit: 50,
      offset: 0,
    });
    expect(
      activity.find((row) => row.id === bankTransactionId)?.postedDate,
    ).toBe("2026-09-22");
    const detail = await bankRepository.reconciliationDetail(
      actorId,
      bankTransactionId,
      null,
    );
    expect(detail?.bankTransaction.postedDate).toBe("2026-09-22");
  });

  it("keeps create-and-match and invoice supersession mutually safe under a race", async () => {
    const bankTransactionId = await insertBankActivity("-71.0000");
    const invoiceId = await insertArtifact("manual_invoice_pdf_v1");
    const replacementId = await insertArtifact("manual_invoice_pdf_v1");
    const transactionId = randomUUID();
    const input = manualInput({ kind: "supplier_expense", amount: "71.0000" });

    const [createResult, supersedeResult] = await Promise.allSettled([
      bankRepository.createAndMatch({
        actorId,
        bankTransactionId,
        expectedRevision: "1",
        transactionId,
        transaction: input,
        artifactIds: [invoiceId],
      }),
      folioRepository.supersede(invoiceId, replacementId),
    ]);

    const state = await pool.query(
      `SELECT artifact.state,
         bank.matched_transaction_id::text AS match_id,
         (SELECT count(*)::integer FROM ${transactionsTable} WHERE id=$2) AS transaction_count,
         (SELECT count(*)::integer FROM ${transactionArtifactsTable} WHERE transaction_id=$2 AND source_artifact_id=$1) AS artifact_link_count
       FROM ${sourceArtifactsTable} artifact
       JOIN ${bankTransactionsTable} bank ON bank.id=$3
       WHERE artifact.id=$1`,
      [invoiceId, transactionId, bankTransactionId],
    );
    const linked = createResult.status === "fulfilled";

    expect(linked).not.toBe(supersedeResult.status === "fulfilled");
    if (linked) {
      expect(state.rows[0]).toMatchObject({
        state: "available",
        match_id: transactionId,
        transaction_count: 1,
        artifact_link_count: 1,
      });
    } else {
      expect(state.rows[0]).toMatchObject({
        state: "superseded",
        match_id: null,
        transaction_count: 0,
        artifact_link_count: 0,
      });
    }
    createdTransactionIds.push(transactionId);
  });

  it("does not allow either evidence link table to link a rejected artifact after waiting", async () => {
    const cases = [
      {
        artifactProfile: "stripe_balance_itemised_csv_v1" as const,
        linkTable: transactionArtifactsTable,
        linkOwnerTable: "transaction" as const,
      },
      {
        artifactProfile: "commbank_transaction_history_csv_v1" as const,
        linkTable: bankArtifactsTable,
        linkOwnerTable: "bank" as const,
      },
    ];

    for (const testCase of cases) {
      const artifactId = await insertArtifact(testCase.artifactProfile);
      const ownerId = randomUUID();
      const rejectionClient = await pool.connect();
      const linkClient = await pool.connect();
      let rejectionTransactionOpen = false;
      let linkTransactionOpen = false;
      let linkAttempt: Promise<{ error?: unknown }> | undefined;

      try {
        await rejectionClient.query("BEGIN");
        rejectionTransactionOpen = true;
        await rejectionClient.query(
          `UPDATE ${sourceArtifactsTable} SET state='rejected' WHERE id=$1`,
          [artifactId],
        );

        await linkClient.query("BEGIN");
        linkTransactionOpen = true;
        if (testCase.linkOwnerTable === "transaction") {
          await insertStripeTransaction(linkClient, ownerId);
        } else {
          await linkClient.query(
            `INSERT INTO ${bankTransactionsTable} (id, posted_date, amount_aud, description, created_by_id, updated_by_id)
               VALUES ($1,'2026-09-22',1,'Synthetic artifact race',$2,$2)`,
            [ownerId, actorId],
          );
        }

        const pid = Number(
          (await linkClient.query("SELECT pg_backend_pid() AS pid")).rows[0]
            ?.pid,
        );
        linkAttempt = linkClient
          .query(
            `INSERT INTO ${testCase.linkTable} (${testCase.linkOwnerTable === "transaction" ? "transaction_id" : "bank_transaction_id"}, source_artifact_id)
               VALUES ($1,$2)`,
            [ownerId, artifactId],
          )
          .then(
            () => ({}),
            (error: unknown) => ({ error }),
          );
        await waitForLockWait(pid);

        await rejectionClient.query("COMMIT");
        rejectionTransactionOpen = false;
        const linkResult = await linkAttempt;
        expect(linkResult.error).toMatchObject({
          message: "Artifact links must reference an available artifact",
        });
        await linkClient.query("ROLLBACK");
        linkTransactionOpen = false;

        const persisted = await pool.query(
          `SELECT state,
               (SELECT count(*)::integer FROM ${testCase.linkTable} WHERE source_artifact_id=$1) AS link_count
             FROM ${sourceArtifactsTable} WHERE id=$1`,
          [artifactId],
        );
        expect(persisted.rows[0]).toMatchObject({
          state: "rejected",
          link_count: 0,
        });
      } finally {
        if (rejectionTransactionOpen) await rejectionClient.query("ROLLBACK");
        if (linkAttempt) await Promise.allSettled([linkAttempt]);
        if (linkTransactionOpen) await linkClient.query("ROLLBACK");
        rejectionClient.release();
        linkClient.release();
      }
    }
  }, 15000);
});
