import { describe, expect, it } from "vitest";

import { loadAuthConfig, loadConfig } from "./config";

const valid = {
  NODE_ENV: "test",
  FOLIO_PRIVATE_MODE: "true",
  FOLIO_BIND_HOST: "127.0.0.1",
  NITRO_HOST: "127.0.0.1",
  NITRO_PORT: "43230",
  FOLIO_DATABASE_URL: "postgres://folio:folio@localhost/folio",
  FOLIO_DATABASE_SCHEMA: "folio_test",
  FOLIO_S3_REGION: "ap-southeast-2",
  FOLIO_S3_BUCKET: "folio-test",
  FOLIO_S3_KEY_PREFIX: "tests/folio/",
  FOLIO_MAX_UPLOAD_BYTES: "1048576",
};

describe("Folio configuration", () => {
  it("accepts an isolated private deployment", () => {
    expect(loadConfig(valid).databaseSchema).toBe("folio_test");
  });

  it("fails closed on unsafe namespaces and exposure", () => {
    expect(() =>
      loadConfig({ ...valid, FOLIO_DATABASE_SCHEMA: "public;drop" }),
    ).toThrow();
    expect(() =>
      loadConfig({ ...valid, FOLIO_S3_KEY_PREFIX: "../shared/" }),
    ).toThrow();
    expect(() => loadConfig({ ...valid, FOLIO_BIND_HOST: "0.0.0.0" })).toThrow(
      "container-only approval",
    );
    expect(() => loadConfig({ ...valid, NITRO_HOST: "0.0.0.0" })).toThrow(
      "listener must match",
    );
    expect(() =>
      loadConfig({
        ...valid,
        FOLIO_REPORTING_TIMEZONE: "Australia/Not_A_Zone",
      }),
    ).toThrow("IANA timezone");
    expect(() =>
      loadConfig({ ...valid, FOLIO_PRIVATE_MODE: "false" }),
    ).toThrow();
    expect(() =>
      loadConfig({
        ...valid,
        FOLIO_S3_INTERNAL_ENDPOINT: "http://minio:9000",
      }),
    ).toThrow("configured together");
  });

  it("accepts paired internal and browser-visible S3 endpoints", () => {
    expect(
      loadConfig({
        ...valid,
        FOLIO_S3_INTERNAL_ENDPOINT: "http://minio:9000",
        FOLIO_S3_PUBLIC_ENDPOINT: "http://127.0.0.1:43230",
      }),
    ).toMatchObject({
      s3InternalEndpoint: "http://minio:9000",
      s3PublicEndpoint: "http://127.0.0.1:43230",
    });
  });
});

describe("Folio authentication configuration", () => {
  const auth = {
    NODE_ENV: "test",
    FOLIO_ORIGIN: "http://127.0.0.1:43230",
    FOLIO_GOOGLE_CLIENT_ID: "synthetic-client-id",
    FOLIO_GOOGLE_CLIENT_SECRET: "synthetic-client-secret",
  };

  it("derives the exact callback and development cookie", () => {
    expect(loadAuthConfig(auth)).toMatchObject({
      callbackUrl: "http://127.0.0.1:43230/auth/callback",
      sessionCookieName: "folio_dev_session",
      secureCookie: false,
      sessionLifetimeMs: 43_200_000,
    });
  });

  it("requires the exact production origin and secure host cookie", () => {
    expect(() => loadAuthConfig({ ...auth, NODE_ENV: "production" })).toThrow(
      "exact production Folio origin",
    );
    expect(
      loadAuthConfig({
        ...auth,
        NODE_ENV: "production",
        FOLIO_ORIGIN: "https://folio.buildsight.com.au",
      }),
    ).toMatchObject({
      callbackUrl: "https://folio.buildsight.com.au/auth/callback",
      sessionCookieName: "__Host-folio_session",
      secureCookie: true,
    });
  });

  it("permits local password mode only outside production", () => {
    const local = {
      NODE_ENV: "development",
      FOLIO_ORIGIN: "http://127.0.0.1:43230",
      FOLIO_AUTH_MODE: "local",
      FOLIO_LOCAL_PASSWORD: "synthetic-local-password",
    };
    expect(loadAuthConfig(local)).toMatchObject({
      authMode: "local",
      localPassword: "synthetic-local-password",
      sessionCookieName: "folio_dev_session",
    });
    expect(
      loadAuthConfig({ ...local, FOLIO_ORIGIN: "http://127.0.0.1:43231" })
        .origin,
    ).toBe("http://127.0.0.1:43231");
    expect(() =>
      loadAuthConfig({ ...local, FOLIO_ORIGIN: "http://localhost:43230" }),
    ).toThrow("exact loopback origin");
    expect(() =>
      loadAuthConfig({ ...local, FOLIO_LOCAL_PASSWORD: undefined }),
    ).toThrow("requires a password");
    expect(() =>
      loadAuthConfig({
        ...local,
        NODE_ENV: "production",
        FOLIO_ORIGIN: "https://folio.buildsight.com.au",
      }),
    ).toThrow("unavailable in production");
  });
});
