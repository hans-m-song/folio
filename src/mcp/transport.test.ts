import { request as httpRequest } from "node:http";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import { MCP_MAX_REQUEST_BODY_BYTES } from "./server";
import { startMcpServer, type StartMcpServerOptions } from "./start";

const validPrincipal = {
  credentialId: "credential-test",
  actorUserId: "actor-test",
  defaultOwnerId: "owner-test",
  scopes: ["transactions:draft"] as const,
};

type RunningMcpServer = Awaited<ReturnType<typeof startMcpServer>>;

type HttpResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

const withMcpServer = async (
  options: StartMcpServerOptions,
  run: (server: RunningMcpServer) => Promise<void>,
) => {
  const server = await startMcpServer({ ...options, port: 0 });
  try {
    await run(server);
  } finally {
    await server.close();
  }
};

const jsonRpcHeaders = (
  port: number,
  overrides: Record<string, string> = {},
) => ({
  host: `127.0.0.1:${port}`,
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
  authorization: "Bearer synthetic-test-credential",
  "mcp-protocol-version": "2026-07-28",
  "mcp-method": "tools/call",
  "mcp-name": "folio_ping",
  ...overrides,
});

const toolCallBody = (
  name = "folio_ping",
  argumentsValue: Record<string, unknown> = {},
) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: argumentsValue,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  });

const send = (
  port: number,
  options: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
) =>
  new Promise<HttpResponse>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: options.path ?? "/mcp",
        method: options.method ?? "POST",
        headers: options.headers ?? jsonRpcHeaders(port),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );

    request.on("error", reject);
    request.end(options.body ?? toolCallBody());
  });

const parseJson = (value: string) =>
  JSON.parse(value) as {
    result?: {
      content?: Array<{ type: string; text?: string }>;
    };
  };

