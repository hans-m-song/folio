import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createFolioMcpHandler,
  type McpCredentialVerifier,
  type McpToolRegistrar,
} from "./server";
import {
  createMcpTransport,
  MCP_BIND_HOST,
  MCP_DEFAULT_PORT,
  MCP_ENDPOINT_PATH,
} from "./transport";
import { createMcpRuntime } from "./runtime";

export type StartMcpServerOptions = Readonly<{
  verifyCredential: McpCredentialVerifier;
  registerTools?: McpToolRegistrar;
  port?: number;
}>;

export const startMcpServer = async ({
  verifyCredential,
  registerTools,
  port = MCP_DEFAULT_PORT,
}: StartMcpServerOptions) => {
  const handler = createFolioMcpHandler(registerTools);
  const transport = createMcpTransport({ handler, verifyCredential, port });

  try {
    const address = await transport.start();
    return { address, close: () => transport.close() };
  } catch (error) {
    await transport.close();
    throw error;
  }
};

const runMcpServer = async () => {
  const app = createMcpRuntime(process.env);
  let server: Awaited<ReturnType<typeof startMcpServer>>;
  try {
    server = await startMcpServer({
      verifyCredential: app.verifyCredential,
      registerTools: app.registerTools,
    });
  } catch (error) {
    await app.close();
    throw error;
  }

  process.stderr.write(
    `Folio MCP server listening on http://${MCP_BIND_HOST}:${server.address.port}${MCP_ENDPOINT_PATH}.\n`,
  );

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void (async () => {
      try {
        await server.close();
      } finally {
        await app.close();
      }
    })().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runMcpServer().catch(() => {
    process.stderr.write("Folio MCP shell failed to start.\n");
    process.exitCode = 1;
  });
}
