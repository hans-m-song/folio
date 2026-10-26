import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import { AppError } from "../domain/errors";
import {
  normalizedInvoiceDocumentVersion,
  type NormalizedInvoiceDocumentV1,
  type NormalizedInvoicePageV1,
} from "../domain/invoice-types";
import { serverErrorDetails } from "../server/error-details";
import { reportServerFailure } from "../server/error-handling";

export const invoicePdfLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxPages: 10,
  maxCharacters: 250_000,
  deadlineMs: 10_000,
} as const;

export type PdfExtractionFailureCode =
  | "invalid_input"
  | "empty_input"
  | "input_too_large"
  | "page_limit"
  | "character_limit"
  | "deadline_exceeded"
  | "encrypted"
  | "no_text"
  | "malformed_pdf"
  | "extraction_failed";

export type PdfExtractionResult =
  | {
      status: "extracted";
      normalizedDocument: NormalizedInvoiceDocumentV1;
    }
  | {
      status: "unsupported";
      reason: PdfExtractionFailureCode;
    };

export interface InvoicePdfExtractionOptions {
  /** A shorter deadline can be requested by callers; the hard limit remains 10 seconds. */
  deadlineMs?: number;
}

type InvoiceWorkerResult =
  | { status: "extracted"; pages: NormalizedInvoicePageV1[] }
  | { status: "unsupported"; reason: PdfExtractionFailureCode };

type InvoiceWorkerDiagnosticStage = "worker_parser" | "worker_cleanup";

type InvoiceWorkerDiagnostic = {
  stage: InvoiceWorkerDiagnosticStage;
  details: Record<string, unknown>;
};

type InvoiceWorkerResponse = {
  result: InvoiceWorkerResult;
  diagnostics: InvoiceWorkerDiagnostic[];
};

const reportExtractionFailure = (
  stage: string,
  error: unknown,
  reason?: PdfExtractionFailureCode,
): void => {
  reportServerFailure(
    new AppError({
      code: diagnosticCodeFor(reason),
      stage,
      cause: error,
    }),
    extractionFailureContext(stage, reason),
  );
};

const reportWorkerDiagnostic = (
  diagnostic: InvoiceWorkerDiagnostic,
  reason?: PdfExtractionFailureCode,
): void => {
  const details = serverErrorDetails(diagnostic.details);
  reportServerFailure(
    new AppError({
      code: diagnosticCodeFor(reason),
      stage: diagnostic.stage,
      cause: diagnosticCause(details),
    }),
    extractionFailureContext(diagnostic.stage, reason),
  );
};

const diagnosticCodeFor = (
  reason: PdfExtractionFailureCode | undefined,
): "PDF_EXTRACTION_UNSUPPORTED" | "PDF_EXTRACTION_FAILED" =>
  reason === "encrypted" || reason === "malformed_pdf"
    ? "PDF_EXTRACTION_UNSUPPORTED"
    : "PDF_EXTRACTION_FAILED";

const extractionFailureContext = (
  stage: string,
  reason?: PdfExtractionFailureCode,
) => ({
  operation: "invoice_pdf_extraction",
  stage,
  ...(reason ? { metadata: { reason } } : {}),
});

const diagnosticCause = (details: Record<string, unknown>): Error => {
  const name = typeof details.name === "string" ? details.name : "Error";
  const message =
    typeof details.message === "string"
      ? details.message
      : "No error message was available.";
  const stack = Array.isArray(details.stack)
    ? details.stack.filter(
        (frame): frame is string => typeof frame === "string",
      )
    : [];
  const nestedDetails = details.cause;
  const cause =
    nestedDetails &&
    typeof nestedDetails === "object" &&
    !Array.isArray(nestedDetails)
      ? new Error(message, {
          cause: diagnosticCause(nestedDetails as Record<string, unknown>),
        })
      : new Error(message);
  cause.name = name;
  if (typeof details.code === "string")
    Object.assign(cause, { code: details.code });
  if (stack.length > 0) cause.stack = stack.join("\n");
  if (
    typeof details.truncated === "string" &&
    ["depth", "node_count", "cycle_or_repeated_reference"].includes(
      details.truncated,
    )
  )
    Object.assign(cause, { truncated: details.truncated });
  for (const marker of [
    "messageTruncated",
    "stackTruncated",
    "errorsTruncated",
    "issuesTruncated",
    "issuesUnavailable",
    "errorsUnavailable",
  ])
    if (details[marker] === true) Object.assign(cause, { [marker]: true });
  if (Array.isArray(details.errors))
    Object.assign(cause, {
      errors: details.errors.map((error) =>
        error && typeof error === "object" && !Array.isArray(error)
          ? diagnosticCause(error as Record<string, unknown>)
          : new Error("No error message was available."),
      ),
    });
  return cause;
};

