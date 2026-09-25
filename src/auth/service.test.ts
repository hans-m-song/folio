import { describe, expect, it, vi } from "vitest";

import { sha256 } from "./crypto";
import {
  AuthService,
  createGoogleOidcOperations,
  InvalidAuthenticationResponseError,
  verifiedGoogleIdentity,
  type AuthRepositoryOperations,
  type OidcOperations,
} from "./service";

const config = {
  nodeEnv: "test" as const,
  authMode: "google" as const,
  localPassword: null,
  origin: "http://127.0.0.1:43230",
  callbackUrl: "http://127.0.0.1:43230/auth/callback",
  googleClientId: "synthetic-client",
  googleClientSecret: "synthetic-secret",
  googleIssuer: "https://accounts.google.com",
  hostedDomain: "buildsight.com.au",
  sessionLifetimeMs: 43_200_000,
  loginAttemptLifetimeMs: 600_000,
  sessionCookieName: "folio_dev_session",
  secureCookie: false,
} as const;

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "operator@buildsight.com.au",
  displayName: "Synthetic Operator",
  role: "member" as const,
};

describe("Google identity claims", () => {
  const validClaims = {
    iss: "https://accounts.google.com",
    sub: "synthetic-google-subject",
    email: user.email,
    email_verified: true,
    hd: "buildsight.com.au",
  };

  it("requires verified email, exact issuer, and exact hosted domain", () => {
    expect(verifiedGoogleIdentity(validClaims, config)).toEqual({
      subject: validClaims.sub,
      email: validClaims.email,
    });
    for (const claims of [
      { ...validClaims, email_verified: false },
      { ...validClaims, hd: "example.test" },
      { ...validClaims, iss: "https://issuer.example.test" },
    ]) {
      expect(() => verifiedGoogleIdentity(claims, config)).toThrow(
        InvalidAuthenticationResponseError,
      );
    }
  });

  it("normalises and bounds an optional Google profile name", () => {
    expect(
      verifiedGoogleIdentity(
        { ...validClaims, name: `  ${"x".repeat(205)}  ` },
        config,
      ),
    ).toEqual({
      subject: validClaims.sub,
      email: validClaims.email,
      displayName: "x".repeat(200),
    });
    expect(
      verifiedGoogleIdentity({ ...validClaims, name: "   " }, config),
    ).toEqual({
      subject: validClaims.sub,
      email: validClaims.email,
    });
    expect(
      verifiedGoogleIdentity({ ...validClaims, name: 42 }, config),
    ).toEqual({
      subject: validClaims.sub,
      email: validClaims.email,
    });
  });
});

