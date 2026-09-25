import {
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { describe, expect, it, vi } from "vitest";

import { S3ObjectStorage } from "./storage";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://upload.example.test"),
}));

describe("S3 object storage", () => {
  it("binds upload headers and metadata into the signed PutObject request", async () => {
    vi.mocked(getSignedUrl).mockClear();
    const internalClient = {} as never;
    const presignClient = {} as never;
    const storage = new S3ObjectStorage(internalClient, presignClient);
    await storage.presignPut({
      bucket: "private-bucket",
      key: "private/pdf/opaque",
      contentType: "application/pdf",
      checksumSha256: "checksum-value",
      byteSize: 1234,
      artifactId: "artifact-id",
    });

    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    const signedUrlCall = vi.mocked(getSignedUrl).mock.calls[0]!;
    expect(signedUrlCall[0]).toBe(presignClient);
    const command = signedUrlCall[1];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: "private-bucket",
      Key: "private/pdf/opaque",
      ContentLength: 1234,
      ContentType: "application/pdf",
      ChecksumSHA256: "checksum-value",
      Metadata: { "folio-artifact-id": "artifact-id" },
    });
    expect(signedUrlCall[2]).toEqual({
      expiresIn: 300,
      unhoistableHeaders: new Set([
        "x-amz-checksum-sha256",
        "x-amz-meta-folio-artifact-id",
      ]),
    });
  });

  it("uses the presigning client for download URLs and the internal client for object reads", async () => {
    vi.mocked(getSignedUrl).mockClear();
    const internalSend = vi.fn().mockResolvedValue({ VersionId: "version-1" });
    const internalClient = { send: internalSend } as never;
    const presignClient = {} as never;
    const storage = new S3ObjectStorage(internalClient, presignClient);

    await storage.presignGet(
      "private-bucket",
      "private/key",
      "version-1",
      'résumé "final".csv',
    );
    await storage.latestVersionId("private-bucket", "private/key");

    const signedCall = vi.mocked(getSignedUrl).mock.calls[0]!;
    expect(signedCall[0]).toBe(presignClient);
    expect((signedCall[1] as GetObjectCommand).input).toMatchObject({
      VersionId: "version-1",
      ResponseContentDisposition:
        "attachment; filename=\"r_sum_ _final_.csv\"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.csv",
    });
    expect(internalSend).toHaveBeenCalledOnce();
  });

  it("keeps control characters out of the fallback filename", async () => {
    vi.mocked(getSignedUrl).mockClear();
    const storage = new S3ObjectStorage({} as never);

    await storage.presignGet(
      "private-bucket",
      "private/key",
      "version-1",
      'café\r\n"report".csv',
    );

    expect(
      (vi.mocked(getSignedUrl).mock.calls[0]![1] as GetObjectCommand).input
        .ResponseContentDisposition,
    ).toBe(
      "attachment; filename=\"caf____report_.csv\"; filename*=UTF-8''caf%C3%A9__%22report%22.csv",
    );
  });

  it("removes path separators from the Unicode filename parameter", async () => {
    vi.mocked(getSignedUrl).mockClear();
    const storage = new S3ObjectStorage({} as never);

    await storage.presignGet(
      "private-bucket",
      "private/key",
      "version-1",
      "../../café dir\\report.csv",
    );

    expect(
      (vi.mocked(getSignedUrl).mock.calls[0]![1] as GetObjectCommand).input
        .ResponseContentDisposition,
    ).toBe(
      "attachment; filename=\".._.._caf_ dir_report.csv\"; filename*=UTF-8''.._.._caf%C3%A9%20dir_report.csv",
    );
  });

  it("deletes only the explicitly selected object version", async () => {
    const internalSend = vi.fn().mockResolvedValue({});
    const storage = new S3ObjectStorage({ send: internalSend } as never);

    await storage.deleteVersion("private-bucket", "private/key", "version-1");

    const command = internalSend.mock.calls[0]![0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect((command as DeleteObjectCommand).input).toEqual({
      Bucket: "private-bucket",
      Key: "private/key",
      VersionId: "version-1",
    });
  });

  it("lists every version and delete marker for only the exact key", async () => {
    const internalSend = vi
      .fn()
      .mockResolvedValueOnce({
        Versions: [
          { Key: "private/key", VersionId: "version-2" },
          { Key: "private/key-suffix", VersionId: "unrelated" },
        ],
        DeleteMarkers: [{ Key: "private/key", VersionId: "marker-1" }],
        IsTruncated: true,
        NextKeyMarker: "private/key",
        NextVersionIdMarker: "version-2",
      })
      .mockResolvedValueOnce({
        Versions: [{ Key: "private/key", VersionId: "version-1" }],
        IsTruncated: false,
      });
    const storage = new S3ObjectStorage({ send: internalSend } as never);

    await expect(
      storage.listVersions("private-bucket", "private/key"),
    ).resolves.toEqual(["version-2", "marker-1", "version-1"]);
    expect(internalSend).toHaveBeenCalledTimes(2);
    expect(internalSend.mock.calls[0]![0]).toBeInstanceOf(
      ListObjectVersionsCommand,
    );
    expect(
      (internalSend.mock.calls[1]![0] as ListObjectVersionsCommand).input,
    ).toMatchObject({
      Prefix: "private/key",
      KeyMarker: "private/key",
      VersionIdMarker: "version-2",
    });
  });

  it("treats an already deleted object version as an idempotent success", async () => {
    const noSuchVersion = Object.assign(new Error("Version does not exist"), {
      name: "NoSuchVersion",
    });
    const internalSend = vi.fn().mockRejectedValue(noSuchVersion);
    const storage = new S3ObjectStorage({ send: internalSend } as never);

    await expect(
      storage.deleteVersion("private-bucket", "private/key", "version-1"),
    ).resolves.toBeUndefined();
    expect(internalSend).toHaveBeenCalledOnce();
  });
});
