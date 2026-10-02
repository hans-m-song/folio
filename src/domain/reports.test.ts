import { describe, expect, it } from "vitest";

import {
  buildBalanceSeries,
  buildFinancialYearCashLedger,
  buildReport,
  periodKey,
  reportCsv,
} from "./reports";
import type { TransactionRecord } from "./types";
import { manualCashEffectAud } from "./cash-effect";
import { parseDecimal } from "./money";

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

  it("classifies cash rows at Australian financial-year boundaries", () => {
    const ledger = buildFinancialYearCashLedger(
      [
        {
          ...base,
          id: "june-close",
          settledAt: "2026-06-30T13:59:59Z",
          updatedAt: "2026-07-02T00:00:00Z",
          counterparty: "Synthetic supplier",
          category: "Synthetic services",
        },
        {
          ...base,
          id: "july-open",
          settledAt: "2026-06-30T14:00:00Z",
        },
      ],
      2025,
      "Australia/Brisbane",
    );

    expect(ledger.financialYear).toBe("FY2025-26");
    expect(ledger.rows).toMatchObject([
      {
        transactionId: "july-open",
        updatedAt: base.updatedAt,
        period: "FY2026-27",
        disposition: "out_of_period",
        reason: "outside_selected_financial_year",
        expenseEffectAud: "101.0000",
      },
      {
        transactionId: "june-close",
        updatedAt: "2026-07-02T00:00:00Z",
        counterparty: "Synthetic supplier",
        category: "Synthetic services",
        period: "FY2025-26",
        disposition: "included",
        expenseEffectAud: "101.0000",
      },
    ]);
    expect(ledger.totals).toMatchObject({
      expenseEffectAud: "101.0000",
      cashEffectAud: "-101.0000",
      includedCount: 1,
    });
  });

  it("explains missing cash date and AUD facts as actionable row issues", () => {
    const missingManual = {
      ...base,
      id: "manual-missing",
      settledAt: null,
      settlementAmount: null,
      settlementCurrency: null,
    };
    const foreignManual = {
      ...base,
      id: "manual-foreign",
      settlementCurrency: "USD",
    };
    const missingStripe = {
      ...base,
      id: "stripe-missing",
      sourceSystem: "stripe" as const,
      kind: "sale" as const,
      occurredAt: null,
      sourceCurrency: "USD",
      sourceGross: "20.0000",
      sourceFee: "1.0000",
      sourceNet: "19.0000",
    };

    const ledger = buildFinancialYearCashLedger(
      [missingManual, foreignManual, missingStripe],
      2026,
      "Australia/Brisbane",
    );

    expect(ledger.rows).toMatchObject([
      {
        transactionId: "manual-foreign",
        disposition: "action_required",
        reason: "missing_cash_facts",
        issues: ["settlement_currency_not_aud"],
        incomeEffectAud: null,
        expenseEffectAud: null,
        cashEffectAud: null,
      },
      {
        transactionId: "manual-missing",
        disposition: "action_required",
        issues: [
          "missing_settlement_date",
          "missing_settlement_amount",
          "settlement_currency_not_aud",
        ],
      },
      {
        transactionId: "stripe-missing",
        disposition: "action_required",
        issues: [
          "missing_stripe_activity_date",
          "stripe_source_currency_not_aud",
        ],
      },
    ]);
  });

  it("keeps expected exclusions explicit with zero effects", () => {
    const excludedRows = [
      { ...base, id: "draft-row", status: "draft" as const },
      { ...base, id: "void-row", status: "void" as const },
      { ...base, id: "transfer-row", kind: "transfer" as const },
      { ...base, id: "adjustment-row", kind: "adjustment" as const },
      { ...base, id: "dispute-row", kind: "dispute" as const },
    ];

    const ledger = buildFinancialYearCashLedger(
      excludedRows,
      2026,
      "Australia/Brisbane",
    );

    expect(ledger.rows).toMatchObject([
      {
        transactionId: "adjustment-row",
        disposition: "expected_exclusion",
        reason: "excluded_adjustment",
        incomeEffectAud: "0.0000",
        expenseEffectAud: "0.0000",
        cashEffectAud: "0.0000",
      },
      {
        transactionId: "dispute-row",
        disposition: "expected_exclusion",
        reason: "excluded_manual_dispute",
      },
      {
        transactionId: "draft-row",
        disposition: "expected_exclusion",
        reason: "excluded_draft",
      },
      {
        transactionId: "transfer-row",
        disposition: "expected_exclusion",
        reason: "excluded_transfer",
      },
      {
        transactionId: "void-row",
        disposition: "expected_exclusion",
        reason: "excluded_void",
      },
    ]);
    expect(ledger.totals.includedCount).toBe(0);
  });

  it("keeps Stripe gross, fee, and net effects and owner funding cash-only", () => {
    const stripeSale: TransactionRecord = {
      ...base,
      id: "stripe-sale",
      sourceSystem: "stripe",
      kind: "sale",
      invoiceDate: null,
      settledAt: null,
      documentCurrency: null,
      documentAmount: null,
      documentTaxAmount: null,
      settlementCurrency: null,
      settlementAmount: null,
      occurredAt: "2026-07-02T00:00:00Z",
      sourceCurrency: "AUD",
      sourceGross: "50.1250",
      sourceFee: "2.0050",
      sourceNet: "48.1200",
    };
    const ownerFunding: TransactionRecord = {
      ...base,
      id: "owner-funding",
      kind: "owner_contribution",
      settledAt: "2026-07-03T00:00:00Z",
      settlementAmount: "500.2500",
    };

    const ledger = buildFinancialYearCashLedger(
      [stripeSale, ownerFunding],
      2026,
      "Australia/Brisbane",
    );

    expect(ledger.rows).toMatchObject([
      {
        transactionId: "owner-funding",
        disposition: "included",
        reason: "owner_funding_cash_only",
        incomeEffectAud: "0.0000",
        expenseEffectAud: "0.0000",
        cashEffectAud: "500.2500",
      },
      {
        transactionId: "stripe-sale",
        disposition: "included",
        incomeEffectAud: "50.1250",
        expenseEffectAud: "2.0050",
        cashEffectAud: "48.1200",
      },
    ]);
  });

  it("reconciles its selected-year totals to the cash report line", () => {
    const transactions: TransactionRecord[] = [
      base,
      {
        ...base,
        id: "owner-funding",
        kind: "owner_loan",
        settledAt: "2026-07-05T00:00:00Z",
        settlementAmount: "500.0000",
      },
      {
        ...base,
        id: "stripe-sale",
        sourceSystem: "stripe",
        kind: "sale",
        invoiceDate: null,
        settledAt: null,
        documentCurrency: null,
        documentAmount: null,
        documentTaxAmount: null,
        settlementCurrency: null,
        settlementAmount: null,
        occurredAt: "2026-07-02T00:00:00Z",
        sourceCurrency: "AUD",
        sourceGross: "50.0000",
        sourceFee: "2.0000",
        sourceNet: "48.0000",
      },
      { ...base, id: "transfer", kind: "transfer" },
      { ...base, id: "foreign", settlementCurrency: "USD" },
    ];
    const ledger = buildFinancialYearCashLedger(
      transactions,
      2026,
      "Australia/Brisbane",
    );
    const cashLine = buildReport(
      transactions,
      "cash",
      "financial_year",
      "Australia/Brisbane",
    ).lines.find((line) => line.period === ledger.financialYear);

    expect(ledger.totals).toEqual({
      incomeEffectAud: cashLine?.incomeEffectAud ?? "0.0000",
      expenseEffectAud: cashLine?.expenseEffectAud ?? "0.0000",
      cashEffectAud: cashLine?.cashEffectAud ?? "0.0000",
      includedCount: cashLine?.includedCount ?? 0,
    });
  });

  it("groups recorded effects by saved category and keeps Stripe fees separate", () => {
    const report = buildReport(
      [
        { ...base, category: "Software and subscriptions" },
        {
          ...base,
          id: "credit",
          kind: "supplier_credit",
          category: "Software and subscriptions",
          documentAmount: "20.0000",
        },
        {
          ...base,
          id: "sale",
          kind: "sale",
          category: null,
          documentAmount: "200.0000",
        },
        {
          ...base,
          id: "stripe-sale",
          sourceSystem: "stripe",
          kind: "sale",
          category: null,
          occurredAt: "2026-06-15T00:00:00.000Z",
          sourceCurrency: "AUD",
          sourceGross: "50.0000",
          sourceFee: "2.0000",
          sourceNet: "48.0000",
        },
      ],
      "activity",
      "month",
      "Australia/Brisbane",
    );

    expect(report.categoryLines).toEqual([
      {
        period: "2026-06",
        category: "Software and subscriptions",
        incomeEffectAud: "0.0000",
        expenseEffectAud: "80.0000",
        includedCount: 2,
      },
      {
        period: "2026-06",
        category: "Uncategorised — Processing fee",
        incomeEffectAud: "0.0000",
        expenseEffectAud: "2.0000",
        includedCount: 1,
      },
      {
        period: "2026-06",
        category: "Uncategorised — Sale",
        incomeEffectAud: "250.0000",
        expenseEffectAud: "0.0000",
        includedCount: 2,
      },
    ]);
    expect(
      report.categoryLines.reduce(
        (sum, line) => sum + parseDecimal(line.incomeEffectAud),
        0n,
      ),
    ).toBe(parseDecimal(report.lines[0]!.incomeEffectAud));
    expect(
      report.categoryLines.reduce(
        (sum, line) => sum + parseDecimal(line.expenseEffectAud),
        0n,
      ),
    ).toBe(parseDecimal(report.lines[0]!.expenseEffectAud));
  });

  it("omits excluded and non-AUD rows from category effects", () => {
    const report = buildReport(
      [
        { ...base, id: "draft", status: "draft", category: "Software" },
        {
          ...base,
          id: "foreign",
          documentCurrency: "USD",
          category: "Software",
        },
        { ...base, id: "included", category: "Software" },
      ],
      "activity",
      "month",
      "Australia/Brisbane",
    );

    expect(report.categoryLines).toEqual([
      {
        period: "2026-06",
        category: "Software",
        incomeEffectAud: "0.0000",
        expenseEffectAud: "100.0000",
        includedCount: 1,
      },
    ]);
    expect(report.warnings).toHaveLength(2);
  });

  it("uses the canonical signed-AUD cash projection and excludes ineligible kinds", () => {
    const cash = buildReport(
      [base],
      "cash",
      "financial_year",
      "Australia/Brisbane",
    );
    expect(cash.lines[0]?.cashEffectAud).toBe(manualCashEffectAud(base));

    const dispute = {
      ...base,
      id: "dispute",
      kind: "dispute" as const,
      description: "Chargeback reversal",
    };
    const excluded = buildReport(
      [dispute],
      "cash",
      "financial_year",
      "Australia/Brisbane",
    );
    expect(excluded.lines).toEqual([]);
    expect(excluded.warnings).toEqual([
      {
        transactionId: "dispute",
        reference: "INV-2",
        description: "Chargeback reversal",
        reason: "excluded dispute",
      },
    ]);
  });

  it("exports deterministic CRLF CSV with warnings", () => {
    const voided = { ...base, id: "a", status: "void" as const };
    const withoutReference = {
      ...base,
      id: "missing-reference",
      reference: null,
      status: "void" as const,
    };
    const csv = reportCsv(
      buildReport(
        [base, voided, withoutReference],
        "activity",
        "month",
        "Australia/Brisbane",
      ),
    );
    expect(csv).toContain("INV-2: excluded void");
    expect(csv).toContain("missing-reference: excluded void");
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
    expect(report.warnings).toEqual([
      {
        transactionId: "b",
        reference: "=2+2",
        description: null,
        reason: "excluded void",
      },
    ]);
    expect(reportCsv(report)).toContain("'=2+2: excluded void");
  });

  it("exports category rows with formula-safe custom labels", () => {
    const report = buildReport(
      [{ ...base, category: "=2+2" }],
      "activity",
      "month",
      "Australia/Brisbane",
    );
    const csv = reportCsv(report);

    expect(csv).toContain("category,row_type");
    expect(csv).toContain("'=2+2,category");
    expect(csv).toContain("period_total");
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
    expect(report.warnings).toEqual([
      {
        transactionId: "owner-loan",
        reference: "OWNER-1",
        description: null,
        reason: "excluded owner_loan",
      },
    ]);
  });

  it("excludes principal repayments from activity while retaining an expected exclusion", () => {
    const report = buildReport(
      [
        {
          ...base,
          id: "owner-loan-repayment",
          ownerId: "00000000-0000-4000-8000-000000000001",
          kind: "owner_loan_repayment",
          reference: "REPAY-1",
          invoiceDate: null,
          occurredAt: "2026-06-30T00:00:00Z",
          documentAmount: "125.0000",
          documentTaxAmount: null,
          taxTreatment: "no_tax",
        },
      ],
      "activity",
      "month",
      "Australia/Brisbane",
    );

    expect(report.lines).toEqual([]);
    expect(report.warnings).toEqual([
      {
        transactionId: "owner-loan-repayment",
        reference: "REPAY-1",
        description: null,
        reason: "excluded owner_loan_repayment",
      },
    ]);
  });

  it("includes principal repayments as cash-only outflows", () => {
    const repayment: TransactionRecord = {
      ...base,
      id: "owner-loan-repayment",
      ownerId: "00000000-0000-4000-8000-000000000001",
      kind: "owner_loan_repayment",
      invoiceDate: null,
      settledAt: "2026-07-03T00:00:00Z",
      documentAmount: "125.0000",
      documentTaxAmount: null,
      taxTreatment: "no_tax",
      settlementAmount: "125.0000",
    };
    const ledger = buildFinancialYearCashLedger(
      [repayment],
      2026,
      "Australia/Brisbane",
    );

    expect(ledger.rows).toMatchObject([
      {
        transactionId: "owner-loan-repayment",
        disposition: "included",
        reason: "owner_funding_cash_only",
        incomeEffectAud: "0.0000",
        expenseEffectAud: "0.0000",
        cashEffectAud: "-125.0000",
      },
    ]);
    expect(ledger.totals).toMatchObject({
      incomeEffectAud: "0.0000",
      expenseEffectAud: "0.0000",
      cashEffectAud: "-125.0000",
    });
  });

  it("keeps missing or non-AUD repayment cash facts visible as action required", () => {
    const repayment: TransactionRecord = {
      ...base,
      id: "owner-loan-repayment",
      ownerId: "00000000-0000-4000-8000-000000000001",
      kind: "owner_loan_repayment",
      invoiceDate: null,
      documentAmount: "125.0000",
      documentTaxAmount: null,
      taxTreatment: "no_tax",
      settledAt: null,
      settlementCurrency: null,
      settlementAmount: null,
    };
    const missingFacts = buildFinancialYearCashLedger(
      [repayment],
      2026,
      "Australia/Brisbane",
    );
    expect(missingFacts.rows[0]).toMatchObject({
      disposition: "action_required",
      issues: [
        "missing_settlement_date",
        "missing_settlement_amount",
        "settlement_currency_not_aud",
      ],
      cashEffectAud: null,
    });

    const foreignSettlement = buildFinancialYearCashLedger(
      [
        {
          ...repayment,
          settledAt: "2026-07-03T00:00:00Z",
          settlementCurrency: "USD",
          settlementAmount: "125.0000",
        },
      ],
      2026,
      "Australia/Brisbane",
    );
    expect(foreignSettlement.rows[0]).toMatchObject({
      disposition: "action_required",
      issues: ["settlement_currency_not_aud"],
      cashEffectAud: null,
    });
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
      {
        transactionId: "owner-loan-foreign",
        reference: "OWNER-FOREIGN",
        description: null,
        reason: "missing cash date or explicit AUD value",
      },
      {
        transactionId: "owner-loan-pending",
        reference: "OWNER-PENDING",
        description: null,
        reason: "pending settlement",
      },
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
    expect(report.warnings).toEqual([
      {
        transactionId: "b",
        reference: "INV-2",
        description: null,
        reason: "pending settlement",
      },
    ]);
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
