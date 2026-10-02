import { describe, expect, it } from "vitest";

import { parseSupplierInvoice } from "./invoice-parser";
import {
  normalizedInvoiceDocumentVersion,
  type NormalizedInvoiceDocumentV1,
  type NormalizedInvoicePageV1,
} from "./invoice-types";

const page = (
  pageNumber: number,
  lines: readonly (string | readonly string[])[],
): NormalizedInvoicePageV1 => ({
  pageNumber,
  width: 612,
  height: 792,
  items: lines.flatMap((line, lineIndex) => {
    const parts = typeof line === "string" ? [line] : line;
    return parts.map((text, partIndex) => ({
      text,
      x: partIndex * 70,
      y: 40 + lineIndex * 18,
      width: text.length * 6,
      height: 10,
    }));
  }),
});

const document = (
  ...pages: NormalizedInvoicePageV1[]
): NormalizedInvoiceDocumentV1 => ({
  schemaVersion: normalizedInvoiceDocumentVersion,
  pages,
});

describe("supplier invoice suggestions", () => {
  it("merges repeated Google Workspace totals across two pages with provenance", () => {
    const result = parseSupplierInvoice(
      document(
        page(1, [
          "Google Workspace",
          "Invoice",
          "Invoice number: GW-2026-08",
          "Invoice date: 2026-08-31",
          "Currency: AUD",
          "Subtotal A$90.00",
          "GST A$9.00",
          "Total A$99.00",
        ]),
        page(2, [
          "Invoice summary",
          "Subtotal A$90.00",
          "GST A$9.00",
          "Total A$99.00",
        ]),
      ),
    );

    expect(result.status).toBe("recognized");
    expect(result.parser).toEqual({ id: "google-workspace", version: 1 });
    expect(result.fields).toMatchObject({
      supplier: "Google Workspace",
      reference: "GW-2026-08",
      issueDate: "2026-08-31",
      currency: "AUD",
      invoiceTotal: { amount: "99.0000", currency: "AUD" },
      subtotal: { amount: "90.0000", currency: "AUD" },
      tax: { amount: "9.0000", currency: "AUD" },
    });
    expect(result.fields.invoiceTotal?.provenance).toEqual([
      { pageNumber: 1, label: "Total" },
      { pageNumber: 2, label: "Total" },
    ]);
    expect(result.provenance).toEqual({
      supplier: [{ pageNumber: 1, label: "Google Workspace" }],
      reference: [{ pageNumber: 1, label: "Invoice number" }],
      issueDate: [{ pageNumber: 1, label: "Invoice date" }],
      currency: [
        { pageNumber: 1, label: "AUD" },
        { pageNumber: 1, label: "A$" },
        { pageNumber: 2, label: "A$" },
      ],
    });
  });

  it("does not infer USD from an unqualified dollar sign", () => {
    const result = parseSupplierInvoice(
      document(
        page(1, [
          "Google Workspace Invoice",
          "Subtotal: $90.00",
          "GST: $10.00",
          "Total: $100.00",
        ]),
      ),
    );

    expect(result.status).toBe("needs_review");
    expect(result.fields.currency).toBeNull();
    expect(result.fields.invoiceTotal).toMatchObject({
      amount: "100.0000",
      currency: null,
    });
    expect(result.warnings).toContain("ambiguous_currency");
    expect(result.warnings).toContain("currency_unconfirmed");
  });

  it("does not join unrelated amount tokens when extraction whitespace is present", () => {
    const result = parseSupplierInvoice(
      document(
        page(1, [
          "Google Workspace Invoice",
          "Currency: AUD",
          "Subtotal A$10.00",
          "Total A$10 25",
        ]),
      ),
    );

    expect(result.status).toBe("needs_review");
    expect(result.fields.invoiceTotal).toBeNull();
    expect(result.warnings).toContain("unreadable_money_field");
  });

  it("recognizes Supabase facts across a page break and normalizes split paid decimals", () => {
    const result = parseSupplierInvoice(
      document(
        page(1, [
          "Supabase Invoice",
          "Invoice number: SB-ONE",
          "Invoice date: January 31, 2026",
          "Currency AUD",
          "Subscription fee A$10.25",
        ]),
        page(2, [["Amount paid:", "A$", "10.", "25"], "Subtotal A$10.25"]),
      ),
    );

    expect(result.status).toBe("needs_review");
    expect(result.parser.id).toBe("supabase");
    expect(result.fields).toMatchObject({
      supplier: "Supabase",
      reference: "SB-ONE",
      issueDate: "2026-01-31",
      amountPaid: { amount: "10.2500", currency: "AUD" },
      subtotal: { amount: "10.2500", currency: "AUD" },
      invoiceTotal: null,
    });
    expect(result.warnings).toContain("invoice_total_missing");
    expect(result.fields.amountPaid?.provenance).toEqual([
      { pageNumber: 2, label: "Amount paid" },
    ]);
  });

  it("keeps paid and due values separate from a missing Supabase invoice total", () => {
    const result = parseSupplierInvoice(
      document(
        page(1, ["Supabase Invoice", "Currency: AUD", "Subtotal A$100.00"]),
        page(2, ["Amount paid A$60.00"]),
        page(3, ["Amount due A$40.00"]),
      ),
    );

    expect(result.status).toBe("needs_review");
    expect(result.fields).toMatchObject({
      subtotal: { amount: "100.0000", currency: "AUD" },
      amountPaid: { amount: "60.0000", currency: "AUD" },
      amountDue: { amount: "40.0000", currency: "AUD" },
      invoiceTotal: null,
    });
    expect(result.warnings).toContain("invoice_total_missing");
  });

  it("keeps four-place unit prices out of totals and preserves usage credits", () => {
    const result = parseSupplierInvoice(
      document(
        page(1, [
          "Supabase Invoice",
          "Currency: AUD",
          "Subscription fee A$24.00",
        ]),
        page(2, ["Unit price A$0.0123", "Usage credit -A$0.2500"]),
        page(3, ["Subtotal A$23.75", "Amount paid A$23.75"]),
      ),
    );

    expect(result.fields.invoiceTotal).toBeNull();
    expect(result.fields.fees).toEqual([
      expect.objectContaining({ kind: "subscription", amount: "24.0000" }),
      expect.objectContaining({ kind: "credit", amount: "-0.2500" }),
    ]);
    expect(result.fields.fees.some((fee) => fee.amount === "0.0123")).toBe(
      false,
    );
  });

  it("reports a recognized Stripe invoice as duplicate-review evidence, not an expense amount", () => {
    const result = parseSupplierInvoice(
      document(
        page(1, [
          "Stripe Invoice",
          "Invoice number: ST-2026-01",
          "Invoice date: 2026-01-31",
          "Currency AUD",
          "Processing fees A$8.12",
          "Billing usage A$2.50",
          "Fees deducted A$3.00",
          "Subtotal A$10.62",
          "GST A$1.06",
          "Total A$11.68",
          "Amount paid A$11.68",
          "Amount due A$0.00",
        ]),
      ),
    );

    expect(result.status).toBe("recognized");
    expect(result.warnings).toContain("stripe_duplicate_risk");
    expect(result.fields.invoiceTotal).toMatchObject({
      amount: "11.6800",
      currency: "AUD",
    });
    expect(result.fields.amountDue).toMatchObject({
      amount: "0.0000",
      currency: "AUD",
    });
    expect(result.fields.fees).toEqual([
      expect.objectContaining({ kind: "processing", amount: "8.1200" }),
      expect.objectContaining({ kind: "billing_usage", amount: "2.5000" }),
      expect.objectContaining({ kind: "deducted", amount: "3.0000" }),
    ]);
  });

  it("retains zero due separately from non-zero Stripe fee facts", () => {
    const result = parseSupplierInvoice(
      document(
        page(1, [
          "Stripe Invoice",
          "Currency AUD",
          "Total processing fees A$5.00",
          "Subtotal A$0.00",
          "GST A$0.00",
          "Total A$0.00",
          "Amount due A$0.00",
        ]),
      ),
    );

    expect(result.fields.invoiceTotal?.amount).toBe("0.0000");
    expect(result.fields.amountDue?.amount).toBe("0.0000");
    expect(result.fields.fees[0]).toMatchObject({
      amount: "5.0000",
      kind: "processing",
    });
  });

  it("preserves a confirmed total for partial payments", () => {
    const result = parseSupplierInvoice(
      document(
        page(1, [
          "Google Workspace Invoice",
          "Currency: AUD",
          "Total A$100.00",
          "Amount paid A$60.00",
          "Amount due A$40.00",
        ]),
      ),
    );

    expect(result.status).toBe("recognized");
    expect(result.fields.invoiceTotal?.amount).toBe("100.0000");
    expect(result.fields.amountPaid?.amount).toBe("60.0000");
    expect(result.fields.amountDue?.amount).toBe("40.0000");
  });

  it("marks contradictory repeated totals for review instead of choosing one", () => {
    const result = parseSupplierInvoice(
      document(
        page(1, ["Google Workspace Invoice", "Currency AUD", "Total A$100.00"]),
        page(2, ["Invoice summary", "Total A$99.00"]),
      ),
    );

    expect(result.status).toBe("needs_review");
    expect(result.fields.invoiceTotal).toBeNull();
    expect(result.warnings).toContain("conflicting_total");
    expect(result.conflicts[0]).toMatchObject({
      field: "invoiceTotal",
      occurrences: [
        { amount: "100.0000", provenance: [{ pageNumber: 1, label: "Total" }] },
        { amount: "99.0000", provenance: [{ pageNumber: 2, label: "Total" }] },
      ],
    });
  });

  it("does not mistake payment, due, or service dates for the invoice issue date", () => {
    const result = parseSupplierInvoice(
      document(
        page(1, [
          "Google Workspace Invoice",
          "Service period 2026-01-01 to 2026-01-31",
          "Paid on 2026-02-04",
          "Due date 2026-02-15",
          "Invoice date: 2026-02-01",
          "Currency AUD",
          "Total A$12.00",
        ]),
      ),
    );

    expect(result.fields.issueDate).toBe("2026-02-01");
    expect(result.fields.amountDue).toBeNull();
  });

  it("requires review for broken totals and unknown credit-note layouts", () => {
    const brokenTotals = parseSupplierInvoice(
      document(
        page(1, [
          "Google Workspace Invoice",
          "Currency AUD",
          "Subtotal A$90.00",
          "GST A$10.00",
          "Total A$101.00",
        ]),
      ),
    );
    const unknownCreditNote = parseSupplierInvoice(
      document(
        page(1, [
          "Supabase Credit Note Invoice",
          "Currency AUD",
          "Total A$5.00",
        ]),
      ),
    );

    expect(brokenTotals.status).toBe("needs_review");
    expect(brokenTotals.warnings).toContain("totals_do_not_reconcile");
    expect(unknownCreditNote.status).toBe("needs_review");
    expect(unknownCreditNote.warnings).toContain("unknown_credit_note_layout");
  });

  it("rejects unknown suppliers and malformed normalized inputs", () => {
    const unknownSupplier = parseSupplierInvoice(
      document(page(1, ["Acme Invoice", "Total AUD 10.00"])),
    );
    const malformed = parseSupplierInvoice({
      schemaVersion: normalizedInvoiceDocumentVersion,
      pages: [
        {
          pageNumber: 1,
          width: 612,
          height: 792,
          items: [{ text: "Invoice" }],
        },
      ],
    });

    expect(unknownSupplier.status).toBe("unsupported");
    expect(unknownSupplier.warnings).toContain("unsupported_supplier");
    expect(malformed.status).toBe("unsupported");
    expect(malformed.warnings).toContain("malformed_input");
  });
});
