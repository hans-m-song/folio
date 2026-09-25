import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
const prefix = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9/_-]*\/$/,
    "Must be an application-owned prefix ending in /",
  )
  .refine(
    (value) => !value.includes("..") && !value.startsWith("/"),
    "Unsafe prefix",
  );
const timezone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: value }).format();
    return value.includes("/");
  } catch {
    return false;
  }
}, "Expected a valid IANA timezone name");

const authConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    FOLIO_ORIGIN: z.string().url(),
    FOLIO_AUTH_MODE: z.enum(["google", "local"]).default("google"),
    FOLIO_GOOGLE_CLIENT_ID: z.string().trim().min(1).optional(),
    FOLIO_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    FOLIO_LOCAL_PASSWORD: z.string().min(12).optional(),
  })
  .superRefine((value, context) => {
    if (value.FOLIO_AUTH_MODE === "local") {
      if (value.NODE_ENV === "production") {
        context.addIssue({
          code: "custom",
          path: ["FOLIO_AUTH_MODE"],
          message: "Local authentication is unavailable in production",
        });
      }
      const origin = new URL(value.FOLIO_ORIGIN);
      if (
        origin.protocol !== "http:" ||
        origin.hostname !== "127.0.0.1" ||
        !origin.port ||
        origin.origin !== value.FOLIO_ORIGIN
      ) {
        context.addIssue({
          code: "custom",
          path: ["FOLIO_ORIGIN"],
          message: "Local authentication requires an exact loopback origin",
        });
      }
      if (!value.FOLIO_LOCAL_PASSWORD) {
        context.addIssue({
          code: "custom",
          path: ["FOLIO_LOCAL_PASSWORD"],
          message: "Local authentication requires a password",
        });
      }
      return;
    }
    const expectedOrigin =
      value.NODE_ENV === "production"
        ? "https://folio.buildsight.com.au"
        : "http://127.0.0.1:43230";
    if (value.FOLIO_ORIGIN !== expectedOrigin) {
      context.addIssue({
        code: "custom",
        path: ["FOLIO_ORIGIN"],
        message: `Expected exact ${value.NODE_ENV} Folio origin`,
      });
    }
    if (!value.FOLIO_GOOGLE_CLIENT_ID) {
      context.addIssue({
        code: "custom",
        path: ["FOLIO_GOOGLE_CLIENT_ID"],
        message: "Google authentication requires a client ID",
      });
    }
    if (!value.FOLIO_GOOGLE_CLIENT_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["FOLIO_GOOGLE_CLIENT_SECRET"],
        message: "Google authentication requires a client secret",
      });
    }
  });

const configSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    FOLIO_PRIVATE_MODE: z.literal("true"),
    FOLIO_BIND_HOST: z.enum(["127.0.0.1", "::1", "0.0.0.0"]),
    NITRO_HOST: z.enum(["127.0.0.1", "::1", "0.0.0.0"]),
    NITRO_PORT: z.coerce.number().int().positive().max(65_535),
    FOLIO_ALLOW_CONTAINER_BIND: z.enum(["true", "false"]).default("false"),
    FOLIO_DATABASE_URL: z
      .string()
      .url()
      .refine((value) => value.startsWith("postgres")),
    FOLIO_DATABASE_SCHEMA: identifier,
    FOLIO_DATABASE_APP_ROLE: identifier.default("folio_app"),
    FOLIO_S3_REGION: z.string().min(1),
    FOLIO_S3_BUCKET: z.string().min(3),
    FOLIO_S3_KEY_PREFIX: prefix,
    FOLIO_S3_INTERNAL_ENDPOINT: z.string().url().optional(),
    FOLIO_S3_PUBLIC_ENDPOINT: z.string().url().optional(),
    FOLIO_MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(50 * 1024 * 1024),
    FOLIO_REPORTING_TIMEZONE: timezone.default("Australia/Brisbane"),
    FOLIO_GST_REGISTERED: z.enum(["true", "false"]).default("false"),
  })
  .superRefine((value, context) => {
    if (
      value.FOLIO_BIND_HOST === "0.0.0.0" &&
      value.FOLIO_ALLOW_CONTAINER_BIND !== "true"
    ) {
      context.addIssue({
        code: "custom",
        path: ["FOLIO_BIND_HOST"],
        message: "Wildcard binding requires explicit container-only approval",
      });
    }
    if (value.FOLIO_BIND_HOST !== value.NITRO_HOST) {
      context.addIssue({
        code: "custom",
        path: ["NITRO_HOST"],
        message: "Nitro listener must match the validated Folio bind host",
      });
    }
    if (
      Boolean(value.FOLIO_S3_INTERNAL_ENDPOINT) !==
      Boolean(value.FOLIO_S3_PUBLIC_ENDPOINT)
    ) {
      context.addIssue({
        code: "custom",
        path: ["FOLIO_S3_PUBLIC_ENDPOINT"],
        message: "Internal and public S3 endpoints must be configured together",
      });
    }
  });

export type FolioConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: Record<string, string | undefined>) {
  const value = configSchema.parse(environment);
  return Object.freeze({
    nodeEnv: value.NODE_ENV,
    privateMode: true as const,
    bindHost: value.FOLIO_BIND_HOST,
    port: value.NITRO_PORT,
    databaseUrl: value.FOLIO_DATABASE_URL,
    databaseSchema: value.FOLIO_DATABASE_SCHEMA,
    databaseAppRole: value.FOLIO_DATABASE_APP_ROLE,
    s3Region: value.FOLIO_S3_REGION,
    s3Bucket: value.FOLIO_S3_BUCKET,
    s3KeyPrefix: value.FOLIO_S3_KEY_PREFIX,
    s3InternalEndpoint: value.FOLIO_S3_INTERNAL_ENDPOINT ?? null,
    s3PublicEndpoint: value.FOLIO_S3_PUBLIC_ENDPOINT ?? null,
    maxUploadBytes: value.FOLIO_MAX_UPLOAD_BYTES,
    reportingTimezone: value.FOLIO_REPORTING_TIMEZONE,
    gstRegistered: value.FOLIO_GST_REGISTERED === "true",
  });
}

export function loadAuthConfig(
  environment: Record<string, string | undefined>,
) {
  const value = authConfigSchema.parse(environment);
  const origin = new URL(value.FOLIO_ORIGIN);
  return Object.freeze({
    nodeEnv: value.NODE_ENV,
    authMode: value.FOLIO_AUTH_MODE,
    localPassword: value.FOLIO_LOCAL_PASSWORD ?? null,
    origin: origin.origin,
    callbackUrl: new URL("/auth/callback", origin).href,
    googleClientId: value.FOLIO_GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: value.FOLIO_GOOGLE_CLIENT_SECRET ?? "",
    googleIssuer: "https://accounts.google.com",
    hostedDomain: "buildsight.com.au",
    sessionLifetimeMs: 12 * 60 * 60 * 1000,
    loginAttemptLifetimeMs: 10 * 60 * 1000,
    sessionCookieName:
      value.NODE_ENV === "production"
        ? "__Host-folio_session"
        : "folio_dev_session",
    secureCookie: value.NODE_ENV === "production",
  });
}
