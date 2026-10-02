import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import type { FinancialYearCashLedger } from "./reports";
import { buildTaxSourceReview } from "./tax-source-review";

const ledger: FinancialYearCashLedger = {
  financialYearStartYear: 2025,
  financialYear: "FY2025-26",
  timezone: "Australia/Brisbane",
  totals: {
    incomeEffectAud: "100.0000",
    expenseEffectAud: "0.0000",
    cashEffectAud: "100.0000",
    includedCount: 1,
  },
  rows: [
    {
      transactionId: "11111111-1111-4111-8111-111111111111",
      updatedAt: "2026-06-30T00:00:00.000Z",
      reference: "SYN-1",
      counterparty: null,
      description: "Synthetic sale",
      category: null,
      sourceSystem: "manual",
      kind: "sale",
      status: "recorded",
      cashDate: "2026-06-30T00:00:00.000Z",
      period: "FY2025-26",
      disposition: "included",
      reason: "included",
      issues: [],
      incomeEffectAud: "100.0000",
      expenseEffectAud: "0.0000",
      cashEffectAud: "100.0000",
    },
  ],
};

describe("tax source review", () => {
  it("fingerprints in-period ledger and bank review state deterministically", () => {
    const bankRows = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        postedDate: "2026-06-30",
        revision: "1",
        updatedAt: "2026-06-30T01:00:00.000Z",
        reviewState: "unresolved" as const,
      },
    ];
    const review = buildTaxSourceReview(ledger, bankRows);
    expect(review.readyForReview).toBe(false);
    expect(review.unresolvedBankCount).toBe(1);
    expect(review.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(buildTaxSourceReview(ledger, bankRows).fingerprint).toBe(
      review.fingerprint,
    );
    expect(
      buildTaxSourceReview(ledger, [
        { ...bankRows[0]!, reviewState: "matched", revision: "2" },
      ]).fingerprint,
    ).not.toBe(review.fingerprint);
  });

  it("preserves the exact legacy projection while fingerprinting owners in v2", () => {
    const review = buildTaxSourceReview(ledger, []);
    const legacyFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          version: 1,
          financialYearStartYear: ledger.financialYearStartYear,
          timezone: ledger.timezone,
          cashLedger: ledger,
          bankRows: [],
        }),
      )
      .digest("hex");
    const withOwner = buildTaxSourceReview(
      {
        ...ledger,
        rows: ledger.rows.map((row) => ({
          ...row,
          ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        })),
      },
      [],
    );

    expect(review.legacyFingerprint).toBe(legacyFingerprint);
    expect(withOwner.legacyFingerprint).toBe(review.legacyFingerprint);
    expect(withOwner.fingerprint).not.toBe(review.fingerprint);
  });

  it("keeps legacy reviews stale after the operational owner is edited", () => {
    const baseline = buildTaxSourceReview(ledger, []);
    const ownerEdited = buildTaxSourceReview(
      {
        ...ledger,
        rows: ledger.rows.map((row) => ({
          ...row,
          ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          updatedAt: "2026-07-01T00:00:00.000Z",
        })),
      },
      [],
    );

    expect(ownerEdited.legacyFingerprint).not.toBe(baseline.legacyFingerprint);
  });

  it("distinguishes missing cash facts from expected exclusions", () => {
    const missing = {
      ...ledger.rows[0]!,
      transactionId: "33333333-3333-4333-8333-333333333333",
      disposition: "action_required" as const,
      reason: "missing_cash_facts" as const,
      cashDate: null,
      period: null,
      issues: ["missing_settlement_amount" as const],
      incomeEffectAud: null,
      expenseEffectAud: null,
      cashEffectAud: null,
    };
    const review = buildTaxSourceReview(
      { ...ledger, rows: [...ledger.rows, missing] },
      [],
    );
    expect(review.actionRequiredCount).toBe(1);
    expect(review.readyForReview).toBe(false);
    expect(
      buildTaxSourceReview({ ...ledger, rows: [ledger.rows[0]!] }, [])
        .readyForReview,
    ).toBe(true);
  });

  it("does not stale a reviewed FY for a dated exclusion in another year", () => {
    const baseline = buildTaxSourceReview(ledger, []);
    const unrelatedTransfer = {
      ...ledger.rows[0]!,
      transactionId: "44444444-4444-4444-8444-444444444444",
      kind: "transfer" as const,
      cashDate: "2024-08-01T00:00:00.000Z",
      period: "FY2024-25",
      disposition: "expected_exclusion" as const,
      reason: "excluded_transfer" as const,
      incomeEffectAud: "0.0000",
      expenseEffectAud: "0.0000",
      cashEffectAud: "0.0000",
    };
    const review = buildTaxSourceReview(
      { ...ledger, rows: [...ledger.rows, unrelatedTransfer] },
      [],
    );
    expect(review.fingerprint).toBe(baseline.fingerprint);
    expect(review.cashLedger.rows).toEqual(baseline.cashLedger.rows);
  });

  it("blocks review for an undated draft whose financial year is unknown", () => {
    const undatedDraft = {
      ...ledger.rows[0]!,
      transactionId: "55555555-5555-4555-8555-555555555555",
      status: "draft" as const,
      cashDate: null,
      period: null,
      disposition: "expected_exclusion" as const,
      reason: "excluded_draft" as const,
      incomeEffectAud: "0.0000",
      expenseEffectAud: "0.0000",
      cashEffectAud: "0.0000",
    };
    const review = buildTaxSourceReview(
      { ...ledger, rows: [...ledger.rows, undatedDraft] },
      [],
    );
    expect(review.draftCount).toBe(1);
    expect(review.readyForReview).toBe(false);
  });
});
