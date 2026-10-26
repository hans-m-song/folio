import { parseWithDiagnostics } from "../domain/validation-diagnostics";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import {
  artifactProfileSchema,
  assertArtifactProfileMediaType,
  getArtifactProfile,
  isInvoiceEvidenceProfile,
  legacyArtifactProfile,
  type ArtifactProfile,
} from "../artifacts/profiles";
import { AppError } from "../domain/errors";
import {
  artifactMetadataEditSchema,
  artifactMetadataSchema,
  type ArtifactMetadataEdit,
  type ArtifactMetadataEditInput,
  type ArtifactMetadataInput,
} from "../artifacts/metadata";
import type { ArtifactKind } from "./keys";
import { createObjectKey } from "./keys";
import type { ObjectStorage, StoredObjectHead } from "./storage";
import {
  UPLOAD_EXPIRY_GRACE_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
} from "./upload-lifecycle";

export { UPLOAD_EXPIRY_GRACE_SECONDS, UPLOAD_URL_TTL_SECONDS };

export interface ArtifactRecord {
  id: string;
  artifactProfile?: ArtifactProfile;
  /** @deprecated use artifactProfile; retained for old in-process callers. */
  kind?: ArtifactKind;
  objectKey: string;
  confirmedAt: string | null;
  uploadExpiresAt: string | null;
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
  periodStart?: string | null;
  periodEnd?: string | null;
  documentDate?: string | null;
  reference?: string | null;
  notes?: string | null;
  supplier?: string | null;
}

export interface ArtifactDetails {
  id: string;
  artifactProfile: ArtifactProfile;
  filename: string;
  originalFilename: string | null;
  mediaType: string;
  state: ArtifactRecord["state"];
  byteSize: string;
  checksumSha256: string;
  confirmedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  documentDate: string | null;
  reference: string | null;
  notes: string | null;
  supplier: string | null;
  createdAt: string;
  linkedTransactionIds: string[];
  bankRowCount: number;
}

export type UploadHeaders = Record<string, string> & {
  "Content-Type": string;
  "x-amz-checksum-sha256": string;
  "x-amz-meta-folio-artifact-id": string;
  "If-None-Match": "*";
};

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
    originalFilename?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    documentDate?: string | null;
    reference?: string | null;
    notes?: string | null;
    supplier?: string | null;
    mediaType: string;
    byteSize: string;
    checksumSha256: string;
  }): Promise<ArtifactRecord>;
  updateArtifactMetadata(input: ArtifactMetadataEdit): Promise<ArtifactRecord>;
  createPendingUploadIntent(
    input: {
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
    } & Pick<
      ArtifactMetadataInput,
      | "originalFilename"
      | "periodStart"
      | "periodEnd"
      | "documentDate"
      | "reference"
      | "notes"
      | "supplier"
    >,
  ): Promise<
    | { status: "created" | "replayed"; artifact: ArtifactRecord }
    | {
        status: "not_uploadable";
        artifactId: string;
        artifactState: ArtifactRecord["state"] | "deleted";
      }
  >;
  getArtifact(id: string): Promise<ArtifactRecord | null>;
  getArtifactDetails(
    actorId: string,
    id: string,
  ): Promise<ArtifactDetails | null>;
  abandonPendingArtifact(id: string): Promise<void>;
  registerUploadExpiry(id: string, expiresAt: string): Promise<void>;
  requireActiveActor(email: string): Promise<void>;
  requireActiveActorId(id: string): Promise<void>;
  confirmAwaitingReview(id: string, checksumSha256: string): Promise<void>;
  approveArtifact(id: string, checksumSha256: string): Promise<ArtifactRecord>;
  rejectArtifact(id: string, checksumSha256: string): Promise<ArtifactRecord>;
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

const filenameMatchesArtifactProfileExtension = (
  profile: ArtifactProfile,
  filename: string,
): boolean => {
  const extension = getArtifactProfile(profile).extension;
  const separator = filename.lastIndexOf(".");
  return (
    separator > 0 &&
    filename.slice(separator + 1).toLocaleLowerCase("en-AU") === extension
  );
};

