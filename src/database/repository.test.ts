import { describe, expect, it, vi } from "vitest";
import { types as pgTypes } from "pg";

import { FolioDiagnosticError } from "../domain/diagnostics";
import type { StripeImportRow } from "../domain/stripe-csv";
import { transactionInputSchema } from "../domain/types";
import { FolioRepository } from "./repository";

describe("Folio repository health", () => {
  it("requires all tables and the reviewed migration ledger entry", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            users: "folio.users",
            transactions: "folio.transactions",
            source_artifacts: "folio.source_artifacts",
            transaction_artifacts: "folio.transaction_artifacts",
            migrations: "folio._migrations",
            auth_attempts: "folio.auth_attempts",
            auth_sessions: "folio.auth_sessions",
            bank_transactions: "folio.bank_transactions",
            bank_transaction_artifacts: "folio.bank_transaction_artifacts",
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 9 });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(repository.health()).resolves.toBeUndefined();
    expect(query).toHaveBeenLastCalledWith(
      'SELECT id FROM "folio"."_migrations" WHERE id = ANY($1::text[])',
      [
        [
          "0001_folio_m1",
          "0002_folio_m1_hardening",
          "0003_folio_manual_entry_refinements",
          "0004_folio_oidc_sessions",
          "0005_folio_artifact_profiles",
          "0006_folio_bank_activity",
          "0007_folio_bank_reconciliation",
          "0008_folio_rejected_artifacts",
          "0009_folio_unlinked_artifact_deletion",
        ],
      ],
    );
  });

  it("fails health when a required table or migration is missing", async () => {
    const missingTable = new FolioRepository(
      {
        query: vi.fn().mockResolvedValue({
          rows: [
            {
              users: "folio.users",
              transactions: null,
              source_artifacts: "folio.source_artifacts",
              transaction_artifacts: "folio.transaction_artifacts",
              migrations: "folio._migrations",
              auth_attempts: "folio.auth_attempts",
              auth_sessions: "folio.auth_sessions",
              bank_transactions: "folio.bank_transactions",
              bank_transaction_artifacts: null,
            },
          ],
        }),
      } as never,
      "folio",
      false,
    );
    await expect(missingTable.health()).rejects.toThrow("schema is incomplete");

    const missingMigration = new FolioRepository(
      {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                users: "folio.users",
                transactions: "folio.transactions",
                source_artifacts: "folio.source_artifacts",
                transaction_artifacts: "folio.transaction_artifacts",
                migrations: "folio._migrations",
                auth_attempts: "folio.auth_attempts",
                auth_sessions: "folio.auth_sessions",
                bank_transactions: "folio.bank_transactions",
                bank_transaction_artifacts: "folio.bank_transaction_artifacts",
              },
            ],
          })
          .mockResolvedValueOnce({ rowCount: 1 }),
      } as never,
      "folio",
      false,
    );
    await expect(missingMigration.health()).rejects.toThrow(
      "migrations are not applied",
    );
  });
});

describe("Folio pending artifact recovery", () => {
  it("abandons only an artifact that is still pending", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    await expect(
      new FolioRepository(
        { query } as never,
        "folio",
        false,
      ).abandonPendingArtifact("11111111-1111-4111-8111-111111111111"),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/SET state='abandoned'.*state='pending'/),
      ["11111111-1111-4111-8111-111111111111"],
    );
  });
});

