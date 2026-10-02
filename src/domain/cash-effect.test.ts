import { describe, expect, it } from "vitest";

import { manualCashEffectAud, manualCashEffectAudMinor } from "./cash-effect";
import type { TransactionRecord } from "./types";
import { rankBankMatchCandidate } from "./bank-transactions";

const transaction = (
  overrides: Partial<TransactionRecord> = {},
): TransactionRecord =>
  ({
    sourceSystem: "manual",
    status: "recorded",
    kind: "sale",
    settledAt: "2026-09-23T00:00:00.000Z",
    settlementCurrency: "AUD",
    settlementAmount: "10.2500",
    ...overrides,
  }) as TransactionRecord;

describe("manual signed-AUD cash effect", () => {
  it.each([
    ["sale", "10.2500"],
    ["supplier_credit", "10.2500"],
    ["owner_contribution", "10.2500"],
    ["owner_loan", "10.2500"],
    ["owner_loan_repayment", "-10.2500"],
    ["supplier_expense", "-10.2500"],
    ["processing_fee", "-10.2500"],
    ["sale_refund", "-10.2500"],
  ] as const)("projects %s with its approved sign", (kind, expected) => {
    expect(manualCashEffectAud(transaction({ kind }))).toBe(expected);
  });

  it.each([
    { sourceSystem: "stripe" as const },
    { status: "draft" as const },
    { status: "void" as const },
    { kind: "transfer" as const },
    { kind: "adjustment" as const },
    { kind: "dispute" as const },
    { settledAt: null },
    { settlementCurrency: "USD" },
    { settlementAmount: null },
  ])("excludes an ineligible projection %#", (overrides) => {
    expect(manualCashEffectAud(transaction(overrides))).toBeNull();
  });

  it("rejects non-positive repayment magnitudes without changing legacy zero projections", () => {
    expect(
      manualCashEffectAudMinor(
        transaction({ kind: "owner_loan_repayment", settlementAmount: "0" }),
      ),
    ).toBeNull();
    expect(
      manualCashEffectAudMinor(
        transaction({
          kind: "owner_loan_repayment",
          settlementAmount: "-1.0000",
        }),
      ),
    ).toBeNull();
    expect(
      manualCashEffectAudMinor(
        transaction({ kind: "owner_loan", settlementAmount: "0" }),
      ),
    ).toBe(0n);
    expect(
      manualCashEffectAudMinor(
        transaction({ kind: "supplier_expense", settlementAmount: "0" }),
      ),
    ).toBe(0n);
  });
});

describe("bank candidate evidence", () => {
  it("ranks calendar distance and normalised text without changing eligibility", () => {
    expect(
      rankBankMatchCandidate({
        bankPostedDate: "2026-09-23",
        bankDescription: "CARD PAYMENT ACME SOFTWARE",
        bankCounterparty: "Acme",
        settledAt: "2026-09-25T00:00:00.000Z",
        counterparty: "ACME Pty Ltd",
        reference: "software",
        description: null,
      }),
    ).toEqual({ dateDistanceDays: 2, textScore: 7 });
  });
});
