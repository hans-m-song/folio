import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

import { AppError } from "../domain/errors";
import { runOperation } from "../server/diagnostics";
import { runtime } from "../server/runtime";

export const getCurrentSession = createServerFn({ method: "GET" }).handler(
  async () =>
    runOperation(
      "auth_session",
      async () => {
        let current: ReturnType<typeof runtime>;
        try {
          current = runtime();
        } catch (error) {
          throw new AppError({
            code: "AUTH_CONFIGURATION_INVALID",
            stage: "runtime_init",
            cause: error,
          });
        }

        try {
          const user = await current.auth.session(
            getCookie(current.authConfig.sessionCookieName) ?? null,
          );
          return user
            ? { authenticated: true as const, user }
            : { authenticated: false as const };
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError({
            code: "UNEXPECTED_ERROR",
            stage: "session_lookup",
            cause: error,
          });
        }
      },
      {},
      { log: "failures" },
    ),
);
