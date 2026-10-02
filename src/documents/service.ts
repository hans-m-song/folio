import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import {
  artifactProfileSchema,
  assertArtifactProfileMediaType,
  getArtifactProfile,
  isInvoiceEvidenceProfile,
  legacyArtifactProfile,
  type ArtifactProfile,
} from "../artifacts/profiles";
import type { ArtifactKind } from "./keys";
import { createObjectKey } from "./keys";
import type { ObjectStorage } from "./storage";

export interface ArtifactRecord {
  id: string;
  artifactProfile?: ArtifactProfile;
  /** @deprecated use artifactProfile; retained for old in-process callers. */
  kind?: ArtifactKind;
  objectKey: string;
  versionId: string | null;
  mediaType: string;
  byteSize: string;
  checksumSha256: string;
  originalFilename?: string;
  state:
    | "pending"
    | "awaiting_review"
    | "available"
    | "rejected"
    | "superseded"
    | "abandoned"
    | "deleting";
  filename?: string;
}

export interface ArtifactRepository {
  createPending(input: {
    id?: string;
    actorId: string;
    ownerId: string | null;
    artifactProfile?: ArtifactProfile;
    /** @deprecated use artifactProfile; retained for old in-process callers. */
    kind?: ArtifactKind;
    objectKey: string;
    filename: string;
    mediaType: string;
    byteSize: string;
    checksumSha256: string;
  }): Promise<ArtifactRecord>;
  createPendingUploadIntent(input: {
    credentialId: string;
    requestKey: string;
    payloadSha256: string;
    id: string;
    actorId: string;
    ownerId: string | null;
    artifactProfile: ArtifactProfile;
    objectKey: string;
    filename: string;
    mediaType: string;
    byteSize: string;
    checksumSha256: string;
  }): Promise<
    | { status: "created" | "replayed"; artifact: ArtifactRecord }
    | {
        status: "not_uploadable";
        artifactId: string;
        artifactState: ArtifactRecord["state"] | "deleted";
      }
  >;
  getArtifact(id: string): Promise<ArtifactRecord | null>;
  abandonPendingArtifact(id: string): Promise<void>;
  requireActiveActor(email: string): Promise<void>;
  requireActiveActorId(id: string): Promise<void>;
  confirmAwaitingReview(id: string, versionId: string): Promise<void>;
  approveArtifact(id: string, versionId: string): Promise<ArtifactRecord>;
  rejectArtifact(id: string, versionId: string): Promise<ArtifactRecord>;
  claimArtifactDeletion(id: string): Promise<ArtifactRecord | null>;
  deleteClaimedArtifact(id: string, objectKey: string): Promise<void>;
  supersede(previousId: string, replacementId: string): Promise<void>;
}

export class ArtifactPresignRecoveryError extends Error {
  constructor(
    readonly primaryError: unknown,
    readonly artifactId: string,
    readonly cleanupError: unknown,
  ) {
    super(
      primaryError instanceof Error
        ? primaryError.message
        : "Artifact upload presigning failed",
      primaryError instanceof Error ? { cause: primaryError } : undefined,
    );
    this.name = "ArtifactPresignRecoveryError";
  }
}

export class ArtifactUploadIdempotencyConflictError extends Error {
  constructor() {
    super("Upload idempotency key was already used with a different payload");
    this.name = "ArtifactUploadIdempotencyConflictError";
  }
}

export const artifactProfileOf = (
  artifact: ArtifactRecord,
): ArtifactProfile => {
  if (artifact.artifactProfile) return artifact.artifactProfile;
  if (artifact.kind) return legacyArtifactProfile(artifact.kind);
  throw new Error("Artifact profile is missing");
};

const requestedArtifactProfile = (input: {
  artifactProfile?: ArtifactProfile;
  kind?: ArtifactKind;
}): ArtifactProfile => {
  if (input.artifactProfile) return input.artifactProfile;
  if (input.kind) return legacyArtifactProfile(input.kind);
  throw new Error("Artifact profile is required");
};

