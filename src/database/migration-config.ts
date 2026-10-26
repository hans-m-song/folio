import { parseWithDiagnostics } from "../domain/validation-diagnostics";
import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

const migrationConfigSchema = z
  .object({
    FOLIO_DATABASE_ADMIN_URL: z
      .string()
      .url()
      .refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === "postgres:" || protocol === "postgresql:";
      }, "Expected a PostgreSQL connection URL"),
    FOLIO_DATABASE_SCHEMA: identifier,
    FOLIO_DATABASE_APP_ROLE: identifier.default("folio_app"),
    FOLIO_DATABASE_ADMIN_ROLE: identifier.default("folio_admin"),
  })
  .superRefine((value, context) => {
    if (value.FOLIO_DATABASE_APP_ROLE === value.FOLIO_DATABASE_ADMIN_ROLE) {
      context.addIssue({
        code: "custom",
        path: ["FOLIO_DATABASE_ADMIN_ROLE"],
        message: "Migration and application roles must be different",
      });
    }
  });

export type MigrationConfig = ReturnType<typeof loadMigrationConfig>;

export const loadMigrationConfig = (
  environment: Record<string, string | undefined>,
) => {
  const value = parseWithDiagnostics(migrationConfigSchema, environment);

  return Object.freeze({
    databaseAdminRole: value.FOLIO_DATABASE_ADMIN_ROLE,
    databaseAdminUrl: value.FOLIO_DATABASE_ADMIN_URL,
    databaseAppRole: value.FOLIO_DATABASE_APP_ROLE,
    databaseSchema: value.FOLIO_DATABASE_SCHEMA,
  });
};
