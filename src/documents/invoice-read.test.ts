import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  DocumentService,
  type ArtifactRecord,
  type ArtifactRepository,
} from "./service";
import type { ObjectStorage } from "./storage";

const bytes = Buffer.from("%PDF-1.7\nsynthetic invoice content");
const invoice: ArtifactRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  artifactProfile: "manual_invoice_pdf_v1",
  objectKey: "synthetic/invoice.pdf",
  confirmedAt: "2040-01-01T00:00:00.000Z",
  uploadExpiresAt: "2040-01-01T00:05:00.000Z",
  mediaType: "application/pdf",
  byteSize: String(bytes.byteLength),
  checksumSha256: createHash("sha256").update(bytes).digest("base64"),
  state: "awaiting_review",
};

const setup = (overrides: Partial<ArtifactRecord> = {}) => {
  const record = { ...invoice, ...overrides };
  const repository = {
    requireActiveActorId: vi.fn(),
    getArtifact: vi.fn().mockResolvedValue(record),
  };
  const storage = {
    head: vi.fn().mockResolvedValue({
      contentLength: bytes.byteLength,
      contentType: "application/pdf",
      checksumSha256: invoice.checksumSha256,
      metadata: { "folio-artifact-id": invoice.id },
    }),
    readPrefix: vi.fn().mockResolvedValue(bytes),
  };
  const service = new DocumentService(
    repository as unknown as ArtifactRepository,
    storage as unknown as ObjectStorage,
    {
      bucket: "synthetic",
      prefix: "synthetic/",
      maxUploadBytes: 20 * 1024 * 1024,
    },
  );
  return { repository, storage, service };
};

describe("confirmed invoice extraction read", () => {
  it.each(["awaiting_review", "available"] as const)(
    "verifies actor, current object metadata and full bytes for a %s invoice",
    async (state) => {
      const { repository, storage, service } = setup({ state });
      await expect(
        service.readInvoicePdf("actor", invoice.id),
      ).resolves.toEqual({
        artifactId: invoice.id,
        confirmedAt: invoice.confirmedAt,
        checksumSha256: invoice.checksumSha256,
        bytes,
      });
      expect(repository.requireActiveActorId).toHaveBeenCalledWith("actor");
      expect(storage.head).toHaveBeenCalledWith("synthetic", invoice.objectKey);
      expect(storage.readPrefix).toHaveBeenCalledWith(
        "synthetic",
        invoice.objectKey,
        bytes.byteLength,
      );
      expect(repository.getArtifact).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    { state: "pending" },
    { state: "rejected" },
    { state: "deleting" },
    { confirmedAt: null },
    { artifactProfile: "stripe_balance_itemised_csv_v1" },
    { mediaType: "text/csv" },
    { byteSize: "10485761" },
    { byteSize: "0" },
  ] satisfies Array<Partial<ArtifactRecord>>)(
    "rejects ineligible invoices before object access: %j",
    async (overrides) => {
      const { storage, service } = setup(overrides);
      await expect(
        service.readInvoicePdf("actor", invoice.id),
      ).rejects.toThrow();
      expect(storage.head).not.toHaveBeenCalled();
      expect(storage.readPrefix).not.toHaveBeenCalled();
    },
  );

  it("rejects inactive actors and stale expected identities before object access", async () => {
    const { repository, storage, service } = setup();
    repository.requireActiveActorId.mockRejectedValueOnce(
      new Error("Inactive actor"),
    );
    await expect(service.readInvoicePdf("actor", invoice.id)).rejects.toThrow(
      "Inactive actor",
    );
    expect(repository.getArtifact).not.toHaveBeenCalled();
    await expect(
      service.readInvoicePdf("actor", invoice.id, {
        confirmedAt: "2040-01-02T00:00:00.000Z",
      }),
    ).rejects.toThrow("identity has changed");
    await expect(
      service.readInvoicePdf("actor", invoice.id, {
        checksumSha256: "different",
      }),
    ).rejects.toThrow("identity has changed");
    expect(storage.head).not.toHaveBeenCalled();
  });

  it("rejects mismatched head metadata and mismatched bytes before extraction", async () => {
    const { storage, service } = setup();
    storage.head.mockResolvedValueOnce({
      contentLength: bytes.byteLength + 1,
      contentType: "application/pdf",
      checksumSha256: invoice.checksumSha256,
      metadata: { "folio-artifact-id": invoice.id },
    });
    await expect(service.readInvoicePdf("actor", invoice.id)).rejects.toThrow(
      "metadata",
    );
    expect(storage.readPrefix).not.toHaveBeenCalled();

    storage.readPrefix.mockResolvedValueOnce(
      Buffer.from("%PDF-1.7\nchanged invoice bytes"),
    );
    await expect(service.readInvoicePdf("actor", invoice.id)).rejects.toThrow(
      "checksum",
    );
  });

  it("rejects an artifact deleted or changed during extraction read", async () => {
    const { repository, service } = setup();
    repository.getArtifact
      .mockResolvedValueOnce(invoice)
      .mockResolvedValueOnce({ ...invoice, state: "deleting" });
    await expect(service.readInvoicePdf("actor", invoice.id)).rejects.toThrow(
      "identity has changed",
    );
  });
});
