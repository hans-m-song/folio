import { describe, expect, it } from "vitest";

import { formatDatabaseCliFailure } from "./cli-errors";
import { loadMigrationConfig } from "./migration-config";

const valid = {
  FOLIO_DATABASE_ADMIN_URL:
    "postgresql://folio_admin:synthetic@localhost/folio",
  FOLIO_DATABASE_SCHEMA: "folio_test",
};

describe("migration configuration", () => {
  it("loads only the dedicated migration connection and applies role defaults", () => {
    expect(loadMigrationConfig(valid)).toEqual({
      databaseAdminUrl: valid.FOLIO_DATABASE_ADMIN_URL,
      databaseSchema: "folio_test",
      databaseAppRole: "folio_app",
      databaseAdminRole: "folio_admin",
    });
  });

  it("does not fall back to the application connection URL", () => {
    expect(() =>
      loadMigrationConfig({
        FOLIO_DATABASE_URL: "postgres://app:synthetic@localhost/folio",
        FOLIO_DATABASE_SCHEMA: "folio_test",
      }),
    ).toThrow();
  });

  it("accepts only PostgreSQL URL protocols", () => {
    expect(() =>
      loadMigrationConfig({
        ...valid,
        FOLIO_DATABASE_ADMIN_URL: "https://db.example/folio",
      }),
    ).toThrow();
    expect(() =>
      loadMigrationConfig({
        ...valid,
        FOLIO_DATABASE_ADMIN_URL: "sqlite://localhost/folio",
      }),
    ).toThrow();
  });

  it("does not expose an invalid connection URL in the migration diagnostic", () => {
    let failure: unknown;
    try {
      loadMigrationConfig({
        ...valid,
        FOLIO_DATABASE_ADMIN_URL:
          "https://synthetic-secret@private.example/folio",
      });
    } catch (error) {
      failure = error;
    }

    const formatted = formatDatabaseCliFailure(
      "migrate",
      "configuration",
      failure,
    );
    expect(formatted).toContain("FOLIO_DATABASE_ADMIN_URL");
    expect(formatted).not.toContain("synthetic-secret");
    expect(formatted).not.toContain("private.example");
  });

  it("validates the schema and distinct application and migration roles", () => {
    expect(() =>
      loadMigrationConfig({ ...valid, FOLIO_DATABASE_SCHEMA: "public;drop" }),
    ).toThrow();
    expect(() =>
      loadMigrationConfig({
        ...valid,
        FOLIO_DATABASE_APP_ROLE: "folio_admin",
      }),
    ).toThrow("roles must be different");
  });

  it("allows explicit role names", () => {
    expect(
      loadMigrationConfig({
        ...valid,
        FOLIO_DATABASE_APP_ROLE: "folio_runtime",
        FOLIO_DATABASE_ADMIN_ROLE: "folio_schema_owner",
      }),
    ).toMatchObject({
      databaseAppRole: "folio_runtime",
      databaseAdminRole: "folio_schema_owner",
    });
  });
});
