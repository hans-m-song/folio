import { toNodeHandler } from "@modelcontextprotocol/node";
import type { AuthInfo, McpHttpHandler } from "@modelcontextprotocol/server";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

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
  close: () => Promise<void>;
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
  const nodeHandler = toNodeHandler(handler, {
    maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES,
    onerror: () => {
      process.stderr.write("Folio MCP request failed.\n");
    },
  });

  const httpServer = createServer((request, response) => {
    const localPort = currentPort(httpServer, port);

    if (!isAllowedHost(request.headers.host, localPort)) {
      respond(response, 403, "Host is not allowed");
      return;
    }

    if (!isAllowedOrigin(request.headers.origin, localPort)) {
      respond(response, 403, "Origin is not allowed");
      return;
    }

    if (requestPath(request) !== MCP_ENDPOINT_PATH) {
      respond(response, 404, "Not found");
      return;
    }

    const credential = bearerToken(request.headers.authorization);

    void verifyCredential(credential)
      .then((principal) => {
        if (principal === undefined) {
          respond(response, 401, "Authentication required", {
            "www-authenticate": "Bearer",
          });
          return;
        }

        if (!isMcpPrincipal(principal)) {
          respond(response, 503, "Credential verifier returned invalid data");
          return;
        }

        const verifiedPrincipal = Object.freeze({
          ...principal,
          scopes: Object.freeze([...principal.scopes]),
        });

        if (request.method !== "POST") {
          respond(response, 405, "Method not allowed", { allow: "POST" });
          return;
        }

        Object.assign(request, { auth: createAuthInfo(verifiedPrincipal) });
        return nodeHandler(request, response);
      })
      .catch(() => {
        if (!response.headersSent) {
          respond(response, 503, "Credential verification unavailable");
        }
      });
  });

  let closePromise: Promise<void> | undefined;
  let closed = false;

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
    close: () => {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = new Promise<void>((resolve, reject) => {
        if (!httpServer.listening) {
          resolve();
          return;
        }

        httpServer.close((error) => (error ? reject(error) : resolve()));
      }).then(() => handler.close());
      return closePromise;
    },
  };
};
