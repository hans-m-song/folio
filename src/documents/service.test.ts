import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  DocumentService,
  UPLOAD_EXPIRY_GRACE_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
} from "./service";
import type {
  ArtifactPresignRecoveryError,
  ArtifactRecord,
  ArtifactRepository,
} from "./service";
import type { ObjectStorage, StoredObjectHead } from "./storage";

const checksumFor = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("base64");

const artifact: ArtifactRecord = {
  id: "0f935296-35b3-43bd-bc3d-0caa0b0a2510",
  artifactProfile: "manual_invoice_pdf_v1",
  objectKey: "private/pdf/object",
  confirmedAt: null,
  uploadExpiresAt: null,
  mediaType: "application/pdf",
  byteSize: "5",
  checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  state: "pending",
};

const headFor = (record: ArtifactRecord): StoredObjectHead => ({
  contentLength: Number(record.byteSize),
  contentType: record.mediaType,
  checksumSha256: record.checksumSha256,
  metadata: { "folio-artifact-id": record.id },
});

const serviceFor = (
  repository: Partial<ArtifactRepository>,
  storage: Partial<ObjectStorage>,
): DocumentService =>
  new DocumentService(
    repository as ArtifactRepository,
    storage as ObjectStorage,
    { bucket: "test", prefix: "private/", maxUploadBytes: 100 },
  );

const idempotentInput = {
  credentialId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "upload-request-1",
  actorId: "trusted-actor-id",
  ownerId: "22222222-2222-4222-8222-222222222222",
  artifactProfile: "manual_invoice_pdf_v1" as const,
  filename: "evidence.pdf",
  mediaType: "application/pdf",
  byteSize: 5,
  checksumSha256: artifact.checksumSha256,
};

