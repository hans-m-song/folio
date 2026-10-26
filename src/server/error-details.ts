import { ZodError } from "zod";
import { diagnosticValidationPath } from "../domain/validation-diagnostics";

const maximumDepth = 8;
const maximumItems = 50;
const maximumText = 8_192;
const expectedTypes = new Set([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set",
]);
const configurationReasons = new Set([
  "Must be an application-owned prefix ending in /",
  "Unsafe prefix",
  "Expected a valid IANA timezone name",
  "Local authentication is unavailable in production",
  "Local authentication requires an exact loopback origin or the approved Folio hostname origin",
  "Local authentication requires a password",
  "Google authentication requires a client ID",
  "Google authentication requires a client secret",
  "Expected exact production Folio origin",
  "Expected exact development Folio origin",
  "Expected exact test Folio origin",
  "Wildcard binding requires explicit container-only approval",
  "Nitro listener must match the validated Folio bind host",
  "Internal and public S3 endpoints must be configured together",
]);

const property = (value: unknown, key: string): unknown => {
  try {
    return value !== null && typeof value === "object"
      ? Reflect.get(value, key)
      : undefined;
  } catch {
    return undefined;
  }
};

export const redactDiagnosticText = (text: string): string =>
  text
    .replace(/\bdata:[^\s"'<>]+/gi, "[REDACTED_DATA_URL]")
    .replace(/\b(?:https?|postgres(?:ql)?):\/\/[^\s"'<>]+/gi, "[REDACTED_URL]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:[A-Z][A-Z0-9]*[_-])*(?:password|passwd|secret|token|authorization|cookie|api[_-]?key|client_secret|secret_access_key)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "[REDACTED_CREDENTIAL]",
    )
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_ACCESS_KEY]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[REDACTED_JWT]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\/(?:Users|home)\/[^/\s]+/g, "/[REDACTED_HOME]")
    .replace(/\p{Cc}/gu, (character) =>
      ["\n", "\t"].includes(character) ? character : "",
    )
    .slice(0, maximumText);

const safeText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0
    ? redactDiagnosticText(value)
    : undefined;

const isZodError = (value: unknown): value is ZodError => {
  try {
    return value instanceof ZodError;
  } catch {
    return false;
  }
};

export const serverErrorDetails = (error: unknown): Record<string, unknown> => {
  const seen = new Set<object>();
  let visited = 0;
  const visit = (value: unknown, depth: number): Record<string, unknown> => {
    if (++visited > 100) return { truncated: "node_count" };
    if (depth > maximumDepth) return { truncated: "depth" };
    if (value !== null && typeof value === "object") {
      if (seen.has(value)) return { truncated: "cycle_or_repeated_reference" };
      seen.add(value);
    }
    const validation = isZodError(value);
    const name = safeText(property(value, "name"));
    const code = safeText(property(value, "code") ?? property(value, "Code"));
    const rawMessage =
      typeof value === "string" ? value : property(value, "message");
    const rawStack = property(value, "stack");
    const frames =
      typeof rawStack === "string"
        ? rawStack.split("\n").filter((line) => /^\s+at /.test(line))
        : [];
    const result: Record<string, unknown> = {
      ...(name ? { name } : {}),
      ...(code ? { code } : {}),
      message: validation
        ? "Schema validation failed."
        : (safeText(rawMessage) ?? "No error message was available."),
      ...(frames.length
        ? { stack: frames.slice(0, maximumItems).map(redactDiagnosticText) }
        : {}),
      ...(typeof rawMessage === "string" && rawMessage.length > maximumText
        ? { messageTruncated: true }
        : {}),
      ...(frames.length > maximumItems ? { stackTruncated: true } : {}),
    };
    const truncated = property(value, "truncated");
    if (
      typeof truncated === "string" &&
      ["depth", "node_count", "cycle_or_repeated_reference"].includes(truncated)
    )
      result.truncated = truncated;
    for (const marker of [
      "messageTruncated",
      "stackTruncated",
      "errorsTruncated",
      "issuesTruncated",
      "issuesUnavailable",
      "errorsUnavailable",
    ])
      if (property(value, marker) === true) result[marker] = true;
    if (validation) {
      try {
        result.issues = value.issues.slice(0, maximumItems).map((issue) => ({
          code: issue.code,
          ...(issue.code === "too_small" && typeof issue.minimum === "number"
            ? { minimum: issue.minimum, inclusive: issue.inclusive }
            : {}),
          ...(issue.code === "too_big" && typeof issue.maximum === "number"
            ? { maximum: issue.maximum, inclusive: issue.inclusive }
            : {}),
          ...(issue.code === "invalid_string" &&
          typeof issue.validation === "string"
            ? { validation: issue.validation }
            : {}),
          ...(issue.code === "invalid_union"
            ? {
                alternatives: issue.unionErrors
                  .slice(0, maximumItems)
                  .map((branch) => visit(branch, depth + 1)),
                ...(issue.unionErrors.length > maximumItems
                  ? { alternativesTruncated: true }
                  : {}),
              }
            : {}),
          ...(issue.code === "invalid_arguments"
            ? { argumentsError: visit(issue.argumentsError, depth + 1) }
            : {}),
          ...(issue.code === "invalid_return_type"
            ? { returnTypeError: visit(issue.returnTypeError, depth + 1) }
            : {}),
          path: diagnosticValidationPath(value, issue.path),
          ...(issue.path.length > maximumItems ? { pathTruncated: true } : {}),
          ...("expected" in issue &&
          typeof issue.expected === "string" &&
          expectedTypes.has(issue.expected)
            ? { expected: issue.expected }
            : {}),
          ...(issue.path.length === 1 &&
          typeof issue.path[0] === "string" &&
          /^(?:FOLIO_|NITRO_|NODE_ENV$)/.test(issue.path[0]) &&
          configurationReasons.has(issue.message)
            ? { reason: issue.message }
            : {}),
        }));
        if (value.issues.length > maximumItems) result.issuesTruncated = true;
      } catch {
        result.issuesUnavailable = true;
      }
    }
    const cause = property(value, "cause");
    if (cause !== undefined) result.cause = visit(cause, depth + 1);
    const primary = property(value, "primaryError");
    const cleanup = property(value, "cleanupError");
    if (primary !== undefined) result.primaryError = visit(primary, depth + 1);
    if (cleanup !== undefined) result.cleanupError = visit(cleanup, depth + 1);
    const errors = validation ? undefined : property(value, "errors");
    try {
      if (Array.isArray(errors)) {
        result.errors = errors
          .slice(0, maximumItems)
          .map((child) => visit(child, depth + 1));
        if (errors.length > maximumItems) result.errorsTruncated = true;
      }
    } catch {
      result.errorsUnavailable = true;
    }
    return result;
  };
  return visit(error, 0);
};
