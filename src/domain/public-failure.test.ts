import { describe, expect, it } from "vitest";
import { publicFailureFrom } from "./public-failure";
import { unsupportedStripeExportMessage } from "./errors";

const reference = "11111111-1111-4111-8111-111111111111";

describe("public failure decoding", () => {
  it("retains approved export-specific recovery guidance after transport", () => {
    expect(
      publicFailureFrom(
        new Error(
          `${unsupportedStripeExportMessage} Code STRIPE_CSV_INVALID. Reference ${reference}.`,
        ),
      )?.message,
    ).toBe(unsupportedStripeExportMessage);
  });
  it("retains approved recovery and reference after an Error-only transport roundtrip", () => {
    expect(
      publicFailureFrom(
        new Error(
          `The result is uncertain. Check Folio before attempting the operation again. Code DB_OUTCOME_UNKNOWN. Reference ${reference}.`,
        ),
      ),
    ).toMatchObject({
      code: "DB_OUTCOME_UNKNOWN",
      reference,
      recovery: "verify_outcome",
    });
  });

  it("never displays arbitrary messages, recovery instructions or operational codes", () => {
    const failure = publicFailureFrom({
      publicFailure: {
        code: "REQUEST_FAILED",
        reference,
        message: "synthetic-private-message",
        recovery: "retry",
      },
    });
    expect(failure).toMatchObject({
      code: "REQUEST_FAILED",
      recovery: "contact_support",
    });
    expect(failure?.message).not.toContain("synthetic-private");
    expect(
      publicFailureFrom(new Error("synthetic-provider-message")),
    ).toBeUndefined();
    expect(
      publicFailureFrom({
        publicFailure: { code: "synthetic-private-code", reference },
      }),
    ).toBeUndefined();
  });

  it("rejects malformed references and survives hostile error objects", () => {
    expect(
      publicFailureFrom({
        publicFailure: {
          code: "REQUEST_FAILED",
          reference: "synthetic-private",
        },
      }),
    ).toBeUndefined();
    expect(
      publicFailureFrom(
        new Proxy(
          {},
          {
            get: () => {
              throw new Error("synthetic-private");
            },
          },
        ),
      ),
    ).toBeUndefined();
  });
});
