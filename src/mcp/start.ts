import {
  createFolioMcpHandler,
  type McpCredentialVerifier,
  type McpToolRegistrar,
} from "./server";
import { OperationCleanupError } from "../domain/errors";
import { reportServerFailure } from "../server/error-handling";
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
    return {
      address,
      close: async () => {
        try {
          await transport.close();
        } catch (error) {
          reportServerFailure(error, {
            operation: "mcp_transport",
            stage: "close",
          });
          throw error;
        }
      },
    };
  } catch (error) {
    let operationError = error;
    try {
      await transport.close({ reportFailure: false });
    } catch (cleanupError) {
      operationError = new OperationCleanupError(
        error,
        cleanupError,
        "startup_cleanup",
      );
    }
    reportServerFailure(operationError, {
      operation: "mcp_startup",
      stage: "listen",
    });
    throw error;
  }
};
