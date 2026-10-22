import { describe, expect, it } from "vitest";

import {
  applyFileFilenameSuggestions,
  parseCsvFilename,
  parseFileFilename,
  parseFilenameCoveragePeriod,
} from "./file-filename";

describe("file filename suggestions", () => {
  it("parses invoice metadata from the original PDF filename", () => {
    expect(
      parseFileFilename("Acme Building-Supplies-2026-02-28-INV-104.pdf"),
    ).toEqual({
      supplier: "Acme Building-Supplies",
      documentDate: "2026-02-28",
      reference: "INV-104",
      periodStart: null,
      periodEnd: null,
    });
  });

  it.each([
    "stripe_2026-01-01_to_2026-01-31.csv",
    "stripe_2026-01-01_2026-01-31.csv",
    "stripe/2026-01-01/2026-01-31.csv",
    "export-2026-01-01-2026-01-31.csv",
  ])("parses an explicit, ordered coverage range in %s", (filename) => {
    expect(parseFilenameCoveragePeriod(filename)).toEqual({
      start: "2026-01-01",
      end: "2026-01-31",
    });
  });

  it.each([
    "export-2026-01-01_2026-01-31_2026-02-01.csv",
    "export-2025-02-29_to_2025-03-01.csv",
    "export-2026-02-01_to_2026-01-31.csv",
    "export-2026-01-01.csv",
    "export-12026-01-01_to_2026-01-31.csv",
  ])("does not infer a coverage range from %s", (filename) => {
    expect(parseFilenameCoveragePeriod(filename)).toBeNull();
  });

  it.each([
    [
      "Stripe-2026-09-01-2026-09-30.csv",
      "Stripe",
      "stripe_balance_itemised_csv_v1",
      "2026-09-01",
      "2026-09-30",
    ],
    [
      "CommBank-2026-09-01-2026-09-30.csv",
      "CommBank",
      "commbank_transaction_history_csv_v1",
      "2026-09-01",
      "2026-09-30",
    ],
    [
      "sTrIpE-2024-02-29-2024-03-01.CSV",
      "Stripe",
      "stripe_balance_itemised_csv_v1",
      "2024-02-29",
      "2024-03-01",
    ],
    [
      "Combank-2026-09-01-2026-09-30.csv",
      "CommBank",
      "commbank_transaction_history_csv_v1",
      "2026-09-01",
      "2026-09-30",
    ],
    [
      "Stripe-2026-09-01-2026-09-01.csv",
      "Stripe",
      "stripe_balance_itemised_csv_v1",
      "2026-09-01",
      "2026-09-01",
    ],
  ])(
    "parses the supported CSV name %s",
    (filename, provider, profile, periodStart, periodEnd) => {
      expect(parseCsvFilename(filename)).toEqual({
        provider,
        profile,
        periodStart,
        periodEnd,
      });
    },
  );

  it.each([
    "Stripe-2025-02-29-2025-03-01.csv",
    "Stripe-2026-10-01-2026-09-30.csv",
    "OtherBank-2026-09-01-2026-09-30.csv",
    "Stripe-2026-09-01-2026-09-30-2026-09-30.csv",
    "Stripe-2026-09-01-2026-09-30.csv.backup",
    "prefix-Stripe-2026-09-01-2026-09-30.csv",
  ])("rejects unsupported CSV filename %s", (filename) => {
    expect(parseCsvFilename(filename)).toBeNull();
  });

  it("keeps legacy coverage ranges available through file suggestions", () => {
    expect(parseFileFilename("stripe_2026-01-01_to_2026-01-31.csv")).toEqual({
      supplier: null,
      documentDate: null,
      reference: null,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
  });

  it("fills only empty editable metadata fields", () => {
    expect(
      applyFileFilenameSuggestions(
        {
          supplier: "",
          documentDate: "2026-03-01",
          reference: "",
          periodStart: " ",
          periodEnd: "2026-02-28",
        },
        {
          supplier: "Acme",
          documentDate: "2026-02-28",
          reference: "INV-104",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
        },
      ),
    ).toEqual({
      values: {
        supplier: "Acme",
        documentDate: "2026-03-01",
        reference: "INV-104",
        periodStart: "2026-01-01",
        periodEnd: "2026-02-28",
      },
      filled: ["supplier", "reference", "periodStart"],
      conflicts: [],
    });
  });

  it("applies only the requested blank metadata field", () => {
    expect(
      applyFileFilenameSuggestions(
        {
          supplier: "Existing supplier",
          documentDate: "",
          reference: "",
          periodStart: "",
          periodEnd: "",
        },
        {
          supplier: "Suggested supplier",
          documentDate: "2026-02-28",
          reference: "INV-104",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
        },
        "supplier",
      ),
    ).toEqual({
      values: {
        supplier: "Existing supplier",
        documentDate: "",
        reference: "",
        periodStart: "",
        periodEnd: "",
      },
      filled: [],
      conflicts: [],
    });

    expect(
      applyFileFilenameSuggestions(
        {
          supplier: "",
          documentDate: "",
          reference: "",
          periodStart: "",
          periodEnd: "",
        },
        {
          supplier: "Suggested supplier",
          documentDate: "2026-02-28",
          reference: "INV-104",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
        },
        "supplier",
      ),
    ).toEqual({
      values: {
        supplier: "Suggested supplier",
        documentDate: "",
        reference: "",
        periodStart: "",
        periodEnd: "",
      },
      filled: ["supplier"],
      conflicts: [],
    });
  });

  it("preserves an entered coverage bound and skips an inverted suggestion", () => {
    expect(
      applyFileFilenameSuggestions(
        {
          supplier: "",
          documentDate: "",
          reference: "",
          periodStart: "2026-02-01",
          periodEnd: "",
        },
        {
          supplier: null,
          documentDate: null,
          reference: null,
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
        },
      ),
    ).toEqual({
      values: {
        supplier: "",
        documentDate: "",
        reference: "",
        periodStart: "2026-02-01",
        periodEnd: "",
      },
      filled: [],
      conflicts: ["periodEnd"],
    });
  });

  it("does not mistake a coverage range for invoice date and reference", () => {
    expect(parseFileFilename("Acme_2026-01-01_to_2026-01-31.pdf")).toEqual({
      supplier: null,
      documentDate: null,
      reference: null,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
  });
});
