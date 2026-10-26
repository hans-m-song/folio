import { describe, expect, it, vi } from "vitest";

import { normalizedInvoiceDocumentVersion } from "../domain/invoice-types";
import { createInvoiceFieldReader } from "./invoice-field-reader";

const identity = {
  artifactId: "11111111-1111-4111-8111-111111111111",
  checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  confirmedAt: "2026-10-21T00:00:00.000Z",
};
const bytes = new Uint8Array([37, 80, 68, 70, 45]);
const fixture = () => {
  const documents = {
    readInvoicePdf: vi.fn().mockResolvedValue({ ...identity, bytes }),
  };
  const repository = {
    invoiceDuplicateHints: vi.fn().mockResolvedValue({
      linkedTransactions: 0,
      matchingReferenceTransactions: 0,
      matchingChecksumArtifacts: 1,
    }),
  };
  const extractPdf = vi.fn().mockResolvedValue({
    status: "extracted",
    normalizedDocument: {
      schemaVersion: normalizedInvoiceDocumentVersion,
      pages: [
        {
          pageNumber: 1,
          width: 612,
          height: 792,
          items: [
            "Google Workspace Invoice",
            "Invoice number: SYN-1",
            "Total AUD100.00",
          ].map((text, index) => ({
            text,
            x: 40,
            y: 40 + index * 20,
            width: 300,
            height: 12,
          })),
        },
      ],
    },
  });
  return {
    documents,
    repository,
    extractPdf,
    read: createInvoiceFieldReader({ documents, repository, extractPdf }),
  };
};

describe("shared invoice field reader", () => {
  it("returns the shared parser facts and provenance without raw file contents", async () => {
    const { read, documents, repository, extractPdf } = fixture();
    const result = await read("synthetic-actor", {
      artifactId: identity.artifactId,
      expectedChecksumSha256: identity.checksumSha256,
    });
    expect(documents.readInvoicePdf).toHaveBeenCalledWith(
      "synthetic-actor",
      identity.artifactId,
      {
        checksumSha256: identity.checksumSha256,
      },
    );
    expect(extractPdf).toHaveBeenCalledWith(bytes);
    expect(result).toMatchObject({
      status: "parsed",
      ...identity,
      result: {
        fields: { reference: "SYN-1", invoiceTotal: { amount: "100.0000" } },
      },
      duplicateHints: { matchingChecksumArtifacts: 1 },
    });
    expect(repository.invoiceDuplicateHints).toHaveBeenCalledWith(
      "synthetic-actor",
      identity.artifactId,
      "SYN-1",
      identity.checksumSha256,
    );
    expect(result).not.toHaveProperty("bytes");
    expect(result).not.toHaveProperty("normalizedDocument");
    expect(result).not.toHaveProperty("uploadUrl");
  });

  it("does not extract or query duplicates after artifact identity validation fails", async () => {
    const { read, documents, repository, extractPdf } = fixture();
    documents.readInvoicePdf.mockRejectedValueOnce(
      new Error("Checksum mismatch"),
    );
    await expect(
      read("synthetic-actor", {
        artifactId: identity.artifactId,
        expectedChecksumSha256: identity.checksumSha256,
      }),
    ).rejects.toThrow("Checksum mismatch");
    expect(extractPdf).not.toHaveBeenCalled();
    expect(repository.invoiceDuplicateHints).not.toHaveBeenCalled();
  });

  it.each(["no_text", "deadline_exceeded", "input_too_large"])(
    "preserves unsupported %s results without inventing facts",
    async (reason) => {
      const { read, repository, extractPdf } = fixture();
      extractPdf.mockResolvedValueOnce({ status: "unsupported", reason });
      const result = await read("synthetic-actor", {
        artifactId: identity.artifactId,
      });
      expect(result).toEqual({ status: "unsupported", ...identity, reason });
      expect(repository.invoiceDuplicateHints).not.toHaveBeenCalled();
    },
  );

  it("does not conceal a failed duplicate check behind a successful extraction response", async () => {
    const { read, repository } = fixture();
    repository.invoiceDuplicateHints.mockRejectedValueOnce(
      new Error("Duplicate check unavailable"),
    );
    await expect(
      read("synthetic-actor", { artifactId: identity.artifactId }),
    ).rejects.toThrow("Duplicate check unavailable");
  });
});