describe("Folio artifact library", () => {
  it("pages source artifacts independently of transaction rows", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            filename: "statement.csv",
            artifact_profile: "commbank_transaction_history_csv_v1",
            media_type: "text/csv",
            state: "available",
            byte_size: "182",
            created_at: new Date("2026-09-01T00:00:00Z"),
            transaction_count: 0,
            bank_row_count: 3,
          },
        ],
      });
    const repository = new FolioRepository({ query } as never, "folio", false);

    const result = await repository.listArtifacts("actor", {
      search: "statement",
      profile: "commbank_transaction_history_csv_v1",
      state: "available",
      from: "2026-09-01",
      to: "2026-09-30",
      linkage: "linked",
      limit: 25,
      offset: 0,
    });

    expect(result).toEqual({
      total: 1,
      rows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          filename: "statement.csv",
          artifactProfile: "commbank_transaction_history_csv_v1",
          mediaType: "text/csv",
          state: "available",
          byteSize: "182",
          createdAt: "2026-09-01T00:00:00.000Z",
          transactionCount: 0,
          bankRowCount: 3,
        },
      ],
    });
    expect(query.mock.calls[1]?.[0]).toContain(
      'FROM "folio"."source_artifacts" artifact',
    );
    expect(query.mock.calls[2]?.[0]).toContain(
      'FROM "folio"."source_artifacts" artifact',
    );
    expect(query.mock.calls[2]?.[0]).toContain("LIMIT $7 OFFSET $8");
    expect(query.mock.calls[2]?.[1]).toEqual([
      "statement",
      "commbank_transaction_history_csv_v1",
      "available",
      "linked",
      "2026-09-01",
      "2026-09-30",
      25,
      0,
    ]);
  });

  it("counts case-insensitive original filename matches within the profile", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({
        rows: [
          { filename: "Export.csv", match_count: 2 },
          { filename: "report.csv", match_count: 0 },
        ],
      });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(
      repository.findArtifactFilenameMatches(
        "actor",
        "stripe_balance_itemised_csv_v1",
        ["Export.csv", "report.csv"],
      ),
    ).resolves.toEqual([2, 0]);

    expect(query.mock.calls[1]?.[0]).toContain("artifact.artifact_profile=$1");
    expect(query.mock.calls[1]?.[0]).toContain(
      "lower(coalesce(nullif(artifact.original_filename, ''), artifact.filename))=lower(requested.filename)",
    );
    expect(query.mock.calls[1]?.[1]).toEqual([
      "stripe_balance_itemised_csv_v1",
      ["Export.csv", "report.csv"],
    ]);
  });
});

