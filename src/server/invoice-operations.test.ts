import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizedInvoiceDocumentVersion } from "../domain/invoice-types";

const fixture = vi.hoisted(() => ({
  authConfig: { sessionCookieName: "synthetic_session" },
  auth: { session: vi.fn() },
  documents: { readInvoicePdf: vi.fn() },
  repository: { invoiceDuplicateHints: vi.fn() },
}));
const extractor = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: () => "synthetic-session",
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: { parse(value: unknown): unknown };
    const builder = {
      validator(schema: { parse(value: unknown): unknown }) {
        validator = schema;
        return builder;
      },
      handler(callback: (input: { data: unknown }) => Promise<unknown>) {
        return async (input: { data: unknown }) =>
          callback({ data: validator.parse(input.data) });
      },
    };
    return builder;
  },
}));
vi.mock("./runtime", () => ({ runtime: () => fixture }));
vi.mock("./diagnostics", () => ({
  runOperation: (_name: string, action: () => Promise<unknown>) => action(),
}));
vi.mock("../documents/invoice-extraction", () => ({
  extractInvoicePdf: extractor,
}));

import { extractInvoiceFields } from "./invoice-operations";

const artifactId = "11111111-1111-4111-8111-111111111111";
const bytes = new Uint8Array([37, 80, 68, 70, 45]);
const identity = {
  artifactId,
  checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  versionId: "synthetic-v1",
};
const normalizedDocument = {
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
};

beforeEach(() => {
  vi.clearAllMocks();
  fixture.auth.session.mockResolvedValue({ id: "actor", role: "member" });
  fixture.documents.readInvoicePdf.mockResolvedValue({ ...identity, bytes });
  fixture.repository.invoiceDuplicateHints.mockResolvedValue({
    linkedTransactions: 0,
    matchingReferenceTransactions: 1,
    matchingChecksumArtifacts: 0,
  });
  extractor.mockResolvedValue({ status: "extracted", normalizedDocument });
});

describe("authorized invoice suggestions", () => {
  it("returns fields and immutable provenance without bytes or normalized raw text", async () => {
    const response = await extractInvoiceFields({
      data: {
        artifactId,
        expectedVersionId: "synthetic-v1",
        expectedChecksumSha256: identity.checksumSha256,
      },
    });
    expect(response).toMatchObject({
      status: "parsed",
      ...identity,
      result: {
        fields: {
          supplier: "Google Workspace",
          invoiceTotal: { amount: "100.0000" },
        },
      },
      duplicateHints: { matchingReferenceTransactions: 1 },
    });
    expect(response).not.toHaveProperty("bytes");
    expect(response).not.toHaveProperty("normalizedDocument");
    expect(fixture.documents.readInvoicePdf).toHaveBeenCalledWith(
      "actor",
      artifactId,
      { versionId: "synthetic-v1", checksumSha256: identity.checksumSha256 },
    );
    expect(extractor).toHaveBeenCalledWith(bytes);
    expect(fixture.repository.invoiceDuplicateHints).toHaveBeenCalledWith(
      "actor",
      artifactId,
      "SYN-1",
      identity.checksumSha256,
    );
  });

  it("rejects missing sessions and missing permissions before accessing objects", async () => {
    fixture.auth.session.mockResolvedValueOnce(null);
    await expect(
      extractInvoiceFields({ data: { artifactId } }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    fixture.auth.session.mockResolvedValueOnce({
      id: "viewer",
      role: "viewer",
    });
    await expect(
      extractInvoiceFields({ data: { artifactId } }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(fixture.documents.readInvoicePdf).not.toHaveBeenCalled();
    expect(extractor).not.toHaveBeenCalled();
  });

  it("returns safe manual-entry status on bounded extraction failure", async () => {
    extractor.mockResolvedValueOnce({
      status: "unsupported",
      reason: "page_limit",
    });
    await expect(
      extractInvoiceFields({ data: { artifactId } }),
    ).resolves.toEqual({
      status: "unsupported",
      ...identity,
      reason: "page_limit",
    });
    expect(fixture.repository.invoiceDuplicateHints).not.toHaveBeenCalled();
  });

  it("never accepts caller-supplied bytes, URLs or filesystem paths", async () => {
    for (const extra of [
      { url: "https://example.test/invoice.pdf" },
      { path: "/synthetic/invoice.pdf" },
      { bytes },
    ]) {
      await expect(
        extractInvoiceFields({ data: { artifactId, ...extra } } as never),
      ).rejects.toThrow();
    }
    expect(fixture.documents.readInvoicePdf).not.toHaveBeenCalled();
  });
});
