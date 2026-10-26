import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { UPLOAD_URL_TTL_SECONDS } from "./upload-lifecycle";

export interface StoredObjectHead {
  contentLength: number | undefined;
  contentType: string | undefined;
  checksumSha256: string | undefined;
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
    expiresAt: string;
  }): Promise<string>;
  head(bucket: string, key: string): Promise<StoredObjectHead>;
  readPrefix(bucket: string, key: string, bytes: number): Promise<Uint8Array>;
  deleteObject(bucket: string, key: string): Promise<void>;
  presignGet(bucket: string, key: string, filename: string): Promise<string>;
  presignInline(bucket: string, key: string, filename: string): Promise<string>;
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
    expiresAt: string;
  }): Promise<string> {
    const expiryMilliseconds = Date.parse(input.expiresAt);
    if (!Number.isFinite(expiryMilliseconds))
      throw new Error("Upload expiry is invalid");
    const signingDate = new Date(
      expiryMilliseconds - UPLOAD_URL_TTL_SECONDS * 1000,
    );

    return getSignedUrl(
      this.presignClient,
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.byteSize,
        ChecksumSHA256: input.checksumSha256,
        Metadata: { "folio-artifact-id": input.artifactId },
        IfNoneMatch: "*",
      }),
      {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        signingDate,
        signableHeaders: new Set([
          "if-none-match",
          "content-type",
          "content-length",
        ]),
        unhoistableHeaders: new Set([
          "x-amz-checksum-sha256",
          "x-amz-meta-folio-artifact-id",
        ]),
      },
    );
  }

  async head(bucket: string, key: string): Promise<StoredObjectHead> {
    const result = await this.client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
        ChecksumMode: "ENABLED",
      }),
    );
    return {
      contentLength: result.ContentLength,
      contentType: result.ContentType,
      checksumSha256: result.ChecksumSHA256,
      metadata: result.Metadata,
    };
  }

  async readPrefix(
    bucket: string,
    key: string,
    bytes: number,
  ): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        Range: `bytes=0-${bytes - 1}`,
      }),
    );
    if (!result.Body) throw new Error("Stored object has no body");
    return result.Body.transformToByteArray();
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      );
    } catch (error) {
      if (isMissingObject(error)) return;
      throw error;
    }
  }

  async presignGet(
    bucket: string,
    key: string,
    filename: string,
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition("attachment", filename),
      }),
      { expiresIn: 300 },
    );
  }

  async presignInline(
    bucket: string,
    key: string,
    filename: string,
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition("inline", filename),
      }),
      { expiresIn: 300 },
    );
  }
}
