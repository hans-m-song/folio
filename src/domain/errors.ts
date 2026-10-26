import type { FolioDiagnosticFailure } from "./diagnostics";

export const unsupportedStripeExportMessage =
  "This is a Stripe All activity export. Folio requires the itemised Balance change from activity CSV from Reporting > Balance Summary Reports.";

export type Recovery =
  | "retry"
  | "refresh"
  | "verify_outcome"
  | "sign_in"
  | "fix_input"
  | "contact_support"
  | "none";

export type PublicFailure = {
  code: string;
  message: string;
  reference: string;
  recovery: Recovery;
  issues?: ReadonlyArray<{
    code: string;
    path: ReadonlyArray<string | number>;
  }>;
};

export type ErrorPolicy = Omit<FolioDiagnosticFailure, "detail"> & {
  status: number;
  message: string;
  recovery: Recovery;
  publicCode?: string;
  severity?: "info" | "warn" | "error";
};

const policy = (
  category: ErrorPolicy["category"],
  status: number,
  message: string,
  recovery: Recovery = "contact_support",
  retryable = false,
): Omit<ErrorPolicy, "code"> => ({
  category,
  status,
  message,
  recovery,
  retryable,
});

const unknown = policy(
  "unknown",
  500,
  "The operation failed. Check the server log using the reference below.",
);
const validation = policy(
  "validation",
  422,
  "The request could not be completed. Review the input and try again.",
  "fix_input",
);
const conflict = policy(
  "validation",
  409,
  "The record changed. Reload it before trying again.",
  "refresh",
);
const auth = {
  ...policy("actor", 401, "Sign-in failed. Try signing in again.", "sign_in"),
  publicCode: "SIGN_IN_FAILED",
  severity: "warn" as const,
};