describe("OIDC login and session orchestration", () => {
  it("discovers Google once and always sends state, nonce, and S256 PKCE", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        issuer: config.googleIssuer,
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      const operations = createGoogleOidcOperations(config);
      const input = {
        state: "synthetic-state",
        nonce: "synthetic-nonce",
        codeVerifier: "v".repeat(64),
      };
      const first = await operations.createAuthorizationUrl(input);
      const second = await operations.createAuthorizationUrl(input);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(first.href).toBe(second.href);
      expect(first.searchParams.get("redirect_uri")).toBe(config.callbackUrl);
      expect(first.searchParams.get("state")).toBe(input.state);
      expect(first.searchParams.get("nonce")).toBe(input.nonce);
      expect(first.searchParams.get("code_challenge_method")).toBe("S256");
      expect(first.searchParams.get("code_challenge")).toBeTruthy();
      expect(first.searchParams.get("hd")).toBe(config.hostedDomain);
      expect(first.searchParams.get("scope")).toBe("openid email profile");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stores hashed one-time state and sends nonce plus S256 verifier", async () => {
    const createLoginAttempt = vi.fn().mockResolvedValue(undefined);
    const createAuthorizationUrl = vi
      .fn()
      .mockResolvedValue(
        new URL("https://accounts.google.com/o/oauth2/v2/auth"),
      );
    const service = new AuthService(
      { createLoginAttempt } as unknown as AuthRepositoryOperations,
      config,
      { createAuthorizationUrl } as unknown as OidcOperations,
      () => new Date("2026-09-20T00:00:00.000Z"),
    );

    await service.begin("/transactions?status=draft");

    const protocol = createAuthorizationUrl.mock.calls[0]?.[0];
    expect(protocol.state).toBeTruthy();
    expect(protocol.nonce).toBeTruthy();
    expect(protocol.codeVerifier).toBeTruthy();
    expect(createLoginAttempt).toHaveBeenCalledWith(
      sha256(protocol.state),
      expect.objectContaining({
        nonce: protocol.nonce,
        codeVerifier: protocol.codeVerifier,
        returnPath: "/transactions?status=draft",
        expiresAt: new Date("2026-09-20T00:10:00.000Z"),
      }),
    );
  });

  it("consumes state before exchange and rotates the prior session", async () => {
    const events: string[] = [];
    const repository = {
      consumeLoginAttempt: vi.fn(async () => {
        events.push("consume");
        return {
          nonce: "nonce",
          codeVerifier: "verifier",
          returnPath: "/",
          expiresAt: new Date("2026-09-20T00:10:00.000Z"),
        };
      }),
      createSessionForIdentity: vi.fn(async () => {
        events.push("session");
        return user;
      }),
    } as unknown as AuthRepositoryOperations;
    const oidcOperations = {
      exchangeAuthorizationCode: vi.fn(async () => {
        events.push("exchange");
        return {
          iss: config.googleIssuer,
          sub: "synthetic-subject",
          email: user.email,
          email_verified: true,
          hd: config.hostedDomain,
          name: "  Google Operator  ",
        };
      }),
    } as unknown as OidcOperations;
    const service = new AuthService(
      repository,
      config,
      oidcOperations,
      () => new Date("2026-09-20T00:00:00.000Z"),
    );
    const callback = new URL(`${config.callbackUrl}?code=code&state=state`);

    const result = await service.complete(callback, "previous-session");

    expect(events).toEqual(["consume", "exchange", "session"]);
    expect(repository.createSessionForIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        email: user.email,
        subject: "synthetic-subject",
        displayName: "Google Operator",
        rotatedTokenHash: sha256("previous-session"),
        expiresAt: new Date("2026-09-20T12:00:00.000Z"),
      }),
    );
    expect(result.sessionToken).toBeTruthy();
    expect(result.sessionToken).not.toBe("previous-session");
  });

  it("rejects missing, expired, or replayed state before token exchange", async () => {
    const exchangeAuthorizationCode = vi.fn();
    const service = new AuthService(
      {
        consumeLoginAttempt: vi.fn().mockResolvedValue(null),
      } as unknown as AuthRepositoryOperations,
      config,
      { exchangeAuthorizationCode } as unknown as OidcOperations,
    );
    await expect(
      service.complete(
        new URL(`${config.callbackUrl}?code=code&state=replayed`),
        null,
      ),
    ).rejects.toThrow(InvalidAuthenticationResponseError);
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("hashes session tokens for lookup and logout revocation", async () => {
    const getActiveSession = vi.fn().mockResolvedValue(user);
    const revokeSession = vi.fn().mockResolvedValue(undefined);
    const service = new AuthService(
      {
        getActiveSession,
        revokeSession,
      } as unknown as AuthRepositoryOperations,
      config,
      {} as OidcOperations,
      () => new Date("2026-09-20T00:00:00.000Z"),
    );

    await expect(service.session("opaque-session")).resolves.toEqual(user);
    await service.logout("opaque-session");

    expect(getActiveSession).toHaveBeenCalledWith(
      sha256("opaque-session"),
      new Date("2026-09-20T00:00:00.000Z"),
    );
    expect(revokeSession).toHaveBeenCalledWith(
      sha256("opaque-session"),
      new Date("2026-09-20T00:00:00.000Z"),
    );
  });

  it("creates a hash-only local admin session and rotates the prior token", async () => {
    const localConfig = {
      ...config,
      authMode: "local" as const,
      localPassword: "synthetic-local-password",
    };
    const createSessionForLocalUser = vi.fn().mockResolvedValue(user);
    const service = new AuthService(
      { createSessionForLocalUser } as unknown as AuthRepositoryOperations,
      localConfig,
      {} as OidcOperations,
      () => new Date("2026-09-20T00:00:00.000Z"),
    );

    const result = await service.authenticateLocal(
      "synthetic-local-password",
      "previous-session",
    );

    expect(createSessionForLocalUser).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: sha256(result.sessionToken),
        rotatedTokenHash: sha256("previous-session"),
        expiresAt: new Date("2026-09-20T12:00:00.000Z"),
        now: new Date("2026-09-20T00:00:00.000Z"),
      }),
    );
    expect(result.user).toBe(user);
    expect(result.sessionToken).not.toBe("previous-session");
  });

  it("rejects incorrect passwords and production local-mode configuration", async () => {
    const createSessionForLocalUser = vi.fn();
    const localConfig = {
      ...config,
      authMode: "local" as const,
      localPassword: "synthetic-local-password",
    };
    const localService = new AuthService(
      { createSessionForLocalUser } as unknown as AuthRepositoryOperations,
      localConfig,
      {} as OidcOperations,
    );
    await expect(
      localService.authenticateLocal("incorrect-password", null),
    ).rejects.toThrow(InvalidAuthenticationResponseError);

    const productionService = new AuthService(
      { createSessionForLocalUser } as unknown as AuthRepositoryOperations,
      { ...localConfig, nodeEnv: "production" },
      {} as OidcOperations,
    );
    await expect(
      productionService.authenticateLocal("synthetic-local-password", null),
    ).rejects.toThrow(InvalidAuthenticationResponseError);
    expect(createSessionForLocalUser).not.toHaveBeenCalled();
  });

  it("does not start Google OIDC while local authentication is enabled", async () => {
    const createLoginAttempt = vi.fn();
    const localService = new AuthService(
      { createLoginAttempt } as unknown as AuthRepositoryOperations,
      {
        ...config,
        authMode: "local",
        localPassword: "synthetic-local-password",
      },
      {} as OidcOperations,
    );

    await expect(localService.begin("/")).rejects.toThrow(
      InvalidAuthenticationResponseError,
    );
    expect(createLoginAttempt).not.toHaveBeenCalled();
  });
});
