# Folio structure

Status: implemented for M1 on 15 September 2026; BILL-T08, BILL-T09A, BILL-T27,
and BILL-T29 code-complete on 20 September 2026; BILL-T24 and BILL-T28 backend
independently verified on 23 September 2026

## Intended layout

```text
folio/
|-- src/
|   |-- auth/            server-only OIDC, claims, sessions, and cookie helpers
|   |-- domain/          transaction rules, money, periods, reports, Stripe CSV, and planned bank activity
|   |-- components/      reusable UI controls and the managed manual transaction form
|   |-- database/        schema, migrations, repositories, users, auth, and abandonment
|   |-- documents/       provider-neutral S3 lifecycle and upload reconciliation
|   |-- routes/          root, health, auth handlers, and Folio workspace UI
|   |-- server/          validated operations, session-derived actor gates, and named permissions
|   `-- styles/          Folio application styling
|-- migrations/          Folio-owned PostgreSQL migrations
|-- ops/                 database role, backup, and restore commands
|-- Dockerfile
`-- package.json

docs/
|-- overview.md          approved Folio goals and architecture
|-- banking-plan.md      approved bank-transaction and reconciliation contract
|-- folio-schema.md      canonical M1/T08 tables, constraints, and deferred structures
|-- structure.md         ownership and dependency boundaries
|-- ui-plan.md           approved directional information architecture and workflow
`-- roadmap.md           stable milestones, gates, and progress

.agents/
|-- log.md               durable decisions and discarded approaches
`-- handoff.md           resumable session state
```

TanStack generates `src/routeTree.gen.ts`; build output and framework-generated
temporary files are ignored.

`src/routes/imports.tsx` owns the shared Sources shell and
`src/routes/imports.{stripe,commbank,pdf,library}.tsx` embed the source-specific
flows and artifact library.
The Stripe batch logic lives in `src/routes/-transaction-workflow.tsx`, CommBank
batch logic in `src/routes/banking.imports.new.tsx`, and PDF-only upload in
`src/routes/-artifacts.upload.tsx`. The older source-specific URLs redirect to
the Sources tabs. `src/components/import-profile-tabs.tsx` owns tab navigation;
each flow retains its own review state and invokes source-specific server
operations. Rejected-artifact persistence and exact-version storage operations
are owned by `database` and `documents`, respectively.

## Ownership boundaries

| Module       | Owns                                                                                             | Must not own                      |
| ------------ | ------------------------------------------------------------------------------------------------ | --------------------------------- |
| `auth`       | OIDC authorization-code flow, claim validation, session service, and cookies                     | UI, direct SQL, provider state    |
| `domain`     | expense invariants, money arithmetic, periods, workflow                                          | HTTP, SQL, AWS SDK                |
| `database`   | persistence and transactional implementation, including auth attempts/sessions                   | tax policy decisions              |
| `documents`  | upload lifecycle, metadata verification, object access                                           | transaction classification        |
| `server`     | use-case orchestration, session-derived actor gates, named permissions, and provider composition | rendered UI                       |
| `routes`     | validated interaction and accessible presentation                                                | direct database or S3 credentials |
| `components` | reusable field controls and manual transaction form                                              | persistence, provider credentials |

Dependencies point inward toward domain and application interfaces. Provider SDK
types do not cross into domain objects.

The implemented database surface is `folio.users`, `folio.transactions`,
`folio.source_artifacts`, `folio.transaction_artifacts`, `folio.bank_transactions`,
`folio.bank_transaction_artifacts`, `folio.auth_attempts`, and `folio.auth_sessions`.
Bank matching/classification commands are implemented under BILL-T28; populated-browser
acceptance remains open. See
[the canonical schema](./folio-schema.md).

