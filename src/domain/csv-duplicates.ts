import type { ParsedBankTransaction } from "./bank-transactions";
import type { StripeImportRow } from "./stripe-csv";

export const csvDuplicateRowLimit = 5_000;

export type CsvDuplicateProfile =
  | "stripe_balance_itemised_csv_v1"
  | "commbank_transaction_history_csv_v1";

export type CsvDuplicateRowIdentity =
  | { kind: "stripe_reference"; reference: string }
  | {
      kind: "commbank_row";
      rowIndex: number;
      postedDate: string;
      amountAud: string;
      description: string;
      runningBalance: string;
    };

export interface CsvDuplicateIdentitySet {
  rowCount: number;
  rowIdentityLimitReached: boolean;
  identities: CsvDuplicateRowIdentity[];
}

export const stripeDuplicateIdentities = (
  rows: readonly StripeImportRow[],
): CsvDuplicateIdentitySet => ({
  rowCount: rows.length,
  rowIdentityLimitReached: rows.length > csvDuplicateRowLimit,
  identities: rows.slice(0, csvDuplicateRowLimit).map((row) => ({
    kind: "stripe_reference",
    reference: row.reference,
  })),
});

export const commBankDuplicateIdentities = (
  rows: readonly ParsedBankTransaction[],
): CsvDuplicateIdentitySet => ({
  rowCount: rows.length,
  rowIdentityLimitReached: rows.length > csvDuplicateRowLimit,
  identities: rows.slice(0, csvDuplicateRowLimit).map((row, rowIndex) => ({
    kind: "commbank_row",
    rowIndex,
    postedDate: row.postedDate,
    amountAud: row.amountAud,
    description: row.description,
    runningBalance: row.metadata.runningBalance,
  })),
});
