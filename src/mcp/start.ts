import {
  createFolioMcpHandler,
  type McpCredentialVerifier,
  type McpToolRegistrar,
} from "./server";
import { createMcpTransport, MCP_DEFAULT_PORT } from "./transport";

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
