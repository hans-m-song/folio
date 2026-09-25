import { describe, expect, it } from "vitest";

import { transactionInputSchema } from "./types";
import {
  applyInvoiceDateOccurrenceSuggestion,
  assertStatusTransition,
  assertTransactionRules,
  fileSelectionState,
  invoiceDateToOccurredAt,
} from "./workflow";

const input = transactionInputSchema.parse({
  kind: "supplier_expense",
  gstCreditStatus: "claimable",
  sourceArtifactId: "0f935296-35b3-43bd-bc3d-0caa0b0a2510",
});

describe("transaction rules", () => {
  it("requires configured GST registration and available PDF evidence", () => {
    expect(() => assertTransactionRules(input, false, null)).toThrow(
      "disabled",
    );
    expect(() =>
      assertTransactionRules(input, true, { kind: "pdf", state: "pending" }),
    ).toThrow("available PDF");
    expect(() =>
      assertTransactionRules(input, true, { kind: "pdf", state: "available" }),
    ).not.toThrow();
  });

  it("does not revive void records", () => {
    expect(() => assertStatusTransition("void", "draft")).toThrow("Invalid");
    expect(() => assertStatusTransition("recorded", "void")).not.toThrow();
  });

  it("restores void records only through a matching explicit action", () => {
    expect(() =>
      assertStatusTransition("void", "draft", "restore_draft"),
    ).not.toThrow();
    expect(() =>
      assertStatusTransition("void", "recorded", "restore_recorded"),
    ).not.toThrow();
    expect(() => assertStatusTransition("void", "draft", "save_draft")).toThrow(
      "Invalid",
    );
    expect(() =>
      assertStatusTransition("void", "recorded", "restore_draft"),
    ).toThrow("Invalid");
  });

  it("rejects Stripe CSV artifacts on manual transactions", () => {
    expect(() =>
      assertTransactionRules(
        { ...input, gstCreditStatus: "not_claimable" },
        false,
        { kind: "stripe_csv", state: "available" },
      ),
    ).toThrow("available PDF invoice artifact");
  });

  it("requires positive document amounts for owner funding", () => {
    expect(
      transactionInputSchema.safeParse({
        kind: "owner_contribution",
        documentCurrency: "AUD",
        documentAmount: "0.0000",
      }).success,
    ).toBe(false);
    expect(
      transactionInputSchema.safeParse({
        kind: "owner_loan",
        documentCurrency: "AUD",
        documentAmount: "250.0000",
        taxTreatment: "no_tax",
      }).success,
    ).toBe(true);
  });

  it("does not permit owner funding to claim GST", () => {
    const owner = transactionInputSchema.parse({
      kind: "owner_loan",
      documentCurrency: "AUD",
      documentAmount: "250.0000",
      taxTreatment: "no_tax",
      gstCreditStatus: "not_claimable",
      claimableGstAud: "0.0000",
    });
    expect(() =>
      assertTransactionRules(
        {
          ...owner,
          gstCreditStatus: "claimable",
        },
        true,
        { kind: "pdf", state: "available" },
      ),
    ).toThrow("not claimable or not registered");
  });

  it("rejects stale tax fields on owner funding", () => {
    const owner = transactionInputSchema.parse({
      kind: "owner_contribution",
      documentCurrency: "AUD",
      documentAmount: "250.0000",
      taxTreatment: "no_tax",
      gstCreditStatus: "not_registered",
      claimableGstAud: "0.0000",
    });
    expect(
      transactionInputSchema.safeParse({
        ...owner,
        taxTreatment: "gst_included",
      }).success,
    ).toBe(false);
    expect(
      transactionInputSchema.safeParse({
        ...owner,
        documentTaxAmount: "1.0000",
      }).success,
    ).toBe(false);
    expect(
      transactionInputSchema.safeParse({
        ...owner,
        claimableGstAud: "1.0000",
      }).success,
    ).toBe(false);
    expect(() =>
      assertTransactionRules(
        { ...owner, taxTreatment: "gst_included" },
        true,
        null,
      ),
    ).toThrow("no tax treatment");
  });

  it("anchors invoice-date suggestions at deterministic UTC midnight", () => {
    expect(invoiceDateToOccurredAt("2026-01-01")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(invoiceDateToOccurredAt(null)).toBeNull();
  });

  it("updates and clears auto-managed occurrence suggestions", () => {
    const suggested = applyInvoiceDateOccurrenceSuggestion(
      {
        occurredAtInput: "",
        suggestedInvoiceDate: null,
        operatorEdited: false,
      },
      "2026-01-01",
    );
    expect(suggested).toEqual({
      occurredAtInput: "2026-01-01",
      suggestedInvoiceDate: "2026-01-01",
      operatorEdited: false,
    });
    expect(
      applyInvoiceDateOccurrenceSuggestion(suggested, "2026-01-02"),
    ).toEqual({
      occurredAtInput: "2026-01-02",
      suggestedInvoiceDate: "2026-01-02",
      operatorEdited: false,
    });
    expect(
      applyInvoiceDateOccurrenceSuggestion(
        {
          ...suggested,
          occurredAtInput: "2026-01-01",
        },
        null,
      ),
    ).toEqual({
      occurredAtInput: "",
      suggestedInvoiceDate: null,
      operatorEdited: false,
    });
  });

  it("does not overwrite an occurrence after operator editing", () => {
    const edited = {
      occurredAtInput: "",
      suggestedInvoiceDate: null,
      operatorEdited: true,
    };
    expect(applyInvoiceDateOccurrenceSuggestion(edited, "2026-01-02")).toEqual(
      edited,
    );
  });

  it("normalizes manual date inputs to UTC midnight", () => {
    expect(invoiceDateToOccurredAt("2026-09-15")).toBe(
      "2026-09-15T00:00:00.000Z",
    );
    expect(invoiceDateToOccurredAt(null)).toBeNull();
  });

  it("distinguishes no file, named empty files, and ready files", () => {
    expect(fileSelectionState(null)).toBe("none");
    expect(fileSelectionState({ name: "", size: 0 })).toBe("none");
    expect(fileSelectionState({ name: "invoice.pdf", size: 0 })).toBe("empty");
    expect(fileSelectionState({ name: "invoice.pdf", size: 12 })).toBe("ready");
  });
});
