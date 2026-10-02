import { describe, expect, it } from "vitest";

import type {
  FinancialYearCashLedger,
  FinancialYearCashLedgerRow,
} from "./reports";
import { buildOwnerFundingSummary } from "./owner-funding";

const ledgerRow = (
  overrides: Omit<Partial<FinancialYearCashLedgerRow>, "kind"> & {
    transactionId: string;
    kind: string;
  },
): FinancialYearCashLedgerRow => ({
  ownerId: "owner-a",
  updatedAt: "2026-07-01T00:00:00.000Z",
  reference: null,
  counterparty: null,
  description: null,
  category: null,
  sourceSystem: "manual",
  status: "recorded",
  cashDate: "2024-07-01T00:00:00.000Z",
  period: "FY2024-25",
  disposition: "out_of_period",
  reason: "outside_selected_financial_year",
  issues: [],
  incomeEffectAud: "0.0000",
  expenseEffectAud: "0.0000",
  cashEffectAud: "10.0000",
  ...overrides,
  kind: overrides.kind as FinancialYearCashLedgerRow["kind"],
});

const cashLedger = (
  rows: FinancialYearCashLedgerRow[],
): FinancialYearCashLedger => ({
  financialYearStartYear: 2025,
  financialYear: "FY2025-26",
  timezone: "Australia/Brisbane",
  rows,
  totals: {
    incomeEffectAud: "0.0000",
    expenseEffectAud: "0.0000",
    cashEffectAud: "0.0000",
    includedCount: 0,
  },
});

