import { describe, expect, it } from "vitest";

import {
  defaultTaxTreatmentForCurrency,
  defaultTaxTreatmentForTransaction,
  suggestedDocumentTaxAmount,
} from "./tax";

describe("document tax suggestions", () => {
  it("suggests AUD GST included as total divided by eleven", () => {
    expect(suggestedDocumentTaxAmount("110.0000", "AUD", "gst_included")).toBe(
      "10.0000",
    );
  });

  it("does not infer tax for foreign currency or foreign tax", () => {
    expect(
      suggestedDocumentTaxAmount("110.0000", "USD", "gst_included"),
    ).toBeNull();
    expect(
      suggestedDocumentTaxAmount("110.0000", "AUD", "foreign_tax_included"),
    ).toBeNull();
  });

  it("leaves separately shown, no-tax, and unknown treatment unchanged", () => {
    for (const treatment of [
      "gst_separately_shown",
      "no_tax",
      "unknown_mixed",
    ] as const) {
      expect(
        suggestedDocumentTaxAmount("110.0000", "AUD", treatment),
      ).toBeNull();
    }
  });

  it("defaults document tax treatment by currency and keeps owner funding tax-free", () => {
    expect(defaultTaxTreatmentForCurrency("AUD")).toBe("gst_included");
    expect(defaultTaxTreatmentForCurrency("usd")).toBe("foreign_tax_included");
    expect(defaultTaxTreatmentForCurrency("AUD", true)).toBe("no_tax");
    expect(defaultTaxTreatmentForTransaction("AUD", "owner_loan")).toBe(
      "no_tax",
    );
    expect(defaultTaxTreatmentForTransaction("USD", "supplier_expense")).toBe(
      "foreign_tax_included",
    );
  });
});
