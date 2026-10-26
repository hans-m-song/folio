# Unversioned artifact storage

Decision: 7 October 2026. The operator approved discarding existing data and
removing versioned compatibility. This is a direct replacement deployment.

Rationale confirmed on 11 October 2026: support other S3-compatible backends
without requiring bucket versioning or provider version IDs. Compatibility still
requires the upload, integrity and deletion contract below; an S3-compatible API
alone does not establish that a backend satisfies it.

## Data and paths

Every upload creates a new artifact ID and object key:

```text
<prefix>/artifacts/<profile>/<artifact-uuid>.<extension>
```

The original filename remains display/download metadata. Replacing evidence
creates a new artifact rather than overwriting an existing key. The database
retains the expected base64 SHA-256 checksum, byte size, media type and confirmation
timestamp; it no longer identifies objects through S3 version IDs.

## Upload and deletion contract

Upload clients must send all returned `uploadHeaders`, including
`If-None-Match: *`, unchanged. Repeating a PUT can return HTTP 412 because the key
already exists; confirmation independently checks whether that object matches
the upload intent. Missing or mismatching objects cannot be approved.

The latest signed PUT expiry is recorded while the artifact is pending, before
the URL is issued. A deletion claim prevents further URL issuance and linking.
Deletion requested before the recorded expiry plus clock grace returns a deferred
result and keeps the deleting row available for retry. Cleanup removes the exact
object key, then removes its metadata after successful storage cleanup.

AWS supports create-only conditional PUTs and bucket-policy enforcement of the
required header. UUID paths alone do not protect against replaying a URL.
[AWS conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html),
[AWS policy enforcement](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html).

## Cutover

1. Stop application and MCP writers and wait for previously issued upload URLs
   to expire. Allow active uploads to finish before resetting storage.
2. Provision an empty database/schema with the existing manual role setup and
   run migrations. Migration 0019 refuses nonempty artifact data so old
   exact-version references cannot be silently reinterpreted.
3. Select a fresh unversioned private bucket and application prefix. Do not
   merely suspend versioning on the old bucket: old versions remain there.
4. Configure browser CORS to allow PUT/GET/HEAD and all returned upload headers,
   including `If-None-Match`, checksum and artifact metadata headers. Restrict
   allowed origins to the deployed application origin.
5. Grant the runtime role object GET/PUT/DELETE permissions for the application
   prefix. The application no longer needs version GET/DELETE or
   `s3:ListBucketVersions`. Keep bucket administration outside the runtime role.
6. For AWS deployments, enforce create-only writes on the application prefix with a bucket policy.
   For Folio's single-part uploads, an explicit deny of PUT requests missing
   `s3:if-none-match` prevents other identity grants from allowing unconditional
   overwrites. For the local SeaweedFS stack, the operator explicitly waived this
   bucket-policy requirement on 16 October 2026; Folio still signs conditional PUTs.
7. Verify PDF/CSV/MCP upload and confirmation, download/preview, rejection,
   import/proposal checks, expiry-deferred deletion and subsequent cleanup.

Existing bucket/volume retirement is a separate operator action after selecting
the intended targets. This implementation does not delete live data or change
credentials. Independent object/database backups and restore verification remain
necessary; unversioned deletion has no built-in historical object recovery.

## Conditional-write policy example

Replace the synthetic bucket and prefix before applying. Merge this deny into
the bucket's policy; identity policies must separately grant required access.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyUnconditionalArtifactPut",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::folio-example/folio/artifacts/*",
      "Condition": {
        "Null": { "s3:if-none-match": "true" }
      }
    }
  ]
}
```

Multipart and copy uploads are outside Folio's current upload contract.