describe("local MCP Streamable HTTP transport", () => {
  it("serves the read-only ping without creating protocol sessions", async () => {
    const verifyCredential = vi.fn(async (token: string | undefined) =>
      token === "synthetic-test-credential" ? validPrincipal : undefined,
    );

    await withMcpServer({ verifyCredential }, async ({ address }) => {
      const response = await send(address.port);
      const repeatedResponse = await send(address.port);
      const result = parseJson(response.body);

      expect(address.address).toBe("127.0.0.1");
      expect(response.statusCode).toBe(200);
      expect(repeatedResponse.statusCode).toBe(200);
      expect(result.result?.content).toEqual([{ type: "text", text: "pong" }]);
      expect(response.headers["mcp-session-id"]).toBeUndefined();
      expect(repeatedResponse.headers["mcp-session-id"]).toBeUndefined();
      expect(verifyCredential).toHaveBeenCalledTimes(2);
      expect(verifyCredential).toHaveBeenNthCalledWith(
        1,
        "synthetic-test-credential",
      );
      expect(verifyCredential).toHaveBeenNthCalledWith(
        2,
        "synthetic-test-credential",
      );
    });
  });

  it("checks credentials on each MCP request and denies missing or invalid tokens", async () => {
    const verifyCredential = vi.fn(async (token: string | undefined) =>
      token === "valid-test-credential" ? validPrincipal : undefined,
    );

    await withMcpServer({ verifyCredential }, async ({ address }) => {
      const missing = await send(address.port, {
        headers: jsonRpcHeaders(address.port, { authorization: "" }),
      });
      const invalid = await send(address.port, {
        headers: jsonRpcHeaders(address.port, {
          authorization: "Basic synthetic-test-credential",
        }),
      });

      expect(missing.statusCode).toBe(401);
      expect(invalid.statusCode).toBe(401);
      expect(verifyCredential).toHaveBeenNthCalledWith(1, undefined);
      expect(verifyCredential).toHaveBeenNthCalledWith(2, undefined);
    });
  });

  it("fails closed when credential verification is unavailable", async () => {
    const verifyCredential = vi.fn(async () => {
      throw new Error("synthetic verifier detail");
    });

    await withMcpServer({ verifyCredential }, async ({ address }) => {
      const response = await send(address.port);

      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain("synthetic verifier detail");
      expect(verifyCredential).toHaveBeenCalledTimes(1);
    });
  });

  it("rejects unexpected Host and Origin headers before credential verification", async () => {
    const verifyCredential = vi.fn(async () => validPrincipal);

    await withMcpServer({ verifyCredential }, async ({ address }) => {
      const invalidHost = await send(address.port, {
        headers: jsonRpcHeaders(address.port, { host: "attacker.example" }),
      });
      const invalidOrigin = await send(address.port, {
        headers: jsonRpcHeaders(address.port, {
          origin: "https://attacker.example",
        }),
      });

      expect(invalidHost.statusCode).toBe(403);
      expect(invalidOrigin.statusCode).toBe(403);
      expect(verifyCredential).not.toHaveBeenCalled();
    });
  });

  it("accepts loopback Host and Origin aliases and authenticates every request", async () => {
    const verifyCredential = vi.fn(async () => validPrincipal);

    await withMcpServer({ verifyCredential }, async ({ address }) => {
      const response = await send(address.port, {
        headers: jsonRpcHeaders(address.port, {
          host: `localhost:${address.port}`,
          origin: `http://localhost:${address.port}`,
        }),
      });

      expect(response.statusCode).toBe(200);
      expect(verifyCredential).toHaveBeenCalledTimes(1);
    });
  });

  it("returns 405 for authenticated non-POST endpoint requests", async () => {
    const verifyCredential = vi.fn(async () => validPrincipal);

    await withMcpServer({ verifyCredential }, async ({ address }) => {
      const response = await send(address.port, {
        method: "GET",
        body: "",
      });

      expect(response.statusCode).toBe(405);
      expect(response.headers.allow).toBe("POST");
      expect(verifyCredential).toHaveBeenCalledTimes(1);
    });
  });

  it("does not mount MCP on other paths", async () => {
    const verifyCredential = vi.fn(async () => validPrincipal);

    await withMcpServer({ verifyCredential }, async ({ address }) => {
      const response = await send(address.port, {
        path: "/",
        body: "",
      });

      expect(response.statusCode).toBe(404);
      expect(verifyCredential).not.toHaveBeenCalled();
    });
  });

  it("rejects request bodies larger than the fixed byte limit", async () => {
    const verifyCredential = vi.fn(async () => validPrincipal);

    await withMcpServer({ verifyCredential }, async ({ address }) => {
      const oversizedBody = " ".repeat(MCP_MAX_REQUEST_BODY_BYTES + 1);
      const response = await send(address.port, {
        headers: jsonRpcHeaders(address.port),
        body: oversizedBody,
      });

      expect(response.statusCode).toBe(413);
      expect(verifyCredential).toHaveBeenCalledTimes(1);
    });
  });

  it("provides the verified credential scopes and owner context to tool registration", async () => {
    const registerTools = vi.fn(async (server, { principal }) => {
      server.registerTool(
        "folio_test_principal",
        { description: "Expose the verified context to the synthetic test." },
        async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                credentialId: principal.credentialId,
                actorUserId: principal.actorUserId,
                defaultOwnerId: principal.defaultOwnerId,
                scopes: principal.scopes,
              }),
            },
          ],
        }),
      );
    });
    const verifyCredential = vi.fn(async () => validPrincipal);

    await withMcpServer(
      { verifyCredential, registerTools },
      async ({ address }) => {
        const response = await send(address.port, {
          headers: jsonRpcHeaders(address.port, {
            "mcp-name": "folio_test_principal",
          }),
          body: toolCallBody("folio_test_principal"),
        });
        const result = parseJson(response.body);

        expect(response.statusCode).toBe(200);
        expect(result.result?.content?.[0]?.text).toBe(
          JSON.stringify({
            credentialId: "credential-test",
            actorUserId: "actor-test",
            defaultOwnerId: "owner-test",
            scopes: ["transactions:draft"],
          }),
        );
        expect(registerTools).toHaveBeenCalledTimes(1);
        expect(registerTools.mock.calls[0]?.[1].principal).toEqual(
          validPrincipal,
        );
      },
    );
  });

  it("supports typed JSON Schema tool inputs without the application Zod version", async () => {
    const registerTools: NonNullable<StartMcpServerOptions["registerTools"]> = (
      server,
    ) => {
      server.registerTool(
        "folio_test_schema",
        {
          description: "Exercise a typed input schema in the synthetic test.",
          inputSchema: fromJsonSchema<{ query: string }>({
            type: "object",
            properties: { query: { type: "string", minLength: 1 } },
            required: ["query"],
            additionalProperties: false,
          }),
        },
        async ({ query }) => ({
          content: [{ type: "text", text: query }],
        }),
      );
    };
    const verifyCredential = vi.fn(async () => validPrincipal);

    await withMcpServer(
      { verifyCredential, registerTools },
      async ({ address }) => {
        const response = await send(address.port, {
          headers: jsonRpcHeaders(address.port, {
            "mcp-name": "folio_test_schema",
          }),
          body: toolCallBody("folio_test_schema", { query: "bounded" }),
        });
        const result = parseJson(response.body);

        expect(response.statusCode).toBe(200);
        expect(result.result?.content).toEqual([
          { type: "text", text: "bounded" },
        ]);
      },
    );
  });
});
