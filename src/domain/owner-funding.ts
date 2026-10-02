import { formatDecimal, parseDecimal } from "./money";
import type {
  FinancialYearCashLedger,
  FinancialYearCashLedgerRow,
} from "./reports";

type OwnerFundingKind =
  | "owner_loan"
  | "owner_loan_repayment"
  | "owner_contribution";

export interface OwnerFundingSummaryOwner {
  ownerId: string | null;
  loansAdvancedAud: string;
  principalRepaidAud: string;
  loanBalanceAud: string;
  otherContributionsAud: string;
  transactionIds: string[];
}

export interface OwnerFundingSummaryIssue {
  transactionId: string;
  ownerId: string | null;
  reason: string;
}

export interface OwnerFundingSummary {
  financialYear: string;
  financialYearStartYear: number;
  timezone: string;
  owners: OwnerFundingSummaryOwner[];
  issues: OwnerFundingSummaryIssue[];
  rows: FinancialYearCashLedgerRow[];
}

const fundingKinds = new Set<string>([
  "owner_loan",
  "owner_loan_repayment",
  "owner_contribution",
]);

const isFundingKind = (kind: string): kind is OwnerFundingKind =>
  fundingKinds.has(kind);

const periodStartYear = (period: string | null): number | null => {
  const match = period?.match(/^FY(\d{4})-\d{2}$/);
  return match ? Number(match[1]) : null;
};

const transactionOrder = (
  left: FinancialYearCashLedgerRow,
  right: FinancialYearCashLedgerRow,
) =>
  (left.cashDate ?? "").localeCompare(right.cashDate ?? "") ||
  left.transactionId.localeCompare(right.transactionId);

const issueOrder = (
  left: OwnerFundingSummaryIssue,
  right: OwnerFundingSummaryIssue,
) =>
  left.transactionId.localeCompare(right.transactionId) ||
  left.reason.localeCompare(right.reason);

const reasonsForUnusableFacts = (row: FinancialYearCashLedgerRow): string[] => {
  const reasons: string[] = [...row.issues];
  if (!row.cashDate) reasons.push("missing_settlement_date");
  if (periodStartYear(row.period) === null)
    reasons.push("missing_financial_year_period");
  if (row.sourceSystem !== "manual") reasons.push("unsupported_source_system");
  if (
    row.disposition === "action_required" ||
    row.cashEffectAud === null ||
    row.disposition === "expected_exclusion"
  )
    reasons.push("missing_cash_facts");
  return [...new Set(reasons)];
};

const isThroughFinancialYearEnd = (
  row: FinancialYearCashLedgerRow,
  financialYearStartYear: number,
) => {
  const startYear = periodStartYear(row.period);
  return startYear === null || startYear <= financialYearStartYear;
};

const eligibleRecordedRows = (
  ledger: FinancialYearCashLedger,
): FinancialYearCashLedgerRow[] =>
  ledger.rows
    .filter(
      (row) =>
        isFundingKind(row.kind) &&
        row.status === "recorded" &&
        isThroughFinancialYearEnd(row, ledger.financialYearStartYear),
    )
    .sort(transactionOrder);

export const buildOwnerFundingSummary = (
  ledger: FinancialYearCashLedger,
): OwnerFundingSummary => {
  const rows = eligibleRecordedRows(ledger);
  const issues: OwnerFundingSummaryIssue[] = [];
  const ownerTotals = new Map<
    string | null,
    {
      loansAdvanced: bigint;
      principalRepaid: bigint;
      otherContributions: bigint;
      transactionIds: string[];
      repaymentRows: FinancialYearCashLedgerRow[];
    }
  >();

  for (const row of rows) {
    if (row.ownerId == null) {
      issues.push({
        transactionId: row.transactionId,
        ownerId: null,
        reason: "unassigned_owner",
      });
    }

    const factReasons = reasonsForUnusableFacts(row);
    if (factReasons.length > 0) {
      for (const reason of factReasons) {
        issues.push({
          transactionId: row.transactionId,
          ownerId: row.ownerId ?? null,
          reason,
        });
      }
      continue;
    }

    const signedAmount = parseDecimal(row.cashEffectAud!);
    const amount = signedAmount < 0n ? -signedAmount : signedAmount;
    const expectedNegative = row.kind === "owner_loan_repayment";
    if (
      (expectedNegative && signedAmount > 0n) ||
      (!expectedNegative && signedAmount < 0n)
    ) {
      issues.push({
        transactionId: row.transactionId,
        ownerId: row.ownerId ?? null,
        reason: "unexpected_cash_direction",
      });
      continue;
    }

    const ownerId = row.ownerId ?? null;
    const totals = ownerTotals.get(ownerId) ?? {
      loansAdvanced: 0n,
      principalRepaid: 0n,
      otherContributions: 0n,
      transactionIds: [],
      repaymentRows: [],
    };
    if (row.kind === "owner_loan") {
      totals.loansAdvanced += amount;
    } else if (row.kind === "owner_loan_repayment") {
      totals.principalRepaid += amount;
      totals.repaymentRows.push(row);
    } else {
      totals.otherContributions += amount;
    }
    totals.transactionIds.push(row.transactionId);
    ownerTotals.set(ownerId, totals);
  }

  const owners = [...ownerTotals.entries()]
    .map(([ownerId, totals]): OwnerFundingSummaryOwner => {
      const loanBalance = totals.loansAdvanced - totals.principalRepaid;
      const repaymentSource =
        totals.repaymentRows[totals.repaymentRows.length - 1];
      if (loanBalance < 0n && repaymentSource) {
        issues.push({
          transactionId: repaymentSource.transactionId,
          ownerId,
          reason: "negative_loan_balance",
        });
      }

      return {
        ownerId,
        loansAdvancedAud: formatDecimal(totals.loansAdvanced),
        principalRepaidAud: formatDecimal(totals.principalRepaid),
        loanBalanceAud: formatDecimal(loanBalance),
        otherContributionsAud: formatDecimal(totals.otherContributions),
        transactionIds: totals.transactionIds,
      };
    })
    .sort((left, right) =>
      (left.ownerId ?? "").localeCompare(right.ownerId ?? ""),
    );

  return {
    financialYear: ledger.financialYear,
    financialYearStartYear: ledger.financialYearStartYear,
    timezone: ledger.timezone,
    owners,
    issues: issues.sort(issueOrder),
    rows,
  };
};
