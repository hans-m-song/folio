import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
});
