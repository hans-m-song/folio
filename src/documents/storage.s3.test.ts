import { createHash, randomUUID } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { S3ObjectStorage } from "./storage";
import { UPLOAD_URL_TTL_SECONDS } from "./upload-lifecycle";

const runIntegration = process.env.FOLIO_RUN_S3_INTEGRATION === "1";

describe.skipIf(!runIntegration)("S3 object storage integration", () => {
  it("rejects a conditional upload replay and deletes only the exact key", async () => {
    const bucket = "folio-test-artifacts";
    const key = `tests/artifact-deletion/${randomUUID()}`;
    const siblingKey = `${key}-sibling`;
    const bytes = Buffer.from("%PDF-1.7\nintegration fixture");
    const checksumSha256 = createHash("sha256").update(bytes).digest("base64");
    const artifactId = randomUUID();
    const client = new S3Client({
      region: "us-east-1",
      endpoint: "http://127.0.0.1:59000",
      forcePathStyle: true,
      credentials: {
        accessKeyId: "folio_test_access",
        secretAccessKey: "folio_test_secret_1234",
      },
    });
    const storage = new S3ObjectStorage(client);

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: siblingKey,
          Body: "preserve",
        }),
      );
      const expiresAt = new Date(
        Date.now() + UPLOAD_URL_TTL_SECONDS * 1000,
      ).toISOString();
      const uploadUrl = await storage.presignPut({
        bucket,
        key,
        contentType: "application/pdf",
        checksumSha256,
        byteSize: bytes.byteLength,
        artifactId,
        expiresAt,
      });
      const headers = {
        "Content-Type": "application/pdf",
        "x-amz-checksum-sha256": checksumSha256,
        "x-amz-meta-folio-artifact-id": artifactId,
        "If-None-Match": "*",
      };

      const firstUpload = await fetch(uploadUrl, {
        method: "PUT",
        headers,
        body: bytes,
      });
      expect(firstUpload.ok).toBe(true);
      const replay = await fetch(uploadUrl, {
        method: "PUT",
        headers,
        body: bytes,
      });
      expect(replay.status).toBe(412);
      expect(await storage.head(bucket, key)).toMatchObject({
        contentLength: bytes.byteLength,
        contentType: "application/pdf",
        checksumSha256,
        metadata: { "folio-artifact-id": artifactId },
      });

      await storage.deleteObject(bucket, key);
      await expect(storage.head(bucket, key)).rejects.toThrow();
      expect(await storage.head(bucket, siblingKey)).toMatchObject({
        contentLength: 7,
      });
    } finally {
      await storage.deleteObject(bucket, key);
      await storage.deleteObject(bucket, siblingKey);
      client.destroy();
    }
  });
});