const assertFilenameExtension = (
  profile: ArtifactProfile,
  filename: string,
): void => {
  if (!filenameMatchesArtifactProfileExtension(profile, filename))
    throw new Error("Filename extension does not match artifact profile");
};

const equalText = (left: string | undefined, right: string): boolean => {
  if (!left) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
};

const matchesArtifactHead = (
  artifact: ArtifactRecord,
  head: StoredObjectHead,
): boolean =>
  head.contentLength?.toString() === artifact.byteSize &&
  head.contentType === artifact.mediaType &&
  equalText(head.checksumSha256, artifact.checksumSha256) &&
  equalText(head.metadata?.["folio-artifact-id"], artifact.id);

const assertArtifactBytes = (
  artifact: ArtifactRecord,
  bytes: Uint8Array,
): void => {
  if (
    bytes.byteLength !== Number(artifact.byteSize) ||
    !equalText(
      createHash("sha256").update(bytes).digest("base64"),
      artifact.checksumSha256,
    )
  )
    throw new Error(
      "Stored artifact bytes do not match the confirmed checksum",
    );
};

const uploadHeadersFor = (artifact: ArtifactRecord): UploadHeaders => ({
  "Content-Type": artifact.mediaType,
  "x-amz-checksum-sha256": artifact.checksumSha256,
  "x-amz-meta-folio-artifact-id": artifact.id,
  "If-None-Match": "*",
});

