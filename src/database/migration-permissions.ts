import type { MigrationConfig } from "./migration-config";

type QueryExecutor = {
  query: (statement: string) => Promise<unknown>;
};

type RuntimePermissionConfig = Pick<
  MigrationConfig,
  "databaseSchema" | "databaseAppRole" | "databaseMigrationRole"
>;

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

const runtimeTableGrants = [
  { privileges: "SELECT, INSERT, UPDATE", tables: ["users", "auth_sessions"] },
  { privileges: "SELECT, INSERT, UPDATE, DELETE", tables: ["transactions"] },
  {
    privileges: "SELECT, INSERT, UPDATE, DELETE",
    tables: ["source_artifacts"],
  },
  {
    privileges: "SELECT, INSERT, UPDATE, DELETE",
    tables: ["transaction_artifacts"],
  },
  { privileges: "SELECT, INSERT, UPDATE", tables: ["bank_transactions"] },
  {
    privileges: "SELECT, INSERT",
    tables: ["bank_transaction_artifacts"],
  },
  { privileges: "SELECT, INSERT, DELETE", tables: ["auth_attempts"] },
  { privileges: "SELECT, INSERT, UPDATE", tables: ["mcp_credentials"] },
  {
    privileges: "SELECT, INSERT, UPDATE, DELETE",
    tables: ["mcp_submissions"],
  },
  { privileges: "SELECT, INSERT", tables: ["mcp_upload_intents"] },
  { privileges: "SELECT, INSERT", tables: ["tax_review_snapshots"] },
  {
    privileges: "SELECT, INSERT, UPDATE",
    tables: ["recurring_bill_schedules"],
  },
  { privileges: "SELECT, INSERT, DELETE", tables: ["recurring_bill_links"] },
] as const;

export const applyRuntimePermissions = async (
  database: QueryExecutor,
  config: RuntimePermissionConfig,
) => {
  const schema = quoteIdentifier(config.databaseSchema);
  const appRole = quoteIdentifier(config.databaseAppRole);
  const migrationRole = quoteIdentifier(config.databaseMigrationRole);

  await database.query(
    `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schema} FROM ${appRole}`,
  );
  await database.query(
    `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${appRole}`,
  );
  await database.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migrationRole} IN SCHEMA ${schema} REVOKE ALL ON TABLES FROM ${appRole}`,
  );
  await database.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migrationRole} IN SCHEMA ${schema} GRANT SELECT ON TABLES TO ${appRole}`,
  );

  for (const grant of runtimeTableGrants) {
    const tables = grant.tables
      .map((table) => `${schema}.${quoteIdentifier(table)}`)
      .join(", ");
    await database.query(
      `GRANT ${grant.privileges} ON TABLE ${tables} TO ${appRole}`,
    );
  }

  await database.query(
    `GRANT SELECT ON TABLE ${schema}."_migrations" TO ${appRole}`,
  );
  await database.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${appRole}`,
  );
};