describe("buildOwnerFundingSummary", () => {
  it("sums exact cumulative funding through the timezone-aware financial-year end", () => {
    const summary = buildOwnerFundingSummary(
      cashLedger([
        ledgerRow({
          transactionId: "future-loan",
          kind: "owner_loan",
          cashDate: "2026-06-30T14:00:00.000Z",
          period: "FY2026-27",
          cashEffectAud: "1000.0000",
        }),
        ledgerRow({
          transactionId: "old-loan",
          kind: "owner_loan",
          cashDate: "2024-07-01T00:00:00.000Z",
          period: "FY2024-25",
          cashEffectAud: "1.1234",
        }),
        ledgerRow({
          transactionId: "year-end-loan",
          kind: "owner_loan",
          cashDate: "2026-06-30T13:59:59.000Z",
          period: "FY2025-26",
          cashEffectAud: "2.0001",
        }),
        ledgerRow({
          transactionId: "principal-repayment",
          kind: "owner_loan_repayment",
          cashDate: "2025-08-01T00:00:00.000Z",
          period: "FY2025-26",
          cashEffectAud: "-0.0001",
        }),
        ledgerRow({
          transactionId: "contribution",
          kind: "owner_contribution",
          cashDate: "2025-08-02T00:00:00.000Z",
          period: "FY2025-26",
          cashEffectAud: "4.3750",
        }),
        ledgerRow({
          transactionId: "draft-loan",
          kind: "owner_loan",
          status: "draft",
          cashEffectAud: "900.0000",
        }),
        ledgerRow({
          transactionId: "void-loan",
          kind: "owner_loan",
          status: "void",
          cashEffectAud: "800.0000",
        }),
      ]),
    );

    expect(summary).toMatchObject({
      financialYear: "FY2025-26",
      financialYearStartYear: 2025,
      timezone: "Australia/Brisbane",
      issues: [],
      owners: [
        {
          ownerId: "owner-a",
          loansAdvancedAud: "3.1235",
          principalRepaidAud: "0.0001",
          loanBalanceAud: "3.1234",
          otherContributionsAud: "4.3750",
          transactionIds: [
            "old-loan",
            "principal-repayment",
            "contribution",
            "year-end-loan",
          ],
        },
      ],
    });
    expect(summary.rows.map(({ transactionId }) => transactionId)).toEqual([
      "old-loan",
      "principal-repayment",
      "contribution",
      "year-end-loan",
    ]);
  });

  it("keeps missing and unsupported recorded facts visible without treating them as zero", () => {
    const summary = buildOwnerFundingSummary(
      cashLedger([
        ledgerRow({
          transactionId: "missing-amount",
          kind: "owner_loan",
          disposition: "action_required",
          reason: "missing_cash_facts",
          issues: ["missing_settlement_amount"],
          cashEffectAud: null,
        }),
        ledgerRow({
          transactionId: "missing-date",
          kind: "owner_loan_repayment",
          cashDate: null,
          period: null,
          disposition: "action_required",
          reason: "missing_cash_facts",
          issues: ["missing_settlement_date"],
          cashEffectAud: null,
        }),
        ledgerRow({
          transactionId: "unsupported-source",
          kind: "owner_contribution",
          sourceSystem: "stripe",
          issues: ["unsupported_cash_effect"],
          disposition: "action_required",
          reason: "missing_cash_facts",
          cashEffectAud: null,
        }),
        ledgerRow({
          transactionId: "bad-direction",
          kind: "owner_loan",
          cashEffectAud: "-5.0000",
        }),
        ledgerRow({
          transactionId: "ignored-draft",
          kind: "owner_loan",
          status: "draft",
          cashDate: null,
          period: null,
        }),
        ledgerRow({
          transactionId: "ignored-void",
          kind: "owner_loan",
          status: "void",
          cashDate: null,
          period: null,
        }),
      ]),
    );

    expect(summary.rows.map(({ transactionId }) => transactionId)).toEqual([
      "missing-date",
      "bad-direction",
      "missing-amount",
      "unsupported-source",
    ]);
    expect(summary.owners).toEqual([]);
    expect(summary.issues).toEqual(
      expect.arrayContaining([
        {
          transactionId: "missing-date",
          ownerId: "owner-a",
          reason: "missing_settlement_date",
        },
        {
          transactionId: "missing-amount",
          ownerId: "owner-a",
          reason: "missing_settlement_amount",
        },
        {
          transactionId: "unsupported-source",
          ownerId: "owner-a",
          reason: "unsupported_cash_effect",
        },
        {
          transactionId: "bad-direction",
          ownerId: "owner-a",
          reason: "unexpected_cash_direction",
        },
      ]),
    );
  });

  it("retains unassigned and zero-share owners and flags only a final negative loan balance", () => {
    const summary = buildOwnerFundingSummary(
      cashLedger([
        ledgerRow({
          transactionId: "repayment-later",
          kind: "owner_loan_repayment",
          cashDate: "2025-08-03T00:00:00.000Z",
          period: "FY2025-26",
          cashEffectAud: "-30.0000",
        }),
        ledgerRow({
          transactionId: "repayment-earlier",
          kind: "owner_loan_repayment",
          cashDate: "2025-08-02T00:00:00.000Z",
          period: "FY2025-26",
          cashEffectAud: "-30.0000",
        }),
        ledgerRow({
          transactionId: "loan-advance",
          kind: "owner_loan",
          cashDate: "2025-08-01T00:00:00.000Z",
          period: "FY2025-26",
          cashEffectAud: "50.0000",
        }),
        ledgerRow({
          transactionId: "unassigned-contribution",
          ownerId: null,
          kind: "owner_contribution",
          cashDate: "2025-08-04T00:00:00.000Z",
          period: "FY2025-26",
          cashEffectAud: "25.0000",
        }),
        ledgerRow({
          transactionId: "zero-share-repayment",
          ownerId: "owner-b",
          kind: "owner_loan_repayment",
          cashDate: "2025-07-31T00:00:00.000Z",
          period: "FY2025-26",
          cashEffectAud: "-5.0000",
        }),
        ledgerRow({
          transactionId: "zero-share-loan",
          ownerId: "owner-b",
          kind: "owner_loan",
          cashDate: "2025-08-05T00:00:00.000Z",
          period: "FY2025-26",
          cashEffectAud: "10.0000",
        }),
      ]),
    );

    expect(summary.owners).toEqual([
      {
        ownerId: null,
        loansAdvancedAud: "0.0000",
        principalRepaidAud: "0.0000",
        loanBalanceAud: "0.0000",
        otherContributionsAud: "25.0000",
        transactionIds: ["unassigned-contribution"],
      },
      {
        ownerId: "owner-a",
        loansAdvancedAud: "50.0000",
        principalRepaidAud: "60.0000",
        loanBalanceAud: "-10.0000",
        otherContributionsAud: "0.0000",
        transactionIds: [
          "loan-advance",
          "repayment-earlier",
          "repayment-later",
        ],
      },
      {
        ownerId: "owner-b",
        loansAdvancedAud: "10.0000",
        principalRepaidAud: "5.0000",
        loanBalanceAud: "5.0000",
        otherContributionsAud: "0.0000",
        transactionIds: ["zero-share-repayment", "zero-share-loan"],
      },
    ]);
    expect(summary.issues).toEqual([
      {
        transactionId: "repayment-later",
        ownerId: "owner-a",
        reason: "negative_loan_balance",
      },
      {
        transactionId: "unassigned-contribution",
        ownerId: null,
        reason: "unassigned_owner",
      },
    ]);
  });
});
