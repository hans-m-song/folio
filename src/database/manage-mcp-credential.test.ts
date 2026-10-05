import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  credentialScopeHelp,
  generateCredentialSecret,
  parseCredentialCommand,
  runManageMcpCredential,
} from "./manage-mcp-credential";

const administratorId = "11111111-1111-4111-8111-111111111111";
const actorUserId = "22222222-2222-4222-8222-222222222222";
const defaultOwnerId = "33333333-3333-4333-8333-333333333333";

describe("MCP credential administration", () => {
  it("lists the available scopes without requiring user IDs", () => {
    expect(parseCredentialCommand(["scopes"])).toEqual({ action: "scopes" });
    const help = credentialScopeHelp();
    expect(help.split("\n")).toHaveLength(7);
    expect(help).not.toContain("submissions:read");
    expect(help).toContain("artifacts:read\tRead artifact metadata");
    expect(help).toContain(
      "transactions:draft\tCreate and edit this credential's drafts",
    );
  });

  it("generates distinct high-entropy bearer values and stores only their hashes", () => {
    const first = generateCredentialSecret();
    const second = generateCredentialSecret();
    expect(first.token).toMatch(/^folio_mcp_[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(
      createHash("sha256").update(first.token).digest("hex"),
    );
    expect(first.tokenHash).not.toContain(first.token);
  });

  it("requires explicit owner, dedicated actor, and scopes for creation", () => {
    expect(
      parseCredentialCommand([
        "create",
        "--administrator-id",
        administratorId,
        "--actor-user-id",
        actorUserId,
        "--default-owner-id",
        defaultOwnerId,
        "--label",
        "Local proposal intake",
        "--scope",
        "transactions:*",
        "--scope",
        "artifacts:*",
      ]),
    ).toEqual({
      action: "create",
      administratorId,
      actorUserId,
      defaultOwnerId,
      label: "Local proposal intake",
      scopes: [
        "transactions:search",
        "transactions:draft",
        "transactions:categorize",
        "artifacts:read",
        "artifacts:upload",
      ],
    });
    expect(() =>
      parseCredentialCommand([
        "create",
        "--administrator-id",
        administratorId,
        "--actor-user-id",
        actorUserId,
        "--default-owner-id",
        defaultOwnerId,
        "--label",
        "Local proposal intake",
      ]),
    ).toThrow();
    expect(() =>
      parseCredentialCommand([
        "create",
        "--administrator-id",
        administratorId,
        "--actor-user-id",
        actorUserId,
        "--default-owner-id",
        defaultOwnerId,
        "--label",
        "Local proposal intake",
        "--scope",
        "transactions:future",
      ]),
    ).toThrow("Unknown credential scope");
    expect(() =>
      parseCredentialCommand([
        "create",
        "--administrator-id",
        administratorId,
        "--actor-user-id",
        actorUserId,
        "--default-owner-id",
        defaultOwnerId,
        "--label",
        "Local proposal intake",
        "--scope",
        "submissions:read",
      ]),
    ).toThrow("Unknown credential scope");
  });

  it("parses credential revocation by ID", () => {
    expect(
      parseCredentialCommand([
        "revoke",
        "--administrator-id",
        administratorId,
        "--credential-id",
        actorUserId,
      ]),
    ).toEqual({
      action: "revoke",
      administratorId,
      credentialId: actorUserId,
    });
  });

  it("logs successful mutations with safe contextual IDs", async () => {
    const pool = { end: vi.fn(async () => undefined) };
    const repository = {
      createCredential: vi.fn(async () => ({
        id: "44444444-4444-4444-8444-444444444444",
      })),
      revokeCredential: vi.fn(),
    };
    const info = vi.fn();
    const output = vi.fn();
    const exitCode = await runManageMcpCredential({
      arguments_: [
        "create",
        "--administrator-id",
        administratorId,
        "--actor-user-id",
        actorUserId,
        "--default-owner-id",
        defaultOwnerId,
        "--label",
        "Synthetic intake",
        "--scope",
        "transactions:draft",
      ],
      environment: {},
      configLoader: () =>
        ({
          databaseUrl: "postgres://synthetic.invalid/folio",
          databaseSchema: "folio",
          gstRegistered: false,
        }) as never,
      poolFactory: () => pool as never,
      repositoryFactory: () => repository as never,
      secretGenerator: () => ({
        token: "synthetic-token-not-for-logs",
        tokenHash: "a".repeat(64),
      }),
      output,
      successWriters: { info },
    });

    expect(exitCode).toBe(0);
    expect(repository.createCredential).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
    const event = JSON.parse(info.mock.calls[0][0] as string);
    expect(event).toMatchObject({
      event: "folio.operation",
      operation: "mcp_credential_create",
      stage: "create",
      phase: "success",
      mutation: true,
      actorId: administratorId,
      userId: actorUserId,
      credentialId: "44444444-4444-4444-8444-444444444444",
      count: 1,
    });
    expect(JSON.stringify(event)).not.toContain("synthetic-token");
    expect(JSON.stringify(event)).not.toContain("Synthetic intake");
  });

  it("links database and close failures into one sanitized event", async () => {
    const error = vi.fn();
    const pool = {
      end: vi.fn(async () => {
        throw new Error("private close details");
      }),
    };
    const repository = {
      createCredential: vi.fn(async () => {
        throw new Error("private database details");
      }),
      revokeCredential: vi.fn(),
    };
    const exitCode = await runManageMcpCredential({
      arguments_: [
        "create",
        "--administrator-id",
        administratorId,
        "--actor-user-id",
        actorUserId,
        "--default-owner-id",
        defaultOwnerId,
        "--label",
        "Synthetic intake",
        "--scope",
        "transactions:draft",
      ],
      environment: {},
      configLoader: () =>
        ({
          databaseUrl: "postgres://synthetic.invalid/folio",
          databaseSchema: "folio",
          gstRegistered: false,
        }) as never,
      poolFactory: () => pool as never,
      repositoryFactory: () => repository as never,
      secretGenerator: () => ({
        token: "synthetic-token-not-for-logs",
        tokenHash: "a".repeat(64),
      }),
      error,
    });

    expect(exitCode).toBe(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    const event = JSON.parse(error.mock.calls[0][0] as string);
    expect(event).toMatchObject({
      operation: "mcp_credential",
      stage: "create",
      mutation: true,
      code: "UNEXPECTED_ERROR",
      cleanupFailures: [{ stage: "close", code: "UNEXPECTED_ERROR" }],
    });
    expect(JSON.stringify(event)).not.toContain("private");
    expect(JSON.stringify(event)).not.toContain("synthetic-token");
  });
});
