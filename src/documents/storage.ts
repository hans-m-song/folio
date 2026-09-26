import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StoredObjectHead {
  contentLength: number | undefined;
  contentType: string | undefined;
  checksumSha256: string | undefined;
  versionId: string | undefined;
  metadata: Record<string, string> | undefined;
}

export interface ObjectStorage {
  presignPut(input: {
    bucket: string;
    key: string;
    contentType: string;
    checksumSha256: string;
    byteSize: number;
    artifactId: string;
  }): Promise<string>;
  latestVersionId(bucket: string, key: string): Promise<string | undefined>;
  headVersion(
    bucket: string,
    key: string,
    versionId: string,
  ): Promise<StoredObjectHead>;
  readPrefix(
    bucket: string,
    key: string,
    versionId: string,
    bytes: number,
  ): Promise<Uint8Array>;
  listVersions(bucket: string, key: string): Promise<string[]>;
  deleteVersion(bucket: string, key: string, versionId: string): Promise<void>;
  presignGet(
    bucket: string,
    key: string,
    versionId: string,
    filename: string,
  ): Promise<string>;
  presignInline(
    bucket: string,
    key: string,
    versionId: string,
    filename: string,
  ): Promise<string>;
}

const contentDisposition = (
  disposition: "attachment" | "inline",
  filename: string,
): string => {
  const safeFilename = [...filename]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      if (
        codePoint < 0x20 ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        character === "\\" ||
        character === "/"
      )
        return "_";
      return character;
    })
    .join("");
  const fallback = [...safeFilename]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint > 0x7e || character === '"'
        ? "_"
        : character;
    })
    .join("");
  const encoded = encodeURIComponent(safeFilename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly presignClient: S3Client = client,
  ) {}

  async presignPut(input: {
    bucket: string;
    key: string;
    contentType: string;
    checksumSha256: string;
    byteSize: number;
    artifactId: string;
  }): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.byteSize,
        ChecksumSHA256: input.checksumSha256,
        Metadata: { "folio-artifact-id": input.artifactId },
      }),
      {
        expiresIn: 300,
        unhoistableHeaders: new Set([
          "x-amz-checksum-sha256",
          "x-amz-meta-folio-artifact-id",
        ]),
      },
    );
  }

  async latestVersionId(
    bucket: string,
    key: string,
  ): Promise<string | undefined> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return result.VersionId;
  }

  async headVersion(
    bucket: string,
    key: string,
    versionId: string,
  ): Promise<StoredObjectHead> {
    const result = await this.client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
        VersionId: versionId,
        ChecksumMode: "ENABLED",
      }),
    );
    return {
      contentLength: result.ContentLength,
      contentType: result.ContentType,
      checksumSha256: result.ChecksumSHA256,
      versionId: result.VersionId,
      metadata: result.Metadata,
    };
  }

  async readPrefix(
    bucket: string,
    key: string,
    versionId: string,
    bytes: number,
  ): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        VersionId: versionId,
        Range: `bytes=0-${bytes - 1}`,
      }),
    );
    if (!result.Body) throw new Error("Stored object has no body");
    return result.Body.transformToByteArray();
  }

  async deleteVersion(
    bucket: string,
    key: string,
    versionId: string,
  ): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
          VersionId: versionId,
        }),
      );
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "NoSuchVersion"
      )
        return;
      throw error;
    }
  }

  async listVersions(bucket: string, key: string): Promise<string[]> {
    const versionIds: string[] = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    let truncated = true;
    while (truncated) {
      const result = await this.client.send(
        new ListObjectVersionsCommand({
          Bucket: bucket,
          Prefix: key,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        }),
      );
      for (const entry of [
        ...(result.Versions ?? []),
        ...(result.DeleteMarkers ?? []),
      ])
        if (entry.Key === key && entry.VersionId)
          versionIds.push(entry.VersionId);
      truncated = result.IsTruncated === true;
      if (!truncated) break;
      keyMarker = result.NextKeyMarker;
      versionIdMarker = result.NextVersionIdMarker;
      if (!keyMarker)
        throw new Error(
          "Object version listing did not provide a next page marker",
        );
    }
    return versionIds;
  }

  async presignGet(
    bucket: string,
    key: string,
    versionId: string,
    filename: string,
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        VersionId: versionId,
        ResponseContentDisposition: contentDisposition("attachment", filename),
      }),
      { expiresIn: 300 },
    );
  }

  async presignInline(
    bucket: string,
    key: string,
    versionId: string,
    filename: string,
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        VersionId: versionId,
        ResponseContentDisposition: contentDisposition("inline", filename),
      }),
      { expiresIn: 300 },
    );
  }
}
