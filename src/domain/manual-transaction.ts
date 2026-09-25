import { z } from "zod";

import { nonNegativeDecimalSchema } from "./money";
import { suggestedDocumentTaxAmount } from "./tax";
import {
  gstCreditStatusSchema,
  isOwnerFundingKind,
  transactionKindSchema,
  transactionInputSchema,
  transactionTaxTreatmentSchema,
  type TransactionInput,
} from "./types";
import { dateToUtcMidnight } from "./workflow";

export const manualTransactionActionSchema = z.enum([
  "save_draft",
  "save_recorded",
  "save_void",
  "restore_draft",
  "restore_recorded",
]);

export type ManualTransactionAction = z.infer<
  typeof manualTransactionActionSchema
>;

export const manualTransactionInputSchema = transactionInputSchema.superRefine(
  (input, context) => {
    if (!input.ownerId)
      context.addIssue({
        code: "custom",
        path: ["ownerId"],
        message: "Choose an owner",
      });
    if (
      input.documentAmount &&
      nonNegativeDecimalSchema.safeParse(input.documentAmount).success &&
      !input.documentCurrency
    )
      context.addIssue({
        code: "custom",
        path: ["documentCurrency"],
        message: "Choose a document currency",
      });
    if (
      input.settlementAmount &&
      nonNegativeDecimalSchema.safeParse(input.settlementAmount).success &&
      !input.settlementCurrency
    )
      context.addIssue({
        code: "custom",
        path: ["settlementCurrency"],
        message: "Choose a settlement currency",
      });
  },
);

export const manualTransactionSavePayloadSchema = z
  .object({
    id: z.string().uuid().nullable(),
    expectedUpdatedAt: z.string().datetime().nullable(),
    action: manualTransactionActionSchema,
    transaction: manualTransactionInputSchema,
    artifactIds: z.array(z.string().uuid()).max(100).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.transaction.status !== statusForManualAction(input.action))
      context.addIssue({
        code: "custom",
        path: ["transaction", "status"],
        message: "Save action does not match transaction status",
      });
    if (
      input.id === null &&
      ["save_void", "restore_draft", "restore_recorded"].includes(input.action)
    )
      context.addIssue({
        code: "custom",
        path: ["action"],
        message: "New transactions can only be saved as draft or recorded",
      });
  });

export interface ManualTransactionValues {
  artifact: string;
  ownerId: string;
  kind: TransactionInput["kind"];
  counterparty: string;
  reference: string;
  invoiceDate: string;
  documentAmount: string;
  documentCurrency: string;
  description: string;
  settledAt: string;
  settlementCurrency: string;
  settlementAmount: string;
  taxTreatment: TransactionInput["taxTreatment"];
  documentTaxAmount: string;
  category: string;
  gstCreditStatus: TransactionInput["gstCreditStatus"];
  claimableGstAud: string;
  occurredAt: string;
  notes: string;
}

const optionalEditingValueSchema = (schema: z.ZodTypeAny) =>
  z.string().superRefine((value, context) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const result = schema.safeParse(trimmed);
    if (result.success) return;
    for (const issue of result.error.issues)
      context.addIssue({ code: "custom", message: issue.message });
  });

const requiredEditingValueSchema = (message: string) =>
  z.string().refine((value) => Boolean(value.trim()), message);

const editingCurrencySchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/, "Expected a three-letter currency code");

export const manualTransactionEditingFieldSchemas = {
  artifact: z.string(),
  ownerId: requiredEditingValueSchema("Choose an owner"),
  kind: transactionKindSchema,
  counterparty: z.string().trim().max(300),
  reference: z.string().trim().max(200),
  invoiceDate: optionalEditingValueSchema(z.string().date()),
  documentAmount: optionalEditingValueSchema(nonNegativeDecimalSchema),
  documentCurrency: optionalEditingValueSchema(editingCurrencySchema),
  description: z.string().trim().max(2_000),
  settledAt: optionalEditingValueSchema(z.string().date()),
  settlementCurrency: optionalEditingValueSchema(editingCurrencySchema),
  settlementAmount: optionalEditingValueSchema(nonNegativeDecimalSchema),
  taxTreatment: transactionTaxTreatmentSchema,
  documentTaxAmount: optionalEditingValueSchema(nonNegativeDecimalSchema),
  category: z.string().trim().max(200),
  gstCreditStatus: gstCreditStatusSchema,
  claimableGstAud: optionalEditingValueSchema(nonNegativeDecimalSchema),
  occurredAt: optionalEditingValueSchema(z.string().date()),
  notes: z.string().trim().max(4_000),
} satisfies Record<keyof ManualTransactionValues, z.ZodTypeAny>;

export const manualTransactionEditingFieldError = <
  TField extends keyof ManualTransactionValues,
>(
  field: TField,
  value: ManualTransactionValues[TField],
): string | undefined => {
  const result: z.SafeParseReturnType<unknown, unknown> =
    manualTransactionEditingFieldSchemas[field].safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
};

const textOrNull = (value: string): string | null => value.trim() || null;