export const errorPolicyCatalog = {
  UNEXPECTED_ERROR: unknown,
  REQUEST_FAILED: unknown,
  INVALID_ARGUMENTS: {
    ...validation,
    status: 400,
    message: "Tool input did not satisfy the accepted schema.",
  },
  UNAUTHENTICATED: policy("actor", 401, "Sign in to continue.", "sign_in"),
  PERMISSION_DENIED: policy(
    "actor",
    403,
    "You do not have permission to perform this operation.",
  ),
  NOT_AUTHORIZED: policy("actor", 403, "Credential is not authorized."),
  ACTOR_NOT_FOUND: policy(
    "actor",
    403,
    "Provision or activate the Folio user, then try again.",
  ),
  SIGN_IN_FAILED: auth,
  AUTH_CONFIGURATION_INVALID: {
    ...auth,
    status: 500,
    severity: "error" as const,
  },
  AUTH_PROVIDER_UNAVAILABLE: {
    ...auth,
    status: 503,
    severity: "error" as const,
  },
  AUTH_SESSION_INVALID: auth,
  AUTH_CALLBACK_INVALID: auth,
  AUTH_USER_NOT_ELIGIBLE: auth,
  AUTH_SUBJECT_MISMATCH: auth,
  AUTH_STATE_MISSING: auth,
  AUTH_STATE_INVALID: auth,
  AUTH_STATE_EXPIRED: auth,
  AUTH_IDENTITY_INVALID: auth,
  AUTH_CODE_EXCHANGE_FAILED: auth,
  AUTH_LOGIN_REQUEST_INVALID: { ...auth, status: 400 },
  AUTH_CREDENTIALS_INVALID: auth,
  AUTH_LOGIN_ATTEMPT_FAILED: {
    ...auth,
    status: 500,
    severity: "error" as const,
  },
  AUTH_SESSION_LOOKUP_FAILED: {
    ...auth,
    status: 500,
    severity: "error" as const,
  },
  AUTH_SESSION_CREATION_FAILED: {
    ...auth,
    status: 500,
    severity: "error" as const,
  },
  AUTH_LOGOUT_FAILED: { ...auth, status: 500, severity: "error" as const },
  AUTH_CLEANUP_FAILED: { ...auth, status: 500, severity: "error" as const },
  INPUT_INVALID: { ...validation, status: 400, severity: "info" as const },
  REQUEST_FORBIDDEN: {
    ...policy("actor", 403, "The request is not permitted."),
    severity: "warn" as const,
  },
  REQUEST_REJECTED: {
    ...validation,
    status: 400,
    publicCode: "REQUEST_FAILED",
    severity: "warn" as const,
  },
  PDF_EXTRACTION_UNSUPPORTED: {
    ...validation,
    message:
      "This PDF could not be read automatically. Review it and enter the fields manually.",
    recovery: "fix_input" as const,
    severity: "info" as const,
  },
  PDF_EXTRACTION_FAILED: {
    ...policy(
      "unknown",
      500,
      "Automatic PDF extraction failed. Enter the fields manually or try again.",
      "retry",
      true,
    ),
    severity: "error" as const,
  },
  DB_PERMISSION_DENIED: {
    ...unknown,
    category: "database",
    publicCode: "REQUEST_FAILED",
  },
  MIGRATION_REQUIRED: {
    ...policy("database", 503, "This operation is temporarily unavailable."),
    publicCode: "DEPENDENCY_UNAVAILABLE",
  },
  DATABASE_UNAVAILABLE: {
    ...policy(
      "database",
      503,
      "This operation is temporarily unavailable. Try again later.",
      "retry",
      true,
    ),
    publicCode: "DEPENDENCY_UNAVAILABLE",
  },
  DB_OUTCOME_UNKNOWN: policy(
    "database",
    500,
    "The result is uncertain. Check Folio before attempting the operation again.",
    "verify_outcome",
  ),
  AWS_CREDENTIALS_UNAVAILABLE: {
    ...policy(
      "configuration",
      503,
      "This operation is temporarily unavailable.",
    ),
    publicCode: "DEPENDENCY_UNAVAILABLE",
  },
  S3_ACCESS_DENIED: {
    ...unknown,
    category: "storage",
    publicCode: "REQUEST_FAILED",
  },
  S3_OBJECT_NOT_FOUND: policy(
    "storage",
    404,
    "The stored object was not found.",
    "verify_outcome",
  ),
  S3_UNAVAILABLE: {
    ...policy(
      "storage",
      503,
      "This operation is temporarily unavailable. Try again later.",
      "retry",
      true,
    ),
    publicCode: "DEPENDENCY_UNAVAILABLE",
  },
  REVISION_CONFLICT: {
    ...conflict,
    category: "database",
    message:
      "Transaction changed since it was opened; reload before saving or voiding.",
  },
  BULK_TRANSACTION_CONFLICT: {
    ...conflict,
    message:
      "A selected transaction changed. No transactions were updated. Refresh, reselect, and preview again.",
  },
  BULK_TRANSACTION_INELIGIBLE: {
    ...validation,
    message:
      "A selected transaction is missing or void. No transactions were updated. Refresh and choose draft or recorded transactions.",
  },
  BULK_OWNER_INACTIVE: {
    ...validation,
    message:
      "The selected owner is unavailable or inactive. No transactions were updated. Choose an active Folio user and preview again.",
  },
  STRIPE_CSV_INVALID: {
    ...validation,
    message:
      "The Stripe Balance Summary itemised CSV has invalid or missing data. Check the report format and upload it again.",
  },
  STRIPE_IMPORT_CONFLICT: {
    ...conflict,
    message:
      "A Stripe balance transaction conflicts with an existing import. Review the existing transaction before importing again.",
  },
  BANK_STATE_CONFLICT: {
    ...conflict,
    message:
      "The bank row was resolved elsewhere. Reload it before choosing another action.",
  },
  BANK_MATCH_INVALID: {
    ...validation,
    message:
      "The transaction is not an eligible exact signed-AUD match. Review its status, kind, and settlement.",
  },
  BANK_MATCH_EDIT_CONFLICT: {
    ...conflict,
    message:
      "Keep the recorded AUD amount/direction, or unmatch the bank row before changing it.",
  },
  BANK_MATCH_CONFLICT: {
    ...conflict,
    message:
      "The transaction is already matched or the create-and-match request conflicts with current state. Reload before retrying.",
  },
  TAX_SOURCE_CHANGED: conflict,
  TAX_SOURCE_INCOMPLETE: validation,
  TAX_PARTNER_INACTIVE: validation,
  TAX_REVIEW_NOT_FOUND: { ...validation, status: 404 },
  TAX_REVIEW_STALE: conflict,
  RECURRING_BILL_NOT_FOUND: { ...validation, status: 404 },
  RECURRING_BILL_ASSOCIATION_NOT_FOUND: { ...validation, status: 404 },
  RECURRING_BILL_ASSOCIATION_CONFLICT: conflict,
  RECURRING_BILL_LINK_INELIGIBLE: validation,
  RECURRING_BILL_SCHEDULE_PAUSED: { ...validation, status: 409 },
  RECURRING_BILL_RESPONSIBLE_USER_INVALID: validation,
  RECURRING_BILL_REVISION_REQUIRED: conflict,
  DRAFT_NOT_EDITABLE: {
    ...conflict,
    message: "The draft is no longer editable by this credential.",
  },
  TRANSACTION_NOT_FOUND: {
    ...validation,
    status: 404,
    message: "The transaction was not found.",
  },
  IDEMPOTENCY_CONFLICT: {
    ...conflict,
    message: "This idempotency key was used with a different request.",
  },
  BANK_ROW_NOT_ACTIONABLE: {
    ...conflict,
    message: "The selected bank row is stale or already resolved.",
  },
  ARTIFACT_METADATA_CONFLICT: {
    ...conflict,
    message:
      "Artifact metadata changed or is no longer editable. Reload before saving again.",
  },
  ARTIFACT_NOT_CONFIRMABLE: validation,
  INVALID_BANK_ROW_LOCATOR: validation,
  MATCH_CANDIDATE_NOT_ELIGIBLE: {
    ...validation,
    message: "The match candidate must be a recorded manual transaction.",
  },
  EVIDENCE_NOT_REVIEWABLE: {
    ...validation,
    message: "The proposed invoice evidence is not reviewable.",
  },
} satisfies Record<string, Omit<ErrorPolicy, "code">>;

export type AppErrorCode = keyof typeof errorPolicyCatalog;

export const errorPolicyFor = (code: unknown): ErrorPolicy => {
  const known =
    typeof code === "string" && Object.hasOwn(errorPolicyCatalog, code)
      ? (code as AppErrorCode)
      : "UNEXPECTED_ERROR";
  return { ...errorPolicyCatalog[known], code: known };
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly stage?: string;
  readonly userId?: string;

  constructor(options: {
    code: AppErrorCode;
    stage?: string;
    cause?: unknown;
    userId?: string;
  }) {
    const selected = errorPolicyFor(options.code);
    super(selected.message, { cause: options.cause });
    this.name = "AppError";
    this.code = selected.code as AppErrorCode;
    this.stage = options.stage;
    this.userId = options.userId;
  }
}

export class OperationCleanupError extends Error {
  constructor(
    readonly primaryError: unknown,
    readonly cleanupError: unknown,
    readonly stage: string,
  ) {
    super("Operation cleanup failed after an earlier failure");
    this.name = "OperationCleanupError";
  }
}
