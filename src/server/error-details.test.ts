import { describe, expect, it } from "vitest";
import { z } from "zod";
import { redactDiagnosticText, serverErrorDetails } from "./error-details";
import {
  parseWithDiagnostics,
  rememberValidationSchema,
} from "../domain/validation-diagnostics";

describe("internal error diagnostics", () => {
  it("retains source identity, stack frames, causes and aggregate children", () => {
    const source = Object.assign(new Error("connection failed"), {
      code: "ECONNREFUSED",
    });
    const error = new AggregateError([source], "dependencies failed", {
      cause: new TypeError("setup failed"),
    });
    const detail = serverErrorDetails(error);
    expect(detail).toMatchObject({
      name: "AggregateError",
      message: "dependencies failed",
      cause: { name: "TypeError", message: "setup failed" },
      errors: [
        { name: "Error", code: "ECONNREFUSED", message: "connection failed" },
      ],
    });
    expect(detail.stack).toEqual(
      expect.arrayContaining([
        expect.stringContaining("error-details.test.ts:"),
      ]),
    );
  });

  it("retains validation locations without custom messages, values or dynamic keys", () => {
    const schema = z
      .object({ amount: z.number(), nested: z.record(z.number()) })
      .superRefine((_value, context) =>
        context.addIssue({ code: "custom", message: "submitted-content" }),
      );
    const parsed = schema.safeParse({
      amount: "submitted-content",
      nested: { "synthetic@example.invalid": "submitted-content" },
    });
    if (parsed.success) throw new Error("Expected validation failure");
    rememberValidationSchema(parsed.error, schema);
    const detail = serverErrorDetails(parsed.error);
    expect(detail.issues).toEqual([
      { code: "invalid_type", path: ["amount"], expected: "number" },
      {
        code: "invalid_type",
        path: ["nested", "[REDACTED_KEY]"],
        expected: "number",
      },
    ]);
    expect(JSON.stringify(detail)).not.toMatch(
      /submitted-content|synthetic@example/,
    );
    expect(detail).not.toHaveProperty("errors");
    const custom = z
      .string()
      .refine(() => false, "submitted-content")
      .safeParse("input");
    expect(JSON.stringify(serverErrorDetails(custom.error))).not.toContain(
      "submitted-content",
    );
  });

  it("redacts credentials, URLs and personal addresses throughout diagnostics", () => {
    const text =
      "data:text/plain,synthetic-inline AWS_SECRET_ACCESS_KEY=synthetic-aws FOLIO_LOCAL_PASSWORD=synthetic-local FOLIO_GOOGLE_CLIENT_SECRET=synthetic-client password=synthetic-password token=synthetic-token Bearer synthetic-bearer postgres://user:synthetic-pass@db/test https://example.invalid/?code=synthetic-code synthetic@example.invalid /Users/synthetic-owner/project/file.ts";
    const redacted = redactDiagnosticText(text);
    expect(redacted).not.toMatch(/synthetic-/);
    expect(redacted).toContain("[REDACTED");
    const detail = serverErrorDetails(
      new Error(text, { cause: new Error(text) }),
    );
    expect(JSON.stringify(detail)).not.toMatch(/synthetic-/);
  });

  it("marks cycles and depth, message and aggregate limits", () => {
    const cycle = new Error("cycle");
    cycle.cause = cycle;
    expect(serverErrorDetails(cycle)).toMatchObject({
      cause: { truncated: "cycle_or_repeated_reference" },
    });
    let deep = new Error("leaf");
    for (let index = 0; index < 12; index++)
      deep = new Error("parent", { cause: deep });
    expect(JSON.stringify(serverErrorDetails(deep))).toContain(
      '"truncated":"depth"',
    );
    expect(serverErrorDetails(new Error("x".repeat(9_000)))).toHaveProperty(
      "messageTruncated",
      true,
    );
    expect(
      serverErrorDetails(
        new AggregateError(
          Array.from({ length: 60 }, () => new Error("child")),
          "many",
        ),
      ),
    ).toHaveProperty("errorsTruncated", true);
    const source = Object.assign(new Error("worker diagnostic"), {
      truncated: "depth",
      messageTruncated: true,
      stackTruncated: true,
    });
    expect(serverErrorDetails(source)).toMatchObject({
      truncated: "depth",
      messageTruncated: true,
      stackTruncated: true,
    });
  });

  it("survives hostile exception properties", () => {
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error("getter");
        },
        getPrototypeOf: () => {
          throw new Error("prototype");
        },
      },
    );
    expect(() => serverErrorDetails(hostile)).not.toThrow();
    expect(serverErrorDetails(hostile)).toEqual({
      message: "No error message was available.",
    });
    const hostileZod = new Proxy(new z.ZodError([]), {
      get: (target, key, receiver) => {
        if (key === "issues") throw new Error("getter failed");
        return Reflect.get(target, key, receiver);
      },
    });
    expect(serverErrorDetails(hostileZod)).toHaveProperty(
      "issuesUnavailable",
      true,
    );
  });

  it("redacts submitted identifier keys even when they have valid identifier syntax", () => {
    const schema = z.object({ rows: z.array(z.record(z.number())) });
    const parsed = schema.safeParse({
      rows: [{ submitted_private_identifier: "input" }],
    });
    if (parsed.success) throw new Error("Expected validation failure");
    rememberValidationSchema(parsed.error, schema);
    expect(serverErrorDetails(parsed.error).issues).toEqual([
      {
        code: "invalid_type",
        expected: "number",
        path: ["rows", 0, "[REDACTED_KEY]"],
      },
    ]);
    expect(JSON.stringify(serverErrorDetails(parsed.error))).not.toContain(
      "submitted_private_identifier",
    );
  });

  it("retains schema-owned paths within union alternatives", () => {
    let failure: unknown;
    try {
      parseWithDiagnostics(
        z.union([
          z.object({ amount: z.number() }),
          z.object({ ownerId: z.string() }),
        ]),
        { amount: "submitted-value" },
      );
    } catch (error) {
      failure = error;
    }
    const detail = serverErrorDetails(failure);
    expect(detail).toMatchObject({
      issues: [
        {
          code: "invalid_union",
          alternatives: [
            { issues: [{ code: "invalid_type", path: ["amount"] }] },
            { issues: [{ code: "invalid_type", path: ["ownerId"] }] },
          ],
        },
      ],
    });
    expect(JSON.stringify(detail)).not.toContain("submitted-value");
  });
});
