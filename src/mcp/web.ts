import type { AuthInfo, McpHttpHandler } from "@modelcontextprotocol/server";

import { AppError } from "../domain/errors";
import { reportServerFailure } from "../server/error-handling";
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

const diagnosticContext = (
  request: Request,
  stage: string,
  status: number,
) => ({
  operation: "mcp_http_request",
  stage,
  metadata: { httpStatus: status },
  request,
});

const failureResponse = (
  request: Request,
  status: number,
  message: string,
  stage: string,
  diagnostic: unknown,
  headers: Record<string, string> = {},
) => {
  const reported = reportServerFailure(
    diagnostic,
    diagnosticContext(request, stage, status),
  );
  return errorResponse(status, message, {
    ...headers,
    "x-folio-error-reference": reported.publicFailure.reference,
  });
};

const attachFailureReference = (request: Request, response: Response) => {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  if (response.status >= 400 && !headers.has("x-folio-error-reference")) {
    const stage = response.status >= 500 ? "handler" : "protocol";
    const reported = reportServerFailure(
      new AppError({
        code: response.status >= 500 ? "REQUEST_FAILED" : "INPUT_INVALID",
        stage,
      }),
      diagnosticContext(request, stage, response.status),
    );
    headers.set("x-folio-error-reference", reported.publicFailure.reference);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

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
      return failureResponse(
        request,
        403,
        "Host is not allowed",
        "host_validation",
        new AppError({ code: "REQUEST_FORBIDDEN", stage: "host_validation" }),
      );

    const origin = request.headers.get("origin");
    if (origin !== null && origin !== expected.origin)
      return failureResponse(
        request,
        403,
        "Origin is not allowed",
        "origin_validation",
        new AppError({ code: "REQUEST_FORBIDDEN", stage: "origin_validation" }),
      );

    if (new URL(request.url).pathname !== "/mcp")
      return failureResponse(
        request,
        404,
        "Not found",
        "path_validation",
        new AppError({ code: "INPUT_INVALID", stage: "path_validation" }),
      );

    let principal;
    try {
      principal = await verifyCredential(
        bearerToken(request.headers.get("authorization")),
      );
    } catch (error) {
      return failureResponse(
        request,
        503,
        "Credential verification unavailable",
        "credential_verification",
        error,
      );
    }

    if (!principal)
      return failureResponse(
        request,
        401,
        "Authentication required",
        "authentication",
        new AppError({ code: "UNAUTHENTICATED", stage: "authentication" }),
        { "www-authenticate": "Bearer" },
      );

    if (!isMcpPrincipal(principal))
      return failureResponse(
        request,
        503,
        "Credential verifier returned invalid data",
        "credential_verification",
        new AppError({
          code: "REQUEST_FAILED",
          stage: "credential_verification",
        }),
      );

    if (request.method !== "POST")
      return failureResponse(
        request,
        405,
        "Method not allowed",
        "method_validation",
        new AppError({ code: "INPUT_INVALID", stage: "method_validation" }),
        { allow: "POST" },
      );

    const contentLength = request.headers.get("content-length");
    if (
      contentLength !== null &&
      Number(contentLength) > MCP_MAX_REQUEST_BODY_BYTES
    )
      return failureResponse(
        request,
        413,
        "Request body too large",
        "body_limit",
        new AppError({ code: "INPUT_INVALID", stage: "body_limit" }),
      );

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
      return attachFailureReference(request, response);
    } catch (error) {
      return failureResponse(
        request,
        500,
        "MCP request failed",
        "handler",
        error,
      );
    }
  };
};
