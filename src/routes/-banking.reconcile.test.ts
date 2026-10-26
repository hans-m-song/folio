import { describe, expect, it } from "vitest";
import { defaultParseSearch } from "@tanstack/react-router";

import {
  bankReconciliationDateDisplay,
  bankReconciliationDateIso,
  bankReconciliationTimestampDisplay,
  bankCandidateReview,
  bankMatchTransactionKinds,
  bankSourceReview,
  canAdvanceBankReconciliationPage,
  createBankTransactionPrefill,
  parseReconcileSearch,
} from "./banking.reconcile";

describe("bank reconciliation date display", () => {
  it("formats supported date-only values without changing their calendar date", () => {
    expect(bankReconciliationDateDisplay("2026-08-27")).toBe("27 Aug 2026");
    expect(bankReconciliationDateDisplay("27/08/2026")).toBe("27 Aug 2026");
    expect(bankReconciliationDateIso("27/08/2026")).toBe("2026-08-27");
  });

  it("preserves invalid or unrecognised date text", () => {
    expect(bankReconciliationDateDisplay("31/02/2026")).toBe("31/02/2026");
    expect(bankReconciliationDateDisplay("payment 27/08/2026")).toBe(
      "payment 27/08/2026",
    );
    expect(bankReconciliationDateIso("31/02/2026")).toBeNull();
  });

  it("formats review timestamps in Brisbane with an explicit AEST zone", () => {
    expect(
      bankReconciliationTimestampDisplay("2026-08-26T14:30:00.000Z"),
    ).toMatch(/27 Aug 2026.*00:30.*AEST/);
    expect(bankReconciliationTimestampDisplay("invalid timestamp")).toBe(
      "invalid timestamp",
    );
  });
});

describe("bank reconciliation URL state", () => {
  it("retains valid row, source, window, and bounded page state", () => {
    expect(
      parseReconcileSearch({
        bank: "11111111-1111-4111-8111-111111111111",
        artifact: "22222222-2222-4222-8222-222222222222",
        unresolved: "1",
        window: "31",
        page: "2",
      }),
    ).toEqual({
      bank: "11111111-1111-4111-8111-111111111111",
      artifact: "22222222-2222-4222-8222-222222222222",
      unresolved: true,
      window: "31",
      page: 2,
    });
  });

  it("drops malformed identifiers and uses the default date window", () => {
    expect(
      parseReconcileSearch({
        bank: "not-an-id",
        artifact: "also-not-an-id",
        unresolved: "not-true",
        window: "365",
        page: "999",
      }),
    ).toEqual({
      bank: undefined,
      artifact: undefined,
      unresolved: undefined,
      window: "31",
      page: 1,
    });
  });

  it("defaults an omitted date window to ±31 days and retains explicit ±14 days", () => {
    expect(parseReconcileSearch({}).window).toBe("31");
    expect(parseReconcileSearch({ window: "14" }).window).toBe("14");
  });

  it("accepts router-serialized unresolved toggle values", () => {
    expect(parseReconcileSearch({ unresolved: true }).unresolved).toBe(true);
    expect(parseReconcileSearch({ unresolved: "true" }).unresolved).toBe(true);
    expect(parseReconcileSearch({ unresolved: 1 }).unresolved).toBe(true);
    expect(
      parseReconcileSearch(defaultParseSearch("?unresolved=1")).unresolved,
    ).toBe(true);
    expect(
      parseReconcileSearch(defaultParseSearch("?unresolved=true")).unresolved,
    ).toBe(true);
  });

  it("uses the total count to detect whether another row page exists", () => {
    expect(canAdvanceBankReconciliationPage(1, 100)).toBe(false);
    expect(canAdvanceBankReconciliationPage(1, 101)).toBe(true);
    expect(canAdvanceBankReconciliationPage(2, 200)).toBe(false);
    expect(canAdvanceBankReconciliationPage(2, 201)).toBe(true);
    expect(canAdvanceBankReconciliationPage(101, 10_101)).toBe(false);
  });
});

describe("bank transaction creation choices", () => {
  it("offers only transaction kinds with the same cash-effect direction", () => {
    expect(bankMatchTransactionKinds("35.1200")).toEqual([
      "sale",
      "supplier_credit",
      "owner_contribution",
      "owner_loan",
    ]);
    expect(bankMatchTransactionKinds("-35.1200")).toEqual([
      "supplier_expense",
      "processing_fee",
      "sale_refund",
      "owner_loan_repayment",
    ]);
    expect(bankMatchTransactionKinds("0.0000")).toEqual([]);
  });
});

