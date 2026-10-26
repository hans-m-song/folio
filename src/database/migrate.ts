import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

import {
  formatDatabaseCliFailure,
  MigrationPreconditionError,
} from "./cli-errors";
import { loadMigrationConfig } from "./migration-config";
import { applyRuntimePermissions } from "./migration-permissions";
import { requiredMigrationIds } from "./migrations";

let stage = "configuration";
let pool: pg.Pool | undefined;
let transactionOpen = false;
try {
  const config = loadMigrationConfig(process.env);
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
  pool = new pg.Pool({
    connectionString: config.databaseAdminUrl,
    max: 1,
  });
  stage = "begin";
  await pool.query("BEGIN");
  transactionOpen = true;
  stage = "migration_lock";
  await pool.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `folio-migrations:${config.databaseSchema}`,
  ]);
  stage = "migration_role";
  const identity = await pool.query<{
    role_name: string;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolbypassrls: boolean;
  }>(
    `SELECT current_user AS role_name, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
    FROM pg_roles
    WHERE rolname = current_user`,
  );
  const role = identity.rows[0];
  if (
    !role ||
    role.role_name !== config.databaseAdminRole ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolbypassrls
  ) {
    throw Object.assign(new Error(), { code: "42501" });
  }
  stage = "schema_check";
  const schema = await pool.query<{
    has_usage: boolean;
    has_create: boolean;
  }>(
    `SELECT
      has_schema_privilege(current_user, namespace.oid, 'USAGE') AS has_usage,
      has_schema_privilege(current_user, namespace.oid, 'CREATE') AS has_create
    FROM pg_namespace AS namespace
    WHERE namespace.nspname = $1`,
    [config.databaseSchema],
  );
  if (schema.rowCount === 0) {
    throw new MigrationPreconditionError("schema_missing");
  }
  if (!schema.rows[0]?.has_usage)
    throw new MigrationPreconditionError("schema_usage_missing");
  if (!schema.rows[0]?.has_create)
    throw new MigrationPreconditionError("schema_create_missing");
  stage = "ownership";
  const ownership = await pool.query<{ has_unowned_objects: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = $1
        AND relation.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
      UNION ALL
      SELECT 1
      FROM pg_proc AS routine
      JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = $1
        AND routine.proowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
    ) AS has_unowned_objects`,
    [config.databaseSchema],
  );
  if (ownership.rows[0]?.has_unowned_objects) {
    throw Object.assign(new Error(), { code: "42501" });
  }
  stage = "schema_setup";
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
  await applyRuntimePermissions(pool, config);
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
