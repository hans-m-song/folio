import { createFileRoute } from "@tanstack/react-router";

import { cookieValue, sessionCookie } from "../../auth/http";
import { runtime } from "../../server/runtime";

export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const current = runtime();
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
          return new Response(null, {
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
              "cache-control": "private, no-store, max-age=0",
              pragma: "no-cache",
            },
          });
        } catch {
          return new Response("Authentication failed", {
            status: 401,
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "private, no-store, max-age=0",
              pragma: "no-cache",
            },
          });
        }
      },
    },
  },
});
