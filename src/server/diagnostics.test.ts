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

describe("server diagnostics", () => {
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
  ])(
    "returns actionable atomic bulk rejection for %s",
    async (code, status, guidance) => {
      await expect(
        runOperation(
          "Apply transaction bulk edit",
          async () => {
            throw new FolioDiagnosticError({
              category: "validation",
              code,
              retryable: false,
            });
          },
          { error: vi.fn() },
          { mutation: true },
        ),
      ).rejects.toThrow(guidance);
      expect(vi.mocked(setResponseStatus)).toHaveBeenCalledWith(status);
    },
  );

  it("explains an incompatible matched edit as a non-retryable conflict", async () => {
    const error = vi.fn();
    await expect(
      runOperation(
        "Save manual transaction",
        async () => {
          throw new FolioDiagnosticError({
            category: "validation",
            code: "BANK_MATCH_EDIT_CONFLICT",
            retryable: false,
            httpStatus: 409,
          });
        },
        { error },
      ),
    ).rejects.toThrow("unmatch the bank row before changing it");
    expect(setResponseStatus).toHaveBeenCalledWith(409);
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
      code: "BANK_MATCH_EDIT_CONFLICT",
      retryable: false,
    });
  });

  it("logs the incoming method and pathname without query parameters", async () => {
    const request = new Request(
      "http://127.0.0.1:43230/transactions?search=private",
      { method: "POST" },
    );
    vi.mocked(getRequest).mockReturnValue(request);
    const info = vi.fn();

    await runOperation("List transactions", async () => "ok", { info });

    const record = JSON.parse(info.mock.calls[0][0]);
    expect(requestLogFieldsFor(request)).toEqual({
      requestMethod: "POST",
      requestPath: "/transactions",
    });
    expect(record).toMatchObject({
      operation: "list_transactions",
      requestMethod: "POST",
      requestPath: "/transactions",
      phase: "success",
    });
    expect(record).not.toHaveProperty("correlationId");
    expect(info.mock.calls[0][0]).not.toContain("search=private");
  });

  it.each(["/_serverFn", "/_serverFn/example"])(
    "omits HTTP request fields for %s",
    async (pathname) => {
      const request = new Request(
        `http://127.0.0.1:43230${pathname}?search=private`,
        { method: "POST" },
      );
      vi.mocked(getRequest).mockReturnValue(request);
      const info = vi.fn();

      await runOperation("List transactions", async () => "ok", { info });

      expect(requestLogFieldsFor(request)).toEqual({});
      const record = JSON.parse(info.mock.calls[0][0]);
      expect(record).not.toHaveProperty("requestMethod");
      expect(record).not.toHaveProperty("requestPath");
      expect(info.mock.calls[0][0]).not.toContain("search=private");
    },
  );

  it("logs routine access only on failure and retains its failure reference", async () => {
    vi.mocked(getRequest).mockReturnValue(
      new Request("http://127.0.0.1:43230/transactions?page=2"),
    );
    const info = vi.fn();
    const error = vi.fn();
    const options = { log: "failures" as const };

    await expect(
      runOperation("Folio access", async () => true, { info, error }, options),
    ).resolves.toBe(true);
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    await expect(
      runOperation(
        "Folio access",
        async () => {
          throw new Error("runtime unavailable");
        },
        { info, error },
        options,
      ),
    ).rejects.toThrow(/Reference [0-9a-f-]{36}/);
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
      operation: "folio_access",
      phase: "failure",
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      requestMethod: "GET",
      requestPath: "/transactions",
    });
    expect(error.mock.calls[0][0]).not.toContain("page=2");
  });

  it("suppresses health-check events and does not issue an unlogged reference", async () => {
    const info = vi.fn();
    const error = vi.fn();
    const writers = { info, error };
    const options = { log: "none" as const };

    await expect(
      runOperation("Folio health check", async () => "ok", writers, options),
    ).resolves.toBe("ok");
    await expect(
      runOperation(
        "Folio health check",
        async () => {
          throw new Error("database unavailable");
        },
        writers,
        options,
      ),
    ).rejects.toThrow(/^Folio health check failed\. Code UNEXPECTED_ERROR\.$/);
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("writes a correlated client render failure using only safe fields", () => {
    vi.mocked(getRequest).mockReturnValue(
      new Request("http://127.0.0.1:43230/_serverFn/render?detail=private", {
        method: "POST",
      }),
    );
    const writer = vi.fn();
    const correlationId = writeClientRenderFailure(
      {
        name: "TypeError",
        code: "CLIENT_RENDER_FAILURE",
        message: "Cannot read properties of undefined",
      },
      writer,
    );

    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(writer.mock.calls[0]?.[0])).toMatchObject({
      event: "folio.client_render_failure",
      version: 1,
      correlationId,
      name: "TypeError",
      code: "CLIENT_RENDER_FAILURE",
      message: "Cannot read properties of undefined",
    });
    expect(writer.mock.calls[0]?.[0]).not.toMatch(
      /sourceError|stack|pathname|counterparty|description/,
    );
    expect(writer.mock.calls[0]?.[0]).not.toContain("detail=private");
    expect(JSON.parse(writer.mock.calls[0]?.[0])).not.toHaveProperty(
      "requestMethod",
    );
    expect(JSON.parse(writer.mock.calls[0]?.[0])).not.toHaveProperty(
      "requestPath",
    );
  });

  it("preserves the allowlisted non-string trim failure detail", () => {
    const writer = vi.fn();
    const correlationId = writeClientRenderFailure(
      {
        name: "TypeError",
        code: "CLIENT_RENDER_TRIM_NOT_STRING",
        message: "trim is not a function; the value is not a string",
      },
      writer,
    );

    expect(JSON.parse(writer.mock.calls[0]?.[0])).toMatchObject({
      event: "folio.client_render_failure",
      correlationId,
      name: "TypeError",
      code: "CLIENT_RENDER_TRIM_NOT_STRING",
      message: "trim is not a function; the value is not a string",
    });
  });

  it("falls back to safe client render fields for untrusted values", () => {
    const writer = vi.fn();
    writeClientRenderFailure(
      {
        name: "Person Name",
        code: "person@example.test",
        message: "person@example.test",
      } as never,
      writer,
    );

    expect(JSON.parse(writer.mock.calls[0]?.[0])).toMatchObject({
      name: "Error",
      code: "CLIENT_RENDER_FAILURE",
      message: "Client render failed",
    });
    expect(writer.mock.calls[0]?.[0]).not.toContain("person@example.test");
  });

  it("retains presign and cleanup failures without exposing recovery detail to the client", async () => {
    const failure = vi.fn();
    const artifactId = "0f935296-35b3-43bd-bc3d-0caa0b0a2510";
    const primary = Object.assign(new Error("presign unavailable"), {
      name: "ServiceUnavailable",
      code: "ServiceUnavailable",
      $metadata: { httpStatusCode: 503 },
    });
    primary.stack = "primary stack";
    const cleanup = Object.assign(new Error("database cleanup unavailable"), {
      name: "CleanupDatabaseError",
      code: "08006",
      filename: "unsafe.csv",
      checksumSha256: "unsafe-checksum",
      objectContent: "unsafe-object-content",
    });
    cleanup.stack = "cleanup stack";
    let clientFailure: unknown;
    try {
      await runOperation(
        "start_artifact_upload",
        async () => {
          throw new ArtifactPresignRecoveryError(primary, artifactId, cleanup);
        },
        { error: failure },
        { mutation: true },
      );
    } catch (error) {
      clientFailure = error;
    }
    expect(clientFailure).toBeInstanceOf(Error);
    expect((clientFailure as Error).message).toMatch(
      /Code S3_UNAVAILABLE\. Reference [0-9a-f-]{36}\./,
    );
    expect((clientFailure as Error).message).not.toContain(artifactId);
    expect((clientFailure as Error).message).not.toContain(primary.message);
    expect((clientFailure as Error).message).not.toContain(cleanup.message);

    const record = JSON.parse(failure.mock.calls[0][0]);
    expect(record).toMatchObject({
      code: "S3_UNAVAILABLE",
      sourceError: {
        name: primary.name,
        code: primary.code,
        message: primary.message,
        stack: primary.stack,
        cleanupFailure: {
          artifactId,
          error: {
            name: cleanup.name,
            code: cleanup.code,
            message: cleanup.message,
          },
        },
      },
    });
    const serialized = JSON.stringify(record.sourceError.cleanupFailure);
    expect(serialized).not.toContain("filename");
    expect(serialized).not.toContain("checksum");
    expect(serialized).not.toContain("objectContent");
    expect(serialized).not.toContain("cleanup stack");
  });

  it("emits no cleanup warning when abandonment succeeded", async () => {
    const failure = vi.fn();
    const primary = new Error("presign unavailable");
    await expect(
      runOperation(
        "start_artifact_upload",
        async () => {
          throw primary;
        },
        { error: failure },
      ),
    ).rejects.toThrow(/Code UNEXPECTED_ERROR/);
    expect(JSON.parse(failure.mock.calls[0][0]).sourceError).not.toHaveProperty(
      "cleanupFailure",
    );
  });

  it.each([
    [{ code: "42501", message: "secret" }, "DB_PERMISSION_DENIED", false],
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
  ])("classifies an allowlisted provider failure", (error, code, retryable) => {
    expect(classifyError(error)).toMatchObject({ code, retryable });
  });

  it("emits lifecycle records and a matching generic client reference", async () => {
    const info = vi.fn();
    const failure = vi.fn();
    const sensitive = new Error(
      "operator@example.test https://signed.example secret.pdf",
    );
    sensitive.name = "SourceFailure";
    (sensitive as Error & { code: string }).code = "E_SOURCE";
    sensitive.stack = "source stack";

    await expect(
      runOperation(
        "save_manual_transaction",
        async () => {
          throw sensitive;
        },
        { info, error: failure },
      ),
    ).rejects.toThrow(/Code UNEXPECTED_ERROR\. Reference [0-9a-f-]{36}\./);

    const records = [...info.mock.calls, ...failure.mock.calls].map(([line]) =>
      JSON.parse(line),
    );
    expect(records.map(({ phase }) => phase)).toEqual(["failure"]);
    expect(info).not.toHaveBeenCalled();
    expect(records[0]).toMatchObject({
      event: "folio.operation",
      version: 1,
      operation: "save_manual_transaction",
      retryable: false,
      category: "unknown",
      code: "UNEXPECTED_ERROR",
      sourceError: {
        name: "SourceFailure",
        code: "E_SOURCE",
        message: sensitive.message,
        stack: "source stack",
      },
    });
    expect(JSON.stringify(records[0].sourceError)).toContain(sensitive.message);
  });

  it.each([
    ["string", "E_SOURCE", "E_SOURCE"],
    ["number", 42, 42],
    ["boolean", false, false],
    ["null", null, null],
    ["undefined", undefined, undefined],
    ["non-finite number", Number.NaN, undefined],
  ])("preserves JSON-safe Error codes (%s)", async (_kind, code, expected) => {
    const failure = vi.fn();
    const source = new Error("source failure");
    Object.defineProperty(source, "code", { value: code });

    await expect(
      runOperation(
        "load_config",
        async () => {
          throw source;
        },
        { info: vi.fn(), error: failure },
      ),
    ).rejects.toThrow(/Code UNEXPECTED_ERROR\. Reference [0-9a-f-]{36}\./);

    const record = JSON.parse(failure.mock.calls[0][0]);
    if (expected === undefined) {
      expect(record.sourceError).not.toHaveProperty("code");
    } else {
      expect(record.sourceError.code).toBe(expected);
    }
  });

  it("logs Zod issues without the error message, stack, or input value", async () => {
    const failure = vi.fn();
    const inputValue = "sensitive-input";
    const result = z
      .object({ amount: z.number() })
      .safeParse({ amount: inputValue });
    if (!result.error) throw new Error("expected Zod parsing to fail");

    await expect(
      runOperation(
        "load_config",
        async () => {
          throw result.error;
        },
        { info: vi.fn(), error: failure },
      ),
    ).rejects.toThrow(/Code UNEXPECTED_ERROR\. Reference [0-9a-f-]{36}\./);

    const record = JSON.parse(failure.mock.calls[0][0]);
    expect(record).toMatchObject({
      category: "unknown",
      code: "UNEXPECTED_ERROR",
      sourceError: {
        name: "ZodError",
        issues: result.error.issues,
      },
    });
    expect(record.sourceError).not.toHaveProperty("message");
    expect(record.sourceError).not.toHaveProperty("stack");
    expect(JSON.stringify(record.sourceError)).not.toContain(inputValue);
  });

  it("represents non-Error throws without serializing their values", async () => {
    const failure = vi.fn();
    const thrown: Record<string, unknown> = {};
    thrown.self = thrown;

    await expect(
      runOperation(
        "load_config",
        async () => {
          throw thrown;
        },
        { info: vi.fn(), error: failure },
      ),
    ).rejects.toThrow(/Code UNEXPECTED_ERROR\. Reference [0-9a-f-]{36}\./);

    const record = JSON.parse(failure.mock.calls[0][0]);
    expect(record.sourceError).toEqual({ kind: "object" });
  });

  it("wraps non-Error throws whose diagnostic getters fail", async () => {
    const failure = vi.fn();
    const throwingGetter = () => {
      throw new Error("getter failed");
    };
    const thrown = Object.defineProperties(
      {},
      {
        code: { get: throwingGetter },
        Code: { get: throwingGetter },
        name: { get: throwingGetter },
        statusCode: { get: throwingGetter },
        status: { get: throwingGetter },
        $metadata: { get: throwingGetter },
      },
    );

    await expect(
      runOperation(
        "load_config",
        async () => {
          throw thrown;
        },
        { info: vi.fn(), error: failure },
      ),
    ).rejects.toThrow(/Code UNEXPECTED_ERROR\. Reference [0-9a-f-]{36}\./);

    expect(failure).toHaveBeenCalledTimes(1);
    const record = JSON.parse(failure.mock.calls[0][0]);
    expect(record).toMatchObject({
      category: "unknown",
      code: "UNEXPECTED_ERROR",
      sourceError: { kind: "object" },
    });
  });

  it("wraps non-Error proxies whose prototype checks fail", async () => {
    const failure = vi.fn();
    const thrown = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("prototype trap");
        },
      },
    );

    await expect(
      runOperation(
        "load_config",
        async () => {
          throw thrown;
        },
        { info: vi.fn(), error: failure },
      ),
    ).rejects.toThrow(/Code UNEXPECTED_ERROR\. Reference [0-9a-f-]{36}\./);

    expect(failure).toHaveBeenCalledTimes(1);
    const record = JSON.parse(failure.mock.calls[0][0]);
    expect(record).toMatchObject({
      category: "unknown",
      code: "UNEXPECTED_ERROR",
      sourceError: { kind: "object" },
    });
  });

  it("returns successful results even when logging fails", async () => {
    const broken = () => {
      throw new Error("logger unavailable");
    };
    await expect(
      runOperation("health_check", async () => "ok", { info: broken }),
    ).resolves.toBe("ok");
  });

  it("returns the generic client failure even when failure logging fails", async () => {
    const broken = () => {
      throw new Error("logger unavailable");
    };
    await expect(
      runOperation(
        "health_check",
        async () => {
          throw new Error("source failure");
        },
        { error: broken },
      ),
    ).rejects.toThrow(/Code UNEXPECTED_ERROR\. Reference [0-9a-f-]{36}\./);
  });

  it("does not classify generic HTTP errors as S3 failures", () => {
    expect(classifyError({ status: 503 })).toMatchObject({
      code: "UNEXPECTED_ERROR",
      category: "unknown",
    });
  });

  it("does not trust S3-prefixed third-party error names", () => {
    expect(classifyError({ name: "S3ProxyError", status: 503 })).toMatchObject({
      code: "UNEXPECTED_ERROR",
      category: "unknown",
    });
  });

  it("does not recommend retrying a database mutation with an uncertain outcome", async () => {
    const failure = vi.fn();
    await expect(
      runOperation(
        "save",
        async () => {
          throw { code: "08006" };
        },
        { info: vi.fn(), error: failure },
        { mutation: true },
      ),
    ).rejects.toThrow(/DB_OUTCOME_UNKNOWN/);
    expect(JSON.parse(failure.mock.calls[0][0])).toMatchObject({
      code: "DB_OUTCOME_UNKNOWN",
      retryable: false,
    });
  });

  it("preserves safe typed actor guidance", () => {
    expect(
      classifyError(
        new FolioDiagnosticError({
          category: "actor",
          code: "ACTOR_NOT_FOUND",
          retryable: false,
        }),
      ),
    ).toMatchObject({ code: "ACTOR_NOT_FOUND" });
  });

  it.each([
    ["UNAUTHENTICATED", 401],
    ["PERMISSION_DENIED", 403],
  ] as const)("maps actor diagnostic %s to HTTP %i", async (code, status) => {
    const failure = vi.fn();
    await expect(
      runOperation(
        "protected operation",
        async () => {
          throw new FolioDiagnosticError({
            category: "actor",
            code,
            retryable: false,
          });
        },
        { error: failure },
      ),
    ).rejects.toThrow(`Code ${code}`);

    expect(setResponseStatus).toHaveBeenCalledWith(status);
    expect(JSON.parse(failure.mock.calls[0][0])).toMatchObject({
      category: "actor",
      code,
    });
  });

  it("does not turn unexpected failures into authentication responses", async () => {
    const failure = vi.fn();
    await expect(
      runOperation(
        "protected operation",
        async () => {
          throw new Error("session store unavailable");
        },
        { error: failure },
      ),
    ).rejects.toThrow(/Code UNEXPECTED_ERROR/);

    expect(setResponseStatus).not.toHaveBeenCalled();
    expect(JSON.parse(failure.mock.calls[0][0])).toMatchObject({
      category: "unknown",
      code: "UNEXPECTED_ERROR",
    });
  });

  it("provides fixed guidance for Stripe import conflicts", async () => {
    const failure = vi.fn();
    await expect(
      runOperation(
        "stripe_import",
        async () => {
          throw new FolioDiagnosticError({
            category: "validation",
            code: "STRIPE_IMPORT_CONFLICT",
            retryable: false,
          });
        },
        { info: vi.fn(), error: failure },
      ),
    ).rejects.toThrow(
      /A Stripe balance transaction conflicts with an existing import\. Review the existing transaction before importing again\. Code STRIPE_IMPORT_CONFLICT\. Reference [0-9a-f-]{36}\./,
    );
    expect(JSON.parse(failure.mock.calls[0][0])).toMatchObject({
      category: "validation",
      code: "STRIPE_IMPORT_CONFLICT",
      retryable: false,
    });
  });

  it("classifies revision conflicts with fixed safe reload guidance", async () => {
    const conflict = new FolioDiagnosticError({
      category: "database",
      code: "REVISION_CONFLICT",
      retryable: false,
    });
    expect(classifyError(conflict)).toEqual({
      category: "database",
      code: "REVISION_CONFLICT",
      retryable: false,
    });

    const failure = vi.fn();
    await expect(
      runOperation(
        "save_manual_transaction",
        async () => {
          throw conflict;
        },
        { info: vi.fn(), error: failure },
        { mutation: true },
      ),
    ).rejects.toThrow(
      "Transaction changed since it was opened; reload before saving or voiding. Code REVISION_CONFLICT.",
    );
    expect(JSON.parse(failure.mock.calls[0][0])).toMatchObject({
      category: "database",
      code: "REVISION_CONFLICT",
      detail:
        "Transaction changed since it was opened; reload before saving or voiding.",
      retryable: false,
    });
    expect(JSON.parse(failure.mock.calls[0][0]).sourceError).toMatchObject({
      name: "FolioDiagnosticError",
      code: "REVISION_CONFLICT",
      message: "REVISION_CONFLICT",
    });
  });

  it("logs safe CSV detail and returns fixed client guidance", async () => {
    const failure = vi.fn();
    await expect(
      runOperation(
        "import_stripe_csv",
        async () => {
          throw new StripeCsvValidationError({
            reason: "missing_headers",
            rowNumber: 2,
            missingHeaders: ["created", "secret_header"],
          });
        },
        { info: vi.fn(), error: failure },
      ),
    ).rejects.toThrow(
      /The Stripe Balance Summary itemised CSV has invalid or missing data\. Check the report format and upload it again\. Code STRIPE_CSV_INVALID\. Reference [0-9a-f-]{36}\./,
    );

    const record = JSON.parse(failure.mock.calls[0][0]);
    expect(record).toMatchObject({
      category: "validation",
      code: "STRIPE_CSV_INVALID",
      retryable: false,
      detail: {
        reason: "missing_headers",
        rowNumber: 2,
        missingHeaders: ["created"],
      },
    });
    expect(JSON.stringify(record)).not.toContain("secret_header");
  });

  it("explains that Stripe All activity is an unsupported report", async () => {
    await expect(
      runOperation(
        "import_stripe_csv",
        async () => {
          throw new StripeCsvValidationError({
            reason: "unsupported_all_activity_export",
          });
        },
        { info: vi.fn(), error: vi.fn() },
      ),
    ).rejects.toThrow(
      /This is a Stripe All activity export\. Folio requires the itemised Balance change from activity CSV from Reporting > Balance Summary Reports\./,
    );
  });
});
