import { describe, expect, it } from "vitest";

import {
  bankMatchTransactionKinds,
  bankSourceReview,
  canAdvanceBankReconciliationPage,
  createBankTransactionPrefill,
  parseReconcileSearch,
} from "./banking.reconcile";

describe("bank reconciliation URL state", () => {
  it("retains valid row, source, window, and bounded page state", () => {
    expect(
      parseReconcileSearch({
        bank: "11111111-1111-4111-8111-111111111111",
        artifact: "22222222-2222-4222-8222-222222222222",
        window: "31",
        page: "2",
      }),
    ).toEqual({
      bank: "11111111-1111-4111-8111-111111111111",
      artifact: "22222222-2222-4222-8222-222222222222",
      window: "31",
      page: 2,
    });
  });

  it("drops malformed identifiers and restores conservative defaults", () => {
    expect(
      parseReconcileSearch({
        bank: "not-an-id",
        artifact: "also-not-an-id",
        window: "365",
        page: "999",
      }),
    ).toEqual({
      bank: undefined,
      artifact: undefined,
      window: "14",
      page: 1,
    });
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
