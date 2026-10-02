import { randomUUID } from "node:crypto";

import { getRequest, setResponseStatus } from "@tanstack/react-start/server";
import { ZodError } from "zod";

import {
  type ClientRenderFailure,
  FolioDiagnosticError,
  type FolioDiagnosticFailure,
} from "../domain/diagnostics";
import { ArtifactPresignRecoveryError } from "../documents/service";
import {
  stripeBalanceCsvHeaders,
  StripeCsvValidationError,
  type StripeCsvValidationDetail,
  type StripeCsvValidationReason,
} from "../domain/stripe-csv";

export { FolioDiagnosticError } from "../domain/diagnostics";

type ErrorRecord = Record<string, unknown>;

const revisionConflictGuidance =
  "Transaction changed since it was opened; reload before saving or voiding.";

export type DiagnosticDetail = string | StripeCsvValidationDetail;

export type DiagnosticFailure = FolioDiagnosticFailure;

type GeneralClientRenderMessage = Extract<
  ClientRenderFailure,
  { code: "CLIENT_RENDER_FAILURE" }
>["message"];

const safeClientRenderNames = new Set<ClientRenderFailure["name"]>([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
]);

const safeClientRenderMessages = new Set<GeneralClientRenderMessage>([
  "Cannot read properties of undefined",
  "Cannot read properties of null",
  "A function call failed",
  "A React render invariant failed",
  "Client render failed",
]);

const recordOf = (value: unknown): ErrorRecord =>
  value && typeof value === "object" ? (value as ErrorRecord) : {};

const safePropertyOf = (record: ErrorRecord, key: string): unknown => {
  try {
    return record[key];
  } catch {
    return undefined;
  }
};

const hasProperty = (record: ErrorRecord, key: string): boolean => {
  try {
    return key in record;
  } catch {
    return false;
  }
};

type InstanceConstructor = {
  [Symbol.hasInstance](value: unknown): boolean;
};

const isInstanceOf = <T>(
  value: unknown,
  constructor: InstanceConstructor,
): value is T => {
  try {
    return constructor[Symbol.hasInstance](value);
  } catch {
    return false;
  }
};

const statusOf = (error: ErrorRecord): number | undefined => {
  const metadata = recordOf(safePropertyOf(error, "$metadata"));
  const value =
    safePropertyOf(error, "statusCode") ??
    safePropertyOf(error, "status") ??
    safePropertyOf(metadata, "httpStatusCode");
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 400 &&
    value <= 599
    ? value
    : undefined;
};

const rawCodeOf = (error: ErrorRecord): string | undefined => {
  const value =
    safePropertyOf(error, "code") ??
    safePropertyOf(error, "Code") ??
    safePropertyOf(error, "name");
  return typeof value === "string" ? value : undefined;
};

const isJsonSafeScalar = (
  value: unknown,
): value is string | number | boolean | null =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));

