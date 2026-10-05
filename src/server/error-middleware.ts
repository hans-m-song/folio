import { createMiddleware } from "@tanstack/react-start";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import {
  setResponseHeader,
  setResponseStatus,
} from "@tanstack/react-start/server";
import { AppError } from "../domain/errors";

import {
  HandledOperationError,
  reportServerFailure,
  runWithDiagnosticContext,
  type DiagnosticIds,
} from "./error-handling";

const idAliases: Record<string, keyof DiagnosticIds> = {
  getTransaction: "transactionId",
  saveManualTransaction: "transactionId",
  voidTransaction: "transactionId",
  deleteDraftTransaction: "transactionId",
  updateUser: "userId",
  confirmArtifactUpload: "artifactId",
  approveArtifact: "artifactId",
  downloadArtifact: "artifactId",
  previewArtifactForReview: "artifactId",
  rejectArtifact: "artifactId",
  deleteArtifact: "artifactId",
  saveRecurringBill: "scheduleId",
  setRecurringBillActive: "scheduleId",
};

export const diagnosticInputIds = (
  operation: string,
  data: unknown,
): DiagnosticIds => {
  if (!data || typeof data !== "object") return {};
  const input = data as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of [
    "transactionId",
    "artifactId",
    "credentialId",
    "scheduleId",
    "reviewId",
    "bankTransactionId",
    "transactionIds",
    "artifactIds",
  ])
    result[key] = input[key];
  const alias = idAliases[operation];
  if (alias) result[alias] = input.id;
  return result as DiagnosticIds;
};

export const serverFailureMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next, serverFnMeta, data }) =>
  runWithDiagnosticContext(
    {
      operation: serverFnMeta.name ?? "server_function",
      ids: diagnosticInputIds(serverFnMeta.name ?? "", data),
    },
    async () => {
      try {
        return await next();
      } catch (error) {
        if (isRedirect(error) || isNotFound(error)) throw error;
        const handled = reportServerFailure(error, {
          operation: serverFnMeta.name ?? "server_function",
        });
        setResponseStatus(handled.status);
        setResponseHeader(
          "x-folio-error-reference",
          handled.publicFailure.reference,
        );
        throw new HandledOperationError(handled, error);
      }
    },
  ),
);

export const requestFailureMiddleware = createMiddleware().server(
  async ({ next, request }) =>
    runWithDiagnosticContext(
      { operation: "server_request", request },
      async () => {
        try {
          const result = await next();
          const response = result.response;
          if (
            response.status < 400 ||
            response.headers.has("x-folio-error-reference")
          )
            return result;
          const handled = reportServerFailure(
            new AppError({
              code:
                response.status >= 500
                  ? "UNEXPECTED_ERROR"
                  : "REQUEST_REJECTED",
              stage: "http_response",
            }),
            {
              operation: "server_request",
              request,
              metadata: { httpStatus: response.status },
            },
          );
          const headers = new Headers(response.headers);
          headers.set(
            "x-folio-error-reference",
            handled.publicFailure.reference,
          );
          return {
            ...result,
            response: new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers,
            }),
          };
        } catch (error) {
          if (isRedirect(error) || isNotFound(error)) throw error;
          const handled = reportServerFailure(error, {
            operation: "server_request",
            request,
          });
          return new Response(
            `${handled.publicFailure.message} Reference ${handled.publicFailure.reference}.`,
            {
              status: handled.status,
              headers: {
                "content-type": "text/plain; charset=utf-8",
                "cache-control": "no-store",
                "x-folio-error-reference": handled.publicFailure.reference,
              },
            },
          );
        }
      },
    ),
);
