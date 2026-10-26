import { describe, expect, it } from "vitest";

import {
  assessBankMatchCandidate,
  bankReconciliationCommandSchema,
  parseBankForeignAmountHint,
} from "./bank-transactions";

const bank = {
  amountAud: "-35.0000",
  postedDate: "2026-09-23",
  metadata: {},
};

const invoice = {
  sourceSystem: "manual",
  status: "recorded",
  kind: "supplier_expense",
  settledAt: null,
  settlementCurrency: null,
  settlementAmount: null,
  documentCurrency: "AUD",
  documentAmount: "35.0000",
  invoiceDate: "2026-09-20",
  occurredAt: "2026-09-21T00:00:00.000Z",
};

describe("bank match candidate assessment", () => {
  it("preserves exact settled AUD matching and uses settlement date", () => {
    expect(
      assessBankMatchCandidate({
        bank,
        transaction: {
          ...invoice,
          settledAt: "2026-09-22T00:00:00.000Z",
          settlementCurrency: "AUD",
          settlementAmount: "35.0000",
        },
      }),
    ).toEqual({
      basis: "settlement_aud",
      candidateDate: "2026-09-22",
      amountAud: "-35.0000",
    });
  });

  it("uses the AUD document amount and invoice date for an unsettled manual invoice", () => {
    expect(assessBankMatchCandidate({ bank, transaction: invoice })).toEqual({
      basis: "invoice_aud",
      candidateDate: "2026-09-20",
      amountAud: "-35.0000",
    });
  });

  it("falls back to occurred date when invoice date is absent", () => {
    expect(
      assessBankMatchCandidate({
        bank,
        transaction: { ...invoice, invoiceDate: null },
      }),
    ).toMatchObject({ candidateDate: "2026-09-21" });
  });

  it("returns a foreign amount as an unverified hint without inventing AUD", () => {
    expect(
      assessBankMatchCandidate({
        bank: {
          ...bank,
          metadata: { foreignCurrency: "USD", foreignAmount: "22.50" },
        },
        transaction: {
          ...invoice,
          documentCurrency: "USD",
          documentAmount: "22.5000",
        },
      }),
    ).toEqual({
      basis: "invoice_foreign_hint",
      candidateDate: "2026-09-20",
      amountAud: null,
    });
  });

  it("requires exact foreign currency and amount while preserving both cash directions", () => {
    const foreignInvoice = {
      ...invoice,
      documentCurrency: "USD",
      documentAmount: "22.5000",
    };
    const foreignBank = {
      ...bank,
      metadata: { foreignCurrency: "USD", foreignAmount: "22.50" },
    };

    expect(
      assessBankMatchCandidate({
        bank: { ...foreignBank, amountAud: "35.0000" },
        transaction: { ...foreignInvoice, kind: "sale" },
      }),
    ).toEqual({
      basis: "invoice_foreign_hint",
      candidateDate: "2026-09-20",
      amountAud: null,
    });
    expect(
      assessBankMatchCandidate({
        bank: { ...foreignBank, amountAud: "35.0000" },
        transaction: foreignInvoice,
      }),
    ).toBeNull();
    expect(
      assessBankMatchCandidate({
        bank: {
          ...foreignBank,
          amountAud: "35.0000",
          metadata: { foreignCurrency: "EUR", foreignAmount: "22.50" },
        },
        transaction: { ...foreignInvoice, kind: "sale" },
      }),
    ).toBeNull();
    expect(
      assessBankMatchCandidate({
        bank: {
          ...foreignBank,
          metadata: { foreignCurrency: "USD", foreignAmount: "22.51" },
        },
        transaction: foreignInvoice,
      }),
    ).toBeNull();
  });

  it("rejects zero or negative invoice amounts and conflicting populated settlement facts", () => {
    expect(
      assessBankMatchCandidate({
        bank,
        transaction: { ...invoice, documentAmount: "0.0000" },
      }),
    ).toBeNull();
    expect(
      assessBankMatchCandidate({
        bank,
        transaction: { ...invoice, documentAmount: "-35.0000" },
      }),
    ).toBeNull();
    expect(
      assessBankMatchCandidate({
        bank,
        transaction: { ...invoice, settlementAmount: "34.0000" },
      }),
    ).toEqual({ reason: "settlement_conflict" });
    expect(
      assessBankMatchCandidate({
        bank,
        transaction: { ...invoice, settledAt: "2026-09-24T00:00:00.000Z" },
      }),
    ).toEqual({ reason: "settlement_conflict" });
  });

  it("only accepts positive, non-AUD parsed foreign metadata", () => {
    expect(
      parseBankForeignAmountHint({
        foreignCurrency: "USD",
        foreignAmount: "22.50",
      }),
    ).toEqual({ currency: "USD", amount: "22.5000" });
    for (const invalid of ["0", "-1", "not-an-amount"]) {
      expect(
        parseBankForeignAmountHint({
          foreignCurrency: "USD",
          foreignAmount: invalid,
        }),
      ).toBeNull();
    }
    expect(
      parseBankForeignAmountHint({
        foreignCurrency: "AUD",
        foreignAmount: "22.50",
      }),
    ).toBeNull();
  });

  it("accepts an omitted confirmation flag and parses an explicit confirmation", () => {
    const transactionId = "11111111-1111-4111-8111-111111111111";
    expect(
      bankReconciliationCommandSchema.parse({ type: "match", transactionId }),
    ).toEqual({ type: "match", transactionId });
    expect(
      bankReconciliationCommandSchema.parse({
        type: "match",
        transactionId,
        confirmSettlement: true,
      }),
    ).toEqual({ type: "match", transactionId, confirmSettlement: true });
  });
});
