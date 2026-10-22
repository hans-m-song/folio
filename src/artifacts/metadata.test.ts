import { describe, expect, it } from "vitest";

import { artifactMetadataEditSchema, artifactMetadataSchema } from "./metadata";

describe("artifact metadata", () => {
  it("accepts a leaf filename and optional metadata", () => {
    expect(
      artifactMetadataSchema.parse({
        filename: "  Café statement.pdf  ",
        periodStart: "2026-07-01",
        periodEnd: "2026-09-30",
        documentDate: "2026-09-30",
        reference: "INV-42",
        notes: "Quarterly statement",
        supplier: "  Northwind Systems  ",
      }),
    ).toMatchObject({
      filename: "Café statement.pdf",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      reference: "INV-42",
      notes: "Quarterly statement",
      supplier: "Northwind Systems",
    });
  });

  it.each(["folder/name.pdf", "folder\\name.pdf", "line\nbreak.pdf", ""])(
    "rejects an unsafe filename %j",
    (filename) => {
      expect(artifactMetadataSchema.safeParse({ filename }).success).toBe(
        false,
      );
    },
  );

  it("rejects an inverted date range", () => {
    expect(
      artifactMetadataSchema.safeParse({
        filename: "statement.pdf",
        periodStart: "2026-10-01",
        periodEnd: "2026-09-30",
      }),
    ).toMatchObject({ success: false });
  });

  it("bounds reference and notes", () => {
    expect(
      artifactMetadataSchema.safeParse({
        filename: "statement.pdf",
        reference: "R".repeat(201),
      }).success,
    ).toBe(false);
    expect(
      artifactMetadataSchema.safeParse({
        filename: "statement.pdf",
        notes: "N".repeat(2001),
      }).success,
    ).toBe(false);
  });

  it("accepts an optional supplier and bounds its trimmed text", () => {
    expect(
      artifactMetadataSchema.parse({
        filename: "invoice.pdf",
        supplier: "   ",
      }).supplier,
    ).toBeNull();
    expect(
      artifactMetadataSchema.safeParse({
        filename: "invoice.pdf",
        supplier: "S".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("validates post-upload filename and coverage edits with their expected values", () => {
    expect(
      artifactMetadataEditSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        filename: "  October statement.csv  ",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        expected: {
          filename: "October.csv",
          periodStart: null,
          periodEnd: null,
        },
      }),
    ).toMatchObject({ filename: "October statement.csv" });

    expect(
      artifactMetadataEditSchema.safeParse({
        id: "11111111-1111-4111-8111-111111111111",
        filename: "statement.csv",
        periodStart: "2026-11-01",
        periodEnd: "2026-10-31",
        expected: {
          filename: "October.csv",
          periodStart: null,
          periodEnd: null,
        },
      }),
    ).toMatchObject({
      success: false,
      error: {
        issues: [expect.objectContaining({ path: ["periodEnd"] })],
      },
    });
  });

  it("rejects extra metadata fields at both edit levels", () => {
    const edit = {
      id: "11111111-1111-4111-8111-111111111111",
      filename: "statement.csv",
      periodStart: null,
      periodEnd: null,
      expected: {
        filename: "statement.csv",
        periodStart: null,
        periodEnd: null,
      },
    };

    expect(
      artifactMetadataEditSchema.safeParse({ ...edit, supplier: "Unknown" })
        .success,
    ).toBe(false);
    expect(
      artifactMetadataEditSchema.safeParse({
        ...edit,
        expected: { ...edit.expected, notes: "Unknown" },
      }).success,
    ).toBe(false);
  });
});
