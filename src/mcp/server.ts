import {
  createMcpHandler as createSdkMcpHandler,
  McpServer,
  type AuthInfo,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";

export const MCP_MAX_REQUEST_BODY_BYTES = 64 * 1024;
export const MCP_AUTH_INFO_PRINCIPAL_KEY = "folioMcpPrincipal";

export const MCP_SCOPES = [
  "bank_rows:read",
  "transactions:search",
  "artifacts:read",
  "artifacts:upload",
  "proposals:submit",
  "submissions:read",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export type McpPrincipal = Readonly<{
  credentialId: string;
  actorUserId: string;
  defaultOwnerId: string;
  scopes: readonly McpScope[];
}>;

export type McpCredentialVerifier = (
  token: string | undefined,
) => Promise<McpPrincipal | undefined>;

export type McpToolRegistrationContext = Readonly<{
  principal: McpPrincipal;
}>;

export type McpToolRegistrar = (
  server: McpServer,
  context: McpToolRegistrationContext,
) => void | Promise<void>;

export const isMcpPrincipal = (value: unknown): value is McpPrincipal => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const principal = value as Record<string, unknown>;
  return (
    typeof principal.credentialId === "string" &&
    principal.credentialId.length > 0 &&
    typeof principal.actorUserId === "string" &&
    principal.actorUserId.length > 0 &&
    typeof principal.defaultOwnerId === "string" &&
    principal.defaultOwnerId.length > 0 &&
    Array.isArray(principal.scopes) &&
    principal.scopes.every(
      (scope) =>
        typeof scope === "string" && MCP_SCOPES.includes(scope as McpScope),
    )
  );
};

const principalFromAuthInfo = (
  authInfo: AuthInfo | undefined,
): McpPrincipal => {
  const principal = authInfo?.extra?.[MCP_AUTH_INFO_PRINCIPAL_KEY];
  if (!isMcpPrincipal(principal)) {
    throw new Error("Verified MCP principal is unavailable");
  }
  return principal;
};

const registerPingTool = (server: McpServer) => {
  server.registerTool(
    "folio_ping",
    {
      description: "Check that the local Folio MCP server is available.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({ content: [{ type: "text", text: "pong" }] }),
  );
};

export const createFolioMcpHandler = (
  registerTools?: McpToolRegistrar,
): McpHttpHandler =>
  createSdkMcpHandler(
    async ({ authInfo }) => {
      const principal = principalFromAuthInfo(authInfo);
      const server = new McpServer(
        { name: "folio-local", version: "0.1.0" },
        { capabilities: { tools: {} } },
      );

      registerPingTool(server);
      await registerTools?.(server, Object.freeze({ principal }));

      return server;
    },
    {
      legacy: "stateless",
      maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES,
      responseMode: "json",
    },
  );