describe("Folio transaction projections", () => {
  it("preserves a PostgreSQL DATE as a calendar string for transaction details", async () => {
    const pgDate = pgTypes.getTypeParser(pgTypes.builtins.DATE)("2026-01-01");
    expect(pgDate).toBeInstanceOf(Date);

    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({
        rows: [
          {
            ...transactionRow,
            invoice_date: pgDate,
            invoice_date_text: "2026-01-01",
          },
        ],
      });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(
      repository.getTransaction("actor", transactionRow.id),
    ).resolves.toMatchObject({
      invoiceDate: "2026-01-01",
    });
    expect(query.mock.calls[1]?.[0]).toContain(
      "transactions.invoice_date::text AS invoice_date_text",
    );
  });

  it("returns an exact linked-evidence gap count and bounded recent snapshots", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({
        rows: [
          {
            linked_evidence_gaps: 4,
            pending_import_uploads: 2,
            abandoned_import_uploads: 3,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: transactionRow.id,
            kind: "supplier_expense",
            status: "draft",
            source_system: "manual",
            updated_at_token: "2026-01-01T00:00:00.123456Z",
          },
        ],
      });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(
      repository.transactionOverviewSummary("actor"),
    ).resolves.toEqual({
      transactionLinkedEvidenceGaps: 4,
      pendingImportUploads: 2,
      abandonedImportUploads: 3,
      recentTransactions: [
        {
          id: transactionRow.id,
          kind: "supplier_expense",
          status: "draft",
          sourceSystem: "manual",
          updatedAt: "2026-01-01T00:00:00.123456Z",
        },
      ],
    });
    expect(query.mock.calls[1]?.[0]).toContain(
      'NOT EXISTS (SELECT 1 FROM "folio"."transaction_artifacts"',
    );
    expect(query.mock.calls[1]?.[0]).toMatch(
      /artifact_profile IN \('stripe_balance_itemised_csv_v1', 'commbank_transaction_history_csv_v1'\).*state='pending'/s,
    );
    expect(query.mock.calls[1]?.[0]).toMatch(
      /artifact_profile IN \('stripe_balance_itemised_csv_v1', 'commbank_transaction_history_csv_v1'\).*state='abandoned'/s,
    );
    expect(query.mock.calls[2]?.[0]).toContain(
      "ORDER BY updated_at DESC, id DESC LIMIT 5",
    );
    expect(query.mock.calls[2]?.[0]).not.toMatch(
      /counterparty|description|reference|notes/,
    );
    expect(query.mock.calls[2]).toHaveLength(1);
  });

  it("applies the same bounded predicate to transaction rows and total", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({ rows: [{ total: 73 }] })
      .mockResolvedValueOnce({ rows: [transactionRow] });
    const repository = new FolioRepository({ query } as never, "folio", false);

    const result = await repository.listTransactionPage("actor", {
      search: "invoice",
      filters: [
        {
          field: "counterparty",
          operator: "contains",
          value: "acme",
        },
        {
          field: "date",
          operator: "greater_than_or_equal",
          value: "2026-01-01",
        },
        { field: "evidence", operator: "is", value: "attached" },
      ],
      sort: { key: "amount", direction: "desc" },
      page: 2,
      reportingTimezone: "Australia/Brisbane",
    });

    expect(result).toEqual({
      rows: [expect.objectContaining({ id: transactionRow.id })],
      total: 73,
      page: 2,
      pageSize: 50,
    });
    const countSql = String(query.mock.calls[1]?.[0]);
    const pageSql = String(query.mock.calls[2]?.[0]);
    const countWhere = countSql.slice(countSql.indexOf("WHERE"));
    expect(pageSql).toContain(countWhere);
    expect(pageSql).toContain(
      "ORDER BY CASE\n      WHEN transactions.source_system='stripe'",
    );
    expect(pageSql).toContain(
      "DESC NULLS LAST, transactions.id DESC LIMIT 50 OFFSET $6",
    );
    expect(query.mock.calls[1]?.[1]).toEqual([
      "invoice",
      "Australia/Brisbane",
      "acme",
      "2026-01-01",
      "attached",
    ]);
    expect(query.mock.calls[2]?.[1]).toEqual([
      "invoice",
      "Australia/Brisbane",
      "acme",
      "2026-01-01",
      "attached",
      50,
    ]);
  });

  it("clamps an out-of-range transaction page before applying its offset", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({ rows: [{ total: 3 }] })
      .mockResolvedValueOnce({ rows: [transactionRow] });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(
      repository.listTransactionPage("actor", {
        search: "",
        filters: [],
        sort: { key: "date", direction: "desc" },
        page: 2_001,
        reportingTimezone: "Australia/Brisbane",
      }),
    ).resolves.toMatchObject({ total: 3, page: 1, pageSize: 50 });
    expect(query.mock.calls[2]?.[1]).toEqual(["", "Australia/Brisbane", 0]);
  });

  it("returns only distinct manual counterparty and category suggestions", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "actor",
            email: "operator@example.test",
            display_name: null,
            role: "administrator",
            active: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ value: "Acme" }, { value: "Paper Co" }],
      })
      .mockResolvedValueOnce({ rows: [{ value: "Office and stationery" }] })
      .mockResolvedValueOnce({
        rows: [
          { counterparty: "Acme", category: "Office and stationery" },
          { counterparty: "Paper Co", category: "Office and stationery" },
        ],
      });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(repository.listEntrySuggestions("actor")).resolves.toEqual({
      counterparties: ["Acme", "Paper Co"],
      categories: ["Office and stationery"],
      supplierCategories: [
        { counterparty: "Acme", category: "Office and stationery" },
        { counterparty: "Paper Co", category: "Office and stationery" },
      ],
    });
    expect(query.mock.calls[0]).toEqual([
      expect.stringContaining("WHERE id = $1 AND active = true"),
      ["actor"],
    ]);
    expect(query.mock.calls[1]?.[0]).toMatch(
      /SELECT DISTINCT btrim\(counterparty\).*source_system='manual'.*status <> 'void'.*kind IN \('supplier_expense', 'supplier_credit'\)/,
    );
    expect(query.mock.calls[2]?.[0]).toMatch(
      /SELECT DISTINCT btrim\(category\).*source_system='manual'.*status <> 'void'.*kind IN \('supplier_expense', 'supplier_credit', 'processing_fee', 'dispute'\)/,
    );
    expect(query.mock.calls[1]?.[0]).not.toMatch(/email|description|notes/);
    expect(query.mock.calls[2]?.[0]).not.toMatch(/email|description|notes/);
    expect(query.mock.calls[3]?.[0]).toMatch(
      /DISTINCT ON \(btrim\(counterparty\), btrim\(category\)\).*source_system='manual'.*status <> 'void'.*kind IN \('supplier_expense', 'supplier_credit'\).*ORDER BY btrim\(counterparty\), btrim\(category\), updated_at DESC, id DESC\).*ORDER BY updated_at DESC, id DESC LIMIT 200/,
    );
    expect(query.mock.calls[3]?.[0]).not.toMatch(/email|description|notes/);
  });

  it("returns attached artifact filenames for list and get", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "actor",
            email: "operator@example.test",
            display_name: null,
            role: "administrator",
            active: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [transactionRow] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "actor",
            email: "operator@example.test",
            display_name: null,
            role: "administrator",
            active: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [transactionRow] });
    const repository = new FolioRepository({ query } as never, "folio", false);

    const [listed] = await repository.listTransactions("actor");
    const fetched = await repository.getTransaction("actor", transactionRow.id);

    expect(listed?.sourceArtifactFilename).toBe("Acme-2026-01-01-INV-1.pdf");
    expect(fetched?.sourceArtifactFilename).toBe("Acme-2026-01-01-INV-1.pdf");
    expect(listed?.sourceArtifactId).toBe(transactionRow.source_artifact_id);
    expect(listed?.sourceArtifacts?.map((artifact) => artifact.id)).toEqual([
      transactionRow.source_artifact_id,
      "22222222-2222-4222-8222-222222222223",
    ]);
    expect(listed?.updatedAt).toBe("2026-01-01T00:00:00.123456Z");
    expect(fetched?.updatedAt).toBe("2026-01-01T00:00:00.123456Z");
    expect(query.mock.calls[1]?.[0]).toContain(
      "artifacts.filename AS source_artifact_filename",
    );
    expect(query.mock.calls[3]?.[0]).toContain(
      "artifacts.filename AS source_artifact_filename",
    );
  });
});

