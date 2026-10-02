import { describe, expect, it } from "vitest";

import type { FinancialYearCashLedger } from "./reports";
import { buildTaxSourceReview } from "./tax-source-review";
import {
  buildReviewedTaxSnapshot,
  reviewedTaxSnapshotCsv,
  taxSourceReviewCsv,
  taxSnapshotModelVersion,
} from "./tax-workbook";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const partnerOptions = [
  { id: userA, label: "Synthetic user A" },
  { id: userB, label: "Synthetic user B" },
];

const ledger: FinancialYearCashLedger = {
  financialYearStartYear: 2025,
  financialYear: "FY2025-26",
  timezone: "Australia/Brisbane",
  totals: {
    incomeEffectAud: "200.0000",
    expenseEffectAud: "30.0000",
    cashEffectAud: "170.0000",
    includedCount: 2,
  },
  rows: [
    {
      transactionId: "11111111-1111-4111-8111-111111111111",
      updatedAt: "2026-06-30T00:00:00.000Z",
      reference: "SYN-1",
      counterparty: null,
      description: "=synthetic spreadsheet expression",
      category: null,
      sourceSystem: "manual",
      kind: "sale",
      status: "recorded",
      cashDate: "2026-06-30T00:00:00.000Z",
      period: "FY2025-26",
      disposition: "included",
      reason: "included",
      issues: [],
      incomeEffectAud: "200.0000",
      expenseEffectAud: "30.0000",
      cashEffectAud: "170.0000",
    },
  ],
};

