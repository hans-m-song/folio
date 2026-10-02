import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpPrincipal } from "../mcp/server";

const dependencies = vi.hoisted(() => ({
  loadAuthConfig: vi.fn(() => ({ origin: "http://127.0.0.1:43230" })),
  createMcpRuntime: vi.fn(() => ({
    verifyCredential: vi.fn(
      async (): Promise<McpPrincipal | undefined> => undefined,
    ),
    registerTools: vi.fn(),
  })),
  createFolioMcpHandler: vi.fn(() => ({
    fetch: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("../config", () => ({ loadAuthConfig: dependencies.loadAuthConfig }));
vi.mock("../mcp/runtime", () => ({
  createMcpRuntime: dependencies.createMcpRuntime,
}));
vi.mock("../mcp/server", async (importOriginal) => ({
  ...(await importOriginal()),
  createFolioMcpHandler: dependencies.createFolioMcpHandler,
}));

import { Route } from "./mcp";

type TestRouteHandler = (context: { request: Request }) => Promise<Response>;

const post = (Route.options.server?.handlers as { POST: TestRouteHandler })
  .POST;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("MCP route feature flag", () => {
  it("returns 404 without constructing the MCP runtime when disabled", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.stubEnv("FOLIO_MCP_ENABLED", "false");
    const response = await post({
      request: new Request("http://127.0.0.1:43230/mcp", {
        method: "POST",
        headers: { host: "127.0.0.1:43230" },
      }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(dependencies.createMcpRuntime).not.toHaveBeenCalled();
    expect(dependencies.loadAuthConfig).not.toHaveBeenCalled();
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
      event: "folio.mcp_request",
      requestMethod: "POST",
      requestPath: "/mcp",
      status: 404,
      stage: "disabled",
    });
  });

  it("logs successful requests only when MCP success logging is enabled", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("FOLIO_MCP_ENABLED", "true");
    vi.stubEnv("FOLIO_MCP_LOG_SUCCESS", "true");
    dependencies.createMcpRuntime.mockReturnValueOnce({
      verifyCredential: vi.fn(async () => ({
        credentialId: "credential-test",
        actorUserId: "actor-test",
        defaultOwnerId: "owner-test",
        scopes: [],
      })),
      registerTools: vi.fn(),
    });
    dependencies.createFolioMcpHandler.mockReturnValueOnce({
      fetch: vi.fn(async () => Response.json({ result: "ok" })),
      close: vi.fn(),
    });

    const response = await post({
      request: new Request("http://127.0.0.1:43230/mcp", {
        method: "POST",
        headers: {
          host: "127.0.0.1:43230",
          authorization: "Bearer synthetic-test-credential",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(info.mock.calls[0][0])).toMatchObject({
      event: "folio.mcp_request",
      mcpMethod: "tools/list",
      status: 200,
    });
    expect(JSON.parse(info.mock.calls[0][0])).not.toHaveProperty("stage");
  });
});
