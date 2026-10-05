import { toNodeHandler } from "@modelcontextprotocol/node";
import type { AuthInfo, McpHttpHandler } from "@modelcontextprotocol/server";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { AppError, OperationCleanupError } from "../domain/errors";
import { reportServerFailure } from "../server/error-handling";
import {
  isMcpPrincipal,
  MCP_AUTH_INFO_PRINCIPAL_KEY,
  MCP_MAX_REQUEST_BODY_BYTES,
  type McpCredentialVerifier,
} from "./server";

export const MCP_BIND_HOST = "127.0.0.1";
export const MCP_ENDPOINT_PATH = "/mcp";
export const MCP_DEFAULT_PORT = 4765;

export type McpTransportOptions = Readonly<{
  handler: McpHttpHandler;
  verifyCredential: McpCredentialVerifier;
  port?: number;
}>;

export type McpTransport = Readonly<{
  start: () => Promise<AddressInfo>;
  close: (options?: { reportFailure?: boolean }) => Promise<void>;
}>;

const respond = (
  response: ServerResponse,
  status: number,
  message: string,
  extraHeaders: Record<string, string> = {},
) => {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(JSON.stringify({ error: message }));
};

const failure = (
  response: ServerResponse,
  status: number,
  message: string,
  stage: string,
  code: ConstructorParameters<typeof AppError>[0]["code"],
  error?: unknown,
  extraHeaders: Record<string, string> = {},
) => {
  const reported = reportServerFailure(error ?? new AppError({ code, stage }), {
    operation: "mcp_transport",
    stage,
    metadata: { httpStatus: status },
  });
  respond(response, status, message, {
    ...extraHeaders,
    "x-folio-error-reference": reported.publicFailure.reference,
  });
};

const reportUnannotatedResponse = (
  response: ServerResponse,
  status: number,
  headers: unknown[],
) => {
  if (status < 400) return;
  const responseHeaders = headers.find(
    (value): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value),
  );
  const hasReferenceHeader =
    response.hasHeader("x-folio-error-reference") ||
    (responseHeaders !== undefined &&
      Object.keys(responseHeaders).some(
        (key) => key.toLowerCase() === "x-folio-error-reference",
      ));
  if (hasReferenceHeader) return;

  const stage =
    status === 401 || status === 503
      ? "credential"
      : status === 403
        ? "host_or_origin"
        : status === 404
          ? "disabled"
          : status === 405
            ? "method"
            : status === 413
              ? "body_limit"
              : "handler";
  const code =
    status === 401
      ? "UNAUTHENTICATED"
      : status === 403
        ? "REQUEST_FORBIDDEN"
        : status < 500
          ? "INPUT_INVALID"
          : "REQUEST_FAILED";
  const reported = reportServerFailure(new AppError({ code, stage }), {
    operation: "mcp_transport",
    stage,
    metadata: { httpStatus: status },
  });
  response.setHeader(
    "x-folio-error-reference",
    reported.publicFailure.reference,
  );
};

