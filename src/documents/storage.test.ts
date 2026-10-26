import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { describe, expect, it, vi } from "vitest";

import { UPLOAD_URL_TTL_SECONDS } from "./upload-lifecycle";
import { S3ObjectStorage } from "./storage";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://signed.example.test"),
}));

describe("S3 object storage", () => {
  it("signs a conditional upload with the registered expiry and required headers", async () => {
    vi.mocked(getSignedUrl).mockClear();
    const storage = new S3ObjectStorage({} as never, {} as never);
    const expiresAt = "2040-01-01T00:05:00.000Z";

    await storage.presignPut({
      bucket: "private-bucket",
      key: "private/pdf/opaque",
      contentType: "application/pdf",
      checksumSha256: "checksum-value",
      byteSize: 1234,
      artifactId: "artifact-id",
      expiresAt,
    });

    const signedCall = vi.mocked(getSignedUrl).mock.calls[0]!;
    expect(signedCall[1]).toBeInstanceOf(PutObjectCommand);
    expect((signedCall[1] as PutObjectCommand).input).toMatchObject({
      Bucket: "private-bucket",
      Key: "private/pdf/opaque",
      ContentLength: 1234,
      ContentType: "application/pdf",
      ChecksumSHA256: "checksum-value",
      Metadata: { "folio-artifact-id": "artifact-id" },
      IfNoneMatch: "*",
    });
    expect(signedCall[2]).toEqual({
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      signingDate: new Date(Date.parse(expiresAt) - 300_000),
      signableHeaders: new Set([
        "if-none-match",
        "content-type",
        "content-length",
      ]),
      unhoistableHeaders: new Set([
        "x-amz-checksum-sha256",
        "x-amz-meta-folio-artifact-id",
      ]),
    });
  });

  it("reads the current exact key without a version selector", async () => {
    const internalSend = vi
      .fn()
      .mockResolvedValueOnce({
        ContentLength: 1234,
        ContentType: "application/pdf",
        ChecksumSHA256: "checksum-value",
        Metadata: { "folio-artifact-id": "artifact-id" },
      })
      .mockResolvedValueOnce({
        Body: { transformToByteArray: async () => new Uint8Array([37]) },
      });
    const storage = new S3ObjectStorage({ send: internalSend } as never);

    await expect(
      storage.head("private-bucket", "private/key"),
    ).resolves.toEqual({
      contentLength: 1234,
      contentType: "application/pdf",
      checksumSha256: "checksum-value",
      metadata: { "folio-artifact-id": "artifact-id" },
    });
    await expect(
      storage.readPrefix("private-bucket", "private/key", 5),
    ).resolves.toEqual(new Uint8Array([37]));

    const head = internalSend.mock.calls[0]![0] as HeadObjectCommand;
    const get = internalSend.mock.calls[1]![0] as GetObjectCommand;
    expect(head.input).toEqual({
      Bucket: "private-bucket",
      Key: "private/key",
      ChecksumMode: "ENABLED",
    });
    expect(get.input).toEqual({
      Bucket: "private-bucket",
      Key: "private/key",
      Range: "bytes=0-4",
    });
  });

  it("signs inline and attachment URLs for the unversioned key", async () => {
    vi.mocked(getSignedUrl).mockClear();
    const presignClient = {} as never;
    const storage = new S3ObjectStorage({} as never, presignClient);

    await storage.presignInline(
      "private-bucket",
      "private/pdf/opaque",
      "invoice.pdf",
    );
    await storage.presignGet(
      "private-bucket",
      "private/pdf/opaque",
      'résumé "final".csv',
    );

    const inline = vi.mocked(getSignedUrl).mock.calls[0]!;
    const download = vi.mocked(getSignedUrl).mock.calls[1]!;
    expect(inline[0]).toBe(presignClient);
    expect((inline[1] as GetObjectCommand).input).toMatchObject({
      Bucket: "private-bucket",
      Key: "private/pdf/opaque",
      ResponseContentDisposition:
        "inline; filename=\"invoice.pdf\"; filename*=UTF-8''invoice.pdf",
    });
    expect((download[1] as GetObjectCommand).input).toMatchObject({
      Bucket: "private-bucket",
      Key: "private/pdf/opaque",
      ResponseContentDisposition:
        "attachment; filename=\"r_sum_ _final_.csv\"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.csv",
    });
  });

  it("deletes only the exact key and treats a missing object as success", async () => {
    const internalSend = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        Object.assign(new Error("object missing"), { name: "NoSuchKey" }),
      );
    const storage = new S3ObjectStorage({ send: internalSend } as never);

    await expect(
      storage.deleteObject("private-bucket", "private/key"),
    ).resolves.toBeUndefined();
    await expect(
      storage.deleteObject("private-bucket", "private/key"),
    ).resolves.toBeUndefined();

    expect(internalSend).toHaveBeenCalledTimes(2);
    for (const [command] of internalSend.mock.calls) {
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect((command as DeleteObjectCommand).input).toEqual({
        Bucket: "private-bucket",
        Key: "private/key",
      });
    }
  });
});
