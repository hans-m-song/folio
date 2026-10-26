import { describe, expect, it, vi } from "vitest";

import {
  createFolioMcpHandler,
  MCP_MAX_REQUEST_BODY_BYTES,
  type McpPrincipal,
} from "./server";
import { createMcpToolRegistrar, type McpToolDependencies } from "./tools";
import { createMcpWebEndpoint, mcpEnabled } from "./web";

const principal = {
  credentialId: "credential-test",
  actorUserId: "actor-test",
  defaultOwnerId: "owner-test",
  scopes: ["transactions:draft"] as const,
};

const origin = "http://127.0.0.1:43230";
const body = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "folio_ping",
    arguments: {},
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  },
});

const toolsListBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  },
});

const request = (
  options: {
    method?: string;
    host?: string;
    origin?: string;
    authorization?: string;
    body?: string;
    mcpMethod?: string;
  } = {},
) =>
  new Request(`${origin}/mcp`, {
    method: options.method ?? "POST",
    headers: {
      host: options.host ?? "127.0.0.1:43230",
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization:
        options.authorization ?? "Bearer synthetic-test-credential",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": options.mcpMethod ?? "tools/call",
      "mcp-name": "folio_ping",
      ...(options.origin ? { origin: options.origin } : {}),
    },
    ...(options.method === "GET" ? {} : { body: options.body ?? body }),
  });

describe("MCP web route boundary", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(mcpEnabled({})).toBe(false);
    expect(mcpEnabled({ FOLIO_MCP_ENABLED: "false" })).toBe(false);
    expect(mcpEnabled({ FOLIO_MCP_ENABLED: "TRUE" })).toBe(false);
    expect(mcpEnabled({ FOLIO_MCP_ENABLED: "true" })).toBe(true);
  });

  it("serves stateless MCP on the web origin and verifies each request", async () => {
    const verifyCredential = vi.fn(async () => principal);
    const handler = createFolioMcpHandler();
    const endpoint = createMcpWebEndpoint({
      expectedOrigin: origin,
      verifyCredential,
      handler,
    });
    try {
      const first = await endpoint(request());
      const second = await endpoint(request());
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await first.text()).toContain("pong");
      expect(first.headers.get("mcp-session-id")).toBeNull();
      expect(first.headers.get("cache-control")).toBe("no-store");
      expect(verifyCredential).toHaveBeenCalledTimes(2);
      expect(verifyCredential).toHaveBeenCalledWith(
        "synthetic-test-credential",
      );
    } finally {
      await handler.close();
    }
  });

  it("rebuilds the tool catalog from the scopes verified for each request", async () => {
    const token = "synthetic-test-credential";
    let scopes: McpPrincipal["scopes"] = ["transactions:draft"];
    const verifyCredential = vi.fn(async (candidate: string | undefined) =>
      candidate === token ? { ...principal, scopes } : undefined,
    );
    const registerTools = createMcpToolRegistrar({} as McpToolDependencies);
    const handler = createFolioMcpHandler(registerTools);
    const endpoint = createMcpWebEndpoint({
      expectedOrigin: origin,
      verifyCredential,
      handler,
    });

    const listTools = async () => {
      const response = await endpoint(
        request({
          authorization: `Bearer ${token}`,
          body: toolsListBody,
          mcpMethod: "tools/list",
        }),
      );
      expect(response.status).toBe(200);
      const result = (await response.json()) as {
        result?: { tools: { name: string }[] };
      };
      expect(result.result).toBeDefined();
      return result.result!.tools.map(({ name }) => name);
    };

    try {
      expect(await listTools()).toEqual([
        "folio_ping",
        "submit_draft_transaction",
        "edit_transaction",
      ]);

      scopes = ["transactions:search"];

      expect(await listTools()).toEqual(["folio_ping", "search_transactions"]);
      expect(verifyCredential).toHaveBeenCalledTimes(2);
      expect(verifyCredential).toHaveBeenNthCalledWith(1, token);
      expect(verifyCredential).toHaveBeenNthCalledWith(2, token);
    } finally {
      await handler.close();
    }
  });

  it("rejects mismatched Host and Origin before credential lookup", async () => {
    const verifyCredential = vi.fn(async () => principal);
    const handler = createFolioMcpHandler();
    const endpoint = createMcpWebEndpoint({
      expectedOrigin: origin,
      verifyCredential,
      handler,
    });
    try {
      expect((await endpoint(request({ host: "other.example" }))).status).toBe(
        403,
      );
      expect(
        (await endpoint(request({ origin: "https://other.example" }))).status,
      ).toBe(403);
      expect(
        (await endpoint(request({ host: "other.example" }))).headers.get(
          "x-folio-error-reference",
        ),
      ).toMatch(/^[0-9a-f-]{36}$/i);
      expect(verifyCredential).not.toHaveBeenCalled();
    } finally {
      await handler.close();
    }
  });

  it("rejects missing bearer authorization, GET, and oversized bodies", async () => {
    const verifyCredential = vi.fn(async (token: string | undefined) =>
      token === "synthetic-test-credential" ? principal : undefined,
    );
    const handler = createFolioMcpHandler();
    const endpoint = createMcpWebEndpoint({
      expectedOrigin: origin,
      verifyCredential,
      handler,
    });
    try {
      const unauthorized = await endpoint(
        request({ authorization: "Basic x" }),
      );
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.headers.get("www-authenticate")).toBe("Bearer");
      expect(unauthorized.headers.get("x-folio-error-reference")).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
      const get = await endpoint(request({ method: "GET" }));
      expect(get.status).toBe(405);
      expect(get.headers.get("allow")).toBe("POST");
      expect(get.headers.get("x-folio-error-reference")).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
      const large = await endpoint(
        request({ body: " ".repeat(MCP_MAX_REQUEST_BODY_BYTES + 1) }),
      );
      expect(large.status).toBe(413);
      expect(large.headers.get("x-folio-error-reference")).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
    } finally {
      await handler.close();
    }
  });

  it("logs credential verifier failures without exposing the thrown message", async () => {
    const error = new Error("private verifier details");
    const verifyCredential = vi.fn(async () => {
      throw error;
    });
    const handler = createFolioMcpHandler();
    const endpoint = createMcpWebEndpoint({
      expectedOrigin: origin,
      verifyCredential,
      handler,
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await endpoint(request());
      expect(response.status).toBe(503);
      expect(response.headers.get("x-folio-error-reference")).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
      expect(await response.text()).not.toContain("private verifier details");
      expect(log).toHaveBeenCalledTimes(1);
      const event = JSON.parse(log.mock.calls[0][0] as string) as Record<
        string,
        unknown
      >;
      expect(event).toMatchObject({
        operation: "mcp_http_request",
        stage: "credential_verification",
        phase: "failure",
        code: "UNEXPECTED_ERROR",
        message: "private verifier details",
      });
      expect(event).not.toHaveProperty("stack");
    } finally {
      log.mockRestore();
      await handler.close();
    }
  });
});
