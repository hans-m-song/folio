# Disposable test dependencies

The test dependency harness starts PostgreSQL 17 and a versioned S3-compatible
service without starting the Folio application container:

```sh
pnpm test:dependencies:up
```

The command waits for both services to become healthy, then creates the synthetic
`folio-test-artifacts` bucket and enables object versioning. Stop the services and
remove their test-only volumes with:

```sh
pnpm test:dependencies:down
```

Host-side tests use these loopback endpoints:

| Dependency    | Endpoint/value                                                                  |
| ------------- | ------------------------------------------------------------------------------- |
| PostgreSQL    | `postgres://folio_test:folio_test_postgres_password@127.0.0.1:55432/folio_test` |
| S3 endpoint   | `http://127.0.0.1:59000`                                                        |
| S3 region     | `us-east-1`                                                                     |
| S3 bucket     | `folio-test-artifacts`                                                          |
| S3 access key | `folio_test_access`                                                             |
| S3 secret key | `folio_test_secret_1234`                                                        |

The credentials, bucket, and stored data are synthetic and exist only for local
tests. S3 clients connecting from the host should use path-style addressing and the
endpoint above; services on the Compose network use `http://s3:9000` instead.

## PostgreSQL reconciliation integration tests

The default `pnpm test` suite excludes the disposable PostgreSQL tests. Run the
dedicated suite after starting the dependencies and applying migrations to its
dedicated `folio_t28_verify` schema:

```sh
NODE_DISABLE_COMPILE_CACHE=1 pnpm test:dependencies:up

NODE_DISABLE_COMPILE_CACHE=1 NODE_ENV=test FOLIO_PRIVATE_MODE=true \
  FOLIO_BIND_HOST=127.0.0.1 NITRO_HOST=127.0.0.1 NITRO_PORT=43230 \
  FOLIO_DATABASE_URL=postgres://folio_test:folio_test_postgres_password@127.0.0.1:55432/folio_test \
  FOLIO_DATABASE_SCHEMA=folio_t28_verify FOLIO_DATABASE_APP_ROLE=folio_test \
  FOLIO_S3_REGION=us-east-1 FOLIO_S3_BUCKET=folio-test-artifacts \
  FOLIO_S3_KEY_PREFIX=folio-tests/ FOLIO_MAX_UPLOAD_BYTES=5242880 \
  pnpm migrate

NODE_DISABLE_COMPILE_CACHE=1 pnpm exec vitest run --config vitest.postgres.config.ts
NODE_DISABLE_COMPILE_CACHE=1 pnpm test:dependencies:down
```

These tests use only the documented synthetic PostgreSQL credentials and test
schema. The final command stops the named Compose project and removes its test-only
volumes.
