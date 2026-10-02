import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ProposalAuthorizationError,
  ProposalCredentialEligibilityError,
} from "./proposal-repository";
import { formatDatabaseCliFailure } from "./cli-errors";

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

  it("keeps unknown error messages out of output", () => {
    const formatted = formatDatabaseCliFailure(
      "migrate",
      "migration:0011_folio_mcp_proposals",
      new Error("postgres://secret@private.example/database"),
    );
    expect(formatted).toContain("code=UNEXPECTED_ERROR");
    expect(formatted).not.toContain("secret");
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
