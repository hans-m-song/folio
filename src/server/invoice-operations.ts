import { validateInput } from "./input-validation";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";

import { extractInvoicePdf } from "../documents/invoice-extraction";
import { parseSupplierInvoice } from "../domain/invoice-parser";
import {
  operationPermissions,
  requirePermission,
  resolveAuthorizedActor,
} from "./authorization";
import { runOperation } from "./diagnostics";
import { AppError } from "../domain/errors";
import { reportServerFailure, setDiagnosticContext } from "./error-handling";
import { runtime } from "./runtime";

export const extractInvoiceFields = createServerFn({ method: "POST" })
  .validator(
    validateInput(
      z
        .object({
          artifactId: z.string().uuid(),
          expectedChecksumSha256: z
            .string()
            .regex(/^[A-Za-z0-9+/]{43}=$/)
            .optional(),
          expectedVersionId: z.string().min(1).max(1_024).optional(),
        })
        .strict(),
    ),
  )
  .handler(async ({ data }) =>
    runOperation("Extract invoice fields", async () => {
      const current = runtime();
      const required = operationPermissions.extractInvoiceFields;
      const actor = await resolveAuthorizedActor({
        token: getCookie(current.authConfig.sessionCookieName) ?? null,
        permission: required[0],
        session: (token) => current.auth.session(token),
      });
      for (const permission of required.slice(1))
        requirePermission(actor, permission);
      setDiagnosticContext({
        ids: { actorId: actor.id, artifactId: data.artifactId },
      });
      const invoice = await current.documents.readInvoicePdf(
        actor.id,
        data.artifactId,
        {
          checksumSha256: data.expectedChecksumSha256,
          versionId: data.expectedVersionId,
        },
      );
      const identity = {
        artifactId: invoice.artifactId,
        checksumSha256: invoice.checksumSha256,
        versionId: invoice.versionId,
      };
      const extraction = await extractInvoicePdf(invoice.bytes);
      if (extraction.status === "unsupported") {
        reportServerFailure(
          new AppError({
            code:
              extraction.reason === "extraction_failed" ||
              extraction.reason === "deadline_exceeded"
                ? "PDF_EXTRACTION_FAILED"
                : "PDF_EXTRACTION_UNSUPPORTED",
            stage: "pdf_extraction",
          }),
          {
            operation: "extract_invoice_fields",
            metadata: { reason: extraction.reason },
          },
        );
        return {
          status: "unsupported" as const,
          ...identity,
          reason: extraction.reason,
        };
      }
      const result = parseSupplierInvoice(extraction.normalizedDocument);
      const duplicateHints = await current.repository.invoiceDuplicateHints(
        actor.id,
        invoice.artifactId,
        result.fields.reference,
        invoice.checksumSha256,
      );
      return { status: "parsed" as const, ...identity, result, duplicateHints };
    }),
  );
