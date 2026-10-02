import { describe, expect, it, vi } from "vitest";

import type { BulkTransactionRequest } from "../domain/bulk-transactions";
import { FolioRepository } from "./repository";

const actorId = "d1111111-1111-4111-8111-111111111111";
const ownerId = "c2222222-2222-4222-8222-222222222222";
const transactionIdA = "a3333333-3333-4333-8333-333333333333";
const transactionIdB = "b4444444-4444-4444-8444-444444444444";
const revision = "2026-10-01T00:00:00.123456Z";

type TestTransaction = {
  id: string;
  owner_id: string | null;
  counterparty: string | null;
  category: string | null;
  reference: string | null;
  description: string | null;
  kind: "supplier_expense";
  status: "draft" | "recorded" | "void";
  source_system: "manual" | "stripe";
  updated_at_token: string;
};

const transaction = (
  overrides: Partial<TestTransaction> = {},
): TestTransaction => ({
  id: transactionIdA,
  owner_id: ownerId,
  counterparty: "Synthetic vendor",
  category: "Office supplies",
  reference: "synthetic-reference",
  description: "Synthetic description",
  kind: "supplier_expense",
  status: "draft",
  source_system: "manual",
  updated_at_token: revision,
  ...overrides,
});

const result = (rows: unknown[] = []) => ({ rows, rowCount: rows.length });

const createRepository = (responses: unknown[] = []) => {
  const query = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) query.mockRejectedValueOnce(response);
    else query.mockResolvedValueOnce(response);
  }
  const client = { query, release: vi.fn() };
  const pool = { query, connect: vi.fn().mockResolvedValue(client) };
  return {
    repository: new FolioRepository(pool as never, "folio", false),
    query,
    client,
    pool,
  };
};

const requestFor = (
  rows: TestTransaction[],
  change: BulkTransactionRequest["change"],
): BulkTransactionRequest => ({
  transactions: rows.map(({ id, updated_at_token }) => ({
    id,
    updatedAt: updated_at_token,
  })),
  change,
});

