import { randomUUID } from "node:crypto";

import { getRequest, setResponseStatus } from "@tanstack/react-start/server";

import {
  type ClientRenderFailure,
  type FolioDiagnosticFailure,
} from "../domain/diagnostics";
import type { StripeCsvValidationDetail } from "../domain/stripe-csv";
import {
  HandledOperationError,
  reportServerFailure,
  requestLogFieldsFor,
  runWithDiagnosticContext,
  writeSafely,
  writeServerSuccess,
  type DiagnosticWriters,
  type LogWriter,
} from "./error-handling";

export { FolioDiagnosticError } from "../domain/diagnostics";
export { classifyError, requestLogFieldsFor } from "./error-handling";
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

const currentRequest = () => {
  try {
    return getRequest();
  } catch {
    return undefined;
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
  const request = currentRequest();
  writeSafely(writer, {
    timestamp: new Date().toISOString(),
    event: "folio.client_render_failure",
    version: 1,
    correlationId,
    ...(request ? requestLogFieldsFor(request) : {}),
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
        ? failure.message
        : "Client render failed",
  });
  return correlationId;
};

export const runOperation = async <T>(
  operation: string,
  action: () => Promise<T>,
  writers: DiagnosticWriters = {},
  options: {
    mutation?: boolean;
    log?: "all" | "failures" | "none";
    successWhen?: (result: T) => boolean;
  } = {},
): Promise<T> => {
  const startedAt = performance.now();
  const context = {
    operation,
    mutation: options.mutation,
    request: currentRequest(),
  };
  return runWithDiagnosticContext(context, async () => {
    try {
      const result = await action();
      if (
        (options.successWhen?.(result) ?? true) &&
        (options.log === "all" ||
          (options.mutation &&
            options.log !== "none" &&
            options.log !== "failures"))
      ) {
        writeServerSuccess(
          { ...context, durationMs: performance.now() - startedAt },
          writers,
        );
      }
      return result;
    } catch (error) {
      const reported = reportServerFailure(
        error,
        { ...context, durationMs: performance.now() - startedAt },
        writers,
      );
      if (reported.status !== 500 && typeof setResponseStatus === "function") {
        try {
          setResponseStatus(reported.status);
        } catch {
          /* Non-HTTP adapters have no response. */
        }
      }
      throw new HandledOperationError(reported, error);
    }
  });
};
