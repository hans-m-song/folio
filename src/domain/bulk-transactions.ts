import { z } from "zod";

import type { TransactionRecord } from "./types";

export const bulkTransactionLimit = 50;

export const bulkTransactionFieldLabels = {
  counterparty: "Counterparty",
  category: "Operational category",
  ownerId: "Owner",
} as const;

export const bulkTransactionChangeSchema = z.discriminatedUnion("field", [
  z
    .object({
      field: z.literal("counterparty"),
      value: z.string().trim().min(1).max(300),
    })
    .strict(),
  z
    .object({
      field: z.literal("category"),
      value: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      field: z.literal("ownerId"),
      value: z
        .string()
        .uuid()
        .transform((value) => value.toLowerCase()),
    })
    .strict(),
]);

export const bulkTransactionRequestSchema = z
  .object({
    transactions: z
      .array(
        z
          .object({
            id: z
              .string()
              .uuid()
              .transform((id) => id.toLowerCase()),
            updatedAt: z.string().datetime({ offset: true }),
          })
          .strict(),
      )
      .min(1)
      .max(bulkTransactionLimit),
    change: bulkTransactionChangeSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const ids = request.transactions.map(({ id }) => id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transactions"],
        message: "Select each transaction only once.",
      });
  });

export type BulkTransactionChange = z.infer<typeof bulkTransactionChangeSchema>;
export type BulkTransactionRequest = z.infer<
  typeof bulkTransactionRequestSchema
>;

export interface BulkTransactionPreviewRow {
  id: string;
  updatedAt: string;
  counterparty: string | null;
  category: string | null;
  ownerId: string | null;
  reference: string | null;
  description: string | null;
  kind: TransactionRecord["kind"];
  status: TransactionRecord["status"];
  sourceSystem: TransactionRecord["sourceSystem"];
  beforeValue: string | null;
  afterValue: string;
  changed: boolean;
}

export interface BulkTransactionPreview {
  change: BulkTransactionChange;
  rows: BulkTransactionPreviewRow[];
  changedCount: number;
}

export interface BulkTransactionResult {
  selectedCount: number;
  updatedCount: number;
}
