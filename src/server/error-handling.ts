import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

import {
  FolioDiagnosticError,
  type FolioDiagnosticFailure,
} from "../domain/diagnostics";
import {
  AppError,
  OperationCleanupError,
  unsupportedStripeExportMessage,
  errorPolicyFor,
  type PublicFailure,
} from "../domain/errors";
import {
  stripeBalanceCsvHeaders,
  StripeCsvValidationError,
  type StripeCsvValidationDetail,
} from "../domain/stripe-csv";
import { ArtifactPresignRecoveryError } from "../documents/service";

export type DiagnosticIds = Partial<
  Record<
    | "actorId"
    | "userId"
    | "transactionId"
    | "artifactId"
    | "credentialId"
    | "scheduleId"
    | "reviewId"
    | "bankTransactionId",
    string
  >
> & {
  transactionIds?: readonly string[];
  artifactIds?: readonly string[];
};

export type DiagnosticContext = {
  operation: string;
  stage?: string;
  mutation?: boolean;
  ids?: DiagnosticIds;
  metadata?: Record<string, unknown>;
  request?: Pick<Request, "method" | "url">;
  durationMs?: number;
};

export type LogWriter = (line: string) => void;
export type DiagnosticWriters = {
  info?: LogWriter;
  warn?: LogWriter;
  error?: LogWriter;
};
export type ReportedFailure = {
  publicFailure: PublicFailure;
  status: number;
  internalCode: string;
};

const contexts = new AsyncLocalStorage<DiagnosticContext>();
const handled = new WeakMap<object, ReportedFailure>();
const originalCauses = new WeakMap<HandledOperationError, unknown>();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifierPattern = /^[a-z][a-z0-9_]{0,79}$/;