Authentication and authorization are server-only: `src/auth/*`,
`src/database/auth-repository.ts`, `src/routes/auth/*`, and `src/server/*` handle
the OIDC exchange, identity binding, session lookup, rotation, revocation, cookie
handoff, and named-permission checks. Each protected operation resolves the active
user from the session cookie and passes that user's ID as the trusted actor ID to
repositories and document services. The browser has no actor input or actor state;
email is display-only and for identity matching, while transaction ownership remains
separate. BILL-T09A changed no database schema or migration. The confirmation-gated
upload-recovery maintenance CLI is the sole explicit actor-email exception and uses
it only to validate an active actor for exact pending-upload recovery.

Google authorization requests the `profile` scope in addition to identity and email.
A verified, nonblank name may fill a null or blank `users.display_name` during login;
an existing curated display name is preserved. Email remains the identity lookup key.

The managed manual transaction form is isolated in
`src/components/manual-transaction-form.tsx` and is the only form migrated for
BILL-T29. TanStack Form 1.33.5 owns the form state, while React Aria Components
1.21.1 supplies the non-native interaction semantics. The form retains exact money
strings until submit, uses inline and linked-summary validation, exposes creatable
comboboxes, keeps native date/file inputs, and offers explicit void-save and restore
actions. `saveManualTransaction` authorizes before strong parsing, returns safe
invalid issues or the existing saved result, and leaves generic provider errors on
the existing diagnostic path. No database migration was required; search, filters,
user administration, and Stripe upload forms remain outside this migration.

`src/components/form-devtools.tsx` owns the development-only TanStack Form Devtools
plugin. The root route loads it lazily behind `import.meta.env.DEV` and `ClientOnly`;
production does not render or bundle the Devtools UI.

## Banking boundaries

The independently reviewed implementation architecture is maintained in
[`banking-plan.md`](./banking-plan.md). Its ownership is:

| Module                     | Responsibility                                                    |
| -------------------------- | ----------------------------------------------------------------- |
| `artifacts/profiles`       | immutable profile registry, media, extension, and evidence rules  |
| `domain/bank-profiles`     | pure provider/profile parsers and safe validation issues          |
| `domain/bank-transactions` | canonical bank row, classification, and commands                  |
| `domain/cash-effect`       | shared signed-AUD projection for reports, UI, and matching        |
| `database/bank-repository` | atomic confirmation, bounded queries, locking, and reconciliation |
| `server/bank-operations`   | session authorization and use-case orchestration                  |
| `routes/banking`           | import, activity, and reconciliation presentation                 |

The architecture uses separate `transaction_artifacts` and
`bank_transaction_artifacts` through tables. The first owns supporting-evidence links;
the second owns bank-source provenance. `source_artifacts` metadata describes the file
only and never embeds related transaction identifiers.

## Deployment structure

```text
local-only Docker Compose
|-- proxy: loopback-bound HTTP entrypoint
|   |-- Folio: standard Node server
|   `-- MinIO: versioned artifact bucket on the same browser origin
|-- postgres: private persistent volume
|-- migrate/seed: one-shot schema and synthetic local administrator setup
`-- minio-init: one-shot bucket and versioning setup

production architecture, not implemented by this Compose file
|-- Google OIDC and HTTPS reverse proxy
|-- PostgreSQL with tested backup/restore
`-- private versioned S3 bucket with managed credentials
```

Database migrations run as an explicit one-shot Compose job rather than implicitly
on every application start. Documents upload directly from the browser after the
server issues a narrowly scoped presigned request. Local Compose uses a fixed
synthetic-password login that creates ordinary server sessions; Google client
credentials remain process-environment inputs for production and do not enter
browser bundles.

The validated process-start settings `FOLIO_DATABASE_SCHEMA` and
`FOLIO_S3_KEY_PREFIX` isolate deployments and test runs. They are infrastructure
configuration, not request-scoped tenant selectors. Automated tests may create a
unique validated schema and prefix and may clean up only those exact namespaces.

## Protected areas

The standalone repository has no shared application modules or workspace package
links. Provider SDKs and persistence remain behind the local `database` and
`documents` boundaries.

Secrets, local credential files, live databases, S3 objects, and cloud resources are
outside repository implementation and verification unless separately authorised.
