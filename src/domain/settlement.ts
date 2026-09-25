import type { TransactionRecord } from "./types";

export type SettlementState = "pending" | "settled";

export const settlementState = (
  transaction: Pick<
    TransactionRecord,
    "settledAt" | "settlementAmount" | "settlementCurrency"
  >,
): SettlementState =>
  transaction.settledAt &&
  transaction.settlementAmount &&
  transaction.settlementCurrency
    ? "settled"
    : "pending";

export const settlementDisplayState = (
  transaction: Pick<
    TransactionRecord,
    | "sourceSystem"
    | "status"
    | "settledAt"
    | "settlementAmount"
    | "settlementCurrency"
  >,
): SettlementState | null => {
  if (
    transaction.sourceSystem !== "manual" ||
    transaction.status !== "recorded"
  )
    return null;
  return settlementState(transaction);
};