const property = (value: unknown, key: string): unknown => {
  try {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
};

const instanceOf = <T>(
  value: unknown,
  constructor: { [Symbol.hasInstance](value: unknown): boolean },
): value is T => {
  try {
    return constructor[Symbol.hasInstance](value);
  } catch {
    return false;
  }
};

const csvReasons = new Set([
  "empty_csv",
  "invalid_headers",
  "unsupported_all_activity_export",
  "missing_headers",
  "malformed_csv",
  "wrong_column_count",
  "duplicate_reference",
  "invalid_currency",
  "invalid_amount",
  "net_mismatch",
  "invalid_timestamp",
]);
const csvHeaders = new Set<string>([
  ...stripeBalanceCsvHeaders,
  "created_utc",
  "available_on_utc",
]);

const safeCsvDetail = (
  value: unknown,
): StripeCsvValidationDetail | undefined => {
  const reason = property(value, "reason");
  if (typeof reason !== "string" || !csvReasons.has(reason)) return undefined;
  const rowNumber = property(value, "rowNumber");
  const missingHeaders = property(value, "missingHeaders");
  let headers: string[] = [];
  try {
    if (Array.isArray(missingHeaders))
      headers = [...new Set(missingHeaders.slice(0, 50))].filter(
        (header): header is string =>
          typeof header === "string" && csvHeaders.has(header),
      );
  } catch {
    /* Untrusted array access can fail. */
  }
  return {
    reason: reason as StripeCsvValidationDetail["reason"],
    ...(typeof rowNumber === "number" &&
    Number.isSafeInteger(rowNumber) &&
    rowNumber >= 2
      ? { rowNumber }
      : {}),
    ...(headers.length ? { missingHeaders: headers } : {}),
  };
};

const diagnosticFor = (code: unknown): FolioDiagnosticFailure => {
  const selected = errorPolicyFor(code);
  return {
    category: selected.category,
    code: selected.code,
    retryable: selected.retryable,
  };
};

const awsNames = new Set([
  "AccessDenied",
  "AccessDeniedException",
  "Forbidden",
  "InternalError",
  "NoSuchKey",
  "NotFound",
  "RequestTimeout",
  "ServiceUnavailable",
  "SlowDown",
  "Throttling",
  "ThrottlingException",
]);

const primaryErrorFor = (error: unknown): unknown => {
  let current = error;
  for (let depth = 0; depth < 8; depth++) {
    if (
      !instanceOf(current, OperationCleanupError) &&
      !instanceOf(current, ArtifactPresignRecoveryError)
    )
      return current;
    current = property(current, "primaryError");
  }
  return undefined;
};

export const classifyError = (value: unknown): FolioDiagnosticFailure => {
  if (instanceOf(value, OperationCleanupError))
    return classifyError(primaryErrorFor(value));
  if (
    instanceOf<ArtifactPresignRecoveryError>(
      value,
      ArtifactPresignRecoveryError,
    )
  )
    return classifyError(property(value, "primaryError"));
  if (instanceOf<AppError>(value, AppError))
    return diagnosticFor(property(value, "code"));
  if (instanceOf<ZodError>(value, ZodError))
    return diagnosticFor("INPUT_INVALID");
  if (instanceOf<StripeCsvValidationError>(value, StripeCsvValidationError))
    return {
      ...diagnosticFor("STRIPE_CSV_INVALID"),
      detail: safeCsvDetail(property(value, "detail")) ?? {
        reason: "malformed_csv",
      },
    };
  if (instanceOf<FolioDiagnosticError>(value, FolioDiagnosticError)) {
    const original = property(value, "diagnostic");
    const diagnostic = diagnosticFor(property(original, "code"));
    const detail =
      diagnostic.code === "STRIPE_CSV_INVALID"
        ? safeCsvDetail(property(original, "detail"))
        : undefined;
    const provider = property(original, "provider");
    const status = property(original, "httpStatus");
    return {
      ...diagnostic,
      ...(detail ? { detail } : {}),
      ...(provider === "postgres" || provider === "aws" ? { provider } : {}),
      ...(typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599
        ? { httpStatus: status }
        : {}),
    };
  }
  const rawCode =
    property(value, "code") ??
    property(value, "Code") ??
    property(value, "name");
  if (rawCode === "42501")
    return { ...diagnosticFor("DB_PERMISSION_DENIED"), provider: "postgres" };
  if (rawCode === "42P01" || rawCode === "42703")
    return { ...diagnosticFor("MIGRATION_REQUIRED"), provider: "postgres" };
  if (
    typeof rawCode === "string" &&
    (rawCode.startsWith("08") || rawCode === "57P01")
  )
    return { ...diagnosticFor("DATABASE_UNAVAILABLE"), provider: "postgres" };
  if (rawCode === "CredentialsProviderError" || rawCode === "CredentialsError")
    return { ...diagnosticFor("AWS_CREDENTIALS_UNAVAILABLE"), provider: "aws" };
  const metadata = property(value, "$metadata");
  const rawStatus =
    property(value, "statusCode") ??
    property(value, "status") ??
    property(metadata, "httpStatusCode");
  const status =
    typeof rawStatus === "number" &&
    Number.isInteger(rawStatus) &&
    rawStatus >= 400 &&
    rawStatus <= 599
      ? rawStatus
      : undefined;
  if (metadata && typeof rawCode === "string" && awsNames.has(rawCode)) {
    const code =
      status === 401 || status === 403
        ? "S3_ACCESS_DENIED"
        : status === 404
          ? "S3_OBJECT_NOT_FOUND"
          : status === 429 || (status !== undefined && status >= 500)
            ? "S3_UNAVAILABLE"
            : undefined;
    if (code)
      return { ...diagnosticFor(code), provider: "aws", httpStatus: status };
  }
  return diagnosticFor("UNEXPECTED_ERROR");
};

const mergeContext = (
  base: DiagnosticContext | undefined,
  context: Partial<DiagnosticContext>,
): DiagnosticContext => ({
  ...base,
  ...context,
  operation: context.operation ?? base?.operation ?? "unknown_operation",
  request: context.request ?? base?.request,
  mutation: context.mutation ?? base?.mutation,
  ids: { ...safeIds(base?.ids), ...safeIds(context.ids) } as DiagnosticIds,
  metadata: {
    ...safeMetadata(base?.metadata),
    ...safeMetadata(context.metadata),
  },
});

export const runWithDiagnosticContext = <T>(
  context: DiagnosticContext,
  action: () => T,
): T => contexts.run(mergeContext(contexts.getStore(), context), action);

export const setDiagnosticContext = (
  context: Partial<DiagnosticContext>,
): void => {
  const current = contexts.getStore();
  if (current) Object.assign(current, mergeContext(current, context));
};

const safeIds = (value: unknown): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const key of [
    "actorId",
    "userId",
    "transactionId",
    "artifactId",
    "credentialId",
    "scheduleId",
    "reviewId",
    "bankTransactionId",
  ]) {
    const id = property(value, key);
    if (typeof id === "string" && uuidPattern.test(id)) result[key] = id;
  }
  for (const key of ["transactionIds", "artifactIds"]) {
    try {
      const ids = property(value, key);
      if (Array.isArray(ids)) {
        const valid = [
          ...new Set(
            ids
              .slice(0, 50)
              .filter(
                (id): id is string =>
                  typeof id === "string" && uuidPattern.test(id),
              ),
          ),
        ];
        if (valid.length) result[key] = valid;
      }
    } catch {
      /* Untrusted array access can fail. */
    }
  }
  return result;
};

