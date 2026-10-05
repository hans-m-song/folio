import { createFileRoute } from "@tanstack/react-router";

import { AppError, OperationCleanupError } from "../../domain/errors";
import { cookieValue, sessionCookie } from "../../auth/http";
import {
  reportServerFailure,
  runWithDiagnosticContext,
  setDiagnosticContext,
  writeServerSuccess,
} from "../../server/error-handling";
import { runtime } from "../../server/runtime";

const noStoreHeaders = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
};

const failureResponse = (error: unknown): Response => {
  const reported = reportServerFailure(error, { operation: "auth_callback" });
  return new Response(
    `${reported.publicFailure.message} Code ${reported.publicFailure.code}. Reference ${reported.publicFailure.reference}.`,
    {
      status: reported.status,
      headers: {
        ...noStoreHeaders,
        "content-type": "text/plain; charset=utf-8",
        "x-folio-error-reference": reported.publicFailure.reference,
      },
    },
  );
};

const routeFailure = (
  error: unknown,
  stage: string,
): AppError | OperationCleanupError =>
  error instanceof AppError || error instanceof OperationCleanupError
    ? error
    : new AppError({ code: "UNEXPECTED_ERROR", stage, cause: error });

export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        runWithDiagnosticContext({ operation: "auth_callback" }, async () => {
          let current: ReturnType<typeof runtime>;
          try {
            current = runtime();
          } catch (error) {
            return failureResponse(
              new AppError({
                code: "AUTH_CONFIGURATION_INVALID",
                stage: "runtime_init",
                cause: error,
              }),
            );
          }

          const cookieName = current.authConfig.sessionCookieName;
          try {
            const incoming = new URL(request.url);
            const callbackUrl = new URL(
              `/auth/callback${incoming.search}`,
              current.authConfig.origin,
            );
            const result = await current.auth.complete(
              callbackUrl,
              cookieValue(request, cookieName),
            );
            setDiagnosticContext({
              ids: { actorId: result.user.id, userId: result.user.id },
            });
            const response = new Response(null, {
              status: 303,
              headers: {
                location: new URL(result.returnPath, current.authConfig.origin)
                  .href,
                "set-cookie": sessionCookie({
                  name: cookieName,
                  value: result.sessionToken,
                  secure: current.authConfig.secureCookie,
                  maxAgeSeconds: current.authConfig.sessionLifetimeMs / 1000,
                }),
                ...noStoreHeaders,
              },
            });
            writeServerSuccess({
              operation: "auth_callback",
              stage: "session_created",
              mutation: true,
              ids: { actorId: result.user.id, userId: result.user.id },
            });
            return response;
          } catch (error) {
            return failureResponse(routeFailure(error, "callback_route"));
          }
        }),
    },
  },
});
