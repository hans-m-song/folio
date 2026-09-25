import { describe, expect, it } from "vitest";

import { applyPdfFilenameSuggestions, parsePdfFilename } from "./pdf-filename";

describe("PDF filename suggestions", () => {
  it("parses supplier, ISO invoice date, and a hyphenated reference", () => {
    expect(
      parsePdfFilename("Acme Building-Supplies-2026-02-28-INV-104.pdf"),
    ).toEqual({
      supplier: "Acme Building-Supplies",
      invoiceDate: "2026-02-28",
      reference: "INV-104",
    });
  });

  it("accepts repeated separator hyphens and paths", () => {
    expect(parsePdfFilename("/tmp/Acme--2024-02-29--invoice-1.PDF")).toEqual({
      supplier: "Acme",
      invoiceDate: "2024-02-29",
      reference: "invoice-1",
    });
  });

  it("rejects invalid dates and malformed or non-PDF filenames", () => {
    expect(parsePdfFilename("Acme-2025-02-29-INV-1.pdf")).toBeNull();
    expect(parsePdfFilename("Acme-2026-13-01-INV-1.pdf")).toBeNull();
    expect(parsePdfFilename("Acme-2026-01-01.pdf")).toBeNull();
    expect(parsePdfFilename("Acme-2026-01-01-INV-1.txt")).toBeNull();
  });

  it("fills only blank transaction fields", () => {
    const result = applyPdfFilenameSuggestions(
      { counterparty: "Existing supplier", invoiceDate: "", reference: "" },
      {
        supplier: "Acme",
        invoiceDate: "2026-01-01",
        reference: "INV-1",
      },
    );
    expect(result).toEqual({
      values: {
        counterparty: "Existing supplier",
        invoiceDate: "2026-01-01",
        reference: "INV-1",
      },
      filled: ["invoiceDate", "reference"],
    });
  });
});
