import {
  artifactProfileOf,
  type ArtifactRecord,
  type ArtifactRepository,
} from "./service";
import type { ObjectStorage, StoredObjectHead } from "./storage";
import { getArtifactProfile } from "../artifacts/profiles";

export const RECOVERY_CONFIRMATION = "RECOVER_EXACT_PENDING_UPLOADS";

export type UploadReconciliation =
  | "dry_run_confirmable"
  | "recovered"
  | "already_resolved"
  | "missing_immutable_version"
  | "metadata_mismatch"
  | "invalid_pdf_signature"
  | "object_unavailable_or_denied";

export interface ReconciliationResult {
  artifactId: string;
  status: UploadReconciliation;
}

function matchesUploadIntent(
  artifact: ArtifactRecord,
  versionId: string,
  head: StoredObjectHead,
): boolean {
  return (
    head.versionId === versionId &&
    head.contentLength?.toString() === artifact.byteSize &&
    head.contentType === artifact.mediaType &&
    head.checksumSha256 === artifact.checksumSha256 &&
    head.metadata?.["folio-artifact-id"] === artifact.id
  );
}

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
    if (artifact.state !== "pending" || artifact.versionId !== null) {
      results.push({ artifactId: artifact.id, status: "already_resolved" });
      continue;
    }
    let versionId: string | undefined;
    let head: StoredObjectHead | undefined;
    try {
      versionId = await input.storage.latestVersionId(
        input.bucket,
        artifact.objectKey,
      );
      head = versionId
        ? await input.storage.headVersion(
            input.bucket,
            artifact.objectKey,
            versionId,
          )
        : undefined;
    } catch {
      results.push({
        artifactId: artifact.id,
        status: "object_unavailable_or_denied",
      });
      continue;
    }
    if (!versionId || !head?.versionId) {
      results.push({
        artifactId: artifact.id,
        status: "missing_immutable_version",
      });
      continue;
    }
    if (!matchesUploadIntent(artifact, versionId, head)) {
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
          versionId,
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
      await input.repository.confirmAwaitingReview(artifact.id, versionId);
      results.push({ artifactId: artifact.id, status: "recovered" });
    } catch (error) {
      const current = await input.repository.getArtifact(artifact.id);
      if (current && current.state !== "pending") {
        results.push({ artifactId: artifact.id, status: "already_resolved" });
        continue;
      }
      throw error;
    }
  }
  return results;
}
