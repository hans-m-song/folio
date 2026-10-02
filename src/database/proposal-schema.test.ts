import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("MCP proposal migration", () => {
  it("stores hash-only scoped credentials and exclusive proposal outcomes", async () => {
    const path = fileURLToPath(
      new URL("../../migrations/0011_folio_mcp_proposals.sql", import.meta.url),
    );
    const migration = await readFile(path, "utf8");
    expect(migration).toContain('"token_hash" varchar(64)');
    expect(migration).not.toMatch(/"(token|secret|bearer)"\s/);
    expect(migration).toContain('"actor_user_id" uuid NOT NULL');
    expect(migration).toContain('"default_owner_id" uuid NOT NULL');
    expect(migration).toContain("mcp_credentials_actor_owner_check");
    expect(migration).toContain("mcp_credentials_dedicated_actor_check");
    expect(migration).toContain("'proposals:submit'");
    expect(migration).toContain("'submissions:read'");
    expect(migration).toContain("mcp_submissions_idempotency_uidx");
    expect(migration).toContain("mcp_submissions_result_check");
    expect(migration).toContain("mcp_submissions_match_target_check");
    expect(migration).toContain('"proposed_evidence_artifact_id" uuid');
    expect(migration).toContain('"evidence_discarded_at" timestamptz');
    expect(migration).toContain("enforce_retained_proposed_evidence");
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toMatch(
      /link\."source_artifact_id" = submission\."proposed_evidence_artifact_id"/,
    );
    expect(migration).toContain("artifact.\"state\" = 'available'");
    expect(migration).toContain("ON DELETE RESTRICT");
    const migrator = await readFile(
      fileURLToPath(new URL("./migrate.ts", import.meta.url)),
      "utf8",
    );
    expect(migrator).toContain('"mcp_credentials"');
    expect(migrator).toContain('"mcp_submissions"');
    expect(migrator).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${config.databaseSchema}"."mcp_submissions"',
    );
  });

  it("migrates proposal submission authority into explicit current scopes", async () => {
    const path = fileURLToPath(
      new URL(
        "../../migrations/0013_folio_mcp_transaction_scopes.sql",
        import.meta.url,
      ),
    );
    const migration = await readFile(path, "utf8");
    expect(migration).toContain("array_remove(\"scopes\", 'proposals:submit')");
    expect(migration).toContain("'transactions:draft'");
    expect(migration).toContain("'transactions:categorize'");
    expect(migration).toContain("'bank_matches:suggest'");
    expect(migration).not.toContain("transactions:*");
  });
});
