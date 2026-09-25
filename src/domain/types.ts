import { z } from "zod";

import type { ArtifactProfile } from "../artifacts/profiles";
import { nonNegativeDecimalSchema, parseDecimal } from "./money";

export const userRoleSchema = z.enum(["administrator", "member", "viewer"]);
export const transactionStatusSchema = z.enum(["draft", "recorded", "void"]);
export const transactionKindSchema = z.enum([
  "sale",
  "supplier_expense",
  "processing_fee",
  "sale_refund",
  "supplier_credit",
  "dispute",
  "transfer",
  "owner_contribution",
  "owner_loan",
  "adjustment",
]);
export const ownerFundingKinds = ["owner_contribution", "owner_loan"] as const;
export const isOwnerFundingKind = (
  kind: z.infer<typeof transactionKindSchema>,
): boolean =>
  ownerFundingKinds.includes(kind as (typeof ownerFundingKinds)[number]);
export const transactionKindLabels: Record<
  z.infer<typeof transactionKindSchema>,
  string
> = {
  sale: "Sale",
  supplier_expense: "Supplier expense",
  processing_fee: "Processing fee",
  sale_refund: "Sale refund",
  supplier_credit: "Supplier credit",
  dispute: "Dispute",
  transfer: "Transfer",
  owner_contribution: "Owner contribution",
  owner_loan: "Owner loan to business",
  adjustment: "Adjustment",
};
export const transactionTaxTreatmentSchema = z.enum([
  "gst_included",
  "gst_separately_shown",
  "foreign_tax_included",
  "no_tax",
  "unknown_mixed",
]);
export const transactionTaxTreatmentLabels: Record<
  z.infer<typeof transactionTaxTreatmentSchema>,
  string
> = {
  gst_included: "Australian GST included (suggest total ÷ 11)",
  gst_separately_shown: "Australian GST shown separately",
  foreign_tax_included: "Foreign tax included",
  no_tax: "No tax",
  unknown_mixed: "Unknown / mixed",
};
export const gstCreditStatusSchema = z.enum([
  "not_registered",
  "unknown",
  "not_claimable",
  "claimable",
]);
export const currencySchema = z.string().regex(/^[A-Z]{3}$/);
export const expenseCategorySuggestions = [
  "Advertising and marketing",
  "Banking and payment fees",
  "Equipment and tools",
  "Insurance",
  "Office and stationery",
  "Professional services",
  "Software and subscriptions",
  "Travel and accommodation",
  "Utilities",
  "Other operating expense",
] as const;

export interface EntrySuggestions {
  counterparties: string[];
  categories: string[];
  supplierCategories: { counterparty: string; category: string }[];
}

export const transactionInputSchema = z
  .object({
    ownerId: z.string().uuid().nullable().default(null),
    sourceArtifactId: z.string().uuid().nullable().default(null),
    kind: transactionKindSchema,
    reference: z.string().trim().max(200).nullable().default(null),
    counterparty: z.string().trim().max(300).nullable().default(null),
    description: z.string().trim().max(2_000).nullable().default(null),
    status: transactionStatusSchema.default("draft"),
    category: z.string().trim().max(200).nullable().default(null),
    notes: z.string().trim().max(4_000).nullable().default(null),
    occurredAt: z.string().datetime().nullable().default(null),
    availableAt: z.string().datetime().nullable().default(null),
    invoiceDate: z.string().date().nullable().default(null),
    settledAt: z.string().datetime().nullable().default(null),
    documentCurrency: currencySchema.nullable().default(null),
    documentAmount: nonNegativeDecimalSchema.nullable().default(null),
    documentTaxAmount: nonNegativeDecimalSchema.nullable().default(null),
    taxTreatment: transactionTaxTreatmentSchema.default("unknown_mixed"),
    settlementCurrency: currencySchema.nullable().default(null),
    settlementAmount: nonNegativeDecimalSchema.nullable().default(null),
    gstCreditStatus: gstCreditStatusSchema.default("not_registered"),
    claimableGstAud: nonNegativeDecimalSchema.nullable().default("0.0000"),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.gstCreditStatus === "claimable" && !input.sourceArtifactId) {
      context.addIssue({
        code: "custom",
        path: ["sourceArtifactId"],
        message: "Claimable GST requires an available PDF invoice",
      });
    }
    if (
      isOwnerFundingKind(input.kind) &&
      (!input.documentAmount || parseDecimal(input.documentAmount) <= 0n)
    ) {
      context.addIssue({
        code: "custom",
        path: ["documentAmount"],
        message: "Owner contributions and loans require a positive amount",
      });
    }
    if (isOwnerFundingKind(input.kind) && input.taxTreatment !== "no_tax") {
      context.addIssue({
        code: "custom",
        path: ["taxTreatment"],
        message: "Owner contributions and loans must use no tax treatment",
      });
    }
    if (
      isOwnerFundingKind(input.kind) &&
      input.documentTaxAmount &&
      parseDecimal(input.documentTaxAmount) !== 0n
    ) {
      context.addIssue({
        code: "custom",
        path: ["documentTaxAmount"],
        message: "Owner contributions and loans cannot have document tax",
      });
    }
    if (
      isOwnerFundingKind(input.kind) &&
      !["not_claimable", "not_registered"].includes(input.gstCreditStatus)
    ) {
      context.addIssue({
        code: "custom",
        path: ["gstCreditStatus"],
        message:
          "Owner contributions and loans must be not claimable or not registered",
      });
    }
    if (
      isOwnerFundingKind(input.kind) &&
      input.claimableGstAud &&
      parseDecimal(input.claimableGstAud) !== 0n
    ) {
      context.addIssue({
        code: "custom",
        path: ["claimableGstAud"],
        message: "Owner contributions and loans require zero claimable GST",
      });
    }
  });

export type TransactionInput = z.infer<typeof transactionInputSchema>;

export type TransactionSource = "manual" | "stripe";
export const transactionSourceLabels: Record<TransactionSource, string> = {
  manual: "Manual entry",
  stripe: "Stripe import",
};

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  role: z.infer<typeof userRoleSchema>;
  active: boolean;
}

export interface TransactionArtifactRecord {
  id: string;
  artifactProfile: ArtifactProfile;
  filename: string;
  state: "pending" | "available" | "superseded" | "abandoned";
  metadata: Record<string, string | number | boolean | null> | null;
}

export interface TransactionRecord extends Omit<
  TransactionInput,
  "taxTreatment"
> {
  taxTreatment?: z.infer<typeof transactionTaxTreatmentSchema>;
  id: string;
  createdById: string;
  updatedById: string;
  sourceSystem: TransactionSource;
  sourceArtifactFilename?: string | null;
  sourceArtifacts?: readonly TransactionArtifactRecord[];
  sourceGross: string | null;
  sourceFee: string | null;
  sourceNet: string | null;
  sourceCurrency: string | null;
  metadata: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
}
