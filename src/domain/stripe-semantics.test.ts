import { describe, expect, it } from "vitest";

import {
  classifyStripeReportingCategory,
  stripeBalanceMovement,
  stripeDisplayDescription,
  stripeDisplaySource,
  stripeNetBalanceMovement,
  stripeReportingCategoryKinds,
} from "./stripe-semantics";

describe("Stripe reporting semantics", () => {
  it("classifies supported categories with exact mappings", () => {
    expect(
      Object.fromEntries(
        Object.entries(stripeReportingCategoryKinds).map(([category]) => [
          category,
          classifyStripeReportingCategory(category),
        ]),
      ),
    ).toMatchObject(
      Object.fromEntries(
        Object.entries(stripeReportingCategoryKinds).map(([category, kind]) => [
          category,
          {
            reportingCategory: category,
            normalizedCategory: category,
            kind,
            known: true,
            requiresReview: kind === "adjustment",
          },
        ]),
      ),
    );
    expect(classifyStripeReportingCategory("  CHARGE ").kind).toBe("sale");
  });

  it("does not classify unknown categories by substring", () => {
    expect(classifyStripeReportingCategory("refund_fee")).toMatchObject({
      reportingCategory: "refund_fee",
      normalizedCategory: "refund_fee",
      kind: "adjustment",
      known: false,
      requiresReview: true,
    });
    expect(
      classifyStripeReportingCategory("some_dispute_like_value").kind,
    ).toBe("adjustment");
  });

  it("uses the imported description and a source fallback", () => {
    expect(stripeDisplayDescription({ description: "  Subscription  " })).toBe(
      "Subscription",
    );
    expect(stripeDisplayDescription({ description: null })).toBe(
      "Stripe import",
    );
    expect(stripeDisplaySource()).toBe("Stripe import");
  });

  it("publishes source net movement without tax classification", () => {
    const input = {
      sourceSystem: "stripe" as const,
      status: "recorded" as const,
      occurredAt: "2026-09-01T00:00:00.000Z",
      sourceCurrency: "AUD",
      sourceNet: "-10.3200",
    };
    expect(stripeBalanceMovement(input)).toEqual({
      date: input.occurredAt,
      currency: "AUD",
      net: "-10.3200",
    });
    expect(stripeNetBalanceMovement(input)).toBe("-10.3200");
  });
});