const awsErrorNames = new Set([
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

const failure = (values: DiagnosticFailure): DiagnosticFailure => values;

const responseStatusFor = (
  diagnostic: DiagnosticFailure,
): number | undefined => {
  if (diagnostic.code === "BANK_MATCH_EDIT_CONFLICT") return 409;
  if (diagnostic.code === "BULK_TRANSACTION_CONFLICT") return 409;
  if (
    diagnostic.code === "BULK_TRANSACTION_INELIGIBLE" ||
    diagnostic.code === "BULK_OWNER_INACTIVE"
  )
    return 422;
  if (diagnostic.category !== "actor") return undefined;
  if (diagnostic.code === "UNAUTHENTICATED") return 401;
  if (diagnostic.code === "PERMISSION_DENIED") return 403;
  return undefined;
};

const clientMessageFor = (diagnostic: DiagnosticFailure): string => {
  const { code } = diagnostic;
  if (code === "ACTOR_NOT_FOUND")
    return "Provision or activate the Folio user, then try again.";
  if (code === "REVISION_CONFLICT") return revisionConflictGuidance;
  if (code === "BULK_TRANSACTION_CONFLICT")
    return "A selected transaction changed. No transactions were updated. Refresh, reselect, and preview again.";
  if (code === "BULK_TRANSACTION_INELIGIBLE")
    return "A selected transaction is missing or void. No transactions were updated. Refresh and choose draft or recorded transactions.";
  if (code === "BULK_OWNER_INACTIVE")
    return "The selected owner is unavailable or inactive. No transactions were updated. Choose an active Folio user and preview again.";
  if (code === "STRIPE_CSV_INVALID")
    return safeStripeCsvDetail(diagnostic.detail)?.reason ===
      "unsupported_all_activity_export"
      ? "This is a Stripe All activity export. Folio requires the itemised Balance change from activity CSV from Reporting > Balance Summary Reports."
      : "The Stripe Balance Summary itemised CSV has invalid or missing data. Check the report format and upload it again.";
  if (code === "STRIPE_IMPORT_CONFLICT")
    return "A Stripe balance transaction conflicts with an existing import. Review the existing transaction before importing again.";
  if (code === "DB_OUTCOME_UNKNOWN")
    return "The result is uncertain. Check Folio before attempting the operation again.";
  if (code === "BANK_STATE_CONFLICT")
    return "The bank row was resolved elsewhere. Reload it before choosing another action.";
  if (code === "BANK_MATCH_INVALID")
    return "The transaction is not an eligible exact signed-AUD match. Review its status, kind, and settlement.";
  if (code === "BANK_MATCH_EDIT_CONFLICT")
    return "Keep the recorded AUD amount/direction, or unmatch the bank row before changing it.";
  if (code === "BANK_MATCH_CONFLICT")
    return "The transaction is already matched or the create-and-match request conflicts with current state. Reload before retrying.";
  return "The operation failed. Check the server log using the reference below.";
};

const fixedDetailFor = (code: string): string | undefined =>
  code === "REVISION_CONFLICT" ? revisionConflictGuidance : undefined;

const stripeCsvReasons = new Set<StripeCsvValidationReason>([
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

const stripeCsvHeaderNames = new Set([
  ...stripeBalanceCsvHeaders,
  "created_utc",
  "available_on_utc",
]);

const safeStripeCsvDetail = (
  value: unknown,
): StripeCsvValidationDetail | undefined => {
  const detail = recordOf(value);
  const reason = detail.reason;
  if (
    typeof reason !== "string" ||
    !stripeCsvReasons.has(reason as StripeCsvValidationReason)
  )
    return undefined;
  const rowNumber = detail.rowNumber;
  const safeRowNumber =
    typeof rowNumber === "number" &&
    Number.isSafeInteger(rowNumber) &&
    rowNumber >= 2
      ? rowNumber
      : undefined;
  const missingHeaders = detail.missingHeaders;
  const safeMissingHeaders = Array.isArray(missingHeaders)
    ? [...new Set(missingHeaders)].filter(
        (header): header is string =>
          typeof header === "string" && stripeCsvHeaderNames.has(header),
      )
    : undefined;
  return {
    reason: reason as StripeCsvValidationReason,
    ...(safeRowNumber !== undefined ? { rowNumber: safeRowNumber } : {}),
    ...(safeMissingHeaders && safeMissingHeaders.length > 0
      ? { missingHeaders: safeMissingHeaders }
      : {}),
  };
};

const sanitiseDiagnostic = (
  diagnostic: DiagnosticFailure,
): DiagnosticFailure => {
  const detail =
    diagnostic.code === "STRIPE_CSV_INVALID"
      ? safeStripeCsvDetail(diagnostic.detail)
      : undefined;
  return {
    ...diagnostic,
    ...(detail ? { detail } : { detail: undefined }),
  };
};

export const classifyError = (value: unknown): DiagnosticFailure => {
  if (
    isInstanceOf<ArtifactPresignRecoveryError>(
      value,
      ArtifactPresignRecoveryError,
    )
  )
    return classifyError(value.primaryError);
  if (isInstanceOf<StripeCsvValidationError>(value, StripeCsvValidationError))
    return failure({
      category: "validation",
      code: "STRIPE_CSV_INVALID",
      retryable: false,
      detail: safeStripeCsvDetail(value.detail) ?? {
        reason: "malformed_csv",
      },
    });
  if (isInstanceOf<FolioDiagnosticError>(value, FolioDiagnosticError))
    return sanitiseDiagnostic(value.diagnostic);

  const error = recordOf(value);
  const rawCode = rawCodeOf(error);
  const status = statusOf(error);

  if (rawCode === "42501")
    return failure({
      category: "database",
      code: "DB_PERMISSION_DENIED",
      retryable: false,
      provider: "postgres",
    });
  if (rawCode === "42P01" || rawCode === "42703")
    return failure({
      category: "database",
      code: "MIGRATION_REQUIRED",
      retryable: false,
      provider: "postgres",
    });
  if (rawCode?.startsWith("08") || rawCode === "57P01")
    return failure({
      category: "database",
      code: "DATABASE_UNAVAILABLE",
      retryable: true,
      provider: "postgres",
    });

  if (rawCode === "CredentialsProviderError" || rawCode === "CredentialsError")
    return failure({
      category: "configuration",
      code: "AWS_CREDENTIALS_UNAVAILABLE",
      retryable: false,
      provider: "aws",
    });
  const awsError =
    hasProperty(error, "$metadata") &&
    rawCode !== undefined &&
    awsErrorNames.has(rawCode);
  if (awsError && (status === 401 || status === 403))
    return failure({
      category: "storage",
      code: "S3_ACCESS_DENIED",
      retryable: false,
      provider: "aws",
      httpStatus: status,
    });
  if (awsError && status === 404)
    return failure({
      category: "storage",
      code: "S3_OBJECT_NOT_FOUND",
      retryable: false,
      provider: "aws",
      httpStatus: status,
    });
  if (awsError && (status === 429 || (status !== undefined && status >= 500)))
    return failure({
      category: "storage",
      code: "S3_UNAVAILABLE",
      retryable: true,
      provider: "aws",
      httpStatus: status,
    });

  return failure({
    category: "unknown",
    code: "UNEXPECTED_ERROR",
    retryable: false,
  });
};

type LogWriter = (line: string) => void;

const artifactIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const cleanupErrorOf = (value: unknown): ErrorRecord => {
  const error = recordOf(value);
  const name = safePropertyOf(error, "name");
  const code = safePropertyOf(error, "code");
  const message = safePropertyOf(error, "message");
  return {
    name: typeof name === "string" ? name : "UnknownCleanupError",
    code: isJsonSafeScalar(code) ? code : null,
    message: typeof message === "string" ? message : "Artifact cleanup failed",
  };
};

const sourceErrorOf = (value: unknown): ErrorRecord => {
  try {
    if (
      isInstanceOf<ArtifactPresignRecoveryError>(
        value,
        ArtifactPresignRecoveryError,
      )
    ) {
      const primary = sourceErrorOf(value.primaryError);
      return {
        ...primary,
        ...(artifactIdPattern.test(value.artifactId)
          ? {
              cleanupFailure: {
                artifactId: value.artifactId,
                error: cleanupErrorOf(value.cleanupError),
              },
            }
          : {}),
      };
    }
    if (isInstanceOf<ZodError>(value, ZodError)) {
      return {
        name: value.name,
        issues: value.issues,
      };
    }

    if (isInstanceOf<Error>(value, Error)) {
      const error = recordOf(value);
      const code = safePropertyOf(error, "code");
      return {
        name: value.name,
        ...(isJsonSafeScalar(code) ? { code } : {}),
        message: value.message,
        ...(typeof value.stack === "string" ? { stack: value.stack } : {}),
      };
    }

    return { kind: value === null ? "null" : typeof value };
  } catch {
    return { kind: "unknown" };
  }
};

const writeSafely = (writer: LogWriter, event: Record<string, unknown>) => {
  try {
    writer(JSON.stringify(event));
  } catch {
    // Diagnostics must never alter operation behaviour.
  }
};

export const writeClientRenderFailure = (
  failure: ClientRenderFailure,
  writer: LogWriter = console.error,
): string => {
  const correlationId = randomUUID();
  const trimFailure =
    failure.name === "TypeError" &&
    failure.code === "CLIENT_RENDER_TRIM_NOT_STRING" &&
    failure.message === "trim is not a function; the value is not a string";
  writeSafely(writer, {
    timestamp: new Date().toISOString(),
    event: "folio.client_render_failure",
    version: 1,
    correlationId,
    ...requestLogFields(),
    name: trimFailure
      ? "TypeError"
      : safeClientRenderNames.has(failure.name)
        ? failure.name
        : "Error",
    code: trimFailure
      ? "CLIENT_RENDER_TRIM_NOT_STRING"
      : "CLIENT_RENDER_FAILURE",
    message: trimFailure
      ? "trim is not a function; the value is not a string"
      : safeClientRenderMessages.has(
            failure.message as GeneralClientRenderMessage,
          )
        ? (failure.message as GeneralClientRenderMessage)
        : "Client render failed",
  });
  return correlationId;
};

export const requestLogFieldsFor = (
  request: Pick<Request, "method" | "url">,
) => {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/_serverFn" || pathname.startsWith("/_serverFn/"))
    return {};
  return { requestMethod: request.method, requestPath: pathname };
};

const requestLogFields = () => {
  try {
    return requestLogFieldsFor(getRequest());
  } catch {
    return {};
  }
};

export const runOperation = async <T>(
  operation: string,
  action: () => Promise<T>,
  writers: { info?: LogWriter; error?: LogWriter } = {},
  options: { mutation?: boolean; log?: "all" | "failures" | "none" } = {},
): Promise<T> => {
  const startedAt = performance.now();
  const operationId = operation
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_");
  const common = {
    timestamp: new Date().toISOString(),
    event: "folio.operation",
    version: 1,
    operation: operationId,
    ...requestLogFields(),
  };
  try {
    const result = await action();
    if (options.log !== "none" && options.log !== "failures") {
      writeSafely(writers.info ?? console.log, {
        ...common,
        timestamp: new Date().toISOString(),
        phase: "success",
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
    return result;
  } catch (error) {
    const classified = classifyError(error);
    const diagnostic =
      options.mutation &&
      classified.category === "database" &&
      classified.retryable
        ? failure({
            category: "database",
            code: "DB_OUTCOME_UNKNOWN",
            retryable: false,
            provider: "postgres",
          })
        : classified;
    const responseStatus = responseStatusFor(diagnostic);
    if (responseStatus && typeof setResponseStatus === "function")
      setResponseStatus(responseStatus);
    const correlationId = options.log === "none" ? null : randomUUID();
    if (correlationId) {
      writeSafely(writers.error ?? console.error, {
        ...common,
        timestamp: new Date().toISOString(),
        phase: "failure",
        correlationId,
        durationMs: Math.round(performance.now() - startedAt),
        category: diagnostic.category,
        code: diagnostic.code,
        retryable: diagnostic.retryable,
        sourceError: sourceErrorOf(error),
        ...((diagnostic.detail ?? fixedDetailFor(diagnostic.code))
          ? { detail: diagnostic.detail ?? fixedDetailFor(diagnostic.code) }
          : {}),
        ...(diagnostic.provider ? { provider: diagnostic.provider } : {}),
        ...(diagnostic.httpStatus ? { httpStatus: diagnostic.httpStatus } : {}),
      });
    }
    throw new Error(
      correlationId
        ? `${clientMessageFor(diagnostic)} Code ${diagnostic.code}. Reference ${correlationId}.`
        : `${operation} failed. Code ${diagnostic.code}.`,
    );
  }
};
