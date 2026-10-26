import { describe, expect, it, vi } from "vitest";

import {
  reconcilePendingUploads,
  RECOVERY_CONFIRMATION,
} from "./reconciliation";
import type { ArtifactRecord, ArtifactRepository } from "./service";
import type { ObjectStorage } from "./storage";

const artifact: ArtifactRecord = {
  id: "0f935296-35b3-43bd-bc3d-0caa0b0a2510",
  artifactProfile: "manual_invoice_pdf_v1",
  objectKey: "private/pdf/opaque",
  confirmedAt: null,
  uploadExpiresAt: null,
  mediaType: "application/pdf",
  byteSize: "5",
  checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  state: "pending",
};

const matchingHead = (record: ArtifactRecord) => ({
  contentLength: Number(record.byteSize),
  contentType: record.mediaType,
  checksumSha256: record.checksumSha256,
  metadata: { "folio-artifact-id": record.id },
});

const boundaries = (overrides: Partial<ObjectStorage> = {}) => {
  const repository = {
    requireActiveActor: vi.fn(),
    confirmAwaitingReview: vi.fn(),
    getArtifact: vi.fn().mockResolvedValue(artifact),
  } as unknown as ArtifactRepository;
  const storage = {
    head: vi.fn().mockResolvedValue(matchingHead(artifact)),
    readPrefix: vi.fn().mockResolvedValue(Buffer.from("%PDF-")),
    ...overrides,
  } as unknown as ObjectStorage;
  return { repository, storage };
};

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
    expect(repository.confirmAwaitingReview).not.toHaveBeenCalled();
    expect(storage.head).toHaveBeenCalledWith("test", artifact.objectKey);
  });

  it("recovers only after actor, checksum, and deliberate confirmation checks", async () => {
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
    expect(repository.confirmAwaitingReview).toHaveBeenCalledWith(
      artifact.id,
      artifact.checksumSha256,
    );
    expect(storage.readPrefix).toHaveBeenCalledWith(
      "test",
      artifact.objectKey,
      5,
    );
  });

  it("reports missing objects separately from unavailable or denied storage", async () => {
    const absent = boundaries({
      head: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("missing"), { name: "NoSuchKey" }),
        ),
    });
    await expect(
      reconcilePendingUploads({
        artifacts: [artifact],
        repository: absent.repository,
        storage: absent.storage,
        bucket: "test",
        recover: false,
      }),
    ).resolves.toEqual([{ artifactId: artifact.id, status: "missing_object" }]);

    const denied = boundaries({
      head: vi
        .fn()
        .mockRejectedValue(new Error("access denied token=synthetic-secret")),
    });
    const diagnosticLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let logged: string[] = [];
    try {
      await expect(
        reconcilePendingUploads({
          artifacts: [artifact],
          repository: denied.repository,
          storage: denied.storage,
          bucket: "test",
          recover: false,
        }),
      ).resolves.toEqual([
        { artifactId: artifact.id, status: "object_unavailable_or_denied" },
      ]);
      logged = diagnosticLog.mock.calls.map(([line]) => String(line));
    } finally {
      diagnosticLog.mockRestore();
    }
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('"operation":"pending_upload_reconciliation"');
    expect(logged[0]).toContain('"stage":"storage_head"');
    expect(logged[0]).toContain(artifact.id);
    expect(logged[0]).not.toContain("synthetic-secret");
  });

  it("reports PDF signature read failures with stage context", async () => {
    const unavailable = boundaries({
      readPrefix: vi
        .fn()
        .mockRejectedValue(new Error("storage failure token=synthetic-secret")),
    });
    const diagnosticLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let logged: string[] = [];
    try {
      await expect(
        reconcilePendingUploads({
          artifacts: [artifact],
          repository: unavailable.repository,
          storage: unavailable.storage,
          bucket: "test",
          recover: false,
        }),
      ).resolves.toEqual([
        { artifactId: artifact.id, status: "object_unavailable_or_denied" },
      ]);
      logged = diagnosticLog.mock.calls.map(([line]) => String(line));
    } finally {
      diagnosticLog.mockRestore();
    }

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('"operation":"pending_upload_reconciliation"');
    expect(logged[0]).toContain('"stage":"storage_prefix_read"');
    expect(logged[0]).toContain(artifact.id);
    expect(logged[0]).not.toContain("synthetic-secret");
  });

  it("preserves confirmation and state lookup failures", async () => {
    const { repository, storage } = boundaries();
    vi.mocked(repository.confirmAwaitingReview).mockRejectedValueOnce(
      new Error("confirm failed token=synthetic-confirm-secret"),
    );
    vi.mocked(repository.getArtifact).mockRejectedValueOnce(
      new Error("state lookup failed token=synthetic-lookup-secret"),
    );
    const diagnosticLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let logged: string[] = [];

    try {
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
      ).rejects.toMatchObject({ name: "OperationCleanupError" });
      logged = diagnosticLog.mock.calls.map(([line]) => String(line));
    } finally {
      diagnosticLog.mockRestore();
    }

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('"stage":"reconciliation_state_lookup"');
    expect(logged[0]).toContain("confirm failed");
    expect(logged[0]).toContain("state lookup failed");
    expect(logged[0]).not.toContain("synthetic-confirm-secret");
    expect(logged[0]).not.toContain("synthetic-lookup-secret");
  });

  it("reports a failed confirmation even when recovery is already resolved", async () => {
    const { repository, storage } = boundaries();
    vi.mocked(repository.confirmAwaitingReview).mockRejectedValueOnce(
      new Error("confirmation lost token=synthetic-secret"),
    );
    vi.mocked(repository.getArtifact).mockResolvedValueOnce({
      ...artifact,
      state: "available",
      confirmedAt: "2040-01-01T00:00:00.000Z",
    });
    const diagnosticLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let logged: string[] = [];

    try {
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
        { artifactId: artifact.id, status: "already_resolved" },
      ]);
      logged = diagnosticLog.mock.calls.map(([line]) => String(line));
    } finally {
      diagnosticLog.mockRestore();
    }

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('"stage":"recovery_confirm"');
    expect(logged[0]).toContain("confirmation lost");
    expect(logged[0]).not.toContain("synthetic-secret");
  });

  it("refuses integrity mismatches and invalid recovery confirmation", async () => {
    const { repository, storage } = boundaries({
      head: vi.fn().mockResolvedValue({
        ...matchingHead(artifact),
        contentLength: 6,
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
    expect(repository.confirmAwaitingReview).not.toHaveBeenCalled();
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
        artifacts: [
          {
            ...artifact,
            state: "available",
            confirmedAt: "2040-01-01T00:00:00.000Z",
          },
        ],
        repository,
        storage,
        bucket: "test",
        recover: false,
      }),
    ).resolves.toEqual([
      { artifactId: artifact.id, status: "already_resolved" },
    ]);
    expect(storage.head).not.toHaveBeenCalled();
    expect(repository.confirmAwaitingReview).not.toHaveBeenCalled();
  });

  it("recovers bank activity only into awaiting review", async () => {
    const bankArtifact: ArtifactRecord = {
      ...artifact,
      artifactProfile: "nab_transaction_history_csv_v1",
      mediaType: "text/csv",
    };
    const { repository, storage } = boundaries({
      head: vi.fn().mockResolvedValue(matchingHead(bankArtifact)),
    });
    await expect(
      reconcilePendingUploads({
        artifacts: [bankArtifact],
        repository,
        storage,
        bucket: "test",
        recover: true,
        actorEmail: "operator@example.test",
        confirmation: RECOVERY_CONFIRMATION,
      }),
    ).resolves.toEqual([{ artifactId: bankArtifact.id, status: "recovered" }]);
    expect(storage.readPrefix).not.toHaveBeenCalled();
    expect(repository.confirmAwaitingReview).toHaveBeenCalledWith(
      bankArtifact.id,
      bankArtifact.checksumSha256,
    );
  });
});
