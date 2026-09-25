import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { TableIconAction } from "../components/table-icon-action";
import { getCurrentSession } from "../auth/session-server";
import type { BalanceSeries } from "../domain/reports";
import { formatAudDecimal, sumDecimals } from "../domain/money";
import { manualCashEffectAud } from "../domain/cash-effect";
import { settlementDisplayState } from "../domain/settlement";
import {
  transactionKindSchema,
  transactionKindLabels,
  transactionStatusSchema,
  transactionSourceLabels,
  type TransactionInput,
  type TransactionRecord,
  type User,
} from "../domain/types";
import {
  downloadArtifact,
  getReport,
  getFolioUiConfig,
  listTransactionPage,
} from "../server/operations";
export { manualSaveFailureDetail } from "./-transaction-workflow";
import "../styles/transactions.css";

const queryComparisonOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
]);

const transactionSearchFilterSchema = z.discriminatedUnion("field", [
  z
    .object({
      field: z.enum(["counterparty", "description"]),
      operator: z.enum(["equals", "not_equals", "contains", "not_contains"]),
      value: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      field: z.literal("date"),
      operator: queryComparisonOperatorSchema,
      value: z.string().date(),
    })
    .strict(),
  z
    .object({
      field: z.literal("amount"),
      operator: queryComparisonOperatorSchema,
      value: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/)
        .refine((value) => Number.isFinite(Number(value))),
    })
    .strict(),
  z
    .object({
      field: z.literal("kind"),
      operator: z.enum(["is", "is_not"]),
      value: transactionKindSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("status"),
      operator: z.enum(["is", "is_not"]),
      value: transactionStatusSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("source"),
      operator: z.enum(["is", "is_not"]),
      value: z.enum(["manual", "stripe"]),
    })
    .strict(),
  z
    .object({
      field: z.literal("settlement"),
      operator: z.enum(["is", "is_not"]),
      value: z.enum(["settled", "pending", "not_applicable"]),
    })
    .strict(),
  z
    .object({
      field: z.literal("evidence"),
      operator: z.enum(["is", "is_not"]),
      value: z.enum(["attached", "missing"]),
    })
    .strict(),
]);

const transactionSortSchema = z
  .object({
    key: z.enum(["date", "counterparty", "amount", "state"]),
    direction: z.enum(["asc", "desc"]),
  })
  .strict();

const transactionSearchSchema = z.object({
  search: z.string().trim().max(200).catch(""),
  filters: z.array(transactionSearchFilterSchema).max(20).catch([]),
  sort: transactionSortSchema.catch({ key: "date", direction: "desc" }),
  page: z.coerce.number().int().min(1).max(2_001).catch(1),
});

export type TransactionSearch = z.infer<typeof transactionSearchSchema>;

export const parseTransactionSearch = (
  search: Record<string, unknown>,
): TransactionSearch => transactionSearchSchema.parse(search);

export const Route = createFileRoute("/transactions")({
  validateSearch: parseTransactionSearch,
  loader: () => getCurrentSession(),
  component: FolioPage,
});

export const transactionStatusFromSubmitter = (
  submitter: unknown,
  fallback: TransactionInput["status"],
): TransactionInput["status"] => {
  if (!submitter || typeof submitter !== "object") return fallback;
  const control = submitter as { name?: unknown; value?: unknown };
  return control.name === "saveStatus" &&
    (control.value === "draft" || control.value === "recorded")
    ? control.value
    : fallback;
};

export const displayUserName = (
  user: Pick<User, "displayName" | "email">,
): string => user.displayName?.trim() || user.email;

export const transactionPageSize = 50;
export const defaultReportingTimezone = "Australia/Brisbane";

export type TransactionFilterField =
  | "date"
  | "counterparty"
  | "description"
  | "kind"
  | "amount"
  | "status"
  | "source"
  | "settlement"
  | "evidence";
export type TransactionFilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "is"
  | "is_not";

export interface TransactionFilterClause {
  id: number;
  field: TransactionFilterField;
  operator: TransactionFilterOperator;
  value: string;
}

export type TransactionSortKey = "date" | "counterparty" | "amount" | "state";

export interface TransactionSort {
  key: TransactionSortKey;
  direction: "asc" | "desc";
}

export const defaultTransactionFilterClauses: TransactionFilterClause[] = [];

export const transactionFilterFieldLabels: Record<
  TransactionFilterField,
  string
> = {
  date: "Date",
  counterparty: "Counterparty",
  description: "Description",
  kind: "Type",
  amount: "Signed amount",
  status: "Status",
  source: "Source",
  settlement: "Settlement",
  evidence: "Evidence",
};

type TransactionFilterValueKind = "text" | "date" | "number" | "enum";

export const transactionFilterValueKinds: Record<
  TransactionFilterField,
  TransactionFilterValueKind
> = {
  date: "date",
  counterparty: "text",
  description: "text",
  kind: "enum",
  amount: "number",
  status: "enum",
  source: "enum",
  settlement: "enum",
  evidence: "enum",
};

export const transactionFilterOperatorOptions: Record<
  TransactionFilterValueKind,
  readonly { value: TransactionFilterOperator; label: string }[]
> = {
  text: [
    { value: "equals", label: "equals" },
    { value: "not_equals", label: "does not equal" },
    { value: "contains", label: "contains" },
    { value: "not_contains", label: "does not contain" },
  ],
  date: [
    { value: "equals", label: "=" },
    { value: "not_equals", label: "≠" },
    { value: "greater_than", label: ">" },
    { value: "greater_than_or_equal", label: "≥" },
    { value: "less_than", label: "<" },
    { value: "less_than_or_equal", label: "≤" },
  ],
  number: [
    { value: "equals", label: "=" },
    { value: "not_equals", label: "≠" },
    { value: "greater_than", label: ">" },
    { value: "greater_than_or_equal", label: "≥" },
    { value: "less_than", label: "<" },
    { value: "less_than_or_equal", label: "≤" },
  ],
  enum: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
  ],
};

export const resetTransactionFilterField = (
  clause: TransactionFilterClause,
  field: TransactionFilterField,
): TransactionFilterClause => ({
  ...clause,
  field,
  operator:
    transactionFilterOperatorOptions[transactionFilterValueKinds[field]][0]
      .value,
  value: "",
});

export const defaultTransactionSort: TransactionSort = {
  key: "date",
  direction: "desc",
};

