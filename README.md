# Folio

Folio is a private transaction-preparation workspace. It stores original evidence in the configured versioned S3 bucket and keeps browser-facing errors generic.

## Local Docker deployment

The default Compose stack is a local-only deployment with Folio, PostgreSQL, a
versioned MinIO bucket, and a loopback-bound proxy. It uses fixed synthetic
credentials and is **not suitable for public exposure**.

```sh
docker compose up --build --detach
```

Open `http://127.0.0.1:43230` and sign in with the local password
`folio-local-password-123`. If port 43230 is already in use, choose another
loopback port for both Compose and the browser:

```sh
FOLIO_LOCAL_PORT=43231 docker compose up --build --detach
```

The migration job creates an idempotent synthetic administrator. The bucket
initialization job creates `folio-local-artifacts` with versioning. Browser
uploads and downloads use presigned URLs on the same local origin; MinIO and
PostgreSQL have no host-published ports. `docker compose down` stops the stack
without deleting its named data volumes. Removing those volumes destroys the
local database and stored artifacts.

Local password login creates the same expiring, revocable server session used by
the application permission checks. It is rejected in production mode. Google
OIDC remains the production authentication path, but this Compose file is not a
production deployment recipe. Do not reuse its credentials, expose its proxy,
or treat its local data as backed up.

## Local AWS profile

The AWS SDK uses its standard credential provider chain. Select a local profile with `AWS_PROFILE`:

```sh
AWS_PROFILE=folio-local pnpm dev
```

Do not configure `FOLIO_AWS_PROFILE`; it is not a Folio setting. A profile must already be available to the process through the normal AWS SDK configuration. Folio does not read, copy, or display AWS credential files, presigned URLs, or document contents.

## Server diagnostics

Server operations emit one-line JSON completion records to the development terminal.
Match a browser error to the corresponding failure record using its `Reference` /
`correlationId`. A normal operation emits one completion record with `success` or
`failure`; the record includes `durationMs`. Failure records add a stable `code`,
`category`, and `retryable` value, plus an allow-listed provider and HTTP status when
known.

Common codes are `ACTOR_NOT_FOUND`, `DB_PERMISSION_DENIED`, `MIGRATION_REQUIRED`,
`DATABASE_UNAVAILABLE`, `DB_OUTCOME_UNKNOWN`, `AWS_CREDENTIALS_UNAVAILABLE`,
`S3_ACCESS_DENIED`, `S3_OBJECT_NOT_FOUND`, `S3_UNAVAILABLE`, and
`STRIPE_CSV_INVALID`. A conflicting reimport emits `STRIPE_IMPORT_CONFLICT` without
exposing row contents. `DB_OUTCOME_UNKNOWN` means a database mutation may have
committed; inspect Folio before resubmitting it. CSV validation failures include only
the safe reason, row number, and required missing header names, never row contents.

Request validation occurs in the framework before the operation handler and is not
included in these lifecycle records. The browser uploads directly to a presigned S3
URL, so the Folio server observes upload preparation and confirmation, not the PUT
request itself. Logs intentionally omit actor details, filenames, record and object
identifiers, bucket configuration, URLs, SQL, document content, raw exception
details, and stack traces from ordinary lifecycle fields. Failure records include a
server-only `sourceError`: ordinary errors retain their name, scalar code, message,
and stack, while Zod validation errors include only their issue array. These details
must remain in access-controlled server logs and never enter client responses.

## Stripe CSV export

From Stripe's Balance report, download CSV, Itemized, all reporting categories. The
default nine columns are accepted:

```text
balance_transaction_id,created,available_on,currency,gross,fee,net,reporting_category,description
```

Stripe's timezone-less `created` and `available_on` values are interpreted in
Folio's configured reporting timezone. If available, `created_utc` and
`available_on_utc` are preferable and are interpreted unambiguously as UTC. Imports
remain atomic: one invalid row rejects the entire file.
