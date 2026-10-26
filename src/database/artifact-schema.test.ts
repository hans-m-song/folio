import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { requiredMigrationIds } from "./migrations";

describe("artifact relationship migration", () => {
  it("migrates profiles and creates a many-to-many evidence table", async () => {
    const path = fileURLToPath(
      new URL(
        "../../migrations/0005_folio_artifact_profiles.sql",
        import.meta.url,
      ),
    );
    const migration = await readFile(path, "utf8");
    expect(migration).toContain('RENAME COLUMN "kind" TO "artifact_profile"');
    expect(migration).toContain(
      'CREATE TABLE "__FOLIO_SCHEMA__"."transaction_artifacts"',
    );
    expect(migration).toContain(
      'PRIMARY KEY ("transaction_id", "source_artifact_id")',
    );
    expect(migration).toContain('"metadata" jsonb');
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migration).toContain("DROP INDEX IF EXISTS");
    expect(migration).toContain("enforce_transaction_evidence_links");
    expect(migration).toContain("prevent_artifact_profile_change");
    expect(migration).toContain("protect_claimable_evidence_link");
    expect(migration).toContain(
      'OLD."transaction_id" IS DISTINCT FROM NEW."transaction_id"',
    );
    expect(migration).toContain(
      'UPDATE OF "transaction_id", "source_artifact_id"',
    );
    expect(migration).toContain(
      'WHERE candidate."id" = OLD."transaction_id"\n  FOR UPDATE',
    );
  });

  it("adds a durable rejected CSV state guarded against linked evidence", async () => {
    const path = fileURLToPath(
      new URL(
        "../../migrations/0008_folio_rejected_artifacts.sql",
        import.meta.url,
      ),
    );
    const migration = await readFile(path, "utf8");
    expect(migration).toContain("'rejected'");
    expect(migration).toContain("source_artifacts_rejected_csv_check");
    expect(migration).toContain("source_artifacts_rejected_unlinked_trigger");
    expect(migration).toContain('ADD COLUMN "original_filename" text');
    expect(migration).toContain(
      'CREATE TRIGGER "transaction_artifacts_artifact_lock_trigger"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "bank_transaction_artifacts_artifact_lock_trigger"',
    );
    expect(migration).toContain('"id" = NEW."source_artifact_id" FOR SHARE');
    expect(migration).toContain("artifact_state IS DISTINCT FROM 'available'");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain('"transaction_artifacts"');
    expect(migration).toContain('"bank_transaction_artifacts"');
  });

  it("adds a retryable deleting state", async () => {
    const path = fileURLToPath(
      new URL(
        "../../migrations/0009_folio_unlinked_artifact_deletion.sql",
        import.meta.url,
      ),
    );
    const migration = await readFile(path, "utf8");
    expect(migration).toContain("'deleting'");
    expect(migration).toContain("\"state\" = 'deleting'");
    expect(migration).toContain(
      '("version_id" IS NULL AND "confirmed_at" IS NULL)',
    );
    expect(migration).toContain(
      '("version_id" IS NOT NULL AND "confirmed_at" IS NOT NULL)',
    );
  });

  it("adds pinned awaiting review without rewriting available legacy rows", async () => {
    const path = fileURLToPath(
      new URL(
        "../../migrations/0010_folio_artifact_review.sql",
        import.meta.url,
      ),
    );
    const migration = await readFile(path, "utf8");
    expect(migration).toContain("'awaiting_review'");
    expect(migration).toContain(
      "'awaiting_review', 'available', 'rejected', 'superseded'",
    );
    expect(migration).toContain(
      'DROP CONSTRAINT "source_artifacts_rejected_csv_check"',
    );
    expect(migration).not.toMatch(/UPDATE\s+"__FOLIO_SCHEMA__"/);
  });

  it("requires an empty artifact table before removing storage versions", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../../migrations/0019_folio_unversioned_artifacts.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(migration).toMatch(
      /IF EXISTS \([\s\S]*FROM "__FOLIO_SCHEMA__"\."source_artifacts"[\s\S]*\) THEN[\s\S]*RAISE EXCEPTION[\s\S]*source_artifacts must be empty/,
    );
    expect(migration.indexOf("LOCK TABLE")).toBeLessThan(
      migration.indexOf("DO $$"),
    );
    expect(migration).toContain('DROP COLUMN "version_id"');
    expect(migration).toContain('ADD COLUMN "upload_expires_at" timestamptz');
    expect(migration).toContain('"confirmed_at" IS NOT NULL');
    expect(migration).not.toMatch(/DELETE FROM|TRUNCATE/i);
  });

  it("adds nullable source artifact metadata without replacing existing rows", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../../migrations/0020_folio_artifact_metadata.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(requiredMigrationIds).toContain("0020_folio_artifact_metadata");
    expect(migration).toContain('ADD COLUMN "period_start" date');
    expect(migration).toContain('ADD COLUMN "period_end" date');
    expect(migration).toContain('ADD COLUMN "document_date" date');
    expect(migration).toContain('ADD COLUMN "reference" text');
    expect(migration).toContain('ADD COLUMN "notes" text');
    expect(migration).toMatch(/"period_start" <= "period_end"/);
    expect(migration).not.toMatch(
      /DELETE FROM|TRUNCATE|UPDATE\s+"__FOLIO_SCHEMA__"/i,
    );
  });

  it("adds an optional bounded supplier field without rewriting existing rows", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../../migrations/0021_folio_artifact_supplier.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(requiredMigrationIds).toContain("0021_folio_artifact_supplier");
    expect(migration).toContain('ADD COLUMN "supplier" text');
    expect(migration).toMatch(
      /source_artifacts_supplier_length_check[\s\S]*char_length\("supplier"\) <= 200/,
    );
    expect(migration).not.toMatch(
      /DELETE FROM|TRUNCATE|UPDATE\s+"__FOLIO_SCHEMA__"/i,
    );
  });
});