describe("reviewed partnership tax worksheet", () => {
  it("exports the row-level source ledger as clearly unreviewed preparation", () => {
    const csv = taxSourceReviewCsv(buildTaxSourceReview(ledger, []));
    expect(csv).toContain(
      "Unreviewed source ledger; not partnership taxable income",
    );
    expect(csv).toContain("11111111-1111-4111-8111-111111111111");
    expect(csv).toContain("'=synthetic spreadsheet expression");
  });

  it("preserves source, explicit adjustment, and exact partner shares", () => {
    const snapshot = buildReviewedTaxSnapshot(
      buildTaxSourceReview(ledger, []),
      {
        adjustments: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            direction: "decrease_deductible_expense",
            amountAud: "10.0000",
            reason: "Synthetic non-deductible component",
          },
        ],
        partners: [
          { userId: userA, percentage: "60" },
          { userId: userB, percentage: "40" },
        ],
        reviewerAttestation:
          "I reviewed the source rows, deductions, timing, and partner agreement.",
      },
      partnerOptions,
    );
    expect(snapshot.totals).toMatchObject({
      sourceIncomeAud: "200.0000",
      sourceExpenseAud: "30.0000",
      reviewedDeductibleExpenseAud: "20.0000",
      reviewedNetResultAud: "180.0000",
    });
    expect(snapshot.partnerShares).toEqual([
      {
        userId: userA,
        label: "Synthetic user A",
        percentage: "60.0000",
        directIncomeAud: "0.0000",
        directExpenseAud: "0.0000",
        businessIncomeAud: "120.0000",
        businessExpenseAud: "12.0000",
        finalIncomeAud: "120.0000",
        finalExpenseAud: "12.0000",
        netAud: "108.0000",
      },
      {
        userId: userB,
        label: "Synthetic user B",
        percentage: "40.0000",
        directIncomeAud: "0.0000",
        directExpenseAud: "0.0000",
        businessIncomeAud: "80.0000",
        businessExpenseAud: "8.0000",
        finalIncomeAud: "80.0000",
        finalExpenseAud: "8.0000",
        netAud: "72.0000",
      },
    ]);
    const csv = reviewedTaxSnapshotCsv(snapshot);
    expect(snapshot.modelVersion).toBe(2);
    expect(snapshot.sourceFingerprintVersion).toBe(2);
    expect(csv).toContain("direct_income_aud");
    expect(csv).toContain("Business shared");
    expect(csv).toContain("'=synthetic spreadsheet expression");

    const legacyCsv = reviewedTaxSnapshotCsv({
      financialYearStartYear: snapshot.financialYearStartYear,
      financialYear: snapshot.financialYear,
      timezone: snapshot.timezone,
      gstRegistered: false,
      cashLedger: snapshot.cashLedger,
      bankRows: snapshot.bankRows,
      humanAdjustments: snapshot.humanAdjustments,
      partnerShares: [
        { label: "Partner 1", percentage: "100.0000", amountAud: "180.0000" },
      ],
      totals: snapshot.totals,
      reviewerAttestation: snapshot.reviewerAttestation,
    });
    expect(legacyCsv.split("\r\n", 1)[0]).toBe(
      '"row_type","id","date","reference_or_label","description_or_reason","status_or_direction","income_aud","expense_aud","cash_aud","amount_aud","percentage"',
    );
    expect(legacyCsv).not.toContain("direct_income_aud");
  });

  it("refuses a reviewed snapshot while a bank row is unresolved", () => {
    const source = buildTaxSourceReview(ledger, [
      {
        id: "33333333-3333-4333-8333-333333333333",
        postedDate: "2026-06-30",
        revision: "1",
        updatedAt: "2026-06-30T00:00:00.000Z",
        reviewState: "unresolved",
      },
    ]);
    expect(() =>
      buildReviewedTaxSnapshot(
        source,
        {
          adjustments: [],
          partners: [{ userId: userA, percentage: "100" }],
          reviewerAttestation:
            "I reviewed the source rows, deductions, timing, and partner agreement.",
        },
        partnerOptions,
      ),
    ).toThrow(/Resolve source exceptions/);
  });

  it("rejects a linked adjustment outside the selected source ledger", () => {
    expect(() =>
      buildReviewedTaxSnapshot(
        buildTaxSourceReview(ledger, []),
        {
          adjustments: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              transactionId: "66666666-6666-4666-8666-666666666666",
              direction: "increase_income",
              amountAud: "1.0000",
              reason: "Synthetic correction",
            },
          ],
          partners: [{ userId: userA, percentage: "100" }],
          reviewerAttestation:
            "I reviewed the source rows, deductions, timing, and partner agreement.",
        },
        partnerOptions,
      ),
    ).toThrow(/selected financial year source ledger/);
  });

  it("rejects unknown snapshot model and fingerprint versions", () => {
    expect(taxSnapshotModelVersion({})).toBe(1);
    expect(
      taxSnapshotModelVersion({ modelVersion: 2, sourceFingerprintVersion: 2 }),
    ).toBe(2);
    for (const snapshot of [
      { modelVersion: 3, sourceFingerprintVersion: 3 },
      { modelVersion: 2, sourceFingerprintVersion: 1 },
      { sourceFingerprintVersion: 2 },
    ]) {
      expect(() => taxSnapshotModelVersion(snapshot)).toThrow(
        /Unsupported reviewed tax snapshot version/,
      );
    }
  });

  it("keeps the byte-level legacy CSV contract for an absent model version", () => {
    const legacySnapshot = {
      financialYearStartYear: 2025,
      financialYear: "FY2025-26",
      timezone: "Australia/Brisbane",
      gstRegistered: false as const,
      cashLedger: {
        ...ledger,
        totals: {
          incomeEffectAud: "200.0000",
          expenseEffectAud: "30.0000",
          cashEffectAud: "170.0000",
          includedCount: 0,
        },
        rows: [],
      },
      bankRows: [],
      humanAdjustments: [],
      partnerShares: [
        { label: "Partner 1", percentage: "100.0000", amountAud: "170.0000" },
      ],
      totals: {
        sourceIncomeAud: "200.0000",
        sourceExpenseAud: "30.0000",
        reviewedIncomeAud: "200.0000",
        reviewedDeductibleExpenseAud: "30.0000",
        reviewedNetResultAud: "170.0000",
      },
      reviewerAttestation: "Reviewed synthetic rows.",
    };
    const csv = reviewedTaxSnapshotCsv(legacySnapshot, {
      id: "33333333-3333-4333-8333-333333333333",
      reviewedAt: "2026-09-29T00:00:00.000Z",
    });

    expect(csv).toBe(
      [
        '"row_type","id","date","reference_or_label","description_or_reason","status_or_direction","income_aud","expense_aud","cash_aud","amount_aud","percentage"',
        '"review_metadata","33333333-3333-4333-8333-333333333333","2026-09-29T00:00:00.000Z","FY2025-26","Saved review version; reporting timezone Australia/Brisbane","reviewed","","","","",""',
        '"review_attestation","","","","Reviewed synthetic rows.","","","","","",""',
        '"reviewed_total","","","FY2025-26","Reviewed partnership net result; not tax payable","reviewed","200.0000","30.0000","","170.0000",""',
        '"partner_share","","","Partner 1","","","","","","170.0000","100.0000"',
        "",
      ].join("\r\n"),
    );
  });
});
