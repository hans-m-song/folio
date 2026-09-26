import { describe, expect, it, vi } from "vitest";

import {
  ArtifactPresignRecoveryError,
  DocumentService,
  type ArtifactRecord,
  type ArtifactRepository,
} from "./service";
import type { ObjectStorage } from "./storage";

const artifact: ArtifactRecord = {
  id: "0f935296-35b3-43bd-bc3d-0caa0b0a2510",
  kind: "pdf",
  objectKey: "private/pdf/object",
  versionId: null,
  mediaType: "application/pdf",
  byteSize: "5",
  checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  state: "pending",
};

describe("document upload confirmation", () => {
  it("attributes a new upload to the trusted actor ID", async () => {
    const repository = {
      createPending: vi.fn().mockResolvedValue(artifact),
    } as unknown as ArtifactRepository;
    const storage = {
      presignPut: vi.fn().mockResolvedValue("https://upload.example.test"),
    } as unknown as ObjectStorage;
    await new DocumentService(repository, storage, {
      bucket: "test",
      prefix: "private/",
      maxUploadBytes: 10,
    }).startUpload({
      actorId: "trusted-actor-id",
      ownerId: null,
      kind: "pdf",
      filename: "evidence.pdf",
      mediaType: "application/pdf",
      byteSize: 5,
      checksumSha256: artifact.checksumSha256,
    });
    expect(repository.createPending).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "trusted-actor-id", ownerId: null }),
    );
  });

  it("replays a durable pending upload intent with the same artifact and a fresh URL", async () => {
    const repository = {
      createPendingUploadIntent: vi
        .fn()
        .mockResolvedValueOnce({ status: "created", artifact })
        .mockResolvedValueOnce({ status: "replayed", artifact }),
    } as unknown as ArtifactRepository;
    const storage = {
      presignPut: vi
        .fn()
        .mockResolvedValueOnce("https://upload.example.test/first")
        .mockResolvedValueOnce("https://upload.example.test/retry"),
    } as unknown as ObjectStorage;
    const service = new DocumentService(repository, storage, {
      bucket: "test",
      prefix: "private/",
      maxUploadBytes: 10,
    });
    const input = {
      credentialId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "upload-request-1",
      actorId: "trusted-actor-id",
      ownerId: "22222222-2222-4222-8222-222222222222",
      artifactProfile: "manual_invoice_pdf_v1" as const,
      filename: " evidence.pdf ",
      mediaType: "application/pdf",
      byteSize: 5,
      checksumSha256: artifact.checksumSha256,
    };

    await expect(service.startIdempotentUpload(input)).resolves.toMatchObject({
      status: "upload_ready",
      artifact: { id: artifact.id },
      uploadUrl: "https://upload.example.test/first",
      replayed: false,
    });
    await expect(
      service.startIdempotentUpload({ ...input, filename: "evidence.pdf" }),
    ).resolves.toMatchObject({
      status: "upload_ready",
      artifact: { id: artifact.id },
      uploadUrl: "https://upload.example.test/retry",
      replayed: true,
    });
    expect(storage.presignPut).toHaveBeenCalledTimes(2);
    expect(repository.createPendingUploadIntent).toHaveBeenCalledTimes(2);
    const first = vi.mocked(repository.createPendingUploadIntent).mock
      .calls[0]![0];
    const second = vi.mocked(repository.createPendingUploadIntent).mock
      .calls[1]![0];
    expect(first.filename).toBe("evidence.pdf");
    expect(first.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second.payloadSha256).toBe(first.payloadSha256);
  });

  it("returns a stable no-URL status when an upload intent is no longer pending", async () => {
    const repository = {
      createPendingUploadIntent: vi.fn().mockResolvedValue({
        status: "not_uploadable",
        artifactId: artifact.id,
        artifactState: "awaiting_review",
      }),
    } as unknown as ArtifactRepository;
    const storage = { presignPut: vi.fn() } as unknown as ObjectStorage;
    const service = new DocumentService(repository, storage, {
      bucket: "test",
      prefix: "private/",
      maxUploadBytes: 10,
    });

    await expect(
      service.startIdempotentUpload({
        credentialId: "11111111-1111-4111-8111-111111111111",
        idempotencyKey: "upload-request-1",
        actorId: "trusted-actor-id",
        ownerId: "22222222-2222-4222-8222-222222222222",
        artifactProfile: "manual_invoice_pdf_v1",
        filename: "evidence.pdf",
        mediaType: "application/pdf",
        byteSize: 5,
        checksumSha256: artifact.checksumSha256,
      }),
    ).resolves.toEqual({
      status: "intent_not_uploadable",
      artifactId: artifact.id,
      artifactState: "awaiting_review",
    });
    expect(storage.presignPut).not.toHaveBeenCalled();
  });

  it("retains a durable pending intent when URL signing fails", async () => {
    const failure = new Error("synthetic presign failure");
    const repository = {
      createPendingUploadIntent: vi
        .fn()
        .mockResolvedValue({ status: "created", artifact }),
      abandonPendingArtifact: vi.fn(),
    } as unknown as ArtifactRepository;
    const storage = {
      presignPut: vi.fn().mockRejectedValue(failure),
    } as unknown as ObjectStorage;
    const service = new DocumentService(repository, storage, {
      bucket: "test",
      prefix: "private/",
      maxUploadBytes: 10,
    });

    await expect(
      service.startIdempotentUpload({
        credentialId: "11111111-1111-4111-8111-111111111111",
        idempotencyKey: "upload-request-1",
        actorId: "trusted-actor-id",
        ownerId: "22222222-2222-4222-8222-222222222222",
        artifactProfile: "manual_invoice_pdf_v1",
        filename: "evidence.pdf",
        mediaType: "application/pdf",
        byteSize: 5,
        checksumSha256: artifact.checksumSha256,
      }),
    ).rejects.toBe(failure);
    expect(repository.abandonPendingArtifact).not.toHaveBeenCalled();
  });

  it("abandons the new pending artifact when presigning fails", async () => {
    const failure = new Error("synthetic presign failure");
    const repository = {
      createPending: vi.fn().mockResolvedValue(artifact),
      abandonPendingArtifact: vi.fn().mockResolvedValue(undefined),
    } as unknown as ArtifactRepository;
    const storage = {
      presignPut: vi.fn().mockRejectedValue(failure),
    } as unknown as ObjectStorage;
    const service = new DocumentService(repository, storage, {
      bucket: "test",
      prefix: "private/",
      maxUploadBytes: 10,
    });
    let received: unknown;
    try {
      await service.startUpload({
        actorId: "trusted-actor-id",
        ownerId: null,
        kind: "pdf",
        filename: "evidence.pdf",
        mediaType: "application/pdf",
        byteSize: 5,
        checksumSha256: artifact.checksumSha256,
      });
    } catch (error) {
      received = error;
    }
    expect(received).toBe(failure);
    expect(repository.abandonPendingArtifact).toHaveBeenCalledWith(artifact.id);
  });

  it("preserves the presign error when abandonment also fails", async () => {
    const failure = new Error("synthetic presign failure");
    const cleanupFailure = Object.assign(
      new Error("synthetic abandonment failure"),
      { code: "08006" },
    );
    const repository = {
      createPending: vi.fn().mockResolvedValue(artifact),
      abandonPendingArtifact: vi.fn().mockRejectedValue(cleanupFailure),
    } as unknown as ArtifactRepository;
    const storage = {
      presignPut: vi.fn().mockRejectedValue(failure),
    } as unknown as ObjectStorage;
    const service = new DocumentService(repository, storage, {
      bucket: "test",
      prefix: "private/",
      maxUploadBytes: 10,
    });
    let received: unknown;
    try {
      await service.startUpload({
        actorId: "trusted-actor-id",
        ownerId: null,
        kind: "pdf",
        filename: "evidence.pdf",
        mediaType: "application/pdf",
        byteSize: 5,
        checksumSha256: artifact.checksumSha256,
      });
    } catch (error) {
      received = error;
    }
    expect(received).toBeInstanceOf(ArtifactPresignRecoveryError);
    expect(received).toMatchObject({
      primaryError: failure,
      artifactId: artifact.id,
      cleanupError: cleanupFailure,
      cause: failure,
      message: failure.message,
    });
  });

  it("pins metadata and signature verification to the discovered version", async () => {
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(artifact),
      requireActiveActorId: vi.fn(),
      confirmAwaitingReview: vi.fn(),
    } as unknown as ArtifactRepository;
    const storage = {
      latestVersionId: vi.fn().mockResolvedValue("v1"),
      headVersion: vi.fn().mockResolvedValue({
        contentLength: 5,
        contentType: "application/pdf",
        checksumSha256: artifact.checksumSha256,
        versionId: "v1",
        metadata: { "folio-artifact-id": artifact.id },
      }),
      readPrefix: vi.fn().mockResolvedValue(Buffer.from("%PDF-")),
    } as unknown as ObjectStorage;
    await expect(
      new DocumentService(repository, storage, {
        bucket: "test",
        prefix: "private/",
        maxUploadBytes: 10,
      }).confirmUpload("actor-id", artifact.id),
    ).resolves.toMatchObject({ state: "awaiting_review", versionId: "v1" });
    expect(storage.headVersion).toHaveBeenCalledWith(
      "test",
      artifact.objectKey,
      "v1",
    );
    expect(storage.readPrefix).toHaveBeenCalledWith(
      "test",
      artifact.objectKey,
      "v1",
      5,
    );
    expect(repository.confirmAwaitingReview).toHaveBeenCalledWith(
      artifact.id,
      "v1",
    );
    expect(repository.requireActiveActorId).toHaveBeenCalledWith("actor-id");
  });

  it("rejects mismatched metadata before availability", async () => {
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(artifact),
      requireActiveActorId: vi.fn(),
      confirmAwaitingReview: vi.fn(),
    } as unknown as ArtifactRepository;
    const storage = {
      latestVersionId: vi.fn().mockResolvedValue("v1"),
      headVersion: vi.fn().mockResolvedValue({
        contentLength: 4,
        versionId: "v1",
      }),
    } as unknown as ObjectStorage;
    await expect(
      new DocumentService(repository, storage, {
        bucket: "test",
        prefix: "private/",
        maxUploadBytes: 10,
      }).confirmUpload("actor-id", artifact.id),
    ).rejects.toThrow("does not match");
    expect(repository.confirmAwaitingReview).not.toHaveBeenCalled();
  });

  it("returns the pinned awaiting-review result when confirmation is retried", async () => {
    const awaitingReview: ArtifactRecord = {
      ...artifact,
      state: "awaiting_review",
      versionId: "version-1",
    };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(awaitingReview),
      requireActiveActorId: vi.fn(),
      confirmAwaitingReview: vi.fn(),
    } as unknown as ArtifactRepository;
    const storage = {
      latestVersionId: vi.fn(),
    } as unknown as ObjectStorage;

    await expect(
      new DocumentService(repository, storage, {
        bucket: "test",
        prefix: "private/",
        maxUploadBytes: 10,
      }).confirmUpload("actor-id", artifact.id),
    ).resolves.toEqual(awaitingReview);
    expect(storage.latestVersionId).not.toHaveBeenCalled();
    expect(repository.confirmAwaitingReview).not.toHaveBeenCalled();
  });

  it("previews and explicitly approves the pinned PDF version", async () => {
    const awaitingReview: ArtifactRecord = {
      ...artifact,
      state: "awaiting_review",
      versionId: "version-1",
      originalFilename: "invoice.pdf",
    };
    const available = { ...awaitingReview, state: "available" as const };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(awaitingReview),
      requireActiveActorId: vi.fn(),
      approveArtifact: vi.fn().mockResolvedValue(available),
    } as unknown as ArtifactRepository;
    const storage = {
      presignInline: vi.fn().mockResolvedValue("https://review.example.test"),
    } as unknown as ObjectStorage;
    const service = new DocumentService(repository, storage, {
      bucket: "test",
      prefix: "private/",
      maxUploadBytes: 10,
    });

    await expect(
      service.previewArtifactForReview("actor-id", artifact.id),
    ).resolves.toBe("https://review.example.test");
    expect(storage.presignInline).toHaveBeenCalledWith(
      "test",
      artifact.objectKey,
      "version-1",
      "invoice.pdf",
    );
    await expect(
      service.approveArtifact("actor-id", artifact.id),
    ).resolves.toEqual(available);
    expect(repository.approveArtifact).toHaveBeenCalledWith(
      artifact.id,
      "version-1",
    );
  });

  it("does not approve a non-invoice PDF as transaction evidence", async () => {
    const statement: ArtifactRecord = {
      ...artifact,
      artifactProfile: "commbank_statement_pdf_v1",
      kind: undefined,
      state: "awaiting_review",
      versionId: "version-1",
    };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(statement),
      requireActiveActorId: vi.fn(),
      approveArtifact: vi.fn(),
    } as unknown as ArtifactRepository;
    const storage = {
      presignInline: vi.fn().mockResolvedValue("https://review.example.test"),
    } as unknown as ObjectStorage;
    const service = new DocumentService(repository, storage, {
      bucket: "test",
      prefix: "private/",
      maxUploadBytes: 10,
    });

    await expect(
      service.previewArtifactForReview("actor-id", statement.id),
    ).resolves.toBe("https://review.example.test");
    await expect(
      service.approveArtifact("actor-id", statement.id),
    ).rejects.toThrow("Reviewable PDF artifact not found");
    expect(repository.approveArtifact).not.toHaveBeenCalled();
  });

  it("confirms a bank activity profile into review without importing it", async () => {
    const bankArtifact: ArtifactRecord = {
      ...artifact,
      artifactProfile: "commbank_transaction_history_csv_v1",
      kind: undefined,
      mediaType: "text/csv",
    };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(bankArtifact),
      requireActiveActorId: vi.fn(),
      confirmAwaitingReview: vi.fn(),
    } as unknown as ArtifactRepository;
    const storage = {
      latestVersionId: vi.fn().mockResolvedValue("pinned-version"),
      headVersion: vi.fn().mockResolvedValue({
        contentLength: 5,
        contentType: "text/csv",
        checksumSha256: bankArtifact.checksumSha256,
        versionId: "pinned-version",
        metadata: { "folio-artifact-id": bankArtifact.id },
      }),
    } as unknown as ObjectStorage;
    await expect(
      new DocumentService(repository, storage, {
        bucket: "test",
        prefix: "private/",
        maxUploadBytes: 10,
      }).confirmUpload("actor-id", bankArtifact.id),
    ).resolves.toMatchObject({
      state: "awaiting_review",
      versionId: "pinned-version",
    });
    expect(repository.confirmAwaitingReview).toHaveBeenCalledWith(
      bankArtifact.id,
      "pinned-version",
    );
  });

  it("reads only the verified immutable version for bank preview and confirmation", async () => {
    const csv = Buffer.from("01/01/2026,-1.00,TEST,9.00\n");
    const bankArtifact: ArtifactRecord = {
      ...artifact,
      artifactProfile: "commbank_transaction_history_csv_v1",
      kind: undefined,
      mediaType: "text/csv",
      byteSize: csv.byteLength.toString(),
      state: "awaiting_review",
      versionId: "pinned-version",
    };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(bankArtifact),
      requireActiveActorId: vi.fn(),
    } as unknown as ArtifactRepository;
    const storage = {
      readPrefix: vi.fn().mockResolvedValue(csv),
    } as unknown as ObjectStorage;
    await expect(
      new DocumentService(repository, storage, {
        bucket: "test",
        prefix: "private/",
        maxUploadBytes: 100,
      }).readReviewText(
        "actor-id",
        bankArtifact.id,
        "commbank_transaction_history_csv_v1",
      ),
    ).resolves.toMatchObject({
      versionId: "pinned-version",
      text: csv.toString(),
    });
    expect(storage.readPrefix).toHaveBeenCalledWith(
      "test",
      bankArtifact.objectKey,
      "pinned-version",
      csv.byteLength,
    );
  });

  it("does not verify a newer overwrite discovered after version resolution", async () => {
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(artifact),
      requireActiveActorId: vi.fn(),
      confirmAwaitingReview: vi.fn(),
    } as unknown as ArtifactRepository;
    const storage = {
      latestVersionId: vi.fn().mockResolvedValue("original-version"),
      headVersion: vi.fn().mockResolvedValue({
        contentLength: 5,
        contentType: "application/pdf",
        checksumSha256: artifact.checksumSha256,
        versionId: "original-version",
        metadata: { "folio-artifact-id": artifact.id },
      }),
      readPrefix: vi.fn().mockResolvedValue(Buffer.from("%PDF-")),
    } as unknown as ObjectStorage;
    await new DocumentService(repository, storage, {
      bucket: "test",
      prefix: "private/",
      maxUploadBytes: 10,
    }).confirmUpload("actor-id", artifact.id);
    expect(storage.headVersion).toHaveBeenCalledWith(
      "test",
      artifact.objectKey,
      "original-version",
    );
    expect(storage.readPrefix).toHaveBeenCalledWith(
      "test",
      artifact.objectKey,
      "original-version",
      5,
    );
  });

  it("persists an awaiting-review CSV as rejected with its immutable version", async () => {
    const csvArtifact: ArtifactRecord = {
      ...artifact,
      artifactProfile: "commbank_transaction_history_csv_v1",
      kind: undefined,
      mediaType: "text/csv",
      filename: "original.csv",
      state: "awaiting_review",
      versionId: "version-1",
    };
    const rejected = {
      ...csvArtifact,
      state: "rejected" as const,
      versionId: "version-1",
    };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(csvArtifact),
      requireActiveActorId: vi.fn(),
      rejectArtifact: vi.fn().mockResolvedValue(rejected),
    } as unknown as ArtifactRepository;
    const storage = {} as ObjectStorage;

    await expect(
      new DocumentService(repository, storage, {
        bucket: "test",
        prefix: "private/",
        maxUploadBytes: 10,
      }).rejectArtifact("actor-id", csvArtifact.id),
    ).resolves.toEqual(rejected);
    expect(repository.rejectArtifact).toHaveBeenCalledWith(
      csvArtifact.id,
      "version-1",
    );
  });

  it("does not reject pending Stripe CSV uploads", async () => {
    const csvArtifact: ArtifactRecord = {
      ...artifact,
      artifactProfile: "stripe_balance_itemised_csv_v1",
      kind: undefined,
      mediaType: "text/csv",
      state: "pending",
    };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(csvArtifact),
      requireActiveActorId: vi.fn(),
      rejectArtifact: vi.fn(),
    } as unknown as ArtifactRepository;
    const storage = {
      latestVersionId: vi.fn(),
      headVersion: vi.fn(),
    } as unknown as ObjectStorage;

    await expect(
      new DocumentService(repository, storage, {
        bucket: "test",
        prefix: "private/",
        maxUploadBytes: 10,
      }).rejectArtifact("actor-id", csvArtifact.id),
    ).rejects.toThrow("Rejectable artifact not found");
    expect(storage.latestVersionId).not.toHaveBeenCalled();
    expect(repository.rejectArtifact).not.toHaveBeenCalled();
  });

  it("claims before storage deletion and leaves the claim retryable after storage failure", async () => {
    const deleting: ArtifactRecord = {
      ...artifact,
      artifactProfile: "stripe_balance_itemised_csv_v1",
      kind: undefined,
      mediaType: "text/csv",
      state: "deleting",
      versionId: "version-1",
    };
    const repository = {
      requireActiveActorId: vi.fn(),
      claimArtifactDeletion: vi.fn().mockResolvedValue(deleting),
      deleteClaimedArtifact: vi.fn(),
    } as unknown as ArtifactRepository;
    const failure = new Error("storage unavailable");
    const storage = {
      listVersions: vi.fn().mockResolvedValue(["version-1", "version-2"]),
      deleteVersion: vi.fn().mockRejectedValue(failure),
    } as unknown as ObjectStorage;

    await expect(
      new DocumentService(repository, storage, {
        bucket: "test",
        prefix: "private/",
        maxUploadBytes: 10,
      }).deleteArtifact("actor-id", deleting.id),
    ).rejects.toBe(failure);
    expect(repository.claimArtifactDeletion).toHaveBeenCalledWith(deleting.id);
    expect(storage.deleteVersion).toHaveBeenCalledWith(
      "test",
      deleting.objectKey,
      "version-1",
    );
    expect(repository.deleteClaimedArtifact).not.toHaveBeenCalled();
  });

  it("retries finalization after the exact object versions are already gone", async () => {
    const deleting: ArtifactRecord = {
      ...artifact,
      state: "deleting",
      versionId: "version-1",
    };
    const order: string[] = [];
    const repository = {
      requireActiveActorId: vi.fn(),
      claimArtifactDeletion: vi.fn().mockResolvedValue(deleting),
      deleteClaimedArtifact: vi
        .fn()
        .mockImplementationOnce(async () => {
          order.push("metadata");
          throw new Error("database unavailable");
        })
        .mockImplementation(async () => {
          order.push("metadata");
        }),
    } as unknown as ArtifactRepository;
    const storage = {
      listVersions: vi
        .fn()
        .mockResolvedValueOnce(["version-1"])
        .mockResolvedValueOnce([]),
      deleteVersion: vi.fn().mockImplementation(async () => {
        order.push("storage");
      }),
    } as unknown as ObjectStorage;
    const service = new DocumentService(repository, storage, {
      bucket: "test",
      prefix: "private/",
      maxUploadBytes: 10,
    });

    await expect(
      service.deleteArtifact("actor-id", deleting.id),
    ).rejects.toThrow("database unavailable");
    await expect(
      service.deleteArtifact("actor-id", deleting.id),
    ).resolves.toEqual({ status: "deleted" });

    expect(storage.deleteVersion).toHaveBeenNthCalledWith(
      1,
      "test",
      deleting.objectKey,
      "version-1",
    );
    expect(storage.deleteVersion).toHaveBeenCalledTimes(2);
    expect(order).toEqual(["storage", "metadata", "storage", "metadata"]);
  });

  it("signs available downloads with the original filename", async () => {
    const available: ArtifactRecord = {
      ...artifact,
      filename: "Stripe-2026-01-01-2026-01-02.csv",
      originalFilename: "original.csv",
      state: "available",
      versionId: "version-1",
    };
    const repository = {
      getArtifact: vi.fn().mockResolvedValue(available),
      requireActiveActorId: vi.fn(),
    } as unknown as ArtifactRepository;
    const storage = {
      presignGet: vi.fn().mockResolvedValue("https://download.example.test"),
    } as unknown as ObjectStorage;

    await new DocumentService(repository, storage, {
      bucket: "test",
      prefix: "private/",
      maxUploadBytes: 10,
    }).download("actor-id", available.id);
    expect(storage.presignGet).toHaveBeenCalledWith(
      "test",
      available.objectKey,
      "version-1",
      "original.csv",
    );
  });
});
