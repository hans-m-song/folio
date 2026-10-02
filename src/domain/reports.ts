import { formatDecimal, parseDecimal } from "./money";
import { manualCashEffectAudMinor } from "./cash-effect";
import {
  classifyStripeReportingCategory,
  stripeBalanceMovement,
} from "./stripe-semantics";
import { transactionKindLabels, type TransactionRecord } from "./types";

export type ReportBasis = "activity" | "cash";
export type PeriodType = "month" | "bas_quarter" | "financial_year";

export interface ReportLine {
  period: string;
  incomeEffectAud: string;
  expenseEffectAud: string;
  cashEffectAud: string;
  includedCount: number;
}

export interface ReportCategoryLine {
  period: string;
  category: string;
  incomeEffectAud: string;
  expenseEffectAud: string;
  includedCount: number;
}

export interface ReportWarning {
  transactionId: string;
  reference: string | null;
  description: string | null;
  reason: string;
}

export interface ReportEnvelope {
  basis: ReportBasis;
  basisLabel: string;
  periodType: PeriodType;
  includedCountLabel: "included transaction rows";
  lines: ReportLine[];
  categoryLines: ReportCategoryLine[];
  warnings: ReportWarning[];
}

export interface BalanceLine {
  period: string;
  inflowAud: string;
  outflowAud: string;
  netMovementAud: string;
  includedCount: number;
}

export interface BalanceSeries {
  basis: ReportBasis;
  basisLabel: string;
  periodType: PeriodType;
  includedCountLabel: "included balance-movement rows";
  lines: BalanceLine[];
  warnings: string[];
}

export type FinancialYearCashLedgerDisposition =
  | "included"
  | "expected_exclusion"
  | "action_required"
  | "out_of_period";

export type FinancialYearCashLedgerIssue =
  | "missing_settlement_date"
  | "missing_settlement_amount"
  | "settlement_currency_not_aud"
  | "missing_stripe_activity_date"
  | "stripe_source_currency_not_aud"
  | "unsupported_cash_effect";

export type FinancialYearCashLedgerReason =
  | "included"
  | "owner_funding_cash_only"
  | "outside_selected_financial_year"
  | "excluded_draft"
  | "excluded_void"
  | "excluded_transfer"
  | "excluded_adjustment"
  | "excluded_manual_dispute"
  | "missing_cash_facts";

export interface FinancialYearCashLedgerRow {
  transactionId: string;
  ownerId?: string | null;
  updatedAt: string;
  reference: string | null;
  counterparty: string | null;
  description: string | null;
  category: string | null;
  sourceSystem: TransactionRecord["sourceSystem"];
  kind: TransactionRecord["kind"];
  status: TransactionRecord["status"];
  cashDate: string | null;
  period: string | null;
  disposition: FinancialYearCashLedgerDisposition;
  reason: FinancialYearCashLedgerReason;
  issues: FinancialYearCashLedgerIssue[];
  incomeEffectAud: string | null;
  expenseEffectAud: string | null;
  cashEffectAud: string | null;
}

export interface FinancialYearCashLedger {
  financialYearStartYear: number;
  financialYear: string;
  timezone: string;
  rows: FinancialYearCashLedgerRow[];
  totals: {
    incomeEffectAud: string;
    expenseEffectAud: string;
    cashEffectAud: string;
    includedCount: number;
  };
}

function localParts(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
  };
}

export function periodKey(
  value: string,
  timezone: string,
  type: PeriodType,
): string {
  const { year, month } = localParts(value, timezone);
  if (type === "month") return `${year}-${month.toString().padStart(2, "0")}`;
  if (type === "bas_quarter") {
    const start = month >= 7 ? year : year - 1;
    const quarter = Math.floor(((month + 5) % 12) / 3) + 1;
    return `FY${start}-${(start + 1).toString().slice(-2)}-Q${quarter}`;
  }
  const start = month >= 7 ? year : year - 1;
  return `FY${start}-${(start + 1).toString().slice(-2)}`;
}