export const transactionFiltersForPage = (
  clauses: readonly TransactionFilterClause[],
): TransactionSearch["filters"] =>
  clauses.flatMap((clause) => {
    const parsed = transactionSearchFilterSchema.safeParse({
      field: clause.field,
      operator: clause.operator,
      value: clause.value.trim(),
    });
    return parsed.success ? [parsed.data] : [];
  });

export const transactionPageQueryForSearch = (search: TransactionSearch) => ({
  search: search.search,
  filters: search.filters,
  sort: search.sort,
  page: search.page,
});

const transactionDateValue = (
  transaction: Pick<
    TransactionRecord,
    | "sourceSystem"
    | "occurredAt"
    | "availableAt"
    | "invoiceDate"
    | "settledAt"
    | "createdAt"
  >,
): string | null => {
  if (transaction.sourceSystem === "stripe")
    return (
      transaction.occurredAt ??
      transaction.availableAt ??
      transaction.settledAt ??
      transaction.createdAt
    );
  return (
    transaction.invoiceDate ??
    transaction.occurredAt ??
    transaction.settledAt ??
    transaction.createdAt
  );
};

const calendarDateInTimezone = (
  value: string,
  reportingTimezone: string,
): string | null => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-AU", {
      timeZone: reportingTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value;
    const year = part("year");
    const month = part("month");
    const day = part("day");
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
};

export const transactionPeriod = (
  transaction: TransactionRecord,
  reportingTimezone = defaultReportingTimezone,
): string | null => {
  const value = transactionDateValue(transaction);
  if (!value) return null;
  return calendarDateInTimezone(value, reportingTimezone)?.slice(0, 7) ?? null;
};