describe("Folio Stripe imports", () => {
  const stripeRow: StripeImportRow = {
    reference: "txn_charge",
    occurredAt: "2026-09-01T00:00:00.000Z",
    availableAt: "2026-09-02T00:00:00.000Z",
    sourceCurrency: "AUD",
    sourceGross: "100.0000",
    sourceFee: "3.2000",
    sourceNet: "96.8000",
    reportingCategory: "charge",
    description: "Subscription",
  };
  const artifactRow = {
    id: "44444444-4444-4444-8444-444444444444",
    artifact_profile: "stripe_balance_itemised_csv_v1",
    object_key: "artifacts/stripe.csv",
    version_id: "version-1",
    media_type: "text/csv",
    byte_size: BigInt(100),
    checksum_sha256: "checksum",
    state: "available",
  };
  const actorRow = {
    id: "actor",
    email: "operator@example.test",
    display_name: null,
    role: "administrator",
    active: true,
  };

  it("previews new, identical, and conflicting references without a write", async () => {
    const identical = stripeRow;
    const conflicting = {
      ...stripeRow,
      reference: "txn_conflict",
      sourceNet: "95.8000",
    };
    const incoming = {
      ...stripeRow,
      reference: "txn_new",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [actorRow] })
      .mockResolvedValueOnce({ rows: [artifactRow] })
      .mockResolvedValueOnce({
        rows: [
          {
            kind: "sale",
            reference: identical.reference,
            description: identical.description,
            occurred_at: new Date(identical.occurredAt),
            available_at: new Date(identical.availableAt!),
            source_currency: identical.sourceCurrency,
            source_gross: identical.sourceGross,
            source_fee: identical.sourceFee,
            source_net: identical.sourceNet,
            metadata: { reportingCategory: identical.reportingCategory },
          },
          {
            kind: "sale",
            reference: conflicting.reference,
            description: conflicting.description,
            occurred_at: new Date(conflicting.occurredAt),
            available_at: new Date(conflicting.availableAt!),
            source_currency: conflicting.sourceCurrency,
            source_gross: conflicting.sourceGross,
            source_fee: conflicting.sourceFee,
            source_net: "96.8000",
            metadata: { reportingCategory: conflicting.reportingCategory },
          },
        ],
      });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(
      repository.previewStripeImport(actorRow.id, artifactRow.id, [
        identical,
        conflicting,
        incoming,
      ]),
    ).resolves.toEqual(["already_imported", "conflict", "will_import"]);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2]?.[0]).toContain("reference = ANY($1::text[])");
  });

  it("uses exact category semantics and preserves the raw category", async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [actorRow] })
      .mockResolvedValueOnce({ rows: [artifactRow] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "transaction" }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const repository = new FolioRepository(
      {
        connect: vi.fn().mockResolvedValue({
          query: clientQuery,
          release: vi.fn(),
        }),
      } as never,
      "folio",
      false,
    );

    await expect(
      repository.importStripe(
        actorRow.id,
        artifactRow.id,
        [stripeRow],
        "Australia/Brisbane",
      ),
    ).resolves.toBe(1);
    expect(clientQuery.mock.calls[3]?.[1]).toEqual([
      "actor",
      artifactRow.id,
      "sale",
      stripeRow.reference,
      stripeRow.description,
      stripeRow.occurredAt,
      stripeRow.availableAt,
      stripeRow.sourceCurrency,
      stripeRow.sourceGross,
      stripeRow.sourceFee,
      stripeRow.sourceNet,
      { reportingCategory: stripeRow.reportingCategory },
    ]);
    expect(clientQuery.mock.calls[3]?.[0]).toContain("ON CONFLICT DO NOTHING");
    expect(clientQuery.mock.calls[4]?.[0]).toContain(
      "SET filename=$2 WHERE id=$1 AND artifact_profile='stripe_balance_itemised_csv_v1' AND state='available'",
    );
    expect(clientQuery.mock.calls[4]?.[1]).toEqual([
      artifactRow.id,
      "Stripe-2026-09-01-2026-09-01.csv",
    ]);
  });

  it("skips an identical existing balance row on re-import", async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [actorRow] })
      .mockResolvedValueOnce({ rows: [artifactRow] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            kind: "sale",
            description: stripeRow.description,
            occurred_at: new Date(stripeRow.occurredAt),
            available_at: new Date(stripeRow.availableAt!),
            source_currency: stripeRow.sourceCurrency,
            source_gross: stripeRow.sourceGross,
            source_fee: stripeRow.sourceFee,
            source_net: stripeRow.sourceNet,
            metadata: { reportingCategory: stripeRow.reportingCategory },
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const repository = new FolioRepository(
      {
        connect: vi.fn().mockResolvedValue({
          query: clientQuery,
          release: vi.fn(),
        }),
      } as never,
      "folio",
      false,
    );

    await expect(
      repository.importStripe(
        actorRow.id,
        artifactRow.id,
        [stripeRow],
        "Australia/Brisbane",
      ),
    ).resolves.toBe(0);
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("leaves a user-supplied filename unchanged for an empty import", async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [actorRow] })
      .mockResolvedValueOnce({ rows: [artifactRow] })
      .mockResolvedValueOnce({});
    const repository = new FolioRepository(
      {
        connect: vi.fn().mockResolvedValue({
          query: clientQuery,
          release: vi.fn(),
        }),
      } as never,
      "folio",
      false,
    );

    await expect(
      repository.importStripe(
        actorRow.id,
        artifactRow.id,
        [],
        "Australia/Brisbane",
      ),
    ).resolves.toBe(0);
    expect(
      clientQuery.mock.calls.some(([query]) =>
        String(query).startsWith('UPDATE "folio"."source_artifacts"'),
      ),
    ).toBe(false);
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("rejects conflicting data for an existing balance reference", async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [actorRow] })
      .mockResolvedValueOnce({ rows: [artifactRow] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            kind: "sale",
            description: "Different description",
            occurred_at: new Date(stripeRow.occurredAt),
            available_at: new Date(stripeRow.availableAt!),
            source_currency: stripeRow.sourceCurrency,
            source_gross: stripeRow.sourceGross,
            source_fee: stripeRow.sourceFee,
            source_net: stripeRow.sourceNet,
            metadata: { reportingCategory: stripeRow.reportingCategory },
          },
        ],
      })
      .mockResolvedValueOnce({});
    const repository = new FolioRepository(
      {
        connect: vi.fn().mockResolvedValue({
          query: clientQuery,
          release: vi.fn(),
        }),
      } as never,
      "folio",
      false,
    );

    await expect(
      repository.importStripe(
        actorRow.id,
        artifactRow.id,
        [stripeRow],
        "Australia/Brisbane",
      ),
    ).rejects.toMatchObject({ code: "STRIPE_IMPORT_CONFLICT" });
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
});