function effects(transaction: TransactionRecord, basis: ReportBasis) {
  if (["draft", "void"].includes(transaction.status)) return null;
  if (["transfer", "adjustment"].includes(transaction.kind)) return null;
  if (transaction.sourceSystem === "manual" && transaction.kind === "dispute")
    return null;
  if (
    ["owner_contribution", "owner_loan", "owner_loan_repayment"].includes(
      transaction.kind,
    )
  ) {
    if (basis === "activity") return null;
    const cash = manualCashEffectAudMinor(transaction);
    if (cash === null) return undefined;
    return {
      date: transaction.settledAt!,
      income: 0n,
      expense: 0n,
      cash,
    };
  }
  if (transaction.sourceSystem === "stripe") {
    if (!transaction.occurredAt || transaction.sourceCurrency !== "AUD")
      return undefined;
    const gross = transaction.sourceGross
      ? parseDecimal(transaction.sourceGross)
      : 0n;
    const fee = transaction.sourceFee
      ? parseDecimal(transaction.sourceFee)
      : 0n;
    if (transaction.kind === "sale")
      return {
        date: transaction.occurredAt,
        income: gross,
        expense: fee,
        cash: parseDecimal(transaction.sourceNet ?? "0"),
      };
    if (transaction.kind === "sale_refund")
      return {
        date: transaction.occurredAt,
        income: gross,
        expense: 0n,
        cash: parseDecimal(
          transaction.sourceNet ?? transaction.sourceGross ?? "0",
        ),
      };
    if (transaction.kind === "processing_fee")
      return {
        date: transaction.occurredAt,
        income: 0n,
        expense: fee || -gross,
        cash: parseDecimal(
          transaction.sourceNet ?? transaction.sourceGross ?? "0",
        ),
      };
    return {
      date: transaction.occurredAt,
      income: 0n,
      expense: -gross,
      cash: parseDecimal(
        transaction.sourceNet ?? transaction.sourceGross ?? "0",
      ),
    };
  }
  const date =
    basis === "activity" ? transaction.invoiceDate : transaction.settledAt;
  const amount =
    basis === "activity"
      ? transaction.documentAmount
      : transaction.settlementAmount;
  const currency =
    basis === "activity"
      ? transaction.documentCurrency
      : transaction.settlementCurrency;
  if (!date || !amount || currency !== "AUD") return undefined;
  const magnitude = parseDecimal(amount);
  const canonicalCash =
    basis === "cash" ? manualCashEffectAudMinor(transaction) : null;
  if (transaction.kind === "supplier_expense")
    return {
      date,
      income: 0n,
      expense: magnitude,
      cash: canonicalCash ?? -magnitude,
    };
  if (transaction.kind === "supplier_credit")
    return {
      date,
      income: 0n,
      expense: -magnitude,
      cash: canonicalCash ?? magnitude,
    };
  if (transaction.kind === "sale")
    return {
      date,
      income: magnitude,
      expense: 0n,
      cash: canonicalCash ?? magnitude,
    };
  if (transaction.kind === "sale_refund")
    return {
      date,
      income: -magnitude,
      expense: 0n,
      cash: canonicalCash ?? -magnitude,
    };
  return {
    date,
    income: 0n,
    expense: magnitude,
    cash: canonicalCash ?? -magnitude,
  };
}

const cashLedgerDate = (transaction: TransactionRecord): string | null =>
  transaction.kind === "owner_contribution" ||
  transaction.kind === "owner_loan" ||
  transaction.kind === "owner_loan_repayment"
    ? transaction.settledAt
    : transaction.sourceSystem === "stripe"
      ? transaction.occurredAt
      : transaction.settledAt;

const cashLedgerExclusionReason = (
  transaction: TransactionRecord,
): FinancialYearCashLedgerReason | null => {
  if (transaction.status !== "recorded")
    return transaction.status === "draft" ? "excluded_draft" : "excluded_void";
  if (transaction.kind === "transfer") return "excluded_transfer";
  if (transaction.kind === "adjustment") return "excluded_adjustment";
  if (transaction.sourceSystem === "manual" && transaction.kind === "dispute")
    return "excluded_manual_dispute";
  return null;
};