export const formatTransactionDate = (
  transaction: Pick<
    TransactionRecord,
    | "sourceSystem"
    | "occurredAt"
    | "availableAt"
    | "invoiceDate"
    | "settledAt"
    | "createdAt"
  >,
  reportingTimezone = defaultReportingTimezone,
): string => {
  const value = transactionDateValue(transaction);
  if (!value) return "—";
  const calendarDate = calendarDateInTimezone(value, reportingTimezone);
  if (!calendarDate) return value.slice(0, 10);
  const date = new Date(`${calendarDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
};

export const transactionCounterparty = (
  transaction: Pick<TransactionRecord, "sourceSystem" | "counterparty">,
): string =>
  transaction.counterparty?.trim() ||
  (transaction.sourceSystem === "stripe" ? "Stripe" : "—");

export const transactionDescription = (
  transaction: Pick<TransactionRecord, "description" | "kind">,
): string =>
  transaction.description?.trim() || transactionKindLabels[transaction.kind];

const numericAmount = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const formatSignedAmount = (value: number): string => {
  const absolute = Math.abs(value).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `-${absolute}` : absolute;
};

export const formatAudAmount = (value: string | null | undefined): string => {
  const number = numericAmount(value);
  if (number === null) return "$—";
  if (number === 0) return "$0.00";
  return `${number > 0 ? "+" : "-"}$${formatSignedAmount(Math.abs(number))}`;
};

export const formatOriginalAmount = (
  value: string | null | undefined,
  currency: string | null | undefined,
): string | null => {
  const number = numericAmount(value);
  const code = currency?.trim().toUpperCase();
  if (number === null || !code) return null;
  if (number === 0) return `${code} 0.00`;
  return `${number > 0 ? "+" : "-"}${code} ${formatSignedAmount(Math.abs(number))}`;
};

export interface TransactionAmountDisplay {
  aud: string | null;
  source: string | null;
  detail: string | null;
  sortValue: number | null;
  tone: "positive" | "negative" | "neutral";
}

const signedTransactionAmount = (
  transaction: Pick<TransactionRecord, "kind">,
  value: number | null,
): number | null => {
  if (value === null || value === 0) return value;
  if (
    ["supplier_expense", "processing_fee", "sale_refund", "dispute"].includes(
      transaction.kind,
    )
  )
    return -Math.abs(value);
  if (
    ["sale", "supplier_credit", "owner_contribution", "owner_loan"].includes(
      transaction.kind,
    )
  )
    return Math.abs(value);
  return value;
};

const amountTone = (value: number | null): TransactionAmountDisplay["tone"] =>
  value === null || value === 0
    ? "neutral"
    : value > 0
      ? "positive"
      : "negative";

export const transactionAmountDisplay = (
  transaction: Pick<
    TransactionRecord,
    | "sourceSystem"
    | "sourceNet"
    | "sourceGross"
    | "sourceFee"
    | "sourceCurrency"
    | "documentAmount"
    | "documentCurrency"
    | "settlementAmount"
    | "settlementCurrency"
    | "settledAt"
    | "status"
    | "kind"
  >,
): TransactionAmountDisplay => {
  if (transaction.sourceSystem === "stripe") {
    const sourceValue = transaction.sourceNet ?? transaction.sourceGross;
    const sourceNumber = numericAmount(sourceValue);
    const grossNumber = numericAmount(transaction.sourceGross);
    const feeNumber = numericAmount(transaction.sourceFee);
    const sourceDetail = [
      formatOriginalAmount(
        grossNumber?.toString() ?? null,
        transaction.sourceCurrency,
      ),
      formatOriginalAmount(
        feeNumber === null ? null : (-Math.abs(feeNumber)).toString(),
        transaction.sourceCurrency,
      ),
    ]
      .map((value, index) =>
        value ? `${index === 0 ? "Gross" : "Fee"} ${value}` : null,
      )
      .filter((detail): detail is string => Boolean(detail))
      .join(" · ");
    if (transaction.sourceCurrency === "AUD")
      return {
        aud: sourceNumber?.toString() ?? null,
        source: null,
        detail: sourceDetail || null,
        sortValue: sourceNumber,
        tone: amountTone(sourceNumber),
      };
    const audValue =
      transaction.settlementCurrency === "AUD"
        ? transaction.settlementAmount
        : transaction.documentCurrency === "AUD"
          ? transaction.documentAmount
          : null;
    const signedAud = signedTransactionAmount(
      transaction,
      numericAmount(audValue),
    );
    return {
      aud: signedAud?.toString() ?? null,
      source: formatOriginalAmount(
        sourceNumber?.toString() ?? null,
        transaction.sourceCurrency,
      ),
      detail: sourceDetail || null,
      sortValue: signedAud ?? sourceNumber,
      tone: amountTone(signedAud ?? sourceNumber),
    };
  }

  const canonicalCash = manualCashEffectAud({
    ...transaction,
  });

  const audValue =
    transaction.documentCurrency === "AUD"
      ? transaction.documentAmount
      : transaction.settlementCurrency === "AUD"
        ? transaction.settlementAmount
        : null;
  const originalValue =
    transaction.documentCurrency && transaction.documentCurrency !== "AUD"
      ? transaction.documentAmount
      : transaction.settlementCurrency &&
          transaction.settlementCurrency !== "AUD"
        ? transaction.settlementAmount
        : null;
  const originalCurrency =
    transaction.documentCurrency && transaction.documentCurrency !== "AUD"
      ? transaction.documentCurrency
      : transaction.settlementCurrency &&
          transaction.settlementCurrency !== "AUD"
        ? transaction.settlementCurrency
        : null;
  const signedAud =
    numericAmount(canonicalCash) ??
    signedTransactionAmount(transaction, numericAmount(audValue));
  const signedSource = signedTransactionAmount(
    transaction,
    numericAmount(originalValue),
  );
  return {
    aud: signedAud?.toString() ?? null,
    source: formatOriginalAmount(
      signedSource?.toString() ?? null,
      originalCurrency,
    ),
    detail: null,
    sortValue: signedAud,
    tone: amountTone(signedAud ?? signedSource),
  };
};

export const transactionStateLabel = (
  transaction: Pick<
    TransactionRecord,
    | "status"
    | "sourceSystem"
    | "settledAt"
    | "settlementAmount"
    | "settlementCurrency"
  >,
): string => {
  const status =
    transaction.status[0]!.toUpperCase() + transaction.status.slice(1);
  const settlement = settlementDisplayState(transaction);
  if (settlement === "settled") return `${status} · Settled`;
  if (settlement === "pending") return `${status} · Pending settlement`;
  return status;
};

export const transactionEvidenceLabel = (
  transaction: Pick<
    TransactionRecord,
    "sourceSystem" | "sourceArtifactId" | "sourceArtifacts"
  >,
): string =>
  (transaction.sourceArtifacts?.length ?? 0) > 0 || transaction.sourceArtifactId
    ? transaction.sourceSystem === "manual"
      ? "PDF ✓"
      : "CSV ✓"
    : "Evidence missing";

export const filterTransactions = (
  transactions: readonly TransactionRecord[],
  clauses: readonly TransactionFilterClause[],
  reportingTimezone = defaultReportingTimezone,
): TransactionRecord[] =>
  transactions.filter((transaction) => {
    const settlement = settlementDisplayState(transaction) ?? "not_applicable";
    const evidence =
      (transaction.sourceArtifacts?.length ?? 0) > 0 ||
      transaction.sourceArtifactId
        ? "attached"
        : "missing";
    return clauses.every((clause) => {
      const value = clause.value.trim();
      if (!value) return true;
      const valueKind = transactionFilterValueKinds[clause.field];
      const allowedOperators = transactionFilterOperatorOptions[valueKind];
      if (!allowedOperators.some(({ value }) => value === clause.operator))
        return true;

      if (valueKind === "text") {
        const candidate =
          clause.field === "counterparty"
            ? transactionCounterparty(transaction)
            : transactionDescription(transaction);
        const left = candidate.toLocaleLowerCase("en-AU");
        const right = value.toLocaleLowerCase("en-AU");
        if (clause.operator === "equals") return left === right;
        if (clause.operator === "not_equals") return left !== right;
        if (clause.operator === "contains") return left.includes(right);
        return !left.includes(right);
      }

      if (valueKind === "enum") {
        const candidates = {
          kind: transaction.kind,
          status: transaction.status,
          source: transaction.sourceSystem,
          settlement,
          evidence,
        };
        const candidate = candidates[clause.field as keyof typeof candidates];
        const matches = candidate === value;
        return clause.operator === "is" ? matches : !matches;
      }

      if (valueKind === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
        const parsedValue = new Date(`${value}T00:00:00Z`);
        if (
          Number.isNaN(parsedValue.valueOf()) ||
          parsedValue.toISOString().slice(0, 10) !== value
        )
          return true;
        const sourceDate = transactionDateValue(transaction);
        const candidate = sourceDate
          ? calendarDateInTimezone(sourceDate, reportingTimezone)
          : null;
        if (!candidate) return false;
        if (clause.operator === "equals") return candidate === value;
        if (clause.operator === "not_equals") return candidate !== value;
        if (clause.operator === "greater_than") return candidate > value;
        if (clause.operator === "greater_than_or_equal")
          return candidate >= value;
        if (clause.operator === "less_than") return candidate < value;
        return candidate <= value;
      }

      const expected = Number(value);
      if (!Number.isFinite(expected)) return true;
      const candidate = transactionAmountDisplay(transaction).sortValue;
      if (candidate === null) return false;
      if (clause.operator === "equals") return candidate === expected;
      if (clause.operator === "not_equals") return candidate !== expected;
      if (clause.operator === "greater_than") return candidate > expected;
      if (clause.operator === "greater_than_or_equal")
        return candidate >= expected;
      if (clause.operator === "less_than") return candidate < expected;
      return candidate <= expected;
    });
  });

export const nextTransactionSort = (
  current: TransactionSort,
  key: TransactionSortKey,
): TransactionSort =>
  current.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: "asc" };

const transactionSortText = (
  transaction: TransactionRecord,
  key: TransactionSortKey,
): string => {
  if (key === "counterparty") return transactionCounterparty(transaction);
  if (key === "state") return transactionStateLabel(transaction);
  return transactionDateValue(transaction) ?? "";
};

export const sortTransactions = (
  transactions: readonly TransactionRecord[],
  sort: TransactionSort,
): TransactionRecord[] => {
  const sorted = [...transactions];
  sorted.sort((left, right) => {
    let comparison: number;
    if (sort.key === "amount") {
      const leftAmount = transactionAmountDisplay(left).sortValue;
      const rightAmount = transactionAmountDisplay(right).sortValue;
      if (leftAmount === null && rightAmount !== null) return 1;
      if (leftAmount !== null && rightAmount === null) return -1;
      comparison = (leftAmount ?? 0) - (rightAmount ?? 0);
    } else if (sort.key === "date") {
      const leftDate = transactionDateValue(left);
      const rightDate = transactionDateValue(right);
      if (leftDate === null && rightDate !== null) return 1;
      if (leftDate !== null && rightDate === null) return -1;
      comparison = (leftDate ?? "").localeCompare(rightDate ?? "", "en-AU", {
        numeric: true,
        sensitivity: "base",
      });
    } else {
      comparison = transactionSortText(left, sort.key).localeCompare(
        transactionSortText(right, sort.key),
        "en-AU",
        { numeric: true, sensitivity: "base" },
      );
    }
    if (comparison === 0) comparison = left.id.localeCompare(right.id);
    return sort.direction === "asc" ? comparison : -comparison;
  });
  return sorted;
};

export const paginateTransactions = (
  transactions: readonly TransactionRecord[],
  requestedPage: number,
  pageSize = transactionPageSize,
) => {
  const pageCount = Math.max(1, Math.ceil(transactions.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * pageSize;
  return {
    page,
    pageCount,
    start,
    end: Math.min(start + pageSize, transactions.length),
    items: transactions.slice(start, start + pageSize),
    total: transactions.length,
  };
};

export interface ArtifactTableRow {
  id: string;
  filename: string;
  kind: "pdf" | "stripe_csv";
  source: string;
  transactionCount: number;
  context: string[];
}

export const artifactDownloadLabel = (filename: string): string =>
  `Download ${filename}`;

export const copyText = async (
  value: string,
  writeText: ((value: string) => Promise<void>) | undefined,
): Promise<"copied" | "failed"> => {
  if (!writeText) return "failed";
  try {
    await writeText(value);
    return "copied";
  } catch {
    return "failed";
  }
};

export const deriveArtifactRows = (
  transactions: readonly TransactionRecord[],
): ArtifactTableRow[] => {
  const rows = new Map<string, ArtifactTableRow>();
  for (const transaction of transactions) {
    const linkedArtifacts = transaction.sourceArtifacts?.length
      ? transaction.sourceArtifacts
      : transaction.sourceArtifactId
        ? [
            {
              id: transaction.sourceArtifactId,
              artifactProfile:
                transaction.sourceSystem === "manual"
                  ? "manual_invoice_pdf_v1"
                  : "stripe_balance_itemised_csv_v1",
              filename:
                transaction.sourceArtifactFilename ??
                (transaction.sourceSystem === "manual"
                  ? "Invoice evidence PDF"
                  : "Stripe import CSV"),
              state: "available" as const,
              metadata: null,
            },
          ]
        : [];
    for (const linkedArtifact of linkedArtifacts) {
      const id = linkedArtifact.id;
      const kind =
        linkedArtifact.artifactProfile === "manual_invoice_pdf_v1"
          ? "pdf"
          : "stripe_csv";
      const existing = rows.get(id);
      const context = `${transactionCounterparty(transaction)} · ${transactionDescription(transaction)}`;
      if (existing) {
        existing.transactionCount += 1;
        if (!existing.context.includes(context)) existing.context.push(context);
        continue;
      }
      rows.set(id, {
        id,
        filename: linkedArtifact.filename,
        kind,
        source: transactionSourceLabels[transaction.sourceSystem],
        transactionCount: 1,
        context: [context],
      });
    }
  }
  return [...rows.values()].sort((left, right) => {
    const filename = left.filename.localeCompare(right.filename, "en-AU", {
      sensitivity: "base",
    });
    return filename === 0 ? left.id.localeCompare(right.id) : filename;
  });
};

export interface ActivityChartPoint {
  period: string;
  inflow: string;
  outflow: string;
  net: string;
  includedCount: number;
}

export const buildActivityChartSeries = (
  report: BalanceSeries | null | undefined,
): ActivityChartPoint[] =>
  report?.lines.map((line) => ({
    period: line.period,
    inflow: line.inflowAud,
    outflow: line.outflowAud,
    net: line.netMovementAud,
    includedCount: line.includedCount,
  })) ?? [];

export const summarizeLifetimeMovement = (balance: BalanceSeries) => {
  const firstPeriod = balance.lines[0]?.period ?? null;
  const lastPeriod = balance.lines.at(-1)?.period ?? null;

  return {
    inflowAud: sumDecimals(balance.lines.map((line) => line.inflowAud)),
    outflowAud: sumDecimals(balance.lines.map((line) => line.outflowAud)),
    netMovementAud: sumDecimals(
      balance.lines.map((line) => line.netMovementAud),
    ),
    includedCount: balance.lines.reduce(
      (total, line) => total + line.includedCount,
      0,
    ),
    periodRange:
      firstPeriod && lastPeriod ? { from: firstPeriod, to: lastPeriod } : null,
    warnings: balance.warnings,
  };
};

type LifetimeReportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; balance: BalanceSeries }
  | { status: "error"; message: string };

type TransactionPageState =
  | { status: "idle" }
  | { status: "loading"; queryKey: string }
  | {
      status: "ready";
      queryKey: string;
      result: Awaited<ReturnType<typeof listTransactionPage>>;
    }
  | { status: "error"; queryKey: string; message: string };

const LifetimeMovementSummary = ({
  state,
  onRetry,
}: {
  state: LifetimeReportState;
  onRetry: () => void;
}) => {
  const summary =
    state.status === "ready" ? summarizeLifetimeMovement(state.balance) : null;
  const formatAmount = (value: string) =>
    formatAudDecimal(value).replace(/^\+/, "");

  return (
    <section
      aria-labelledby="lifetime-movement-heading"
      aria-busy={state.status === "loading"}
      className="transaction-lifetime-summary"
    >
      <div className="section-heading">
        <div>
          <h2 id="lifetime-movement-heading">Lifetime cash movement</h2>
          <p>Recorded movement in AUD; this is not an account balance.</p>
        </div>
      </div>
      {state.status === "idle" && (
        <p role="status">Sign in to view lifetime cash movement.</p>
      )}
      {state.status === "loading" && (
        <p role="status" aria-live="polite">
          Loading lifetime cash movement…
        </p>
      )}
      {state.status === "error" && (
        <div className="transaction-lifetime-summary__error">
          <p role="alert">{state.message}</p>
          <button type="button" onClick={onRetry}>
            Retry lifetime summary
          </button>
        </div>
      )}
      {summary && (
        <>
          <dl className="transaction-lifetime-summary__metrics">
            <div>
              <dt>Inflows</dt>
              <dd>{formatAmount(summary.inflowAud)}</dd>
            </div>
            <div>
              <dt>Outflows</dt>
              <dd>{formatAmount(summary.outflowAud)}</dd>
            </div>
            <div>
              <dt>Net movement</dt>
              <dd>{formatAudDecimal(summary.netMovementAud)}</dd>
            </div>
            <div>
              <dt>Included transactions</dt>
              <dd>{summary.includedCount.toLocaleString("en-AU")}</dd>
            </div>
          </dl>
          <p className="transaction-lifetime-summary__coverage">
            <strong>Included movement periods:</strong>{" "}
            {summary.periodRange
              ? summary.periodRange.from === summary.periodRange.to
                ? summary.periodRange.from
                : `${summary.periodRange.from} to ${summary.periodRange.to}`
              : "none"}{" "}
            <span>(month-level coverage)</span>
          </p>
          {summary.warnings.length === 0 ? (
            <p className="transaction-lifetime-summary__warnings">
              No report warnings or excluded rows.
            </p>
          ) : (
            <details className="transaction-lifetime-summary__warnings">
              <summary>
                {summary.warnings.length.toLocaleString("en-AU")} report
                warnings or exclusions
              </summary>
              <ul>
                {summary.warnings.map((warning, index) => (
                  <li key={`${index}-${warning}`}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
};

export interface ActivityChartGeometry {
  maxMagnitude: number;
  top: number;
  bottom: number;
  baseline: number;
  scale: number;
}

export const activityChartBar = (
  geometry: ActivityChartGeometry,
  value: number,
  direction: "inflow" | "outflow",
): { y: number; height: number } => {
  const height = Math.abs(value) * geometry.scale;
  return {
    y: direction === "outflow" ? geometry.baseline : geometry.baseline - height,
    height,
  };
};

export const activityChartGeometry = (
  series: readonly ActivityChartPoint[],
): ActivityChartGeometry => {
  const maxMagnitude = Math.max(
    1,
    ...series.flatMap((point) =>
      [point.inflow, point.outflow, point.net].map((value) =>
        Math.abs(numericAmount(value) ?? 0),
      ),
    ),
  );
  const top = 24;
  const bottom = 206;
  const baseline = (top + bottom) / 2;
  return {
    maxMagnitude,
    top,
    bottom,
    baseline,
    scale: (baseline - top) / maxMagnitude,
  };
};

export const mergeReportWarnings = (
  reportWarnings: readonly string[] | null | undefined,
  balanceWarnings: readonly string[] | null | undefined,
): string[] => [
  ...new Set([...(reportWarnings ?? []), ...(balanceWarnings ?? [])]),
];

const safeClientError = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message.trim() : "";
  if (
    !message ||
    message.length > 180 ||
    /https?:\/\/|@|secret|password|credential|stack/i.test(message)
  )
    return fallback;
  return message;
};

const customSelectValue = "__folio_other__";
interface SelectCustomValue {
  choice: string;
  customValue: string;
}

export const selectCustomValueFor = (
  value: string | null | undefined,
  options: readonly string[],
): SelectCustomValue => {
  const normalized = value?.trim() ?? "";
  if (!normalized) return { choice: "", customValue: "" };
  if (options.includes(normalized))
    return { choice: normalized, customValue: "" };
  return { choice: customSelectValue, customValue: normalized };
};

export const resolveSelectCustomValue = (
  choice: string | null | undefined,
  customValue: string | null | undefined,
): string | null =>
  (choice === customSelectValue ? customValue : choice)?.trim() || null;

export const displaySelectCustomValue = (
  choice: string | null | undefined,
  customValue: string | null | undefined,
): string =>
  choice === customSelectValue ? (customValue ?? "") : (choice ?? "");

function FolioPage() {
  const authentication = Route.useLoaderData();
  const routeSearch = Route.useSearch();
  const navigate = useNavigate({ from: "/transactions" });
  const transactionPageRequestRef = useRef(0);
  const workspaceRequestRef = useRef(0);
  const [transactionPageReloadVersion, setTransactionPageReloadVersion] =
    useState(0);
  const [transactionPageState, setTransactionPageState] =
    useState<TransactionPageState>(() =>
      authentication.authenticated
        ? { status: "loading", queryKey: "" }
        : { status: "idle" },
    );
  const [workspaceStatus, setWorkspaceStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [search, setSearch] = useState(routeSearch.search);
  const [transactionFilters, setTransactionFilters] = useState<
    TransactionFilterClause[]
  >(() =>
    routeSearch.filters.map((filter, index) => ({ ...filter, id: index + 1 })),
  );
  const nextFilterIdRef = useRef(routeSearch.filters.length + 1);
  const lifetimeReportRequestRef = useRef(0);
  const [lifetimeReportState, setLifetimeReportState] =
    useState<LifetimeReportState>(() =>
      authentication.authenticated ? { status: "loading" } : { status: "idle" },
    );
  const [reportingTimezone, setReportingTimezone] = useState(
    defaultReportingTimezone,
  );
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [evidenceDownloadBusy, setEvidenceDownloadBusy] = useState(false);
  const evidenceDownloadInFlightRef = useRef(false);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [workspaceMessage, setWorkspaceMessage] = useState(
    authentication.authenticated
      ? "Loading workspace…"
      : "Sign in to open the workspace.",
  );
  const [evidenceMessage, setEvidenceMessage] = useState("");
  const transactionPageQuery = transactionPageQueryForSearch(routeSearch);
  const transactionPageQueryKey = JSON.stringify(transactionPageQuery);
  const transactionPageResult =
    transactionPageState.status === "ready" &&
    transactionPageState.queryKey === transactionPageQueryKey
      ? transactionPageState.result
      : null;
  const transactionPageData = transactionPageResult
    ? {
        items: transactionPageResult.rows,
        total: transactionPageResult.total,
        page: transactionPageResult.page,
        pageCount: Math.max(
          1,
          Math.ceil(
            transactionPageResult.total / transactionPageResult.pageSize,
          ),
        ),
        start:
          transactionPageResult.total === 0
            ? 0
            : (transactionPageResult.page - 1) * transactionPageResult.pageSize,
        end: Math.min(
          transactionPageResult.page * transactionPageResult.pageSize,
          transactionPageResult.total,
        ),
      }
    : {
        items: [],
        total: 0,
        page: routeSearch.page,
        pageCount: 1,
        start: 0,
        end: 0,
      };
  const transactionPageBusy =
    transactionPageState.status === "loading" ||
    transactionPageState.status === "idle" ||
    ((transactionPageState.status === "ready" ||
      transactionPageState.status === "error") &&
      transactionPageState.queryKey !== transactionPageQueryKey);
  const transactionFilterOptions: Partial<
    Record<TransactionFilterField, readonly { value: string; label: string }[]>
  > = {
    source: Object.entries(transactionSourceLabels).map(([value, label]) => ({
      value,
      label,
    })),
    kind: Object.entries(transactionKindLabels).map(([value, label]) => ({
      value,
      label,
    })),
    status: [
      { value: "draft", label: "Draft" },
      { value: "recorded", label: "Recorded" },
      { value: "void", label: "Void" },
    ],
    settlement: [
      { value: "settled", label: "Settled" },
      { value: "pending", label: "Pending settlement" },
      { value: "not_applicable", label: "Not applicable" },
    ],
    evidence: [
      { value: "attached", label: "Attached" },
      { value: "missing", label: "Missing" },
    ],
  };
  const updateTransactionSearch = (
    updates: Partial<TransactionSearch>,
    replace = false,
  ) => {
    void navigate({
      replace,
      search: (previous) => ({ ...previous, ...updates }),
    });
  };

  const refreshTransactionPage = () => {
    setTransactionPageState({
      status: "loading",
      queryKey: transactionPageQueryKey,
    });
    setTransactionPageReloadVersion((version) => version + 1);
  };

  const loadWorkspaceOptions = async () => {
    const request = ++workspaceRequestRef.current;
    setWorkspaceBusy(true);
    try {
      const uiConfig = await getFolioUiConfig();
      if (request !== workspaceRequestRef.current) return null;
      setReportingTimezone(uiConfig.reportingTimezone);
      setWorkspaceStatus("ready");
      return uiConfig;
    } finally {
      if (request === workspaceRequestRef.current) setWorkspaceBusy(false);
    }
  };

  const loadLifetimeSummary = async () => {
    const request = ++lifetimeReportRequestRef.current;
    setLifetimeReportState({ status: "loading" });
    try {
      const result = await getReport({
        data: { basis: "cash", periodType: "month", format: "json" },
      });
      if (request !== lifetimeReportRequestRef.current) return;
      if (!result.balance)
        throw new Error("Cash movement report returned no balance series.");
      setLifetimeReportState({ status: "ready", balance: result.balance });
    } catch (error) {
      if (request !== lifetimeReportRequestRef.current) return;
      setLifetimeReportState({
        status: "error",
        message: safeClientError(
          error,
          "Lifetime cash movement could not be loaded.",
        ),
      });
    }
  };

  const refreshWorkspace = async () => {
    const request = workspaceRequestRef.current + 1;
    setWorkspaceStatus((current) =>
      current === "ready" ? "ready" : "loading",
    );
    setWorkspaceMessage(
      workspaceStatus === "ready"
        ? "Refreshing workspace options…"
        : "Loading workspace…",
    );
    try {
      const result = await loadWorkspaceOptions();
      if (!result) return;
      setWorkspaceMessage("Workspace options loaded.");
    } catch (error) {
      if (request !== workspaceRequestRef.current) return;
      setWorkspaceStatus((current) =>
        current === "ready" ? "ready" : "error",
      );
      setWorkspaceMessage(
        safeClientError(
          error,
          "Workspace could not be loaded. Open workspace to retry.",
        ),
      );
    }
  };

  useEffect(() => {
    if (authentication.authenticated) {
      void refreshWorkspace();
      void loadLifetimeSummary();
    }
    return () => {
      ++workspaceRequestRef.current;
      ++lifetimeReportRequestRef.current;
      ++transactionPageRequestRef.current;
    };
  }, []);

  useEffect(() => {
    if (!authentication.authenticated) return;
    const request = ++transactionPageRequestRef.current;
    setTransactionPageState({
      status: "loading",
      queryKey: transactionPageQueryKey,
    });
    void listTransactionPage({ data: transactionPageQuery })
      .then((result) => {
        if (request !== transactionPageRequestRef.current) return;
        setTransactionPageState({
          status: "ready",
          queryKey: transactionPageQueryKey,
          result,
        });
        if (result.page !== transactionPageQuery.page)
          void navigate({
            replace: true,
            search: (previous) => ({ ...previous, page: result.page }),
          });
      })
      .catch((error: unknown) => {
        if (request !== transactionPageRequestRef.current) return;
        setTransactionPageState({
          status: "error",
          queryKey: transactionPageQueryKey,
          message: safeClientError(
            error,
            "Transactions could not be loaded. Retry the query.",
          ),
        });
      });
    return () => {
      if (request === transactionPageRequestRef.current)
        ++transactionPageRequestRef.current;
    };
  }, [
    authentication.authenticated,
    navigate,
    transactionPageQueryKey,
    transactionPageReloadVersion,
  ]);

  const appliedFiltersKey = JSON.stringify(routeSearch.filters);
  useEffect(() => {
    setSearch(routeSearch.search);
    const nextFilters = routeSearch.filters.map((filter, index) => ({
      ...filter,
      id: index + 1,
    }));
    setTransactionFilters(nextFilters);
    nextFilterIdRef.current = nextFilters.length + 1;
  }, [appliedFiltersKey, routeSearch.search]);

  const downloadTransactionEvidence = async (
    transaction: TransactionRecord,
  ) => {
    if (!transaction.sourceArtifactId || evidenceDownloadInFlightRef.current)
      return;
    evidenceDownloadInFlightRef.current = true;
    setEvidenceDownloadBusy(true);
    setEvidenceMessage("Preparing evidence download…");
    try {
      const url = await downloadArtifact({
        data: { id: transaction.sourceArtifactId },
      });
      window.location.assign(url);
      setEvidenceMessage("Evidence download opened.");
    } catch (error) {
      setEvidenceMessage(
        safeClientError(error, "Evidence could not be downloaded. Retry."),
      );
    } finally {
      evidenceDownloadInFlightRef.current = false;
      setEvidenceDownloadBusy(false);
    }
  };

  const copyValue = (value: string, label: string) => {
    void copyText(
      value,
      navigator.clipboard?.writeText.bind(navigator.clipboard),
    ).then((result) =>
      setCopyFeedback(
        result === "copied"
          ? `${label} copied.`
          : `${label} could not be copied. Select and copy it manually.`,
      ),
    );
  };

  return (
    <main>
      <header>
        <p className="eyebrow">Transactions</p>
        <h1>Transactions</h1>
        <p>
          Review and manage recorded transactions, manual entries, and Stripe
          imports.
        </p>
      </header>
      <section
        aria-labelledby="workspace-heading"
        aria-busy={workspaceStatus === "loading" || workspaceBusy}
      >
        <h2 id="workspace-heading">Workspace</h2>
        <p role="status" aria-live="polite">
          {workspaceMessage}
        </p>
        {authentication.authenticated && workspaceStatus === "error" && (
          <button
            disabled={workspaceBusy}
            onClick={() => void refreshWorkspace()}
          >
            Retry workspace
          </button>
        )}
        {!authentication.authenticated && (
          <p>
            <a href="/auth/login?return_to=%2Ftransactions">Sign in</a>
          </p>
        )}
      </section>

      <LifetimeMovementSummary
        state={lifetimeReportState}
        onRetry={() => void loadLifetimeSummary()}
      />

      {workspaceStatus === "ready" && (
        <div>
          <section
            aria-labelledby="transactions-heading"
            aria-busy={transactionPageBusy}
          >
            <div className="section-heading">
              <h2 id="transactions-heading">Transactions</h2>
              <div className="actions transaction-entry-actions">
                <a className="transaction-button-link" href="/transactions/new">
                  New transaction
                </a>
                <a
                  className="transaction-button-link transaction-button-link--secondary"
                  href="/imports/stripe"
                >
                  Import Stripe CSV
                </a>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  updateTransactionSearch({
                    search: search.trim().slice(0, 200),
                    page: 1,
                  });
                }}
                className="row"
              >
                <label htmlFor="transaction-search">
                  Search
                  <input
                    id="transaction-search"
                    value={search}
                    maxLength={200}
                    onChange={(event) => {
                      setSearch(event.target.value);
                    }}
                  />
                </label>
                <button disabled={transactionPageBusy}>Search</button>
              </form>
            </div>
            {evidenceMessage && (
              <p role="status" aria-live="polite">
                {evidenceMessage}
              </p>
            )}
            {routeSearch.search && (
              <p className="table-filter-state" role="status">
                Filtered transactions for “{routeSearch.search}”.
              </p>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                updateTransactionSearch({
                  filters: transactionFiltersForPage(transactionFilters),
                  page: 1,
                });
              }}
            >
              <div className="filter-builder" aria-label="Transaction filters">
                <div className="filter-builder-heading">
                  <span>Match all clauses</span>
                  <button
                    type="button"
                    className="secondary compact-button"
                    disabled={transactionFilters.length >= 20}
                    onClick={() =>
                      setTransactionFilters((current) => [
                        ...current,
                        {
                          id: nextFilterIdRef.current++,
                          field: "counterparty",
                          operator: "contains",
                          value: "",
                        },
                      ])
                    }
                  >
                    Add filter
                  </button>
                </div>
                {transactionFilters.length === 0 ? (
                  <p className="field-help">No filters applied.</p>
                ) : (
                  transactionFilters.map((clause) => (
                    <div className="filter-clause" key={clause.id}>
                      <label>
                        <span className="sr-only">Filter field</span>
                        <select
                          aria-label="Filter field"
                          value={clause.field}
                          onChange={(event) => {
                            const field = event.currentTarget
                              .value as TransactionFilterField;
                            setTransactionFilters((current) =>
                              current.map((item) =>
                                item.id === clause.id
                                  ? resetTransactionFilterField(item, field)
                                  : item,
                              ),
                            );
                          }}
                        >
                          {Object.entries(transactionFilterFieldLabels).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        <span className="sr-only">Filter operator</span>
                        <select
                          aria-label="Filter operator"
                          value={clause.operator}
                          onChange={(event) => {
                            const operator = event.currentTarget
                              .value as TransactionFilterOperator;
                            setTransactionFilters((current) =>
                              current.map((item) =>
                                item.id === clause.id
                                  ? { ...item, operator }
                                  : item,
                              ),
                            );
                          }}
                        >
                          {transactionFilterOperatorOptions[
                            transactionFilterValueKinds[clause.field]
                          ].map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="sr-only">Filter value</span>
                        {transactionFilterValueKinds[clause.field] ===
                        "enum" ? (
                          <select
                            aria-label={`${transactionFilterFieldLabels[clause.field]} filter value`}
                            value={clause.value}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setTransactionFilters((current) =>
                                current.map((item) =>
                                  item.id === clause.id
                                    ? { ...item, value }
                                    : item,
                                ),
                              );
                            }}
                          >
                            <option value="">Choose a value</option>
                            {(transactionFilterOptions[clause.field] ?? []).map(
                              (option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ),
                            )}
                          </select>
                        ) : (
                          <input
                            aria-label={`${transactionFilterFieldLabels[clause.field]} filter value`}
                            type={transactionFilterValueKinds[clause.field]}
                            step={
                              transactionFilterValueKinds[clause.field] ===
                              "number"
                                ? "any"
                                : undefined
                            }
                            value={clause.value}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setTransactionFilters((current) =>
                                current.map((item) =>
                                  item.id === clause.id
                                    ? { ...item, value }
                                    : item,
                                ),
                              );
                            }}
                          />
                        )}
                      </label>
                      <button
                        type="button"
                        className="link danger compact-button"
                        aria-label={`Remove ${transactionFilterFieldLabels[clause.field]} filter`}
                        title={`Remove ${transactionFilterFieldLabels[clause.field]} filter`}
                        onClick={() => {
                          setTransactionFilters((current) =>
                            current.filter((item) => item.id !== clause.id),
                          );
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="actions">
                <button type="submit">Apply filters</button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setTransactionFilters([]);
                    updateTransactionSearch({ filters: [], page: 1 });
                  }}
                >
                  Reset filters
                </button>
              </div>
            </form>
            {transactionPageState.status === "error" &&
              transactionPageState.queryKey === transactionPageQueryKey && (
                <div className="transaction-query-error">
                  <p role="alert">{transactionPageState.message}</p>
                  <button
                    type="button"
                    onClick={() => refreshTransactionPage()}
                  >
                    Retry transactions
                  </button>
                </div>
              )}
            {transactionPageBusy && (
              <p role="status" aria-live="polite">
                Loading transactions…
              </p>
            )}
            {copyFeedback && (
              <p className="copy-feedback" role="status" aria-live="polite">
                {copyFeedback}
              </p>
            )}
            <div className="mobile-sort" aria-label="Transaction sorting">
              <label>
                Sort by
                <select
                  value={routeSearch.sort.key}
                  onChange={(event) => {
                    updateTransactionSearch({
                      sort: {
                        key: event.currentTarget.value as TransactionSortKey,
                        direction: "asc",
                      },
                      page: 1,
                    });
                  }}
                >
                  <option value="date">Date</option>
                  <option value="counterparty">Counterparty</option>
                  <option value="amount">Amount</option>
                  <option value="state">State</option>
                </select>
              </label>
              <label>
                Direction
                <select
                  value={routeSearch.sort.direction}
                  onChange={(event) => {
                    updateTransactionSearch({
                      sort: {
                        ...routeSearch.sort,
                        direction: event.currentTarget
                          .value as TransactionSort["direction"],
                      },
                      page: 1,
                    });
                  }}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </label>
            </div>
            <div className="table-wrap">
              <table className="transaction-table">
                <thead>
                  <tr>
                    {(
                      [
                        ["date", "Date"],
                        ["counterparty", "Counterparty"],
                      ] as const
                    ).map(([key, label]) => (
                      <th
                        scope="col"
                        key={key}
                        aria-sort={
                          routeSearch.sort.key === key
                            ? routeSearch.sort.direction === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          type="button"
                          className="sort-button"
                          onClick={() => {
                            updateTransactionSearch({
                              sort: nextTransactionSort(routeSearch.sort, key),
                              page: 1,
                            });
                          }}
                        >
                          {label}
                          {routeSearch.sort.key === key
                            ? routeSearch.sort.direction === "asc"
                              ? " ↑"
                              : " ↓"
                            : ""}
                        </button>
                      </th>
                    ))}
                    <th scope="col">Description</th>
                    <th scope="col">Type</th>
                    {(
                      [
                        ["amount", "Amount"],
                        ["state", "State"],
                      ] as const
                    ).map(([key, label]) => (
                      <th
                        scope="col"
                        key={key}
                        aria-sort={
                          routeSearch.sort.key === key
                            ? routeSearch.sort.direction === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          type="button"
                          className="sort-button"
                          onClick={() => {
                            updateTransactionSearch({
                              sort: nextTransactionSort(routeSearch.sort, key),
                              page: 1,
                            });
                          }}
                        >
                          {label}
                          {routeSearch.sort.key === key
                            ? routeSearch.sort.direction === "asc"
                              ? " ↑"
                              : " ↓"
                            : ""}
                        </button>
                      </th>
                    ))}
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transactionPageData.items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="table-empty" role="status">
                        {transactionPageBusy
                          ? "Loading transactions…"
                          : transactionPageState.status === "error" &&
                              transactionPageState.queryKey ===
                                transactionPageQueryKey
                            ? "Transactions could not be loaded."
                            : routeSearch.search ||
                                routeSearch.filters.length > 0
                              ? "No transactions match the current query."
                              : transactionPageData.total > 0
                                ? "No transactions are available on this page."
                                : "No transactions recorded yet."}
                      </td>
                    </tr>
                  ) : (
                    transactionPageData.items.map((item) => {
                      const amount = transactionAmountDisplay(item);
                      const evidenceLabel = transactionEvidenceLabel(item);
                      return (
                        <tr key={item.id}>
                          <td data-label="Date">
                            {formatTransactionDate(item, reportingTimezone)}
                          </td>
                          <td data-label="Counterparty">
                            {transactionCounterparty(item)}
                          </td>
                          <td data-label="Description">
                            {transactionDescription(item)}
                          </td>
                          <td data-label="Type">
                            {transactionKindLabels[item.kind]}
                          </td>
                          <td data-label="Amount" className="amount-cell">
                            <span
                              className={`amount-primary amount-${amount.tone}`}
                            >
                              {formatAudAmount(amount.aud)}
                            </span>
                            {amount.source && <small>{amount.source}</small>}
                            {amount.detail && <small>{amount.detail}</small>}
                          </td>
                          <td data-label="State">
                            <span className="state-cell-label">
                              {transactionStateLabel(item)}
                            </span>
                            {item.sourceArtifactId ? (
                              <button
                                type="button"
                                className="link evidence-action"
                                aria-label={`Download ${evidenceLabel} evidence for ${transactionDescription(item)}`}
                                disabled={evidenceDownloadBusy}
                                onClick={() =>
                                  downloadTransactionEvidence(item)
                                }
                              >
                                {evidenceLabel}
                              </button>
                            ) : (
                              <small className="missing-evidence">
                                {evidenceLabel}
                              </small>
                            )}
                          </td>
                          <td data-label="Actions">
                            <div className="table-actions transaction-table-actions">
                              <TableIconAction
                                icon="view"
                                label="View"
                                accessibleLabel={`View transaction: ${transactionDescription(item)}`}
                                tooltip="View transaction"
                                className="transaction-table-action"
                                href={`/transactions/${item.id}`}
                              />
                              {item.sourceSystem === "manual" && (
                                <TableIconAction
                                  icon="edit"
                                  label="Edit"
                                  accessibleLabel={`Edit transaction: ${transactionDescription(item)}`}
                                  tooltip="Edit transaction"
                                  className="transaction-table-action"
                                  href={`/transactions/${item.id}/edit`}
                                />
                              )}
                              {item.reference && (
                                <TableIconAction
                                  icon="copy"
                                  label="Copy reference"
                                  accessibleLabel={`Copy transaction reference: ${item.reference}`}
                                  tooltip="Copy reference"
                                  className="transaction-table-action"
                                  onClick={() =>
                                    copyValue(item.reference!, "Reference")
                                  }
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {transactionPageData.total > 0 && (
              <nav className="pagination" aria-label="Transaction pages">
                <p role="status">
                  Showing {transactionPageData.start + 1}–
                  {transactionPageData.end} of {transactionPageData.total}; page{" "}
                  {transactionPageData.page} of {transactionPageData.pageCount}.
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={transactionPageData.page <= 1}
                    onClick={() =>
                      updateTransactionSearch({
                        page: Math.max(1, transactionPageData.page - 1),
                      })
                    }
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={
                      transactionPageData.page >= transactionPageData.pageCount
                    }
                    onClick={() =>
                      updateTransactionSearch({
                        page: Math.min(
                          transactionPageData.pageCount,
                          transactionPageData.page + 1,
                        ),
                      })
                    }
                  >
                    Next
                  </button>
                </div>
              </nav>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
