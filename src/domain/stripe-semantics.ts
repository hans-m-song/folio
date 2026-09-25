import type { TransactionRecord, TransactionSource } from "./types";

export type StripeTransactionKind = TransactionRecord["kind"];

/**
 * Categories whose economic meaning is unambiguous for Folio's preparation
 * vocabulary are mapped to that vocabulary. The remaining provider categories
 * are intentionally retained as adjustments until an operator or accountant
 * classifies them.
 */
export const stripeReportingCategoryKinds = {
  adjustment: "adjustment",
  advance: "adjustment",
  advance_funding: "adjustment",
  anticipation_repayment: "adjustment",
  application_fee: "adjustment",
  application_fee_refund: "adjustment",
  charge: "sale",
  climate_order_purchase: "adjustment",
  climate_order_refund: "adjustment",
  connect_collection_transfer: "transfer",
  contribution: "adjustment",
  issuing_authorization_hold: "adjustment",
  issuing_authorization_release: "adjustment",
  issuing_dispute: "dispute",
  issuing_transaction: "adjustment",
  obligation_outbound: "transfer",
  obligation_reversal_inbound: "transfer",
  payment: "sale",
  payment_intent: "sale",
  payment_failure_refund: "sale_refund",
  payment_network_reserve_hold: "transfer",
  payment_network_reserve_release: "transfer",
  payment_refund: "sale_refund",
  payment_reversal: "sale_refund",
  payment_unreconciled: "adjustment",
  payout: "transfer",
  payout_cancel: "transfer",
  payout_failure: "transfer",
  payout_minimum_balance_hold: "transfer",
  payout_minimum_balance_release: "transfer",
  refund: "sale_refund",
  refund_failure: "sale_refund",
  reserve_hold: "transfer",
  reserve_release: "transfer",
  reserve_transaction: "transfer",
  reserved_funds: "transfer",
  stripe_balance_payment_debit: "adjustment",
  stripe_balance_payment_debit_reversal: "adjustment",
  stripe_fee: "processing_fee",
  stripe_fx_fee: "processing_fee",
  tax_fee: "processing_fee",
  topup: "transfer",
  topup_reversal: "transfer",
  transfer: "transfer",
  transfer_cancel: "transfer",
  transfer_failure: "transfer",
  transfer_refund: "transfer",
  fee: "processing_fee",
  dispute: "dispute",
} as const satisfies Readonly<Record<string, StripeTransactionKind>>;

export interface StripeCategoryClassification {
  reportingCategory: string;
  normalizedCategory: string;
  kind: StripeTransactionKind;
  known: boolean;
  requiresReview: boolean;
}

export const classifyStripeReportingCategory = (
  reportingCategory: string,
): StripeCategoryClassification => {
  const category = reportingCategory.trim();
  const normalizedCategory = category.toLowerCase();
  const kind =
    stripeReportingCategoryKinds[
      normalizedCategory as keyof typeof stripeReportingCategoryKinds
    ];
  const known = kind !== undefined;
  const resolvedKind = kind ?? "adjustment";
  return {
    reportingCategory: category,
    normalizedCategory,
    kind: resolvedKind,
    known,
    requiresReview: resolvedKind === "adjustment",
  };
};

export const stripeDisplaySourceLabel = "Stripe import" as const;

type StripeDescriptionInput =
  | string
  | null
  | undefined
  | { description?: string | null };

export const stripeDisplayDescription = (
  input: StripeDescriptionInput,
): string => {
  const description =
    typeof input === "string" || input == null ? input : input.description;
  return description?.trim() || stripeDisplaySourceLabel;
};

export const stripeDisplaySource = (
  _input?: unknown,
): typeof stripeDisplaySourceLabel => stripeDisplaySourceLabel;

export const transactionDisplaySource = (
  input: TransactionSource | { sourceSystem: TransactionSource },
): string => {
  const sourceSystem = typeof input === "string" ? input : input.sourceSystem;
  return sourceSystem === "stripe" ? stripeDisplaySourceLabel : "Manual entry";
};

export interface StripeBalanceMovement {
  date: string;
  currency: string;
  net: string;
}

type StripeBalanceInput = {
  occurredAt: string | null;
  sourceCurrency: string | null;
  sourceNet: string | null;
  sourceSystem?: TransactionSource;
  status?: TransactionRecord["status"];
};

export const stripeBalanceMovement = (
  transaction: StripeBalanceInput,
): StripeBalanceMovement | undefined => {
  if (
    transaction.sourceSystem !== undefined &&
    transaction.sourceSystem !== "stripe"
  )
    return undefined;
  if (transaction.status !== undefined && transaction.status !== "recorded")
    return undefined;
  if (
    !transaction.occurredAt ||
    !transaction.sourceCurrency ||
    transaction.sourceNet === null
  )
    return undefined;
  return {
    date: transaction.occurredAt,
    currency: transaction.sourceCurrency,
    net: transaction.sourceNet,
  };
};

export const stripeNetBalanceMovement = (
  transaction: StripeBalanceInput,
): string | undefined => stripeBalanceMovement(transaction)?.net;
