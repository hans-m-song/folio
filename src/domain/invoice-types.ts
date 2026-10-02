export const normalizedInvoiceDocumentVersion = "folio.invoice-text.v1";
export const invoiceSuggestionVersion = "folio.invoice-suggestions.v1";

export type InvoiceCurrency = "AUD" | "USD";

export interface NormalizedInvoiceTextItemV1 {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedInvoicePageV1 {
  pageNumber: number;
  width: number;
  height: number;
  items: readonly NormalizedInvoiceTextItemV1[];
}

export interface NormalizedInvoiceDocumentV1 {
  schemaVersion: typeof normalizedInvoiceDocumentVersion;
  pages: readonly NormalizedInvoicePageV1[];
}

export type InvoiceParserId =
  | "invoice-router"
  | "google-workspace"
  | "supabase"
  | "stripe";

export interface InvoiceParserVersion {
  id: InvoiceParserId;
  version: 1;
}

export interface InvoiceProvenance {
  pageNumber: number;
  label: string;
}

export interface InvoiceMoneyFact {
  amount: string;
  currency: InvoiceCurrency | null;
  provenance: readonly InvoiceProvenance[];
}

export type InvoiceFeeKind =
  | "processing"
  | "billing_usage"
  | "subscription"
  | "deducted"
  | "credit"
  | "other";

export interface InvoiceFeeFact extends InvoiceMoneyFact {
  kind: InvoiceFeeKind;
}

export type InvoiceMoneyField =
  | "invoiceTotal"
  | "amountPaid"
  | "amountDue"
  | "subtotal"
  | "tax";

export interface InvoiceMoneyConflict {
  field: InvoiceMoneyField;
  occurrences: readonly InvoiceMoneyFact[];
}

export type InvoiceWarningCode =
  | "ambiguous_currency"
  | "conflicting_currency"
  | "conflicting_date"
  | "conflicting_money_fact"
  | "conflicting_reference"
  | "conflicting_total"
  | "currency_unconfirmed"
  | "invoice_total_missing"
  | "layout_unrecognized"
  | "malformed_input"
  | "missing_invoice_anchor"
  | "unsupported_supplier"
  | "stripe_duplicate_risk"
  | "totals_do_not_reconcile"
  | "unknown_credit_note_layout"
  | "unreadable_money_field"
  | "unreadable_reference";

export interface InvoiceSuggestionFields {
  supplier: string | null;
  reference: string | null;
  issueDate: string | null;
  currency: InvoiceCurrency | null;
  invoiceTotal: InvoiceMoneyFact | null;
  amountPaid: InvoiceMoneyFact | null;
  amountDue: InvoiceMoneyFact | null;
  subtotal: InvoiceMoneyFact | null;
  tax: InvoiceMoneyFact | null;
  fees: readonly InvoiceFeeFact[];
}

export interface InvoiceSuggestionProvenance {
  supplier: readonly InvoiceProvenance[];
  reference: readonly InvoiceProvenance[];
  issueDate: readonly InvoiceProvenance[];
  currency: readonly InvoiceProvenance[];
}

export interface InvoiceParseResult {
  schemaVersion: typeof invoiceSuggestionVersion;
  status: "recognized" | "needs_review" | "unsupported";
  parser: InvoiceParserVersion;
  fields: InvoiceSuggestionFields;
  provenance: InvoiceSuggestionProvenance;
  conflicts: readonly InvoiceMoneyConflict[];
  warnings: readonly InvoiceWarningCode[];
}
