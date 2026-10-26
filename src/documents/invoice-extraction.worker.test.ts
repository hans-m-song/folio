import { createRequire } from "node:module";
import type { Worker, WorkerOptions } from "node:worker_threads";

import { describe, expect, it, vi } from "vitest";
import { extractInvoicePdf } from "./invoice-extraction";

const workerHarness = vi.hoisted(() => ({
  pdfjsEntry: "",
  response: undefined as unknown,
}));
const realWorker = createRequire(import.meta.url)("node:worker_threads")
  .Worker as new (filename: string | URL, options?: WorkerOptions) => Worker;

vi.mock("node:worker_threads", () => ({
  Worker: class {
    private readonly worker: Worker;

    constructor(source: string | URL, options: WorkerOptions) {
      this.worker = new realWorker(source, {
        ...options,
        workerData: {
          ...(options.workerData as Record<string, unknown>),
          pdfjsEntry: workerHarness.pdfjsEntry,
        },
      });
    }

    once(event: string, listener: (...args: unknown[]) => void) {
      if (event === "message")
        this.worker.once("message", (message) => {
          workerHarness.response = message;
          listener(message);
        });
      if (event === "error")
        this.worker.once("error", (error) => listener(error));
      if (event === "exit") this.worker.once("exit", (code) => listener(code));
      return this;
    }

    terminate() {
      return this.worker.terminate();
    }
  },
}));

describe("invoice PDF worker diagnostics", () => {
  it("preserves redacted unexpected messages and bounded truncation markers", async () => {
    const errorMessage =
      "Synthetic parser detail AWS_SECRET_ACCESS_KEY=synthetic-secret " +
      "x".repeat(5_000);
    const moduleSource = `
      export function getDocument() {
        const error = new Error(${JSON.stringify(errorMessage)});
        error.name = "SyntheticParserFailure";
        error.code = "SYNTHETIC_PARSER_FAILURE";
        error.stack = [
          "SyntheticParserFailure",
          ...Array.from({ length: 10 }, (_, index) => "    at syntheticFrame" + index),
        ].join("\\n");
        let cause = new Error("terminal synthetic cause");
        for (let index = 0; index < 6; index += 1)
          cause = new Error("nested synthetic cause", { cause });
        error.cause = cause;
        error.errors = Array.from(
          { length: 10 },
          (_, index) => new Error("aggregate synthetic cause " + index),
        );
        throw error;
      }
    `;
    workerHarness.pdfjsEntry = `data:text/javascript,${encodeURIComponent(moduleSource)}`;
    workerHarness.response = undefined;
    const diagnosticLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let logged: string[] = [];

    try {
      await expect(extractInvoicePdf(new Uint8Array([1]))).resolves.toEqual({
        status: "unsupported",
        reason: "extraction_failed",
      });
      logged = diagnosticLog.mock.calls.map(([line]) => String(line));
    } finally {
      diagnosticLog.mockRestore();
    }

    const workerResponse = workerHarness.response as {
      diagnostics: Array<{ details: Record<string, unknown> }>;
    };
    const diagnostic = workerResponse.diagnostics[0]?.details;
    const emitted = JSON.stringify(workerHarness.response);
    expect(emitted).toContain("Synthetic parser detail");
    expect(emitted).toContain("[REDACTED_CREDENTIAL]");
    expect(emitted).not.toContain("synthetic-secret");
    expect(diagnostic?.message).toHaveLength(1024);
    expect(diagnostic?.messageTruncated).toBe(true);
    expect(diagnostic?.stackTruncated).toBe(true);
    expect(diagnostic?.errorsTruncated).toBe(true);
    expect(JSON.stringify(diagnostic?.cause)).toContain('"truncated":"depth"');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("Synthetic parser detail");
    expect(logged[0]).toContain('"messageTruncated":true');
    expect(logged[0]).toContain('"stackTruncated":true');
    expect(logged[0]).toContain('"errorsTruncated":true');
    expect(logged[0]).toContain('"truncated":"depth"');
    expect(logged[0]).not.toContain("synthetic-secret");
  });
});
