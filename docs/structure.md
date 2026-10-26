# Folio structure

Status: implemented for M1 on 15 September 2026; BILL-T08, BILL-T09A, BILL-T27,
and BILL-T29 code-complete on 20 September 2026; BILL-T24 and BILL-T28 backend
independently verified on 23 September 2026

## Intended layout

```text
folio/
|-- src/
|   |-- auth/            server-only OIDC, claims, sessions, and cookie helpers
|   |-- aws/             optional SDK role credential provider
|   |-- browser/         browser-compatible upload checksums and secure UUIDs
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
|-- account-attribution-plan.md  proposed bank/card attribution and personalized reporting
|-- ui-plan.md           approved directional information architecture and workflow
`-- roadmap.md           stable milestones, gates, and progress

.agents/
|-- log.md               durable decisions and discarded approaches
`-- handoff.md           resumable session state
```

TanStack generates `src/routeTree.gen.ts`; build output and framework-generated
temporary files are ignored.

The root `GLOSSARY.md` defines confirmed domain terminology. Proposed account and
reporting behavior lives in `docs/account-attribution-plan.md`, not in the glossary.

`src/routes/imports.tsx` owns the Files shell. `imports.upload.tsx` delegates the
single-file form to `-file-upload.tsx`; `imports.files.$artifactId.tsx` loads safe
metadata for `-file-detail.tsx`, which owns PDF review and CSV proposals.
`imports.library.tsx` links to reopenable file details. Legacy source-specific
routes redirect to the unified upload form with a selected profile.
`artifacts/library-query.ts` owns shared library filter/sort validation and defaults;
the library route preserves its existing query exports. `artifacts/file-review-queue.ts`
loads ordered metadata across bounded pages using those exact filters and sorts.
`components/file-review-actions.tsx` owns the common Confirm, Confirm and next,
and Skip row plus queue feedback. PDF approval and CSV import controllers retain
their own validation and outcome state and supply the same action view.
`src/components/import-profile-tabs.tsx` owns navigation. `artifacts/metadata.ts`
validates descriptive metadata; migration 0020 adds nullable fields and 0021 adds
optional document supplier. The existing
document and import operations retain storage verification and financial writes.
`components/transaction-pdf-preview.tsx` owns authorized selected-PDF preview,
refresh and stale-request handling beside the existing manual transaction form.
Its peek variant places proposed evidence and selected PDFs in transaction edit
views above the form at full width,
uses nominal half-A4 sizing and requests hidden browser PDF toolbar controls.
`components/bank-invoice-evidence.tsx` embeds the invoice-only shared uploader,
validates local PDF previews and owns confirmed-upload review and explicit
approval. The reconciliation route keeps approved evidence selection and pending
state scoped to the bank transaction draft. It reuses the manual form rather than
creating a second transaction editor.
Explicit upload filename suggestions cross the panel through a context-guarded
callback. The route sends a numbered request naming one target field to the
mounted manual form, which consumes it once and fills only that blank field,
without deriving an activity date. Coverage-date shortcuts
remain local to the uploader and never change bank payment facts.
`domain/file-filename.ts` owns conservative original-name metadata suggestions;
the upload form applies them only to blank fields.
`domain/bank-transactions.ts` assesses settlement/invoice candidate facts.
`database/bank-repository.ts` bounds candidate queries and atomically confirms
missing settlement facts plus the bank link under locks; the route owns explicit
acknowledgement and basis labels. Confirmed settlement requires transaction-write
permission in the bank operation handler.
Rejected-artifact persistence and exact-key unversioned storage operations
are owned by `database` and `documents`, respectively.

## Ownership boundaries

`domain/errors.ts` owns the error policy catalog and public failure contract.
`server/error-handling.ts` owns classification, sanitization, correlation,
deduplication and asynchronous diagnostic context without a framework dependency.
`server/error-details.ts` owns bounded internal exception serialization and text
redaction. `domain/validation-diagnostics.ts` tracks originating schemas privately
so diagnostic paths distinguish declared fields from submitted record keys.
`server/runtime-configuration.ts` classifies runtime schema failures.
`database/transaction-cleanup.ts` preserves transaction, rollback and release
failures together.
`server/diagnostics.ts` adapts operations to that interface. Authentication routes,
MCP and commands use the same logging interface while retaining their own transport
protocols. `server/error-middleware.ts` handles framework input/request failures;
`src/start.ts` installs the middleware and explicitly preserves server-function CSRF
protection. No adapter may log raw request/provider objects or serialize private
causes into public errors.

