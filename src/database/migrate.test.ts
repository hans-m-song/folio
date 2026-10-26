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
    databaseAdminUrl: "postgres://migration.synthetic/folio",
    databaseSchema: "folio",
    databaseAppRole: "folio_app",
    databaseAdminRole: "folio_admin",
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

const connectedAsMigrationRole = (statement: string) => {
  if (statement.includes("SELECT current_user AS role_name")) {
    return {
      rowCount: 1,
      rows: [
        {
          role_name: "folio_admin",
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolbypassrls: false,
        },
      ],
    };
  }
  if (statement.includes("FROM pg_namespace")) {
    return { rowCount: 1, rows: [{ has_usage: true, has_create: true }] };
  }
  if (statement.includes('"_migrations" WHERE id = $1')) {
    return { rowCount: 1, rows: [] };
  }
  return { rowCount: 1, rows: [] };
};

describe("migration runner", () => {
  it("accepts an administrator-owned schema with migration-role USAGE and CREATE", async () => {
    database.query.mockImplementation(async (statement: string) =>
      connectedAsMigrationRole(statement),
    );
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await import("./migrate");

    const statements = database.query.mock.calls.map(([statement]) =>
      String(statement),
    );
    expect(
      statements.some((statement) =>
        statement.includes(
          "has_schema_privilege(current_user, namespace.oid, 'USAGE')",
        ),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes(
          "has_schema_privilege(current_user, namespace.oid, 'CREATE')",
        ),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        /pg_get_userbyid|nspowner/.test(statement),
      ),
    ).toBe(false);
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
    ).toHaveLength(22);
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
                role_name: "folio_admin",
                rolsuper: false,
                rolcreatedb: false,
                rolcreaterole: false,
                rolbypassrls: false,
              },
            ],
          };
        }
        if (statement.includes("FROM pg_namespace")) {
          return {
            rowCount: 1,
            rows: [{ has_usage: true, has_create: true }],
          };
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
                role_name: "folio_admin",
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

  it.each([
    {
      privilege: "USAGE",
      has_usage: false,
      has_create: true,
      code: "MIGRATION_SCHEMA_USAGE",
    },
    {
      privilege: "CREATE",
      has_usage: true,
      has_create: false,
      code: "MIGRATION_SCHEMA_CREATE",
    },
  ])(
    "rejects an administrator-owned schema when the migration role lacks $privilege",
    async ({ privilege, has_usage, has_create, code }) => {
      database.query.mockImplementation(async (statement: string) => {
        if (statement.includes("SELECT current_user AS role_name")) {
          return {
            rowCount: 1,
            rows: [
              {
                role_name: "folio_admin",
                rolsuper: false,
                rolcreatedb: false,
                rolcreaterole: false,
                rolbypassrls: false,
              },
            ],
          };
        }
        if (statement.includes("FROM pg_namespace")) {
          return { rowCount: 1, rows: [{ has_usage, has_create }] };
        }
        return { rowCount: 1, rows: [] };
      });
      const stderr = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      await import("./migrate");

      const logged = stderr.mock.calls.map(([value]) => String(value)).join("");
      expect(logged).toContain(`stage=schema_check code=${code}`);
      expect(logged).toContain(`requires ${privilege} on the schema`);
      expect(logged).not.toContain("database_admin");
      expect(database.query).toHaveBeenCalledWith("ROLLBACK");
      expect(
        database.query.mock.calls.some(([statement]) =>
          String(statement).includes('CREATE TABLE IF NOT EXISTS "folio".'),
        ),
      ).toBe(false);
      expect(process.exitCode).toBe(1);
    },
  );

  it("fails closed when a relation or routine in the schema has another owner", async () => {
    database.query.mockImplementation(async (statement: string) => {
      if (statement.includes("SELECT current_user AS role_name")) {
        return {
          rowCount: 1,
          rows: [
            {
              role_name: "folio_admin",
              rolsuper: false,
              rolcreatedb: false,
              rolcreaterole: false,
              rolbypassrls: false,
            },
          ],
        };
      }
      if (statement.includes("FROM pg_namespace")) {
        return { rowCount: 1, rows: [{ has_usage: true, has_create: true }] };
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
              role_name: "folio_admin",
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
