import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { S3ObjectStorage } from "./storage";
import { UPLOAD_URL_TTL_SECONDS } from "./upload-lifecycle";

describe("S3 upload signature", () => {
  it("signs the conditional headers until the registered expiry", async () => {
    const expiresAt = "2040-01-01T00:05:00.000Z";
    const client = new S3Client({
      region: "us-east-1",
      credentials: {
        accessKeyId: "synthetic-access-key",
        secretAccessKey: "synthetic-secret-key",
      },
    });
    const storage = new S3ObjectStorage(client);

    try {
      const url = new URL(
        await storage.presignPut({
          bucket: "folio-test",
          key: "private/artifact-key",
          contentType: "application/pdf",
          checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          byteSize: 5,
          artifactId: "artifact-id",
          expiresAt,
        }),
      );
      const signingDate = url.searchParams.get("X-Amz-Date");
      const signedHeaders = url.searchParams
        .get("X-Amz-SignedHeaders")
        ?.split(";");

      expect(signingDate).toBe("20400101T000000Z");
      expect(url.searchParams.get("X-Amz-Expires")).toBe(
        String(UPLOAD_URL_TTL_SECONDS),
      );
      expect(signedHeaders).toEqual(
        expect.arrayContaining([
          "content-type",
          "content-length",
          "if-none-match",
          "x-amz-checksum-sha256",
          "x-amz-meta-folio-artifact-id",
        ]),
      );
      expect(
        Date.parse(
          `${signingDate!.slice(0, 4)}-${signingDate!.slice(4, 6)}-${signingDate!.slice(6, 8)}T${signingDate!.slice(9, 11)}:${signingDate!.slice(11, 13)}:${signingDate!.slice(13, 15)}Z`,
        ) +
          Number(url.searchParams.get("X-Amz-Expires")) * 1000,
      ).toBe(Date.parse(expiresAt));
    } finally {
      client.destroy();
    }
  });
});