describe("bank transaction creation prefills", () => {
  const data = {
    actorId: "11111111-1111-4111-8111-111111111111",
    gstRegistered: true,
    detail: {
      bankTransaction: {
        id: "22222222-2222-4222-8222-222222222222",
        postedDate: "2026-09-24",
        amountAud: "-35.1200",
        description: "PAYMENT TO EXAMPLE",
        metadata: {
          postedDate: "24/09/2026",
          counterpartySuggestion: "Example Supplier",
          valueDate: "2026-09-25",
        },
      },
    },
  };

  it("prefills verified bank facts without guessing supplier or invoice details", () => {
    const prefill = createBankTransactionPrefill(data, "supplier_expense");

    expect(prefill).toMatchObject({
      ownerId: data.actorId,
      kind: "supplier_expense",
      description: "PAYMENT TO EXAMPLE",
      counterparty: null,
      occurredAt: null,
      settledAt: "2026-09-24T00:00:00.000Z",
      documentAmount: null,
      documentCurrency: null,
      documentTaxAmount: null,
      taxTreatment: "gst_included",
      settlementAmount: "35.1200",
      settlementCurrency: "AUD",
      invoiceDate: null,
      gstCreditStatus: "unknown",
      claimableGstAud: "0.0000",
    });
  });

  it("prefills positive AUD movement as safe owner funding", () => {
    const prefill = createBankTransactionPrefill(
      {
        ...data,
        detail: {
          bankTransaction: {
            ...data.detail.bankTransaction,
            amountAud: "35.1200",
          },
        },
      },
      "owner_contribution",
    );

    expect(prefill).toMatchObject({
      kind: "owner_contribution",
      description: "PAYMENT TO EXAMPLE",
      counterparty: null,
      occurredAt: null,
      settledAt: "2026-09-24T00:00:00.000Z",
      invoiceDate: null,
      documentAmount: "35.1200",
      documentCurrency: "AUD",
      documentTaxAmount: null,
      taxTreatment: "no_tax",
      settlementAmount: "35.1200",
      settlementCurrency: "AUD",
      gstCreditStatus: "not_claimable",
      claimableGstAud: "0.0000",
    });
  });

  it("prefills an outgoing movement as positive repayment principal without assuming its owner", () => {
    const prefill = createBankTransactionPrefill(data, "owner_loan_repayment");

    expect(prefill).toMatchObject({
      ownerId: null,
      kind: "owner_loan_repayment",
      documentAmount: "35.1200",
      documentCurrency: "AUD",
      documentTaxAmount: null,
      taxTreatment: "no_tax",
      settlementAmount: "35.1200",
      settlementCurrency: "AUD",
      gstCreditStatus: "not_claimable",
      claimableGstAud: "0.0000",
    });
  });

  it("does not turn an outgoing bank movement into owner funding", () => {
    const prefill = createBankTransactionPrefill(data, "owner_contribution");

    expect(prefill).toMatchObject({
      kind: "owner_contribution",
      documentAmount: null,
      documentCurrency: null,
      settlementAmount: "35.1200",
      settlementCurrency: "AUD",
    });
  });
});

describe("bank row source review", () => {
  it("ignores legacy counterparty suggestions and treats value date as payment timing", () => {
    expect(
      bankSourceReview(
        {
          postedDate: "2026-09-24",
          amountAud: "-35.1200",
          description: "PAYMENT TO EXAMPLE",
          metadata: {
            postedDate: "24/09/2026",
            amountAud: "-35.12",
            description: "PAYMENT TO EXAMPLE",
            sourceRow: 17,
            valueDate: "2026-09-25",
            counterpartySuggestion: "Example Supplier",
            foreignCurrency: "USD",
            foreignAmount: "22.50",
            cardSuffix: "1234",
            runningBalance: "900.00",
          },
        },
        { filename: "bank.csv", sourceRow: 17 },
      ),
    ).toEqual({
      postedDate: "24/09/2026",
      movementAud: "-35.12",
      description: "PAYMENT TO EXAMPLE",
      filename: "bank.csv",
      sourceRow: 17,
      hints: [
        { label: "Value date (payment timing hint)", value: "2026-09-25" },
        { label: "Parsed foreign-currency suggestion", value: "USD" },
        { label: "Parsed foreign-amount suggestion", value: "22.50" },
      ],
    });
  });
});

describe("bank match candidate review", () => {
  it("shows invoice amount and invoice/activity date against the bank value date", () => {
    expect(
      bankCandidateReview(
        {
          amountAud: "-35.1200",
          candidateDate: "2026-09-22",
          dateDistanceDays: 2,
          documentAmount: "35.1200",
          documentCurrency: "AUD",
          matchBasis: "invoice_aud",
          settledAt: null,
        },
        {
          postedDate: "2026-09-24",
          metadata: { valueDate: "2026-09-24" },
        },
      ),
    ).toMatchObject({
      isInvoiceMatch: true,
      isUnverifiedForeignHint: false,
      basisLabel: "Invoice total (AUD)",
      amountLabel: "AUD 35.1200",
      candidateDateSourceLabel: "Invoice/activity date",
      candidateDate: "2026-09-22",
      comparisonDateSource: "bank value date",
      dateDifferenceLabel: "2 days from bank value date",
    });
  });

  it("marks foreign invoice data as an unverified hint and falls back to bank posted date", () => {
    expect(
      bankCandidateReview(
        {
          amountAud: null,
          candidateDate: "2026-09-24",
          dateDistanceDays: 0,
          documentAmount: "37.08",
          documentCurrency: "USD",
          matchBasis: "invoice_foreign_hint",
          settledAt: null,
        },
        { postedDate: "2026-09-24", metadata: { valueDate: null } },
      ),
    ).toMatchObject({
      isInvoiceMatch: true,
      isUnverifiedForeignHint: true,
      basisLabel: "Unverified foreign invoice hint",
      amountLabel: "USD 37.08",
      candidateDateSourceLabel: "Invoice/activity date",
      comparisonDateSource: "bank posted date",
      dateDifferenceLabel: "same date as bank posted date",
    });
  });
});
