import { describe, expect, it, vi } from "vitest";
import { types as pgTypes } from "pg";

import { FolioDiagnosticError } from "../domain/diagnostics";
import { ArtifactUploadIdempotencyConflictError } from "../documents/service";
import type { StripeImportRow } from "../domain/stripe-csv";
import { transactionInputSchema } from "../domain/types";
import { FolioRepository } from "./repository";

describe("tax partner options", () => {
  it("returns active user IDs and unambiguous labels without private profile fields", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({
        rows: [
          { id: "user-a", display_name: " Shared label " },
          { id: "user-b", display_name: "shared label" },
          { id: "user-c", display_name: null },
          { id: "user-d", display_name: "Unique label" },
        ],
      });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(repository.listTaxPartnerOptions("actor")).resolves.toEqual([
      { id: "user-a", label: "Shared label (user-a)" },
      { id: "user-b", label: "shared label (user-b)" },
      { id: "user-c", label: "User (user-c)" },
      { id: "user-d", label: "Unique label" },
    ]);
    expect(query).toHaveBeenLastCalledWith(
      'SELECT id, display_name FROM "folio"."users" WHERE active=true ORDER BY lower(display_name) NULLS LAST, id',
    );
  });

  it("does not query partner labels for an inactive actor", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(repository.listTaxPartnerOptions("actor")).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("invoice duplicate review hints", () => {
  it("returns advisory counts without changing evidence or imposing uniqueness", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({
        rows: [
          {
            linked_transactions: 2,
            matching_reference_transactions: 1,
            matching_checksum_artifacts: 3,
          },
        ],
      });
    const repository = new FolioRepository({ query } as never, "folio", false);
    await expect(
      repository.invoiceDuplicateHints(
        "actor",
        "artifact",
        "SYN-1",
        "synthetic-checksum",
      ),
    ).resolves.toEqual({
      linkedTransactions: 2,
      matchingReferenceTransactions: 1,
      matchingChecksumArtifacts: 3,
    });
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("SELECT"), [
      "artifact",
      "SYN-1",
      "synthetic-checksum",
    ]);
    expect(query.mock.calls.at(-1)?.[0]).not.toMatch(
      /INSERT|UPDATE|DELETE|ON CONFLICT/,
    );
  });
});

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
            recurring_bill_schedules: "folio.recurring_bill_schedules",
            recurring_bill_links: "folio.recurring_bill_links",
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 18 });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(repository.health()).resolves.toBeUndefined();
    expect(query.mock.calls[0]?.[1]).toContain(
      "folio.recurring_bill_schedules",
    );
    expect(query.mock.calls[0]?.[1]).toContain("folio.recurring_bill_links");
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
          "0010_folio_artifact_review",
          "0011_folio_mcp_proposals",
          "0012_folio_mcp_upload_intents",
          "0013_folio_mcp_transaction_scopes",
          "0014_folio_tax_review_snapshots",
          "0015_folio_matched_transaction_edits",
          "0016_folio_owner_loan_repayments",
          "0017_folio_recurring_bills",
          "0018_folio_recurring_bill_rules",
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
              recurring_bill_schedules: "folio.recurring_bill_schedules",
              recurring_bill_links: "folio.recurring_bill_links",
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
                recurring_bill_schedules: "folio.recurring_bill_schedules",
                recurring_bill_links: "folio.recurring_bill_links",
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
            checksum_sha256: "synthetic-checksum",
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
          checksumSha256: "synthetic-checksum",
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
    expect(query.mock.calls[2]?.[0]).toContain("LIMIT $6 OFFSET $7");
    expect(query.mock.calls[2]?.[1]).toEqual([
      "statement",
      "commbank_transaction_history_csv_v1",
      "available",
      "2026-09-01",
      "2026-09-30",
      25,
      0,
    ]);
  });

  it("applies artifact filters and ordered sorts before SQL pagination", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "actor",
            email: "owner@example.test",
            display_name: "Owner",
            role: "owner",
            active: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: 2 }] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new FolioRepository({ query } as never, "folio", false);

    const result = await repository.listArtifacts("actor", {
      filters: [
        { field: "state", operator: "is", value: "available" },
        { field: "linkage", operator: "is", value: "linked" },
        { field: "transactions", operator: "greater_than", value: "2" },
      ],
      sort: [
        { field: "state", direction: "asc" },
        { field: "uploaded", direction: "desc" },
        { field: "filename", direction: "asc" },
      ],
      limit: 25,
      offset: 50,
    });

    expect(result).toEqual({ total: 2, rows: [] });
    const sql = query.mock.calls[2]?.[0] as string;
    const orderByIndex = sql.indexOf(
      "ORDER BY artifact.state ASC, artifact.created_at DESC, artifact.filename ASC, artifact.id DESC",
    );
    const limitIndex = sql.indexOf("LIMIT $3 OFFSET $4");
    expect(sql).toContain("artifact.state = $1");
    expect(sql).toContain(
      'count(*)::integer FROM "folio"."transaction_artifacts"',
    );
    expect(orderByIndex).toBeGreaterThan(-1);
    expect(limitIndex).toBeGreaterThan(orderByIndex);
    expect(query.mock.calls[2]?.[1]).toEqual(["available", "2", 25, 50]);
  });

  it("filters artifact enum membership and computed linkage before pagination", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: "actor", active: true, role: "administrator" }],
      })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new FolioRepository({ query } as never, "folio", false);
    await repository.listArtifacts("actor", {
      filters: [
        {
          field: "state",
          operator: "contains_any",
          value: ["available", "awaiting_review"],
        },
        {
          field: "type",
          operator: "contains_none",
          value: ["application/pdf"],
        },
        {
          field: "linkage",
          operator: "contains_any",
          value: ["linked", "unlinked"],
        },
      ],
      sort: [{ field: "uploaded", direction: "desc" }],
      limit: 25,
      offset: 50,
    });
    const sql = query.mock.calls[2][0] as string;
    expect(sql).toContain("artifact.state = ANY($1::text[])");
    expect(sql).toContain("artifact.media_type <> ALL($2::text[])");
    expect(sql).toContain(
      "THEN 'linked' ELSE 'unlinked' END) = ANY($3::text[])",
    );
    expect(sql.indexOf("= ANY($3::text[])")).toBeLessThan(
      sql.indexOf("LIMIT $4 OFFSET $5"),
    );
    expect(query.mock.calls[1][1]).toEqual([
      ["available", "awaiting_review"],
      ["application/pdf"],
      ["linked", "unlinked"],
    ]);
    expect(query.mock.calls[2][1]).toEqual([
      ["available", "awaiting_review"],
      ["application/pdf"],
      ["linked", "unlinked"],
      25,
      50,
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

  it("returns a narrow artifact creator lookup for credential ownership checks", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ created_by_id: "11111111-1111-4111-8111-111111111111" }],
    });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(
      repository.getArtifactCreatorId("22222222-2222-4222-8222-222222222222"),
    ).resolves.toBe("11111111-1111-4111-8111-111111111111");
    expect(query).toHaveBeenCalledWith(
      'SELECT created_by_id FROM "folio"."source_artifacts" WHERE id=$1',
      ["22222222-2222-4222-8222-222222222222"],
    );
  });

  it("reports bounded Stripe checksum, filename, and imported-row duplicate warnings", async () => {
    const artifactId = "11111111-1111-4111-8111-111111111111";
    const checksumArtifactId = "22222222-2222-4222-8222-222222222222";
    const filenameArtifactId = "33333333-3333-4333-8333-333333333333";
    const rowArtifactId = "44444444-4444-4444-8444-444444444444";
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: artifactId,
            filename: "display.csv",
            original_filename: "Export.csv",
            checksum_sha256: "synthetic-checksum",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: checksumArtifactId,
            filename: "prior.csv",
            reason: "same_checksum",
            total_artifact_count: 1,
          },
          {
            id: filenameArtifactId,
            filename: "Export.csv",
            reason: "same_filename",
            total_artifact_count: 26,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: rowArtifactId,
            filename: "rows.csv",
            matching_row_count: 2,
            total_artifact_count: 1,
          },
        ],
      });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(
      repository.findCsvDuplicateWarnings(
        "actor",
        artifactId,
        "stripe_balance_itemised_csv_v1",
        {
          rowCount: 2,
          rowIdentityLimitReached: false,
          identities: [
            { kind: "stripe_reference", reference: "txn_1" },
            { kind: "stripe_reference", reference: "txn_2" },
          ],
        },
      ),
    ).resolves.toEqual({
      artifactId,
      profile: "stripe_balance_itemised_csv_v1",
      rowCount: 2,
      rowIdentityLimitReached: false,
      warnings: [
        {
          reason: "same_checksum",
          totalArtifactCount: 1,
          truncated: false,
          matches: [
            {
              artifactId: checksumArtifactId,
              filename: "prior.csv",
              matchingRowCount: null,
            },
          ],
        },
        {
          reason: "same_filename",
          totalArtifactCount: 26,
          truncated: true,
          matches: [
            {
              artifactId: filenameArtifactId,
              filename: "Export.csv",
              matchingRowCount: null,
            },
          ],
        },
        {
          reason: "overlapping_rows",
          totalArtifactCount: 1,
          truncated: false,
          matches: [
            {
              artifactId: rowArtifactId,
              filename: "rows.csv",
              matchingRowCount: 2,
            },
          ],
        },
      ],
    });
    expect(query.mock.calls[2]?.[0]).toContain("rank<=25");
    expect(query.mock.calls[2]?.[1]).toEqual([
      artifactId,
      "stripe_balance_itemised_csv_v1",
      "synthetic-checksum",
      "Export.csv",
    ]);
    expect(query.mock.calls[3]?.[0]).toContain(
      "transaction.reference=ANY($2::text[])",
    );
    expect(query.mock.calls[3]?.[1]).toEqual([artifactId, ["txn_1", "txn_2"]]);
  });

  it("matches CommBank row identities without treating source row numbers as global", async () => {
    const artifactId = "11111111-1111-4111-8111-111111111111";
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: artifactId,
            filename: "current.csv",
            original_filename: "current.csv",
            checksum_sha256: "synthetic-checksum",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(
      repository.findCsvDuplicateWarnings(
        "actor",
        artifactId,
        "commbank_transaction_history_csv_v1",
        {
          rowCount: 1,
          rowIdentityLimitReached: false,
          identities: [
            {
              kind: "commbank_row",
              rowIndex: 0,
              postedDate: "2026-09-01",
              amountAud: "-10.0000",
              description: "Synthetic movement",
              runningBalance: "90.00",
            },
          ],
        },
      ),
    ).resolves.toMatchObject({ warnings: [] });
    expect(query.mock.calls[3]?.[0]).toContain(
      "(bank.metadata->>'runningBalance')::numeric=requested.\"runningBalance\"",
    );
    expect(query.mock.calls[3]?.[0]).not.toContain("source_row");
    expect(JSON.parse(query.mock.calls[3]?.[1]?.[1] as string)).toEqual([
      {
        rowIndex: 0,
        postedDate: "2026-09-01",
        amountAud: "-10.0000",
        description: "Synthetic movement",
        runningBalance: "90.00",
      },
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

  it("counts recorded expected invoices or credit notes and bounds recent snapshots", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({
        rows: [
          {
            missing_invoice_or_credit_note_count: 4,
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
      missingInvoiceOrCreditNoteCount: 4,
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
      "transactions.status='recorded'",
    );
    expect(query.mock.calls[1]?.[0]).toContain(
      "transactions.kind NOT IN ('supplier_expense', 'supplier_credit')",
    );
    expect(query.mock.calls[1]?.[0]).toContain(
      "invoice_artifact.artifact_profile='manual_invoice_pdf_v1' AND invoice_artifact.state='available'",
    );
    expect(query.mock.calls[1]?.[0]).toMatch(
      /artifact_profile IN \('stripe_balance_itemised_csv_v1', 'commbank_transaction_history_csv_v1'\).*state IN \('pending', 'awaiting_review'\)/s,
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

  it("filters invoices by kind and available PDF profile before counting and paging", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [transactionRow] });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await repository.listTransactionPage("actor", {
      search: "",
      filters: [
        { field: "invoice", operator: "contains_any", value: ["missing"] },
      ],
      sort: { key: "date", direction: "desc" },
      page: 1,
      reportingTimezone: "Australia/Brisbane",
    });

    for (const index of [1, 2]) {
      const sql = String(query.mock.calls[index]?.[0]);
      expect(sql).toContain(
        "transactions.kind NOT IN ('supplier_expense', 'supplier_credit')",
      );
      expect(sql).toContain("invoice_artifact.state='available'");
      expect(sql).toContain(
        "invoice_artifact.artifact_profile='manual_invoice_pdf_v1'",
      );
      expect(sql).toContain("= ANY($3::text[])");
    }
    expect(query.mock.calls[1]?.[1]).toEqual([
      "",
      "Australia/Brisbane",
      ["missing"],
    ]);
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
      "WHEN transactions.kind IN ('supplier_expense', 'processing_fee', 'sale_refund', 'owner_loan_repayment') THEN -transactions.settlement_amount",
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

  it("uses the persisted repayment label in transaction description filters", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [transactionRow] });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await repository.listTransactionPage("actor", {
      search: "",
      filters: [
        { field: "description", operator: "contains", value: "repayment" },
      ],
      sort: { key: "date", direction: "desc" },
      page: 1,
      reportingTimezone: "Australia/Brisbane",
    });

    expect(String(query.mock.calls[1]?.[0])).toContain(
      "WHEN 'owner_loan_repayment' THEN 'Owner loan repayment'",
    );
  });

  it("binds enum membership arrays before transaction pagination", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({ rows: [{ total: 51 }] })
      .mockResolvedValueOnce({ rows: [transactionRow] });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await repository.listTransactionPage("actor", {
      search: "",
      filters: [
        {
          field: "kind",
          operator: "contains_any",
          value: ["sale", "sale_refund"],
        },
        { field: "source", operator: "contains_none", value: ["stripe"] },
        { field: "status", operator: "contains_any", value: [] },
      ],
      sort: { key: "date", direction: "desc" },
      page: 2,
      reportingTimezone: "Australia/Brisbane",
    });

    const countSql = String(query.mock.calls[1]?.[0]);
    const pageSql = String(query.mock.calls[2]?.[0]);
    expect(countSql).toContain("transactions.kind = ANY($3::text[])");
    expect(countSql).toContain("transactions.source_system <> ALL($4::text[])");
    expect(countSql).not.toContain("transactions.status = ANY");
    const pageWhereStart = pageSql.lastIndexOf(" WHERE ");
    expect(
      pageSql.slice(pageWhereStart + 1, pageSql.lastIndexOf(" ORDER BY ")),
    ).toBe(countSql.slice(countSql.indexOf("WHERE")));
    expect(pageSql).toContain("OFFSET $5");
    expect(query.mock.calls[1]?.[1]).toEqual([
      "",
      "Australia/Brisbane",
      ["sale", "sale_refund"],
      ["stripe"],
    ]);
    expect(query.mock.calls[2]?.[1]).toEqual([
      "",
      "Australia/Brisbane",
      ["sale", "sale_refund"],
      ["stripe"],
      50,
    ]);
  });

  it("orders transaction pages by each requested clause before pagination", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({ rows: [{ total: 51 }] })
      .mockResolvedValueOnce({ rows: [transactionRow] });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await repository.listTransactionPage("actor", {
      search: "",
      filters: [],
      sort: { key: "date", direction: "desc" },
      sortClauses: [
        { key: "state", direction: "asc" },
        { key: "amount", direction: "desc" },
      ],
      page: 2,
      reportingTimezone: "Australia/Brisbane",
    });

    const pageSql = String(query.mock.calls[2]?.[0]);
    const order = pageSql.slice(pageSql.lastIndexOf(" ORDER BY "));
    expect(order).toMatch(
      /lower\([\s\S]* ASC NULLS LAST, CASE[\s\S]* DESC NULLS LAST, transactions\.id ASC LIMIT 50 OFFSET \$3/,
    );
    expect(query.mock.calls[2]?.[1]).toEqual(["", "Australia/Brisbane", 50]);
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

  it("returns historical category suggestions and preserves supplier mappings", async () => {
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
        rows: [{ value: "Acme" }, { value: "CommBank" }, { value: "Paper Co" }],
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
      counterparties: ["Acme", "CommBank", "Paper Co"],
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
      /SELECT DISTINCT btrim\(counterparty\) AS value FROM .*WHERE status <> 'void' AND counterparty IS NOT NULL AND btrim\(counterparty\) <> ''\) values ORDER BY lower\(value\), value LIMIT 200/,
    );
    expect(query.mock.calls[1]?.[0]).not.toMatch(/source_system|kind IN \(/);
    expect(query.mock.calls[1]?.[0]).not.toMatch(/status\s*=\s*'recorded'/);
    const categorySql = String(query.mock.calls[2]?.[0]);
    expect(categorySql).toMatch(
      /SELECT DISTINCT btrim\(category\) AS value FROM .*WHERE status <> 'void' AND category IS NOT NULL AND btrim\(category\) <> ''\) values ORDER BY lower\(value\), value LIMIT 200/,
    );
    expect(categorySql).not.toMatch(/source_system|kind\s+IN\s*\(/);
    expect(categorySql).not.toMatch(/status\s*=\s*'recorded'/);
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

  it("atomically publishes an awaiting-review Stripe CSV when all rows already exist", async () => {
    const awaitingArtifact = { ...artifactRow, state: "awaiting_review" };
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [actorRow] })
      .mockResolvedValueOnce({ rows: [awaitingArtifact] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "existing-transaction",
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
    expect(clientQuery.mock.calls[3]?.[0]).toMatch(
      /SET state='available'.*state='awaiting_review'.*version_id=\$2/s,
    );
    expect(clientQuery.mock.calls[6]?.[0]).toContain(
      "ON CONFLICT (transaction_id, source_artifact_id) DO NOTHING",
    );
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
  const matchedEditFixture = (amountAud = "-41.0000") => {
    const updatedAt = "2026-01-01T00:00:00.123456Z";
    const existing = {
      ...transactionRow,
      status: "recorded",
      source_artifact_id: null,
      source_artifact_ids: [],
      updated_at_token: updatedAt,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [{ id: "actor", active: true, role: "administrator" }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "bank", amount_aud: amountAud }] })
      .mockResolvedValueOnce({ rows: [existing] })
      .mockResolvedValue({ rows: [existing], rowCount: 1 });
    const repository = new FolioRepository(
      {
        connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
      } as never,
      "folio",
      false,
    );
    const input = transactionInputSchema.parse({
      ownerId: "33333333-3333-4333-8333-333333333333",
      kind: "supplier_expense",
      status: "recorded",
      settledAt: "2026-01-02T00:00:00.000Z",
      settlementCurrency: "AUD",
      settlementAmount: "41.0000",
      documentCurrency: "USD",
      documentAmount: "25.0000",
    });
    return { query, repository, input, updatedAt, id: existing.id };
  };

  it.each(["supplier_expense", "processing_fee", "sale_refund"] as const)(
    "keeps an exact bank match when editing date, document facts and kind to %s",
    async (kind) => {
      const { query, repository, input, updatedAt, id } = matchedEditFixture();
      await repository.updateManual("actor", id, { ...input, kind }, updatedAt);
      expect(query.mock.calls[2][0]).toContain("ORDER BY id FOR UPDATE");
      expect(query.mock.calls[4][0]).toContain('UPDATE "folio"."transactions"');
      expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
      expect(
        query.mock.calls.some(([sql]) => /UPDATE.*bank_transactions/.test(sql)),
      ).toBe(false);
    },
  );

  it.each([
    { settlementAmount: "42.0000" },
    { settlementAmount: "41.0001" },
    { settlementCurrency: "USD" },
    { settledAt: null },
    { settlementAmount: null },
    { kind: "sale" as const },
    { kind: "transfer" as const },
  ])(
    "rejects a matched edit that changes eligibility or exact signed AUD effect: %j",
    async (changes) => {
      const { query, repository, input, updatedAt, id } = matchedEditFixture();
      await expect(
        repository.updateManual(
          "actor",
          id,
          { ...input, ...changes },
          updatedAt,
        ),
      ).rejects.toMatchObject({
        diagnostic: {
          code: "BANK_MATCH_EDIT_CONFLICT",
          httpStatus: 409,
          retryable: false,
        },
      });
      expect(query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(
        false,
      );
      expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    },
  );

  it("requires explicit unmatching before voiding a matched transaction", async () => {
    const { query, repository, updatedAt, id } = matchedEditFixture();
    await expect(
      repository.voidTransaction("actor", id, updatedAt),
    ).rejects.toMatchObject({ code: "BANK_MATCH_EDIT_CONFLICT" });
    expect(query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(
      false,
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

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

  it("permanently deletes only the current manual draft and its MCP submission", async () => {
    const expectedUpdatedAt = "2026-09-27T00:00:00.123456Z";
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({ rows: [{ id: transactionRow.id }] })
      .mockResolvedValueOnce({ rowCount: 1 })
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
      repository.deleteDraftTransaction(
        "actor",
        transactionRow.id,
        expectedUpdatedAt,
      ),
    ).resolves.toBeUndefined();
    expect(query.mock.calls[2]?.[0]).toContain(
      "source_system='manual' AND status='draft'",
    );
    expect(query.mock.calls[2]?.[1]).toEqual([
      transactionRow.id,
      expectedUpdatedAt,
    ]);
    expect(query.mock.calls[3]?.[0]).toContain(
      'DELETE FROM "folio"."mcp_submissions"',
    );
    expect(query.mock.calls[4]?.[0]).toContain(
      'DELETE FROM "folio"."transactions"',
    );
    expect(
      query.mock.calls.some(([statement]) =>
        String(statement).includes('DELETE FROM "folio"."source_artifacts"'),
      ),
    ).toBe(false);
  });

  it("does not delete a recorded or changed transaction", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: "actor", active: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});
    const repository = new FolioRepository(
      {
        connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
      } as never,
      "folio",
      false,
    );

    await expect(
      repository.deleteDraftTransaction(
        "actor",
        transactionRow.id,
        "2026-09-27T00:00:00.123456Z",
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(
      query.mock.calls.some(([statement]) =>
        String(statement).startsWith("DELETE"),
      ),
    ).toBe(false);
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

  const uploadIntentInput = {
    credentialId: "44444444-4444-4444-8444-444444444444",
    requestKey: "upload-request-1",
    payloadSha256: "a".repeat(64),
    id: "55555555-5555-4555-8555-555555555555",
    actorId: "77777777-7777-4777-8777-777777777777",
    ownerId: "66666666-6666-4666-8666-666666666666",
    artifactProfile: "manual_invoice_pdf_v1" as const,
    objectKey: "private/manual_invoice_pdf_v1/object",
    filename: "invoice.pdf",
    mediaType: "application/pdf",
    byteSize: "10",
    checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  };

  it("atomically creates a credential-bound upload intent and pending artifact", async () => {
    const pending = {
      id: uploadIntentInput.id,
      artifact_profile: uploadIntentInput.artifactProfile,
      object_key: uploadIntentInput.objectKey,
      version_id: null,
      filename: uploadIntentInput.filename,
      original_filename: uploadIntentInput.filename,
      media_type: uploadIntentInput.mediaType,
      byte_size: uploadIntentInput.byteSize,
      checksum_sha256: uploadIntentInput.checksumSha256,
      state: "pending",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            actor_user_id: uploadIntentInput.actorId,
            default_owner_id: uploadIntentInput.ownerId,
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [pending] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});

    await expect(
      repositoryWithClient(query).createPendingUploadIntent(uploadIntentInput),
    ).resolves.toMatchObject({
      status: "created",
      artifact: { id: uploadIntentInput.id, state: "pending" },
    });
    expect(query.mock.calls[1]?.[0]).toContain(
      "'artifacts:upload'=ANY(credential.scopes)",
    );
    expect(query.mock.calls[4]?.[0]).toContain("source_artifacts");
    expect(query.mock.calls[5]?.[0]).toContain("mcp_upload_intents");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("replays only the same pending payload and reports terminal intents without reuse", async () => {
    const replayRow = {
      intent_payload_sha256: uploadIntentInput.payloadSha256,
      intent_artifact_id: uploadIntentInput.id,
      id: uploadIntentInput.id,
      artifact_profile: uploadIntentInput.artifactProfile,
      object_key: uploadIntentInput.objectKey,
      version_id: null,
      filename: uploadIntentInput.filename,
      original_filename: uploadIntentInput.filename,
      media_type: uploadIntentInput.mediaType,
      byte_size: uploadIntentInput.byteSize,
      checksum_sha256: uploadIntentInput.checksumSha256,
      state: "pending",
    };
    const queryFor = (row: Record<string, unknown>) =>
      vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          rows: [
            {
              actor_user_id: uploadIntentInput.actorId,
              default_owner_id: uploadIntentInput.ownerId,
            },
          ],
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({});

    await expect(
      repositoryWithClient(queryFor(replayRow)).createPendingUploadIntent(
        uploadIntentInput,
      ),
    ).resolves.toMatchObject({
      status: "replayed",
      artifact: { id: uploadIntentInput.id },
    });
    await expect(
      repositoryWithClient(
        queryFor({ ...replayRow, state: "awaiting_review" }),
      ).createPendingUploadIntent(uploadIntentInput),
    ).resolves.toEqual({
      status: "not_uploadable",
      artifactId: uploadIntentInput.id,
      artifactState: "awaiting_review",
    });
    await expect(
      repositoryWithClient(
        queryFor({
          intent_payload_sha256: uploadIntentInput.payloadSha256,
          intent_artifact_id: uploadIntentInput.id,
          id: null,
          state: null,
        }),
      ).createPendingUploadIntent(uploadIntentInput),
    ).resolves.toEqual({
      status: "not_uploadable",
      artifactId: uploadIntentInput.id,
      artifactState: "deleted",
    });
  });

  it("conflicts before artifact creation when an upload key payload changes", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            actor_user_id: uploadIntentInput.actorId,
            default_owner_id: uploadIntentInput.ownerId,
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            intent_payload_sha256: "b".repeat(64),
            intent_artifact_id: uploadIntentInput.id,
          },
        ],
      })
      .mockResolvedValueOnce({});

    await expect(
      repositoryWithClient(query).createPendingUploadIntent(uploadIntentInput),
    ).rejects.toBeInstanceOf(ArtifactUploadIdempotencyConflictError);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(
      query.mock.calls.some(([statement]) =>
        String(statement).startsWith("INSERT"),
      ),
    ).toBe(false);
  });

  it("rejects an unlinked awaiting-review PDF or CSV at its pinned version", async () => {
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
      "artifact.media_type IN ('application/pdf', 'text/csv')",
    );
    expect(query.mock.calls[0]?.[0]).toContain(
      "artifact.state='awaiting_review'",
    );
    expect(query.mock.calls[0]?.[0]).toContain("NOT EXISTS");
  });

  it("pins confirmation for review and explicitly approves only the same PDF version", async () => {
    const approved = {
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
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [approved], rowCount: 1 });
    const repository = new FolioRepository({ query } as never, "folio", false);

    await expect(
      repository.confirmAwaitingReview(previousId, "version-1"),
    ).resolves.toBeUndefined();
    await expect(
      repository.approveArtifact(previousId, "version-1"),
    ).resolves.toMatchObject({ state: "available", versionId: "version-1" });
    expect(query.mock.calls[0]?.[0]).toContain("state='awaiting_review'");
    expect(query.mock.calls[1]?.[0]).toMatch(
      /state='available'.*state='awaiting_review'.*version_id=\$2.*artifact_profile='manual_invoice_pdf_v1'/s,
    );
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
