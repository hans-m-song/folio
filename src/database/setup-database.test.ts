import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readSetupSources = async () => {
  const [setupSql, upgradeSql, shell, compose] = await Promise.all([
    readFile(new URL("../../ops/setup-database.sql", import.meta.url), "utf8"),
    readFile(
      new URL("../../ops/upgrade-database-owner.sql", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../../ops/setup-database.sh", import.meta.url), "utf8"),
    readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8"),
  ]);

  return { setupSql, upgradeSql, shell, compose };
};

describe("database setup sources", () => {
  it("keeps fresh bootstrap fixed, transactional, and compact", async () => {
    const { setupSql, shell } = await readSetupSources();

    expect(setupSql.match(/\bCREATE ROLE\b/g)).toHaveLength(2);
    expect(setupSql).toContain("CREATE ROLE folio_app");
    expect(setupSql).toContain("CREATE ROLE folio_admin");
    expect(setupSql).toContain("CREATE SCHEMA folio;");
    expect(setupSql).not.toContain("CREATE SCHEMA folio AUTHORIZATION");
    expect(setupSql).toContain("PASSWORD :'folio_app_password'");
    expect(setupSql).toContain("PASSWORD :'folio_admin_password'");
    expect(setupSql).not.toMatch(
      /\bALTER ROLE\b|\bpg_roles\b|\bpg_auth_members\b/,
    );
    expect(setupSql).not.toContain("FOLIO_DATABASE_SCHEMA");
    expect(setupSql).not.toContain("FOLIO_DATABASE_TRANSFER_OWNERSHIP");
    expect(shell.split("\n").length).toBeLessThanOrEqual(30);
  });

  it("uses the migration lock and never passes or echoes password values", async () => {
    const { setupSql, upgradeSql, shell } = await readSetupSources();

    for (const sql of [setupSql, upgradeSql]) {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("hashtext('folio-migrations:folio')");
      expect(sql).toContain("COMMIT;");
      expect(sql).toContain("\\set ECHO none");
      expect(sql).toContain("\\set VERBOSITY terse");
      expect(sql).toContain("\\set SHOW_CONTEXT never");
    }

    expect(setupSql).toContain(
      "\\getenv folio_app_password FOLIO_DATABASE_APP_PASSWORD",
    );
    expect(setupSql).toContain(
      "\\getenv folio_admin_password FOLIO_DATABASE_ADMIN_PASSWORD",
    );
    expect(shell).not.toMatch(/--set(?:=|\s+).*(?:app|migration).*password/i);
    expect(shell).not.toMatch(
      /(?:printf|echo)[^\n]*\$(?:\{)?FOLIO_DATABASE_.*PASSWORD/i,
    );
  });

  it("creates the runtime role with limited access and administrator-owned defaults", async () => {
    const { setupSql } = await readSetupSources();

    expect(
      setupSql.match(/LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE/g),
    ).toHaveLength(2);
    expect(setupSql.match(/NOREPLICATION NOBYPASSRLS NOINHERIT/g)).toHaveLength(
      2,
    );
    expect(setupSql).toContain("REVOKE CREATE ON SCHEMA folio FROM PUBLIC");
    expect(setupSql).toContain("REVOKE CREATE ON SCHEMA folio FROM folio_app");
    expect(setupSql).toContain("GRANT USAGE ON SCHEMA folio TO folio_app");
    expect(setupSql).toContain("REVOKE CREATE ON DATABASE %I FROM folio_app");
    expect(setupSql).toContain("GRANT SELECT ON TABLES TO folio_app");
    expect(setupSql).toContain("GRANT USAGE, SELECT ON SEQUENCES TO folio_app");
    expect(setupSql).toContain("GRANT EXECUTE ON FUNCTIONS TO folio_app");
    expect(setupSql).toContain("REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC");
    expect(setupSql).toContain(
      "GRANT USAGE, CREATE ON SCHEMA folio TO folio_admin",
    );
    expect(setupSql).toContain(
      "GRANT folio_admin TO SESSION_USER WITH SET TRUE",
    );
    expect(setupSql).toContain("SET LOCAL ROLE folio_admin");
    expect(setupSql).toContain("RESET ROLE");
    expect(setupSql).toContain("REVOKE folio_admin FROM SESSION_USER");
    expect(setupSql).not.toContain("GRANTED BY");
  });

  it("supports the optional manual administrator wrapper with connection fallbacks", async () => {
    const { shell } = await readSetupSources();

    const wrapper = await stat(
      new URL("../../ops/setup-database.sh", import.meta.url),
    );
    expect(wrapper.mode & 0o111).not.toBe(0);

    expect(shell).toContain('[ "$#" -eq 0 ]');
    expect(shell).toContain("${PGUSER:-${POSTGRES_USER:-}}");
    expect(shell).toContain("${PGDATABASE:-${POSTGRES_DB:-}}");
    expect(shell).toContain("/opt/folio/setup-database.sql");
    expect(shell).toContain("--no-psqlrc");
    expect(shell).toContain("FOLIO_DATABASE_APP_PASSWORD");
    expect(shell).toContain("FOLIO_DATABASE_ADMIN_PASSWORD");
    expect(shell).not.toContain("--username)");
  });

  it("keeps database setup manual and migrations in their separate service", async () => {
    const { compose } = await readSetupSources();
    const postgresService = compose.match(
      /^ {2}postgres:\n([\s\S]*?)(?=^ {2}[a-z][a-z0-9_-]*:\n|^networks:)/m,
    )?.[1];
    const migrationService = compose.match(
      /^ {2}folio-migrate:\n([\s\S]*?)(?=^ {2}[a-z][a-z0-9_-]*:\n|^networks:)/m,
    )?.[1];

    expect(compose).not.toMatch(/setup-database\.(?:sh|sql)\s*:/i);
    expect(compose).not.toContain("docker-entrypoint-initdb.d");
    expect(postgresService).toBeDefined();
    expect(postgresService).not.toMatch(/^[ \t]*-[ \t]*\.env\.migrate[ \t]*$/m);
    expect(migrationService).toContain("node src/database/migrate.mjs");
  });

  it("guards and renames the existing migration role in the one-time upgrade", async () => {
    const { upgradeSql } = await readSetupSources();

    expect(upgradeSql).toContain(
      "\\getenv folio_upgrade_password FOLIO_DATABASE_ADMIN_PASSWORD",
    );
    expect(upgradeSql).toContain(
      "ALTER ROLE folio_migrate RENAME TO folio_admin",
    );
    expect(upgradeSql).toContain("\\if :folio_has_migrate");
    expect(upgradeSql).toContain("CREATE ROLE folio_admin");
    expect(upgradeSql).toContain("PASSWORD :'folio_upgrade_password'");
    expect(
      upgradeSql.indexOf("length(:'folio_upgrade_password') > 0"),
    ).toBeLessThan(upgradeSql.indexOf("ALTER ROLE folio_app"));
    expect(upgradeSql).toContain("rolsuper OR rolcreatedb OR rolcreaterole");
    expect(upgradeSql).toContain("pg_catalog.pg_auth_members");
    expect(upgradeSql).toContain(
      "folio_app or folio_migrate has role memberships",
    );
    expect(upgradeSql).not.toContain("FOLIO_DATABASE_APP_PASSWORD");
    expect(upgradeSql).not.toMatch(/\bREASSIGN\s+OWNED\b/i);
  });

  it("limits upgrade ownership changes and default repairs to Folio objects", async () => {
    const { upgradeSql } = await readSetupSources();

    expect(upgradeSql).toContain("n.nspname = 'folio'");
    expect(upgradeSql).toContain("c.relkind IN ('r', 'p')");
    expect(upgradeSql).toContain("c.relkind = 'S'");
    expect(upgradeSql).toContain("p.prokind = 'f'");
    expect(upgradeSql).not.toContain("pg_catalog.pg_type");
    expect(upgradeSql).not.toMatch(
      /relkind IN \([^)]*'v'|relkind IN \([^)]*'m'/,
    );
    expect(upgradeSql).toContain("REVOKE ALL ON TABLES FROM folio_app");
    expect(upgradeSql).toContain("REVOKE ALL ON SEQUENCES FROM folio_app");
    expect(upgradeSql).toContain("REVOKE EXECUTE ON FUNCTIONS FROM folio_app");
    expect(upgradeSql).toContain("GRANT SELECT ON TABLES TO folio_app");
    expect(upgradeSql).toContain(
      "GRANT USAGE, SELECT ON SEQUENCES TO folio_app",
    );
    expect(upgradeSql).toContain("GRANT EXECUTE ON FUNCTIONS TO folio_app");
  });
});
