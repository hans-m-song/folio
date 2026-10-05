import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  start: vi.fn(),
  close: vi.fn(),
}));

vi.mock("./transport", () => ({
  MCP_DEFAULT_PORT: 4765,
  createMcpTransport: () => transport,
}));

import { startMcpServer } from "./start";

describe("MCP server startup cleanup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves the startup error and links cleanup failure in one diagnostic", async () => {
    const startError = new Error("private startup detail");
    const cleanupError = new Error("private cleanup detail");
    transport.start.mockRejectedValueOnce(startError);
    transport.close.mockRejectedValueOnce(cleanupError);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        startMcpServer({ verifyCredential: vi.fn(async () => undefined) }),
      ).rejects.toBe(startError);

      expect(transport.close).toHaveBeenCalledTimes(1);
      expect(transport.close).toHaveBeenCalledWith({ reportFailure: false });
      expect(log).toHaveBeenCalledTimes(1);
      const event = JSON.parse(log.mock.calls[0][0] as string);
      expect(event).toMatchObject({
        operation: "mcp_startup",
        stage: "listen",
        phase: "failure",
        code: "UNEXPECTED_ERROR",
        cleanupFailures: [
          { stage: "startup_cleanup", code: "UNEXPECTED_ERROR" },
        ],
      });
      expect(JSON.stringify(event)).not.toContain("private startup detail");
      expect(JSON.stringify(event)).not.toContain("private cleanup detail");
    } finally {
      log.mockRestore();
    }
  });

  it("reports normal shutdown failure and preserves its error", async () => {
    const closeError = new Error("private shutdown detail");
    transport.start.mockResolvedValueOnce({
      address: "127.0.0.1",
      family: "IPv4",
      port: 4765,
    });
    transport.close.mockRejectedValueOnce(closeError);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const server = await startMcpServer({
        verifyCredential: vi.fn(async () => undefined),
      });
      await expect(server.close()).rejects.toBe(closeError);
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
        operation: "mcp_transport",
        stage: "close",
        phase: "failure",
        code: "UNEXPECTED_ERROR",
      });
      expect(log.mock.calls[0][0]).not.toContain("private shutdown detail");
    } finally {
      log.mockRestore();
    }
  });
});
