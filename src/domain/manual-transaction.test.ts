import { describe, expect, it } from "vitest";

import {
  buildManualTransaction,
  manualTransactionEditingFieldError,
  manualTransactionFieldErrors,
  manualTransactionValues,
  statusForManualAction,
} from "./manual-transaction";
import { transactionInputSchema } from "./types";

const base = transactionInputSchema.parse({
  ownerId: "00000000-0000-4000-8000-000000000001",
  kind: "supplier_expense",
  documentCurrency: "AUD",
  gstCreditStatus: "not_registered",
});

describe("managed manual transaction values", () => {
  it("preserves raw editing text and trims harmless whitespace on submit", () => {
    const values = {
      ...manualTransactionValues(base),
      documentAmount: " 35.1 ",
      counterparty: " Supplier ",
    };

    expect(
      buildManualTransaction(values, {
        action: "save_draft",
        sourceArtifactId: null,
        gstRegistered: false,
      }),
    ).toMatchObject({
      documentAmount: "35.1",
      counterparty: "Supplier",
      status: "draft",
    });
  });

  it("builds repayments from positive principal without tax or GST", () => {
    const values = {
      ...manualTransactionValues(base),
      kind: "owner_loan_repayment" as const,
      documentAmount: "125.0000",
      documentCurrency: "AUD",
      taxTreatment: "gst_included" as const,
      documentTaxAmount: "11.3636",
      gstCreditStatus: "claimable" as const,
      claimableGstAud: "11.3636",
    };

    expect(
      buildManualTransaction(values, {
        action: "save_recorded",
        sourceArtifactId: null,
        gstRegistered: true,
      }),
    ).toMatchObject({
      ownerId: base.ownerId,
      kind: "owner_loan_repayment",
      documentAmount: "125.0000",
      documentCurrency: "AUD",
      documentTaxAmount: null,
      taxTreatment: "no_tax",
      gstCreditStatus: "not_claimable",
      claimableGstAud: "0.0000",
    });
  });

  it("maps exact-decimal failures to their managed fields", () => {
    const errors = manualTransactionFieldErrors(
      {
        ...manualTransactionValues(base),
        documentAmount: "35.12345",
      },
      {
        action: "save_draft",
        sourceArtifactId: null,
        gstRegistered: false,
      },
    );

    expect(errors.documentAmount).toMatch(/at most four places/);
  });

  it("requires an attributed owner for manual values", () => {
    const errors = manualTransactionFieldErrors(
      {
        ...manualTransactionValues(base),
        ownerId: "",
      },
      {
        action: "save_draft",
        sourceArtifactId: null,
        gstRegistered: false,
      },
    );

    expect(errors.ownerId).toBe("Choose an owner");
  });

  it("keeps amount and currency relationships in form-level validation", () => {
    const errors = manualTransactionFieldErrors(
      {
        ...manualTransactionValues(base),
        documentAmount: "25.0000",
        documentCurrency: "",
        settlementAmount: "24.0000",
        settlementCurrency: "",
      },
      {
        action: "save_draft",
        sourceArtifactId: null,
        gstRegistered: false,
      },
    );

    expect(errors).toMatchObject({
      documentCurrency: "Choose a document currency",
      settlementCurrency: "Choose a settlement currency",
    });
  });

  it("maps every explicit action to one persisted status", () => {
    expect(statusForManualAction("save_void")).toBe("void");
    expect(statusForManualAction("restore_draft")).toBe("draft");
    expect(statusForManualAction("restore_recorded")).toBe("recorded");
  });

  it("validates optional exact amounts directly", () => {
    expect(manualTransactionEditingFieldError("documentAmount", "")).toBe(
      undefined,
    );
    expect(
      manualTransactionEditingFieldError("documentAmount", "asda"),
    ).toMatch(/at most four places/);
    expect(manualTransactionEditingFieldError("settlementAmount", "-1")).toBe(
      "Expected a non-negative decimal",
    );
  });

  it("validates currency and date editing syntax while allowing empty optional values", () => {
    expect(manualTransactionEditingFieldError("documentCurrency", "aud")).toBe(
      undefined,
    );
    expect(manualTransactionEditingFieldError("settlementCurrency", "US")).toBe(
      "Expected a three-letter currency code",
    );
    expect(manualTransactionEditingFieldError("invoiceDate", "")).toBe(
      undefined,
    );
    expect(manualTransactionEditingFieldError("occurredAt", "2026-02-30")).toBe(
      "Invalid date",
    );
  });

  it("validates owner, enum, and text fields directly", () => {
    expect(manualTransactionEditingFieldError("ownerId", "   ")).toBe(
      "Choose an owner",
    );
    expect(
      manualTransactionEditingFieldError("kind", "invalid" as never),
    ).toMatch(/Invalid enum value/);
    expect(
      manualTransactionEditingFieldError("taxTreatment", "invalid" as never),
    ).toMatch(/Invalid enum value/);
    expect(
      manualTransactionEditingFieldError("gstCreditStatus", "invalid" as never),
    ).toMatch(/Invalid enum value/);
    expect(
      manualTransactionEditingFieldError("category", "x".repeat(201)),
    ).toBe("String must contain at most 200 character(s)");
    expect(manualTransactionEditingFieldError("notes", "")).toBe(undefined);
  });

  it("does not treat unexpected form-validation exceptions as valid", () => {
    expect(() =>
      manualTransactionFieldErrors(null as never, {
        action: "save_draft",
        sourceArtifactId: null,
        gstRegistered: false,
      }),
    ).toThrow();
  });
});