describe("Folio bulk transaction repository", () => {
  it("previews selected rows in selection order without opening a write transaction", async () => {
    const first = transaction({ id: transactionIdA });
    const second = transaction({
      id: transactionIdB,
      source_system: "stripe",
      counterparty: "Stripe",
      category: "Processing fees",
    });
    const { repository, query, pool } = createRepository([
      result([{ id: actorId }]),
      result([first, second]),
    ]);

    const preview = await repository.previewBulkTransactionEdit(
      actorId,
      requestFor([second, first], {
        field: "category",
        value: "Office supplies",
      }),
    );

    expect(preview).toMatchObject({
      changedCount: 1,
      rows: [
        { id: transactionIdB, beforeValue: "Processing fees", changed: true },
        { id: transactionIdA, beforeValue: "Office supplies", changed: false },
      ],
    });
    expect(pool.connect).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toContain("updated_at_token");
    expect(query.mock.calls[1]?.[0]).not.toContain("FOR UPDATE");
  });

  it("locks in id order and applies one metadata-only update to manual and Stripe rows", async () => {
    const manual = transaction({ id: transactionIdA, status: "recorded" });
    const stripe = transaction({
      id: transactionIdB,
      source_system: "stripe",
      status: "recorded",
      counterparty: "Stripe",
    });
    const { repository, query } = createRepository([
      {},
      result([{ id: actorId }]),
      result([stripe, manual]),
      { rows: [], rowCount: 2 },
      {},
    ]);

    await expect(
      repository.applyBulkTransactionEdit(
        actorId,
        requestFor([stripe, manual], {
          field: "counterparty",
          value: "Reviewed vendor",
        }),
      ),
    ).resolves.toEqual({ selectedCount: 2, updatedCount: 2 });

    expect(query.mock.calls[2]?.[0]).toContain("ORDER BY id FOR UPDATE");
    expect(query.mock.calls[2]?.[1]).toEqual([
      [transactionIdB, transactionIdA],
    ]);
    const updateSql = String(query.mock.calls[3]?.[0]);
    expect(updateSql).toContain(
      "SET counterparty=$2::text, updated_by_id=$3::uuid",
    );
    expect(updateSql).toContain(
      "GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')",
    );
    expect(updateSql).not.toMatch(
      /bank_transactions|transaction_artifacts|source_system|status|kind|settlement_|document_|metadata/i,
    );
    expect(query.mock.calls[3]?.[1]).toEqual([
      [transactionIdB, transactionIdA],
      "Reviewed vendor",
      actorId,
    ]);
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("preserves revisions and updated_by_id for a no-op edit", async () => {
    const row = transaction({ category: "Office supplies" });
    const { repository, query } = createRepository([
      {},
      result([{ id: actorId }]),
      result([row]),
      {},
    ]);

    await expect(
      repository.applyBulkTransactionEdit(
        actorId,
        requestFor([row], {
          field: "category",
          value: "Office supplies",
        }),
      ),
    ).resolves.toEqual({ selectedCount: 1, updatedCount: 0 });

    expect(
      query.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE")),
    ).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("validates every exact microsecond token before writing any selected row", async () => {
    const current = transaction({ id: transactionIdA });
    const stale = transaction({
      id: transactionIdB,
      updated_at_token: "2026-10-01T00:00:00.123457Z",
    });
    const { repository, query } = createRepository([
      {},
      result([{ id: actorId }]),
      result([current, stale]),
      {},
    ]);

    await expect(
      repository.applyBulkTransactionEdit(
        actorId,
        requestFor([current, transaction({ id: transactionIdB })], {
          field: "category",
          value: "Travel",
        }),
      ),
    ).rejects.toMatchObject({
      diagnostic: {
        code: "BULK_TRANSACTION_CONFLICT",
        httpStatus: 409,
        retryable: false,
      },
    });

    expect(
      query.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE")),
    ).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it.each([
    {
      name: "missing",
      rows: [transaction({ id: transactionIdA })],
      selected: [
        transaction({ id: transactionIdA }),
        transaction({ id: transactionIdB }),
      ],
    },
    {
      name: "void",
      rows: [
        transaction({ id: transactionIdA }),
        transaction({ id: transactionIdB, status: "void" }),
      ],
      selected: [
        transaction({ id: transactionIdA }),
        transaction({ id: transactionIdB, status: "void" }),
      ],
    },
  ])(
    "rejects the whole $name batch before any write",
    async ({ rows, selected }) => {
      const { repository, query } = createRepository([
        {},
        result([{ id: actorId }]),
        result(rows),
        {},
      ]);

      await expect(
        repository.applyBulkTransactionEdit(
          actorId,
          requestFor(selected, { field: "category", value: "Travel" }),
        ),
      ).rejects.toMatchObject({
        diagnostic: {
          code: "BULK_TRANSACTION_INELIGIBLE",
          httpStatus: 422,
          retryable: false,
        },
      });

      expect(
        query.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE")),
      ).toBe(false);
      expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    },
  );

  it("holds a share lock while validating the target owner", async () => {
    const row = transaction();
    const { repository, query } = createRepository([
      {},
      result([{ id: actorId }]),
      result([row]),
      result([]),
      {},
    ]);

    await expect(
      repository.applyBulkTransactionEdit(
        actorId,
        requestFor([row], { field: "ownerId", value: ownerId }),
      ),
    ).rejects.toMatchObject({
      diagnostic: {
        code: "BULK_OWNER_INACTIVE",
        httpStatus: 422,
        retryable: false,
      },
    });

    expect(query.mock.calls[3]?.[0]).toContain("active = true FOR SHARE");
    expect(
      query.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE")),
    ).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("allows an active member actor to apply metadata changes", async () => {
    const row = transaction();
    const { repository, query } = createRepository([
      {},
      result([{ id: actorId }]),
      result([row]),
      { rows: [], rowCount: 1 },
      {},
    ]);

    await expect(
      repository.applyBulkTransactionEdit(
        actorId,
        requestFor([row], { field: "category", value: "Travel" }),
      ),
    ).resolves.toEqual({ selectedCount: 1, updatedCount: 1 });

    expect(query.mock.calls[1]?.[0]).toContain("SELECT id FROM");
    expect(query.mock.calls[1]?.[0]).not.toContain("email");
    expect(query.mock.calls[1]?.[0]).not.toContain("display_name");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("rolls back a batch when a deferred database constraint rejects commit", async () => {
    const row = transaction();
    const commitError = new Error("deferred evidence constraint failed");
    const { repository, query, client } = createRepository([
      {},
      result([{ id: actorId }]),
      result([row]),
      { rows: [], rowCount: 1 },
      commitError,
      {},
    ]);

    await expect(
      repository.applyBulkTransactionEdit(
        actorId,
        requestFor([row], { field: "category", value: "Travel" }),
      ),
    ).rejects.toBe(commitError);

    expect(query.mock.calls.at(-2)?.[0]).toBe("COMMIT");
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("reparses requests at the repository boundary", async () => {
    const { repository, query, pool } = createRepository();
    const invalidRequest = {
      transactions: [
        { id: transactionIdA, updatedAt: revision },
        { id: transactionIdA.toUpperCase(), updatedAt: revision },
      ],
      change: { field: "category", value: "Travel" },
    };

    await expect(
      repository.previewBulkTransactionEdit(actorId, invalidRequest as never),
    ).rejects.toBeInstanceOf(Error);

    expect(query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
