import { getArtifactProfile } from "../artifacts/profiles";
import { OperationCleanupError } from "../domain/errors";
import {
  artifactProfileOf,
  type ArtifactRecord,
  type ArtifactRepository,
} from "./service";
import type { ObjectStorage, StoredObjectHead } from "./storage";

export const RECOVERY_CONFIRMATION = "RECOVER_EXACT_PENDING_UPLOADS";

export type UploadReconciliation =
  | "dry_run_confirmable"
  | "recovered"
  | "already_resolved"
  | "missing_object"
  | "metadata_mismatch"
  | "invalid_pdf_signature"
  | "object_unavailable_or_denied";

export interface ReconciliationResult {
  artifactId: string;
  status: UploadReconciliation;
}

const matchesUploadIntent = (
  artifact: ArtifactRecord,
  head: StoredObjectHead,
): boolean =>
  head.contentLength?.toString() === artifact.byteSize &&
  head.contentType === artifact.mediaType &&
  head.checksumSha256 === artifact.checksumSha256 &&
  head.metadata?.["folio-artifact-id"] === artifact.id;

const isMissingObject = (error: unknown): boolean =>
  error !== null &&
  typeof error === "object" &&
  (("name" in error &&
    (error.name === "NoSuchKey" || error.name === "NotFound")) ||
    ("$metadata" in error &&
      error.$metadata !== null &&
      typeof error.$metadata === "object" &&
      "httpStatusCode" in error.$metadata &&
      error.$metadata.httpStatusCode === 404));

export async function reconcilePendingUploads(input: {
  artifacts: readonly ArtifactRecord[];
  repository: ArtifactRepository;
  storage: ObjectStorage;
  bucket: string;
  recover: boolean;
  actorEmail?: string;
  confirmation?: string;
}): Promise<ReconciliationResult[]> {
  if (input.recover) {
    if (input.confirmation !== RECOVERY_CONFIRMATION)
      throw new Error(`Recovery requires --confirm=${RECOVERY_CONFIRMATION}`);
    if (!input.actorEmail) throw new Error("Recovery requires --actor-email");
    await input.repository.requireActiveActor(input.actorEmail);
  }

  const results: ReconciliationResult[] = [];
  for (const artifact of input.artifacts) {
    if (artifact.state !== "pending" || artifact.confirmedAt !== null) {
      results.push({ artifactId: artifact.id, status: "already_resolved" });
      continue;
    }

    let head: StoredObjectHead;
    try {
      head = await input.storage.head(input.bucket, artifact.objectKey);
    } catch (error) {
      results.push({
        artifactId: artifact.id,
        status: isMissingObject(error)
          ? "missing_object"
          : "object_unavailable_or_denied",
      });
      continue;
    }
    if (!matchesUploadIntent(artifact, head)) {
      results.push({ artifactId: artifact.id, status: "metadata_mismatch" });
      continue;
    }
    if (
      getArtifactProfile(artifactProfileOf(artifact)).mediaType ===
      "application/pdf"
    ) {
      let signature: Uint8Array;
      try {
        signature = await input.storage.readPrefix(
          input.bucket,
          artifact.objectKey,
          5,
        );
      } catch {
        results.push({
          artifactId: artifact.id,
          status: "object_unavailable_or_denied",
        });
        continue;
      }
      if (Buffer.from(signature).toString("ascii") !== "%PDF-") {
        results.push({
          artifactId: artifact.id,
          status: "invalid_pdf_signature",
        });
        continue;
      }
    }
    if (!input.recover) {
      results.push({ artifactId: artifact.id, status: "dry_run_confirmable" });
      continue;
    }
    try {
      await input.repository.confirmAwaitingReview(
        artifact.id,
        artifact.checksumSha256,
      );
      results.push({ artifactId: artifact.id, status: "recovered" });
    } catch (error) {
      let current: ArtifactRecord | null;
      try {
        current = await input.repository.getArtifact(artifact.id);
      } catch (lookupError) {
        const failure = new OperationCleanupError(
          error,
          lookupError,
          "reconciliation_state_lookup",
        );
        throw failure;
      }
      if (current && current.state !== "pending") {
        results.push({ artifactId: artifact.id, status: "already_resolved" });
        continue;
      }
      throw error;
    }
  }
  return results;
}
