import { describe, expect, it, vi } from "vitest";

import {
  reconcilePendingUploads,
  RECOVERY_CONFIRMATION,
} from "./reconciliation";
import type { ArtifactRecord, ArtifactRepository } from "./service";
import type { ObjectStorage } from "./storage";

const artifact: ArtifactRecord = {
  id: "0f935296-35b3-43bd-bc3d-0caa0b0a2510",
  kind: "pdf",
  objectKey: "private/pdf/opaque",
  versionId: null,
  mediaType: "application/pdf",
  byteSize: "5",
  checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  state: "pending",
};

function boundaries(overrides: Partial<ObjectStorage> = {}) {
  const repository = {
    requireActiveActor: vi.fn(),
    confirmAvailable: vi.fn(),
    getArtifact: vi.fn().mockResolvedValue(artifact),
  } as unknown as ArtifactRepository;
  const storage = {
    latestVersionId: vi.fn().mockResolvedValue("v1"),
    headVersion: vi.fn().mockResolvedValue({
      versionId: "v1",
      contentLength: 5,
      contentType: artifact.mediaType,
      checksumSha256: artifact.checksumSha256,
      metadata: { "folio-artifact-id": artifact.id },
    }),
    readPrefix: vi.fn().mockResolvedValue(Buffer.from("%PDF-")),
    ...overrides,
  } as unknown as ObjectStorage;
  return { repository, storage };
}

describe("pending upload reconciliation", () => {
  it("defaults to a non-mutating dry-run result", async () => {
    const { repository, storage } = boundaries();
    await expect(
      reconcilePendingUploads({
        artifacts: [artifact],
        repository,
        storage,
        bucket: "test",
        recover: false,
      }),
    ).resolves.toEqual([
      { artifactId: artifact.id, status: "dry_run_confirmable" },
    ]);
    expect(repository.requireActiveActor).not.toHaveBeenCalled();
    expect(repository.confirmAvailable).not.toHaveBeenCalled();
  });

  it("recovers only after actor and deliberate confirmation checks", async () => {
    const { repository, storage } = boundaries();
    await expect(
      reconcilePendingUploads({
        artifacts: [artifact],
        repository,
        storage,
        bucket: "test",
        recover: true,
        actorEmail: "operator@example.test",
        confirmation: RECOVERY_CONFIRMATION,
      }),
    ).resolves.toEqual([{ artifactId: artifact.id, status: "recovered" }]);
    expect(repository.requireActiveActor).toHaveBeenCalledWith(
      "operator@example.test",
    );
    expect(repository.confirmAvailable).toHaveBeenCalledWith(artifact.id, "v1");
  });

  it("refuses mismatches and invalid recovery confirmation", async () => {
    const { repository, storage } = boundaries({
      headVersion: vi.fn().mockResolvedValue({
        versionId: "v1",
        contentLength: 6,
        contentType: artifact.mediaType,
        checksumSha256: artifact.checksumSha256,
        metadata: { "folio-artifact-id": artifact.id },
      }),
    });
    await expect(
      reconcilePendingUploads({
        artifacts: [artifact],
        repository,
        storage,
        bucket: "test",
        recover: true,
        actorEmail: "operator@example.test",
        confirmation: RECOVERY_CONFIRMATION,
      }),
    ).resolves.toEqual([
      { artifactId: artifact.id, status: "metadata_mismatch" },
    ]);
    expect(repository.confirmAvailable).not.toHaveBeenCalled();
    await expect(
      reconcilePendingUploads({
        artifacts: [artifact],
        repository,
        storage,
        bucket: "test",
        recover: true,
        actorEmail: "operator@example.test",
        confirmation: "wrong",
      }),
    ).rejects.toThrow("Recovery requires --confirm");
  });

  it("does not inspect or mutate an already-resolved artifact", async () => {
    const { repository, storage } = boundaries();
    await expect(
      reconcilePendingUploads({
        artifacts: [{ ...artifact, state: "available", versionId: "v1" }],
        repository,
        storage,
        bucket: "test",
        recover: false,
      }),
    ).resolves.toEqual([
      { artifactId: artifact.id, status: "already_resolved" },
    ]);
    expect(storage.latestVersionId).not.toHaveBeenCalled();
    expect(repository.confirmAvailable).not.toHaveBeenCalled();
  });

  it("does not recover bank activity with the generic confirmation path", async () => {
    const bankArtifact: ArtifactRecord = {
      ...artifact,
      artifactProfile: "nab_transaction_history_csv_v1",
      kind: undefined,
      mediaType: "text/csv",
    };
    const { repository, storage } = boundaries();
    await expect(
      reconcilePendingUploads({
        artifacts: [bankArtifact],
        repository,
        storage,
        bucket: "test",
        recover: false,
      }),
    ).resolves.toEqual([
      { artifactId: bankArtifact.id, status: "unsupported_profile" },
    ]);
    expect(storage.latestVersionId).not.toHaveBeenCalled();
    expect(repository.confirmAvailable).not.toHaveBeenCalled();
  });
});
