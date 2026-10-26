import { z } from "zod";
import { manualCashEffectAudMinor } from "./cash-effect";
import { decimalSchema, formatDecimal, parseDecimal } from "./money";
import type { TransactionKind } from "./types";

export type BankClassification = "private" | "transfer" | "duplicate";
export type BankReviewState = BankClassification | "matched" | "unresolved";
export type BankMatchBasis =
  | "settlement_aud"
  | "invoice_aud"
  | "invoice_foreign_hint";

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
  z.object({
    type: z.literal("match"),
    transactionId: z.string().uuid(),
    confirmSettlement: z.boolean().optional(),
  }),
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

export const parseBankForeignAmountHint = (
  metadata: Record<string, unknown>,
): { currency: string; amount: string } | null => {
  const currency = metadata.foreignCurrency;
  const amount = metadata.foreignAmount;
  if (
    typeof currency !== "string" ||
    !/^[A-Z]{3}$/.test(currency) ||
    currency === "AUD" ||
    typeof amount !== "string"
  )
    return null;

  const parsedAmount = decimalSchema.safeParse(amount);
  if (!parsedAmount.success) return null;
  const amountMinor = parseDecimal(parsedAmount.data);
  if (amountMinor <= 0n) return null;
  return { currency, amount: formatDecimal(amountMinor) };
};

export interface BankMatchTransactionFacts {
  sourceSystem: string;
  status: string;
  kind: string;
  settledAt: string | null;
  settlementCurrency: string | null;
  settlementAmount: string | null;
  documentCurrency: string | null;
  documentAmount: string | null;
  invoiceDate: string | null;
  occurredAt: string | null;
}

const utcDate = (value: string | null): string | null => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? null
    : new Date(timestamp).toISOString().slice(0, 10);
};

export type BankMatchCandidateAssessment =
  | {
      basis: BankMatchBasis;
      candidateDate: string;
      amountAud: string | null;
    }
  | { reason: "settlement_conflict" };

export const assessBankMatchCandidate = (input: {
  bank: {
    amountAud: string;
    postedDate: string;
    metadata: Record<string, unknown>;
  };
  transaction: BankMatchTransactionFacts;
}): BankMatchCandidateAssessment | null => {
  const { bank, transaction } = input;
  if (
    transaction.sourceSystem !== "manual" ||
    transaction.status !== "recorded"
  )
    return null;

  const bankAmount = decimalSchema.safeParse(bank.amountAud);
  if (!bankAmount.success) return null;
  const bankAmountMinor = parseDecimal(bankAmount.data);
  if (bankAmountMinor === 0n) return null;

  const settlementEffect = manualCashEffectAudMinor({
    sourceSystem: transaction.sourceSystem as "manual",
    status: transaction.status as "recorded",
    kind: transaction.kind as TransactionKind,
    settledAt: transaction.settledAt,
    settlementCurrency: transaction.settlementCurrency,
    settlementAmount: transaction.settlementAmount,
  });
  if (settlementEffect !== null && settlementEffect === bankAmountMinor) {
    const candidateDate = utcDate(transaction.settledAt);
    return candidateDate
      ? {
          basis: "settlement_aud",
          candidateDate,
          amountAud: formatDecimal(settlementEffect),
        }
      : null;
  }

  const documentAmount = transaction.documentAmount
    ? decimalSchema.safeParse(transaction.documentAmount)
    : null;
  if (!documentAmount?.success) return null;
  const documentAmountMinor = parseDecimal(documentAmount.data);
  if (documentAmountMinor <= 0n) return null;

  const candidateDate =
    utcDate(transaction.invoiceDate) ?? utcDate(transaction.occurredAt);
  if (!candidateDate) return null;

  let basis: Exclude<BankMatchBasis, "settlement_aud"> | null = null;
  let amountAud: string | null = null;
  if (transaction.documentCurrency === "AUD") {
    const documentEffect = manualCashEffectAudMinor({
      sourceSystem: "manual",
      status: "recorded",
      kind: transaction.kind as TransactionKind,
      settledAt: candidateDate,
      settlementCurrency: "AUD",
      settlementAmount: formatDecimal(documentAmountMinor),
    });
    if (documentEffect !== bankAmountMinor) return null;
    basis = "invoice_aud";
    amountAud = formatDecimal(documentEffect);
  } else {
    const foreignHint = parseBankForeignAmountHint(bank.metadata);
    if (
      !foreignHint ||
      transaction.documentCurrency !== foreignHint.currency ||
      documentAmountMinor !== parseDecimal(foreignHint.amount)
    )
      return null;
    const directionalEffect = manualCashEffectAudMinor({
      sourceSystem: "manual",
      status: "recorded",
      kind: transaction.kind as TransactionKind,
      settledAt: candidateDate,
      settlementCurrency: "AUD",
      settlementAmount: formatDecimal(documentAmountMinor),
    });
    if (
      directionalEffect === null ||
      directionalEffect < 0n !== bankAmountMinor < 0n
    )
      return null;
    basis = "invoice_foreign_hint";
  }

  const settlementDate = utcDate(transaction.settledAt);
  const settlementAmount = transaction.settlementAmount
    ? decimalSchema.safeParse(transaction.settlementAmount)
    : null;
  if (
    (settlementDate !== null && settlementDate !== bank.postedDate) ||
    (transaction.settlementCurrency !== null &&
      transaction.settlementCurrency !== "AUD") ||
    (transaction.settlementAmount !== null &&
      (!settlementAmount?.success ||
        parseDecimal(settlementAmount.data) !==
          (bankAmountMinor < 0n ? -bankAmountMinor : bankAmountMinor)))
  )
    return { reason: "settlement_conflict" };

  return { basis, candidateDate, amountAud };
};

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

export type BankMatchRankInput = {
  bankPostedDate: string;
  bankDescription: string;
  bankCounterparty?: string | null;
  counterparty: string | null;
  reference: string | null;
  description: string | null;
} & (
  | { candidateDate: string; settledAt?: string }
  | { candidateDate?: undefined; settledAt: string }
);

export const rankBankMatchCandidate = (input: BankMatchRankInput) => {
  const candidateDate = input.candidateDate ?? input.settledAt;
  const candidateInstant = /^\d{4}-\d{2}-\d{2}$/.test(candidateDate)
    ? `${candidateDate}T00:00:00Z`
    : candidateDate;
  const day = 86_400_000;
  const dateDistanceDays = Math.abs(
    Math.round(
      (Date.parse(candidateInstant) -
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
