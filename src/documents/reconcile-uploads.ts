import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { z } from "zod";

import { createS3CredentialsProvider } from "../aws/credentials";
import { loadConfig } from "../config";
import { OperationCleanupError } from "../domain/errors";
import { writeDatabaseCliFailure } from "../database/cli-errors";
import { FolioRepository } from "../database/repository";
import {
  reconcilePendingUploads,
  RECOVERY_CONFIRMATION,
} from "./reconciliation";
import type { ArtifactRecord } from "./service";
import { S3ObjectStorage } from "./storage";
import {
  writeServerSuccess,
  type DiagnosticWriters,
} from "../server/error-handling";

type ReconciliationOptions = Readonly<{
  arguments_?: string[];
  environment?: Parameters<typeof loadConfig>[0];
  configLoader?: typeof loadConfig;
  poolFactory?: (options: { connectionString: string; max: number }) => Pool;
  s3ClientFactory?: (options: S3ClientConfig) => S3Client;
  storageFactory?: (client: S3Client) => S3ObjectStorage;
  output?: (text: string) => void;
  error?: (line: string) => void;
  successWriters?: DiagnosticWriters;
}>;

export const runReconcileUploads = async ({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  configLoader = loadConfig,
  poolFactory = (options) => new Pool(options),
  s3ClientFactory = (options) => new S3Client(options),
  storageFactory = (client) => new S3ObjectStorage(client),
  output = (text) => process.stdout.write(text),
  error: writeError = (line) => process.stderr.write(`${line}\n`),
  successWriters,
}: ReconciliationOptions = {}): Promise<number> => {
  let stage = "arguments";
  let mutation = false;
  let pool: Pool | undefined;
  let s3Client: S3Client | undefined;
  let failure: { error: unknown; stage: string } | undefined;
  try {
    const { values } = parseArgs({
      args: arguments_,
      options: {
        maximum: { type: "string", default: "100" },
        recover: { type: "boolean", default: false },
        "actor-email": { type: "string" },
        confirm: { type: "string" },
      },
      strict: true,
    });
    const maximum = z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .parse(values.maximum);
    const actorEmail = values["actor-email"]
      ? z.string().trim().email().parse(values["actor-email"])
      : undefined;
    stage = "configuration";
    const config = configLoader(environment);
    stage = "database";
    pool = poolFactory({ connectionString: config.databaseUrl, max: 1 });
    const repository = new FolioRepository(
      pool,
      config.databaseSchema,
      config.gstRegistered,
    );
    const credentials = createS3CredentialsProvider(
      config.awsAssumeRoleArn,
      config.s3Region,
    );
    s3Client = s3ClientFactory({
      region: config.s3Region,
      ...(credentials ? { credentials } : {}),
    });
    const storage = storageFactory(s3Client);

    output(
      values.recover
        ? `RECOVERY MODE: only exact matches will transition. Confirmation token: ${RECOVERY_CONFIRMATION}.\n`
        : "DRY RUN: no database state will change.\n",
    );
    stage = "reconcile";
    mutation = values.recover;
    const result = await pool.query(
      `SELECT id, artifact_profile, object_key, version_id, media_type, byte_size, checksum_sha256, state FROM "${config.databaseSchema}"."source_artifacts" WHERE state='pending' AND version_id IS NULL ORDER BY created_at, id LIMIT $1`,
      [maximum],
    );
    const artifacts = result.rows.map(
      (row): ArtifactRecord => ({
        id: row.id,
        artifactProfile: row.artifact_profile,
        objectKey: row.object_key,
        versionId: row.version_id,
        mediaType: row.media_type,
        byteSize: row.byte_size,
        checksumSha256: row.checksum_sha256,
        state: row.state,
      }),
    );
    const outcomes = await reconcilePendingUploads({
      artifacts,
      repository,
      storage,
      bucket: config.s3Bucket,
      recover: values.recover,
      actorEmail,
      confirmation: values.confirm,
    });
    for (const outcome of outcomes)
      output(`${outcome.artifactId}\t${outcome.status}\n`);
    if (values.recover)
      writeServerSuccess(
        {
          operation: "reconcile_uploads",
          stage,
          mutation: true,
          metadata: { count: outcomes.length },
        },
        successWriters,
      );
    output(
      "S3-only orphan discovery and object deletion/lifecycle remain external operator gates requiring separate IAM.\n",
    );
  } catch (error) {
    failure = { error, stage };
  } finally {
    const cleanupErrors: Array<{ error: unknown; stage: string }> = [];
    if (pool) {
      try {
        await pool.end();
      } catch (error) {
        cleanupErrors.push({ error, stage: "close" });
      }
    }
    if (s3Client) {
      try {
        s3Client.destroy();
      } catch (error) {
        cleanupErrors.push({ error, stage: "storage_close" });
      }
    }
    for (const cleanup of cleanupErrors) {
      failure = failure
        ? {
            error: new OperationCleanupError(
              failure.error,
              cleanup.error,
              cleanup.stage,
            ),
            stage: failure.stage,
          }
        : { error: cleanup.error, stage: cleanup.stage };
    }
  }

  if (!failure) return 0;
  writeDatabaseCliFailure(
    failure.error,
    { operation: "reconcile_uploads", stage: failure.stage, mutation },
    writeError,
  );
  return 1;
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runReconcileUploads().then((exitCode) => {
    if (exitCode !== 0) process.exitCode = exitCode;
  });
}
