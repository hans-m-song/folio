import { createFileRoute } from "@tanstack/react-router";

import { loadAuthConfig } from "../config";
import { createMcpRuntime } from "../mcp/runtime";
import { withMcpRequestLogging } from "../mcp/request-logging";
import { createFolioMcpHandler } from "../mcp/server";
import { createMcpWebEndpoint, mcpEnabled } from "../mcp/web";

let endpoint: ReturnType<typeof createMcpWebEndpoint> | undefined;

const handleRequest = (request: Request) => {
  if (!mcpEnabled(process.env))
    return Response.json(
      { error: "Not found" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );

  if (!endpoint) {
    const origin = loadAuthConfig(process.env).origin;
    const app = createMcpRuntime(process.env);
    endpoint = createMcpWebEndpoint({
      expectedOrigin: origin,
      verifyCredential: app.verifyCredential,
      handler: createFolioMcpHandler(app.registerTools),
    });
  }

  return endpoint(request);
};

const handleLoggedRequest = (request: Request) =>
  withMcpRequestLogging(request, () => handleRequest(request), {
    logSuccess: process.env.FOLIO_MCP_LOG_SUCCESS === "true",
  });

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => handleLoggedRequest(request),
      POST: ({ request }) => handleLoggedRequest(request),
    },
  },
});
