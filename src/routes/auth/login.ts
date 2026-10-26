import { createFileRoute } from "@tanstack/react-router";

import { AppError, OperationCleanupError } from "../../domain/errors";
import { cookieValue, safeReturnPath, sessionCookie } from "../../auth/http";
import {
  reportServerFailure,
  runWithDiagnosticContext,
  setDiagnosticContext,
  writeServerSuccess,
} from "../../server/error-handling";
import { summarizeInputException } from "../../server/error-details";
import { runtime } from "../../server/runtime";

const noStoreHeaders = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
};

const escapedAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const localLoginPage = (returnPath: string): string => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in · Folio</title></head>
  <body>
    <main>
      <p>Local development only</p>
      <h1>Sign in to Folio</h1>
      <form method="post" action="/auth/login">
        <input type="hidden" name="return_to" value="${escapedAttribute(returnPath)}">
        <label for="password">Local password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <button type="submit">Sign in</button>
      </form>
    </main>
  </body>
</html>`;

const isSameOriginRequest = (request: Request, origin: string): boolean =>
  request.headers.get("origin") === origin;

const failureResponse = (error: unknown, status?: number): Response => {
  const reported = reportServerFailure(error, {
    operation: "auth_login",
    metadata: status === undefined ? undefined : { httpStatus: status },
  });
  return new Response(
    `${reported.publicFailure.message} Code ${reported.publicFailure.code}. Reference ${reported.publicFailure.reference}.`,
    {
      status: status ?? reported.status,
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

export const Route = createFileRoute("/auth/login")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        runWithDiagnosticContext({ operation: "auth_login" }, async () => {
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
            const requestUrl = new URL(request.url);
            if (current.authConfig.authMode === "local") {
              if (current.authConfig.nodeEnv === "production")
                return new Response("Not found", {
                  status: 404,
                  headers: noStoreHeaders,
                });
              const returnPath = safeReturnPath(
                requestUrl.searchParams.get("return_to"),
                current.authConfig.origin,
              );
              return new Response(localLoginPage(returnPath), {
                headers: {
                  ...noStoreHeaders,
                  "content-type": "text/html; charset=utf-8",
                },
              });
            }
            const authorizationUrl = await current.auth.begin(
              requestUrl.searchParams.get("return_to"),
            );
            return new Response(null, {
              status: 302,
              headers: {
                location: authorizationUrl.href,
                ...noStoreHeaders,
              },
            });
          } catch (error) {
            return failureResponse(routeFailure(error, "login_begin"));
          }
        }),
      POST: async ({ request }) =>
        runWithDiagnosticContext({ operation: "auth_login" }, async () => {
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

          if (
            current.authConfig.authMode !== "local" ||
            current.authConfig.nodeEnv === "production"
          )
            return new Response("Not found", {
              status: 404,
              headers: noStoreHeaders,
            });
          if (!isSameOriginRequest(request, current.authConfig.origin))
            return failureResponse(
              new AppError({
                code: "AUTH_LOGIN_REQUEST_INVALID",
                stage: "origin_check",
              }),
              403,
            );
          if (
            request.headers
              .get("content-type")
              ?.split(";", 1)[0]
              ?.trim()
              .toLowerCase() !== "application/x-www-form-urlencoded"
          ) {
            return failureResponse(
              new AppError({
                code: "AUTH_LOGIN_REQUEST_INVALID",
                stage: "content_type",
              }),
              415,
            );
          }

          let form: FormData;
          try {
            form = await request.formData();
          } catch (error) {
            return failureResponse(
              new AppError({
                code: "AUTH_LOGIN_REQUEST_INVALID",
                stage: "form_parse",
                cause: summarizeInputException(error),
              }),
              400,
            );
          }
          const password = form.get("password");
          if (typeof password !== "string")
            return failureResponse(
              new AppError({
                code: "AUTH_LOGIN_REQUEST_INVALID",
                stage: "form_fields",
              }),
              400,
            );

          const cookieName = current.authConfig.sessionCookieName;
          try {
            const result = await current.auth.authenticateLocal(
              password,
              cookieValue(request, cookieName),
            );
            setDiagnosticContext({
              ids: { actorId: result.user.id, userId: result.user.id },
            });
            const returnTo = form.get("return_to");
            const returnPath = safeReturnPath(
              typeof returnTo === "string" ? returnTo : null,
              current.authConfig.origin,
            );
            const response = new Response(null, {
              status: 303,
              headers: {
                location: new URL(returnPath, current.authConfig.origin).href,
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
              operation: "auth_login",
              stage: "session_created",
              mutation: true,
              ids: { actorId: result.user.id, userId: result.user.id },
            });
            return response;
          } catch (error) {
            return failureResponse(routeFailure(error, "local_login"));
          }
        }),
    },
  },
});
