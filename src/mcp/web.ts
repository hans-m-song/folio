import type { AuthInfo, McpHttpHandler } from "@modelcontextprotocol/server";

import {
  isMcpPrincipal,
  MCP_AUTH_INFO_PRINCIPAL_KEY,
  MCP_MAX_REQUEST_BODY_BYTES,
  type McpCredentialVerifier,
} from "./server";

export const mcpEnabled = (environment: Record<string, string | undefined>) =>
  environment.FOLIO_MCP_ENABLED === "true";

type WebEndpointOptions = Readonly<{
  expectedOrigin: string;
  verifyCredential: McpCredentialVerifier;
  handler: McpHttpHandler;
}>;

const errorResponse = (
  status: number,
  error: string,
  headers: Record<string, string> = {},
) =>
  Response.json(
    { error },
    {
      status,
      headers: { "cache-control": "no-store", ...headers },
    },
  );

const bearerToken = (authorization: string | null) =>
  authorization?.match(/^Bearer ([A-Za-z0-9._~+/-]+=*)$/i)?.[1];

export const createMcpWebEndpoint = ({
  expectedOrigin,
  verifyCredential,
  handler,
}: WebEndpointOptions) => {
  const expected = new URL(expectedOrigin);

  return async (request: Request): Promise<Response> => {
    if (request.headers.get("host") !== expected.host)
      return errorResponse(403, "Host is not allowed");

    const origin = request.headers.get("origin");
    if (origin !== null && origin !== expected.origin)
      return errorResponse(403, "Origin is not allowed");

    if (new URL(request.url).pathname !== "/mcp")
      return errorResponse(404, "Not found");

    let principal;
    try {
      principal = await verifyCredential(
        bearerToken(request.headers.get("authorization")),
      );
    } catch {
      return errorResponse(503, "Credential verification unavailable");
    }

    if (!principal)
      return errorResponse(401, "Authentication required", {
        "www-authenticate": "Bearer",
      });

    if (!isMcpPrincipal(principal))
      return errorResponse(503, "Credential verifier returned invalid data");

    if (request.method !== "POST")
      return errorResponse(405, "Method not allowed", { allow: "POST" });

    const contentLength = request.headers.get("content-length");
    if (
      contentLength !== null &&
      Number(contentLength) > MCP_MAX_REQUEST_BODY_BYTES
    )
      return errorResponse(413, "Request body too large");

    const verifiedPrincipal = Object.freeze({
      ...principal,
      scopes: Object.freeze([...principal.scopes]),
    });
    const authInfo: AuthInfo = {
      token: "",
      clientId: principal.credentialId,
      scopes: [...principal.scopes],
      extra: { [MCP_AUTH_INFO_PRINCIPAL_KEY]: verifiedPrincipal },
    };

    try {
      const response = await handler.fetch(request, { authInfo });
      response.headers.set("cache-control", "no-store");
      return response;
    } catch {
      return errorResponse(500, "MCP request failed");
    }
  };
};
