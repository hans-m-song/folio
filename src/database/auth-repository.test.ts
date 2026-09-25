import { describe, expect, it, vi } from "vitest";

import { localAdministratorEmail } from "../auth/local";
import { AuthRepository, AuthenticationRejectedError } from "./auth-repository";

const eligibleUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "operator@buildsight.com.au",
  display_name: "Synthetic Operator",
  google_subject: null,
  role: "member",
};

describe("authentication repository", () => {
  it("consumes an authorization attempt exactly once", async () => {
    const expiresAt = new Date("2026-09-20T00:10:00.000Z");
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          nonce: "nonce",
          code_verifier: "verifier",
          return_path: "/",
          expires_at: expiresAt,
        },
      ],
    });
    const repository = new AuthRepository({ query } as never, "folio");

    await expect(
      repository.consumeLoginAttempt(
        "a".repeat(64),
        new Date("2026-09-20T00:00:00.000Z"),
      ),
    ).resolves.toEqual({
      nonce: "nonce",
      codeVerifier: "verifier",
      returnPath: "/",
      expiresAt,
    });
    expect(query.mock.calls[0]?.[0]).toContain("DELETE");
    expect(query.mock.calls[0]?.[0]).toContain("RETURNING");
  });

  it("atomically binds an unbound user and inserts a hash-only session", async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [eligibleUser] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const repository = new AuthRepository(
      {
        connect: vi.fn().mockResolvedValue({
          query: clientQuery,
          release: vi.fn(),
        }),
      } as never,
      "folio",
    );
    const tokenHash = "b".repeat(64);

    await expect(
      repository.createSessionForIdentity({
        email: eligibleUser.email,
        subject: "synthetic-subject",
        tokenHash,
        rotatedTokenHash: null,
        expiresAt: new Date("2026-09-20T12:00:00.000Z"),
        now: new Date("2026-09-20T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      id: eligibleUser.id,
      role: "member",
      displayName: eligibleUser.display_name,
    });
    expect(clientQuery.mock.calls[1]?.[0]).toContain("FOR UPDATE");
    expect(clientQuery.mock.calls[3]?.[0]).toContain("google_subject = $2");
    expect(clientQuery.mock.calls[4]?.[0]).toContain(
      "(token_hash, user_id, expires_at)",
    );
    expect(clientQuery.mock.calls[4]?.[1]).toEqual([
      tokenHash,
      eligibleUser.id,
      new Date("2026-09-20T12:00:00.000Z"),
    ]);
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it.each([null, "   "])(
    "backfills a %s display name from a verified Google profile",
    async (storedDisplayName) => {
      const unlabelledUser = {
        ...eligibleUser,
        display_name: storedDisplayName,
      };
      const clientQuery = vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [unlabelledUser] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({});
      const repository = new AuthRepository(
        {
          connect: vi.fn().mockResolvedValue({
            query: clientQuery,
            release: vi.fn(),
          }),
        } as never,
        "folio",
      );

      await expect(
        repository.createSessionForIdentity({
          email: unlabelledUser.email,
          subject: "synthetic-subject",
          displayName: "Google Operator",
          tokenHash: "g".repeat(64),
          rotatedTokenHash: null,
          expiresAt: new Date("2026-09-20T12:00:00.000Z"),
          now: new Date("2026-09-20T00:00:00.000Z"),
        }),
      ).resolves.toMatchObject({
        id: unlabelledUser.id,
        displayName: "Google Operator",
      });
      expect(clientQuery.mock.calls[4]).toEqual([
        expect.stringContaining("SET display_name = $2"),
        [unlabelledUser.id, "Google Operator"],
      ]);
      expect(clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    },
  );

  it("preserves an existing curated display name", async () => {
    const curatedUser = {
      ...eligibleUser,
      display_name: "Curated Name",
      google_subject: "synthetic-subject",
    };
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [curatedUser] })
      .mockResolvedValueOnce({ rows: [{ id: curatedUser.id }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const repository = new AuthRepository(
      {
        connect: vi.fn().mockResolvedValue({
          query: clientQuery,
          release: vi.fn(),
        }),
      } as never,
      "folio",
    );

    await expect(
      repository.createSessionForIdentity({
        email: curatedUser.email,
        subject: curatedUser.google_subject,
        displayName: "Google Operator",
        tokenHash: "h".repeat(64),
        rotatedTokenHash: null,
        expiresAt: new Date("2026-09-20T12:00:00.000Z"),
        now: new Date("2026-09-20T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      id: curatedUser.id,
      displayName: curatedUser.display_name,
    });
    expect(
      clientQuery.mock.calls.some(([query]) =>
        String(query).includes("SET display_name"),
      ),
    ).toBe(false);
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("rejects an inactive, viewer, absent, or conflicting identity", async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});
    const repository = new AuthRepository(
      {
        connect: vi.fn().mockResolvedValue({
          query: clientQuery,
          release: vi.fn(),
        }),
      } as never,
      "folio",
    );

    await expect(
      repository.createSessionForIdentity({
        email: "viewer@buildsight.com.au",
        subject: "synthetic-subject",
        tokenHash: "c".repeat(64),
        rotatedTokenHash: null,
        expiresAt: new Date("2026-09-20T12:00:00.000Z"),
        now: new Date("2026-09-20T00:00:00.000Z"),
      }),
    ).rejects.toThrow(AuthenticationRejectedError);
    expect(clientQuery.mock.calls[1]?.[0]).toContain("active = true");
    expect(clientQuery.mock.calls[1]?.[0]).toContain(
      "role IN ('administrator', 'member')",
    );
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("requires non-revoked, unexpired sessions for currently eligible users", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [eligibleUser] });
    const repository = new AuthRepository({ query } as never, "folio");

    await expect(
      repository.getActiveSession(
        "d".repeat(64),
        new Date("2026-09-20T00:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ id: eligibleUser.id });
    expect(query.mock.calls[0]?.[0]).toContain("revoked_at IS NULL");
    expect(query.mock.calls[0]?.[0]).toContain("expires_at > $2");
    expect(query.mock.calls[0]?.[0]).toContain("users.active = true");
  });

  it("rotates an existing session inside the identity transaction", async () => {
    const boundUser = {
      ...eligibleUser,
      google_subject: "synthetic-subject",
    };
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [boundUser] })
      .mockResolvedValueOnce({ rows: [{ id: boundUser.id }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const repository = new AuthRepository(
      {
        connect: vi.fn().mockResolvedValue({
          query: clientQuery,
          release: vi.fn(),
        }),
      } as never,
      "folio",
    );
    const now = new Date("2026-09-20T00:00:00.000Z");

    await repository.createSessionForIdentity({
      email: boundUser.email,
      subject: boundUser.google_subject,
      tokenHash: "e".repeat(64),
      rotatedTokenHash: "f".repeat(64),
      expiresAt: new Date("2026-09-20T12:00:00.000Z"),
      now,
    });

    expect(clientQuery.mock.calls[3]).toEqual([
      expect.stringContaining("SET revoked_at = $2"),
      ["f".repeat(64), now],
    ]);
    expect(clientQuery.mock.calls[4]?.[0]).toContain("INSERT INTO");
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("revokes a session by hash without deleting its audit record", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const repository = new AuthRepository({ query } as never, "folio");
    const now = new Date("2026-09-20T00:00:00.000Z");

    await repository.revokeSession("a".repeat(64), now);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET revoked_at = $2"),
      ["a".repeat(64), now],
    );
    expect(query.mock.calls[0]?.[0]).not.toContain("DELETE");
  });

  it("creates a local session only for the active synthetic administrator", async () => {
    const localAdmin = {
      ...eligibleUser,
      email: localAdministratorEmail,
      role: "administrator",
    };
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [localAdmin] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const repository = new AuthRepository(
      {
        connect: vi.fn().mockResolvedValue({
          query: clientQuery,
          release: vi.fn(),
        }),
      } as never,
      "folio",
    );
    const now = new Date("2026-09-20T00:00:00.000Z");

    await expect(
      repository.createSessionForLocalUser({
        tokenHash: "l".repeat(64),
        rotatedTokenHash: "p".repeat(64),
        expiresAt: new Date("2026-09-20T12:00:00.000Z"),
        now,
      }),
    ).resolves.toMatchObject({
      email: localAdministratorEmail,
      role: "administrator",
    });
    expect(clientQuery.mock.calls[1]?.[0]).toContain(
      "active = true AND role = 'administrator' FOR UPDATE",
    );
    expect(clientQuery.mock.calls[1]?.[1]).toEqual([localAdministratorEmail]);
    expect(clientQuery.mock.calls[2]?.[1]).toEqual(["p".repeat(64), now]);
    expect(clientQuery.mock.calls[3]?.[1]).toEqual([
      "l".repeat(64),
      localAdmin.id,
      new Date("2026-09-20T12:00:00.000Z"),
    ]);
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });
});
