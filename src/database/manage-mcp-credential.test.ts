import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  generateCredentialSecret,
  parseCredentialCommand,
} from "./manage-mcp-credential";

const administratorId = "11111111-1111-4111-8111-111111111111";
const actorUserId = "22222222-2222-4222-8222-222222222222";
const defaultOwnerId = "33333333-3333-4333-8333-333333333333";

describe("MCP credential administration", () => {
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
        "proposals:submit",
        "--scope",
        "artifacts:upload",
      ]),
    ).toEqual({
      action: "create",
      administratorId,
      actorUserId,
      defaultOwnerId,
      label: "Local proposal intake",
      scopes: ["proposals:submit", "artifacts:upload"],
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
});
