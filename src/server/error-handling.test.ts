import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AppError, OperationCleanupError } from "../domain/errors";
import { FolioDiagnosticError } from "../domain/diagnostics";
import {
  HandledOperationError,
  reportServerFailure,
  runWithDiagnosticContext,
  setDiagnosticContext,
  toPublicFailure,
  writeServerSuccess,
} from "./error-handling";

const actorId = "0f935296-35b3-43bd-bc3d-0caa0b0a2510";
const transactionId = "dfb16491-721b-4d6a-8070-597fc8f7d5c5";
const record = (writer: ReturnType<typeof vi.fn>, index = 0) =>
  JSON.parse(writer.mock.calls[index][0]);

describe("safe error handling seam", () => {
  it("records a known rejected account UUID privately without exposing it to the browser", () => {
    const writer = vi.fn();
    const failure = reportServerFailure(
      new AppError({ code: "AUTH_SUBJECT_MISMATCH", userId: actorId }),
      { operation: "auth_callback" },
      { warn: writer },
    );
    expect(record(writer)).toMatchObject({ userId: actorId });
    expect(JSON.stringify(failure.publicFailure)).not.toContain(actorId);
  });
  it("keeps fixed MCP method/tool identities but rejects arbitrary names", () => {
    const writer = vi.fn();
    writeServerSuccess(
      {
        operation: "mcp_request",
        metadata: { mcpMethod: "tools/call", mcpTool: "folio_ping" },
      },
      { info: writer },
    );
    expect(record(writer)).toMatchObject({
      mcpMethod: "tools/call",
      mcpTool: "folio_ping",
    });
    writeServerSuccess(
      {
        operation: "mcp_request",
        metadata: {
          mcpMethod: "synthetic-secret",
          mcpTool: "synthetic-secret",
        },
      },
      { info: writer },
    );
    expect(record(writer, 1)).not.toHaveProperty("mcpMethod");
    expect(record(writer, 1)).not.toHaveProperty("mcpTool");
  });
  it("preserves the original rejection and links nested cleanup diagnostics without raw causes", () => {
    const writer = vi.fn();
    const original = new AppError({
      code: "AUTH_USER_NOT_ELIGIBLE",
      stage: "identity_user_lookup",
    });
    const rollback = Object.assign(new Error("synthetic-rollback-secret"), {
      code: "08006",
    });
    const release = new Error("synthetic-release-secret");
    const combined = new OperationCleanupError(
      new OperationCleanupError(original, rollback, "transaction_rollback"),
      release,
      "client_release",
    );
    const failure = reportServerFailure(
      combined,
      { operation: "auth_callback" },
      { warn: writer },
    );
    expect(failure).toMatchObject({
      status: 401,
      internalCode: "AUTH_USER_NOT_ELIGIBLE",
    });
    expect(record(writer)).toMatchObject({
      code: "AUTH_USER_NOT_ELIGIBLE",
      stage: "identity_user_lookup",
      cleanupFailures: [
        { code: "UNEXPECTED_ERROR", stage: "client_release" },
        {
          code: "DATABASE_UNAVAILABLE",
          stage: "transaction_rollback",
          sqlstate: "08006",
        },
      ],
    });
    expect(JSON.stringify(writer.mock.calls)).not.toContain("synthetic-");
  });
  it.each([
    new Error("private-message https://private-host/signed-file"),
    "private-string",
    {
      code: "private-code",
      name: "private-name",
      detail: "private-detail",
      stack: "private-stack",
    },
    new FolioDiagnosticError({
      category: "actor",
      code: "private-code",
      retryable: true,
      detail: "private-detail",
    }),
  ])("never serializes arbitrary source fields", (error) => {
    const writer = vi.fn();
    const result = reportServerFailure(
      error,
      { operation: "safe_operation" },
      { error: writer },
    );
    expect(result).toMatchObject({
      internalCode: "UNEXPECTED_ERROR",
      publicFailure: { code: "UNEXPECTED_ERROR", recovery: "contact_support" },
    });
    expect(result.publicFailure.reference).toMatch(/^[0-9a-f-]{36}$/);
    expect(writer.mock.calls[0][0]).not.toMatch(
      /private|sourceError|stack|message|detail/,
    );
  });

  it("survives hostile diagnostic getters and proxy traps", () => {
    const writer = vi.fn();
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error("private-getter");
        },
        getPrototypeOf: () => {
          throw new Error("private-prototype");
        },
      },
    );
    expect(() =>
      reportServerFailure(
        hostile,
        { operation: "safe_operation", ids: hostile, metadata: hostile },
        { error: writer },
      ),
    ).not.toThrow();
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer.mock.calls[0][0]).not.toContain("private");
  });

  it("keeps only named UUID ids, bounded UUID arrays, and fixed numeric or enum metadata", () => {
    const writer = vi.fn();
    const ids = {
      actorId,
      transactionId,
      artifactId: "private-filename",
      credentialId: "private-token",
      unknownId: actorId,
      transactionIds: [transactionId, "private-input", transactionId],
      artifactIds: Array.from({ length: 80 }, () => actorId),
    };
    const metadata = {
      count: 2,
      rowCount: 3,
      issueCount: 1,
      statusCode: 403,
      provider: "postgres",
      sqlstate: "42501",
      reason: "encrypted",
      message: "private-message",
      filename: "private-name",
      input: "private-input",
      unknownCount: 7,
      negativeCount: -1,
      selectedCount: Number.POSITIVE_INFINITY,
    };
    writeServerSuccess(
      { operation: "safe_operation", ids, metadata },
      { info: writer },
    );
    expect(record(writer)).toMatchObject({
      actorId,
      transactionId,
      transactionIds: [transactionId],
      artifactIds: [actorId],
      count: 2,
      rowCount: 3,
      issueCount: 1,
      statusCode: 403,
      provider: "postgres",
      sqlstate: "42501",
      reason: "encrypted",
    });
    expect(writer.mock.calls[0][0]).not.toMatch(
      /private|unknown|negative|selectedCount/,
    );
    const bounded = vi.fn();
    writeServerSuccess(
      {
        operation: "safe_operation",
        ids: {
          transactionIds: Array.from(
            { length: 70 },
            (_, index) =>
              `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          ),
        },
      },
      { info: bounded },
    );
    expect(record(bounded).transactionIds).toHaveLength(50);
  });

  it("rejects arbitrary enum strings and invalid numeric metadata", () => {
    const writer = vi.fn();
    writeServerSuccess(
      {
        operation: "safe_operation",
        metadata: {
          provider: "private-provider",
          sqlstate: "private-state",
          reason: "private-reason",
          count: -1,
          rowCount: 1.5,
          issueCount: 1e20,
        },
        durationMs: Number.NaN,
      },
      { info: writer },
    );
    expect(record(writer)).not.toHaveProperty("provider");
    expect(record(writer)).not.toHaveProperty("count");
    expect(record(writer)).not.toHaveProperty("durationMs");
    expect(writer.mock.calls[0][0]).not.toContain("private");
  });

  it("does not serialize Zod custom messages, paths, or issue values", () => {
    const writer = vi.fn();
    const result = z
      .object({
        privatePath: z.string().refine(() => false, "private-message"),
      })
      .safeParse({ privatePath: "private-input" });
    const reported = reportServerFailure(
      result.error,
      { operation: "safe_operation" },
      { info: writer },
    );
    expect(reported).toMatchObject({
      status: 400,
      internalCode: "INPUT_INVALID",
      publicFailure: { code: "INPUT_INVALID", recovery: "fix_input" },
    });
    expect(reported.publicFailure).not.toHaveProperty("issues");
    expect(writer.mock.calls[0][0]).not.toMatch(/private|issues|message/);
  });

  it("uses internal auth reason and severity only in the server event", () => {
    const warn = vi.fn();
    const result = reportServerFailure(
      new AppError({
        code: "AUTH_USER_NOT_ELIGIBLE",
        stage: "authorization",
        cause: new Error("private-user"),
      }),
      { operation: "sign_in" },
      { warn },
    );
    expect(result).toMatchObject({
      internalCode: "AUTH_USER_NOT_ELIGIBLE",
      status: 401,
      publicFailure: { code: "SIGN_IN_FAILED", recovery: "sign_in" },
    });
    expect(record(warn)).toMatchObject({
      code: "AUTH_USER_NOT_ELIGIBLE",
      stage: "authorization",
      severity: "warn",
    });
    expect(JSON.stringify(result.publicFailure)).not.toMatch(
      /AUTH_USER|private/,
    );
  });

  it("retains one reference and event through handled errors and outer reporting", () => {
    const writer = vi.fn();
    const source = new Error("private-cause");
    const first = reportServerFailure(
      source,
      { operation: "inner" },
      { error: writer },
    );
    const publicError = new HandledOperationError(first, source);
    const next = reportServerFailure(
      publicError,
      { operation: "outer" },
      { error: writer },
    );
    expect(next).toBe(first);
    expect(
      toPublicFailure(
        publicError,
        { operation: "transport" },
        { error: writer },
      ),
    ).toBe(first.publicFailure);
    expect(writer).toHaveBeenCalledTimes(1);
    expect(publicError.cause).toBeUndefined();
    expect(publicError.stack).toBeUndefined();
    expect(JSON.stringify(publicError)).not.toContain("private");
  });

  it("logs each independent failure even when the writer throws", () => {
    const writer = vi.fn(() => {
      throw new Error("private-logger");
    });
    const first = reportServerFailure(
      new Error("private-source"),
      { operation: "safe_operation" },
      { error: writer },
    );
    expect(first.publicFailure.reference).toMatch(/^[0-9a-f-]{36}$/);
    expect(() =>
      writeServerSuccess({ operation: "safe_operation" }, { info: writer }),
    ).not.toThrow();
    expect(writer).toHaveBeenCalledTimes(2);
  });

  it("isolates concurrent async actor context and nested operation changes", async () => {
    const writer = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runWithDiagnosticContext(
      { operation: "first", ids: { actorId } },
      async () => {
        setDiagnosticContext({ ids: { transactionId } });
        await gate;
        await runWithDiagnosticContext({ operation: "nested" }, async () => {
          writeServerSuccess({ operation: "nested" }, { info: writer });
        });
        writeServerSuccess({ operation: "first" }, { info: writer });
      },
    );
    await runWithDiagnosticContext({ operation: "second" }, async () => {
      setDiagnosticContext({ ids: { actorId: transactionId } });
      writeServerSuccess({ operation: "second" }, { info: writer });
      release();
    });
    await first;
    expect(record(writer, 0)).toMatchObject({
      operation: "second",
      actorId: transactionId,
    });
    expect(record(writer, 0)).not.toHaveProperty("transactionId");
    expect(record(writer, 1)).toMatchObject({
      operation: "nested",
      actorId,
      transactionId,
    });
    expect(record(writer, 2)).toMatchObject({
      operation: "first",
      actorId,
      transactionId,
    });
    writeServerSuccess({ operation: "outside" }, { info: writer });
    expect(record(writer, 3)).not.toHaveProperty("actorId");
  });

  it("reports a typed returned PDF failure without turning it into a thrown failure", () => {
    const info = vi.fn();
    const reported = reportServerFailure(
      new AppError({
        code: "PDF_EXTRACTION_UNSUPPORTED",
        stage: "pdf_extraction",
      }),
      {
        operation: "extract_invoice_fields",
        metadata: { reason: "encrypted" },
      },
      { info },
    );
    expect(record(info)).toMatchObject({
      code: "PDF_EXTRACTION_UNSUPPORTED",
      reason: "encrypted",
      severity: "info",
    });
    expect(reported.publicFailure.recovery).toBe("fix_input");
  });

  it("preserves only valid client HTTP statuses for request rejection", () => {
    const warn = vi.fn();
    const rejected = reportServerFailure(
      new AppError({ code: "REQUEST_REJECTED" }),
      { operation: "server_request", metadata: { httpStatus: 405 } },
      { warn },
    );
    expect(rejected).toMatchObject({
      status: 405,
      publicFailure: { code: "REQUEST_FAILED" },
    });
    const malformed = reportServerFailure(
      new AppError({ code: "REQUEST_REJECTED" }),
      { operation: "server_request", metadata: { httpStatus: 900 } },
      { warn },
    );
    expect(malformed.status).toBe(400);
  });
});
