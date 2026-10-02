import { describe, expect, it, vi } from "vitest";

import { createFolioMcpHandler, MCP_MAX_REQUEST_BODY_BYTES } from "./server";
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

const request = (
  options: {
    method?: string;
    host?: string;
    origin?: string;
    authorization?: string;
    body?: string;
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
      "mcp-method": "tools/call",
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
      const get = await endpoint(request({ method: "GET" }));
      expect(get.status).toBe(405);
      expect(get.headers.get("allow")).toBe("POST");
      const large = await endpoint(
        request({ body: " ".repeat(MCP_MAX_REQUEST_BODY_BYTES + 1) }),
      );
      expect(large.status).toBe(413);
    } finally {
      await handler.close();
    }
  });
});
