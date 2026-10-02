import { describe, expect, it } from "vitest";

import { transactionKindSchema } from "./types";
import {
  transactionInvoiceLabel,
  transactionInvoiceStatus,
} from "./invoice-status";

const base = {
  kind: "supplier_expense" as const,
  sourceSystem: "manual" as const,
  sourceArtifactId: null,
};

describe("independent kind-aware invoice status", () => {
  it("expects invoices for expenses and credit notes for supplier credits", () => {
    expect(transactionInvoiceLabel(base)).toBe("Invoice missing");
    expect(transactionInvoiceLabel({ ...base, kind: "supplier_credit" })).toBe(
      "Credit note missing",
    );
  });

  it.each(
    transactionKindSchema.options.filter(
      (kind) => kind !== "supplier_expense" && kind !== "supplier_credit",
    ),
  )("does not raise invoice warnings for %s", (kind) => {
    expect(transactionInvoiceStatus({ ...base, kind })).toBe("not_expected");
  });

  it("only counts available invoice-profile evidence", () => {
    const artifact = {
      id: "synthetic-pdf",
      artifactProfile: "manual_invoice_pdf_v1" as const,
      filename: "synthetic-invoice.pdf",
      state: "available" as const,
      metadata: null,
    };
    expect(
      transactionInvoiceStatus({ ...base, sourceArtifacts: [artifact] }),
    ).toBe("attached");
    expect(
      transactionInvoiceLabel({
        ...base,
        kind: "supplier_credit",
        sourceArtifacts: [artifact],
      }),
    ).toBe("Credit note attached");
    expect(
      transactionInvoiceStatus({
        ...base,
        sourceArtifactId: artifact.id,
        sourceArtifacts: [{ ...artifact, state: "pending" }],
      }),
    ).toBe("missing");
    expect(
      transactionInvoiceStatus({
        ...base,
        sourceArtifacts: [
          { ...artifact, artifactProfile: "stripe_balance_itemised_csv_v1" },
        ],
      }),
    ).toBe("missing");
  });

  it("does not infer invoice profile or availability from an opaque artifact ID", () => {
    expect(
      transactionInvoiceStatus({ ...base, sourceArtifactId: "legacy-pdf" }),
    ).toBe("missing");
    expect(
      transactionInvoiceStatus({
        ...base,
        sourceSystem: "stripe",
        sourceArtifactId: "import-csv",
      }),
    ).toBe("missing");
  });
});
