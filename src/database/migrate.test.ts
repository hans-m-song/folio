import { afterEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(async () => undefined),
  poolOptions: [] as unknown[],
}));

vi.mock("pg", () => ({
  default: {
    Pool: class {
      constructor(options: unknown) {
        database.poolOptions.push(options);
      }

      query = database.query;
      end = database.end;
    },
  },
}));

vi.mock("./migration-config", () => ({
  loadMigrationConfig: () => ({
    migrationDatabaseUrl: "postgres://migration.synthetic/folio",
    databaseSchema: "folio",
    databaseAppRole: "folio_app",
    databaseMigrationRole: "folio_migrate",
  }),
}));

vi.mock("node:fs/promises", () => ({
  readFile: async () => "SELECT synthetic_migration",
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  process.exitCode = 0;
  database.query.mockReset();
  database.end.mockClear();
  database.poolOptions.length = 0;
});

const connectedAsMigrationOwner = (statement: string) => {
  if (statement.includes("SELECT current_user AS role_name")) {
    return {
      rowCount: 1,
      rows: [
        {
          role_name: "folio_migrate",
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolbypassrls: false,
        },
      ],
    };
  }
  if (statement.includes("FROM pg_namespace")) {
    return { rowCount: 1, rows: [{ owner: "folio_migrate" }] };
  }
  if (statement.includes('"_migrations" WHERE id = $1')) {
    return { rowCount: 1, rows: [] };
  }
  return { rowCount: 1, rows: [] };
};

describe("migration runner", () => {
  it("uses the migration connection and preserves the locked, idempotent ledger", async () => {
    database.query.mockImplementation(async (statement: string) =>
      connectedAsMigrationOwner(statement),
    );
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await import("./migrate");

    const statements = database.query.mock.calls.map(([statement]) =>
      String(statement),
    );
    expect(database.poolOptions).toEqual([
      {
        connectionString: "postgres://migration.synthetic/folio",
        max: 1,
      },
    ]);
    expect(database.query).toHaveBeenCalledWith("BEGIN");
    expect(database.query).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      ["folio-migrations:folio"],
    );
    expect(statements).toContain(
      'CREATE TABLE IF NOT EXISTS "folio"."_migrations" (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    expect(
      statements.filter((statement) =>
        statement.includes('"_migrations" WHERE id = $1'),
      ),
    ).toHaveLength(18);
    expect(
      statements.some((statement) => /CREATE SCHEMA/i.test(statement)),
    ).toBe(false);
    expect(database.query).toHaveBeenCalledWith("COMMIT");
    expect(database.end).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith("Folio migrations are current.\n");
  });

  it("reports migration failures without database details and rolls back", async () => {
    database.query.mockImplementation(
      async (statement: string, values?: string[]) => {
        if (statement.includes("SELECT current_user AS role_name")) {
          return {
            rowCount: 1,
            rows: [
              {
                role_name: "folio_migrate",
                rolsuper: false,
                rolcreatedb: false,
                rolcreaterole: false,
                rolbypassrls: false,
              },
            ],
          };
        }
        if (statement.includes("FROM pg_namespace")) {
          return { rowCount: 1, rows: [{ owner: "folio_migrate" }] };
        }
        if (statement.includes('"_migrations" WHERE id = $1')) {
          return {
            rowCount: values?.[0] === "0011_folio_mcp_proposals" ? 0 : 1,
            rows: [],
          };
        }
        if (statement === "SELECT synthetic_migration")
          throw {
            code: "42P01",
            message: "relation private_data.mcp_credentials missing",
          };
        return { rowCount: 1, rows: [] };
      },
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await import("./migrate");

    const logged = stderr.mock.calls.map(([value]) => String(value)).join("");
    expect(logged).toContain("stage=migration:0011_folio_mcp_proposals");
    expect(logged).toContain("code=42P01");
    expect(logged).not.toContain("private_data");
    expect(database.query).toHaveBeenCalledWith("ROLLBACK");
    expect(database.end).toHaveBeenCalledTimes(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("rejects a connection whose current role is not the configured migrator", async () => {
    database.query.mockImplementation(async (statement: string) => {
      if (statement.includes("SELECT current_user AS role_name")) {
        return {
          rowCount: 1,
          rows: [
            {
              role_name: "postgres",
              rolsuper: false,
              rolcreatedb: false,
              rolcreaterole: false,
              rolbypassrls: false,
            },
          ],
        };
      }
      return { rowCount: 1, rows: [] };
    });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await import("./migrate");

    const logged = stderr.mock.calls.map(([value]) => String(value)).join("");
    expect(logged).toContain("stage=migration_role code=42501");
    expect(logged).not.toContain("postgres");
    expect(logged).not.toContain("postgres://");
    expect(database.query).toHaveBeenCalledWith("ROLLBACK");
    expect(
      database.query.mock.calls.some(([statement]) =>
        String(statement).includes('CREATE TABLE IF NOT EXISTS "folio".'),
      ),
    ).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it.each(["rolsuper", "rolcreatedb", "rolcreaterole", "rolbypassrls"])(
    "rejects a configured role with %s enabled",
    async (attribute) => {
      database.query.mockImplementation(async (statement: string) => {
        if (statement.includes("SELECT current_user AS role_name")) {
          return {
            rowCount: 1,
            rows: [
              {
                role_name: "folio_migrate",
                rolsuper: false,
                rolcreatedb: false,
                rolcreaterole: false,
                rolbypassrls: false,
                [attribute]: true,
              },
            ],
          };
        }
        return { rowCount: 1, rows: [] };
      });
      const stderr = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      await import("./migrate");

      const logged = stderr.mock.calls.map(([value]) => String(value)).join("");
      expect(logged).toContain("stage=migration_role code=42501");
      expect(logged).not.toContain(attribute);
      expect(database.query).toHaveBeenCalledWith("ROLLBACK");
      expect(
        database.query.mock.calls.some(([statement]) =>
          String(statement).includes('CREATE TABLE IF NOT EXISTS "folio".'),
        ),
      ).toBe(false);
      expect(process.exitCode).toBe(1);
    },
  );

  it("requires an existing schema owned by the configured migrator", async () => {
    database.query.mockImplementation(async (statement: string) => {
      if (statement.includes("SELECT current_user AS role_name")) {
        return {
          rowCount: 1,
          rows: [
            {
              role_name: "folio_migrate",
              rolsuper: false,
              rolcreatedb: false,
              rolcreaterole: false,
              rolbypassrls: false,
            },
          ],
        };
      }
      if (statement.includes("FROM pg_namespace")) {
        return { rowCount: 1, rows: [{ owner: "database_admin" }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await import("./migrate");

    const logged = stderr.mock.calls.map(([value]) => String(value)).join("");
    expect(logged).toContain("stage=schema_check code=MIGRATION_SCHEMA_OWNER");
    expect(logged).not.toContain("database_admin");
    expect(database.query).toHaveBeenCalledWith("ROLLBACK");
    expect(
      database.query.mock.calls.some(([statement]) =>
        String(statement).includes('CREATE TABLE IF NOT EXISTS "folio".'),
      ),
    ).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("fails closed when a relation or routine in the schema has another owner", async () => {
    database.query.mockImplementation(async (statement: string) => {
      if (statement.includes("SELECT current_user AS role_name")) {
        return {
          rowCount: 1,
          rows: [
            {
              role_name: "folio_migrate",
              rolsuper: false,
              rolcreatedb: false,
              rolcreaterole: false,
              rolbypassrls: false,
            },
          ],
        };
      }
      if (statement.includes("FROM pg_namespace")) {
        return { rowCount: 1, rows: [{ owner: "folio_migrate" }] };
      }
      if (statement.includes("FROM pg_class AS relation")) {
        return { rowCount: 1, rows: [{ has_unowned_objects: true }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await import("./migrate");

    const logged = stderr.mock.calls.map(([value]) => String(value)).join("");
    const statements = database.query.mock.calls.map(([statement]) =>
      String(statement),
    );
    expect(logged).toContain("stage=ownership code=42501");
    expect(logged).not.toContain("old_owner");
    expect(logged).not.toContain("private_relation");
    expect(
      statements.some((statement) => statement.includes("FROM pg_proc")),
    ).toBe(true);
    expect(database.query).toHaveBeenCalledWith("ROLLBACK");
    expect(
      statements.some((statement) =>
        statement.includes('CREATE TABLE IF NOT EXISTS "folio".'),
      ),
    ).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("rejects a missing schema instead of creating it", async () => {
    database.query.mockImplementation(async (statement: string) => {
      if (statement.includes("SELECT current_user AS role_name")) {
        return {
          rowCount: 1,
          rows: [
            {
              role_name: "folio_migrate",
              rolsuper: false,
              rolcreatedb: false,
              rolcreaterole: false,
              rolbypassrls: false,
            },
          ],
        };
      }
      if (statement.includes("FROM pg_namespace")) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await import("./migrate");

    const logged = stderr.mock.calls.map(([value]) => String(value)).join("");
    expect(logged).toContain("stage=schema_check code=MIGRATION_SCHEMA");
    expect(database.query).toHaveBeenCalledWith("ROLLBACK");
    expect(
      database.query.mock.calls.some(([statement]) =>
        String(statement).includes('CREATE TABLE IF NOT EXISTS "folio".'),
      ),
    ).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});