const numericMetadata = [
  "count",
  "selectedCount",
  "transactionCount",
  "artifactCount",
  "issueCount",
  "rowCount",
  "affectedCount",
  "successCount",
  "failureCount",
  "httpStatus",
  "statusCode",
  "status",
];
const sqlstates = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "42501",
  "42P01",
  "42703",
  "57P01",
  "23505",
  "23503",
  "40001",
  "40P01",
]);
const extractionReasons = new Set([
  "invalid_input",
  "empty_input",
  "input_too_large",
  "page_limit",
  "character_limit",
  "deadline_exceeded",
  "encrypted",
  "no_text",
  "malformed_pdf",
  "extraction_failed",
]);
const safeMetadata = (value: unknown): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const key of numericMetadata) {
    const number = property(value, key);
    if (
      typeof number === "number" &&
      Number.isSafeInteger(number) &&
      number >= 0 &&
      number <= 1_000_000_000 &&
      (!["httpStatus", "statusCode", "status"].includes(key) ||
        (number >= 100 && number <= 599))
    )
      result[key] = number;
  }
  const provider = property(value, "provider");
  if (provider === "postgres" || provider === "aws" || provider === "oidc")
    result.provider = provider;
  const sqlstate = property(value, "sqlstate");
  if (typeof sqlstate === "string" && sqlstates.has(sqlstate))
    result.sqlstate = sqlstate;
  const reason = property(value, "reason");
  if (typeof reason === "string" && extractionReasons.has(reason))
    result.reason = reason;
  const mcpMethod = property(value, "mcpMethod");
  if (
    typeof mcpMethod === "string" &&
    [
      "server/discover",
      "initialize",
      "notifications/initialized",
      "ping",
      "tools/list",
      "tools/call",
    ].includes(mcpMethod)
  )
    result.mcpMethod = mcpMethod;
  const mcpTool = property(value, "mcpTool");
  if (
    typeof mcpTool === "string" &&
    [
      "folio_ping",
      "list_unresolved_bank_rows",
      "search_transactions",
      "list_artifacts",
      "begin_artifact_upload",
      "confirm_artifact_upload",
      "submit_draft_transaction",
      "edit_transaction",
      "suggest_existing_match",
    ].includes(mcpTool)
  )
    result.mcpTool = mcpTool;
  return result;
};

