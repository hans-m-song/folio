import { createHash } from "node:crypto";

import type { FinancialYearBankReviewRow } from "../database/bank-repository";
import type {
  FinancialYearCashLedger,
  FinancialYearCashLedgerRow,
} from "./reports";

export interface TaxSourceReview {
  financialYearStartYear: number;
  financialYear: string;
  timezone: string;
  cashLedger: FinancialYearCashLedger;
  bankRows: FinancialYearBankReviewRow[];
  fingerprint: string;
  legacyFingerprint: string;
  actionRequiredCount: number;
  unresolvedBankCount: number;
  draftCount: number;
  readyForReview: boolean;
}

const relevantCashRows = (
  rows: readonly FinancialYearCashLedgerRow[],
  financialYear: string,
): FinancialYearCashLedgerRow[] =>
  rows.filter((row) => row.period === null || row.period === financialYear);

export const buildTaxSourceReview = (
  ledger: FinancialYearCashLedger,
  bankRows: readonly FinancialYearBankReviewRow[],
): TaxSourceReview => {
  const rows = relevantCashRows(ledger.rows, ledger.financialYear);
  const sortedBankRows = [...bankRows].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const actionRequiredCount = rows.filter(
    (row) => row.disposition === "action_required",
  ).length;
  const unresolvedBankCount = sortedBankRows.filter(
    (row) => row.reviewState === "unresolved",
  ).length;
  const draftCount = rows.filter(
    (row) =>
      row.status === "draft" &&
      (row.period === null || row.period === ledger.financialYear),
  ).length;
  const cashLedger = { ...ledger, rows };
  const legacyCashLedger = {
    ...cashLedger,
    rows: cashLedger.rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(([key]) => key !== "ownerId"),
      ),
    ),
  };
  const fingerprintForVersion = (version: 1 | 2) =>
    createHash("sha256")
      .update(
        JSON.stringify({
          version,
          financialYearStartYear: ledger.financialYearStartYear,
          timezone: ledger.timezone,
          cashLedger: version === 1 ? legacyCashLedger : cashLedger,
          bankRows: sortedBankRows,
        }),
      )
      .digest("hex");
  const fingerprint = fingerprintForVersion(2);
  const legacyFingerprint = fingerprintForVersion(1);

  return {
    financialYearStartYear: ledger.financialYearStartYear,
    financialYear: ledger.financialYear,
    timezone: ledger.timezone,
    cashLedger,
    bankRows: sortedBankRows,
    fingerprint,
    legacyFingerprint,
    actionRequiredCount,
    unresolvedBankCount,
    draftCount,
    readyForReview:
      actionRequiredCount === 0 &&
      unresolvedBankCount === 0 &&
      draftCount === 0,
  };
};
