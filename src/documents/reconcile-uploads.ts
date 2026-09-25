import { parseArgs } from "node:util";

import { S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { z } from "zod";

import { loadConfig } from "../config";
import { FolioRepository } from "../database/repository";
import {
  reconcilePendingUploads,
  RECOVERY_CONFIRMATION,
} from "./reconciliation";
import type { ArtifactRecord } from "./service";
import { S3ObjectStorage } from "./storage";

const { values } = parseArgs({
  options: {
    maximum: { type: "string", default: "100" },
    recover: { type: "boolean", default: false },
    "actor-email": { type: "string" },
    confirm: { type: "string" },
  },
  strict: true,
});
const maximum = z.coerce.number().int().min(1).max(1_000).parse(values.maximum);
const actorEmail = values["actor-email"]
  ? z.string().trim().email().parse(values["actor-email"])
  : undefined;
const config = loadConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
const repository = new FolioRepository(
  pool,
  config.databaseSchema,
  config.gstRegistered,
);
const storage = new S3ObjectStorage(new S3Client({ region: config.s3Region }));

try {
  process.stdout.write(
    values.recover
      ? `RECOVERY MODE: only exact matches will transition. Confirmation token: ${RECOVERY_CONFIRMATION}.\n`
      : "DRY RUN: no database state will change.\n",
  );
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
    process.stdout.write(`${outcome.artifactId}\t${outcome.status}\n`);
  process.stdout.write(
    "S3-only orphan discovery and object deletion/lifecycle remain external operator gates requiring separate IAM.\n",
  );
} finally {
  await pool.end();
}
