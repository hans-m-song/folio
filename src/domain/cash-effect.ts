import { formatDecimal, parseDecimal } from "./money";
import type { TransactionRecord } from "./types";

const positiveKinds = new Set<TransactionRecord["kind"]>([
  "sale",
  "supplier_credit",
  "owner_contribution",
  "owner_loan",
]);

const negativeKinds = new Set<TransactionRecord["kind"]>([
  "supplier_expense",
  "processing_fee",
  "sale_refund",
  "owner_loan_repayment",
]);

export type ManualCashEffectInput = Pick<
  TransactionRecord,
  | "sourceSystem"
  | "status"
  | "kind"
  | "settledAt"
  | "settlementCurrency"
  | "settlementAmount"
>;

export const manualCashEffectAudMinor = (
  transaction: ManualCashEffectInput,
): bigint | null => {
  if (
    transaction.sourceSystem !== "manual" ||
    transaction.status !== "recorded" ||
    !transaction.settledAt ||
    transaction.settlementCurrency !== "AUD" ||
    !transaction.settlementAmount
  )
    return null;

  const magnitude = parseDecimal(transaction.settlementAmount);
  if (transaction.kind === "owner_loan_repayment" && magnitude <= 0n)
    return null;
  if (positiveKinds.has(transaction.kind)) return magnitude;
  if (negativeKinds.has(transaction.kind)) return -magnitude;
  return null;
};

export const manualCashEffectAud = (
  transaction: ManualCashEffectInput,
): string | null => {
  const effect = manualCashEffectAudMinor(transaction);
  return effect === null ? null : formatDecimal(effect);
};
