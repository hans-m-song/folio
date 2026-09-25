import { describe, expect, it } from "vitest";

import {
  artifactProfileRegistry,
  assertArtifactProfileMediaType,
  isInvoiceEvidenceProfile,
} from "./profiles";

describe("artifact profiles", () => {
  it("allows only the manual invoice profile as invoice evidence", () => {
    expect(isInvoiceEvidenceProfile("manual_invoice_pdf_v1")).toBe(true);
    expect(isInvoiceEvidenceProfile("commbank_statement_pdf_v1")).toBe(false);
    expect(isInvoiceEvidenceProfile("stripe_balance_itemised_csv_v1")).toBe(
      false,
    );
  });

  it("binds every profile to its registered media type", () => {
    expect(
      assertArtifactProfileMediaType(
        "manual_invoice_pdf_v1",
        "application/pdf",
      ),
    ).toEqual(artifactProfileRegistry.manual_invoice_pdf_v1);
    expect(() =>
      assertArtifactProfileMediaType("commbank_statement_pdf_v1", "text/csv"),
    ).toThrow("Media type");
  });
});