export const manualTransactionValues = (
  transaction: TransactionInput,
): ManualTransactionValues => ({
  artifact: "",
  ownerId: transaction.ownerId ?? "",
  kind: transaction.kind,
  counterparty: transaction.counterparty ?? "",
  reference: transaction.reference ?? "",
  invoiceDate: transaction.invoiceDate ?? "",
  documentAmount: transaction.documentAmount ?? "",
  documentCurrency: transaction.documentCurrency ?? "AUD",
  description: transaction.description ?? "",
  settledAt: transaction.settledAt?.slice(0, 10) ?? "",
  settlementCurrency: transaction.settlementCurrency ?? "AUD",
  settlementAmount: transaction.settlementAmount ?? "",
  taxTreatment: transaction.taxTreatment,
  documentTaxAmount: transaction.documentTaxAmount ?? "",
  category: transaction.category ?? "",
  gstCreditStatus: transaction.gstCreditStatus,
  claimableGstAud: transaction.claimableGstAud ?? "0.0000",
  occurredAt: transaction.occurredAt?.slice(0, 10) ?? "",
  notes: transaction.notes ?? "",
});

export const statusForManualAction = (
  action: ManualTransactionAction,
): TransactionInput["status"] => {
  if (action === "save_void") return "void";
  if (action === "save_recorded" || action === "restore_recorded")
    return "recorded";
  return "draft";
};

export const buildManualTransaction = (
  values: ManualTransactionValues,
  options: {
    action: ManualTransactionAction;
    sourceArtifactId: string | null;
    gstRegistered: boolean;
  },
): TransactionInput => {
  const documentAmount = textOrNull(values.documentAmount);
  const documentCurrency =
    textOrNull(values.documentCurrency)?.toUpperCase() ?? null;
  const settledAt = textOrNull(values.settledAt);
  const enteredSettlementAmount = textOrNull(values.settlementAmount);
  const settlementAmount =
    enteredSettlementAmount ??
    (settledAt && documentCurrency === "AUD" ? documentAmount : null);
  const ownerFunding = isOwnerFundingKind(values.kind);
  const taxTreatment = ownerFunding ? "no_tax" : values.taxTreatment;
  const documentTaxAmount = ownerFunding
    ? null
    : (textOrNull(values.documentTaxAmount) ??
      suggestedDocumentTaxAmount(
        documentAmount,
        documentCurrency,
        taxTreatment,
      ));

  return manualTransactionInputSchema.parse({
    ownerId: textOrNull(values.ownerId),
    sourceArtifactId: options.sourceArtifactId,
    kind: values.kind,
    reference: textOrNull(values.reference),
    counterparty: textOrNull(values.counterparty),
    description: textOrNull(values.description),
    status: statusForManualAction(options.action),
    category: textOrNull(values.category),
    notes: textOrNull(values.notes),
    occurredAt: dateToUtcMidnight(
      textOrNull(values.occurredAt) ?? textOrNull(values.invoiceDate),
    ),
    availableAt: null,
    invoiceDate: textOrNull(values.invoiceDate),
    settledAt: dateToUtcMidnight(settledAt),
    documentCurrency: documentAmount ? documentCurrency : null,
    documentAmount,
    documentTaxAmount,
    taxTreatment,
    settlementCurrency: settlementAmount
      ? (textOrNull(values.settlementCurrency)?.toUpperCase() ??
        (documentCurrency === "AUD" ? "AUD" : null))
      : null,
    settlementAmount,
    gstCreditStatus:
      options.gstRegistered && !ownerFunding
        ? values.gstCreditStatus
        : ownerFunding
          ? "not_claimable"
          : "not_registered",
    claimableGstAud:
      options.gstRegistered && !ownerFunding
        ? textOrNull(values.claimableGstAud)
        : "0.0000",
  });
};

export type ManualTransactionFieldErrors = Partial<
  Record<keyof ManualTransactionValues, string>
>;

export interface ManualTransactionValidationOptions {
  action: ManualTransactionAction;
  sourceArtifactId: string | null;
  gstRegistered: boolean;
}

export interface ManualTransactionServerIssue {
  field: keyof ManualTransactionValues | "form";
  message: string;
}

const fieldAliases: Partial<Record<string, keyof ManualTransactionValues>> = {
  sourceArtifactId: "artifact",
};

export const safeManualTransactionServerIssues = (
  error: z.ZodError,
): ManualTransactionServerIssue[] => {
  const issues = new Map<ManualTransactionServerIssue["field"], string>();
  for (const issue of error.issues) {
    const transactionField =
      issue.path[0] === "transaction" ? String(issue.path[1] ?? "") : "";
    const aliased = fieldAliases[transactionField] ?? transactionField;
    const field =
      aliased &&
      aliased in
        manualTransactionValues(
          transactionInputSchema.parse({ kind: "supplier_expense" }),
        )
        ? (aliased as keyof ManualTransactionValues)
        : "form";
    const message =
      field === "form"
        ? issue.path[0] === "action"
          ? "Choose a valid save action."
          : "Transaction request is invalid."
        : field === "kind"
          ? "Choose a valid transaction kind."
          : field === "ownerId"
            ? "Choose an owner."
            : field === "taxTreatment"
              ? "Choose a valid tax treatment."
              : field === "gstCreditStatus"
                ? "Choose a valid GST credit status."
                : issue.message.slice(0, 200);
    if (!issues.has(field)) issues.set(field, message);
  }
  return [...issues].map(([field, message]) => ({ field, message }));
};

export const manualTransactionFieldErrors = (
  values: ManualTransactionValues,
  options: ManualTransactionValidationOptions,
): ManualTransactionFieldErrors => {
  try {
    buildManualTransaction(values, options);
    return {};
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    const fields: ManualTransactionFieldErrors = {};
    for (const issue of error.issues) {
      const path = String(issue.path[0] ?? "");
      const field =
        fieldAliases[path] ?? (path as keyof ManualTransactionValues);
      if (field in values && !fields[field]) fields[field] = issue.message;
    }
    return fields;
  }
};