const expiryForUpload = (): string => {
  const signingMilliseconds = Math.floor(Date.now() / 1000) * 1000;
  return new Date(
    signingMilliseconds + UPLOAD_URL_TTL_SECONDS * 1000,
  ).toISOString();
};

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

  private async issueUploadUrl(artifact: ArtifactRecord): Promise<{
    artifact: ArtifactRecord;
    uploadUrl: string;
    uploadHeaders: UploadHeaders;
  }> {
    const expiresAt = expiryForUpload();
    await this.repository.registerUploadExpiry(artifact.id, expiresAt);
    const trackedArtifact = { ...artifact, uploadExpiresAt: expiresAt };
    const uploadUrl = await this.storage.presignPut({
      bucket: this.settings.bucket,
      key: trackedArtifact.objectKey,
      contentType: trackedArtifact.mediaType,
      checksumSha256: trackedArtifact.checksumSha256,
      byteSize: Number(trackedArtifact.byteSize),
      artifactId: trackedArtifact.id,
      expiresAt,
    });
    return {
      artifact: trackedArtifact,
      uploadUrl,
      uploadHeaders: uploadHeadersFor(trackedArtifact),
    };
  }

  private async assertStoredObjectMatches(
    artifact: ArtifactRecord,
  ): Promise<void> {
    const head = await this.storage.head(
      this.settings.bucket,
      artifact.objectKey,
    );
    if (!matchesArtifactHead(artifact, head))
      throw new Error(
        "Stored object metadata does not match the upload intent",
      );
  }

  private async assertPdfSignature(artifact: ArtifactRecord): Promise<void> {
    const signature = await this.storage.readPrefix(
      this.settings.bucket,
      artifact.objectKey,
      5,
    );
    if (Buffer.from(signature).toString("ascii") !== "%PDF-")
      throw new Error("Stored PDF signature is invalid");
  }

  async startUpload(
    input: {
      actorId: string;
      ownerId: string | null;
      artifactProfile?: ArtifactProfile;
      /** @deprecated use artifactProfile; retained for existing upload callers. */
      kind?: ArtifactKind;
      mediaType: string;
      byteSize: number;
      checksumSha256: string;
    } & ArtifactMetadataInput,
  ) {
    const artifactProfile = requestedArtifactProfile(input);
    assertArtifactProfileMediaType(artifactProfile, input.mediaType);
    const metadata = parseWithDiagnostics(artifactMetadataSchema, {
      filename: input.filename,
      originalFilename: input.originalFilename,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      documentDate: input.documentDate,
      reference: input.reference,
      notes: input.notes,
      supplier: input.supplier,
    });
    assertFilenameExtension(artifactProfile, metadata.filename);
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
      filename: metadata.filename,
      originalFilename: metadata.originalFilename ?? metadata.filename,
      periodStart: metadata.periodStart ?? null,
      periodEnd: metadata.periodEnd ?? null,
      documentDate: metadata.documentDate ?? null,
      reference: metadata.reference ?? null,
      notes: metadata.notes ?? null,
      supplier: metadata.supplier ?? null,
      byteSize: input.byteSize.toString(),
      objectKey: createObjectKey(this.settings.prefix, artifactProfile, id),
    });
    try {
      return await this.issueUploadUrl(artifact);
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
  }

  async updateMetadata(
    actorId: string,
    input: ArtifactMetadataEditInput,
  ): Promise<ArtifactRecord> {
    await this.repository.requireActiveActorId(actorId);
    const metadata = parseWithDiagnostics(artifactMetadataEditSchema, input);
    const artifact = await this.repository.getArtifact(metadata.id);
    if (
      !artifact ||
      !artifact.confirmedAt ||
      (artifact.state !== "awaiting_review" && artifact.state !== "available")
    )
      throw new AppError({
        code: "ARTIFACT_METADATA_CONFLICT",
        stage: "artifact_metadata",
      });

    const profile = artifactProfileOf(artifact);
    if (!filenameMatchesArtifactProfileExtension(profile, metadata.filename))
      throw new AppError({
        code: "INPUT_INVALID",
        stage: "artifact_metadata",
      });
    if (
      getArtifactProfile(profile).mediaType === "application/pdf" &&
      (metadata.periodStart !== (artifact.periodStart ?? null) ||
        metadata.periodEnd !== (artifact.periodEnd ?? null))
    )
      throw new AppError({
        code: "INPUT_INVALID",
        stage: "artifact_metadata",
      });

    return this.repository.updateArtifactMetadata(metadata);
  }

  async startIdempotentUpload(
    input: {
      credentialId: string;
      idempotencyKey: string;
      actorId: string;
      ownerId: string | null;
      artifactProfile: ArtifactProfile;
      filename: string;
      mediaType: string;
      byteSize: number;
      checksumSha256: string;
    } & Omit<ArtifactMetadataInput, "filename">,
  ): Promise<
    | {
        status: "upload_ready";
        artifact: ArtifactRecord;
        uploadUrl: string;
        uploadHeaders: UploadHeaders;
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
    const parsedMetadata = parseWithDiagnostics(artifactMetadataSchema, {
      filename: input.filename,
      originalFilename: input.originalFilename,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      documentDate: input.documentDate,
      reference: input.reference,
      notes: input.notes,
      supplier: input.supplier,
    });
    const metadata = {
      filename: parsedMetadata.filename,
      originalFilename:
        parsedMetadata.originalFilename ?? parsedMetadata.filename,
      periodStart: parsedMetadata.periodStart ?? null,
      periodEnd: parsedMetadata.periodEnd ?? null,
      documentDate: parsedMetadata.documentDate ?? null,
      reference: parsedMetadata.reference ?? null,
      notes: parsedMetadata.notes ?? null,
      supplier: parsedMetadata.supplier ?? null,
    };
    assertFilenameExtension(artifactProfile, metadata.filename);
    const usesLegacyDefaultMetadata =
      metadata.originalFilename === metadata.filename &&
      metadata.periodStart === null &&
      metadata.periodEnd === null &&
      metadata.documentDate === null &&
      metadata.reference === null &&
      metadata.notes === null &&
      metadata.supplier === null;
    const payloadSha256 = createHash("sha256")
      .update(
        JSON.stringify(
          usesLegacyDefaultMetadata
            ? [
                "folio-mcp-upload-v1",
                artifactProfile,
                metadata.filename,
                input.byteSize,
                input.checksumSha256,
              ]
            : [
                "folio-mcp-upload-v2",
                artifactProfile,
                metadata.filename,
                metadata.originalFilename,
                metadata.periodStart,
                metadata.periodEnd,
                metadata.documentDate,
                metadata.reference,
                metadata.notes,
                metadata.supplier,
                input.byteSize,
                input.checksumSha256,
              ],
        ),
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
      ...metadata,
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
    const upload = await this.issueUploadUrl(intent.artifact);
    return {
      status: "upload_ready",
      ...upload,
      replayed: intent.status === "replayed",
    };
  }

  async confirmUpload(actorId: string, id: string): Promise<ArtifactRecord> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (
      !artifact ||
      (artifact.state !== "pending" && artifact.state !== "awaiting_review")
    )
      throw new Error("Pending artifact not found");
    if (artifact.state === "awaiting_review" && !artifact.confirmedAt)
      throw new Error("Confirmed artifact timestamp is missing");

    await this.assertStoredObjectMatches(artifact);
    if (
      getArtifactProfile(artifactProfileOf(artifact)).mediaType ===
      "application/pdf"
    )
      await this.assertPdfSignature(artifact);

    if (artifact.state === "awaiting_review") return artifact;
    if (artifact.confirmedAt)
      throw new Error("Pending artifact has an unexpected confirmation time");

    await this.repository.confirmAwaitingReview(id, artifact.checksumSha256);
    const confirmed = await this.repository.getArtifact(id);
    if (
      !confirmed ||
      (confirmed.state !== "awaiting_review" &&
        confirmed.state !== "available") ||
      !confirmed.confirmedAt ||
      !equalText(confirmed.checksumSha256, artifact.checksumSha256)
    )
      throw new Error("Artifact confirmation did not persist");
    return confirmed;
  }

  async approveArtifact(actorId: string, id: string): Promise<ArtifactRecord> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (
      !artifact ||
      !isInvoiceEvidenceProfile(artifactProfileOf(artifact)) ||
      !artifact.confirmedAt ||
      (artifact.state !== "awaiting_review" && artifact.state !== "available")
    )
      throw new Error("Reviewable PDF artifact not found");
    if (artifact.state === "available") return artifact;
    return this.repository.approveArtifact(id, artifact.checksumSha256);
  }

  async readReviewText(
    actorId: string,
    id: string,
    expectedProfile: ArtifactProfile,
  ): Promise<{ artifact: ArtifactRecord; confirmedAt: string; text: string }> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (
      !artifact ||
      (artifact.state !== "awaiting_review" &&
        artifact.state !== "available") ||
      !artifact.confirmedAt ||
      artifactProfileOf(artifact) !== expectedProfile ||
      getArtifactProfile(expectedProfile).mediaType !== "text/csv"
    )
      throw new Error("Reviewable CSV artifact not found");
    const byteSize = Number(artifact.byteSize);
    if (
      !Number.isSafeInteger(byteSize) ||
      byteSize <= 0 ||
      byteSize > this.settings.maxUploadBytes
    )
      throw new Error("Stored artifact exceeds the configured read limit");
    await this.assertStoredObjectMatches(artifact);
    const bytes = await this.storage.readPrefix(
      this.settings.bucket,
      artifact.objectKey,
      byteSize,
    );
    assertArtifactBytes(artifact, bytes);
    return {
      artifact,
      confirmedAt: artifact.confirmedAt,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  }

  async readInvoicePdf(
    actorId: string,
    id: string,
    expected?: { checksumSha256?: string; confirmedAt?: string },
  ): Promise<{
    artifactId: string;
    checksumSha256: string;
    confirmedAt: string;
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
      !artifact.confirmedAt
    )
      throw new Error("Confirmed invoice PDF not found");
    if (
      (expected?.checksumSha256 &&
        !equalText(expected.checksumSha256, artifact.checksumSha256)) ||
      (expected?.confirmedAt && expected.confirmedAt !== artifact.confirmedAt)
    )
      throw new Error("Invoice PDF identity has changed");
    const byteSize = Number(artifact.byteSize);
    if (
      !Number.isSafeInteger(byteSize) ||
      byteSize <= 0 ||
      byteSize > Math.min(this.settings.maxUploadBytes, 10 * 1024 * 1024)
    )
      throw new Error("Invoice PDF exceeds the extraction limit");
    await this.assertStoredObjectMatches(artifact);
    const bytes = await this.storage.readPrefix(
      this.settings.bucket,
      artifact.objectKey,
      byteSize,
    );
    if (Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-")
      throw new Error("Invoice PDF signature is invalid");
    assertArtifactBytes(artifact, bytes);

    const current = await this.repository.getArtifact(id);
    if (
      !current ||
      (current.state !== "awaiting_review" && current.state !== "available") ||
      artifactProfileOf(current) !== "manual_invoice_pdf_v1" ||
      current.objectKey !== artifact.objectKey ||
      current.confirmedAt !== artifact.confirmedAt ||
      !equalText(current.checksumSha256, artifact.checksumSha256)
    )
      throw new Error("Invoice PDF identity has changed");
    return {
      artifactId: artifact.id,
      checksumSha256: artifact.checksumSha256,
      confirmedAt: artifact.confirmedAt,
      bytes,
    };
  }

  async download(actorId: string, id: string): Promise<string> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (!artifact || artifact.state !== "available" || !artifact.confirmedAt)
      throw new Error("Available artifact not found");
    await this.assertStoredObjectMatches(artifact);
    return this.storage.presignGet(
      this.settings.bucket,
      artifact.objectKey,
      artifact.filename ?? artifact.originalFilename ?? "artifact",
    );
  }

  async previewArtifactForReview(actorId: string, id: string): Promise<string> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (
      !artifact ||
      (artifact.state !== "awaiting_review" &&
        artifact.state !== "available") ||
      !artifact.confirmedAt ||
      getArtifactProfile(artifactProfileOf(artifact)).mediaType !==
        "application/pdf"
    )
      throw new Error("Reviewable PDF artifact not found");
    await this.assertStoredObjectMatches(artifact);
    await this.assertPdfSignature(artifact);
    return this.storage.presignInline(
      this.settings.bucket,
      artifact.objectKey,
      artifact.filename ?? artifact.originalFilename ?? "artifact",
    );
  }

  async rejectArtifact(actorId: string, id: string): Promise<ArtifactRecord> {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.getArtifact(id);
    if (!artifact) throw new Error("Rejectable artifact not found");
    const profile = artifactProfileOf(artifact);
    if (artifact.state === "rejected" && artifact.confirmedAt) return artifact;
    const mediaType = getArtifactProfile(profile).mediaType;
    const isAwaitingReview = artifact.state === "awaiting_review";
    const isLegacyAvailableCsv =
      artifact.state === "available" && mediaType === "text/csv";
    if (
      (!isAwaitingReview && !isLegacyAvailableCsv) ||
      !artifact.confirmedAt ||
      (mediaType !== "text/csv" && mediaType !== "application/pdf")
    )
      throw new Error("Rejectable artifact not found");
    return this.repository.rejectArtifact(id, artifact.checksumSha256);
  }

  async deleteArtifact(
    actorId: string,
    id: string,
  ): Promise<
    { status: "deleted" } | { status: "deferred"; retryAfter: string }
  > {
    await this.repository.requireActiveActorId(actorId);
    const artifact = await this.repository.claimArtifactDeletion(id);
    if (!artifact) return { status: "deleted" };
    const expiryMilliseconds = artifact.uploadExpiresAt
      ? Date.parse(artifact.uploadExpiresAt)
      : Number.NaN;
    if (artifact.uploadExpiresAt && !Number.isFinite(expiryMilliseconds))
      throw new Error("Artifact upload expiry is invalid");
    if (Number.isFinite(expiryMilliseconds)) {
      const retryMilliseconds =
        expiryMilliseconds + UPLOAD_EXPIRY_GRACE_SECONDS * 1000;
      if (retryMilliseconds > Date.now())
        return {
          status: "deferred",
          retryAfter: new Date(retryMilliseconds).toISOString(),
        };
    }
    await this.storage.deleteObject(this.settings.bucket, artifact.objectKey);
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
        : parseWithDiagnostics(artifactProfileSchema, expectedProfile);
    if (
      !artifact ||
      artifactProfileOf(artifact) !== profile ||
      artifact.state !== "available" ||
      !artifact.confirmedAt
    ) {
      throw new Error("Available Stripe CSV artifact not found");
    }
    const byteSize = Number(artifact.byteSize);
    if (
      !Number.isSafeInteger(byteSize) ||
      byteSize <= 0 ||
      byteSize > this.settings.maxUploadBytes
    ) {
      throw new Error("Stored artifact exceeds the configured read limit");
    }
    await this.assertStoredObjectMatches(artifact);
    const bytes = await this.storage.readPrefix(
      this.settings.bucket,
      artifact.objectKey,
      byteSize,
    );
    assertArtifactBytes(artifact, bytes);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
}