const requestPaths = new Set([
  "/",
  "/health",
  "/mcp",
  "/transactions",
  "/transactions/new",
  "/transactions/import/stripe",
  "/transactions/recurring",
  "/banking/activity",
  "/banking/imports",
  "/banking/imports/new",
  "/banking/reconcile",
  "/admin/users",
  "/admin/tokens",
  "/reports",
  "/reports/tax",
  "/imports",
  "/imports/pdf",
  "/imports/stripe",
  "/imports/commbank",
  "/imports/library",
  "/auth/login",
  "/auth/callback",
  "/auth/logout",
]);

export const requestLogFieldsFor = (
  request: Pick<Request, "method" | "url">,
): Record<string, string> => {
  try {
    const method = property(request, "method");
    const url = property(request, "url");
    if (
      typeof url !== "string" ||
      typeof method !== "string" ||
      !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
        method,
      )
    )
      return {};
    const pathname = new URL(url).pathname;
    if (!requestPaths.has(pathname)) return {};
    return { requestMethod: method, requestPath: pathname };
  } catch {
    return {};
  }
};

const contextFields = (context: DiagnosticContext): Record<string, unknown> => {
  const operation =
    typeof context.operation === "string" &&
    /^[A-Za-z][A-Za-z0-9 _]{0,79}$/.test(context.operation)
      ? context.operation.trim().toLowerCase().replaceAll(/ +/g, "_")
      : "unknown_operation";
  return {
    timestamp: new Date().toISOString(),
    event: "folio.operation",
    version: 1,
    operation,
    ...(typeof context.mutation === "boolean"
      ? { mutation: context.mutation }
      : {}),
    ...(typeof context.stage === "string" &&
    identifierPattern.test(context.stage)
      ? { stage: context.stage }
      : {}),
    ...safeIds(context.ids),
    ...safeMetadata(context.metadata),
    ...(context.request ? requestLogFieldsFor(context.request) : {}),
    ...(typeof context.durationMs === "number" &&
    Number.isFinite(context.durationMs) &&
    context.durationMs >= 0
      ? { durationMs: Math.min(Math.round(context.durationMs), 1_000_000_000) }
      : {}),
  };
};

export const writeSafely = (
  writer: LogWriter,
  event: Record<string, unknown>,
): void => {
  try {
    writer(JSON.stringify(event));
  } catch {
    /* Reporting must not alter operation results. */
  }
};

const safeProviderSummary = (error: unknown): Record<string, string> => {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const code =
      property(current, "code") ??
      property(current, "Code") ??
      property(current, "name");
    if (typeof code === "string") {
      if (sqlstates.has(code)) return { sqlstate: code };
      if (
        awsNames.has(code) ||
        code === "CredentialsProviderError" ||
        code === "CredentialsError"
      )
        return { providerCode: code };
    }
    current = property(current, "cause");
  }
  return {};
};

export class HandledOperationError extends Error {
  readonly publicFailure: PublicFailure;

  constructor(reported: ReportedFailure, cause: unknown) {
    const failure = reported.publicFailure;
    super(
      `${failure.message} Code ${failure.code}. Reference ${failure.reference}.`,
    );
    this.name = "HandledOperationError";
    this.stack = undefined;
    this.publicFailure = failure;
    originalCauses.set(this, cause);
    handled.set(this, reported);
  }
}

