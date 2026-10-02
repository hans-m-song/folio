import { beforeEach, describe, expect, it, vi } from "vitest";

const administratorId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const ownerId = "33333333-3333-4333-8333-333333333333";
const credentialId = "44444444-4444-4444-8444-444444444444";

const current = vi.hoisted(() => ({
  authConfig: { sessionCookieName: "synthetic-session" },
  auth: { session: vi.fn() },
  proposalRepository: {
    listCredentials: vi.fn(),
    createCredential: vi.fn(),
    revokeCredential: vi.fn(),
  },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: vi.fn().mockReturnValue("synthetic-session-token"),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: { parse(value: unknown): unknown } | undefined;
    const builder = {
      validator(schema: { parse(value: unknown): unknown }) {
        validator = schema;
        return builder;
      },
      handler(callback: (input: { data: unknown }) => Promise<unknown>) {
        return (input: { data?: unknown } = {}) =>
          callback({ data: validator?.parse(input.data) });
      },
    };
    return builder;
  },
}));
vi.mock("./runtime", () => ({ runtime: () => current }));

import {
  createMcpCredential,
  listMcpCredentials,
  revokeMcpCredential,
} from "./mcp-credential-operations";

const credential = {
  id: credentialId,
  label: "Synthetic integration",
  actorUserId: actorId,
  defaultOwnerId: ownerId,
  scopes: ["transactions:search"],
  createdById: administratorId,
  revokedAt: null,
  createdAt: "2026-09-28T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  current.auth.session.mockResolvedValue({
    id: administratorId,
    role: "administrator",
  });
  current.proposalRepository.listCredentials.mockResolvedValue([credential]);
  current.proposalRepository.createCredential.mockResolvedValue(credential);
  current.proposalRepository.revokeCredential.mockResolvedValue(undefined);
});

describe("access token server operations", () => {
  it("denies non-administrators before reading or changing credentials", async () => {
    current.auth.session.mockResolvedValue({ id: actorId, role: "member" });

    await expect(listMcpCredentials()).rejects.toThrow();
    await expect(
      createMcpCredential({
        data: {
          label: "Synthetic integration",
          actorUserId: actorId,
          defaultOwnerId: ownerId,
          scopes: ["transactions:search"],
        },
      }),
    ).rejects.toThrow();
    await expect(
      revokeMcpCredential({ data: { credentialId } }),
    ).rejects.toThrow();
    expect(current.proposalRepository.listCredentials).not.toHaveBeenCalled();
    expect(current.proposalRepository.createCredential).not.toHaveBeenCalled();
    expect(current.proposalRepository.revokeCredential).not.toHaveBeenCalled();
  });

  it("lists metadata only and expands wildcards before storing a new hash", async () => {
    expect(await listMcpCredentials()).toEqual([credential]);
    const result = await createMcpCredential({
      data: {
        label: "Synthetic integration",
        actorUserId: actorId,
        defaultOwnerId: ownerId,
        scopes: ["transactions:*"],
      },
    });
    expect(result.credential).toEqual(credential);
    expect(result.token).toMatch(/^folio_mcp_[A-Za-z0-9_-]{43}$/);
    expect(current.proposalRepository.createCredential).toHaveBeenCalledWith(
      administratorId,
      expect.objectContaining({
        actorUserId: actorId,
        defaultOwnerId: ownerId,
        scopes: [
          "transactions:search",
          "transactions:draft",
          "transactions:categorize",
        ],
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
      result.token,
    );
  });

  it("deduplicates every currently offered wildcard and concrete scope", async () => {
    await createMcpCredential({
      data: {
        label: "Synthetic integration",
        actorUserId: actorId,
        defaultOwnerId: ownerId,
        scopes: [
          "*",
          "transactions:*",
          "artifacts:*",
          "transactions:search",
          "transactions:draft",
          "transactions:categorize",
          "bank_rows:read",
          "bank_matches:suggest",
          "artifacts:read",
          "artifacts:upload",
        ],
      },
    });
    expect(current.proposalRepository.createCredential).toHaveBeenCalledWith(
      administratorId,
      expect.objectContaining({
        scopes: expect.arrayContaining([
          "transactions:categorize",
          "artifacts:upload",
        ]),
      }),
    );
    expect(
      current.proposalRepository.createCredential.mock.calls[0]?.[1].scopes,
    ).toHaveLength(7);
  });

  it("accepts resource wildcards and rejects unknown scope patterns", async () => {
    await createMcpCredential({
      data: {
        label: "Synthetic integration",
        actorUserId: actorId,
        defaultOwnerId: ownerId,
        scopes: ["artifacts:*"],
      },
    });
    expect(current.proposalRepository.createCredential).toHaveBeenCalledWith(
      administratorId,
      expect.objectContaining({
        scopes: ["artifacts:read", "artifacts:upload"],
      }),
    );
    current.proposalRepository.createCredential.mockClear();

    expect(() =>
      createMcpCredential({
        data: {
          label: "Synthetic integration",
          actorUserId: actorId,
          defaultOwnerId: ownerId,
          scopes: ["unrecognized:*"],
        },
      }),
    ).toThrow();
    expect(current.proposalRepository.createCredential).not.toHaveBeenCalled();
  });

  it("rejects the legacy submission scope for new credentials", async () => {
    expect(() =>
      createMcpCredential({
        data: {
          label: "Synthetic integration",
          actorUserId: actorId,
          defaultOwnerId: ownerId,
          scopes: ["submissions:read"],
        },
      }),
    ).toThrow();
    expect(current.proposalRepository.createCredential).not.toHaveBeenCalled();
  });

  it("revokes by ID as the administrator", async () => {
    await expect(
      revokeMcpCredential({ data: { credentialId } }),
    ).resolves.toEqual({ revoked: true });
    expect(current.proposalRepository.revokeCredential).toHaveBeenCalledWith(
      administratorId,
      credentialId,
    );
  });
});
