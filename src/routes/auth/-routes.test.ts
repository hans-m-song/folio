import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  runtime: vi.fn(),
}));

vi.mock("../../server/runtime", () => ({ runtime: current.runtime }));

import { Route as CallbackRoute } from "./callback";
import { Route as LoginRoute } from "./login";
import { Route as LogoutRoute } from "./logout";
import { InvalidAuthenticationResponseError } from "../../auth/service";
import { AppError } from "../../domain/errors";

type TestRouteHandler = (context: { request: Request }) => Promise<Response>;
const userId = "00000000-0000-4000-8000-000000000001";

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
    current.runtime.mockReset().mockReturnValue(current);
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
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
      user: { id: userId, email: "private-operator@example.test" },
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
    const successLog = String(vi.mocked(console.log).mock.calls[0]?.[0]);
    expect(successLog).toContain('"operation":"auth_login"');
    expect(successLog).toContain('"stage":"session_created"');
    expect(successLog).toContain(`"actorId":"${userId}"`);
    expect(successLog).toContain(`"userId":"${userId}"`);
    expect(successLog).not.toContain("private-operator@example.test");
    expect(successLog).not.toContain("new-local-session");
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
      new InvalidAuthenticationResponseError(
        "AUTH_CREDENTIALS_INVALID",
        "local_credentials",
      ),
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
    expect(body).toMatch(
      /^Sign-in failed\. Try signing in again\. Code SIGN_IN_FAILED\. Reference [0-9a-f-]+\.$/,
    );
    expect(body).not.toContain(password);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-folio-error-reference")).toMatch(
      /^[0-9a-f-]+$/,
    );
    const warningLog = String(vi.mocked(console.warn).mock.calls[0]?.[0]);
    expect(warningLog).toContain('"stage":"local_credentials"');
    expect(warningLog).not.toContain(password);

    current.auth.authenticateLocal.mockRejectedValueOnce(
      new AppError({
        code: "AUTH_USER_NOT_ELIGIBLE",
        stage: "user_eligibility",
      }),
    );
    const unknownAccountResponse = await loginPost({
      request: new Request("http://127.0.0.1:43230/auth/login", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:43230",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ password: "unknown-account-password" }),
      }),
    });
    const unknownAccountBody = await unknownAccountResponse.text();
    expect(unknownAccountResponse.status).toBe(401);
    expect(unknownAccountBody.split(" Reference ", 1)[0]).toBe(
      body.split(" Reference ", 1)[0],
    );
    expect(unknownAccountBody).not.toContain("unknown-account-password");
  });

  it("sets the production session cookie after a valid callback", async () => {
    current.auth.complete.mockResolvedValueOnce({
      sessionToken: "new-opaque-session",
      returnPath: "/reports?period=2026",
      user: { id: userId, email: "private-operator@example.test" },
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
    const successLog = String(vi.mocked(console.log).mock.calls[0]?.[0]);
    expect(successLog).toContain('"operation":"auth_callback"');
    expect(successLog).toContain(`"actorId":"${userId}"`);
    expect(successLog).toContain(`"userId":"${userId}"`);
    expect(successLog).not.toContain("private-operator@example.test");
    expect(successLog).not.toContain("new-opaque-session");
  });

  it("returns a correlated system failure with status 503", async () => {
    const privateValue = "synthetic-provider-private-value";
    current.auth.complete.mockRejectedValueOnce(
      new AppError({
        code: "AUTH_PROVIDER_UNAVAILABLE",
        stage: "code_exchange",
        cause: new Error(privateValue),
      }),
    );

    const response = await callback({
      request: new Request(
        "https://folio.buildsight.com.au/auth/callback?code=bad&state=bad",
      ),
    });

    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).toContain("Reference ");
    expect(body).not.toContain(privateValue);
    expect(response.headers.get("x-folio-error-reference")).toMatch(
      /^[0-9a-f-]+$/,
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    const errorLog = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(errorLog).toContain('"stage":"code_exchange"');
    expect(errorLog).toContain(privateValue);
  });

  it("keeps expected callback rejection at 401 with a generic reference", async () => {
    current.auth.complete.mockRejectedValueOnce(
      new InvalidAuthenticationResponseError(
        "AUTH_STATE_INVALID",
        "state_lookup",
      ),
    );

    const response = await callback({
      request: new Request(
        "https://folio.buildsight.com.au/auth/callback?code=bad&state=bad",
      ),
    });
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(body).toMatch(
      /^Sign-in failed\. Try signing in again\. Code SIGN_IN_FAILED\. Reference [0-9a-f-]+\.$/,
    );
    expect(response.headers.get("x-folio-error-reference")).toBeTruthy();
    const warningLog = String(vi.mocked(console.warn).mock.calls[0]?.[0]);
    expect(warningLog).toContain('"stage":"state_lookup"');
    expect(warningLog).not.toContain("?code=bad");
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
    const successLog = String(vi.mocked(console.log).mock.calls[0]?.[0]);
    expect(successLog).toContain('"operation":"auth_logout"');
    expect(successLog).toContain('"stage":"session_revoked"');
    expect(successLog).not.toContain("opaque-session");
  });

  it.each([
    [
      "origin_check",
      403,
      "http://attacker.example",
      "application/x-www-form-urlencoded",
      "password=private-body-value",
    ],
    [
      "content_type",
      415,
      "http://127.0.0.1:43230",
      "application/json",
      "private-body-value",
    ],
    [
      "form_fields",
      400,
      "http://127.0.0.1:43230",
      "application/x-www-form-urlencoded",
      "unexpected=private-body-value",
    ],
  ] as const)(
    "logs a safe login request rejection at %s",
    async (stage, status, origin, contentType, body) => {
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
          headers: { origin, "content-type": contentType },
          body,
        }),
      });
      const responseBody = await response.text();

      expect(response.status).toBe(status);
      expect(responseBody).toContain("Reference ");
      expect(response.headers.get("x-folio-error-reference")).toBeTruthy();
      expect(current.auth.authenticateLocal).not.toHaveBeenCalled();
      const warningLog = String(vi.mocked(console.warn).mock.calls[0]?.[0]);
      expect(warningLog).toContain(`"stage":"${stage}"`);
      expect(warningLog).not.toContain("private-body-value");
    },
  );

  it("logs malformed form parsing without recording the submitted body", async () => {
    Object.assign(current.authConfig, {
      nodeEnv: "development",
      authMode: "local",
      localPassword: "synthetic-local-password",
      origin: "http://127.0.0.1:43230",
      sessionCookieName: "folio_dev_session",
      secureCookie: false,
    });
    const request = new Request("http://127.0.0.1:43230/auth/login", {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:43230",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "private-body-value",
    });
    vi.spyOn(request, "formData").mockRejectedValueOnce(
      new Error("private-body-value"),
    );

    const response = await loginPost({ request });
    const body = await response.text();
    expect(response.status).toBe(400);
    expect(body).toContain("Reference ");
    expect(body).not.toContain("private-body-value");
    const warningLog = String(vi.mocked(console.warn).mock.calls[0]?.[0]);
    expect(warningLog).toContain('"stage":"form_parse"');
    expect(warningLog).toContain("Input parsing failed.");
    expect(warningLog).not.toContain("private-body-value");
  });

  it("logs runtime initialization failures for login, callback, and logout", async () => {
    const routeCases: Array<{
      operation: string;
      handler: TestRouteHandler;
      request: Request;
    }> = [
      {
        operation: "auth_login",
        handler: loginGet,
        request: new Request("https://folio.buildsight.com.au/auth/login"),
      },
      {
        operation: "auth_callback",
        handler: callback,
        request: new Request("https://folio.buildsight.com.au/auth/callback"),
      },
      {
        operation: "auth_logout",
        handler: logout,
        request: new Request("https://folio.buildsight.com.au/auth/logout", {
          method: "POST",
        }),
      },
    ];
    const privateValue = "private-runtime-value";

    for (const routeCase of routeCases) {
      current.runtime.mockImplementationOnce(() => {
        throw new Error(privateValue);
      });
      const response = await routeCase.handler({ request: routeCase.request });
      const body = await response.text();
      expect(response.status).toBe(500);
      expect(response.headers.get("x-folio-error-reference")).toBeTruthy();
      expect(body).toContain("Reference ");
      expect(body).not.toContain(privateValue);
    }

    const failureLogs = vi
      .mocked(console.error)
      .mock.calls.map(([line]) => String(line));
    expect(failureLogs).toHaveLength(routeCases.length);
    for (const [index, line] of failureLogs.entries()) {
      expect(line).toContain(`"operation":"${routeCases[index]?.operation}"`);
      expect(line).toContain('"stage":"runtime_init"');
      expect(line).toContain(privateValue);
    }
  });

  it("reports login start and logout system failures with references", async () => {
    const privateValue = "private-auth-system-value";
    current.auth.begin.mockRejectedValueOnce(
      new AppError({
        code: "AUTH_PROVIDER_UNAVAILABLE",
        stage: "authorization_url",
        cause: new Error(privateValue),
      }),
    );
    const startResponse = await loginGet({
      request: new Request("https://folio.buildsight.com.au/auth/login"),
    });
    expect(startResponse.status).toBe(503);
    expect(await startResponse.text()).not.toContain(privateValue);
    expect(startResponse.headers.get("x-folio-error-reference")).toBeTruthy();
    const startFailure = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(startFailure).toContain('"stage":"authorization_url"');
    expect(startFailure).toContain(privateValue);

    current.auth.logout.mockRejectedValueOnce(
      new AppError({
        code: "AUTH_LOGOUT_FAILED",
        stage: "logout_revocation",
        cause: new Error(privateValue),
      }),
    );
    const logoutResponse = await logout({
      request: new Request("https://folio.buildsight.com.au/auth/logout", {
        method: "POST",
        headers: { cookie: "__Host-folio_session=private-session-value" },
      }),
    });
    expect(logoutResponse.status).toBe(500);
    expect(await logoutResponse.text()).not.toContain(privateValue);
    expect(logoutResponse.headers.get("x-folio-error-reference")).toBeTruthy();
    const logoutFailure = String(vi.mocked(console.error).mock.calls[1]?.[0]);
    expect(logoutFailure).toContain('"stage":"logout_revocation"');
    expect(logoutFailure).toContain(privateValue);
    expect(logoutFailure).not.toContain("private-session-value");
  });
});