export const reportServerFailure = (
  error: unknown,
  context: DiagnosticContext,
  writers: DiagnosticWriters = {},
): ReportedFailure => {
  if (error && typeof error === "object") {
    const existing = handled.get(error);
    if (existing) return existing;
  }
  const effective = mergeContext(contexts.getStore(), context);
  let diagnostic = classifyError(error);
  if (
    effective.mutation &&
    diagnostic.category === "database" &&
    diagnostic.retryable
  )
    diagnostic = {
      ...diagnostic,
      code: "DB_OUTCOME_UNKNOWN",
      retryable: false,
    };
  const selected = errorPolicyFor(diagnostic.code);
  const unsupportedCsv =
    diagnostic.code === "STRIPE_CSV_INVALID" &&
    property(diagnostic.detail, "reason") === "unsupported_all_activity_export";
  const reference = randomUUID();
  const publicFailure: PublicFailure = {
    code: selected.publicCode ?? selected.code,
    message: unsupportedCsv ? unsupportedStripeExportMessage : selected.message,
    reference,
    recovery: selected.recovery,
  };
  const rejectedStatus = property(effective.metadata, "httpStatus");
  const status =
    selected.code === "REQUEST_REJECTED" &&
    typeof rejectedStatus === "number" &&
    Number.isInteger(rejectedStatus) &&
    rejectedStatus >= 400 &&
    rejectedStatus <= 499
      ? rejectedStatus
      : selected.status;
  const reported = {
    publicFailure,
    status,
    internalCode: selected.code,
  };
  if (error && typeof error === "object") handled.set(error, reported);
  const severity =
    selected.severity ??
    (selected.status >= 500
      ? "error"
      : selected.status === 401 || selected.status === 403
        ? "warn"
        : "info");
  const writer =
    writers[severity] ??
    writers.error ??
    (severity === "error"
      ? console.error
      : severity === "warn"
        ? console.warn
        : console.info);
  const primary = primaryErrorFor(error);
  const appStage = instanceOf<AppError>(primary, AppError)
    ? property(primary, "stage")
    : undefined;
  const cleanup = instanceOf<ArtifactPresignRecoveryError>(
    error,
    ArtifactPresignRecoveryError,
  )
    ? classifyError(property(error, "cleanupError"))
    : undefined;
  const cleanupFailures: Record<string, unknown>[] = [];
  let current = error;
  for (
    let depth = 0;
    depth < 8 && instanceOf(current, OperationCleanupError);
    depth++
  ) {
    const secondary = property(current, "cleanupError");
    const failure = classifyError(secondary);
    const stage = property(current, "stage");
    cleanupFailures.push({
      code: failure.code,
      category: failure.category,
      retryable: failure.retryable,
      ...(typeof stage === "string" && identifierPattern.test(stage)
        ? { stage }
        : {}),
      ...safeProviderSummary(secondary),
    });
    current = property(current, "primaryError");
  }
  writeSafely(writer, {
    ...contextFields({
      ...effective,
      stage:
        effective.stage ??
        (typeof appStage === "string" ? appStage : undefined),
    }),
    ...safeIds({
      userId: instanceOf<AppError>(primary, AppError)
        ? property(primary, "userId")
        : undefined,
    }),
    phase: "failure",
    correlationId: reference,
    severity,
    category: diagnostic.category,
    code: selected.code,
    publicCode: publicFailure.code,
    retryable: diagnostic.retryable,
    ...(diagnostic.provider ? { provider: diagnostic.provider } : {}),
    ...(diagnostic.httpStatus ? { httpStatus: diagnostic.httpStatus } : {}),
    ...safeProviderSummary(primary),
    ...(cleanupFailures.length ? { cleanupFailures } : {}),
    ...(diagnostic.detail ? { detail: diagnostic.detail } : {}),
    ...(selected.code === "REVISION_CONFLICT"
      ? { detail: selected.message }
      : {}),
    ...(cleanup
      ? {
          cleanupFailure: {
            ...safeIds({ artifactId: property(error, "artifactId") }),
            code: cleanup.code,
            category: cleanup.category,
            retryable: cleanup.retryable,
            ...safeProviderSummary(property(error, "cleanupError")),
            ...(cleanup.provider ? { provider: cleanup.provider } : {}),
          },
        }
      : {}),
  });
  return reported;
};

export const toPublicFailure = (
  error: unknown,
  context: DiagnosticContext,
  writers?: DiagnosticWriters,
): PublicFailure => reportServerFailure(error, context, writers).publicFailure;

export const writeServerSuccess = (
  context: DiagnosticContext,
  writers: DiagnosticWriters = {},
): void => {
  writeSafely(writers.info ?? console.log, {
    ...contextFields(mergeContext(contexts.getStore(), context)),
    phase: "success",
  });
};
