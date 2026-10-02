import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { loadConfig } from "../config";
import { formatDatabaseCliFailure } from "./cli-errors";
import { requiredMigrationIds } from "./migrations";

let stage = "configuration";
let pool: pg.Pool | undefined;
let transactionOpen = false;
try {
  const config = loadConfig(process.env);
  stage = "load_migrations";
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
  pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
  stage = "begin";
  await pool.query("BEGIN");
  transactionOpen = true;
  stage = "migration_lock";
  await pool.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `folio-migrations:${config.databaseSchema}`,
  ]);
  stage = "schema_setup";
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${config.databaseSchema}"`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "${config.databaseSchema}"."_migrations" (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const appliedMigrationIds: string[] = [];
  for (const migration of migrations) {
    stage = `migration:${migration.id}`;
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
      appliedMigrationIds.push(migration.id);
    }
  }
  stage = "permissions";
  await pool.query(
    `REVOKE CREATE ON SCHEMA "${config.databaseSchema}" FROM PUBLIC`,
  );
  await pool.query(
    `GRANT USAGE ON SCHEMA "${config.databaseSchema}" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE ON TABLE "${config.databaseSchema}"."users", "${config.databaseSchema}"."auth_sessions" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${config.databaseSchema}"."transactions" TO "${config.databaseAppRole}"`,
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
    `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${config.databaseSchema}"."mcp_submissions" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT ON TABLE "${config.databaseSchema}"."mcp_upload_intents" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT ON TABLE "${config.databaseSchema}"."tax_review_snapshots" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE ON TABLE "${config.databaseSchema}"."recurring_bill_schedules" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT, INSERT, DELETE ON TABLE "${config.databaseSchema}"."recurring_bill_links" TO "${config.databaseAppRole}"`,
  );
  await pool.query(
    `GRANT SELECT ON TABLE "${config.databaseSchema}"."_migrations" TO "${config.databaseAppRole}"`,
  );
  stage = "commit";
  await pool.query("COMMIT");
  transactionOpen = false;
  process.stdout.write(
    appliedMigrationIds.length > 0
      ? `Applied Folio migrations: ${appliedMigrationIds.join(", ")}\n`
      : "Folio migrations are current.\n",
  );
} catch (error) {
  if (transactionOpen && pool) {
    try {
      await pool.query("ROLLBACK");
    } catch (rollbackError) {
      process.stderr.write(
        `${formatDatabaseCliFailure("migrate", "rollback", rollbackError)}\n`,
      );
    }
  }
  process.stderr.write(
    `${formatDatabaseCliFailure("migrate", stage, error)}\n`,
  );
  process.exitCode = 1;
} finally {
  if (pool) {
    try {
      await pool.end();
    } catch (error) {
      process.stderr.write(
        `${formatDatabaseCliFailure("migrate", "close", error)}\n`,
      );
      process.exitCode = 1;
    }
  }
}
