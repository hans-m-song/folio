import { z } from "zod";

export type BankClassification = "private" | "transfer" | "duplicate";
export type BankReviewState = BankClassification | "matched" | "unresolved";

export interface ParsedBankTransaction {
  sourceRow: number;
  postedDate: string;
  amountAud: string;
  description: string;
  metadata: {
    sourceRow: number;
    postedDate: string;
    amountAud: string;
    description: string;
    runningBalance: string;
    valueDate?: string;
    foreignCurrency?: string;
    foreignAmount?: string;
    counterpartySuggestion?: string;
    cardSuffix?: string;
  };
}

export interface BankCsvIssue {
  row: number;
  field: "row" | "postedDate" | "amountAud" | "description" | "runningBalance";
  code:
    | "malformed_csv"
    | "empty_csv"
    | "wrong_column_count"
    | "invalid_date"
    | "invalid_amount";
  message: string;
}

export interface BankCsvPreview {
  rows: ParsedBankTransaction[];
  errors: BankCsvIssue[];
  earliestDate: string | null;
  latestDate: string | null;
}

export const bankReviewState = (value: {
  matchedTransactionId: string | null;
  classification: BankClassification | null;
}): BankReviewState =>
  value.matchedTransactionId
    ? "matched"
    : (value.classification ?? "unresolved");

export const bankReconciliationCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("match"), transactionId: z.string().uuid() }),
  z.object({
    type: z.literal("classify"),
    classification: z.enum(["private", "transfer", "duplicate"]),
  }),
  z.object({ type: z.literal("reset") }),
]);

export type BankReconciliationCommand = z.infer<
  typeof bankReconciliationCommandSchema
>;

export const normaliseBankMatchText = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFKD")
    .toLocaleLowerCase("en-AU")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const textOverlap = (left: string, right: string): number => {
  const leftTokens = new Set(
    normaliseBankMatchText(left).split(" ").filter(Boolean),
  );
  const rightTokens = new Set(
    normaliseBankMatchText(right).split(" ").filter(Boolean),
  );
  let score = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) score += 1;
  return score;
};

export const rankBankMatchCandidate = (input: {
  bankPostedDate: string;
  bankDescription: string;
  bankCounterparty?: string | null;
  settledAt: string;
  counterparty: string | null;
  reference: string | null;
  description: string | null;
}) => {
  const day = 86_400_000;
  const dateDistanceDays = Math.abs(
    Math.round(
      (Date.parse(input.settledAt) -
        Date.parse(`${input.bankPostedDate}T00:00:00Z`)) /
        day,
    ),
  );
  const bankText = [input.bankDescription, input.bankCounterparty]
    .filter(Boolean)
    .join(" ");
  return {
    dateDistanceDays,
    textScore:
      textOverlap(bankText, input.counterparty ?? "") * 4 +
      textOverlap(bankText, input.reference ?? "") * 3 +
      textOverlap(bankText, input.description ?? ""),
  };
};
