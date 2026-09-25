import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createFolioSchema } from "./schema";

describe("Folio schema and migration", () => {
  it("rejects unsafe dynamic schemas", () => {
    expect(() => createFolioSchema("folio_test")).not.toThrow();
    expect(() => createFolioSchema("public;drop schema")).toThrow("Invalid");
  });

  it("defines only the reviewed M1 tables and configurable namespace token", async () => {
    const path = fileURLToPath(
      new URL("../../migrations/0001_folio_m1.sql", import.meta.url),
    );
    const migration = await readFile(path, "utf8");
    const hardeningPath = fileURLToPath(
      new URL("../../migrations/0002_folio_m1_hardening.sql", import.meta.url),
    );
    const hardeningMigration = await readFile(hardeningPath, "utf8");
    const refinementPath = fileURLToPath(
      new URL(
        "../../migrations/0003_folio_manual_entry_refinements.sql",
        import.meta.url,
      ),
    );
    const refinementMigration = await readFile(refinementPath, "utf8");
    const authPath = fileURLToPath(
      new URL("../../migrations/0004_folio_oidc_sessions.sql", import.meta.url),
    );
    const authMigration = await readFile(authPath, "utf8");
    const migratePath = fileURLToPath(new URL("./migrate.ts", import.meta.url));
    const migrate = await readFile(migratePath, "utf8");
    expect(migration.match(/CREATE TABLE/g)).toHaveLength(3);
    expect(migration).toContain('"__FOLIO_SCHEMA__"."users"');
    expect(migration).toContain("transactions_artifact_trigger");
    expect(migration).toContain("source_artifacts_preserve_claimable_trigger");
    expect(migration).toContain("transactions_manual_artifact_uidx");
    expect(migration).toContain("transactions_source_artifact_id_idx");
    expect(migration).toMatch(
      /gst_credit_status" = 'claimable'[\s\S]*artifact\."kind" = 'pdf'[\s\S]*artifact\."state" = 'available'/,
    );
    expect(migration).not.toMatch(/\b(public|DROP)\b/i);
    expect(hardeningMigration).toContain("CREATE OR REPLACE FUNCTION");
    expect(hardeningMigration).toMatch(
      /gst_credit_status" = 'claimable'[\s\S]*artifact\."kind" = 'pdf'[\s\S]*artifact\."state" = 'available'/,
    );
    expect(hardeningMigration).not.toMatch(/\b(public|DROP)\b/i);
    expect(refinementMigration).toContain('ADD COLUMN "tax_treatment"');
    expect(refinementMigration).toContain("owner_contribution");
    expect(refinementMigration).toContain("owner_loan");
    expect(refinementMigration).toContain("transactions_tax_treatment_check");
    expect(refinementMigration).toContain("transactions_owner_tax_check");
    expect(refinementMigration).toContain('"gst_credit_status" IN');
    expect(refinementMigration).toContain('"claimable_gst_aud", 0) = 0');
    expect(refinementMigration).toContain("\"tax_treatment\" = 'no_tax'");
    expect(refinementMigration).not.toMatch(/\b(public|DROP TABLE)\b/i);
    expect(authMigration.match(/CREATE TABLE/g)).toHaveLength(2);
    expect(authMigration).toContain('"auth_attempts"');
    expect(authMigration).toContain('"auth_sessions"');
    expect(authMigration).toContain('"token_hash" varchar(64) PRIMARY KEY');
    expect(authMigration).not.toContain("access_token");
    expect(authMigration).not.toContain("refresh_token");
    expect(authMigration).not.toMatch(/\b(public|DROP)\b/i);
    expect(migrate).toContain('"auth_sessions"');
    expect(migrate).toContain('"auth_attempts"');
    expect(migrate).toContain("SELECT, INSERT, DELETE");
    expect(migrate).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${config.databaseSchema}"."source_artifacts"',
    );
  });
});
