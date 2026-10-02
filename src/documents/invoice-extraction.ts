import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import {
  normalizedInvoiceDocumentVersion,
  type NormalizedInvoiceDocumentV1,
  type NormalizedInvoicePageV1,
} from "../domain/invoice-types";

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

const resolvePdfjsEntry = (): string | null => {
  const serverEntry = process.argv[1];
  if (!serverEntry) return null;
  try {
    return pathToFileURL(
      createRequire(serverEntry).resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href;
  } catch {
    return null;
  }
};

const workerSource = String.raw`
const { parentPort, workerData } = require("node:worker_threads");

const failure = (reason) => ({ status: "unsupported", reason });

const run = async () => {
  let loadingTask;
  let result;
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
    result = failure(
      error && error.name === "PasswordException"
        ? "encrypted"
        : error && error.name === "InvalidPDFException"
          ? "malformed_pdf"
          : "extraction_failed",
    );
  } finally {
    if (loadingTask) {
      try {
        await loadingTask.destroy();
      } catch {}
    }
  }

  parentPort.postMessage(result || failure("extraction_failed"));
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
    } catch {
      resolve({ status: "unsupported", reason: "extraction_failed" });
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
        await worker.terminate().catch(() => undefined);
      }
      resolve(result);
    };

    worker.once("message", (message: unknown) => {
      const result = isWorkerResult(message)
        ? message
        : unsupported("extraction_failed");
      void finish(result, true);
    });
    worker.once("error", () => {
      void finish(unsupported("extraction_failed"), true);
    });
    worker.once("exit", (code) => {
      if (!settled) {
        void finish(
          unsupported(code === 0 ? "malformed_pdf" : "extraction_failed"),
          false,
        );
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
