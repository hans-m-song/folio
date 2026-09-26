import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { loadConfig } from "../config";
import { requiredMigrationIds } from "./migrations";

const config = loadConfig(process.env);
const migrations = await Promise.all(
  requiredMigrationIds.map(async (id) => ({
    id,
    sql: (
      await readFile(
        fileURLToPath(new URL(`../../migrations/${id}.sql`, import.meta.url)),
        "utf8",
      )
    ).replaceAll("__FOLIO_SCHEMA__", config.databaseSchema),
  })),
);
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
try {
  await pool.query("BEGIN");
  await pool.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `folio-migrations:${config.databaseSchema}`,
  ]);
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${config.databaseSchema}"`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "${config.databaseSchema}"."_migrations" (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  for (const migration of migrations) {
    const applied = await pool.query(
      `SELECT 1 FROM "${config.databaseSchema}"."_migrations" WHERE id = $1`,
      [migration.id],
    );
    if (applied.rowCount === 0) {
      await pool.query(migration.sql);
      await pool.query(
        `INSERT INTO "${config.databaseSchema}"."_migrations" (id) VALUES ($1)`,
        [migration.id],
      );
    }
  }
  await pool.query(
    `REVOKE CREATE ON SCHEMA "${config.databaseSchema}" FROM PUBLIC`,
  );
  await pool.query(
    `GRANT USAGE ON SCHEMA "${config.databaseSchema}" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE ON TABLE "${config.databaseSchema}"."users", "${config.databaseSchema}"."transactions", "${config.databaseSchema}"."auth_sessions" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${config.databaseSchema}"."source_artifacts" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${config.databaseSchema}"."transaction_artifacts" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE ON TABLE "${config.databaseSchema}"."bank_transactions" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT ON TABLE "${config.databaseSchema}"."bank_transaction_artifacts" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT, DELETE ON TABLE "${config.databaseSchema}"."auth_attempts" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE ON TABLE "${config.databaseSchema}"."mcp_credentials" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE ON TABLE "${config.databaseSchema}"."mcp_submissions" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT ON TABLE "${config.databaseSchema}"."mcp_upload_intents" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT ON TABLE "${config.databaseSchema}"."_migrations" TO "${config.databaseAppRole}"`,
  );
  await pool.query("COMMIT");
} catch (error) {
  await pool.query("ROLLBACK");
  throw error;
} finally {
  await pool.end();
}
