import { describe, expect, it } from "vitest";

import { settlementDisplayState, settlementState } from "./settlement";

describe("settlement state", () => {
  it("is settled only when date, amount, and currency are all present", () => {
    expect(
      settlementState({
        settledAt: "2026-09-15T00:00:00Z",
        settlementAmount: "100.0000",
        settlementCurrency: "AUD",
      }),
    ).toBe("settled");
    expect(
      settlementState({
        settledAt: "2026-09-15T00:00:00Z",
        settlementAmount: null,
        settlementCurrency: "AUD",
      }),
    ).toBe("pending");
    expect(
      settlementState({
        settledAt: null,
        settlementAmount: "100.0000",
        settlementCurrency: "AUD",
      }),
    ).toBe("pending");
  });

  it("only displays settlement state for recorded manual transactions", () => {
    const settled = {
      sourceSystem: "manual" as const,
      status: "recorded" as const,
      settledAt: "2026-09-15T00:00:00Z",
      settlementAmount: "100.0000",
      settlementCurrency: "AUD",
    };
    expect(settlementDisplayState(settled)).toBe("settled");
    expect(settlementDisplayState({ ...settled, settlementAmount: null })).toBe(
      "pending",
    );
    expect(settlementDisplayState({ ...settled, status: "draft" })).toBeNull();
    expect(settlementDisplayState({ ...settled, status: "void" })).toBeNull();
    expect(
      settlementDisplayState({ ...settled, sourceSystem: "stripe" }),
    ).toBeNull();
  });
});
