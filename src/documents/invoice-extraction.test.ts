import { describe, expect, it } from "vitest";

import { extractInvoicePdf, invoicePdfLimits } from "./invoice-extraction";

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

const pdfWithPages = (texts: readonly (string | null)[]): Uint8Array => {
  const streams = texts.map((text) =>
    text === null
      ? "q Q"
      : `BT /F1 12 Tf 72 720 Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET`,
  );
  return pdfWithStreams(streams);
};

const pdfWithTextBlocks = (blocks: readonly string[]): Uint8Array => {
  const operations = blocks
    .map(
      (block) =>
        `BT /F1 12 Tf 72 720 Td (${block.replace(/[\\()]/g, "\\$&")}) Tj ET`,
    )
    .join("\n");
  return pdfWithStreams([operations]);
};

const pdfWithStreams = (
  streams: readonly string[],
  encrypted = false,
): Uint8Array => {
  const pageIds = streams.map((_stream, index) => 3 + index * 2);
  const contentIds = pageIds.map((pageId) => pageId + 1);
  const fontId = 3 + streams.length * 2;
  const encryptionId = fontId + 1;
  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  const objects = new Map<number, string>([
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, `<< /Type /Pages /Kids [${kids}] /Count ${streams.length} >>`],
  ]);

  streams.forEach((stream, index) => {
    const pageId = pageIds[index]!;
    const contentId = contentIds[index]!;
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.set(
      contentId,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  objects.set(fontId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  if (encrypted) {
    objects.set(
      encryptionId,
      `<< /Filter /Standard /V 1 /R 2 /O <${"00".repeat(32)}> /U <${"00".repeat(32)}> /P -4 >>`,
    );
  }

  let body = "%PDF-1.4\n";
  const offsets = [0];
  const finalObjectId = encrypted ? encryptionId : fontId;
  for (let objectId = 1; objectId <= finalObjectId; objectId += 1) {
    offsets.push(encode(body).length);
    body += `${objectId} 0 obj\n${objects.get(objectId)}\nendobj\n`;
  }
  const crossReferenceOffset = encode(body).length;
  body += `xref\n0 ${finalObjectId + 1}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
    .join("");
  const encryptionTrailer = encrypted
    ? ` /Encrypt ${encryptionId} 0 R /ID [<${"00".repeat(16)}><${"00".repeat(16)}>]`
    : "";
  body += `trailer\n<< /Size ${finalObjectId + 1} /Root 1 0 R${encryptionTrailer} >>\nstartxref\n${crossReferenceOffset}\n%%EOF`;
  return encode(body);
};

describe("bounded local invoice PDF extraction", () => {
  it("extracts normalized text items and page coordinates from in-memory bytes", async () => {
    const result = await extractInvoicePdf(
      pdfWithPages(["Google Workspace Invoice"]),
    );

    expect(result.status).toBe("extracted");
    if (result.status !== "extracted") return;
    expect(result.normalizedDocument).toMatchObject({
      schemaVersion: "folio.invoice-text.v1",
      pages: [{ pageNumber: 1, width: 612, height: 792 }],
    });
    const item = result.normalizedDocument.pages[0]?.items[0];
    expect(item?.text).toBe("Google Workspace Invoice");
    expect(item?.x).toBe(72);
    expect(item?.y).toBe(72);
    expect(Number.isFinite(item?.width)).toBe(true);
    expect(Number.isFinite(item?.height)).toBe(true);
  });

  it("returns safe manual-review results for invalid, empty, and oversized bytes", async () => {
    await expect(
      extractInvoicePdf("not bytes" as unknown as Uint8Array),
    ).resolves.toEqual({
      status: "unsupported",
      reason: "invalid_input",
    });
    await expect(extractInvoicePdf(new Uint8Array())).resolves.toEqual({
      status: "unsupported",
      reason: "empty_input",
    });
    await expect(
      extractInvoicePdf(new Uint8Array(invoicePdfLimits.maxBytes + 1)),
    ).resolves.toEqual({ status: "unsupported", reason: "input_too_large" });
  });

  it("returns a safe failure when the Node server entry cannot resolve PDF.js", async () => {
    const serverEntry = process.argv[1];
    process.argv[1] = "/__folio_missing_invoice_server__/index.mjs";
    try {
      await expect(
        extractInvoicePdf(pdfWithPages(["Google Workspace Invoice"])),
      ).resolves.toEqual({
        status: "unsupported",
        reason: "extraction_failed",
      });
    } finally {
      if (serverEntry === undefined) {
        process.argv.splice(1, 1);
      } else {
        process.argv[1] = serverEntry;
      }
    }
  });

  it("returns safe failures for malformed and textless scanned PDFs", async () => {
    await expect(extractInvoicePdf(encode("not a PDF"))).resolves.toMatchObject(
      {
        status: "unsupported",
        reason: "malformed_pdf",
      },
    );
    await expect(extractInvoicePdf(pdfWithPages([null]))).resolves.toEqual({
      status: "unsupported",
      reason: "no_text",
    });
  });

  it("returns an encrypted manual-review code without requesting a password", async () => {
    await expect(
      extractInvoicePdf(pdfWithStreams(["q Q"], true)),
    ).resolves.toEqual({
      status: "unsupported",
      reason: "encrypted",
    });
  });

  it("stops extraction when the document exceeds the page or text limit", async () => {
    const tooManyPages = await extractInvoicePdf(
      pdfWithPages(
        Array.from({ length: invoicePdfLimits.maxPages + 1 }, () => "invoice"),
      ),
    );
    const tooMuchText = await extractInvoicePdf(
      pdfWithTextBlocks(Array.from({ length: 4_000 }, () => "X".repeat(64))),
    );

    expect(tooManyPages).toEqual({
      status: "unsupported",
      reason: "page_limit",
    });
    expect(tooMuchText).toEqual({
      status: "unsupported",
      reason: "character_limit",
    });
  });

  it("terminates its worker when a shorter caller deadline expires", async () => {
    const result = await extractInvoicePdf(
      pdfWithPages(["Google Workspace Invoice"]),
      { deadlineMs: 1 },
    );

    expect(result).toEqual({
      status: "unsupported",
      reason: "deadline_exceeded",
    });
  });
});
