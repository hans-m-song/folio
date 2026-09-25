import * as oidc from "openid-client";

import type { ReturnTypeOfLoadAuthConfig } from "./types";
import { randomOpaqueToken, sha256 } from "./crypto";
import { safeReturnPath } from "./http";
import { localPasswordMatches } from "./local";
import type {
  AuthenticatedUser,
  AuthRepository,
} from "../database/auth-repository";

type AuthConfig = ReturnTypeOfLoadAuthConfig;

type IdentityClaims = {
  iss?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  hd?: unknown;
  name?: unknown;
};

const maxDisplayNameLength = 200;

export interface OidcOperations {
  createAuthorizationUrl(input: {
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<URL>;
  exchangeAuthorizationCode(input: {
    callbackUrl: URL;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<IdentityClaims>;
}

export interface AuthRepositoryOperations {
  createLoginAttempt: AuthRepository["createLoginAttempt"];
  consumeLoginAttempt: AuthRepository["consumeLoginAttempt"];
  createSessionForIdentity: AuthRepository["createSessionForIdentity"];
  createSessionForLocalUser: AuthRepository["createSessionForLocalUser"];
  getActiveSession: AuthRepository["getActiveSession"];
  revokeSession: AuthRepository["revokeSession"];
}

export class InvalidAuthenticationResponseError extends Error {
  constructor() {
    super("Authentication response rejected");
    this.name = "InvalidAuthenticationResponseError";
  }
}

export const verifiedGoogleIdentity = (
  claims: IdentityClaims,
  config: Pick<AuthConfig, "googleIssuer" | "hostedDomain">,
): { subject: string; email: string; displayName?: string } => {
  if (
    claims.iss !== config.googleIssuer ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    typeof claims.email !== "string" ||
    !claims.email ||
    claims.email_verified !== true ||
    claims.hd !== config.hostedDomain
  ) {
    throw new InvalidAuthenticationResponseError();
  }
  const displayName =
    typeof claims.name === "string"
      ? Array.from(claims.name.trim()).slice(0, maxDisplayNameLength).join("")
      : "";
  return {
    subject: claims.sub,
    email: claims.email,
    ...(displayName ? { displayName } : {}),
  };
};

export const createGoogleOidcOperations = (
  config: AuthConfig,
): OidcOperations => {
  let discovery: Promise<oidc.Configuration> | undefined;
  const client = async (): Promise<oidc.Configuration> => {
    discovery ??= oidc
      .discovery(
        new URL(config.googleIssuer),
        config.googleClientId,
        {
          client_secret: config.googleClientSecret,
          redirect_uris: [config.callbackUrl],
          response_types: ["code"],
        },
        oidc.ClientSecretPost(config.googleClientSecret),
        { execute: [oidc.enableNonRepudiationChecks] },
      )
      .catch((error: unknown) => {
        discovery = undefined;
        throw error;
      });
    return discovery;
  };
  return {
    async createAuthorizationUrl({ state, nonce, codeVerifier }) {
      const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
      return oidc.buildAuthorizationUrl(await client(), {
        redirect_uri: config.callbackUrl,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        hd: config.hostedDomain,
      });
    },
    async exchangeAuthorizationCode({
      callbackUrl,
      state,
      nonce,
      codeVerifier,
    }) {
      const tokens = await oidc.authorizationCodeGrant(
        await client(),
        callbackUrl,
        {
          expectedState: state,
          expectedNonce: nonce,
          pkceCodeVerifier: codeVerifier,
          idTokenExpected: true,
        },
        { redirect_uri: config.callbackUrl },
      );
      const claims = tokens.claims();
      if (!claims) throw new InvalidAuthenticationResponseError();
      return claims;
    },
  };
};

export class AuthService {
  constructor(
    private readonly repository: AuthRepositoryOperations,
    private readonly config: AuthConfig,
    private readonly oidcOperations: OidcOperations,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async begin(returnTo: string | null): Promise<URL> {
    if (this.config.authMode !== "google")
      throw new InvalidAuthenticationResponseError();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const now = this.now();
    await this.repository.createLoginAttempt(sha256(state), {
      nonce,
      codeVerifier,
      returnPath: safeReturnPath(returnTo, this.config.origin),
      expiresAt: new Date(now.getTime() + this.config.loginAttemptLifetimeMs),
    });
    return this.oidcOperations.createAuthorizationUrl({
      state,
      nonce,
      codeVerifier,
    });
  }

  async complete(
    requestUrl: URL,
    rotatedSessionToken: string | null,
  ): Promise<{
    sessionToken: string;
    user: AuthenticatedUser;
    returnPath: string;
  }> {
    if (this.config.authMode !== "google")
      throw new InvalidAuthenticationResponseError();
    const state = requestUrl.searchParams.get("state");
    if (!state) throw new InvalidAuthenticationResponseError();
    const attempt = await this.repository.consumeLoginAttempt(
      sha256(state),
      this.now(),
    );
    if (!attempt) throw new InvalidAuthenticationResponseError();
    const claims = await this.oidcOperations.exchangeAuthorizationCode({
      callbackUrl: requestUrl,
      state,
      nonce: attempt.nonce,
      codeVerifier: attempt.codeVerifier,
    });
    const identity = verifiedGoogleIdentity(claims, this.config);
    const sessionToken = randomOpaqueToken();
    const now = this.now();
    const user = await this.repository.createSessionForIdentity({
      ...identity,
      tokenHash: sha256(sessionToken),
      rotatedTokenHash: rotatedSessionToken
        ? sha256(rotatedSessionToken)
        : null,
      expiresAt: new Date(now.getTime() + this.config.sessionLifetimeMs),
      now,
    });
    return { sessionToken, user, returnPath: attempt.returnPath };
  }

  async authenticateLocal(
    password: string,
    rotatedSessionToken: string | null,
  ): Promise<{ sessionToken: string; user: AuthenticatedUser }> {
    const expectedPassword = this.config.localPassword;
    if (
      this.config.authMode !== "local" ||
      this.config.nodeEnv === "production" ||
      expectedPassword === null ||
      !localPasswordMatches(password, expectedPassword)
    ) {
      throw new InvalidAuthenticationResponseError();
    }

    const sessionToken = randomOpaqueToken();
    const now = this.now();
    const user = await this.repository.createSessionForLocalUser({
      tokenHash: sha256(sessionToken),
      rotatedTokenHash: rotatedSessionToken
        ? sha256(rotatedSessionToken)
        : null,
      expiresAt: new Date(now.getTime() + this.config.sessionLifetimeMs),
      now,
    });
    return { sessionToken, user };
  }

  async session(token: string | null): Promise<AuthenticatedUser | null> {
    if (!token) return null;
    return this.repository.getActiveSession(sha256(token), this.now());
  }

  async logout(token: string | null): Promise<void> {
    if (!token) return;
    await this.repository.revokeSession(sha256(token), this.now());
  }
}
