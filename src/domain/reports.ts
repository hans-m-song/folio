import { formatDecimal, parseDecimal } from "./money";
import { manualCashEffectAudMinor } from "./cash-effect";
import {
  classifyStripeReportingCategory,
  stripeBalanceMovement,
} from "./stripe-semantics";
import type { TransactionRecord } from "./types";

export type ReportBasis = "activity" | "cash";
export type PeriodType = "month" | "bas_quarter" | "financial_year";

export interface ReportLine {
  period: string;
  incomeEffectAud: string;
  expenseEffectAud: string;
  cashEffectAud: string;
  includedCount: number;
}

export interface ReportEnvelope {
  basis: ReportBasis;
  basisLabel: string;
  periodType: PeriodType;
  includedCountLabel: "included transaction rows";
  lines: ReportLine[];
  warnings: string[];
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
  if (["owner_contribution", "owner_loan"].includes(transaction.kind)) {
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
  const globalWarnings: string[] = [];
  for (const transaction of [...transactions].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const effect = effects(transaction, basis);
    if (effect === null) {
      globalWarnings.push(
        `${transaction.reference ?? transaction.id}: excluded ${transaction.status === "recorded" ? transaction.kind : transaction.status}`,
      );
      continue;
    }
    if (effect === undefined) {
      if (basis === "cash" && !transaction.settledAt) {
        globalWarnings.push(
          `${transaction.reference ?? transaction.id}: pending settlement`,
        );
        continue;
      }
      globalWarnings.push(
        `${transaction.reference ?? transaction.id}: missing ${basis} date or explicit AUD value`,
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
  return {
    basis,
    basisLabel:
      basis === "activity"
        ? "Activity-basis preparation view"
        : "Cash-basis preparation view",
    periodType,
    includedCountLabel: "included transaction rows",
    lines,
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
  ]);
  rows.push(
    ...report.warnings.map((warning) => [
      report.basisLabel,
      report.periodType,
      "",
      "",
      "",
      "",
      0,
      warning,
    ]),
  );
  return `${[header, ...rows]
    .map((row) =>
      row
        .map((cell, index) => csvCell(cell, index === 0 || index === 7))
        .join(","),
    )
    .join("\r\n")}\r\n`;
}
