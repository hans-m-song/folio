import { createFileRoute } from "@tanstack/react-router";

import { clearedSessionCookie, cookieValue } from "../../auth/http";
import { runtime } from "../../server/runtime";

export const Route = createFileRoute("/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const current = runtime();
        const cookieName = current.authConfig.sessionCookieName;
        await current.auth.logout(cookieValue(request, cookieName));
        return new Response(null, {
          status: 303,
          headers: {
            location: new URL("/", current.authConfig.origin).href,
            "set-cookie": clearedSessionCookie(
              cookieName,
              current.authConfig.secureCookie,
            ),
            "cache-control": "private, no-store, max-age=0",
            pragma: "no-cache",
          },
        });
      },
    },
  },
});
