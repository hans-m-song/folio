import { beforeAll, describe, expect, it, vi } from "vitest";

import { createGoogleOidcOperations } from "./service";

const config = {
  nodeEnv: "test",
  authMode: "google",
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

let signingKey: CryptoKey;
let unrelatedKey: CryptoKey;
let publicJwk: JsonWebKey;

const encoded = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const signedIdToken = async (
  claims: Record<string, unknown>,
  key = signingKey,
): Promise<string> => {
  const protectedHeader = encoded({ alg: "RS256", kid: "synthetic-key" });
  const payload = encoded(claims);
  const value = `${protectedHeader}.${payload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(value),
  );
  return `${value}.${Buffer.from(signature).toString("base64url")}`;
};

const providerFetch = (
  tokenResponse: (body: URLSearchParams) => Promise<Response> | Response,
) =>
  vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes(".well-known/openid-configuration")) {
      return Response.json({
        issuer: config.googleIssuer,
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }
    if (url === "https://oauth2.googleapis.com/token") {
      return tokenResponse(new URLSearchParams(String(init?.body ?? "")));
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return Response.json({ keys: [publicJwk] });
    }
    throw new Error(`Unexpected synthetic provider request: ${url}`);
  });

const exchange = async (
  fetch: ReturnType<typeof providerFetch>,
  input: { nonce?: string; verifier?: string } = {},
) => {
  vi.stubGlobal("fetch", fetch);
  try {
    return await createGoogleOidcOperations(config).exchangeAuthorizationCode({
      callbackUrl: new URL(`${config.callbackUrl}?code=code&state=state`),
      state: "state",
      nonce: input.nonce ?? "nonce",
      codeVerifier: input.verifier ?? "expected-verifier",
    });
  } finally {
    vi.unstubAllGlobals();
  }
};

const validClaims = () => {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: config.googleIssuer,
    aud: config.googleClientId,
    sub: "synthetic-subject",
    email: "operator@buildsight.com.au",
    email_verified: true,
    hd: config.hostedDomain,
    nonce: "nonce",
    iat: now,
    exp: now + 300,
  };
};

const successfulTokenResponse = async (
  claims: Record<string, unknown>,
  key = signingKey,
): Promise<Response> =>
  Response.json({
    access_token: "synthetic-access-token",
    token_type: "Bearer",
    expires_in: 300,
    id_token: await signedIdToken(claims, key),
  });

beforeAll(async () => {
  const algorithm = {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  };
  const pair = await crypto.subtle.generateKey(algorithm, true, [
    "sign",
    "verify",
  ]);
  const unrelated = await crypto.subtle.generateKey(algorithm, true, [
    "sign",
    "verify",
  ]);
  signingKey = pair.privateKey;
  unrelatedKey = unrelated.privateKey;
  publicJwk = {
    ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
    kid: "synthetic-key",
    alg: "RS256",
    use: "sig",
  } as JsonWebKey;
});

describe("OIDC exchange validation", () => {
  it("returns the optional Google profile name from a verified ID token", async () => {
    const fetch = providerFetch(() =>
      successfulTokenResponse({ ...validClaims(), name: "Google Operator" }),
    );

    await expect(exchange(fetch)).resolves.toMatchObject({
      name: "Google Operator",
    });
  });

  it.each([
    ["wrong audience", () => ({ ...validClaims(), aud: "other-client" })],
    ["expired token", () => ({ ...validClaims(), exp: 1 })],
    ["nonce mismatch", () => ({ ...validClaims(), nonce: "other-nonce" })],
  ])("rejects %s through openid-client", async (_label, claims) => {
    const fetch = providerFetch(() => successfulTokenResponse(claims()));
    await expect(exchange(fetch)).rejects.toThrow();
  });

  it("rejects a bad ID-token signature", async () => {
    const fetch = providerFetch(() =>
      successfulTokenResponse(validClaims(), unrelatedKey),
    );
    await expect(exchange(fetch)).rejects.toThrow();
  });

  it("delegates the PKCE verifier and propagates provider rejection", async () => {
    const fetch = providerFetch((body) => {
      expect(body.get("code_verifier")).toBe("mismatched-verifier");
      return Response.json(
        { error: "invalid_grant", error_description: "PKCE mismatch" },
        { status: 400 },
      );
    });
    await expect(
      exchange(fetch, { verifier: "mismatched-verifier" }),
    ).rejects.toThrow();
  });

  it("propagates a provider authorization-code error", async () => {
    const fetch = providerFetch(() =>
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    await expect(exchange(fetch)).rejects.toThrow();
  });
});
