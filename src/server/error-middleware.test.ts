import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { redirect } from "@tanstack/react-router";

const response = vi.hoisted(() => ({ status: vi.fn(), header: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createMiddleware: () => ({ server: (handler: unknown) => handler }),
}));
vi.mock("@tanstack/react-start/server", () => ({
  setResponseStatus: response.status,
  setResponseHeader: response.header,
}));

import { AppError } from "../domain/errors";
import { reportServerFailure } from "./error-handling";
import {
  diagnosticInputIds,
  requestFailureMiddleware,
  serverFailureMiddleware,
} from "./error-middleware";

const actorId = "11111111-1111-4111-8111-111111111111";
const transactionId = "22222222-2222-4222-8222-222222222222";
const callFunction = serverFailureMiddleware as unknown as (input: {
  next: () => Promise<unknown>;
  data?: unknown;
  serverFnMeta: { name: string };
}) => Promise<unknown>;
const callRequest = requestFailureMiddleware as unknown as (input: {
  next: () => Promise<{ response: Response }>;
  request: Request;
}) => Promise<Response | { response: Response }>;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("server-function failure middleware", () => {
  it("reports validation failure before a handler executes without recording submitted values", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const secret = "synthetic-sensitive-input";
    const action = callFunction({
      serverFnMeta: { name: "saveManualTransaction" },
      data: { id: transactionId, actorId, description: secret },
      next: async () =>
        z.object({ amount: z.number() }).parse({ amount: secret }),
    });
    await expect(action).rejects.toMatchObject({
      publicFailure: { code: "INPUT_INVALID", recovery: "fix_input" },
    });
    const event = JSON.parse(log.mock.calls[0]![0]);
    expect(event).toMatchObject({ code: "INPUT_INVALID", transactionId });
    expect(event).not.toHaveProperty("actorId");
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.header).toHaveBeenCalledWith(
      "x-folio-error-reference",
      event.correlationId,
    );
  });

  it("retains one reference across operation and framework handlers without exposing a raw cause", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fault = new Error("synthetic-provider-secret");
    const reported = reportServerFailure(fault, {
      operation: "save_transaction",
    });
    try {
      await callFunction({
        serverFnMeta: { name: "saveManualTransaction" },
        next: async () => {
          throw fault;
        },
      });
      expect.fail("Expected rejection");
    } catch (error) {
      expect(error).toMatchObject({
        publicFailure: { reference: reported.publicFailure.reference },
      });
      expect(error).not.toHaveProperty("cause");
      expect(JSON.stringify(error)).not.toContain("synthetic-provider-secret");
    }
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("does not treat redirect or not-found control flow as an operation fault", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const navigation = redirect({ to: "/auth/login" });
    await expect(
      callFunction({
        serverFnMeta: { name: "privateGate" },
        next: async () => {
          throw navigation;
        },
      }),
    ).rejects.toBe(navigation);
    expect(log).not.toHaveBeenCalled();
  });

  it("ignores client actor identity and unrelated fields when extracting resource IDs", () => {
    expect(
      diagnosticInputIds("getTransaction", {
        id: transactionId,
        actorId,
        email: "synthetic-private",
      }),
    ).toMatchObject({ transactionId });
    expect(
      diagnosticInputIds("getTransaction", { actorId }),
    ).not.toHaveProperty("actorId");
  });
});

describe("request failure middleware", () => {
  const request = new Request(
    "https://synthetic.invalid/auth/callback?code=synthetic-secret",
  );

  it("logs rejected HTTP responses while preserving their protocol and body", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = new Response("CSRF rejected", { status: 403 });
    const result = await callRequest({
      request,
      next: async () => ({ response: original }),
    });
    const returned = (result as { response: Response }).response;
    expect(returned.status).toBe(403);
    expect(await returned.text()).toBe("CSRF rejected");
    const event = JSON.parse(log.mock.calls[0]![0]);
    expect(event).toMatchObject({
      code: "REQUEST_REJECTED",
      httpStatus: 403,
      requestPath: "/auth/callback",
    });
    expect(returned.headers.get("x-folio-error-reference")).toBe(
      event.correlationId,
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-secret");
  });

  it("does not log previously reported responses again", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = new Response("Already reported", {
      status: 401,
      headers: { "x-folio-error-reference": actorId },
    });
    const result = await callRequest({
      request,
      next: async () => ({ response: original }),
    });
    expect((result as { response: Response }).response).toBe(original);
    expect(log).not.toHaveBeenCalled();
  });

  it("returns a safe reference on an uncaught route fault and stays quiet on successful reads", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await callRequest({
      request,
      next: async () => {
        throw new AppError({
          code: "UNEXPECTED_ERROR",
          cause: new Error("synthetic-secret"),
        });
      },
    });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(500);
    expect(await (result as Response).text()).not.toContain("synthetic-secret");
    expect(log).toHaveBeenCalledTimes(1);
    await callRequest({
      request,
      next: async () => ({ response: new Response("ok") }),
    });
    expect(log).toHaveBeenCalledTimes(1);
  });
});
