import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("MCP upload intent migration", () => {
  it("persists credential-scoped idempotency without coupling artifact deletion", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../../migrations/0012_folio_mcp_upload_intents.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toContain('"mcp_upload_intents"');
    expect(migration).toContain('PRIMARY KEY ("credential_id", "request_key")');
    expect(migration).toContain('"payload_sha256" varchar(64)');
    expect(migration).toContain('"artifact_id" uuid NOT NULL');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "mcp_upload_intents_artifact_id_uidx"',
    );
    expect(migration).not.toMatch(
      /"artifact_id" uuid[^\n]*REFERENCES "__FOLIO_SCHEMA__"\."source_artifacts"/,
    );

    const migrator = await readFile(
      fileURLToPath(new URL("./migrate.ts", import.meta.url)),
      "utf8",
    );
    expect(migrator).toContain(
      'GRANT SELECT, INSERT ON TABLE "${config.databaseSchema}"."mcp_upload_intents"',
    );
  });
});
