import { beforeEach, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({
  authConfig: {
    nodeEnv: "production",
    authMode: "google",
    localPassword: null,
    origin: "https://folio.buildsight.com.au",
    sessionCookieName: "__Host-folio_session",
    secureCookie: true,
    sessionLifetimeMs: 43_200_000,
  },
  auth: {
    begin: vi.fn(),
    authenticateLocal: vi.fn(),
    complete: vi.fn(),
    logout: vi.fn(),
  },
}));

vi.mock("../../server/runtime", () => ({ runtime: () => current }));

import { Route as CallbackRoute } from "./callback";
import { Route as LoginRoute } from "./login";
import { Route as LogoutRoute } from "./logout";
import { InvalidAuthenticationResponseError } from "../../auth/service";

type TestRouteHandler = (context: { request: Request }) => Promise<Response>;

const callback = (
  CallbackRoute.options.server?.handlers as { GET: TestRouteHandler }
).GET;
const logout = (
  LogoutRoute.options.server?.handlers as { POST: TestRouteHandler }
).POST;
const loginGet = (
  LoginRoute.options.server?.handlers as { GET: TestRouteHandler }
).GET;
const loginPost = (
  LoginRoute.options.server?.handlers as { POST: TestRouteHandler }
).POST;

describe("authentication HTTP routes", () => {
  beforeEach(() => {
    Object.assign(current.authConfig, {
      nodeEnv: "production",
      authMode: "google",
      localPassword: null,
      origin: "https://folio.buildsight.com.au",
      sessionCookieName: "__Host-folio_session",
      secureCookie: true,
      sessionLifetimeMs: 43_200_000,
    });
    current.auth.begin.mockReset();
    current.auth.authenticateLocal.mockReset();
    current.auth.complete.mockReset();
    current.auth.logout.mockReset();
  });

  it("keeps Google mode login GET as an authorization redirect", async () => {
    current.auth.begin.mockResolvedValueOnce(
      new URL("https://accounts.google.com/o/oauth2/v2/auth?state=state"),
    );

    const response = await loginGet({
      request: new Request(
        "https://folio.buildsight.com.au/auth/login?return_to=%2Ftransactions",
      ),
    });

    expect(current.auth.begin).toHaveBeenCalledWith("/transactions");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?state=state",
    );
  });

  it("shows a local development password form without exposing its password", async () => {
    Object.assign(current.authConfig, {
      nodeEnv: "development",
      authMode: "local",
      localPassword: "synthetic-local-password",
      origin: "http://127.0.0.1:43230",
      sessionCookieName: "folio_dev_session",
      secureCookie: false,
    });

    const response = await loginGet({
      request: new Request(
        "http://127.0.0.1:43230/auth/login?return_to=%2Freports%3Fperiod%3D2026%26view%3Dmonth",
      ),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toContain("Local development only");
    expect(body).toContain('type="password"');
    expect(body).toContain('value="/reports?period=2026&amp;view=month"');
    expect(body).not.toContain("synthetic-local-password");
    expect(current.auth.begin).not.toHaveBeenCalled();
  });

  it("creates a local session, rotates the old cookie, and returns safely", async () => {
    Object.assign(current.authConfig, {
      nodeEnv: "development",
      authMode: "local",
      localPassword: "synthetic-local-password",
      origin: "http://127.0.0.1:43230",
      sessionCookieName: "folio_dev_session",
      secureCookie: false,
    });
    current.auth.authenticateLocal.mockResolvedValueOnce({
      sessionToken: "new-local-session",
      user: {},
    });
    const body = new URLSearchParams({
      password: "synthetic-local-password",
      return_to: "/reports?period=2026",
    });

    const response = await loginPost({
      request: new Request("http://127.0.0.1:43230/auth/login", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:43230",
          cookie: "folio_dev_session=old-local-session",
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      }),
    });

    expect(current.auth.authenticateLocal).toHaveBeenCalledWith(
      "synthetic-local-password",
      "old-local-session",
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:43230/reports?period=2026",
    );
    expect(response.headers.get("set-cookie")).toBe(
      "folio_dev_session=new-local-session; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200",
    );
  });

  it("rejects cross-origin local form posts before checking credentials", async () => {
    Object.assign(current.authConfig, {
      nodeEnv: "development",
      authMode: "local",
      localPassword: "synthetic-local-password",
      origin: "http://127.0.0.1:43230",
      sessionCookieName: "folio_dev_session",
      secureCookie: false,
    });
    const response = await loginPost({
      request: new Request("http://127.0.0.1:43230/auth/login", {
        method: "POST",
        headers: {
          origin: "http://attacker.example",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ password: "wrong" }),
      }),
    });

    expect(response.status).toBe(403);
    expect(current.auth.authenticateLocal).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps local login unavailable in Google mode and hides credential errors", async () => {
    const googleModeResponse = await loginPost({
      request: new Request("https://folio.buildsight.com.au/auth/login", {
        method: "POST",
      }),
    });
    expect(googleModeResponse.status).toBe(404);

    Object.assign(current.authConfig, {
      nodeEnv: "development",
      authMode: "local",
      localPassword: "synthetic-local-password",
      origin: "http://127.0.0.1:43230",
      sessionCookieName: "folio_dev_session",
      secureCookie: false,
    });
    current.auth.authenticateLocal.mockRejectedValueOnce(
      new InvalidAuthenticationResponseError(),
    );
    const password = "incorrect-local-password";
    const response = await loginPost({
      request: new Request("http://127.0.0.1:43230/auth/login", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:43230",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ password }),
      }),
    });
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(body).toBe("Authentication failed");
    expect(body).not.toContain(password);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sets the production session cookie after a valid callback", async () => {
    current.auth.complete.mockResolvedValueOnce({
      sessionToken: "new-opaque-session",
      returnPath: "/reports?period=2026",
      user: {},
    });
    const request = new Request(
      "https://untrusted-host.example/auth/callback?code=code&state=state",
      { headers: { cookie: "__Host-folio_session=old-session" } },
    );

    const response = await callback({ request });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://folio.buildsight.com.au/reports?period=2026",
    );
    expect(response.headers.get("set-cookie")).toBe(
      "__Host-folio_session=new-opaque-session; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure",
    );
    expect(current.auth.complete).toHaveBeenCalledWith(
      new URL(
        "https://folio.buildsight.com.au/auth/callback?code=code&state=state",
      ),
      "old-session",
    );
  });

  it("returns a non-disclosing failure without replacing the cookie", async () => {
    current.auth.complete.mockRejectedValueOnce(new Error("synthetic failure"));

    const response = await callback({
      request: new Request(
        "https://folio.buildsight.com.au/auth/callback?code=bad&state=bad",
      ),
    });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Authentication failed");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("revokes the presented session and clears the cookie on POST logout", async () => {
    current.auth.logout.mockResolvedValueOnce(undefined);
    const response = await logout({
      request: new Request("https://folio.buildsight.com.au/auth/logout", {
        method: "POST",
        headers: { cookie: "__Host-folio_session=opaque-session" },
      }),
    });

    expect(current.auth.logout).toHaveBeenCalledWith("opaque-session");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://folio.buildsight.com.au/",
    );
    expect(response.headers.get("set-cookie")).toBe(
      "__Host-folio_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    );
  });
});
