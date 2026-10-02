import type { InvoiceParseResult } from "./invoice-types";
import { nonNegativeDecimalSchema, parseDecimal } from "./money";
import { parsePdfFilename } from "./pdf-filename";

export interface InvoiceEditableFields {
  counterparty: string;
  invoiceDate: string;
  reference: string;
  documentAmount: string;
  documentCurrency: string;
}

export interface ReviewedInvoiceMoney {
  amount: string;
  currency: string;
  confirmed: boolean;
}

export const invoiceEditableSuggestions = (
  result: InvoiceParseResult,
): Partial<InvoiceEditableFields> => {
  if (result.status === "unsupported" || result.parser.id === "stripe")
    return {};
  return {
    ...(result.fields.supplier ? { counterparty: result.fields.supplier } : {}),
    ...(result.fields.issueDate
      ? { invoiceDate: result.fields.issueDate }
      : {}),
    ...(result.fields.reference ? { reference: result.fields.reference } : {}),
  };
};

export const invoiceSuggestionConflicts = (
  current: InvoiceEditableFields,
  result: InvoiceParseResult,
  filename?: string,
): {
  field: keyof InvoiceEditableFields;
  source: "filename" | "transaction";
  existing: string;
  observed: string;
}[] => {
  if (result.status === "unsupported" || result.parser.id === "stripe")
    return [];
  const observed: Partial<InvoiceEditableFields> = {
    ...invoiceEditableSuggestions(result),
    ...(result.fields.invoiceTotal
      ? { documentAmount: result.fields.invoiceTotal.amount }
      : {}),
    ...(result.fields.currency
      ? { documentCurrency: result.fields.currency }
      : {}),
  };
  const parsedFilename = filename ? parsePdfFilename(filename) : null;
  const filenameValues: Partial<InvoiceEditableFields> = parsedFilename
    ? {
        counterparty: parsedFilename.supplier,
        invoiceDate: parsedFilename.invoiceDate,
        reference: parsedFilename.reference ?? "",
      }
    : {};
  const equivalent = (
    field: keyof InvoiceEditableFields,
    left: string,
    right: string,
  ) => {
    if (
      field === "documentAmount" &&
      nonNegativeDecimalSchema.safeParse(left.trim()).success &&
      nonNegativeDecimalSchema.safeParse(right.trim()).success
    )
      return parseDecimal(left.trim()) === parseDecimal(right.trim());
    if (field === "counterparty" || field === "documentCurrency")
      return left.trim().toLowerCase() === right.trim().toLowerCase();
    return left.trim() === right.trim();
  };
  return (Object.keys(observed) as (keyof InvoiceEditableFields)[]).flatMap(
    (field) => {
      const value = observed[field]!;
      return (["filename", "transaction"] as const).flatMap((source) => {
        const existing = (source === "filename" ? filenameValues : current)[
          field
        ];
        return existing?.trim() && !equivalent(field, existing, value)
          ? [{ field, source, existing, observed: value }]
          : [];
      });
    },
  );
};

export const reviewedInvoiceMoney = (
  result: InvoiceParseResult,
  review: ReviewedInvoiceMoney,
): Pick<
  InvoiceEditableFields,
  "documentAmount" | "documentCurrency"
> | null => {
  if (result.status === "unsupported" || result.parser.id === "stripe")
    return null;
  const amount = review.amount.trim();
  const currency = review.currency.trim().toUpperCase();
  if (
    !nonNegativeDecimalSchema.safeParse(amount).success ||
    !["AUD", "USD"].includes(currency)
  )
    return null;
  const requiresConfirmation =
    result.status === "needs_review" ||
    !result.fields.invoiceTotal ||
    !result.fields.currency ||
    amount !== result.fields.invoiceTotal.amount ||
    currency !== result.fields.currency;
  if (requiresConfirmation && !review.confirmed) return null;
  return { documentAmount: amount, documentCurrency: currency };
};

export const applyInvoiceBlankFields = (
  current: InvoiceEditableFields,
  result: InvoiceParseResult,
  review: ReviewedInvoiceMoney,
): Partial<InvoiceEditableFields> => {
  const changes: Partial<InvoiceEditableFields> = {};
  const suggestions = invoiceEditableSuggestions(result);
  for (const name of ["counterparty", "invoiceDate", "reference"] as const) {
    if (!current[name].trim() && suggestions[name])
      changes[name] = suggestions[name];
  }
  const money = reviewedInvoiceMoney(result, review);
  if (
    money &&
    !current.documentAmount.trim() &&
    (!current.documentCurrency.trim() ||
      current.documentCurrency.trim().toUpperCase() === money.documentCurrency)
  ) {
    changes.documentAmount = money.documentAmount;
    if (!current.documentCurrency.trim())
      changes.documentCurrency = money.documentCurrency;
  }
  return changes;
};