function equalText(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export class DocumentService {
  constructor(
    private readonly repository: ArtifactRepository,
    private readonly storage: ObjectStorage,
    private readonly settings: {
      bucket: string;
      prefix: string;
      maxUploadBytes: number;
    },
  ) {}

  async startUpload(input: {
    actorId: string;
    ownerId: string | null;
    artifactProfile?: ArtifactProfile;
    /** @deprecated use artifactProfile; retained for existing upload callers. */
    kind?: ArtifactKind;
    filename: string;
    mediaType: string;
    byteSize: number;
    checksumSha256: string;
  }) {
    const artifactProfile = requestedArtifactProfile(input);
    assertArtifactProfileMediaType(artifactProfile, input.mediaType);
    if (
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize <= 0 ||
      input.byteSize > this.settings.maxUploadBytes
    ) {
      throw new Error("Upload size is outside the configured limit");
    }
    if (!/^[A-Za-z0-9+/]{43}=$/.test(input.checksumSha256))
      throw new Error("Expected a base64 SHA-256 checksum");
    const id = randomUUID();
    const artifact = await this.repository.createPending({
      ...input,
      id,
      artifactProfile,
      kind: undefined,
      byteSize: input.byteSize.toString(),
      objectKey: createObjectKey(this.settings.prefix, artifactProfile, id),
    });
    let uploadUrl: string;
    try {
      uploadUrl = await this.storage.presignPut({
        bucket: this.settings.bucket,
        key: artifact.objectKey,
        contentType: artifact.mediaType,
        checksumSha256: artifact.checksumSha256,
        byteSize: input.byteSize,
        artifactId: artifact.id,
      });
    } catch (error) {
      try {
        await this.repository.abandonPendingArtifact(artifact.id);
      } catch (cleanupError) {
        throw new ArtifactPresignRecoveryError(
          error,
          artifact.id,
          cleanupError,
        );
      }
      throw error;
    }
    return { artifact, uploadUrl };
  }

  async startIdempotentUpload(input: {
    credentialId: string;
    idempotencyKey: string;
    actorId: string;
    ownerId: string | null;
    artifactProfile: ArtifactProfile;
    filename: string;
    mediaType: string;
    byteSize: number;
    checksumSha256: string;
  }): Promise<
    | {
        status: "upload_ready";
        artifact: ArtifactRecord;
        uploadUrl: string;
        replayed: boolean;
      }
    | {
        status: "intent_not_uploadable";
        artifactId: string;
        artifactState: ArtifactRecord["state"] | "deleted";
      }
  > {
    const artifactProfile = requestedArtifactProfile(input);
    assertArtifactProfileMediaType(artifactProfile, input.mediaType);
    if (
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize <= 0 ||
      input.byteSize > this.settings.maxUploadBytes
    )
      throw new Error("Upload size is outside the configured limit");
    if (!/^[A-Za-z0-9+/]{43}=$/.test(input.checksumSha256))
      throw new Error("Expected a base64 SHA-256 checksum");
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(input.idempotencyKey))
      throw new Error("Invalid upload idempotency key");
    const filename = input.filename.trim().normalize("NFC");
    if (!filename || filename.length > 255)
      throw new Error("Invalid upload filename");
    const payloadSha256 = createHash("sha256")
      .update(
        JSON.stringify([
          "folio-mcp-upload-v1",
          artifactProfile,
          filename,
          input.byteSize,
          input.checksumSha256,
        ]),
      )
      .digest("hex");
    const id = randomUUID();
    const intent = await this.repository.createPendingUploadIntent({
      credentialId: input.credentialId,
      requestKey: input.idempotencyKey,
      payloadSha256,
      id,
      actorId: input.actorId,
      ownerId: input.ownerId,
      artifactProfile,
      objectKey: createObjectKey(this.settings.prefix, artifactProfile, id),
      filename,
      mediaType: input.mediaType,
      byteSize: input.byteSize.toString(),
      checksumSha256: input.checksumSha256,
    });
    if (intent.status === "not_uploadable")
      return {
        status: "intent_not_uploadable",
        artifactId: intent.artifactId,
        artifactState: intent.artifactState,
      };
    const artifact = intent.artifact;
    const uploadUrl = await this.storage.presignPut({
      bucket: this.settings.bucket,
      key: artifact.objectKey,
      contentType: artifact.mediaType,
      checksumSha256: artifact.checksumSha256,
      byteSize: Number(artifact.byteSize),
      artifactId: artifact.id,
    });
    return {
      status: "upload_ready",
      artifact,
      uploadUrl,
      replayed: intent.status === "replayed",
    };
  }

  async confirmUpload(actorId: string, id: string): Promise<ArtifactRecord> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (artifact?.state === "awaiting_review" && artifact.versionId)
      return artifact;
    if (!artifact || artifact.state !== "pending")
      throw new Error("Pending artifact not found");
    const versionId = await this.storage.latestVersionId(
      this.settings.bucket,
      artifact.objectKey,
    );
    if (!versionId) throw new Error("Stored object has no immutable version");
    const head = await this.storage.headVersion(
      this.settings.bucket,
      artifact.objectKey,
      versionId,
    );
    if (
      head.contentLength?.toString() !== artifact.byteSize ||
      head.contentType !== artifact.mediaType ||
      !equalText(head.checksumSha256, artifact.checksumSha256) ||
      !equalText(head.metadata?.["folio-artifact-id"], artifact.id) ||
      head.versionId !== versionId
    ) {
      throw new Error(
        "Stored object metadata or version does not match the upload intent",
      );
    }
    if (
      getArtifactProfile(artifactProfileOf(artifact)).mediaType ===
      "application/pdf"
    ) {
      const signature = await this.storage.readPrefix(
        this.settings.bucket,
        artifact.objectKey,
        versionId,
        5,
      );
      if (Buffer.from(signature).toString("ascii") !== "%PDF-")
        throw new Error("Stored PDF signature is invalid");
    }
    await this.repository.confirmAwaitingReview(id, versionId);
    return { ...artifact, state: "awaiting_review", versionId };
  }

  async approveArtifact(actorId: string, id: string): Promise<ArtifactRecord> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (
      !artifact ||
      !isInvoiceEvidenceProfile(artifactProfileOf(artifact)) ||
      !artifact.versionId ||
      (artifact.state !== "awaiting_review" && artifact.state !== "available")
    )
      throw new Error("Reviewable PDF artifact not found");
    if (artifact.state === "available") return artifact;
    return this.repository.approveArtifact(id, artifact.versionId);
  }

  async readReviewText(
    actorId: string,
    id: string,
    expectedProfile: ArtifactProfile,
  ): Promise<{ artifact: ArtifactRecord; versionId: string; text: string }> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (
      !artifact ||
      (artifact.state !== "awaiting_review" &&
        artifact.state !== "available") ||
      artifactProfileOf(artifact) !== expectedProfile ||
      getArtifactProfile(expectedProfile).mediaType !== "text/csv" ||
      !artifact.versionId
    )
      throw new Error("Reviewable CSV artifact not found");
    const byteSize = Number(artifact.byteSize);
    if (
      !Number.isSafeInteger(byteSize) ||
      byteSize <= 0 ||
      byteSize > this.settings.maxUploadBytes
    )
      throw new Error("Stored artifact exceeds the configured read limit");
    const bytes = await this.storage.readPrefix(
      this.settings.bucket,
      artifact.objectKey,
      artifact.versionId,
      byteSize,
    );
    return {
      artifact,
      versionId: artifact.versionId,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  }

  async readInvoicePdf(
    actorId: string,
    id: string,
    expected?: { checksumSha256?: string; versionId?: string },
  ): Promise<{
    artifactId: string;
    checksumSha256: string;
    versionId: string;
    bytes: Uint8Array;
  }> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (
      !artifact ||
      artifactProfileOf(artifact) !== "manual_invoice_pdf_v1" ||
      artifact.mediaType !== "application/pdf" ||
      (artifact.state !== "awaiting_review" &&
        artifact.state !== "available") ||
      !artifact.versionId ||
      artifact.versionId === "null"
    )
      throw new Error("Confirmed invoice PDF not found");
    if (
      (expected?.checksumSha256 &&
        !equalText(expected.checksumSha256, artifact.checksumSha256)) ||
      (expected?.versionId && expected.versionId !== artifact.versionId)
    )
      throw new Error("Invoice PDF identity has changed");
    const byteSize = Number(artifact.byteSize);
    if (
      !Number.isSafeInteger(byteSize) ||
      byteSize <= 0 ||
      byteSize > Math.min(this.settings.maxUploadBytes, 10 * 1024 * 1024)
    )
      throw new Error("Invoice PDF exceeds the extraction limit");
    const versionId = artifact.versionId;
    const head = await this.storage.headVersion(
      this.settings.bucket,
      artifact.objectKey,
      versionId,
    );
    if (
      head.contentLength !== byteSize ||
      head.contentType !== artifact.mediaType ||
      head.versionId !== versionId ||
      !equalText(head.checksumSha256, artifact.checksumSha256) ||
      !equalText(head.metadata?.["folio-artifact-id"], artifact.id)
    )
      throw new Error(
        "Invoice PDF metadata does not match its confirmed identity",
      );
    const bytes = await this.storage.readPrefix(
      this.settings.bucket,
      artifact.objectKey,
      versionId,
      byteSize,
    );
    if (
      bytes.byteLength !== byteSize ||
      Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-" ||
      !equalText(
        createHash("sha256").update(bytes).digest("base64"),
        artifact.checksumSha256,
      )
    )
      throw new Error("Invoice PDF bytes do not match the confirmed checksum");
    const current = await this.repository.getArtifact(id);
    if (
      !current ||
      (current.state !== "awaiting_review" && current.state !== "available") ||
      artifactProfileOf(current) !== "manual_invoice_pdf_v1" ||
      current.objectKey !== artifact.objectKey ||
      current.versionId !== versionId ||
      !equalText(current.checksumSha256, artifact.checksumSha256)
    )
      throw new Error("Invoice PDF identity has changed");
    return {
      artifactId: artifact.id,
      checksumSha256: artifact.checksumSha256,
      versionId,
      bytes,
    };
  }

  async download(actorId: string, id: string): Promise<string> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (!artifact || artifact.state !== "available" || !artifact.versionId)
      throw new Error("Available artifact not found");
    return this.storage.presignGet(
      this.settings.bucket,
      artifact.objectKey,
      artifact.versionId,
      artifact.originalFilename ?? artifact.filename ?? "artifact",
    );
  }

  async previewArtifactForReview(actorId: string, id: string): Promise<string> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (
      !artifact ||
      artifact.state !== "awaiting_review" ||
      !artifact.versionId ||
      getArtifactProfile(artifactProfileOf(artifact)).mediaType !==
        "application/pdf"
    )
      throw new Error("Reviewable PDF artifact not found");
    return this.storage.presignInline(
      this.settings.bucket,
      artifact.objectKey,
      artifact.versionId,
      artifact.originalFilename ?? artifact.filename ?? "artifact",
    );
  }

  async rejectArtifact(actorId: string, id: string): Promise<ArtifactRecord> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (!artifact) throw new Error("Rejectable artifact not found");
    const profile = artifactProfileOf(artifact);
    if (artifact.state === "rejected" && artifact.versionId) return artifact;
    const mediaType = getArtifactProfile(profile).mediaType;
    const isAwaitingReview = artifact.state === "awaiting_review";
    const isLegacyAvailableCsv =
      artifact.state === "available" && mediaType === "text/csv";
    if (
      (!isAwaitingReview && !isLegacyAvailableCsv) ||
      !artifact.versionId ||
      (mediaType !== "text/csv" && mediaType !== "application/pdf")
    )
      throw new Error("Rejectable artifact not found");
    return this.repository.rejectArtifact(id, artifact.versionId);
  }

  async deleteArtifact(
    actorId: string,
    id: string,
  ): Promise<{ status: "deleted" }> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.claimArtifactDeletion(id);
    if (!artifact) return { status: "deleted" };
    const versions = new Set(
      await this.storage.listVersions(this.settings.bucket, artifact.objectKey),
    );
    if (artifact.versionId) versions.add(artifact.versionId);
    for (const versionId of versions)
      await this.storage.deleteVersion(
        this.settings.bucket,
        artifact.objectKey,
        versionId,
      );
    await this.repository.deleteClaimedArtifact(id, artifact.objectKey);
    return { status: "deleted" };
  }

  async readAvailableText(
    actorId: string,
    id: string,
    expectedProfile: ArtifactProfile | "stripe_csv",
  ): Promise<string> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    const profile =
      expectedProfile === "stripe_csv"
        ? legacyArtifactProfile(expectedProfile)
        : artifactProfileSchema.parse(expectedProfile);
    if (
      !artifact ||
      artifactProfileOf(artifact) !== profile ||
      artifact.state !== "available" ||
      !artifact.versionId
    ) {
      throw new Error("Available Stripe CSV artifact not found");
    }
    const byteSize = Number(artifact.byteSize);
    if (
      !Number.isSafeInteger(byteSize) ||
      byteSize > this.settings.maxUploadBytes
    ) {
      throw new Error("Stored artifact exceeds the configured read limit");
    }
    const bytes = await this.storage.readPrefix(
      this.settings.bucket,
      artifact.objectKey,
      artifact.versionId,
      byteSize,
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
}
