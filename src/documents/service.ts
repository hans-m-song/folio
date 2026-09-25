import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  artifactProfileSchema,
  assertArtifactProfileMediaType,
  getArtifactProfile,
  legacyArtifactProfile,
  isBankArtifactProfile,
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
  getArtifact(id: string): Promise<ArtifactRecord | null>;
  abandonPendingArtifact(id: string): Promise<void>;
  requireActiveActor(email: string): Promise<void>;
  requireActiveActorId(id: string): Promise<void>;
  confirmAvailable(id: string, versionId: string): Promise<void>;
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

  async confirmUpload(actorId: string, id: string): Promise<ArtifactRecord> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (!artifact || artifact.state !== "pending")
      throw new Error("Pending artifact not found");
    if (isBankArtifactProfile(artifactProfileOf(artifact)))
      throw new Error(
        "Bank activity artifacts require a profile-specific importer",
      );
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
    await this.repository.confirmAvailable(id, versionId);
    return { ...artifact, state: "available", versionId };
  }

  async readPendingBankText(
    actorId: string,
    id: string,
    expectedProfile: ArtifactProfile,
  ): Promise<{ artifact: ArtifactRecord; versionId: string; text: string }> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (
      !artifact ||
      artifact.state !== "pending" ||
      artifactProfileOf(artifact) !== expectedProfile ||
      !isBankArtifactProfile(expectedProfile)
    )
      throw new Error("Pending bank artifact not found");
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
    )
      throw new Error(
        "Stored object metadata or version does not match the upload intent",
      );
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
      versionId,
      byteSize,
    );
    return {
      artifact,
      versionId,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
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

  async rejectArtifact(actorId: string, id: string): Promise<ArtifactRecord> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (!artifact) throw new Error("Rejectable CSV artifact not found");
    const profile = artifactProfileOf(artifact);
    if (getArtifactProfile(profile).mediaType !== "text/csv")
      throw new Error("Rejectable CSV artifact not found");
    if (artifact.state === "rejected" && artifact.versionId) return artifact;
    const isPendingCommBankCsv =
      artifact.state === "pending" &&
      profile === "commbank_transaction_history_csv_v1";
    if (
      !isPendingCommBankCsv &&
      (artifact.state !== "available" || !artifact.versionId)
    )
      throw new Error("Rejectable CSV artifact not found");

    let versionId: string | undefined = artifact.versionId ?? undefined;
    if (isPendingCommBankCsv) {
      versionId = await this.storage.latestVersionId(
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
      )
        throw new Error(
          "Stored object metadata or version does not match the upload intent",
        );
    }
    if (!versionId) throw new Error("Stored object has no immutable version");
    return this.repository.rejectArtifact(id, versionId);
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
