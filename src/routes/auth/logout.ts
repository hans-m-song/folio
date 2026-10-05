import { createFileRoute } from "@tanstack/react-router";

import { AppError, OperationCleanupError } from "../../domain/errors";
import { clearedSessionCookie, cookieValue } from "../../auth/http";
import {
  reportServerFailure,
  runWithDiagnosticContext,
  writeServerSuccess,
} from "../../server/error-handling";
import { runtime } from "../../server/runtime";

const noStoreHeaders = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
};

const failureResponse = (error: unknown): Response => {
  const reported = reportServerFailure(error, { operation: "auth_logout" });
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

const routeFailure = (error: unknown): AppError | OperationCleanupError =>
  error instanceof AppError || error instanceof OperationCleanupError
    ? error
    : new AppError({
        code: "UNEXPECTED_ERROR",
        stage: "logout_route",
        cause: error,
      });

export const Route = createFileRoute("/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        runWithDiagnosticContext({ operation: "auth_logout" }, async () => {
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

          try {
            const cookieName = current.authConfig.sessionCookieName;
            const token = cookieValue(request, cookieName);
            await current.auth.logout(token);
            if (token) {
              writeServerSuccess({
                operation: "auth_logout",
                stage: "session_revoked",
                mutation: true,
              });
            }
            return new Response(null, {
              status: 303,
              headers: {
                location: new URL("/", current.authConfig.origin).href,
                "set-cookie": clearedSessionCookie(
                  cookieName,
                  current.authConfig.secureCookie,
                ),
                ...noStoreHeaders,
              },
            });
          } catch (error) {
            return failureResponse(routeFailure(error));
          }
        }),
    },
  },
});
