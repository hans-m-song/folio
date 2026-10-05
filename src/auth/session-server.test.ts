import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({
  authConfig: { sessionCookieName: "folio_session" },
  auth: { session: vi.fn() },
  runtime: vi.fn(),
}));

const server = vi.hoisted(() => ({
  getCookie: vi.fn(),
  getRequest: vi.fn(
    () => new Request("https://folio.buildsight.com.au/transactions"),
  ),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler(callback: () => Promise<unknown>) {
      return callback;
    },
  }),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: server.getCookie,
  getRequest: server.getRequest,
  setResponseStatus: vi.fn(),
}));

vi.mock("../server/runtime", () => ({ runtime: current.runtime }));

import { getCurrentSession } from "./session-server";

describe("current session server function", () => {
  beforeEach(() => {
    current.runtime.mockReset().mockReturnValue(current);
    current.auth.session.mockReset();
    server.getCookie.mockReset().mockReturnValue(null);
    server.getRequest.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps anonymous sessions quiet", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const warningLog = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoLog = vi.spyOn(console, "info").mockImplementation(() => {});
    current.auth.session.mockResolvedValueOnce(null);

    await expect(getCurrentSession()).resolves.toEqual({
      authenticated: false,
    });
    expect(errorLog).not.toHaveBeenCalled();
    expect(warningLog).not.toHaveBeenCalled();
    expect(infoLog).not.toHaveBeenCalled();
  });

  it("logs session lookup faults with a safe reference and stage", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const privateValue = "private-session-and-identity-value";
    server.getCookie.mockReturnValueOnce(privateValue);
    current.auth.session.mockRejectedValueOnce(new Error(privateValue));

    const failure = getCurrentSession();
    await expect(failure).rejects.toMatchObject({
      name: "HandledOperationError",
      publicFailure: {
        code: "UNEXPECTED_ERROR",
        reference: expect.any(String),
      },
    });

    const line = String(errorLog.mock.calls[0]?.[0]);
    expect(line).toContain('"operation":"auth_session"');
    expect(line).toContain('"stage":"session_lookup"');
    expect(line).not.toContain(privateValue);
    expect(line).not.toContain("Error");
  });

  it("logs runtime initialization faults without attempting a session lookup", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const privateValue = "private-runtime-failure-value";
    current.runtime.mockImplementationOnce(() => {
      throw new Error(privateValue);
    });

    await expect(getCurrentSession()).rejects.toMatchObject({
      name: "HandledOperationError",
      publicFailure: {
        code: "SIGN_IN_FAILED",
        reference: expect.any(String),
      },
    });
    expect(current.auth.session).not.toHaveBeenCalled();
    const line = String(errorLog.mock.calls[0]?.[0]);
    expect(line).toContain('"operation":"auth_session"');
    expect(line).toContain('"stage":"runtime_init"');
    expect(line).not.toContain(privateValue);
  });
});
