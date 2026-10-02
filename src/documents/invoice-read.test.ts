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
  versionId: "confirmed-version",
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
    headVersion: vi.fn().mockResolvedValue({
      contentLength: bytes.byteLength,
      contentType: "application/pdf",
      versionId: invoice.versionId,
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
    "verifies actor, pinned metadata and bytes for a %s invoice without approving it",
    async (state) => {
      const { repository, storage, service } = setup({ state });
      await expect(
        service.readInvoicePdf("actor", invoice.id),
      ).resolves.toEqual({
        artifactId: invoice.id,
        versionId: invoice.versionId,
        checksumSha256: invoice.checksumSha256,
        bytes,
      });
      expect(repository.requireActiveActorId).toHaveBeenCalledWith("actor");
      expect(storage.readPrefix).toHaveBeenCalledWith(
        "synthetic",
        invoice.objectKey,
        invoice.versionId,
        bytes.byteLength,
      );
      expect(repository.getArtifact).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    { state: "pending" },
    { state: "rejected" },
    { state: "deleting" },
    { versionId: null },
    { versionId: "null" },
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
      expect(storage.headVersion).not.toHaveBeenCalled();
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
        versionId: "other-version",
      }),
    ).rejects.toThrow("identity has changed");
    await expect(
      service.readInvoicePdf("actor", invoice.id, {
        checksumSha256: "different",
      }),
    ).rejects.toThrow("identity has changed");
    expect(storage.headVersion).not.toHaveBeenCalled();
  });

  it("rejects a mismatched head and mismatched bytes without parsing", async () => {
    const { storage, service } = setup();
    storage.headVersion.mockResolvedValueOnce({
      contentLength: bytes.byteLength,
      contentType: "application/pdf",
      versionId: "other-version",
      checksumSha256: invoice.checksumSha256,
      metadata: { "folio-artifact-id": invoice.id },
    });
    await expect(service.readInvoicePdf("actor", invoice.id)).rejects.toThrow(
      "metadata",
    );
    expect(storage.readPrefix).not.toHaveBeenCalled();
    storage.readPrefix.mockResolvedValueOnce(
      Buffer.from("%PDF-1.7\naltered bytes"),
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