const cashLedgerIssues = (
  transaction: TransactionRecord,
): FinancialYearCashLedgerIssue[] => {
  if (
    (transaction.kind === "owner_contribution" ||
      transaction.kind === "owner_loan" ||
      transaction.kind === "owner_loan_repayment") &&
    transaction.sourceSystem !== "manual"
  )
    return ["unsupported_cash_effect"];

  if (transaction.sourceSystem === "stripe") {
    const issues: FinancialYearCashLedgerIssue[] = [];
    if (!transaction.occurredAt) issues.push("missing_stripe_activity_date");
    if (transaction.sourceCurrency !== "AUD")
      issues.push("stripe_source_currency_not_aud");
    return issues.length > 0 ? issues : ["unsupported_cash_effect"];
  }

  const issues: FinancialYearCashLedgerIssue[] = [];
  if (!transaction.settledAt) issues.push("missing_settlement_date");
  if (!transaction.settlementAmount) issues.push("missing_settlement_amount");
  if (transaction.settlementCurrency !== "AUD")
    issues.push("settlement_currency_not_aud");
  return issues.length > 0 ? issues : ["unsupported_cash_effect"];
};

const financialYearLabel = (startYear: number): string =>
  `FY${startYear}-${(startYear + 1).toString().slice(-2)}`;

export const buildFinancialYearCashLedger = (
  transactions: readonly TransactionRecord[],
  financialYearStartYear: number,
  timezone: string,
): FinancialYearCashLedger => {
  if (!Number.isInteger(financialYearStartYear))
    throw new RangeError("Financial year start must be an integer year");

  const financialYear = financialYearLabel(financialYearStartYear);
  const rows = [...transactions]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((transaction): FinancialYearCashLedgerRow => {
      const effect = effects(transaction, "cash");
      const cashDate = effect?.date ?? cashLedgerDate(transaction);
      const period = cashDate
        ? periodKey(cashDate, timezone, "financial_year")
        : null;
      const rowContext = {
        transactionId: transaction.id,
        ownerId: transaction.ownerId,
        updatedAt: transaction.updatedAt,
        reference: transaction.reference,
        counterparty: transaction.counterparty,
        description: transaction.description,
        category: transaction.category,
        sourceSystem: transaction.sourceSystem,
        kind: transaction.kind,
        status: transaction.status,
        cashDate,
        period,
      };

      if (effect === null) {
        const reason = cashLedgerExclusionReason(transaction);
        if (reason === null)
          throw new Error("Excluded cash row has no expected-exclusion reason");

        return {
          ...rowContext,
          disposition: "expected_exclusion",
          reason,
          issues: [],
          incomeEffectAud: "0.0000",
          expenseEffectAud: "0.0000",
          cashEffectAud: "0.0000",
        };
      }

      const issues = effect === undefined ? cashLedgerIssues(transaction) : [];
      if (period !== null && period !== financialYear) {
        return {
          ...rowContext,
          disposition: "out_of_period",
          reason: "outside_selected_financial_year",
          issues,
          incomeEffectAud:
            effect === undefined ? null : formatDecimal(effect.income),
          expenseEffectAud:
            effect === undefined ? null : formatDecimal(effect.expense),
          cashEffectAud:
            effect === undefined ? null : formatDecimal(effect.cash),
        };
      }

      if (effect === undefined) {
        return {
          ...rowContext,
          disposition: "action_required",
          reason: "missing_cash_facts",
          issues,
          incomeEffectAud: null,
          expenseEffectAud: null,
          cashEffectAud: null,
        };
      }

      const ownerFunding =
        transaction.kind === "owner_contribution" ||
        transaction.kind === "owner_loan" ||
        transaction.kind === "owner_loan_repayment";
      return {
        ...rowContext,
        disposition: "included",
        reason: ownerFunding ? "owner_funding_cash_only" : "included",
        issues: [],
        incomeEffectAud: formatDecimal(effect.income),
        expenseEffectAud: formatDecimal(effect.expense),
        cashEffectAud: formatDecimal(effect.cash),
      };
    });

  const totals = rows.reduce(
    (total, row) => {
      if (row.disposition !== "included") return total;
      total.income += parseDecimal(row.incomeEffectAud!);
      total.expense += parseDecimal(row.expenseEffectAud!);
      total.cash += parseDecimal(row.cashEffectAud!);
      total.includedCount += 1;
      return total;
    },
    { income: 0n, expense: 0n, cash: 0n, includedCount: 0 },
  );

  return {
    financialYearStartYear,
    financialYear,
    timezone,
    rows,
    totals: {
      incomeEffectAud: formatDecimal(totals.income),
      expenseEffectAud: formatDecimal(totals.expense),
      cashEffectAud: formatDecimal(totals.cash),
      includedCount: totals.includedCount,
    },
  };
};

