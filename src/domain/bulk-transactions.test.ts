import { describe, expect, it } from "vitest";

import { bulkTransactionRequestSchema } from "./bulk-transactions";

const firstId = "00000000-0000-4000-8000-000000000001";
const revision = "2026-10-01T01:02:03.123456Z";
const request = {
  transactions: [{ id: firstId, updatedAt: revision }],
  change: { field: "category", value: "Software and subscriptions" },
};

describe("bulk transaction request", () => {
  it("preserves exact revision precision and trims operational values", () => {
    expect(
      bulkTransactionRequestSchema.parse({
        ...request,
        change: { field: "counterparty", value: "  CommBank  " },
      }),
    ).toEqual({
      transactions: [{ id: firstId, updatedAt: revision }],
      change: { field: "counterparty", value: "CommBank" },
    });
  });

  it("allows only the three approved fields with their existing limits", () => {
    for (const field of ["counterparty", "category", "ownerId"])
      expect(
        bulkTransactionRequestSchema.safeParse({
          ...request,
          change: { field, value: field === "ownerId" ? firstId : "Example" },
        }).success,
      ).toBe(true);
    for (const field of ["status", "taxTreatment", "documentAmount", "kind"])
      expect(
        bulkTransactionRequestSchema.safeParse({
          ...request,
          change: { field, value: "Example" },
        }).success,
      ).toBe(false);
    expect(
      bulkTransactionRequestSchema.safeParse({
        ...request,
        change: { field: "counterparty", value: "a".repeat(300) },
      }).success,
    ).toBe(true);
    expect(
      bulkTransactionRequestSchema.safeParse({
        ...request,
        change: { field: "category", value: "a".repeat(201) },
      }).success,
    ).toBe(false);
  });

  it("rejects empty, duplicate, oversized, and malformed selections", () => {
    for (const transactions of [
      [],
      [request.transactions[0], request.transactions[0]],
      Array.from({ length: 51 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        updatedAt: revision,
      })),
      [{ id: firstId, updatedAt: "not-a-revision" }],
      [{ id: "not-an-id", updatedAt: revision }],
    ])
      expect(
        bulkTransactionRequestSchema.safeParse({ ...request, transactions })
          .success,
      ).toBe(false);
  });

  it("accepts all 50 unique selections on a full page", () => {
    const transactions = Array.from({ length: 50 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      updatedAt: revision,
    }));
    expect(
      bulkTransactionRequestSchema.parse({ ...request, transactions })
        .transactions,
    ).toEqual(transactions);
  });

  it("normalizes UUID casing before detecting duplicates", () => {
    const id = "abcdefab-cdef-4abc-8def-abcdefabcdef";
    expect(
      bulkTransactionRequestSchema.safeParse({
        ...request,
        transactions: [
          { id, updatedAt: revision },
          { id: id.toUpperCase(), updatedAt: revision },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects blank values, invalid owners, and unapproved payload keys", () => {
    for (const change of [
      { field: "counterparty", value: " " },
      { field: "category", value: null },
      { field: "ownerId", value: "unlisted" },
      { field: "category", value: "Example", taxTreatment: "no_tax" },
    ])
      expect(
        bulkTransactionRequestSchema.safeParse({ ...request, change }).success,
      ).toBe(false);
    expect(
      bulkTransactionRequestSchema.safeParse({ ...request, allFiltered: true })
        .success,
    ).toBe(false);
  });
});
