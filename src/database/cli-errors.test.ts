import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  ProposalAuthorizationError,
  ProposalCredentialEligibilityError,
} from "./proposal-repository";
import {
  formatDatabaseCliFailure,
  MigrationPreconditionError,
  writeDatabaseCliFailure,
} from "./cli-errors";
import { loadMigrationConfig } from "./migration-config";

describe("database CLI errors", () => {
  it("identifies missing MCP migrations without exposing database details", () => {
    const formatted = formatDatabaseCliFailure("mcp_credential", "create", {
      code: "42P01",
      message: "relation private.mcp_credentials does not exist",
      detail: "secret database detail",
    });
    expect(formatted).toContain("code=42P01");
    expect(formatted).toContain("apply Folio migrations");
    expect(formatted).not.toContain("private");
    expect(formatted).not.toContain("secret");
  });

  it("identifies ineligible credential users without printing user data", () => {
    const formatted = formatDatabaseCliFailure(
      "mcp_credential",
      "create",
      new ProposalAuthorizationError(),
    );
    expect(formatted).toContain("code=USER_INELIGIBLE");
    expect(formatted).toContain("administrator role");
  });

  it("identifies which credential participant failed without printing its ID", () => {
    const formatted = formatDatabaseCliFailure(
      "mcp_credential",
      "create",
      new ProposalCredentialEligibilityError("actor", "not_found"),
    );
    expect(formatted).toContain("code=ACTOR_NOT_FOUND");
    expect(formatted).toContain("CLI database");
    expect(formatted).not.toContain("user-123");
  });

  it("reports only invalid field names for configuration errors", () => {
    const parsed = z
      .object({ FOLIO_DATABASE_URL: z.string().url() })
      .safeParse({
        FOLIO_DATABASE_URL: "sensitive invalid value",
      });
    if (parsed.success) throw new Error("Expected invalid fixture");
    const formatted = formatDatabaseCliFailure(
      "migrate",
      "configuration",
      parsed.error,
    );
    expect(formatted).toContain("FOLIO_DATABASE_URL");
    expect(formatted).not.toContain("sensitive invalid value");
  });

  it("sanitizes migration role and schema precondition failures", () => {
    const roleFailure = formatDatabaseCliFailure("migrate", "migration_role", {
      code: "42501",
      message: "unexpected administrator name and connection details",
    });
    const usageFailure = formatDatabaseCliFailure(
      "migrate",
      "schema_check",
      new MigrationPreconditionError("schema_usage_missing"),
    );
    const createFailure = formatDatabaseCliFailure(
      "migrate",
      "schema_check",
      new MigrationPreconditionError("schema_create_missing"),
    );
    const schemaFailure = [usageFailure, createFailure].join(" ");

    expect(roleFailure).toContain("code=42501");
    expect(roleFailure).toContain("role lacks permission");
    expect(usageFailure).toContain("code=MIGRATION_SCHEMA_USAGE");
    expect(usageFailure).toContain("requires USAGE on the schema");
    expect(createFailure).toContain("code=MIGRATION_SCHEMA_CREATE");
    expect(createFailure).toContain("requires CREATE on the schema");
    expect(`${roleFailure}\n${schemaFailure}`).not.toContain("postgres");
    expect(`${roleFailure}\n${schemaFailure}`).not.toContain("private");
  });

  it("reports the original migration configuration error", () => {
    let error: unknown;
    try {
      loadMigrationConfig({
        FOLIO_DATABASE_ADMIN_URL: "",
        FOLIO_DATABASE_SCHEMA: "folio",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TypeError);
    expect(error).toHaveProperty("message", "Invalid URL");
    expect(formatDatabaseCliFailure("migrate", "configuration", error)).toBe(
      'operation=migrate stage=configuration code=UNEXPECTED_ERROR message="Invalid URL"',
    );
  });

  it("includes unknown error messages from errors, objects, and thrown strings", () => {
    const objectError = {
      message: "Provider request failed",
      detail: "ignored provider detail",
      stack: "ignored stack",
    };
    const formattedObject = formatDatabaseCliFailure(
      "migrate",
      "configuration",
      objectError,
    );

    expect(
      formatDatabaseCliFailure(
        "migrate",
        "configuration",
        new Error("Invalid URL"),
      ),
    ).toContain('message="Invalid URL"');
    expect(formattedObject).toContain('message="Provider request failed"');
    expect(formattedObject).not.toContain("ignored provider detail");
    expect(formattedObject).not.toContain("ignored stack");
    expect(
      formatDatabaseCliFailure("migrate", "configuration", "Invalid URL"),
    ).toContain('message="Invalid URL"');
  });

  it("redacts credential and data URL secrets in unknown diagnostic messages", () => {
    const propertyMessage = formatDatabaseCliFailure(
      "migrate",
      "configuration",
      {
        message:
          "Migration rejected FOLIO_DATABASE_PASSWORD=synthetic-password while parsing data:text/plain,synthetic-inline",
      },
    );
    const thrownString = formatDatabaseCliFailure(
      "migrate",
      "configuration",
      "Database rejected password=synthetic-token while parsing data:text/plain,synthetic-inline",
    );

    for (const formatted of [propertyMessage, thrownString]) {
      expect(formatted).toContain("rejected");
      expect(formatted).toContain("[REDACTED_CREDENTIAL]");
      expect(formatted).toContain("[REDACTED_DATA_URL]");
      expect(formatted).not.toContain("synthetic-password");
      expect(formatted).not.toContain("synthetic-token");
      expect(formatted).not.toContain("synthetic-inline");
    }
  });

  it("quotes unknown messages to keep each failure on one line", () => {
    const formatted = formatDatabaseCliFailure(
      "migrate",
      "configuration",
      new Error('Unexpected "quote"\nsecond line'),
    );

    expect(formatted).toBe(
      'operation=migrate stage=configuration code=UNEXPECTED_ERROR message="Unexpected \\"quote\\"\\nsecond line"',
    );
    expect(formatted.split("\n")).toHaveLength(1);
  });

  it("uses a fallback when an unknown error has no message", () => {
    expect(
      formatDatabaseCliFailure("migrate", "configuration", new Error()),
    ).toContain('message="Unknown error"');
    expect(
      formatDatabaseCliFailure("migrate", "configuration", { message: "" }),
    ).toContain('message="Unknown error"');
    expect(
      formatDatabaseCliFailure("migrate", "configuration", undefined),
    ).toContain('message="Unknown error"');
  });

  it("does not print unrecognized database error codes but reports their message", () => {
    const formatted = formatDatabaseCliFailure("mcp_credential", "create", {
      code: "PRIVATE_PROVIDER_CODE",
      message: "private provider detail",
    });

    expect(formatted).toContain("code=UNEXPECTED_ERROR");
    expect(formatted).not.toContain("PRIVATE_PROVIDER_CODE");
    expect(formatted).toContain('message="private provider detail"');
  });

  it("writes a structured CLI failure with validated context only", () => {
    const writer = vi.fn();
    const reported = writeDatabaseCliFailure(
      new Error("postgres://private connection detail"),
      {
        operation: "mcp_credential",
        stage: "create",
        mutation: true,
        ids: {
          actorId: "11111111-1111-4111-8111-111111111111",
          credentialId: "not-a-uuid",
        },
      },
      writer,
    );

    expect(writer).toHaveBeenCalledTimes(1);
    const event = JSON.parse(writer.mock.calls[0][0] as string);
    expect(event).toMatchObject({
      event: "folio.operation",
      phase: "failure",
      operation: "mcp_credential",
      stage: "create",
      code: "UNEXPECTED_ERROR",
      actorId: "11111111-1111-4111-8111-111111111111",
      correlationId: reported.publicFailure.reference,
    });
    expect(event).not.toHaveProperty("credentialId");
    expect(JSON.stringify(event)).not.toContain("private connection detail");
  });

  it("keeps the captured diagnostic message instead of the public message", () => {
    const writer = vi.fn();
    const reported = writeDatabaseCliFailure(
      new Error("synthetic configuration parser cause"),
      { operation: "add_user", stage: "configuration", mutation: true },
      writer,
    );
    const event = JSON.parse(writer.mock.calls[0]?.[0] as string);

    expect(event.message).toBe("synthetic configuration parser cause");
    expect(event.message).not.toBe(reported.publicFailure.message);
  });

  it("reports invalid credential arguments without echoing input", () => {
    const formatted = formatDatabaseCliFailure(
      "mcp_credential",
      "arguments",
      new TypeError("Unexpected --token=secret-value"),
    );
    expect(formatted).toContain("code=INVALID_ARGUMENTS");
    expect(formatted).not.toContain("secret-value");
  });
});
