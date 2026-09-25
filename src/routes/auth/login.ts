import { createFileRoute } from "@tanstack/react-router";

import { cookieValue, safeReturnPath, sessionCookie } from "../../auth/http";
import { AuthenticationRejectedError } from "../../database/auth-repository";
import { InvalidAuthenticationResponseError } from "../../auth/service";
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

export const Route = createFileRoute("/auth/login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const current = runtime();
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
      },
      POST: async ({ request }) => {
        const current = runtime();
        if (
          current.authConfig.authMode !== "local" ||
          current.authConfig.nodeEnv === "production"
        )
          return new Response("Not found", {
            status: 404,
            headers: noStoreHeaders,
          });
        if (!isSameOriginRequest(request, current.authConfig.origin))
          return new Response("Forbidden", {
            status: 403,
            headers: noStoreHeaders,
          });
        if (
          request.headers
            .get("content-type")
            ?.split(";", 1)[0]
            ?.trim()
            .toLowerCase() !== "application/x-www-form-urlencoded"
        ) {
          return new Response("Unsupported form submission", {
            status: 415,
            headers: noStoreHeaders,
          });
        }

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return new Response("Invalid form submission", {
            status: 400,
            headers: noStoreHeaders,
          });
        }
        const password = form.get("password");
        if (typeof password !== "string")
          return new Response("Invalid form submission", {
            status: 400,
            headers: noStoreHeaders,
          });

        const cookieName = current.authConfig.sessionCookieName;
        try {
          const result = await current.auth.authenticateLocal(
            password,
            cookieValue(request, cookieName),
          );
          const returnTo = form.get("return_to");
          const returnPath = safeReturnPath(
            typeof returnTo === "string" ? returnTo : null,
            current.authConfig.origin,
          );
          return new Response(null, {
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
        } catch (error) {
          if (
            error instanceof InvalidAuthenticationResponseError ||
            error instanceof AuthenticationRejectedError
          ) {
            return new Response("Authentication failed", {
              status: 401,
              headers: noStoreHeaders,
            });
          }
          return new Response("Authentication unavailable", {
            status: 500,
            headers: noStoreHeaders,
          });
        }
      },
    },
  },
});
