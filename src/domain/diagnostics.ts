export type FolioDiagnosticDetail = string | object;

export type FolioDiagnosticFailure = {
  category:
    | "actor"
    | "configuration"
    | "database"
    | "storage"
    | "validation"
    | "unknown";
  code: string;
  retryable: boolean;
  provider?: "postgres" | "aws";
  httpStatus?: number;
  detail?: FolioDiagnosticDetail;
};

type ClientRenderFailureName =
  | "Error"
  | "TypeError"
  | "RangeError"
  | "ReferenceError"
  | "SyntaxError"
  | "URIError"
  | "EvalError"
  | "AggregateError";

type GeneralClientRenderMessage =
  | "Cannot read properties of undefined"
  | "Cannot read properties of null"
  | "A function call failed"
  | "A React render invariant failed"
  | "Client render failed";

export type ClientRenderFailure =
  | {
      name: ClientRenderFailureName;
      code: "CLIENT_RENDER_FAILURE";
      message: GeneralClientRenderMessage;
    }
  | {
      name: "TypeError";
      code: "CLIENT_RENDER_TRIM_NOT_STRING";
      message: "trim is not a function; the value is not a string";
    };

const clientRenderFailureNames = new Set<ClientRenderFailureName>([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
]);

const safeErrorProperty = (value: unknown, property: string): unknown => {
  try {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)[property]
      : undefined;
  } catch {
    return undefined;
  }
};

export const sanitizeClientRenderFailure = (
  error: unknown,
): ClientRenderFailure => {
  const rawName = safeErrorProperty(error, "name");
  const name = clientRenderFailureNames.has(rawName as ClientRenderFailureName)
    ? (rawName as ClientRenderFailureName)
    : "Error";
  const rawMessage = safeErrorProperty(error, "message");
  const message = typeof rawMessage === "string" ? rawMessage : "";

  if (
    name === "TypeError" &&
    /^[A-Za-z_$][\w$]*(?:\?\.|\.)trim is not a function$/.test(message)
  )
    return {
      name: "TypeError",
      code: "CLIENT_RENDER_TRIM_NOT_STRING",
      message: "trim is not a function; the value is not a string",
    };

  let safeMessage: GeneralClientRenderMessage = "Client render failed";
  if (
    /^Cannot read properties of undefined \(reading '[A-Za-z_$][\w$]*'\)$/.test(
      message,
    )
  )
    safeMessage = "Cannot read properties of undefined";
  else if (
    /^Cannot read properties of null \(reading '[A-Za-z_$][\w$]*'\)$/.test(
      message,
    )
  )
    safeMessage = "Cannot read properties of null";
  else if (
    /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)* is not a function$/.test(message)
  )
    safeMessage = "A function call failed";
  else if (
    /^(?:Rendered (?:fewer|more) hooks than expected|Too many re-renders|Maximum update depth exceeded)\b/.test(
      message,
    )
  )
    safeMessage = "A React render invariant failed";

  return { name, code: "CLIENT_RENDER_FAILURE", message: safeMessage };
};

export class FolioDiagnosticError extends Error {
  readonly code: string;

  constructor(
    readonly diagnostic: FolioDiagnosticFailure,
    message = diagnostic.code,
  ) {
    super(message);
    this.code = diagnostic.code;
    this.name = "FolioDiagnosticError";
  }
}