const reportWarning = (
  transaction: TransactionRecord,
  reason: string,
): ReportWarning => ({
  transactionId: transaction.id,
  reference: transaction.reference,
  description: transaction.description,
  reason,
});

export function buildReport(
  transactions: readonly TransactionRecord[],
  basis: ReportBasis,
  periodType: PeriodType,
  timezone: string,
): ReportEnvelope {
  const totals = new Map<
    string,
    {
      income: bigint;
      expense: bigint;
      cash: bigint;
      count: number;
    }
  >();
  const categories = new Map<
    string,
    {
      period: string;
      category: string;
      income: bigint;
      expense: bigint;
      count: number;
    }
  >();
  const addCategoryEffect = (
    period: string,
    category: string,
    income: bigint,
    expense: bigint,
  ) => {
    if (income === 0n && expense === 0n) return;
    const key = JSON.stringify([period, category]);
    const total = categories.get(key) ?? {
      period,
      category,
      income: 0n,
      expense: 0n,
      count: 0,
    };
    total.income += income;
    total.expense += expense;
    total.count += 1;
    categories.set(key, total);
  };
  const globalWarnings: ReportWarning[] = [];
  for (const transaction of [...transactions].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const effect = effects(transaction, basis);
    if (effect === null) {
      globalWarnings.push(
        reportWarning(
          transaction,
          `excluded ${transaction.status === "recorded" ? transaction.kind : transaction.status}`,
        ),
      );
      continue;
    }
    if (effect === undefined) {
      if (basis === "cash" && !transaction.settledAt) {
        globalWarnings.push(reportWarning(transaction, "pending settlement"));
        continue;
      }
      globalWarnings.push(
        reportWarning(
          transaction,
          `missing ${basis} date or explicit AUD value`,
        ),
      );
      continue;
    }
    const period = periodKey(effect.date, timezone, periodType);
    const total = totals.get(period) ?? {
      income: 0n,
      expense: 0n,
      cash: 0n,
      count: 0,
    };
    total.income += effect.income;
    total.expense += effect.expense;
    total.cash += effect.cash;
    total.count += 1;
    totals.set(period, total);

    const category =
      transaction.category?.trim() ||
      `Uncategorised — ${transactionKindLabels[transaction.kind]}`;
    if (transaction.sourceSystem === "stripe" && transaction.kind === "sale") {
      addCategoryEffect(period, category, effect.income, 0n);
      addCategoryEffect(
        period,
        "Uncategorised — Processing fee",
        0n,
        effect.expense,
      );
    } else {
      addCategoryEffect(period, category, effect.income, effect.expense);
    }
  }
  const lines = [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, total]) => ({
      period,
      incomeEffectAud: formatDecimal(total.income),
      expenseEffectAud: formatDecimal(total.expense),
      cashEffectAud: formatDecimal(total.cash),
      includedCount: total.count,
    }));
  const categoryLines = [...categories.values()]
    .sort(
      (left, right) =>
        left.period.localeCompare(right.period) ||
        left.category.localeCompare(right.category),
    )
    .map((total) => ({
      period: total.period,
      category: total.category,
      incomeEffectAud: formatDecimal(total.income),
      expenseEffectAud: formatDecimal(total.expense),
      includedCount: total.count,
    }));
  return {
    basis,
    basisLabel:
      basis === "activity"
        ? "Activity-basis preparation view"
        : "Cash-basis preparation view",
    periodType,
    includedCountLabel: "included transaction rows",
    lines,
    categoryLines,
    warnings: globalWarnings,
  };
}