`browser/crypto.ts` centralizes upload SHA-256/base64 and client-generated UUIDs.
HTTP hostname clients use compatible hashing and secure random bytes when native
secure-context APIs are absent. Routes retain their file validation and upload
state; server authentication and storage checksum verification do not depend on
this module.

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
`database/add-user-options.ts` validates flag-only provisioning arguments before
`database/add-user.ts` loads configuration or creates a connection. The admin-users
dialog edits display name and role through optional update fields, while activation
remains separate. See [User administration](./user-administration.md).

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
metadata, checksum and lifecycle checks. `documents/invoice-field-reader.ts` shares
verified reads, bounded extraction, parsing and advisory duplicate counts between
the web operation and MCP. Neither adapter returns original bytes or automatically
applies facts. `domain/pdf-invoice-fields.ts` and
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
File metadata editing requires both `artifacts:read` and `artifacts:edit`;
checksum-pinned PDF extraction requires `artifacts:read` and `artifacts:extract`.
Migration 0022 permits these scopes without modifying issued credentials.
`src/server/mcp-credential-operations.ts` authorizes administrator credential
management, while `src/routes/admin.tokens.tsx` presents list/create/edit-scopes/revoke
UI. Scope edits compare the expected scope set under a credential-row lock and
return metadata only. Draft editing is independent of submission ownership while
retaining the manual-draft, revision, owner, evidence and audit checks.
Existing-match submissions can reference manual drafts as well as recorded
transactions; draft targets require draft authority and an exact revision.
Suggestion actions follow transaction status so the same draft opens inline.
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
tailnet HTTP :80 -> Tailscale Serve -> existing Traefik (localhost:18080)
|-- services_public external Docker network
|   |-- Folio: hostname route, priority 100, standard Node server :3000
|   `-- MinIO: artifact path route, priority 200, same browser origin :9000
Docker Compose private stack network
|-- postgres: private persistent volume
|-- migrate/seed: one-shot schema and synthetic local administrator setup
`-- minio-init: one-shot bucket and versioning setup

production architecture, not implemented by this Compose file
|-- Google OIDC and HTTPS reverse proxy
|-- PostgreSQL with tested backup/restore
`-- private versioned S3 bucket with managed credentials
```

Database migrations run as an explicit one-shot Compose job rather than implicitly
on every application start. The application and migration job share the same
`folio:local` image and runtime build target. `ops/build-database-tools.mjs` bundles
the migration and existing local-user seed commands with their Node dependencies;
the runtime includes these under `src/database/` and SQL under `migrations/`, so
the migration runner retains its existing relative file lookup. The default server
command is unchanged. No pnpm, tsx or build dependency tree is copied into runtime.

Administrator provisioning lives in `ops/setup-database.sh` and
`ops/setup-database.sql`. It creates separate runtime and migration roles, owns
the fixed folio schema as the provisioning administrator, and establishes default
privileges. folio_admin receives schema USAGE/CREATE and owns migration objects.
Fresh setup fails on existing objects. `ops/upgrade-database-owner.sql` separately
renames the previous migration role and transfers existing Folio object ownership.
These are optional administrator-run tools, never automatic PostgreSQL init hooks
or migration-job provisioning. Compose starts PostgreSQL without mounting setup
scripts; application roles/schema must already exist before migrations run.
`database/migration-config.ts` isolates migration connection settings from runtime
configuration; `database/migration-permissions.ts` owns the table-specific runtime
grant policy. The runner verifies its role, schema USAGE/CREATE and object ownership before
applying SQL. Existing ownership transfers require explicit administrator execution.

Documents upload directly from the browser after the
server issues a narrowly scoped presigned request. Authentication follows the
configured local-password or Google mode; both create ordinary server sessions.
Google client credentials remain server inputs and do not enter browser bundles.

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

## Contextual pane boundary

`src/components/context-pane.tsx` owns validated pane targets, root search state,
navigation/dismissal guards and the reusable `SidePane`. The authenticated root
wraps the workspace with its provider. `context-pane-host.tsx` loads existing
file/transaction content with stale-response and render-error isolation; explicit
refresh updates read-only details without resetting editable forms. Existing
canonical detail/create/edit routes remain standalone adapters.

Suggested-draft save continuation uses client-only form metadata. The transaction
workflow returns the saved ID and refresh outcome synchronously to reconciliation;
the reconciliation controller owns candidate checks, settlement acknowledgement,
match-only recovery and queue advancement. It reuses the existing save/match APIs.

File metadata and recurring-bill editors use local nested panes. Form consumers
report dirty and actual pending state; known successful mutations clear guards
before pane navigation. Drafts and files remain in component state, not URLs.
File-library loader dependencies explicitly exclude inherited pane state to keep
the source list mounted. Shared pane presentation lives in `context-pane.css`.
The pane API can replace its active entry while retaining lower panes and source
search state; replacement uses the same navigation guards as other pane changes.