describe("Folio transaction revisions", () => {
  it("matches manual updates at exact PostgreSQL microsecond precision", async () => {
    const expectedUpdatedAt = "2026-01-01T00:00:00.123456Z";
    const existing = {
      ...transactionRow,
      source_artifact_id: null,
      updated_at: new Date("2026-01-01T00:00:00.123Z"),
      updated_at_token: expectedUpdatedAt,
    };
    const updated = {
      ...existing,
      updated_at: new Date("2026-01-01T00:00:01.000Z"),
      updated_at_token: "2026-01-01T00:00:01.000000Z",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: "actor",
            email: "operator@example.test",
            display_name: null,
            role: "administrator",
            active: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [existing] })
      .mockResolvedValueOnce({ rows: [updated] })
      .mockResolvedValueOnce({});
    const client = { query, release: vi.fn() };
    const repository = new FolioRepository(
      { connect: vi.fn().mockResolvedValue(client) } as never,
      "folio",
      false,
    );
    const input = transactionInputSchema.parse({
      kind: "supplier_expense",
      status: "draft",
    });

    await expect(
      repository.updateManual("actor", existing.id, input, expectedUpdatedAt),
    ).resolves.toMatchObject({ updatedAt: "2026-01-01T00:00:01.000000Z" });
    expect(query.mock.calls[2]?.[0]).toContain("bank_transactions");
    expect(query.mock.calls[3]?.[0]).toContain("FOR UPDATE");
    expect(query.mock.calls[4]?.[0]).toContain("updated_at = $23::timestamptz");
    expect(query.mock.calls[4]?.[1]?.at(-1)).toBe(expectedUpdatedAt);
  });

  it("rejects manual updates from a different millisecond as a typed conflict", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: "actor",
            email: "operator@example.test",
            display_name: null,
            role: "administrator",
            active: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            ...transactionRow,
            source_artifact_id: null,
            updated_at: new Date("2026-01-01T00:00:00.124Z"),
            updated_at_token: "2026-01-01T00:00:00.123789Z",
          },
        ],
      })
      .mockResolvedValueOnce({});
    const client = { query, release: vi.fn() };
    const repository = new FolioRepository(
      { connect: vi.fn().mockResolvedValue(client) } as never,
      "folio",
      false,
    );
    const input = transactionInputSchema.parse({
      kind: "supplier_expense",
      status: "draft",
    });

    await expect(
      repository.updateManual(
        "actor",
        transactionRow.id,
        input,
        "2026-01-01T00:00:00.123456Z",
      ),
    ).rejects.toBeInstanceOf(FolioDiagnosticError);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("restores a void manual transaction only through an explicit restore action", async () => {
    const expectedUpdatedAt = "2026-01-01T00:00:00.123456Z";
    const existing = {
      ...transactionRow,
      status: "void",
      source_artifact_id: null,
      updated_at_token: expectedUpdatedAt,
    };
    const updated = {
      ...existing,
      status: "recorded",
      updated_at_token: "2026-01-01T00:00:01.000000Z",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: "actor",
            email: "operator@example.test",
            display_name: null,
            role: "administrator",
            active: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [existing] })
      .mockResolvedValueOnce({ rows: [updated] })
      .mockResolvedValueOnce({});
    const repository = new FolioRepository(
      {
        connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
      } as never,
      "folio",
      false,
    );
    const input = transactionInputSchema.parse({
      kind: "supplier_expense",
      status: "recorded",
    });

    await expect(
      repository.updateManual(
        "actor",
        transactionRow.id,
        input,
        expectedUpdatedAt,
        "restore_recorded",
      ),
    ).resolves.toMatchObject({ status: "recorded" });
    expect(query.mock.calls[4]?.[1]?.at(-1)).toBe(expectedUpdatedAt);
  });

  it("matches void predicates at exact PostgreSQL microsecond precision", async () => {
    const expectedUpdatedAt = "2026-01-01T00:00:00.123456Z";
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: "actor",
            email: "operator@example.test",
            display_name: null,
            role: "administrator",
            active: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const repository = new FolioRepository(
      {
        connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
      } as never,
      "folio",
      false,
    );

    await expect(
      repository.voidTransaction("actor", transactionRow.id, expectedUpdatedAt),
    ).resolves.toBeUndefined();
    expect(query.mock.calls[3]?.[0]).toContain("updated_at = $3::timestamptz");
    expect(query.mock.calls[3]?.[1]).toEqual([
      transactionRow.id,
      "actor",
      expectedUpdatedAt,
    ]);
  });

  it("reports a failed void predicate as a typed revision conflict", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: "actor",
            email: "operator@example.test",
            display_name: null,
            role: "administrator",
            active: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({});
    const repository = new FolioRepository(
      {
        connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
      } as never,
      "folio",
      false,
    );

    await expect(
      repository.voidTransaction(
        "actor",
        transactionRow.id,
        "2026-01-01T00:00:00.123456Z",
      ),
    ).rejects.toBeInstanceOf(FolioDiagnosticError);
  });
});

