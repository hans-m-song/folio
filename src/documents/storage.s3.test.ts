import { randomUUID } from "node:crypto";

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { S3ObjectStorage } from "./storage";

const runIntegration = process.env.FOLIO_RUN_S3_INTEGRATION === "1";

describe.skipIf(!runIntegration)("S3 object storage integration", () => {
  it("enumerates and deletes all exact-key versions without touching a prefixed sibling", async () => {
    const bucket = "folio-test-artifacts";
    const key = `tests/artifact-deletion/${randomUUID()}`;
    const siblingKey = `${key}-sibling`;
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
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: "version-1" }),
      );
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: "version-2" }),
      );
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: siblingKey,
          Body: "preserve",
        }),
      );

      const versions = await storage.listVersions(bucket, key);
      expect(versions).toHaveLength(3);
      for (const versionId of versions)
        await storage.deleteVersion(bucket, key, versionId);

      await expect(storage.listVersions(bucket, key)).resolves.toEqual([]);
      await expect(
        storage.listVersions(bucket, siblingKey),
      ).resolves.toHaveLength(1);
    } finally {
      for (const target of [key, siblingKey])
        for (const versionId of await storage.listVersions(bucket, target))
          await storage.deleteVersion(bucket, target, versionId);
      client.destroy();
    }
  });
});