const failureSafeResponse = (
  request: Request,
  response: Response,
  error?: unknown,
) => {
  if (response.status < 400) return response;
  const stage = response.status >= 500 ? "handler" : "protocol";
  if (response.headers.has("x-folio-error-reference")) return response;
  const reported = reportServerFailure(
    error ??
      new AppError({
        code: response.status >= 500 ? "REQUEST_FAILED" : "INPUT_INVALID",
        stage,
      }),
    {
      operation: "mcp_transport",
      stage,
      metadata: { httpStatus: response.status },
      request,
    },
  );
  const headers = new Headers(response.headers);
  headers.set("x-folio-error-reference", reported.publicFailure.reference);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const localAuthorities = (port: number): ReadonlySet<string> =>
  new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

const isAllowedHost = (host: string | undefined, port: number) =>
  host !== undefined && localAuthorities(port).has(host.toLowerCase());

const isAllowedOrigin = (origin: string | undefined, port: number) => {
  if (origin === undefined) return true;

  const authorities = localAuthorities(port);
  return [...authorities].some(
    (authority) => origin.toLowerCase() === `http://${authority}`,
  );
};

const bearerToken = (authorization: string | undefined) => {
  if (!authorization) return undefined;

  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(authorization);
  return match?.[1];
};

const MCP_AUTH_INFO_TOKEN_REDACTED = "";

const currentPort = (
  server: ReturnType<typeof createServer>,
  configuredPort: number,
) => {
  const address = server.address();
  return address && typeof address !== "string" ? address.port : configuredPort;
};

const createAuthInfo = (principal: McpCredentialVerifierResult): AuthInfo => ({
  token: MCP_AUTH_INFO_TOKEN_REDACTED,
  clientId: principal.credentialId,
  scopes: [...principal.scopes],
  extra: { [MCP_AUTH_INFO_PRINCIPAL_KEY]: principal },
});

type McpCredentialVerifierResult = NonNullable<
  Awaited<ReturnType<McpCredentialVerifier>>
>;

const requestPath = (request: IncomingMessage) => request.url?.split("?", 1)[0];

export const createMcpTransport = ({
  handler,
  verifyCredential,
  port = MCP_DEFAULT_PORT,
}: McpTransportOptions): McpTransport => {
  const observedHandler: McpHttpHandler = {
    ...handler,
    fetch: async (request, options) => {
      try {
        return failureSafeResponse(
          request,
          await handler.fetch(request, options),
        );
      } catch (error) {
        const reported = reportServerFailure(error, {
          operation: "mcp_transport",
          stage: "handler",
          metadata: { httpStatus: 500 },
          request,
        });
        return Response.json(
          {
            jsonrpc: "2.0",
            error: { code: -32_603, message: "Internal server error" },
            id: null,
          },
          {
            status: 500,
            headers: {
              "x-folio-error-reference": reported.publicFailure.reference,
            },
          },
        );
      }
    },
    close: () => handler.close(),
  };
  const nodeHandler = toNodeHandler(observedHandler, {
    maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES,
  });

  const httpServer = createServer((request, response) => {
    const writeHead = response.writeHead.bind(response);
    response.writeHead = ((...args: Parameters<typeof response.writeHead>) => {
      const status = args[0];
      reportUnannotatedResponse(response, status, args.slice(1));
      return writeHead(...args);
    }) as typeof response.writeHead;
    const localPort = currentPort(httpServer, port);

    if (!isAllowedHost(request.headers.host, localPort)) {
      failure(
        response,
        403,
        "Host is not allowed",
        "host_validation",
        "REQUEST_FORBIDDEN",
      );
      return;
    }

    if (!isAllowedOrigin(request.headers.origin, localPort)) {
      failure(
        response,
        403,
        "Origin is not allowed",
        "origin_validation",
        "REQUEST_FORBIDDEN",
      );
      return;
    }

    if (requestPath(request) !== MCP_ENDPOINT_PATH) {
      failure(response, 404, "Not found", "path_validation", "INPUT_INVALID");
      return;
    }

    const credential = bearerToken(request.headers.authorization);
    let credentialCheck: Promise<McpCredentialVerifierResult | undefined>;
    try {
      credentialCheck = verifyCredential(credential);
    } catch (error) {
      const reported = reportServerFailure(error, {
        operation: "mcp_transport",
        stage: "credential_verification",
        metadata: { httpStatus: 503 },
      });
      respond(response, 503, "Credential verification unavailable", {
        "x-folio-error-reference": reported.publicFailure.reference,
      });
      return;
    }

    void credentialCheck
      .then((principal) => {
        if (principal === undefined) {
          failure(
            response,
            401,
            "Authentication required",
            "authentication",
            "UNAUTHENTICATED",
            undefined,
            { "www-authenticate": "Bearer" },
          );
          return;
        }

        if (!isMcpPrincipal(principal)) {
          failure(
            response,
            503,
            "Credential verifier returned invalid data",
            "credential_verification",
            "REQUEST_FAILED",
          );
          return;
        }

        const verifiedPrincipal = Object.freeze({
          ...principal,
          scopes: Object.freeze([...principal.scopes]),
        });

        if (request.method !== "POST") {
          failure(
            response,
            405,
            "Method not allowed",
            "method_validation",
            "INPUT_INVALID",
            undefined,
            { allow: "POST" },
          );
          return;
        }

        Object.assign(request, { auth: createAuthInfo(verifiedPrincipal) });
        return nodeHandler(request, response);
      })
      .catch((error: unknown) => {
        const reported = reportServerFailure(error, {
          operation: "mcp_transport",
          stage: "credential_verification",
          metadata: { httpStatus: 503 },
        });
        if (!response.headersSent) {
          respond(response, 503, "Credential verification unavailable", {
            "x-folio-error-reference": reported.publicFailure.reference,
          });
        }
      });
  });

  let closePromise: Promise<void> | undefined;
  let closed = false;

  const close = (options: { reportFailure?: boolean } = {}) => {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      let firstError: unknown;
      let hasError = false;
      try {
        if (httpServer.listening)
          await new Promise<void>((resolve, reject) => {
            httpServer.close((error) => (error ? reject(error) : resolve()));
          });
      } catch (error) {
        hasError = true;
        firstError = error;
      }

      try {
        await observedHandler.close();
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        } else {
          firstError = new OperationCleanupError(
            firstError,
            error,
            "handler_close",
          );
        }
      }

      if (!hasError) return;
      if (options.reportFailure !== false)
        reportServerFailure(firstError, {
          operation: "mcp_transport",
          stage: "close",
        });
      throw firstError;
    })();
    return closePromise;
  };

  return {
    start: () =>
      new Promise<AddressInfo>((resolve, reject) => {
        if (closed) {
          reject(new Error("MCP transport is closed"));
          return;
        }

        const onError = (error: Error) => {
          httpServer.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          httpServer.off("error", onError);
          const address = httpServer.address();
          if (!address || typeof address === "string") {
            reject(new Error("MCP transport did not bind a TCP address"));
            return;
          }
          resolve(address);
        };

        httpServer.once("error", onError);
        httpServer.once("listening", onListening);
        httpServer.listen(port, MCP_BIND_HOST);
      }),
    close,
  };
};
