import { afterEach, describe, expect, it, vi } from "vitest";
import { getRequest, setResponseStatus } from "@tanstack/react-start/server";
import { z } from "zod";

import {
  classifyError,
  FolioDiagnosticError,
  requestLogFieldsFor,
  runOperation,
  writeClientRenderFailure,
} from "./diagnostics";
import { AppError } from "../domain/errors";
import {
  HandledOperationError,
  reportServerFailure,
  setDiagnosticContext,
} from "./error-handling";
import { StripeCsvValidationError } from "../domain/stripe-csv";
import { ArtifactPresignRecoveryError } from "../documents/service";

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: vi.fn(),
  setResponseStatus: vi.fn(),
}));

afterEach(() => {
  vi.mocked(getRequest).mockReset();
  vi.mocked(setResponseStatus).mockReset();
});

describe("server diagnostics adapter", () => {
  it.each([
    ["BULK_TRANSACTION_CONFLICT", 409, "A selected transaction changed."],
    [
      "BULK_TRANSACTION_INELIGIBLE",
      422,
      "A selected transaction is missing or void.",
    ],
    [
      "BULK_OWNER_INACTIVE",
      422,
      "The selected owner is unavailable or inactive.",
    ],
    [
      "BANK_MATCH_EDIT_CONFLICT",
      409,
      "unmatch the bank row before changing it",
    ],
    ["REVISION_CONFLICT", 409, "reload before saving or voiding"],
    ["STRIPE_IMPORT_CONFLICT", 409, "A Stripe balance transaction conflicts"],
    ["UNAUTHENTICATED", 401, "Sign in to continue."],
    ["PERMISSION_DENIED", 403, "permission"],
  ])("preserves fixed guidance for %s", async (code, status, guidance) => {
    const error = vi.fn();
    await expect(
      runOperation(
        "Save transaction",
        async () => {
          throw new FolioDiagnosticError({
            category: "validation",
            code,
            retryable: false,
            detail: "private-detail",
          });
        },
        { error },
        { mutation: true },
      ),
    ).rejects.toThrow(guidance);
    expect(setResponseStatus).toHaveBeenCalledWith(status);
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
      code,
      retryable: false,
    });
    expect(error.mock.calls[0][0]).not.toContain("private-detail");
  });

  it("logs successful mutations and keeps successful reads quiet by default", async () => {
    const info = vi.fn();
    await expect(
      runOperation("List transactions", async () => "ok", { info }),
    ).resolves.toBe("ok");
    expect(info).not.toHaveBeenCalled();
    await runOperation(
      "Save transaction",
      async () => "saved",
      { info },
      { mutation: true },
    );
    expect(JSON.parse(info.mock.calls[0][0])).toMatchObject({
      operation: "save_transaction",
      phase: "success",
    });
  });

  it("suppresses success events for intentional returned validation failures", async () => {
    const info = vi.fn();
    const result = { status: "invalid" as const };
    await expect(
      runOperation(
        "Save",
        async () => result,
        { info },
        { mutation: true, successWhen: (value) => value.status !== "invalid" },
      ),
    ).resolves.toBe(result);
    expect(info).not.toHaveBeenCalled();
  });

  it("supports explicit read success logging and safe HTTP fields", async () => {
    const request = new Request(
      "http://localhost/transactions?search=private",
      { method: "POST" },
    );
    vi.mocked(getRequest).mockReturnValue(request);
    const info = vi.fn();
    await runOperation(
      "List transactions",
      async () => "ok",
      { info },
      { log: "all" },
    );
    expect(requestLogFieldsFor(request)).toEqual({
      requestMethod: "POST",
      requestPath: "/transactions",
    });
    expect(JSON.parse(info.mock.calls[0][0])).toMatchObject({
      requestMethod: "POST",
      requestPath: "/transactions",
    });
    expect(info.mock.calls[0][0]).not.toContain("search=private");
  });

  it.each(["/_serverFn", "/_serverFn/example", "/private-input"])(
    "omits HTTP fields for unrecognized path %s",
    async (path) => {
      vi.mocked(getRequest).mockReturnValue(
        new Request("http://localhost" + path),
      );
      const info = vi.fn();
      await runOperation(
        "List transactions",
        async () => "ok",
        { info },
        { log: "all" },
      );
      expect(JSON.parse(info.mock.calls[0][0])).not.toHaveProperty(
        "requestPath",
      );
    },
  );

  it.each(["none", "failures"] as const)(
    "always logs failures under log:%s",
    async (log) => {
      const info = vi.fn();
      const error = vi.fn();
      await runOperation(
        "Folio health check",
        async () => "ok",
        { info, error },
        { log },
      );
      const failure = await runOperation(
        "Folio health check",
        async () => {
          throw new Error("synthetic-operation-failure");
        },
        { info, error },
        { log },
      ).then(
        () => undefined,
        (rejection) => rejection,
      );
      expect(info).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/Reference [0-9a-f-]{36}/);
      expect((failure as Error).message).not.toContain(
        "synthetic-operation-failure",
      );
      expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
        message: "synthetic-operation-failure",
      });
    },
  );

  it("keeps public failures safe and deduplicates nested operations", async () => {
    const writer = vi.fn();
    const original = Object.assign(new Error("private-input"), {
      code: "private-code",
    });
    let failure: unknown;
    try {
      await runOperation(
        "Outer",
        () =>
          runOperation(
            "Inner",
            async () => {
              throw original;
            },
            { error: writer },
          ),
        { error: writer },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(HandledOperationError);
    expect((failure as Error).cause).toBeUndefined();
    expect(writer).toHaveBeenCalledTimes(1);
    const reported = reportServerFailure(
      failure,
      { operation: "middleware" },
      { error: writer },
    );
    expect((failure as Error).message).toContain(
      reported.publicFailure.reference,
    );
    expect(writer).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(failure)).not.toContain("private");
  });

  it("does not recommend retrying a database mutation with an uncertain outcome", async () => {
    const error = vi.fn();
    await expect(
      runOperation(
        "Save",
        async () => {
          throw { code: "08006" };
        },
        { error },
        { mutation: true },
      ),
    ).rejects.toThrow("DB_OUTCOME_UNKNOWN");
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
      code: "DB_OUTCOME_UNKNOWN",
      retryable: false,
      sqlstate: "08006",
    });
  });

  it("logs primary and cleanup messages without source fields", async () => {
    const writer = vi.fn();
    const artifactId = "0f935296-35b3-43bd-bc3d-0caa0b0a2510";
    const primary = Object.assign(new Error("synthetic-presign-message"), {
      name: "ServiceUnavailable",
      $metadata: { httpStatusCode: 503 },
    });
    const cleanup = Object.assign(new Error("synthetic-cleanup-message"), {
      code: "08006",
    });
    await expect(
      runOperation(
        "Start artifact upload",
        async () => {
          throw new ArtifactPresignRecoveryError(primary, artifactId, cleanup);
        },
        { error: writer },
        { mutation: true },
      ),
    ).rejects.toThrow("DEPENDENCY_UNAVAILABLE");
    expect(JSON.parse(writer.mock.calls[0][0])).toMatchObject({
      code: "S3_UNAVAILABLE",
      providerCode: "ServiceUnavailable",
      message: "synthetic-presign-message",
      cleanupFailure: {
        artifactId,
        code: "DATABASE_UNAVAILABLE",
        sqlstate: "08006",
        message: "synthetic-cleanup-message",
      },
    });
    expect(JSON.parse(writer.mock.calls[0][0])).not.toHaveProperty("stack");
    expect(JSON.parse(writer.mock.calls[0][0])).not.toHaveProperty(
      "sourceError",
    );
    expect(
      JSON.parse(writer.mock.calls[0][0]).cleanupFailure,
    ).not.toHaveProperty("name");
  });

  it.each([
    [{ code: "42501" }, "DB_PERMISSION_DENIED", false],
    [{ code: "42P01" }, "MIGRATION_REQUIRED", false],
    [{ code: "08006" }, "DATABASE_UNAVAILABLE", true],
    [
      { name: "CredentialsProviderError" },
      "AWS_CREDENTIALS_UNAVAILABLE",
      false,
    ],
    [
      { name: "AccessDenied", $metadata: { httpStatusCode: 403 } },
      "S3_ACCESS_DENIED",
      false,
    ],
    [
      { name: "ServiceUnavailable", $metadata: { httpStatusCode: 503 } },
      "S3_UNAVAILABLE",
      true,
    ],
    [{ status: 503 }, "UNEXPECTED_ERROR", false],
    [{ name: "S3ProxyError", status: 503 }, "UNEXPECTED_ERROR", false],
  ])("preserves provider classification", (value, code, retryable) => {
    expect(classifyError(value)).toMatchObject({ code, retryable });
  });

  it("logs Zod errors through the shared input policy without issue values", async () => {
    const error = vi.fn();
    const validation = z
      .object({ privateField: z.number() })
      .safeParse({ privateField: "private-value" });
    await expect(
      runOperation(
        "Validate",
        async () => {
          throw validation.error;
        },
        { error },
      ),
    ).rejects.toThrow("INPUT_INVALID");
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
      code: "INPUT_INVALID",
      message: "Request validation failed.",
    });
    expect(error.mock.calls[0][0]).not.toMatch(/private-value/);
  });

  it("retains authorized context added inside the operation", async () => {
    const info = vi.fn();
    const actorId = "0f935296-35b3-43bd-bc3d-0caa0b0a2510";
    await runOperation(
      "Save",
      async () => {
        setDiagnosticContext({ ids: { actorId } });
        return "ok";
      },
      { info },
      { mutation: true },
    );
    expect(JSON.parse(info.mock.calls[0][0])).toMatchObject({ actorId });
  });

  it("never lets logger failures change success or failure", async () => {
    const broken = () => {
      throw new Error("logger-unavailable");
    };
    await expect(
      runOperation(
        "Save",
        async () => "ok",
        { info: broken },
        { mutation: true },
      ),
    ).resolves.toBe("ok");
    await expect(
      runOperation(
        "Save",
        async () => {
          throw new Error("source-private");
        },
        { error: broken },
      ),
    ).rejects.toThrow("UNEXPECTED_ERROR");
  });

  it("preserves safe CSV detail and fixed unsupported report guidance", async () => {
    const error = vi.fn();
    await expect(
      runOperation(
        "Import stripe csv",
        async () => {
          throw new StripeCsvValidationError({
            reason: "missing_headers",
            rowNumber: 2,
            missingHeaders: ["created", "private-header"],
          });
        },
        { error },
      ),
    ).rejects.toThrow("Check the report format");
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
      detail: {
        reason: "missing_headers",
        rowNumber: 2,
        missingHeaders: ["created"],
      },
    });
    expect(error.mock.calls[0][0]).not.toContain("private-header");
    await expect(
      runOperation(
        "Import stripe csv",
        async () => {
          throw new StripeCsvValidationError({
            reason: "unsupported_all_activity_export",
          });
        },
        { error },
      ),
    ).rejects.toThrow("This is a Stripe All activity export.");
  });

  it("maps internal auth reasons to safe public codes", async () => {
    const error = vi.fn();
    await expect(
      runOperation(
        "Sign in",
        async () => {
          throw new AppError({ code: "AUTH_SUBJECT_MISMATCH" });
        },
        { error },
      ),
    ).rejects.toThrow("Code SIGN_IN_FAILED");
    expect(error.mock.calls[0][0]).toContain("AUTH_SUBJECT_MISMATCH");
  });
});

describe("client render diagnostics", () => {
  it.each([
    [
      {
        name: "TypeError",
        code: "CLIENT_RENDER_FAILURE",
        message: "Cannot read properties of undefined",
      },
      "CLIENT_RENDER_FAILURE",
      "Cannot read properties of undefined",
    ],
    [
      {
        name: "TypeError",
        code: "CLIENT_RENDER_TRIM_NOT_STRING",
        message: "trim is not a function; the value is not a string",
      },
      "CLIENT_RENDER_TRIM_NOT_STRING",
      "trim is not a function; the value is not a string",
    ],
    [
      {
        name: "private-name",
        code: "private-code",
        message: "private-message",
      },
      "CLIENT_RENDER_FAILURE",
      "Client render failed",
    ],
  ])("only writes fixed render fields", (failure, code, message) => {
    const writer = vi.fn();
    const reference = writeClientRenderFailure(failure as never, writer);
    expect(JSON.parse(writer.mock.calls[0][0])).toMatchObject({
      correlationId: reference,
      code,
      message,
    });
    expect(writer.mock.calls[0][0]).not.toMatch(/private|stack|sourceError/);
  });
});
