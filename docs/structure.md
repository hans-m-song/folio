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
|-- implementation-candidates.md  investigated boundaries, acceptance cases and approval gates
|-- recurring-bills-plan.md       approved recurrence and independent document-status boundaries
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

Recurring forecasts are isolated in `domain/recurring-bills.ts` and
`database/recurring-bill-repository.ts`. `server/recurring-bill-operations.ts`
validates inputs and resolves the session actor before reads or writes;
`routes/transactions_.recurring.tsx` presents `/transactions/recurring` without
nesting the transaction-list page. AppShell supplies its Transactions child item,
and Overview loads active Pending/Due occurrence counts separately. A read-only
preview operation uses the same rule matcher for description/cadence checks.
`domain/recurring-description.ts` owns bounded RE2JS regex and literal matching.
These operations never create or edit financial transactions. Migrations 0017/0018
are prepared, not applied. Changing the date/cadence resets reminder links only.

`domain/invoice-status.ts` derives invoice/credit-note status by transaction kind
and available invoice-profile evidence. List, detail, SQL filters and Overview use
that policy independently of financial state and the legacy general Evidence filter.
The tax source-attribution table has its own sizing class; other tax tables retain
their existing widths.

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

As of 30 September 2026, BILL-T70 adds `components/autocomplete.tsx` and its shared
styling for fixed-choice single selection and enum multi-selection throughout the
workspace. Named controls preserve underlying form values, required/disabled
behavior, and native reset; existing creatable supplier/category/currency fields
remain unchanged. Transaction, bank activity, bank import, and file-library query
builders own URL state and auto-application. Their route and server schemas validate
legacy scalar equality and bounded exact-membership arrays, while repositories apply
parameterized membership predicates before pagination. No database migration is needed.

As of 1 October 2026, BILL-T73 moves mixed-clause presentation and staged editing
into `components/query-chip-builder.tsx`, with scoped chip-bar styling. Route
adapters still own their schemas, URL state, default ordering, and debounced query
application. The shared editor emits completed clauses only on blur, Enter, or
explicit application; incomplete edits stay local. Fixed-choice autocomplete
supports optional intrinsic input sizing for compact chip segments.

BILL-T75 uses `domain/bulk-transactions.ts` for the bounded metadata-edit contract,
`components/bulk-transaction-editor.tsx` for server preview and explicit commit,
and the Transactions route for current-page selection. Repository methods validate
exact revisions and commit changed rows atomically in deterministic lock order.
Server operations enforce existing transaction-write permissions; no MCP bulk tool
or financial-field mutation is included.

`components/money-text.tsx` owns monetary display markup without formatting or
calculation logic. It preserves existing text and strong/small semantics;
`styles/app.css` owns right alignment with the application font, including matching
table headers and left-aligned mobile field labels. Routes retain their existing
formatters, inputs, and export flows. `components/money-copy.ts` owns comma removal
for native-copy selections wholly inside one marked, non-editable monetary value.
AppShell installs and cleans up its document-level listener; mixed selections,
inputs, cut, exports and explicit Copy ID actions are not overridden.

As of 2 October 2026, BILL-T68 isolates exact direct/Business allocation in
`domain/tax-attribution.ts`. Tax source rows project owner IDs; versioned source
fingerprints and frozen v2 snapshots preserve legacy reviews and exports. The tax
route selects explicit active users from a narrow authorized option query. This
does not change operational owners, exclusions or deductibility rules.

BILL-T79's `domain/owner-funding.ts` owns exact cumulative recorded loan and
principal-repayment totals by owner through the selected financial-year end.
Tax operations calculate that summary from the full ledger alongside the selected
year's source review, using one authorized transaction read. The tax route presents
it separately from saved allocations; historical funding never expands the frozen
tax source. `domain/cash-effect.ts` supplies the negative principal-repayment sign,
while the owner-funding report branch keeps income and expense effects at zero.
Migration 0016 adds repayment invariants and extends both bank matching safeguards;
historical migrations remain unchanged.

BILL-T33's `bank-repository.nextReconciliationTarget` owns filtered keyset queue
selection and one-based page rank. The authorized server read and reconciliation
route distinguish successful matching from subsequent navigation failure; normal
match, Undo and unmatch actions retain their behavior.

BILL-T77's `domain/invoice-types.ts` and `invoice-parser.ts` own normalized text and
supplier-specific financial facts. `documents/invoice-extraction.ts` owns bounded
local worker extraction; `DocumentService.readInvoicePdf` owns actor, pinned-object
metadata, checksum and lifecycle checks. `server/invoice-operations.ts` returns
suggestions and advisory duplicate counts only. `domain/pdf-invoice-fields.ts` and
`components/invoice-suggestion-review.tsx` own explicit reviewed application to five
document fields. Route upload orchestration confirms and reuses evidence without
automatic approval or transaction saves; Stripe suggestions remain review-only.

`src/components/form-devtools.tsx` owns the development-only TanStack Form Devtools
plugin. The root route loads it lazily behind `import.meta.env.DEV` and `ClientOnly`;
production does not render or bundle the Devtools UI.

`src/domain/proposals.ts` defines the concrete MCP scopes, creation-time wildcard
expansion, and one-time credential secret generation. `src/database/proposal-repository.ts`
owns credential persistence and revision-checked MCP transaction changes;
`src/mcp/tools.ts` exposes only the tools allowed by each credential.
`src/server/mcp-credential-operations.ts` authorizes administrator credential
management, while `src/routes/admin.tokens.tsx` presents list/create/revoke UI.
`src/domain/reports.ts` owns structured transaction warnings and category totals;
`src/routes/reports.tsx` renders warning links and the preparation breakdown.
`src/domain/tax-source-review.ts` fingerprints the FY cash ledger and imported
bank-row review state; `tax-adjustments.ts`, `tax-partners.ts`, and
`tax-workbook.ts` calculate explicit adjustments, exact partner allocations,
and the export snapshot. `src/server/tax-operations.ts` authorizes the review
and export flows, `src/database/tax-review-repository.ts` persists append-only
versions, and `src/routes/reports_.tax.tsx` presents the FY2025–26 worksheet
at `/reports/tax` as a non-nested sibling of Reports.

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