const resolvePdfjsEntry = (): string | null => {
  const serverEntry = process.argv[1];
  if (!serverEntry) return null;
  try {
    return pathToFileURL(
      createRequire(serverEntry).resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href;
  } catch (error) {
    reportExtractionFailure("resolve_pdfjs_entry", error, "extraction_failed");
    return null;
  }
};

const workerSource = String.raw`
const { parentPort, workerData } = require("node:worker_threads");

const failure = (reason) => ({ status: "unsupported", reason });
const maximumDiagnosticDepth = 3;
const maximumDiagnosticItems = 8;
const maximumDiagnosticText = 1024;
const property = (value, key) => {
  try {
    return value && typeof value === "object" ? value[key] : undefined;
  } catch {
    return undefined;
  }
};
const redactDetails = (text) => {
  const redacted = text
  .replace(/\bdata:[^\s"'<>]+/gi, "[REDACTED_DATA_URL]")
  .replace(/\b(?:https?|postgres(?:ql)?):\/\/[^\s"'<>]+/gi, "[REDACTED_URL]")
  .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
  .replace(/\b(?:[A-Z][A-Z0-9]*[_-])*(?:password|passwd|secret|token|authorization|cookie|api[_-]?key|client_secret|secret_access_key)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "[REDACTED_CREDENTIAL]")
  .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_ACCESS_KEY]")
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
  .replace(/\/(?:Users|home)\/[^/\s]+/g, "/[REDACTED_HOME]")
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  return {
    text: redacted.slice(0, maximumDiagnosticText),
    truncated: redacted.length > maximumDiagnosticText,
  };
};
const safeTextDetails = (value) => typeof value === "string" && value.length > 0
  ? redactDetails(value)
  : undefined;
const safeText = (value) => safeTextDetails(value)?.text;
const safeIdentifier = (value) => {
  const text = safeText(value);
  return text && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(text)
    ? text
    : undefined;
};
const errorDetails = (error, reason, depth = 0, seen = new Set()) => {
  if (depth > maximumDiagnosticDepth) return { truncated: "depth" };
  if (error && typeof error === "object") {
    if (seen.has(error)) return { truncated: "cycle_or_repeated_reference" };
    seen.add(error);
  }
  const name = safeIdentifier(property(error, "name"));
  const code = safeIdentifier(property(error, "code") ?? property(error, "Code"));
  const message = safeTextDetails(property(error, "message"));
  const rawStack = property(error, "stack");
  const frames = typeof rawStack === "string"
    ? rawStack.split("\n").filter((line) => /^\s+at /.test(line))
    : [];
  const redactedFrames = frames.slice(0, maximumDiagnosticItems).map(redactDetails);
  const expected = reason === "encrypted" || reason === "malformed_pdf";
  const type = name || "Error";
  const details = {
    ...(name ? { name } : {}),
    ...(!expected && code ? { code } : {}),
    message: expected
      ? "PDF parser reported " + reason + " (" + type + ")"
      : message?.text || "PDF extraction worker failed with " + type,
    ...(!expected && message?.truncated ? { messageTruncated: true } : {}),
    ...(!expected && frames.length
      ? { stack: redactedFrames.map((frame) => frame.text).join("\n") }
      : {}),
    ...(!expected &&
    (frames.length > maximumDiagnosticItems ||
      redactedFrames.some((frame) => frame.truncated))
      ? { stackTruncated: true }
      : {}),
  };
  const cause = property(error, "cause");
  if (cause !== undefined)
    details.cause = errorDetails(cause, reason, depth + 1, seen);
  const errors = property(error, "errors");
  try {
    if (Array.isArray(errors)) {
      details.errors = errors
        .slice(0, maximumDiagnosticItems)
        .map((child) => errorDetails(child, reason, depth + 1, seen));
      if (errors.length > maximumDiagnosticItems)
        details.errorsTruncated = true;
    }
  } catch {
    details.errorsUnavailable = true;
  }
  return details;
};
const recordDiagnostic = (diagnostics, stage, error, reason) => {
  diagnostics.push({ stage, details: errorDetails(error, reason) });
};

const run = async () => {
  let loadingTask;
  let result;
  const diagnostics = [];
  try {
    const { getDocument } = await import(workerData.pdfjsEntry);
    class LocalOnlyBinaryDataFactory {
      async fetch() {
        throw new Error("external_resource_disabled");
      }
    }

    loadingTask = getDocument({
      data: new Uint8Array(workerData.pdfData),
      BinaryDataFactory: LocalOnlyBinaryDataFactory,
      useWorkerFetch: false,
      useWasm: false,
      stopAtErrors: true,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true,
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      verbosity: 0,
    });
    loadingTask.onPassword = () => {
      const error = new Error("encrypted_pdf");
      error.name = "PasswordException";
      throw error;
    };

    const pdf = await loadingTask.promise;
    if (pdf.numPages > workerData.maxPages) {
      result = failure("page_limit");
    } else {
      let characterCount = 0;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const items = [];
        if (
          !Number.isFinite(viewport.width) ||
          viewport.width <= 0 ||
          !Number.isFinite(viewport.height) ||
          viewport.height <= 0
        ) {
          result = failure("malformed_pdf");
          break;
        }
        const reader = page
          .streamTextContent({ includeMarkedContent: false })
          .getReader();
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            for (const item of chunk.value.items) {
              if (typeof item.str !== "string" || item.str.length === 0) continue;
              characterCount += item.str.length;
              if (characterCount > workerData.maxCharacters) {
                result = failure("character_limit");
                break;
              }
              if (
                !Array.isArray(item.transform) ||
                item.transform.length < 6 ||
                !Number.isFinite(item.transform[4]) ||
                !Number.isFinite(item.transform[5]) ||
                !Number.isFinite(item.width) ||
                !Number.isFinite(item.height)
              ) {
                result = failure("malformed_pdf");
                break;
              }
              const point = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
              if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
                result = failure("malformed_pdf");
                break;
              }
              items.push({
                text: item.str,
                x: point[0],
                y: point[1],
                width: Math.abs(item.width),
                height: Math.abs(item.height),
              });
            }
            if (result) {
              break;
            }
          }
        } finally {
          reader.releaseLock();
        }
        page.cleanup();
        if (result) break;
        pages.push({
          pageNumber,
          width: viewport.width,
          height: viewport.height,
          items,
        });
      }
      if (!result) {
        result = characterCount === 0 ? failure("no_text") : { status: "extracted", pages };
      }
    }
  } catch (error) {
    const name = property(error, "name");
    result = failure(
      name === "PasswordException"
        ? "encrypted"
        : name === "InvalidPDFException"
          ? "malformed_pdf"
          : "extraction_failed",
    );
    recordDiagnostic(diagnostics, "worker_parser", error, result.reason);
  } finally {
    if (loadingTask) {
      try {
        await loadingTask.destroy();
      } catch (error) {
        recordDiagnostic(
          diagnostics,
          "worker_cleanup",
          error,
          "extraction_failed",
        );
      }
    }
  }

  parentPort.postMessage({
    result: result || failure("extraction_failed"),
    diagnostics,
  });
  parentPort.close();
};

void run();
`;

const unsupported = (
  reason: PdfExtractionFailureCode,
): Extract<PdfExtractionResult, { status: "unsupported" }> => ({
  status: "unsupported",
  reason,
});

const hardDeadline = (requested: number | undefined): number =>
  Number.isSafeInteger(requested) && requested! > 0
    ? Math.min(requested!, invoicePdfLimits.deadlineMs)
    : invoicePdfLimits.deadlineMs;

const extractionFailureCodes = new Set<PdfExtractionFailureCode>([
  "invalid_input",
  "empty_input",
  "input_too_large",
  "page_limit",
  "character_limit",
  "deadline_exceeded",
  "encrypted",
  "no_text",
  "malformed_pdf",
  "extraction_failed",
]);

const isNormalizedWorkerPage = (
  value: unknown,
): value is NormalizedInvoicePageV1 => {
  if (!value || typeof value !== "object") return false;
  const page = value as Partial<NormalizedInvoicePageV1>;
  return (
    Number.isSafeInteger(page.pageNumber) &&
    page.pageNumber! > 0 &&
    typeof page.width === "number" &&
    Number.isFinite(page.width) &&
    page.width > 0 &&
    typeof page.height === "number" &&
    Number.isFinite(page.height) &&
    page.height > 0 &&
    Array.isArray(page.items) &&
    page.items.every((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      const item = candidate as NormalizedInvoicePageV1["items"][number];
      return (
        typeof item.text === "string" &&
        typeof item.x === "number" &&
        Number.isFinite(item.x) &&
        typeof item.y === "number" &&
        Number.isFinite(item.y) &&
        typeof item.width === "number" &&
        Number.isFinite(item.width) &&
        item.width >= 0 &&
        typeof item.height === "number" &&
        Number.isFinite(item.height) &&
        item.height >= 0
      );
    })
  );
};

const isWorkerResult = (value: unknown): value is InvoiceWorkerResult => {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  if (result.status === "unsupported")
    return extractionFailureCodes.has(
      result.reason as PdfExtractionFailureCode,
    );
  return (
    result.status === "extracted" &&
    Array.isArray(result.pages) &&
    result.pages.every(isNormalizedWorkerPage)
  );
};

const isWorkerDiagnostic = (
  value: unknown,
): value is InvoiceWorkerDiagnostic => {
  if (!value || typeof value !== "object") return false;
  const diagnostic = value as Record<string, unknown>;
  return (
    (diagnostic.stage === "worker_parser" ||
      diagnostic.stage === "worker_cleanup") &&
    !!diagnostic.details &&
    typeof diagnostic.details === "object" &&
    !Array.isArray(diagnostic.details)
  );
};

const isWorkerResponse = (value: unknown): value is InvoiceWorkerResponse => {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return (
    isWorkerResult(response.result) &&
    Array.isArray(response.diagnostics) &&
    response.diagnostics.length <= 2 &&
    response.diagnostics.every(isWorkerDiagnostic)
  );
};

const runIsolatedExtraction = (
  bytes: Uint8Array,
  deadlineMs: number,
  pdfjsEntry: string,
): Promise<InvoiceWorkerResult> =>
  new Promise((resolve) => {
    const copy = Uint8Array.from(bytes);
    let worker: Worker;
    try {
      worker = new Worker(workerSource, {
        eval: true,
        workerData: {
          pdfjsEntry,
          pdfData: copy.buffer,
          maxPages: invoicePdfLimits.maxPages,
          maxCharacters: invoicePdfLimits.maxCharacters,
        },
        transferList: [copy.buffer],
        resourceLimits: {
          maxOldGenerationSizeMb: 96,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4,
        },
      });
    } catch (error) {
      reportExtractionFailure("worker_constructor", error, "extraction_failed");
      resolve(unsupported("extraction_failed"));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      void finish(unsupported("deadline_exceeded"), true);
    }, deadlineMs);

    const finish = async (
      result: InvoiceWorkerResult,
      terminate: boolean,
    ): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminate) {
        try {
          await worker.terminate();
        } catch (error) {
          reportExtractionFailure(
            "worker_terminate",
            error,
            "extraction_failed",
          );
        }
      }
      resolve(result);
    };

    worker.once("message", (message: unknown) => {
      if (!isWorkerResponse(message)) {
        reportExtractionFailure(
          "worker_response",
          new Error(
            "Invalid response received from invoice PDF extraction worker",
          ),
          "extraction_failed",
        );
        void finish(unsupported("extraction_failed"), true);
        return;
      }
      for (const diagnostic of message.diagnostics) {
        reportWorkerDiagnostic(
          diagnostic,
          message.result.status === "unsupported"
            ? message.result.reason
            : undefined,
        );
      }
      void finish(message.result, true);
    });
    worker.once("error", (error) => {
      if (settled) return;
      reportExtractionFailure("worker_error", error, "extraction_failed");
      void finish(unsupported("extraction_failed"), true);
    });
    worker.once("exit", (code) => {
      if (!settled) {
        const reason = code === 0 ? "malformed_pdf" : "extraction_failed";
        reportExtractionFailure(
          "worker_exit",
          new Error(`Invoice PDF extraction worker exited with code ${code}`),
          reason,
        );
        void finish(unsupported(reason), false);
      }
    });
  });

export const extractInvoicePdf = async (
  bytes: Uint8Array,
  options: InvoicePdfExtractionOptions = {},
): Promise<PdfExtractionResult> => {
  if (!(bytes instanceof Uint8Array)) return unsupported("invalid_input");
  if (bytes.byteLength === 0) return unsupported("empty_input");
  if (bytes.byteLength > invoicePdfLimits.maxBytes)
    return unsupported("input_too_large");

  const pdfjsEntry = resolvePdfjsEntry();
  if (!pdfjsEntry) return unsupported("extraction_failed");

  const result = await runIsolatedExtraction(
    bytes,
    hardDeadline(options.deadlineMs),
    pdfjsEntry,
  );
  if (result.status === "unsupported") return result;
  if (result.pages.length > invoicePdfLimits.maxPages)
    return unsupported("page_limit");

  let characterCount = 0;
  for (const page of result.pages) {
    for (const item of page.items) characterCount += item.text.length;
    if (characterCount > invoicePdfLimits.maxCharacters)
      return unsupported("character_limit");
  }
  if (characterCount === 0) return unsupported("no_text");

  return {
    status: "extracted",
    normalizedDocument: {
      schemaVersion: normalizedInvoiceDocumentVersion,
      pages: result.pages,
    },
  };
};
