import { describe, expect, it, vi } from "vitest";

import { applyRuntimePermissions } from "./migration-permissions";

const config = {
  databaseSchema: "folio_test",
  databaseAppRole: "folio_app",
  databaseMigrationRole: "folio_migrate",
};

describe("migration runtime permissions", () => {
  it("resets and reapplies the exact application table privileges", async () => {
    const query = vi.fn(async (_statement: string) => ({
      rows: [],
      rowCount: 0,
    }));

    await applyRuntimePermissions({ query }, config);

    const statements = query.mock.calls.map(([statement]) => String(statement));
    const tableGrants = statements.filter(
      (statement) =>
        statement.startsWith("GRANT ") && statement.includes(" ON TABLE "),
    );
    expect(statements).toContain(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "folio_test" FROM "folio_app"',
    );
    expect(tableGrants).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON TABLE "folio_test"."users", "folio_test"."auth_sessions" TO "folio_app"',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "folio_test"."transactions" TO "folio_app"',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "folio_test"."source_artifacts" TO "folio_app"',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "folio_test"."transaction_artifacts" TO "folio_app"',
      'GRANT SELECT, INSERT, UPDATE ON TABLE "folio_test"."bank_transactions" TO "folio_app"',
      'GRANT SELECT, INSERT ON TABLE "folio_test"."bank_transaction_artifacts" TO "folio_app"',
      'GRANT SELECT, INSERT, DELETE ON TABLE "folio_test"."auth_attempts" TO "folio_app"',
      'GRANT SELECT, INSERT, UPDATE ON TABLE "folio_test"."mcp_credentials" TO "folio_app"',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "folio_test"."mcp_submissions" TO "folio_app"',
      'GRANT SELECT, INSERT ON TABLE "folio_test"."mcp_upload_intents" TO "folio_app"',
      'GRANT SELECT, INSERT ON TABLE "folio_test"."tax_review_snapshots" TO "folio_app"',
      'GRANT SELECT, INSERT, UPDATE ON TABLE "folio_test"."recurring_bill_schedules" TO "folio_app"',
      'GRANT SELECT, INSERT, DELETE ON TABLE "folio_test"."recurring_bill_links" TO "folio_app"',
      'GRANT SELECT ON TABLE "folio_test"."_migrations" TO "folio_app"',
    ]);
  });

  it("keeps schema usage, sequence access, and future table defaults narrow", async () => {
    const query = vi.fn(async (_statement: string) => ({
      rows: [],
      rowCount: 0,
    }));

    await applyRuntimePermissions({ query }, config);

    const statements = query.mock.calls.map(([statement]) => String(statement));
    expect(statements).toContain(
      'REVOKE CREATE ON SCHEMA "folio_test" FROM PUBLIC',
    );
    expect(statements).toContain(
      'REVOKE CREATE ON SCHEMA "folio_test" FROM "folio_app"',
    );
    expect(statements).toContain(
      'GRANT USAGE ON SCHEMA "folio_test" TO "folio_app"',
    );
    expect(statements).toContain(
      'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "folio_test" FROM "folio_app"',
    );
    expect(statements).toContain(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "folio_test" TO "folio_app"',
    );
    expect(statements).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE "folio_migrate" IN SCHEMA "folio_test" REVOKE ALL ON TABLES FROM "folio_app"',
    );
    expect(statements).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE "folio_migrate" IN SCHEMA "folio_test" GRANT SELECT ON TABLES TO "folio_app"',
    );
    expect(statements.some((statement) => statement.includes("SET ROLE"))).toBe(
      false,
    );
  });
});
