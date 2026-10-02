import type { Pool, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";

import { recurringBillScheduleInputSchema } from "../domain/recurring-bills";
import { RecurringBillRepository } from "./recurring-bill-repository";

const actorId = "11111111-1111-4111-8111-111111111111";
const scheduleId = "22222222-2222-4222-8222-222222222222";
const transactionId = "33333333-3333-4333-8333-333333333333";
const responsibleUserId = "44444444-4444-4444-8444-444444444444";
const revision = "2026-01-01T00:00:00.123456Z";

const scheduleRow = (
  overrides: Record<string, unknown> = {},
): QueryResultRow => ({
  id: scheduleId,
  label: "Service Co",
  counterparty: "Service Co",
  description_match_text: "cloud subscription",
  document_currency: "USD",
  expected_amount: "10.0000",
  frequency: "monthly",
  anchor_date: "2026-01-31",
  responsible_user_id: null,
  active: true,
  created_by_id: actorId,
  updated_by_id: actorId,
  created_at_token: "2026-01-01T00:00:00.000000Z",
  updated_at_token: revision,
  ...overrides,
});

const transactionRow = (
  overrides: Record<string, unknown> = {},
): QueryResultRow => ({
  id: transactionId,
  kind: "supplier_expense",
  status: "recorded",
  counterparty: "Service Co",
  description: "Cloud subscription invoice",
  document_currency: "USD",
  document_amount: "10.0000",
  invoice_date: "2026-01-31",
  occurred_at: "2026-01-31T12:00:00.000000Z",
  settled_at: null,
  ...overrides,
});

const linkRow = (overrides: Record<string, unknown> = {}): QueryResultRow => ({
  schedule_id: scheduleId,
  expected_date: "2026-01-31",
  transaction_id: transactionId,
  created_by_id: actorId,
  created_at_token: "2026-01-31T12:00:00.000000Z",
  ...overrides,
});

const scheduleInput = (overrides: Record<string, unknown> = {}) =>
  recurringBillScheduleInputSchema.parse({
    label: "Service Co",
    counterparty: "Service Co",
    descriptionMatchText: "cloud subscription",
    documentCurrency: "USD",
    expectedAmount: "10.0000",
    frequency: "monthly",
    anchorDate: "2026-01-31",
    responsibleUserId: null,
    ...overrides,
  });

const makePool = (
  query: (
    statement: string,
    values?: unknown[],
  ) => Promise<{ rows: QueryResultRow[]; rowCount: number | null }>,
) => {
  const client = {
    query: vi.fn(query),
    release: vi.fn(),
  };
  const poolQuery = vi.fn(query);
  const pool = {
    query: poolQuery,
    connect: vi.fn(async () => client),
  } as unknown as Pool;
  return {
    pool,
    poolQuery,
    client,
    repository: new RecurringBillRepository(pool, "folio"),
  };
};

const result = (
  rows: QueryResultRow[] = [],
  rowCount: number | null = rows.length,
) => ({ rows, rowCount });

const activeActorRow = { id: actorId } as QueryResultRow;

describe("RecurringBillRepository authorization and options", () => {
  it("passes missing-history offsets to the view without changing transaction queries", async () => {
    const { repository } = makePool(async (statement) => {
      if (statement.includes('FROM "folio"."users"'))
        return result([activeActorRow]);
      if (statement.includes('FROM "folio"."recurring_bill_schedules"'))
        return result([scheduleRow()]);
      return result();
    });
    const [view] = await repository.list(actorId, {
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-03-31",
      unresolvedOffset: 1,
    });
    expect(view?.occurrences.map(({ expectedDate }) => expectedDate)).toEqual([
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
    expect(view).toMatchObject({ pendingCount: 1, dueCount: 2 });
  });

  it("requires an active actor before listing schedules", async () => {
    const { pool, repository } = makePool(async () => result());

    await expect(
      repository.list(actorId, {
        timeZone: "Australia/Brisbane",
        asOfDate: "2026-01-31",
      }),
    ).rejects.toMatchObject({
      diagnostic: { category: "actor", code: "ACTOR_NOT_FOUND" },
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("returns active responsible users without selecting emails", async () => {
    const { poolQuery, repository } = makePool(async (statement) => {
      if (statement.includes("WHERE id=$1 AND active=true"))
        return result([activeActorRow]);
      if (statement.includes("SELECT id, display_name"))
        return result([
          {
            id: responsibleUserId,
            display_name: "Operations",
          } as QueryResultRow,
          { id: transactionId, display_name: null } as QueryResultRow,
        ]);
      return result();
    });

    await expect(
      repository.listResponsibleUserOptions(actorId),
    ).resolves.toEqual([
      { id: responsibleUserId, label: "Operations" },
      { id: transactionId, label: transactionId },
    ]);
    const statements = poolQuery.mock.calls.map(([statement]) =>
      String(statement),
    );
    expect(statements.join(" ")).not.toContain("email");
    expect(statements.join(" ")).toContain("active=true");
  });
});

describe("RecurringBillRepository match preview", () => {
  it("includes pre-anchor history in both saved-view and preview estimates", async () => {
    const { repository } = makePool(async (statement) => {
      if (statement.includes('FROM "folio"."users"'))
        return result([activeActorRow]);
      if (statement.includes('FROM "folio"."recurring_bill_schedules"'))
        return result([scheduleRow({ anchor_date: "2026-08-31" })]);
      if (statement.includes('FROM "folio"."transactions"'))
        return result([transactionRow()]);
      return result();
    });
    const context = {
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-08-01",
    };
    const [view] = await repository.list(actorId, context);
    const preview = await repository.preview(actorId, {
      ...context,
      schedule: scheduleInput({ anchorDate: "2026-08-31" }),
    });
    const estimate = {
      count: 1,
      minimum: "10.0000",
      maximum: "10.0000",
      average: "10.0000",
    };
    expect(view?.amountEstimate).toEqual(estimate);
    expect(preview.amountEstimate).toEqual(estimate);
    expect(view).toMatchObject({ pendingCount: 0, dueCount: 0 });
  });

  it("uses the reporting-date cutoff for estimates without hiding future preview matches", async () => {
    const { repository } = makePool(async (statement) => {
      if (statement.includes('FROM "folio"."users"'))
        return result([activeActorRow]);
      if (statement.includes('FROM "folio"."transactions"'))
        return result([transactionRow()]);
      return result();
    });
    const preview = await repository.preview(actorId, {
      schedule: scheduleInput(),
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-01-30",
    });
    expect(preview.amountEstimate).toBeNull();
    expect(preview.rows[0]).toMatchObject({
      date: "2026-01-31",
      result: "aligned",
    });
  });

  it("parses the schedule before any read", async () => {
    const { poolQuery, repository } = makePool(async () => result());

    await expect(
      repository.preview(actorId, {
        schedule: { ...scheduleInput(), daysEarly: 366 } as never,
        timeZone: "Australia/Brisbane",
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("requires an active actor before selecting recorded supplier expenses", async () => {
    const { poolQuery, client, repository } = makePool(async () => result());

    await expect(
      repository.preview(actorId, {
        schedule: scheduleInput(),
        timeZone: "Australia/Brisbane",
      }),
    ).rejects.toMatchObject({
      diagnostic: { category: "actor", code: "ACTOR_NOT_FOUND" },
    });
    expect(poolQuery).toHaveBeenCalledTimes(1);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("previews only same-supplier and currency matches, including missing dates", async () => {
    const missingDate = transactionRow({
      id: "55555555-5555-4555-8555-555555555555",
      invoice_date: null,
      occurred_at: null,
      settled_at: null,
    });
    const unrelatedSupplier = transactionRow({
      id: "66666666-6666-4666-8666-666666666666",
      counterparty: "Other Co",
    });
    const unrelatedCurrency = transactionRow({
      id: "77777777-7777-4777-8777-777777777777",
      document_currency: "AUD",
    });
    const { pool, poolQuery, client, repository } = makePool(
      async (statement) => {
        if (statement.includes('FROM "folio"."users"'))
          return result([activeActorRow]);
        if (statement.includes('FROM "folio"."transactions"'))
          return result([
            transactionRow(),
            missingDate,
            unrelatedSupplier,
            unrelatedCurrency,
          ]);
        return result();
      },
    );

    const preview = await repository.preview(actorId, {
      schedule: scheduleInput(),
      timeZone: "Australia/Brisbane",
    });

    expect(preview).toMatchObject({
      descriptionMatchCount: 2,
      onCadenceCount: 1,
      misalignedCount: 1,
      ambiguousCount: 0,
    });
    expect(preview.rows).toEqual([
      expect.objectContaining({
        transactionId,
        date: "2026-01-31",
        descriptionMatches: true,
        result: "aligned",
      }),
      expect.objectContaining({
        transactionId: missingDate.id,
        date: null,
        descriptionMatches: true,
        result: "missing_date",
      }),
    ]);
    const transactionQuery = poolQuery.mock.calls.find(([statement]) =>
      String(statement).includes('FROM "folio"."transactions"'),
    );
    expect(String(transactionQuery?.[0])).toContain("kind='supplier_expense'");
    expect(String(transactionQuery?.[0])).toContain("status='recorded'");
    expect(String(transactionQuery?.[0])).not.toMatch(
      /invoice_date\s+IS\s+NOT\s+NULL|occurred_at\s+IS\s+NOT\s+NULL|settled_at\s+IS\s+NOT\s+NULL/i,
    );
    const statements = poolQuery.mock.calls.map(([statement]) =>
      String(statement),
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('FROM "folio"."users"');
    expect(statements[1]).toContain('FROM "folio"."transactions"');
    expect(statements.join(" ")).not.toMatch(
      /\b(BEGIN|COMMIT|ROLLBACK|INSERT|UPDATE|DELETE)\b/i,
    );
    expect(pool.connect).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe("RecurringBillRepository schedule writes", () => {
  it("rejects an inactive responsible user and rolls back", async () => {
    const { client, repository } = makePool(async (statement, values) => {
      if (
        statement ===
          'SELECT id FROM "folio"."users" WHERE id=$1 AND active=true FOR SHARE' &&
        values?.[0] === actorId
      )
        return result([activeActorRow]);
      if (statement.includes("active=true FOR SHARE")) return result();
      return result();
    });

    await expect(
      repository.save(actorId, {
        schedule: scheduleInput({ responsibleUserId }),
      }),
    ).rejects.toMatchObject({
      diagnostic: {
        category: "validation",
        code: "RECURRING_BILL_RESPONSIBLE_USER_INVALID",
      },
    });
    expect(client.query.mock.calls.map(([statement]) => statement)).toContain(
      "ROLLBACK",
    );
    expect(
      client.query.mock.calls.map(([statement]) => statement),
    ).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("preserves exact microsecond revision checks and rolls back stale edits", async () => {
    const { client, repository } = makePool(async (statement) => {
      if (statement.includes('FROM "folio"."users"'))
        return result([activeActorRow]);
      if (statement.includes('FROM "folio"."recurring_bill_schedules"'))
        return result([scheduleRow()]);
      return result();
    });

    await expect(
      repository.save(actorId, {
        id: scheduleId,
        expectedUpdatedAt: "2026-01-01T00:00:00.123Z",
        schedule: scheduleInput(),
      }),
    ).rejects.toMatchObject({
      diagnostic: { category: "database", code: "REVISION_CONFLICT" },
    });
    const statements = client.query.mock.calls.map(([statement]) =>
      String(statement),
    );
    expect(statements.some((statement) => statement.startsWith("UPDATE"))).toBe(
      false,
    );
    expect(statements).toContain("ROLLBACK");
  });

  it("creates schedules active only through the explicit save operation", async () => {
    const inserted = scheduleRow();
    const { client, repository } = makePool(async (statement) => {
      if (statement.includes('FROM "folio"."users"'))
        return result([activeActorRow]);
      if (
        statement.startsWith('INSERT INTO "folio"."recurring_bill_schedules"')
      )
        return result([inserted]);
      return result();
    });

    await expect(
      repository.save(actorId, { schedule: scheduleInput() }),
    ).resolves.toMatchObject({
      id: scheduleId,
      active: true,
      descriptionMatchMode: "contains",
      daysEarly: 3,
      daysLate: 3,
    });
    const insert = client.query.mock.calls.find(([statement]) =>
      String(statement).startsWith(
        'INSERT INTO "folio"."recurring_bill_schedules"',
      ),
    );
    expect(String(insert?.[0])).toContain("$8::date,$9,$10,$11,true,$12,$12");
    expect(insert?.[1]).toEqual([
      "Service Co",
      "Service Co",
      "cloud subscription",
      "contains",
      "USD",
      "10.0000",
      "monthly",
      "2026-01-31",
      3,
      3,
      null,
      actorId,
    ]);
    expect(client.query.mock.calls.map(([statement]) => statement)).toContain(
      "COMMIT",
    );
  });

  it("persists regex matching and configured grace windows", async () => {
    const inserted = scheduleRow({
      description_match_mode: "regex",
      days_early: 12,
      days_late: 21,
    });
    const { client, repository } = makePool(async (statement) => {
      if (statement.includes('FROM "folio"."users"'))
        return result([activeActorRow]);
      if (
        statement.startsWith('INSERT INTO "folio"."recurring_bill_schedules"')
      )
        return result([inserted]);
      return result();
    });

    await expect(
      repository.save(actorId, {
        schedule: scheduleInput({
          descriptionMatchMode: "regex",
          daysEarly: 12,
          daysLate: 21,
        }),
      }),
    ).resolves.toMatchObject({
      descriptionMatchMode: "regex",
      daysEarly: 12,
      daysLate: 21,
    });
    const insert = client.query.mock.calls.find(([statement]) =>
      String(statement).startsWith(
        'INSERT INTO "folio"."recurring_bill_schedules"',
      ),
    );
    expect(insert?.[1]).toEqual([
      "Service Co",
      "Service Co",
      "cloud subscription",
      "regex",
      "USD",
      "10.0000",
      "monthly",
      "2026-01-31",
      12,
      21,
      null,
      actorId,
    ]);
  });

  it("clears reminder links atomically when the calendar anchor changes", async () => {
    const updated = scheduleRow({ anchor_date: "2026-02-28" });
    const { client, repository } = makePool(async (statement) => {
      if (statement.includes('FROM "folio"."users"'))
        return result([activeActorRow]);
      if (statement.includes('FROM "folio"."recurring_bill_schedules"'))
        return result([scheduleRow()]);
      if (statement.startsWith('UPDATE "folio"."recurring_bill_schedules"'))
        return result([updated]);
      if (statement.startsWith('DELETE FROM "folio"."recurring_bill_links"'))
        return result([], 2);
      return result();
    });

    await expect(
      repository.save(actorId, {
        id: scheduleId,
        expectedUpdatedAt: revision,
        schedule: scheduleInput({ anchorDate: "2026-02-28" }),
      }),
    ).resolves.toMatchObject({ anchorDate: "2026-02-28" });
    const statements = client.query.mock.calls.map(([statement]) =>
      String(statement),
    );
    const updateIndex = statements.findIndex((statement) =>
      statement.startsWith('UPDATE "folio"."recurring_bill_schedules"'),
    );
    const deleteIndex = statements.findIndex((statement) =>
      statement.startsWith('DELETE FROM "folio"."recurring_bill_links"'),
    );
    expect(updateIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(updateIndex);
    expect(client.query.mock.calls[updateIndex]?.[1]).toContain(revision);
    expect(client.query.mock.calls[deleteIndex]?.[1]).toEqual([scheduleId]);
    expect(statements).toContain("COMMIT");
  });

  it("retains reminder links when edits leave cadence and anchor unchanged", async () => {
    const updated = scheduleRow();
    const { client, repository } = makePool(async (statement) => {
      if (statement.includes('FROM "folio"."users"'))
        return result([activeActorRow]);
      if (statement.includes('FROM "folio"."recurring_bill_schedules"'))
        return result([scheduleRow()]);
      if (statement.startsWith('UPDATE "folio"."recurring_bill_schedules"'))
        return result([updated]);
      return result();
    });

    await repository.save(actorId, {
      id: scheduleId,
      expectedUpdatedAt: revision,
      schedule: scheduleInput({ daysLate: 5 }),
    });

    expect(
      client.query.mock.calls.some(([statement]) =>
        String(statement).startsWith(
          'DELETE FROM "folio"."recurring_bill_links"',
        ),
      ),
    ).toBe(false);
    expect(client.query.mock.calls.map(([statement]) => statement)).toContain(
      "COMMIT",
    );
  });

  it("rolls back schedule and reminder history if cadence reset fails", async () => {
    const { client, repository } = makePool(async (statement) => {
      if (statement.includes('FROM "folio"."users"'))
        return result([activeActorRow]);
      if (statement.includes('FROM "folio"."recurring_bill_schedules"'))
        return result([scheduleRow()]);
      if (statement.startsWith('UPDATE "folio"."recurring_bill_schedules"'))
        return result([scheduleRow({ frequency: "annual" })]);
      if (statement.startsWith('DELETE FROM "folio"."recurring_bill_links"'))
        throw new Error("synthetic delete failure");
      return result();
    });

    await expect(
      repository.save(actorId, {
        id: scheduleId,
        expectedUpdatedAt: revision,
        schedule: scheduleInput({ frequency: "annual" }),
      }),
    ).rejects.toThrow("synthetic delete failure");
    const statements = client.query.mock.calls.map(([statement]) =>
      String(statement),
    );
    expect(statements.some((statement) => statement.startsWith("UPDATE"))).toBe(
      true,
    );
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });
});

describe("RecurringBillRepository occurrence associations", () => {
  it("locks and revalidates the schedule and transaction before linking", async () => {
    const { client, repository } = makePool(async (statement) => {
      if (statement.includes('FROM "folio"."users"'))
        return result([activeActorRow]);
      if (statement.includes('FROM "folio"."recurring_bill_schedules"'))
        return result([scheduleRow()]);
      if (statement.includes('FROM "folio"."transactions"'))
        return result([transactionRow()]);
      if (statement.startsWith('INSERT INTO "folio"."recurring_bill_links"'))
        return result([linkRow()]);
      if (statement.startsWith('UPDATE "folio"."recurring_bill_schedules"'))
        return result([], 1);
      return result();
    });

    await expect(
      repository.linkOccurrence(actorId, {
        scheduleId,
        expectedDate: "2026-01-31",
        transactionId,
        expectedUpdatedAt: revision,
        timeZone: "Australia/Brisbane",
      }),
    ).resolves.toMatchObject({ scheduleId, transactionId });

    const statements = client.query.mock.calls.map(([statement]) =>
      String(statement),
    );
    const scheduleLockIndex = statements.findIndex(
      (statement) =>
        statement.includes("recurring_bill_schedules") &&
        statement.includes("FOR UPDATE"),
    );
    const transactionLockIndex = statements.findIndex(
      (statement) =>
        statement.includes("transactions") && statement.includes("FOR UPDATE"),
    );
    const insertIndex = statements.findIndex((statement) =>
      statement.startsWith('INSERT INTO "folio"."recurring_bill_links"'),
    );
    expect(scheduleLockIndex).toBeLessThan(transactionLockIndex);
    expect(transactionLockIndex).toBeLessThan(insertIndex);
    expect(statements).toContain("COMMIT");
  });

  it("rejects an ineligible transaction and rolls the entire write back", async () => {
    const { client, repository } = makePool(async (statement) => {
      if (statement.includes('FROM "folio"."users"'))
        return result([activeActorRow]);
      if (statement.includes('FROM "folio"."recurring_bill_schedules"'))
        return result([scheduleRow()]);
      if (statement.includes('FROM "folio"."transactions"'))
        return result([transactionRow({ status: "draft" })]);
      return result();
    });

    await expect(
      repository.linkOccurrence(actorId, {
        scheduleId,
        expectedDate: "2026-01-31",
        transactionId,
        expectedUpdatedAt: revision,
        timeZone: "Australia/Brisbane",
      }),
    ).rejects.toMatchObject({
      diagnostic: {
        category: "validation",
        code: "RECURRING_BILL_LINK_INELIGIBLE",
      },
    });
    const statements = client.query.mock.calls.map(([statement]) =>
      String(statement),
    );
    expect(statements.some((statement) => statement.startsWith("INSERT"))).toBe(
      false,
    );
    expect(statements).toContain("ROLLBACK");
  });

  it("translates unique association violations and rolls back", async () => {
    const { client, repository } = makePool(async (statement) => {
      if (statement.includes('FROM "folio"."users"'))
        return result([activeActorRow]);
      if (statement.includes('FROM "folio"."recurring_bill_schedules"'))
        return result([scheduleRow()]);
      if (statement.includes('FROM "folio"."transactions"'))
        return result([transactionRow()]);
      if (statement.startsWith('INSERT INTO "folio"."recurring_bill_links"'))
        throw { code: "23505" };
      return result();
    });

    await expect(
      repository.linkOccurrence(actorId, {
        scheduleId,
        expectedDate: "2026-01-31",
        transactionId,
        expectedUpdatedAt: revision,
        timeZone: "Australia/Brisbane",
      }),
    ).rejects.toMatchObject({
      diagnostic: {
        category: "validation",
        code: "RECURRING_BILL_ASSOCIATION_CONFLICT",
      },
    });
    const statements = client.query.mock.calls.map(([statement]) =>
      String(statement),
    );
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });

  it("allows unlinking a stale occurrence association transactionally", async () => {
    const { client, repository } = makePool(async (statement) => {
      if (statement.includes('FROM "folio"."users"'))
        return result([activeActorRow]);
      if (statement.includes('FROM "folio"."recurring_bill_schedules"'))
        return result([scheduleRow({ anchor_date: "2026-02-28" })]);
      if (
        statement.startsWith(
          'SELECT schedule_id FROM "folio"."recurring_bill_links"',
        )
      )
        return result([{ schedule_id: scheduleId } as QueryResultRow]);
      if (statement.startsWith('DELETE FROM "folio"."recurring_bill_links"'))
        return result([], 1);
      if (statement.startsWith('UPDATE "folio"."recurring_bill_schedules"'))
        return result([], 1);
      return result();
    });

    await expect(
      repository.unlinkOccurrence(actorId, {
        scheduleId,
        expectedDate: "2026-01-31",
        expectedUpdatedAt: revision,
      }),
    ).resolves.toBeUndefined();
    const statements = client.query.mock.calls.map(([statement]) =>
      String(statement),
    );
    expect(statements.some((statement) => statement.startsWith("DELETE"))).toBe(
      true,
    );
    expect(statements).toContain("COMMIT");
  });
});
