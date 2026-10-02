import { describe, expect, it, vi } from "vitest";

import { MCP_MAX_REQUEST_BODY_BYTES } from "./server";
import { withMcpRequestLogging } from "./request-logging";

const request = (method = "tools/list", params: Record<string, unknown> = {}) =>
  new Request("http://127.0.0.1:43230/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic-secret",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, confidential: "synthetic-private-value" },
    }),
  });

describe("MCP request logging", () => {
  it("does not log successful requests unless enabled", async () => {
    const info = vi.fn();
    const error = vi.fn();
    const response = await withMcpRequestLogging(
      request(),
      () => Response.json({ result: "ok" }),
      { info, error },
    );

    expect(response.status).toBe(200);
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("logs opt-in successes without credentials or request bodies", async () => {
    const info = vi.fn();
    await withMcpRequestLogging(
      request(),
      () => Response.json({ result: "ok" }),
      { logSuccess: true, info },
    );

    const event = JSON.parse(info.mock.calls[0][0]);
    expect(event).toMatchObject({
      event: "folio.mcp_request",
      requestMethod: "POST",
      requestPath: "/mcp",
      mcpMethod: "tools/list",
      status: 200,
    });
    expect(event).not.toHaveProperty("stage");
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(info.mock.calls[0][0]).not.toContain("synthetic-secret");
    expect(info.mock.calls[0][0]).not.toContain("synthetic-private-value");
  });

  it("logs the registered tool name but never its arguments", async () => {
    const info = vi.fn();
    const toolRequest = request("tools/call", {
      name: "folio_ping",
      arguments: { privateValue: "synthetic-private-argument" },
    });
    await withMcpRequestLogging(
      toolRequest,
      async () => {
        await toolRequest.text();
        return Response.json({ result: "ok" });
      },
      { logSuccess: true, info },
    );

    const event = JSON.parse(info.mock.calls[0][0]);
    expect(event).toMatchObject({
      mcpMethod: "tools/call",
      mcpTool: "folio_ping",
    });
    expect(info.mock.calls[0][0]).not.toContain("synthetic-private-argument");
  });

  it("identifies edit_transaction without logging its patch or credential", async () => {
    const info = vi.fn();
    await withMcpRequestLogging(
      request("tools/call", {
        name: "edit_transaction",
        arguments: {
          transactionId: "00000000-0000-4000-8000-000000000001",
          expectedUpdatedAt: "2026-09-28T00:00:00.123456Z",
          changes: { reference: "synthetic-private-reference" },
        },
      }),
      () => Response.json({ result: "ok" }),
      { logSuccess: true, info },
    );

    const serialized = String(info.mock.calls[0][0]);
    expect(JSON.parse(serialized)).toMatchObject({
      mcpMethod: "tools/call",
      mcpTool: "edit_transaction",
      status: 200,
    });
    expect(serialized).not.toContain("synthetic-private-reference");
    expect(serialized).not.toContain("synthetic-secret");
    expect(serialized).not.toContain("expectedUpdatedAt");
  });

  it("does not log unrecognized tool names or oversized request bodies", async () => {
    const info = vi.fn();
    await withMcpRequestLogging(
      request("tools/call", { name: "get_submission_status" }),
      () => Response.json({ result: "ok" }),
      { logSuccess: true, info },
    );
    expect(JSON.parse(info.mock.calls[0][0])).toMatchObject({
      mcpMethod: "tools/call",
    });
    expect(JSON.parse(info.mock.calls[0][0])).not.toHaveProperty("mcpTool");

    const oversized = new Request("http://127.0.0.1:43230/mcp", {
      method: "POST",
      body: JSON.stringify({
        method: "tools/call",
        params: { name: "folio_ping" },
        padding: "x".repeat(MCP_MAX_REQUEST_BODY_BYTES),
      }),
    });
    await withMcpRequestLogging(
      oversized,
      () => Response.json({ result: "ok" }),
      { logSuccess: true, info },
    );
    expect(JSON.parse(info.mock.calls[1][0])).not.toHaveProperty("mcpMethod");
    expect(JSON.parse(info.mock.calls[1][0])).not.toHaveProperty("mcpTool");
  });

  it("logs HTTP failures with a fixed stage", async () => {
    const error = vi.fn();
    await withMcpRequestLogging(
      request(),
      () => Response.json({ error: "sensitive detail" }, { status: 401 }),
      { error },
    );

    const event = JSON.parse(error.mock.calls[0][0]);
    expect(event).toMatchObject({
      status: 401,
      stage: "credential",
    });
    expect(event).not.toHaveProperty("mcpMethod");
    expect(event).not.toHaveProperty("mcpTool");
    expect(error.mock.calls[0][0]).not.toContain("sensitive detail");
  });

  it("identifies a tool call when the authenticated handler fails", async () => {
    const error = vi.fn();
    await withMcpRequestLogging(
      request("tools/call", { name: "folio_ping" }),
      () => Response.json({ error: "sensitive detail" }, { status: 500 }),
      { error },
    );

    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
      status: 500,
      stage: "handler",
      mcpMethod: "tools/call",
      mcpTool: "folio_ping",
    });
    expect(error.mock.calls[0][0]).not.toContain("synthetic-private-value");
  });

  it("logs route exceptions and preserves their behavior", async () => {
    const error = vi.fn();
    await expect(
      withMcpRequestLogging(
        request(),
        () => {
          throw new Error("synthetic secret error");
        },
        { error },
      ),
    ).rejects.toThrow("synthetic secret error");

    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
      status: 500,
      stage: "route_exception",
    });
    expect(error.mock.calls[0][0]).not.toContain("synthetic secret error");
  });
});
