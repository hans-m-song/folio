import type { z } from "zod";

import { formatDecimal, parseDecimal } from "./money";
import {
  isOwnerFundingKind,
  type transactionTaxTreatmentSchema,
} from "./types";

type TaxTreatment = z.infer<typeof transactionTaxTreatmentSchema>;

export const defaultTaxTreatmentForCurrency = (
  currency: string | null,
  ownerFunding = false,
): TaxTreatment => {
  if (ownerFunding) return "no_tax";
  return currency?.toUpperCase() === "AUD"
    ? "gst_included"
    : "foreign_tax_included";
};

export const defaultTaxTreatmentForTransaction = (
  currency: string | null,
  kind: Parameters<typeof isOwnerFundingKind>[0],
): TaxTreatment =>
  defaultTaxTreatmentForCurrency(currency, isOwnerFundingKind(kind));

export const suggestedDocumentTaxAmount = (
  total: string | null,
  currency: string | null,
  treatment: TaxTreatment,
): string | null => {
  if (!total || currency !== "AUD" || treatment !== "gst_included") return null;
  return formatDecimal((parseDecimal(total) + 5n) / 11n);
};