export function buildBalanceSeries(
  transactions: readonly TransactionRecord[],
  basis: ReportBasis,
  periodType: PeriodType,
  timezone: string,
): BalanceSeries {
  const totals = new Map<
    string,
    {
      inflow: bigint;
      outflow: bigint;
      net: bigint;
      count: number;
    }
  >();
  const warnings: string[] = [];
  for (const transaction of [...transactions].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const reference = transaction.reference ?? transaction.id;
    if (transaction.status !== "recorded") {
      warnings.push(`${reference}: excluded ${transaction.status}`);
      continue;
    }

    let date: string;
    let movement: bigint;
    if (transaction.sourceSystem === "stripe") {
      const sourceMovement = stripeBalanceMovement(transaction);
      if (!sourceMovement || sourceMovement.currency !== "AUD") {
        warnings.push(
          `${reference}: missing balance date or explicit AUD value`,
        );
        continue;
      }
      date = sourceMovement.date;
      movement = parseDecimal(sourceMovement.net);
      const reportingCategory = transaction.metadata.reportingCategory;
      if (
        classifyStripeReportingCategory(String(reportingCategory ?? ""))
          .requiresReview
      ) {
        const category = String(reportingCategory ?? "").trim();
        warnings.push(
          `${reference}: review Stripe reporting category${category ? ` ${category}` : ""}`,
        );
      }
    } else {
      const effect = effects(transaction, basis);
      if (effect === null) {
        warnings.push(`${reference}: excluded ${transaction.kind}`);
        continue;
      }
      if (effect === undefined) {
        if (basis === "cash" && !transaction.settledAt) {
          warnings.push(`${reference}: pending settlement`);
          continue;
        }
        warnings.push(
          `${reference}: missing ${basis} date or explicit AUD value`,
        );
        continue;
      }
      date = effect.date;
      movement = effect.cash;
    }

    const period = periodKey(date, timezone, periodType);
    const total = totals.get(period) ?? {
      inflow: 0n,
      outflow: 0n,
      net: 0n,
      count: 0,
    };
    total.net += movement;
    if (movement >= 0n) total.inflow += movement;
    else total.outflow -= movement;
    total.count += 1;
    totals.set(period, total);
  }

  const lines = [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, total]) => ({
      period,
      inflowAud: formatDecimal(total.inflow),
      outflowAud: formatDecimal(total.outflow),
      netMovementAud: formatDecimal(total.net),
      includedCount: total.count,
    }));
  return {
    basis,
    basisLabel: "Recorded balance movement view",
    periodType,
    includedCountLabel: "included balance-movement rows",
    lines,
    warnings,
  };
}

export const buildBalanceReport = buildBalanceSeries;

function csvCell(value: string | number, neutraliseFormula = false): string {
  const text = String(value);
  const safe =
    neutraliseFormula && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function reportCsv(report: ReportEnvelope): string {
  const header = [
    "basis_label",
    "period_type",
    "period",
    "income_effect_aud",
    "expense_effect_aud",
    "cash_effect_aud",
    "included_transaction_count",
    "warning",
    "category",
    "row_type",
  ];
  const rows: Array<Array<string | number>> = report.lines.map((line) => [
    report.basisLabel,
    report.periodType,
    line.period,
    line.incomeEffectAud,
    line.expenseEffectAud,
    line.cashEffectAud,
    line.includedCount,
    "",
    "",
    "period_total",
  ]);
  rows.push(
    ...report.categoryLines.map((line) => [
      report.basisLabel,
      report.periodType,
      line.period,
      line.incomeEffectAud,
      line.expenseEffectAud,
      "",
      line.includedCount,
      "",
      line.category,
      "category",
    ]),
  );
  rows.push(
    ...report.warnings.map((warning) => [
      report.basisLabel,
      report.periodType,
      "",
      "",
      "",
      "",
      0,
      `${warning.reference ?? warning.transactionId}: ${warning.reason}`,
      "",
      "warning",
    ]),
  );
  return `${[header, ...rows]
    .map((row) =>
      row
        .map((cell, index) =>
          csvCell(cell, index === 0 || index === 7 || index === 8),
        )
        .join(","),
    )
    .join("\r\n")}\r\n`;
}
