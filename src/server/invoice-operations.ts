import { validateInput } from "./input-validation";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";

import { createInvoiceFieldReader } from "../documents/invoice-field-reader";
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
      const result = await createInvoiceFieldReader(current)(actor.id, data);
      if (result.status === "unsupported") {
        reportServerFailure(
          new AppError({
            code:
              result.reason === "extraction_failed" ||
              result.reason === "deadline_exceeded"
                ? "PDF_EXTRACTION_FAILED"
                : "PDF_EXTRACTION_UNSUPPORTED",
            stage: "pdf_extraction",
          }),
          {
            operation: "extract_invoice_fields",
            metadata: { reason: result.reason },
          },
        );
      }
      return result;
    }),
  );
