import { describe, expect, it } from "vitest";

import {
  buildBalanceSeries,
  buildReport,
  periodKey,
  reportCsv,
} from "./reports";
import type { TransactionRecord } from "./types";
import { manualCashEffectAud } from "./cash-effect";

const base: TransactionRecord = {
  id: "b",
  ownerId: null,
  sourceArtifactId: null,
  createdById: "actor",
  updatedById: "actor",
  sourceSystem: "manual",
  kind: "supplier_expense",
  reference: "INV-2",
  counterparty: null,
  description: null,
  status: "recorded",
  category: null,
  notes: null,
  occurredAt: null,
  availableAt: null,
  invoiceDate: "2026-06-30",
  settledAt: "2026-07-01T00:00:00Z",
  documentCurrency: "AUD",
  documentAmount: "100.0000",
  documentTaxAmount: "10.0000",
  settlementCurrency: "AUD",
  settlementAmount: "101.0000",
  gstCreditStatus: "not_registered",
  claimableGstAud: "0.0000",
  sourceGross: null,
  sourceFee: null,
  sourceNet: null,
  sourceCurrency: null,
  metadata: {},
  createdAt: "2026-06-30T00:00:00Z",
  updatedAt: "2026-06-30T00:00:00Z",
};

describe("preparation reports", () => {
  it("uses Australian financial years in the reporting timezone", () => {
    expect(
      periodKey("2026-06-30T14:30:00Z", "Australia/Brisbane", "financial_year"),
    ).toBe("FY2026-27");
  });

  it("keeps activity and cash bases distinct", () => {
    expect(
      buildReport([base], "activity", "financial_year", "Australia/Brisbane")
        .lines[0],
    ).toMatchObject({ period: "FY2025-26", expenseEffectAud: "100.0000" });
    expect(
      buildReport([base], "cash", "financial_year", "Australia/Brisbane")
        .lines[0],
    ).toMatchObject({ period: "FY2026-27", expenseEffectAud: "101.0000" });
  });

  it("uses the canonical signed-AUD cash projection and excludes ineligible kinds", () => {
    const cash = buildReport(
      [base],
      "cash",
      "financial_year",
      "Australia/Brisbane",
    );
    expect(cash.lines[0]?.cashEffectAud).toBe(manualCashEffectAud(base));

    const dispute = { ...base, id: "dispute", kind: "dispute" as const };
    const excluded = buildReport(
      [dispute],
      "cash",
      "financial_year",
      "Australia/Brisbane",
    );
    expect(excluded.lines).toEqual([]);
    expect(excluded.warnings).toEqual(["INV-2: excluded dispute"]);
  });

  it("exports deterministic CRLF CSV with warnings", () => {
    const voided = { ...base, id: "a", status: "void" as const };
    const csv = reportCsv(
      buildReport([base, voided], "activity", "month", "Australia/Brisbane"),
    );
    expect(csv).toContain("INV-2: excluded void");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("uses Australian BAS quarters beginning in July", () => {
    expect(
      periodKey("2026-07-01T00:00:00Z", "Australia/Brisbane", "bas_quarter"),
    ).toBe("FY2026-27-Q1");
    expect(
      periodKey("2027-04-01T00:00:00Z", "Australia/Brisbane", "bas_quarter"),
    ).toBe("FY2026-27-Q4");
  });

  it("retains warnings without total lines and neutralises formulas", () => {
    const report = buildReport(
      [{ ...base, reference: "=2+2", status: "void" }],
      "activity",
      "month",
      "Australia/Brisbane",
    );
    expect(report.lines).toEqual([]);
    expect(report.warnings).toEqual(["=2+2: excluded void"]);
    expect(reportCsv(report)).toContain("'=2+2: excluded void");
  });

  it("excludes owner funding from income and expense summaries", () => {
    const report = buildReport(
      [
        {
          ...base,
          id: "owner-loan",
          kind: "owner_loan",
          reference: "OWNER-1",
          invoiceDate: null,
          occurredAt: "2026-06-30T00:00:00Z",
          documentAmount: "500.0000",
        },
      ],
      "activity",
      "month",
      "Australia/Brisbane",
    );

    expect(report.lines).toEqual([]);
    expect(report.warnings).toEqual(["OWNER-1: excluded owner_loan"]);
  });

  it("includes only completely settled AUD owner funding in cash totals", () => {
    const report = buildReport(
      [
        {
          ...base,
          id: "owner-contribution-settled",
          kind: "owner_contribution",
          reference: "OWNER-SETTLED",
          invoiceDate: null,
          settledAt: "2026-06-15T00:00:00Z",
          settlementCurrency: "AUD",
          settlementAmount: "500.0000",
        },
        {
          ...base,
          id: "owner-loan-foreign",
          kind: "owner_loan",
          reference: "OWNER-FOREIGN",
          invoiceDate: null,
          settledAt: "2026-06-16T00:00:00Z",
          settlementCurrency: "USD",
          settlementAmount: "300.0000",
        },
        {
          ...base,
          id: "owner-loan-pending",
          kind: "owner_loan",
          reference: "OWNER-PENDING",
          invoiceDate: null,
          settledAt: null,
          settlementCurrency: null,
          settlementAmount: null,
        },
      ],
      "cash",
      "month",
      "Australia/Brisbane",
    );

    expect(report.lines).toEqual([
      {
        period: "2026-06",
        incomeEffectAud: "0.0000",
        expenseEffectAud: "0.0000",
        cashEffectAud: "500.0000",
        includedCount: 1,
      },
    ]);
    expect(report.warnings).toEqual([
      "OWNER-FOREIGN: missing cash date or explicit AUD value",
      "OWNER-PENDING: pending settlement",
    ]);
  });

  it("excludes pending settlements from the cash view", () => {
    const pending = {
      ...base,
      settledAt: null,
      settlementCurrency: null,
      settlementAmount: null,
    };

    const report = buildReport(
      [pending],
      "cash",
      "month",
      "Australia/Brisbane",
    );

    expect(report.lines).toEqual([]);
    expect(report.warnings).toEqual(["INV-2: pending settlement"]);
  });

  it("includes every recorded Stripe row in balance movement by source net", () => {
    const stripe = (
      id: string,
      kind: TransactionRecord["kind"],
      reference: string,
      sourceNet: string,
      reportingCategory: string,
    ): TransactionRecord => ({
      ...base,
      id,
      sourceSystem: "stripe",
      kind,
      reference,
      description: "Imported Stripe row",
      invoiceDate: null,
      settledAt: null,
      documentCurrency: null,
      documentAmount: null,
      documentTaxAmount: null,
      settlementCurrency: null,
      settlementAmount: null,
      occurredAt: "2026-09-01T00:00:00.000Z",
      availableAt: null,
      sourceCurrency: "AUD",
      sourceGross: sourceNet,
      sourceFee: "0.0000",
      sourceNet,
      metadata: { reportingCategory },
    });
    const transactions = [
      stripe("stripe-sale", "sale", "STRIPE-SALE", "90.0000", "charge"),
      stripe(
        "stripe-transfer",
        "transfer",
        "STRIPE-TRANSFER",
        "-20.0000",
        "payout",
      ),
      stripe(
        "stripe-adjustment",
        "adjustment",
        "STRIPE-ADJUSTMENT",
        "5.0000",
        "adjustment",
      ),
      stripe(
        "stripe-unknown",
        "adjustment",
        "STRIPE-UNKNOWN",
        "-3.0000",
        "future_provider_category",
      ),
    ];

    expect(
      buildBalanceSeries(
        transactions,
        "activity",
        "month",
        "Australia/Brisbane",
      ),
    ).toMatchObject({
      lines: [
        {
          period: "2026-09",
          inflowAud: "95.0000",
          outflowAud: "23.0000",
          netMovementAud: "72.0000",
          includedCount: 4,
        },
      ],
      warnings: [
        "STRIPE-ADJUSTMENT: review Stripe reporting category adjustment",
        "STRIPE-UNKNOWN: review Stripe reporting category future_provider_category",
      ],
    });
    expect(
      buildReport(transactions, "activity", "month", "Australia/Brisbane")
        .lines,
    ).toEqual([
      {
        period: "2026-09",
        incomeEffectAud: "90.0000",
        expenseEffectAud: "0.0000",
        cashEffectAud: "90.0000",
        includedCount: 1,
      },
    ]);
  });
});