const transactionRow = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: null,
  source_artifact_id: "22222222-2222-4222-8222-222222222222",
  source_artifact_filename: "Acme-2026-01-01-INV-1.pdf",
  source_artifacts: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      artifact_profile: "manual_invoice_pdf_v1",
      filename: "Acme-2026-01-01-INV-1.pdf",
      state: "available",
      metadata: null,
    },
    {
      id: "22222222-2222-4222-8222-222222222223",
      artifact_profile: "manual_invoice_pdf_v1",
      filename: "Acme-2026-01-01-INV-2.pdf",
      state: "available",
      metadata: { role: "supporting" },
    },
  ],
  created_by_id: "33333333-3333-4333-8333-333333333333",
  updated_by_id: "33333333-3333-4333-8333-333333333333",
  source_system: "manual",
  kind: "supplier_expense",
  reference: "INV-1",
  counterparty: "Acme",
  description: null,
  status: "draft",
  category: null,
  notes: null,
  occurred_at: null,
  available_at: null,
  invoice_date: "2026-01-01",
  settled_at: null,
  document_currency: "AUD",
  document_amount: "10.0000",
  document_tax_amount: null,
  settlement_currency: null,
  settlement_amount: null,
  gst_credit_status: "not_registered",
  claimable_gst_aud: "0.0000",
  source_currency: null,
  source_gross: null,
  source_fee: null,
  source_net: null,
  metadata: {},
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  updated_at: new Date("2026-01-01T00:00:00.000Z"),
  updated_at_token: "2026-01-01T00:00:00.123456Z",
};

