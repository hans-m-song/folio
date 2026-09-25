import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

import { runtime } from "../server/runtime";

export const getCurrentSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const current = runtime();
    const user = await current.auth.session(
      getCookie(current.authConfig.sessionCookieName) ?? null,
    );
    return user
      ? { authenticated: true as const, user }
      : { authenticated: false as const };
  },
);
