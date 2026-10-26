import * as oidc from "openid-client";

import {
  AppError,
  OperationCleanupError,
  type AppErrorCode,
} from "../domain/errors";
import type { ReturnTypeOfLoadAuthConfig } from "./types";
import { randomOpaqueToken, sha256 } from "./crypto";
import { safeReturnPath } from "./http";
import { localPasswordMatches } from "./local";
import { setDiagnosticContext } from "../server/error-handling";
import type {
  AuthenticatedUser,
  AuthRepository,
  LoginAttempt,
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

export class InvalidAuthenticationResponseError extends AppError {
  constructor(
    code: AppErrorCode = "AUTH_CALLBACK_INVALID",
    stage = "authentication_validation",
  ) {
    super({ code, stage });
    this.name = "InvalidAuthenticationResponseError";
  }
}

const oauthAuthenticationRejections = new Set([
  "access_denied",
  "account_selection_required",
  "consent_required",
  "interaction_required",
  "invalid_grant",
  "invalid_request",
  "login_required",
]);

const oidcClaimFailureCodes = new Set([
  "OAUTH_JWT_CLAIM_COMPARISON_FAILED",
  "OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED",
  "OAUTH_JWT_TIMESTAMP_CHECK_FAILED",
]);

const isExpectedOidcRejection = (error: unknown): boolean => {
  if (error instanceof InvalidAuthenticationResponseError) return true;
  if (
    error instanceof oidc.AuthorizationResponseError &&
    oauthAuthenticationRejections.has(error.error)
  )
    return true;
  if (
    error instanceof oidc.ResponseBodyError &&
    (error.status === 400 || error.status === 401) &&
    oauthAuthenticationRejections.has(error.error)
  )
    return true;
  return (
    error instanceof oidc.ClientError &&
    typeof error.code === "string" &&
    oidcClaimFailureCodes.has(error.code)
  );
};

const asAppError = (
  error: unknown,
  code: AppErrorCode,
  stage: string,
): AppError | OperationCleanupError =>
  error instanceof AppError || error instanceof OperationCleanupError
    ? error
    : new AppError({ code, stage, cause: error });

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
    throw new InvalidAuthenticationResponseError(
      "AUTH_IDENTITY_INVALID",
      "identity_validation",
    );
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
      throw new AppError({
        code: "AUTH_CONFIGURATION_INVALID",
        stage: "login_mode",
      });
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const now = this.now();
    try {
      await this.repository.createLoginAttempt(sha256(state), {
        nonce,
        codeVerifier,
        returnPath: safeReturnPath(returnTo, this.config.origin),
        expiresAt: new Date(now.getTime() + this.config.loginAttemptLifetimeMs),
      });
    } catch (error) {
      throw asAppError(
        error,
        "AUTH_LOGIN_ATTEMPT_FAILED",
        "login_attempt_store",
      );
    }
    try {
      return await this.oidcOperations.createAuthorizationUrl({
        state,
        nonce,
        codeVerifier,
      });
    } catch (error) {
      throw asAppError(error, "AUTH_PROVIDER_UNAVAILABLE", "authorization_url");
    }
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
      throw new AppError({
        code: "AUTH_CONFIGURATION_INVALID",
        stage: "callback_mode",
      });
    const state = requestUrl.searchParams.get("state");
    if (!state)
      throw new AppError({
        code: "AUTH_STATE_MISSING",
        stage: "state_validation",
      });
    let attempt: LoginAttempt | null;
    try {
      attempt = await this.repository.consumeLoginAttempt(
        sha256(state),
        this.now(),
      );
    } catch (error) {
      throw asAppError(error, "UNEXPECTED_ERROR", "state_lookup");
    }
    if (!attempt)
      throw new AppError({
        code: "AUTH_STATE_INVALID",
        stage: "state_lookup",
      });
    let claims: IdentityClaims;
    try {
      claims = await this.oidcOperations.exchangeAuthorizationCode({
        callbackUrl: requestUrl,
        state,
        nonce: attempt.nonce,
        codeVerifier: attempt.codeVerifier,
      });
    } catch (error) {
      if (error instanceof AppError || error instanceof OperationCleanupError)
        throw error;
      throw new AppError({
        code: isExpectedOidcRejection(error)
          ? "AUTH_CODE_EXCHANGE_FAILED"
          : "AUTH_PROVIDER_UNAVAILABLE",
        stage: "code_exchange",
        cause: error,
      });
    }
    const identity = verifiedGoogleIdentity(claims, this.config);
    const sessionToken = randomOpaqueToken();
    const now = this.now();
    let user: AuthenticatedUser;
    try {
      user = await this.repository.createSessionForIdentity({
        ...identity,
        tokenHash: sha256(sessionToken),
        rotatedTokenHash: rotatedSessionToken
          ? sha256(rotatedSessionToken)
          : null,
        expiresAt: new Date(now.getTime() + this.config.sessionLifetimeMs),
        now,
      });
    } catch (error) {
      throw asAppError(
        error,
        "AUTH_SESSION_CREATION_FAILED",
        "session_creation",
      );
    }
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
      throw new InvalidAuthenticationResponseError(
        "AUTH_CREDENTIALS_INVALID",
        "local_credentials",
      );
    }

    const sessionToken = randomOpaqueToken();
    const now = this.now();
    let user: AuthenticatedUser;
    try {
      user = await this.repository.createSessionForLocalUser({
        tokenHash: sha256(sessionToken),
        rotatedTokenHash: rotatedSessionToken
          ? sha256(rotatedSessionToken)
          : null,
        expiresAt: new Date(now.getTime() + this.config.sessionLifetimeMs),
        now,
      });
    } catch (error) {
      throw asAppError(
        error,
        "AUTH_SESSION_CREATION_FAILED",
        "session_creation",
      );
    }
    return { sessionToken, user };
  }

  async session(token: string | null): Promise<AuthenticatedUser | null> {
    if (!token) return null;
    setDiagnosticContext({ redactValues: [token] });
    try {
      return await this.repository.getActiveSession(sha256(token), this.now());
    } catch (error) {
      throw asAppError(error, "AUTH_SESSION_LOOKUP_FAILED", "session_lookup");
    }
  }

  async logout(token: string | null): Promise<void> {
    if (!token) return;
    try {
      await this.repository.revokeSession(sha256(token), this.now());
    } catch (error) {
      throw asAppError(error, "AUTH_LOGOUT_FAILED", "logout_revocation");
    }
  }
}
