import { describe, expect, it } from "vitest";

import { sanitizeClientRenderFailure } from "./diagnostics";

describe("client render failure sanitization", () => {
  it("maps a non-string optional-chained trim failure to its specific safe diagnostic", () => {
    const failure = sanitizeClientRenderFailure(
      Object.assign(new TypeError("s?.trim is not a function"), {
        code: "UNSAFE_SOURCE_CODE",
      }),
    );

    expect(failure).toEqual({
      name: "TypeError",
      code: "CLIENT_RENDER_TRIM_NOT_STRING",
      message: "trim is not a function; the value is not a string",
    });
    expect(JSON.stringify(failure)).not.toContain("s?.trim");
    expect(JSON.stringify(failure)).not.toContain("UNSAFE_SOURCE_CODE");
  });
});
