import { describe, expect, it } from "vitest";

import { FolioDiagnosticError } from "./diagnostics";
import { assertExpectedRevision, revisionConflictError } from "./revisions";

describe("optimistic transaction revision", () => {
  it("accepts an exact PostgreSQL microsecond revision", () => {
    const current = "2026-09-15T00:00:00.123456Z";
    expect(() =>
      assertExpectedRevision(current, "2026-09-15T00:00:00.123456Z"),
    ).not.toThrow();
  });

  it("accepts equivalent UTC offsets without losing microseconds", () => {
    expect(() =>
      assertExpectedRevision(
        "2026-09-15T00:00:00.123456Z",
        "2026-09-15T10:00:00.123456+10:00",
      ),
    ).not.toThrow();
  });

  it("rejects a stale revision that loses the microsecond suffix", () => {
    const current = "2026-09-15T00:00:00.123456Z";
    expect(() =>
      assertExpectedRevision(current, "2026-09-15T00:00:00.123Z"),
    ).toThrow(revisionConflictError());

    try {
      assertExpectedRevision(current, "2026-09-15T00:00:00.123789Z");
    } catch (error) {
      expect(error).toBeInstanceOf(FolioDiagnosticError);
      expect(error).toMatchObject({
        diagnostic: {
          category: "database",
          code: "REVISION_CONFLICT",
          retryable: false,
        },
      });
    }
  });
});