describe("document upload lifecycle", () => {
  it.each([0, 101, 1.5])(
    "rejects invalid upload size %s before persistence",
    async (byteSize) => {
      const repository = { createPending: vi.fn() };
      const storage = { presignPut: vi.fn() };

      await expect(
        serviceFor(repository, storage).startUpload({
          actorId: "trusted-actor-id",
          ownerId: null,
          artifactProfile: "manual_invoice_pdf_v1",
          filename: "evidence.pdf",
          mediaType: "application/pdf",
          byteSize,
          checksumSha256: artifact.checksumSha256,
        }),
      ).rejects.toThrow("Upload size");
      expect(repository.createPending).not.toHaveBeenCalled();
      expect(storage.presignPut).not.toHaveBeenCalled();
    },
  );

  it("rejects a media type that does not match the profile before persistence", async () => {
    const repository = { createPending: vi.fn() };
    const storage = { presignPut: vi.fn() };

    await expect(
      serviceFor(repository, storage).startUpload({
        actorId: "trusted-actor-id",
        ownerId: null,
        artifactProfile: "manual_invoice_pdf_v1",
        filename: "evidence.csv",
        mediaType: "text/csv",
        byteSize: 5,
        checksumSha256: artifact.checksumSha256,
      }),
    ).rejects.toThrow();
    expect(repository.createPending).not.toHaveBeenCalled();
  });

  it("registers the exact expiry before signing and returns the signed headers", async () => {
    const order: string[] = [];
    let registeredExpiry: string | undefined;
    const repository = {
      createPending: vi.fn().mockResolvedValue(artifact),
      registerUploadExpiry: vi.fn(async (_id: string, expiresAt: string) => {
        registeredExpiry = expiresAt;
        order.push("expiry");
      }),
    };
    const storage = {
      presignPut: vi.fn(async (input: { expiresAt: string }) => {
        order.push("presign");
        expect(input.expiresAt).toBe(registeredExpiry);
        return "https://upload.example.test";
      }),
    };
    const result = await serviceFor(repository, storage).startUpload({
      actorId: "trusted-actor-id",
      ownerId: null,
      artifactProfile: "manual_invoice_pdf_v1",
      filename: "evidence.pdf",
      mediaType: "application/pdf",
      byteSize: 5,
      checksumSha256: artifact.checksumSha256,
    });

    expect(order).toEqual(["expiry", "presign"]);
    expect(repository.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "trusted-actor-id",
        ownerId: null,
        filename: "evidence.pdf",
        originalFilename: "evidence.pdf",
        periodStart: null,
        periodEnd: null,
        documentDate: null,
        reference: null,
        notes: null,
      }),
    );
    expect(repository.registerUploadExpiry).toHaveBeenCalledWith(
      artifact.id,
      expect.any(String),
    );
    expect(Date.parse(result.artifact.uploadExpiresAt!)).toBeGreaterThan(
      Date.now(),
    );
    expect(Date.parse(result.artifact.uploadExpiresAt!)).toBeLessThanOrEqual(
      Date.now() + UPLOAD_URL_TTL_SECONDS * 1000,
    );
    expect(result).toMatchObject({
      uploadUrl: "https://upload.example.test",
      uploadHeaders: {
        "Content-Type": "application/pdf",
        "x-amz-checksum-sha256": artifact.checksumSha256,
        "x-amz-meta-folio-artifact-id": artifact.id,
        "If-None-Match": "*",
      },
    });
  });

  it("persists a selected disposition name separately from the uploaded filename", async () => {
    const repository = {
      createPending: vi.fn().mockResolvedValue(artifact),
      registerUploadExpiry: vi.fn().mockResolvedValue(undefined),
    };
    const storage = {
      presignPut: vi.fn().mockResolvedValue("https://upload.example.test"),
    };

    await serviceFor(repository, storage).startUpload({
      actorId: "trusted-actor-id",
      ownerId: null,
      artifactProfile: "manual_invoice_pdf_v1",
      filename: "Invoice 42.pdf",
      originalFilename: "scan-2026.pdf",
      mediaType: "application/pdf",
      byteSize: 5,
      checksumSha256: artifact.checksumSha256,
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      documentDate: "2026-09-15",
      reference: "INV-42",
      notes: "Quarterly invoice",
      supplier: "  Northwind Systems  ",
    });

    expect(repository.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "Invoice 42.pdf",
        originalFilename: "scan-2026.pdf",
        periodStart: "2026-07-01",
        periodEnd: "2026-09-30",
        documentDate: "2026-09-15",
        reference: "INV-42",
        notes: "Quarterly invoice",
        supplier: "Northwind Systems",
      }),
    );
  });

  it("rejects a selected filename whose extension differs from its profile", async () => {
    const repository = { createPending: vi.fn() };

    await expect(
      serviceFor(repository, {}).startUpload({
        actorId: "trusted-actor-id",
        ownerId: null,
        artifactProfile: "manual_invoice_pdf_v1",
        filename: "invoice.csv",
        mediaType: "application/pdf",
        byteSize: 5,
        checksumSha256: artifact.checksumSha256,
      }),
    ).rejects.toThrow("Filename extension");
    expect(repository.createPending).not.toHaveBeenCalled();
  });

  it("floors the signing origin so the persisted expiry matches SigV4 precision", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2040-01-01T00:00:00.789Z"));
    try {
      const repository = {
        createPending: vi.fn().mockResolvedValue(artifact),
        registerUploadExpiry: vi.fn(
          async (_id: string, _expiresAt: string) => undefined,
        ),
      };
      const storage = {
        presignPut: vi.fn(
          async (_input: { expiresAt: string }) =>
            "https://upload.example.test",
        ),
      };

      const result = await serviceFor(repository, storage).startUpload({
        actorId: "trusted-actor-id",
        ownerId: null,
        artifactProfile: "manual_invoice_pdf_v1",
        filename: "evidence.pdf",
        mediaType: "application/pdf",
        byteSize: 5,
        checksumSha256: artifact.checksumSha256,
      });

      expect(result.artifact.uploadExpiresAt).toBe("2040-01-01T00:05:00.000Z");
      expect(storage.presignPut.mock.calls[0]?.[0].expiresAt).toBe(
        repository.registerUploadExpiry.mock.calls[0]?.[1],
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("renews upload expiry and presigns a fresh URL on an idempotent replay", async () => {
    const repository = {
      createPendingUploadIntent: vi
        .fn()
        .mockResolvedValueOnce({ status: "created", artifact })
        .mockResolvedValueOnce({ status: "replayed", artifact }),
      registerUploadExpiry: vi.fn().mockResolvedValue(undefined),
    };
    const storage = {
      presignPut: vi
        .fn()
        .mockResolvedValueOnce("https://upload.example.test/first")
        .mockResolvedValueOnce("https://upload.example.test/retry"),
    };
    const service = serviceFor(repository, storage);

    const first = await service.startIdempotentUpload(idempotentInput);
    const replay = await service.startIdempotentUpload({
      ...idempotentInput,
      originalFilename: null,
      periodStart: null,
      periodEnd: null,
      documentDate: null,
      reference: null,
      notes: null,
      supplier: "   ",
    });

    expect(first).toMatchObject({
      status: "upload_ready",
      artifact: { id: artifact.id },
      uploadUrl: "https://upload.example.test/first",
      replayed: false,
    });
    expect(replay).toMatchObject({
      status: "upload_ready",
      artifact: { id: artifact.id },
      uploadUrl: "https://upload.example.test/retry",
      replayed: true,
    });
    expect(
      first.status === "upload_ready" && first.artifact.uploadExpiresAt,
    ).toBeTruthy();
    expect(
      replay.status === "upload_ready" && replay.artifact.uploadExpiresAt,
    ).toBeTruthy();
    expect(repository.registerUploadExpiry).toHaveBeenCalledTimes(2);
    expect(storage.presignPut).toHaveBeenCalledTimes(2);
    expect(
      repository.createPendingUploadIntent.mock.calls[0]![0].payloadSha256,
    ).toBe(
      repository.createPendingUploadIntent.mock.calls[1]![0].payloadSha256,
    );
    expect(
      repository.createPendingUploadIntent.mock.calls[0]![0].payloadSha256,
    ).toBe(
      createHash("sha256")
        .update(
          JSON.stringify([
            "folio-mcp-upload-v1",
            idempotentInput.artifactProfile,
            idempotentInput.filename,
            idempotentInput.byteSize,
            idempotentInput.checksumSha256,
          ]),
        )
        .digest("hex"),
    );
    expect(
      repository.createPendingUploadIntent.mock.calls[0]![0],
    ).toMatchObject({
      filename: "evidence.pdf",
      originalFilename: "evidence.pdf",
      periodStart: null,
      periodEnd: null,
      documentDate: null,
      reference: null,
      notes: null,
      supplier: null,
    });
  });

  it("persists normalized upload metadata under a stable v2 fingerprint", async () => {
    const repository = {
      createPendingUploadIntent: vi
        .fn()
        .mockResolvedValue({ status: "created", artifact }),
      registerUploadExpiry: vi.fn().mockResolvedValue(undefined),
    };
    const storage = {
      presignPut: vi.fn().mockResolvedValue("https://upload.example.test"),
    };
    const service = serviceFor(repository, storage);
    const metadataInput = {
      ...idempotentInput,
      filename: "  invoice Q3.pdf  ",
      originalFilename: "invoice-original.pdf",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      documentDate: "2026-10-01",
      reference: "  INV-42  ",
      notes: "  Reviewed by finance  ",
      supplier: "  Northwind Systems  ",
    };

    await service.startIdempotentUpload(metadataInput);
    await service.startIdempotentUpload({
      ...metadataInput,
      filename: "invoice Q3.pdf",
      reference: "INV-42",
      notes: "Reviewed by finance",
      supplier: "Northwind Systems",
    });
    await service.startIdempotentUpload({
      ...metadataInput,
      supplier: "Other supplier",
    });

    const createCalls = repository.createPendingUploadIntent.mock.calls;
    expect(createCalls[0]![0]).toMatchObject({
      filename: "invoice Q3.pdf",
      originalFilename: "invoice-original.pdf",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      documentDate: "2026-10-01",
      reference: "INV-42",
      notes: "Reviewed by finance",
      supplier: "Northwind Systems",
    });
    expect(createCalls[0]![0].payloadSha256).toBe(
      createCalls[1]![0].payloadSha256,
    );
    expect(createCalls[2]![0].payloadSha256).not.toBe(
      createCalls[0]![0].payloadSha256,
    );
    expect(createCalls[0]![0].payloadSha256).toBe(
      createHash("sha256")
        .update(
          JSON.stringify([
            "folio-mcp-upload-v2",
            idempotentInput.artifactProfile,
            "invoice Q3.pdf",
            "invoice-original.pdf",
            "2026-07-01",
            "2026-09-30",
            "2026-10-01",
            "INV-42",
            "Reviewed by finance",
            "Northwind Systems",
            idempotentInput.byteSize,
            idempotentInput.checksumSha256,
          ]),
        )
        .digest("hex"),
    );
  });

  it("rejects invalid dates and filename extensions before persistence", async () => {
    const repository = { createPendingUploadIntent: vi.fn() };
    const storage = { presignPut: vi.fn() };
    const service = serviceFor(repository, storage);

    await expect(
      service.startIdempotentUpload({
        ...idempotentInput,
        documentDate: "2026-02-30",
      }),
    ).rejects.toThrow();
    await expect(
      service.startIdempotentUpload({
        ...idempotentInput,
        periodStart: "2026-10-01",
        periodEnd: "2026-09-30",
      }),
    ).rejects.toThrow();
    await expect(
      service.startIdempotentUpload({
        ...idempotentInput,
        filename: "evidence.txt",
      }),
    ).rejects.toThrow();
    expect(repository.createPendingUploadIntent).not.toHaveBeenCalled();
    expect(storage.presignPut).not.toHaveBeenCalled();
  });

  it("does not sign a URL if the pending-only expiry registration fails", async () => {
    const failure = new Error("upload expiry could not be registered");
    const repository = {
      createPendingUploadIntent: vi
        .fn()
        .mockResolvedValue({ status: "created", artifact }),
      registerUploadExpiry: vi.fn().mockRejectedValue(failure),
    };
    const storage = { presignPut: vi.fn() };

    await expect(
      serviceFor(repository, storage).startIdempotentUpload(idempotentInput),
    ).rejects.toBe(failure);
    expect(storage.presignPut).not.toHaveBeenCalled();
  });

  it("keeps a durable idempotent intent when URL presigning fails", async () => {
    const failure = new Error("synthetic presign failure");
    const repository = {
      createPendingUploadIntent: vi
        .fn()
        .mockResolvedValue({ status: "created", artifact }),
      registerUploadExpiry: vi.fn().mockResolvedValue(undefined),
      abandonPendingArtifact: vi.fn(),
    };
    const storage = { presignPut: vi.fn().mockRejectedValue(failure) };

    await expect(
      serviceFor(repository, storage).startIdempotentUpload(idempotentInput),
    ).rejects.toBe(failure);
    expect(repository.registerUploadExpiry).toHaveBeenCalledOnce();
    expect(repository.abandonPendingArtifact).not.toHaveBeenCalled();
  });

  it("returns a no-URL status for an intent that is no longer pending", async () => {
    const repository = {
      createPendingUploadIntent: vi.fn().mockResolvedValue({
        status: "not_uploadable",
        artifactId: artifact.id,
        artifactState: "awaiting_review",
      }),
      registerUploadExpiry: vi.fn(),
    };
    const storage = { presignPut: vi.fn() };

    await expect(
      serviceFor(repository, storage).startIdempotentUpload(idempotentInput),
    ).resolves.toEqual({
      status: "intent_not_uploadable",
      artifactId: artifact.id,
      artifactState: "awaiting_review",
    });
    expect(repository.registerUploadExpiry).not.toHaveBeenCalled();
    expect(storage.presignPut).not.toHaveBeenCalled();
  });

  it("abandons a non-idempotent pending artifact when expiry registration fails", async () => {
    const failure = new Error("upload expiry could not be registered");
    const repository = {
      createPending: vi.fn().mockResolvedValue(artifact),
      registerUploadExpiry: vi.fn().mockRejectedValue(failure),
      abandonPendingArtifact: vi.fn().mockResolvedValue(undefined),
    };
    const storage = { presignPut: vi.fn() };

    await expect(
      serviceFor(repository, storage).startUpload({
        actorId: "trusted-actor-id",
        ownerId: null,
        artifactProfile: "manual_invoice_pdf_v1",
        filename: "evidence.pdf",
        mediaType: "application/pdf",
        byteSize: 5,
        checksumSha256: artifact.checksumSha256,
      }),
    ).rejects.toBe(failure);
    expect(repository.abandonPendingArtifact).toHaveBeenCalledWith(artifact.id);
    expect(storage.presignPut).not.toHaveBeenCalled();
  });

  it("preserves the signing error if abandonment also fails", async () => {
    const signingFailure = new Error("synthetic presign failure");
    const cleanupFailure = new Error("synthetic abandonment failure");
    const repository = {
      createPending: vi.fn().mockResolvedValue(artifact),
      registerUploadExpiry: vi.fn().mockResolvedValue(undefined),
      abandonPendingArtifact: vi.fn().mockRejectedValue(cleanupFailure),
    };
    const storage = { presignPut: vi.fn().mockRejectedValue(signingFailure) };

    await expect(
      serviceFor(repository, storage).startUpload({
        actorId: "trusted-actor-id",
        ownerId: null,
        artifactProfile: "manual_invoice_pdf_v1",
        filename: "evidence.pdf",
        mediaType: "application/pdf",
        byteSize: 5,
        checksumSha256: artifact.checksumSha256,
      }),
    ).rejects.toMatchObject({
      cause: signingFailure,
      artifactId: artifact.id,
      cleanupError: cleanupFailure,
      message: signingFailure.message,
    } satisfies Partial<ArtifactPresignRecoveryError>);
  });
});

describe("artifact metadata updates", () => {
  it("updates a confirmed CSV filename and coverage with expected metadata", async () => {
    const current: ArtifactRecord = {
      ...artifact,
      artifactProfile: "commbank_transaction_history_csv_v1",
      objectKey: "private/bank/object",
      filename: "statement.csv",
      originalFilename: "source-statement.csv",
      confirmedAt: "2026-10-01T00:00:00.000Z",
      mediaType: "text/csv",
      state: "available",
      periodStart: null,
      periodEnd: null,
    };
    const updated = {
      ...current,
      filename: "October statement.csv",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    };
    const repository = {
      requireActiveActorId: vi.fn(),
      getArtifact: vi.fn().mockResolvedValue(current),
      updateArtifactMetadata: vi.fn().mockResolvedValue(updated),
    };
    const input = {
      id: current.id,
      filename: " October statement.csv ",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      expected: {
        filename: "statement.csv",
        periodStart: null,
        periodEnd: null,
      },
    };

    await expect(
      serviceFor(repository, {}).updateMetadata("trusted-actor-id", input),
    ).resolves.toEqual(updated);
    expect(repository.requireActiveActorId).toHaveBeenCalledWith(
      "trusted-actor-id",
    );
    expect(repository.updateArtifactMetadata).toHaveBeenCalledWith({
      ...input,
      filename: "October statement.csv",
    });
  });

  it("allows a PDF rename only when coverage is preserved", async () => {
    const current: ArtifactRecord = {
      ...artifact,
      filename: "invoice.pdf",
      confirmedAt: "2026-10-01T00:00:00.000Z",
      state: "awaiting_review",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    };
    const updated = { ...current, filename: "renamed-invoice.pdf" };
    const repository = {
      requireActiveActorId: vi.fn(),
      getArtifact: vi.fn().mockResolvedValue(current),
      updateArtifactMetadata: vi.fn().mockResolvedValue(updated),
    };
    const input = {
      id: current.id,
      filename: "renamed-invoice.pdf",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      expected: {
        filename: "invoice.pdf",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
      },
    };

    await expect(
      serviceFor(repository, {}).updateMetadata("trusted-actor-id", input),
    ).resolves.toEqual(updated);
    expect(repository.updateArtifactMetadata).toHaveBeenCalledWith(input);
  });

  it("rejects PDF coverage changes and filename extensions outside the profile", async () => {
    const current: ArtifactRecord = {
      ...artifact,
      filename: "invoice.pdf",
      confirmedAt: "2026-10-01T00:00:00.000Z",
      state: "available",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    };
    const repository = {
      requireActiveActorId: vi.fn(),
      getArtifact: vi.fn().mockResolvedValue(current),
      updateArtifactMetadata: vi.fn(),
    };
    const service = serviceFor(repository, {});
    const input = {
      id: current.id,
      filename: "renamed.pdf",
      periodStart: "2026-10-02",
      periodEnd: "2026-10-31",
      expected: {
        filename: "invoice.pdf",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
      },
    };

    await expect(
      service.updateMetadata("trusted-actor-id", input),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    await expect(
      service.updateMetadata("trusted-actor-id", {
        ...input,
        filename: "renamed.csv",
        periodStart: "2026-10-01",
      }),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(repository.updateArtifactMetadata).not.toHaveBeenCalled();
  });

  it.each([
    { state: "pending", confirmedAt: null },
    { state: "rejected", confirmedAt: "2026-10-01T00:00:00.000Z" },
  ] as const)(
    "rejects metadata updates for $state artifacts",
    async (status) => {
      const repository = {
        requireActiveActorId: vi.fn(),
        getArtifact: vi.fn().mockResolvedValue({ ...artifact, ...status }),
        updateArtifactMetadata: vi.fn(),
      };

      await expect(
        serviceFor(repository, {}).updateMetadata("trusted-actor-id", {
          id: artifact.id,
          filename: "renamed.pdf",
          periodStart: null,
          periodEnd: null,
          expected: {
            filename: "invoice.pdf",
            periodStart: null,
            periodEnd: null,
          },
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_METADATA_CONFLICT" });
      expect(repository.updateArtifactMetadata).not.toHaveBeenCalled();
    },
  );

  it("classifies a missing artifact as a metadata conflict", async () => {
    const repository = {
      requireActiveActorId: vi.fn(),
      getArtifact: vi.fn().mockResolvedValue(null),
      updateArtifactMetadata: vi.fn(),
    };

    await expect(
      serviceFor(repository, {}).updateMetadata("trusted-actor-id", {
        id: artifact.id,
        filename: "renamed.pdf",
        periodStart: null,
        periodEnd: null,
        expected: {
          filename: "invoice.pdf",
          periodStart: null,
          periodEnd: null,
        },
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_METADATA_CONFLICT" });
    expect(repository.updateArtifactMetadata).not.toHaveBeenCalled();
  });
});

describe("document confirmation and reads", () => {
  it("confirms only a matching unversioned object and records the checksum", async () => {
    const confirmed: ArtifactRecord = {
      ...artifact,
      state: "awaiting_review",
      confirmedAt: "2040-01-01T00:00:00.000Z",
    };
    const repository = {
      getArtifact: vi
        .fn()
        .mockResolvedValueOnce(artifact)
        .mockResolvedValueOnce(confirmed),
      requireActiveActorId: vi.fn(),
      confirmAwaitingReview: vi.fn().mockResolvedValue(undefined),
    };
    const storage = {
      head: vi.fn().mockResolvedValue(headFor(artifact)),
      readPrefix: vi.fn().mockResolvedValue(Buffer.from("%PDF-")),
    };

    await expect(
      serviceFor(repository, storage).confirmUpload("actor-id", artifact.id),
    ).resolves.toEqual(confirmed);
    expect(storage.head).toHaveBeenCalledWith("test", artifact.objectKey);
    expect(storage.readPrefix).toHaveBeenCalledWith(
      "test",
      artifact.objectKey,
      5,
    );
    expect(repository.confirmAwaitingReview).toHaveBeenCalledWith(
      artifact.id,
      artifact.checksumSha256,
    );
  });

  it("rechecks a confirmed upload on retry without confirming it twice", async () => {
    const confirmed: ArtifactRecord = {
      ...artifact,
      state: "awaiting_review",
      confirmedAt: "2040-01-01T00:00:00.000Z",
    };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(confirmed),
      requireActiveActorId: vi.fn(),
      confirmAwaitingReview: vi.fn(),
    };
    const storage = {
      head: vi.fn().mockResolvedValue(headFor(confirmed)),
      readPrefix: vi.fn().mockResolvedValue(Buffer.from("%PDF-")),
    };

    await expect(
      serviceFor(repository, storage).confirmUpload("actor-id", confirmed.id),
    ).resolves.toEqual(confirmed);
    expect(storage.head).toHaveBeenCalledOnce();
    expect(repository.confirmAwaitingReview).not.toHaveBeenCalled();
  });

  it("confirms a bank activity CSV for review without importing it", async () => {
    const csvArtifact: ArtifactRecord = {
      ...artifact,
      artifactProfile: "nab_transaction_history_csv_v1",
      mediaType: "text/csv",
      byteSize: "10",
    };
    const confirmed: ArtifactRecord = {
      ...csvArtifact,
      state: "awaiting_review",
      confirmedAt: "2040-01-01T00:00:00.000Z",
    };
    const repository = {
      getArtifact: vi
        .fn()
        .mockResolvedValueOnce(csvArtifact)
        .mockResolvedValueOnce(confirmed),
      requireActiveActorId: vi.fn(),
      confirmAwaitingReview: vi.fn(),
    };
    const storage = {
      head: vi.fn().mockResolvedValue(headFor(csvArtifact)),
      readPrefix: vi.fn(),
    };

    await expect(
      serviceFor(repository, storage).confirmUpload("actor-id", csvArtifact.id),
    ).resolves.toEqual(confirmed);
    expect(repository.confirmAwaitingReview).toHaveBeenCalledWith(
      csvArtifact.id,
      csvArtifact.checksumSha256,
    );
    expect(storage.readPrefix).not.toHaveBeenCalled();
  });

  it.each([
    { contentLength: 4 },
    { contentType: "text/plain" },
    { checksumSha256: "different-checksum" },
    { metadata: { "folio-artifact-id": "different-artifact" } },
  ])(
    "rejects an upload head mismatch before confirmation: %j",
    async (mismatch) => {
      const repository = {
        getArtifact: vi.fn().mockResolvedValue(artifact),
        requireActiveActorId: vi.fn(),
        confirmAwaitingReview: vi.fn(),
      };
      const storage = {
        head: vi.fn().mockResolvedValue({ ...headFor(artifact), ...mismatch }),
        readPrefix: vi.fn(),
      };

      await expect(
        serviceFor(repository, storage).confirmUpload("actor-id", artifact.id),
      ).rejects.toThrow("metadata");
      expect(repository.confirmAwaitingReview).not.toHaveBeenCalled();
      expect(storage.readPrefix).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid PDF signature before confirmation", async () => {
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(artifact),
      requireActiveActorId: vi.fn(),
      confirmAwaitingReview: vi.fn(),
    };
    const storage = {
      head: vi.fn().mockResolvedValue(headFor(artifact)),
      readPrefix: vi.fn().mockResolvedValue(Buffer.from("not-pdf")),
    };

    await expect(
      serviceFor(repository, storage).confirmUpload("actor-id", artifact.id),
    ).rejects.toThrow("PDF signature");
    expect(repository.confirmAwaitingReview).not.toHaveBeenCalled();
  });

  it("checks actor activity before reading a pending object", async () => {
    const repository = {
      requireActiveActorId: vi
        .fn()
        .mockRejectedValue(new Error("Inactive actor")),
      getArtifact: vi.fn(),
      confirmAwaitingReview: vi.fn(),
    };
    const storage = { head: vi.fn(), readPrefix: vi.fn() };

    await expect(
      serviceFor(repository, storage).confirmUpload("actor-id", artifact.id),
    ).rejects.toThrow("Inactive actor");
    expect(repository.getArtifact).not.toHaveBeenCalled();
    expect(storage.head).not.toHaveBeenCalled();
  });

  it("reads a confirmed CSV only after validating head metadata and all bytes", async () => {
    const bytes = Buffer.from("01/01/2026,-1.00,TEST,9.00\n");
    const csvArtifact: ArtifactRecord = {
      ...artifact,
      artifactProfile: "commbank_transaction_history_csv_v1",
      objectKey: "private/csv/object",
      confirmedAt: "2040-01-01T00:00:00.000Z",
      mediaType: "text/csv",
      byteSize: String(bytes.byteLength),
      checksumSha256: checksumFor(bytes),
      state: "awaiting_review",
    };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(csvArtifact),
      requireActiveActorId: vi.fn(),
    };
    const storage = {
      head: vi.fn().mockResolvedValue(headFor(csvArtifact)),
      readPrefix: vi.fn().mockResolvedValue(bytes),
    };

    await expect(
      serviceFor(repository, storage).readReviewText(
        "actor-id",
        csvArtifact.id,
        "commbank_transaction_history_csv_v1",
      ),
    ).resolves.toEqual({
      artifact: csvArtifact,
      confirmedAt: csvArtifact.confirmedAt,
      text: bytes.toString(),
    });
    expect(storage.readPrefix).toHaveBeenCalledWith(
      "test",
      csvArtifact.objectKey,
      bytes.byteLength,
    );
  });

  it("rejects altered CSV bytes even when object metadata matches", async () => {
    const bytes = Buffer.from("expected,csv\n");
    const csvArtifact: ArtifactRecord = {
      ...artifact,
      artifactProfile: "stripe_balance_itemised_csv_v1",
      confirmedAt: "2040-01-01T00:00:00.000Z",
      mediaType: "text/csv",
      byteSize: String(bytes.byteLength),
      checksumSha256: checksumFor(bytes),
      state: "available",
    };
    const storage = {
      head: vi.fn().mockResolvedValue(headFor(csvArtifact)),
      readPrefix: vi.fn().mockResolvedValue(Buffer.from("altered,csv\n")),
    };

    await expect(
      serviceFor(
        {
          getArtifact: vi.fn().mockResolvedValue(csvArtifact),
          requireActiveActorId: vi.fn(),
        },
        storage,
      ).readAvailableText("actor-id", csvArtifact.id, "stripe_csv"),
    ).rejects.toThrow("checksum");
  });

  it("requires invoice evidence profile for approval and passes its checksum", async () => {
    const reviewable: ArtifactRecord = {
      ...artifact,
      state: "awaiting_review",
      confirmedAt: "2040-01-01T00:00:00.000Z",
    };
    const available: ArtifactRecord = { ...reviewable, state: "available" };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(reviewable),
      requireActiveActorId: vi.fn(),
      approveArtifact: vi.fn().mockResolvedValue(available),
    };
    const service = serviceFor(repository, {});

    await expect(
      service.approveArtifact("actor-id", artifact.id),
    ).resolves.toEqual(available);
    expect(repository.approveArtifact).toHaveBeenCalledWith(
      artifact.id,
      artifact.checksumSha256,
    );
  });

  it("rejects reviewable CSV artifacts by confirmed checksum", async () => {
    const csvArtifact: ArtifactRecord = {
      ...artifact,
      artifactProfile: "commbank_transaction_history_csv_v1",
      mediaType: "text/csv",
      filename: "original.csv",
      state: "awaiting_review",
      confirmedAt: "2040-01-01T00:00:00.000Z",
    };
    const rejected = { ...csvArtifact, state: "rejected" as const };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(csvArtifact),
      requireActiveActorId: vi.fn(),
      rejectArtifact: vi.fn().mockResolvedValue(rejected),
    };

    await expect(
      serviceFor(repository, {}).rejectArtifact("actor-id", csvArtifact.id),
    ).resolves.toEqual(rejected);
    expect(repository.rejectArtifact).toHaveBeenCalledWith(
      csvArtifact.id,
      csvArtifact.checksumSha256,
    );
  });

  it("does not reject a pending CSV artifact", async () => {
    const csvArtifact: ArtifactRecord = {
      ...artifact,
      artifactProfile: "stripe_balance_itemised_csv_v1",
      mediaType: "text/csv",
    };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(csvArtifact),
      requireActiveActorId: vi.fn(),
      rejectArtifact: vi.fn(),
    };

    await expect(
      serviceFor(repository, {}).rejectArtifact("actor-id", csvArtifact.id),
    ).rejects.toThrow("Rejectable artifact not found");
    expect(repository.rejectArtifact).not.toHaveBeenCalled();
  });

  it("checks object integrity before signing an available download", async () => {
    const available: ArtifactRecord = {
      ...artifact,
      filename: "Stripe-2026-01-01-2026-01-02.csv",
      originalFilename: "original.csv",
      mediaType: "text/csv",
      state: "available",
      confirmedAt: "2040-01-01T00:00:00.000Z",
    };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(available),
      requireActiveActorId: vi.fn(),
    };
    const storage = {
      head: vi.fn().mockResolvedValue(headFor(available)),
      presignGet: vi.fn().mockResolvedValue("https://download.example.test"),
    };

    await expect(
      serviceFor(repository, storage).download("actor-id", available.id),
    ).resolves.toBe("https://download.example.test");
    expect(storage.presignGet).toHaveBeenCalledWith(
      "test",
      available.objectKey,
      "Stripe-2026-01-01-2026-01-02.csv",
    );
  });

  it.each(["awaiting_review", "available"] as const)(
    "allows review preview for a %s bank PDF after checking its signature",
    async (state) => {
      const statement: ArtifactRecord = {
        ...artifact,
        artifactProfile: "commbank_statement_pdf_v1",
        filename: "Selected statement.pdf",
        originalFilename: "source.pdf",
        state,
        confirmedAt: "2040-01-01T00:00:00.000Z",
      };
      const repository = {
        getArtifact: vi.fn().mockResolvedValue(statement),
        requireActiveActorId: vi.fn(),
      };
      const storage = {
        head: vi.fn().mockResolvedValue(headFor(statement)),
        readPrefix: vi.fn().mockResolvedValue(Buffer.from("%PDF-")),
        presignInline: vi.fn().mockResolvedValue("https://review.example.test"),
      };

      await expect(
        serviceFor(repository, storage).previewArtifactForReview(
          "actor-id",
          statement.id,
        ),
      ).resolves.toBe("https://review.example.test");
      expect(storage.readPrefix).toHaveBeenCalledWith(
        "test",
        statement.objectKey,
        5,
      );
      expect(storage.presignInline).toHaveBeenCalledWith(
        "test",
        statement.objectKey,
        "Selected statement.pdf",
      );
    },
  );

  it("does not approve a non-invoice PDF as invoice evidence", async () => {
    const statement: ArtifactRecord = {
      ...artifact,
      artifactProfile: "commbank_statement_pdf_v1",
      state: "awaiting_review",
      confirmedAt: "2040-01-01T00:00:00.000Z",
    };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(statement),
      requireActiveActorId: vi.fn(),
      approveArtifact: vi.fn(),
    };

    await expect(
      serviceFor(repository, {}).approveArtifact("actor-id", statement.id),
    ).rejects.toThrow("Reviewable PDF artifact not found");
    expect(repository.approveArtifact).not.toHaveBeenCalled();
  });
});

describe("artifact deletion lifecycle", () => {
  it("does not delete stored bytes when the deletion claim is rejected", async () => {
    const failure = new Error(
      "Cannot delete an artifact referenced by a transaction or bank row",
    );
    const repository = {
      requireActiveActorId: vi.fn(),
      claimArtifactDeletion: vi.fn().mockRejectedValue(failure),
      deleteClaimedArtifact: vi.fn(),
    };
    const storage = { deleteObject: vi.fn() };

    await expect(
      serviceFor(repository, storage).deleteArtifact("actor-id", artifact.id),
    ).rejects.toBe(failure);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(repository.deleteClaimedArtifact).not.toHaveBeenCalled();
  });

  it("tombstones first and defers deletion until upload expiry plus grace", async () => {
    const retryAfter = new Date(Date.now() + 60_000 * 10).toISOString();
    const deleting: ArtifactRecord = {
      ...artifact,
      state: "deleting",
      uploadExpiresAt: new Date(
        Date.parse(retryAfter) - UPLOAD_EXPIRY_GRACE_SECONDS * 1000,
      ).toISOString(),
    };
    const repository = {
      requireActiveActorId: vi.fn(),
      claimArtifactDeletion: vi.fn().mockResolvedValue(deleting),
      deleteClaimedArtifact: vi.fn(),
    };
    const storage = { deleteObject: vi.fn() };

    await expect(
      serviceFor(repository, storage).deleteArtifact("actor-id", deleting.id),
    ).resolves.toEqual({ status: "deferred", retryAfter });
    expect(repository.claimArtifactDeletion).toHaveBeenCalledWith(deleting.id);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(repository.deleteClaimedArtifact).not.toHaveBeenCalled();
  });

  it("deletes only the claimed key after the expiry grace and finalizes the claim", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2040-01-01T00:01:01.000Z"));
    try {
      const deleting: ArtifactRecord = {
        ...artifact,
        state: "deleting",
        uploadExpiresAt: "2040-01-01T00:00:00.000Z",
      };
      const repository = {
        requireActiveActorId: vi.fn(),
        claimArtifactDeletion: vi.fn().mockResolvedValue(deleting),
        deleteClaimedArtifact: vi.fn().mockResolvedValue(undefined),
      };
      const storage = { deleteObject: vi.fn().mockResolvedValue(undefined) };

      await expect(
        serviceFor(repository, storage).deleteArtifact("actor-id", deleting.id),
      ).resolves.toEqual({ status: "deleted" });
      expect(storage.deleteObject).toHaveBeenCalledWith(
        "test",
        deleting.objectKey,
      );
      expect(repository.deleteClaimedArtifact).toHaveBeenCalledWith(
        deleting.id,
        deleting.objectKey,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a tombstone retryable after storage failure", async () => {
    const deleting: ArtifactRecord = {
      ...artifact,
      state: "deleting",
      uploadExpiresAt: null,
    };
    const failure = new Error("storage unavailable");
    const repository = {
      requireActiveActorId: vi.fn(),
      claimArtifactDeletion: vi.fn().mockResolvedValue(deleting),
      deleteClaimedArtifact: vi.fn().mockResolvedValue(undefined),
    };
    const storage = {
      deleteObject: vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(undefined),
    };
    const service = serviceFor(repository, storage);

    await expect(service.deleteArtifact("actor-id", deleting.id)).rejects.toBe(
      failure,
    );
    expect(repository.deleteClaimedArtifact).not.toHaveBeenCalled();
    await expect(
      service.deleteArtifact("actor-id", deleting.id),
    ).resolves.toEqual({ status: "deleted" });
    expect(repository.claimArtifactDeletion).toHaveBeenCalledTimes(2);
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(repository.deleteClaimedArtifact).toHaveBeenCalledWith(
      deleting.id,
      deleting.objectKey,
    );
  });
});
