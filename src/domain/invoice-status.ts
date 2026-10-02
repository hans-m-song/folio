import { z } from "zod";

import type { TransactionKind, TransactionRecord } from "./types";

export const invoiceExpectedKinds = [
  "supplier_expense",
  "supplier_credit",
] as const satisfies readonly TransactionKind[];

export const invoiceStatusSchema = z.enum([
  "attached",
  "missing",
  "not_expected",
]);

export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

export const expectsInvoice = (kind: TransactionKind): boolean =>
  invoiceExpectedKinds.some((expectedKind) => kind === expectedKind);

export const transactionInvoiceStatus = (
  transaction: Pick<
    TransactionRecord,
    "kind" | "sourceSystem" | "sourceArtifactId" | "sourceArtifacts"
  >,
): InvoiceStatus => {
  if (!expectsInvoice(transaction.kind)) return "not_expected";
  return transaction.sourceArtifacts?.some(
    (artifact) =>
      artifact.artifactProfile === "manual_invoice_pdf_v1" &&
      artifact.state === "available",
  )
    ? "attached"
    : "missing";
};

export const transactionInvoiceLabel = (
  transaction: Parameters<typeof transactionInvoiceStatus>[0],
): string => {
  const status = transactionInvoiceStatus(transaction);
  if (status === "not_expected") return "Invoice not expected";
  const document =
    transaction.kind === "supplier_credit" ? "Credit note" : "Invoice";
  return `${document} ${status}`;
};