describe("Folio artifact lifecycle", () => {
  const previousId = "22222222-2222-4222-8222-222222222222";
  const replacementId = "22222222-2222-4222-8222-222222222223";

  it("stores the upload filename separately from the display filename", async () => {
    const actorId = "22222222-2222-4222-8222-222222222224";
    const artifactId = "22222222-2222-4222-8222-222222222225";
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: actorId,
            email: null,
            display_name: null,
            role: "member",
            active: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: artifactId,
            artifact_profile: "stripe_balance_itemised_csv_v1",
            object_key: "private/stripe/object",
            version_id: null,
            filename: "café.csv",
            original_filename: "café.csv",
            media_type: "text/csv",
            byte_size: "10",
            checksum_sha256: "checksum",
            state: "pending",
          },
        ],
      });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(
      repository.createPending({
        id: artifactId,
        actorId,
        ownerId: null,
        artifactProfile: "stripe_balance_itemised_csv_v1",
        objectKey: "private/stripe/object",
        filename: "café.csv",
        mediaType: "text/csv",
        byteSize: "10",
        checksumSha256: "checksum",
      }),
    ).resolves.toMatchObject({
      filename: "café.csv",
      originalFilename: "café.csv",
    });
    expect(query.mock.calls[1]?.[0]).toContain(
      "filename, original_filename, media_type",
    );
    expect(query.mock.calls[1]?.[1]).toEqual([
      artifactId,
      null,
      actorId,
      "stripe_balance_itemised_csv_v1",
      "private/stripe/object",
      "café.csv",
      "café.csv",
      "text/csv",
      "10",
      "checksum",
    ]);
  });

  const repositoryWithClient = (clientQuery: ReturnType<typeof vi.fn>) =>
    new FolioRepository(
      {
        connect: vi.fn().mockResolvedValue({
          query: clientQuery,
          release: vi.fn(),
        }),
      } as never,
      "folio",
      false,
    );

  it("rejects only an unlinked CSV artifact while pinning its version", async () => {
    const rejected = {
      id: previousId,
      artifact_profile: "stripe_balance_itemised_csv_v1",
      object_key: "private/stripe/object",
      version_id: "version-1",
      filename: "stripe.csv",
      media_type: "text/csv",
      byte_size: "10",
      checksum_sha256: "checksum",
      state: "rejected",
    };
    const query = vi.fn().mockResolvedValue({ rows: [rejected], rowCount: 1 });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(
      repository.rejectArtifact(previousId, "version-1"),
    ).resolves.toMatchObject({ state: "rejected", versionId: "version-1" });
    expect(query.mock.calls[0]?.[0]).toContain(
      "artifact.media_type='text/csv'",
    );
    expect(query.mock.calls[0]?.[0]).toContain(
      "artifact.artifact_profile='commbank_transaction_history_csv_v1'",
    );
    expect(query.mock.calls[0]?.[0]).toContain("NOT EXISTS");
  });

  it("claims deletion only after locking and checking both link tables", async () => {
    const available = {
      id: previousId,
      artifact_profile: "manual_invoice_pdf_v1",
      object_key: "private/pdf/object",
      version_id: "version-1",
      filename: "invoice.pdf",
      media_type: "application/pdf",
      byte_size: "10",
      checksum_sha256: "checksum",
      state: "available",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [available] })
      .mockResolvedValueOnce({ rows: [{ linked: false }] })
      .mockResolvedValueOnce({ rows: [{ ...available, state: "deleting" }] })
      .mockResolvedValueOnce({});
    const repository = repositoryWithClient(query);

    await expect(
      repository.claimArtifactDeletion(previousId),
    ).resolves.toMatchObject({
      id: previousId,
      state: "deleting",
    });
    expect(query.mock.calls[1]?.[0]).toContain("FOR UPDATE");
    expect(query.mock.calls[2]?.[0]).toContain("transaction_artifacts");
    expect(query.mock.calls[2]?.[0]).toContain("bank_transaction_artifacts");
    expect(query.mock.calls[3]?.[0]).toContain("SET state='deleting'");
    expect(query.mock.calls[4]?.[0]).toBe("COMMIT");
  });

  it("rolls back deletion claim when the locked artifact is linked", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: previousId }] })
      .mockResolvedValueOnce({ rows: [{ linked: true }] })
      .mockResolvedValueOnce({});
    const repository = repositoryWithClient(query);

    await expect(repository.claimArtifactDeletion(previousId)).rejects.toThrow(
      "referenced by a transaction or bank row",
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("guard-deletes only matching unlinked deletion metadata", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(
      repository.deleteClaimedArtifact(previousId, "private/pdf/object"),
    ).resolves.toBeUndefined();
    expect(query.mock.calls[0]?.[0]).toContain("artifact.state='deleting'");
    expect(query.mock.calls[0]?.[0]).toContain("artifact.object_key=$2");
    expect(query.mock.calls[0]?.[0]).toContain("NOT EXISTS");
  });

  it("rejects superseding an artifact referenced by any transaction", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: previousId,
            state: "available",
            artifact_profile: "manual_invoice_pdf_v1",
          },
          {
            id: replacementId,
            state: "available",
            artifact_profile: "manual_invoice_pdf_v1",
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const repository = repositoryWithClient(query);

    await expect(
      repository.supersede(previousId, replacementId),
    ).rejects.toThrow(
      "Cannot supersede an artifact referenced by a transaction",
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("rejects replacement artifacts with an incompatible profile", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: previousId,
            state: "available",
            artifact_profile: "manual_invoice_pdf_v1",
          },
          {
            id: replacementId,
            state: "available",
            artifact_profile: "stripe_balance_itemised_csv_v1",
          },
        ],
      })
      .mockResolvedValueOnce({});
    const repository = repositoryWithClient(query);

    await expect(
      repository.supersede(previousId, replacementId),
    ).rejects.toThrow(
      "Replacement artifact profile must match superseded artifact profile",
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("supersedes an unlinked artifact with an available compatible replacement", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: previousId,
            state: "available",
            artifact_profile: "manual_invoice_pdf_v1",
          },
          {
            id: replacementId,
            state: "available",
            artifact_profile: "manual_invoice_pdf_v1",
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const repository = repositoryWithClient(query);

    await expect(
      repository.supersede(previousId, replacementId),
    ).resolves.toBeUndefined();
    expect(query.mock.calls[3]?.[0]).toContain("SET state='superseded'");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });
});
