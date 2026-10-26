import type { FolioRepository } from "../database/repository";
import { parseSupplierInvoice } from "../domain/invoice-parser";
import { extractInvoicePdf } from "./invoice-extraction";
import type { DocumentService } from "./service";

export interface InvoiceFieldReadRequest {
  artifactId: string;
  expectedChecksumSha256?: string;
}

export const createInvoiceFieldReader =
  ({
    documents,
    repository,
    extractPdf = extractInvoicePdf,
  }: {
    documents: Pick<DocumentService, "readInvoicePdf">;
    repository: Pick<FolioRepository, "invoiceDuplicateHints">;
    extractPdf?: typeof extractInvoicePdf;
  }) =>
  async (actorId: string, request: InvoiceFieldReadRequest) => {
    const invoice = await documents.readInvoicePdf(
      actorId,
      request.artifactId,
      {
        checksumSha256: request.expectedChecksumSha256,
      },
    );
    const identity = {
      artifactId: invoice.artifactId,
      checksumSha256: invoice.checksumSha256,
      confirmedAt: invoice.confirmedAt,
    };
    const extraction = await extractPdf(invoice.bytes);
    if (extraction.status === "unsupported")
      return {
        status: "unsupported" as const,
        ...identity,
        reason: extraction.reason,
      };

    const result = parseSupplierInvoice(extraction.normalizedDocument);
    const duplicateHints = await repository.invoiceDuplicateHints(
      actorId,
      invoice.artifactId,
      result.fields.reference,
      invoice.checksumSha256,
    );
    return { status: "parsed" as const, ...identity, result, duplicateHints };
  };

export type InvoiceFieldReader = ReturnType<typeof createInvoiceFieldReader>;
