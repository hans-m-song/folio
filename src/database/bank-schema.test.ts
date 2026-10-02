import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { requiredMigrationIds } from "./migrations";

describe("bank activity migration", () => {
  it("defines immutable source rows, typed attribution, and serialized import identity", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../../migrations/0006_folio_bank_activity.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(migration).toContain(
      'CREATE TABLE "__FOLIO_SCHEMA__"."bank_transactions"',
    );
    expect(migration).toContain(
      'CREATE TABLE "__FOLIO_SCHEMA__"."bank_transaction_artifacts"',
    );
    expect(migration).toContain(
      'PRIMARY KEY ("bank_transaction_id", "source_artifact_id")',
    );
    expect(migration).toContain(
      "source_artifacts_available_bank_checksum_uidx",
    );
    expect(migration).toContain("protect_bank_source_fields");
    expect(migration).toContain("Bank source fields are immutable");
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain(
      "Bank transaction artifacts must reference an available artifact",
    );
    expect(migration).not.toMatch(/CREATE TABLE[^;]*bank_imports/i);
  });

  it("enforces exact eligible matches and protects matched cash identity", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../../migrations/0007_folio_bank_reconciliation.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(migration).toContain("validate_bank_match");
    expect(migration).toContain(
      "transactions_matched_fields_immutable_trigger",
    );
    expect(migration).toContain("source_system");
    expect(migration).toContain("settlement_currency");
    expect(migration).toContain("settlement_amount");
    expect(migration).toContain("Unmatch the bank transaction");
    expect(migration).not.toContain("invoice_date");
  });

  it("revalidates matched transaction edits against the existing bank amount", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../../migrations/0015_folio_matched_transaction_edits.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(migration).toContain("CREATE OR REPLACE FUNCTION");
    expect(migration).toContain('WHERE "matched_transaction_id" = OLD."id"');
    expect(migration).toContain('NEW."settled_at" IS NULL');
    expect(migration).toContain(
      "expected_amount IS DISTINCT FROM matched_amount",
    );
    expect(migration).toContain(
      "Keep the recorded AUD amount and direction, or unmatch the bank transaction before this edit",
    );
    expect(requiredMigrationIds).toContain(
      "0015_folio_matched_transaction_edits",
    );
  });

  it("adds owner loan repayments with an explicit owner, positive principal and outgoing match direction", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../../migrations/0016_folio_owner_loan_repayments.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(migration).toContain("owner_loan_repayment");
    expect(migration).toContain('"owner_id" IS NOT NULL');
    expect(migration).toContain(
      '"document_amount" IS NOT NULL AND "document_amount" > 0',
    );
    expect(migration).toContain(
      '"settlement_amount" IS NULL OR "settlement_amount" > 0',
    );
    expect(migration).toContain("CREATE OR REPLACE FUNCTION");
    expect(migration).toContain("validate_bank_match");
    expect(migration).toContain("protect_matched_transaction_fields");
    expect(migration).toContain('"settlement_amount"');
    expect(migration).toContain(
      "expected_amount IS DISTINCT FROM matched_amount",
    );
    expect(migration).toContain(
      `WHEN target."kind" IN ('sale', 'supplier_credit', 'owner_contribution', 'owner_loan') THEN target."settlement_amount"`,
    );
    expect(migration).toContain(
      `WHEN NEW."kind" IN ('sale', 'supplier_credit', 'owner_contribution', 'owner_loan') THEN NEW."settlement_amount"`,
    );
    expect(migration).toContain('ELSE -target."settlement_amount"\n  END;');
    expect(migration).toContain('ELSE -NEW."settlement_amount"\n  END;');
    expect(requiredMigrationIds).toContain("0016_folio_owner_loan_repayments");
  });
});
