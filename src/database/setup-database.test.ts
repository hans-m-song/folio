import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readSetupSources = async () => {
  const [sql, shell] = await Promise.all([
    readFile(new URL("../../ops/setup-database.sql", import.meta.url), "utf8"),
    readFile(new URL("../../ops/setup-database.sh", import.meta.url), "utf8"),
  ]);

  return { sql, shell };
};

describe("administrative database setup sources", () => {
  it("reads setup configuration from the environment and validates names", async () => {
    const { sql } = await readSetupSources();

    expect(sql).toContain("\\getenv folio_setup_schema FOLIO_DATABASE_SCHEMA");
    expect(sql).toContain(
      "\\getenv folio_setup_app_role FOLIO_DATABASE_APP_ROLE",
    );
    expect(sql).toContain(
      "\\getenv folio_setup_migration_role FOLIO_DATABASE_MIGRATION_ROLE",
    );
    expect(sql).toContain(
      "\\getenv folio_setup_app_password FOLIO_DATABASE_APP_PASSWORD",
    );
    expect(sql).toContain(
      "\\getenv folio_setup_migration_password FOLIO_DATABASE_MIGRATION_PASSWORD",
    );
    expect(sql).toContain(
      "setup_config.schema_name !~ '^[a-z][a-z0-9_]{0,62}$'",
    );
    expect(sql).toContain(
      "setup_config.app_role_name = setup_config.migration_role_name",
    );
  });

  it("fails closed for privileged roles and app membership in the migration role", async () => {
    const { sql } = await readSetupSources();

    expect(sql).toContain("role_record.rolsuper");
    expect(sql).toContain("role_record.rolcreatedb");
    expect(sql).toContain("role_record.rolcreaterole");
    expect(sql).toContain("role_record.rolreplication");
    expect(sql).toContain("role_record.rolbypassrls");
    expect(sql).toContain("pg_catalog.pg_auth_members AS membership_record");
    expect(sql).toContain(
      "membership_record.roleid IN (app_role_oid, migration_role_oid)",
    );
    expect(sql).toContain(
      "membership_record.member IN (app_role_oid, migration_role_oid)",
    );
    expect(sql).toContain("application or migration role has role memberships");
    expect(sql).not.toMatch(/\b(?:GRANT|REVOKE)\s+[^;]*\bROLE\b/i);
  });

  it("serializes schema-scoped setup and keeps ownership transfer scoped", async () => {
    const { sql } = await readSetupSources();

    expect(sql).toContain("BEGIN;");
    expect(sql).toContain(
      "pg_advisory_xact_lock(\n  pg_catalog.hashtext('folio-migrations:'",
    );
    expect(sql).toContain("FOLIO_DATABASE_TRANSFER_OWNERSHIP=true");
    expect(sql).toContain("pg_catalog.pg_class");
    expect(sql).toContain("pg_catalog.pg_proc");
    expect(sql).toContain("pg_catalog.pg_type");
    expect(sql).toContain(
      "relation_record.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')",
    );
    expect(sql).toContain("routine_record.prokind IN ('f', 'p', 'a', 'w')");
    expect(sql).not.toMatch(/\bREASSIGN\s+OWNED\b/i);
    expect(sql).toContain("COMMIT;");
  });

  it("applies read-only app defaults and removes public schema and function access", async () => {
    const { sql } = await readSetupSources();

    expect(sql).toContain("application role owns the current database");
    expect(sql).toContain("REVOKE CREATE ON DATABASE %I FROM %I");
    expect(sql).toContain("REVOKE CREATE ON SCHEMA");
    expect(sql).toContain("GRANT USAGE ON SCHEMA");
    expect(sql).toContain("GRANT SELECT ON TABLES TO %I");
    expect(sql).toContain("GRANT USAGE, SELECT ON SEQUENCES TO %I");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTIONS TO %I");
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC");
    expect(sql.split("REVOKE ALL ON TABLES FROM %I").length - 1).toBe(2);
    expect(sql.split("REVOKE ALL ON SEQUENCES FROM %I").length - 1).toBe(2);
    expect(sql.split("REVOKE EXECUTE ON FUNCTIONS FROM %I").length - 1).toBe(2);
  });

  it("requires passwords without placing them in psql arguments or output", async () => {
    const { shell } = await readSetupSources();

    expect(shell).toContain("FOLIO_DATABASE_APP_PASSWORD is required.");
    expect(shell).toContain("FOLIO_DATABASE_MIGRATION_PASSWORD is required.");
    expect(shell).toContain("--no-psqlrc");
    expect(shell).toContain("--username");
    expect(shell).toContain("POSTGRES_USER");
    expect(shell).toContain("POSTGRES_DB");
    expect(shell).toContain("/opt/folio/setup-database.sql");
    expect(shell).not.toMatch(/--set(?:=|\s+)(?:app|migration)_password/i);
    expect(shell).not.toMatch(
      /(?:printf|echo)[^\n]*\$(?:\{)?FOLIO_DATABASE_(?:APP|MIGRATION)_PASSWORD/i,
    );
    expect(shell).not.toContain("set -x");
  });

  it("suppresses psql query and contextual diagnostics", async () => {
    const { sql } = await readSetupSources();

    expect(sql).toContain("\\set ECHO none");
    expect(sql).toContain("\\set VERBOSITY terse");
    expect(sql).toContain("\\set SHOW_CONTEXT never");
  });
});
