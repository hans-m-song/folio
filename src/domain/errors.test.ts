import { describe, expect, it } from "vitest";

import { AppError, errorPolicyCatalog, errorPolicyFor } from "./errors";

describe("error policy catalog", () => {
  it("defaults arbitrary and inherited codes to the fixed unexpected policy", () => {
    for (const code of ["private-input", "toString", "__proto__", null, 42]) {
      expect(errorPolicyFor(code)).toMatchObject({
        code: "UNEXPECTED_ERROR",
        status: 500,
        retryable: false,
      });
    }
  });

  it("gives every catalog entry a safe complete policy", () => {
    for (const code of Object.keys(errorPolicyCatalog)) {
      const selected = errorPolicyFor(code);
      expect(selected.code).toBe(code);
      expect(selected.status).toBeGreaterThanOrEqual(400);
      expect(selected.status).toBeLessThanOrEqual(599);
      expect(selected.message.length).toBeGreaterThan(0);
      expect(selected.recovery).toMatch(
        /^(fix_input|sign_in|refresh|retry|verify_outcome|contact_support|none)$/,
      );
    }
  });

  it("normalizes unknown runtime codes and retains the original cause internally", () => {
    const cause = new Error("private-cause");
    const error = new AppError({
      code: "private-input" as never,
      stage: "authorization",
      cause,
    });
    expect(error.code).toBe("UNEXPECTED_ERROR");
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain("private");
  });

  it("publicly groups auth reasons while keeping dependency status distinct", () => {
    expect(errorPolicyFor("AUTH_USER_NOT_ELIGIBLE")).toMatchObject({
      publicCode: "SIGN_IN_FAILED",
      status: 401,
      severity: "warn",
    });
    expect(errorPolicyFor("AUTH_PROVIDER_UNAVAILABLE")).toMatchObject({
      publicCode: "SIGN_IN_FAILED",
      status: 503,
      severity: "error",
    });
    expect(errorPolicyFor("AUTH_SESSION_CREATION_FAILED")).toMatchObject({
      publicCode: "SIGN_IN_FAILED",
      status: 500,
      severity: "error",
    });
  });
});
