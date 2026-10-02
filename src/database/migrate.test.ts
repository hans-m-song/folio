import { afterEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(async () => undefined),
}));

vi.mock("pg", () => ({
  default: {
    Pool: class {
      query = database.query;
      end = database.end;
    },
  },
}));

vi.mock("../config", () => ({
  loadConfig: () => ({
    databaseUrl: "postgres://synthetic.invalid/folio",
    databaseSchema: "folio",
    databaseAppRole: "folio_app",
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
});

describe("migration CLI error reporting", () => {
  it("grants draft deletion without granting deletion of users or sessions", async () => {
    database.query.mockResolvedValue({ rowCount: 1 });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await import("./migrate");

    const statements = database.query.mock.calls.map(([statement]) =>
      String(statement),
    );
    expect(statements).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "folio"."transactions" TO "folio_app"',
    );
    expect(statements).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "folio"."mcp_submissions" TO "folio_app"',
    );
    expect(statements).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE "folio"."users", "folio"."auth_sessions" TO "folio_app"',
    );
    expect(statements).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE "folio"."recurring_bill_schedules" TO "folio_app"',
    );
    expect(statements).toContain(
      'GRANT SELECT, INSERT, DELETE ON TABLE "folio"."recurring_bill_links" TO "folio_app"',
    );
    expect(statements).not.toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "folio"."recurring_bill_schedules" TO "folio_app"',
    );
    expect(database.query).toHaveBeenCalledWith("COMMIT");
  });

  it("reports the failing migration and safe database code, then rolls back", async () => {
    database.query.mockImplementation(
      async (statement: string, values?: string[]) => {
        if (statement.includes("SELECT 1 FROM"))
          return {
            rowCount: values?.[0] === "0011_folio_mcp_proposals" ? 0 : 1,
          };
        if (statement === "SELECT synthetic_migration")
          throw {
            code: "42P01",
            message: "relation private_data.mcp_credentials missing",
          };
        return { rowCount: 1 };
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
});
