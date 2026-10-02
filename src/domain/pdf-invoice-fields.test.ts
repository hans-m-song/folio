import { describe, expect, it } from "vitest";

import { parseSupplierInvoice } from "./invoice-parser";
import { normalizedInvoiceDocumentVersion } from "./invoice-types";
import {
  applyInvoiceBlankFields,
  invoiceSuggestionConflicts,
  reviewedInvoiceMoney,
} from "./pdf-invoice-fields";

const parse = (lines: string[]) =>
  parseSupplierInvoice({
    schemaVersion: normalizedInvoiceDocumentVersion,
    pages: [
      {
        pageNumber: 1,
        width: 612,
        height: 792,
        items: lines.map((text, index) => ({
          text,
          x: 40,
          y: 40 + index * 20,
          width: 250,
          height: 12,
        })),
      },
    ],
  });
const blank = {
  counterparty: "",
  invoiceDate: "",
  reference: "",
  documentAmount: "",
  documentCurrency: "AUD",
};

describe("reviewed invoice field application", () => {
  it("flags filename and entered-value conflicts without treating equivalent decimals as different", () => {
    const result = parse([
      "Google Workspace Invoice",
      "Invoice date: 2026-06-30",
      "Invoice number: SYN-1",
      "Total USD 100.00",
    ]);
    const conflicts = invoiceSuggestionConflicts(
      { ...blank, documentAmount: "100.00", reference: "Entered" },
      result,
      "Google Workspace - 2026-06-01 - SYN-2.pdf",
    );
    expect(conflicts).toEqual([
      {
        field: "invoiceDate",
        source: "filename",
        existing: "2026-06-01",
        observed: "2026-06-30",
      },
      {
        field: "reference",
        source: "filename",
        existing: "SYN-2",
        observed: "SYN-1",
      },
      {
        field: "reference",
        source: "transaction",
        existing: "Entered",
        observed: "SYN-1",
      },
      {
        field: "documentCurrency",
        source: "transaction",
        existing: "AUD",
        observed: "USD",
      },
    ]);
  });

  it("uses the explicit invoice total, not partial payment or amount due", () => {
    const result = parse([
      "Google Workspace Invoice",
      "Invoice date: 2026-06-30",
      "Invoice number: SYN-1",
      "Total AUD 100.00",
      "Amount paid AUD 60.00",
      "Amount due AUD 40.00",
    ]);
    expect(
      applyInvoiceBlankFields(blank, result, {
        amount: result.fields.invoiceTotal!.amount,
        currency: "AUD",
        confirmed: false,
      }),
    ).toEqual({
      counterparty: "Google Workspace",
      invoiceDate: "2026-06-30",
      reference: "SYN-1",
      documentAmount: "100.0000",
    });
  });

  it("never substitutes paid amount or subtotal for a missing total", () => {
    const result = parse([
      "Supabase Invoice",
      "Subtotal $10.25",
      "Amount paid $10.25",
    ]);
    expect(result.fields.invoiceTotal).toBeNull();
    expect(
      applyInvoiceBlankFields(blank, result, {
        amount: "",
        currency: "",
        confirmed: false,
      }),
    ).toEqual({ counterparty: "Supabase" });
    expect(
      reviewedInvoiceMoney(result, {
        amount: "10.25",
        currency: "USD",
        confirmed: false,
      }),
    ).toBeNull();
    expect(
      reviewedInvoiceMoney(result, {
        amount: "10.25",
        currency: "USD",
        confirmed: true,
      }),
    ).toEqual({ documentAmount: "10.25", documentCurrency: "USD" });
  });

  it("does not apply an ambiguous amount against a default currency", () => {
    const result = parse(["Google Workspace Invoice", "Total $100.00"]);
    const changes = applyInvoiceBlankFields(blank, result, {
      amount: "100.0000",
      currency: "AUD",
      confirmed: false,
    });
    expect(changes).not.toHaveProperty("documentAmount");
    expect(changes).not.toHaveProperty("documentCurrency");
  });

  it("preserves nonblank fields and a conflicting amount/currency pair", () => {
    const result = parse([
      "Google Workspace Invoice",
      "Invoice date: 2026-06-30",
      "Total USD100.00",
    ]);
    expect(
      applyInvoiceBlankFields(
        { ...blank, counterparty: "Existing", invoiceDate: "2026-06-01" },
        result,
        { amount: "100.0000", currency: "USD", confirmed: true },
      ),
    ).toEqual({});
    expect(
      applyInvoiceBlankFields(
        { ...blank, documentAmount: "20", documentCurrency: "" },
        result,
        { amount: "100.0000", currency: "USD", confirmed: true },
      ),
    ).not.toHaveProperty("documentCurrency");
  });

  it("fills a blank amount and currency together after explicit review", () => {
    const result = parse(["Supabase Invoice", "Amount paid $10.25"]);
    expect(
      applyInvoiceBlankFields({ ...blank, documentCurrency: "" }, result, {
        amount: "10.25",
        currency: "USD",
        confirmed: true,
      }),
    ).toEqual({
      counterparty: "Supabase",
      documentAmount: "10.25",
      documentCurrency: "USD",
    });
  });

  it("keeps Stripe review-only even after amount confirmation", () => {
    const result = parse([
      "Stripe Invoice",
      "Invoice date: 2026-06-30",
      "Processing fees AUD10.00",
      "Total AUD10.00",
      "Amount due AUD0.00",
    ]);
    expect(
      applyInvoiceBlankFields(blank, result, {
        amount: "10",
        currency: "AUD",
        confirmed: true,
      }),
    ).toEqual({});
    expect(
      reviewedInvoiceMoney(result, {
        amount: "10",
        currency: "AUD",
        confirmed: true,
      }),
    ).toBeNull();
  });
});
