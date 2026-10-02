# Folio overview

Status: M1 code-complete on 15 September 2026; BILL-T08, BILL-T09A, BILL-T27,
and BILL-T29 code-complete on 20 September 2026; BILL-T09B, BILL-T10, and
operational verification pending  
Scope: private, low-volume invoice archive, transaction history, and tax preparation

## Goal

Provide a small internal application for two operators, with accountant-facing
exports, that records supplier expenses and imported Stripe activity while
preserving source artifacts.
The application assists reconciliation and Australian tax preparation. It does
not perform accounting, payments, BAS submission, or ATO lodgement.

Folio is the product and application name. “Supplier-expense register” remains the
domain description; the name does not imply a general ledger or accounting system.

## Confirmed boundaries

- Recurring bills are separate monthly/annual forecasts with Upcoming/Pending/Due
  states, a Transactions child page and an in-app Overview attention count.
  A matching recorded supplier expense satisfies an occurrence without an invoice;
  forecasts never enter cash, tax or partner allocations. Pattern suggestions
  require explicit confirmation. Responsibility is not financial ownership.
  Pending is within the inclusive late/grace window; Due is after it. Attention
  counts missing occurrences rather than schedules. Before saving, a read-only
  preview separates case-insensitive description matching from date-window alignment.
  Configurable early/late windows default to three days; date/cadence edits rebuild
  reminders without changing financial records. Existing Contains rules remain
  literal; optional Regex uses a bounded linear-time engine.
- Invoice/credit-note status is independent of financial state and recurrence.
  Supplier expenses and credits require available invoice-profile evidence to
  display attached; other kinds do not trigger this document warning by default.
  This status does not establish tax deductibility. General Evidence remains separate.

- Manual expense entry and file upload are the first ingestion path.
- PostgreSQL is authoritative for structured data and workflow state.
- The initial model has users, transactions, and source artifacts. BILL-T08 adds
  server-side `auth_attempts` and `auth_sessions`; BILL-T09A adds session-derived
  actor attribution and named-permission enforcement, while append-only mutation
  history remains deferred to BILL-T09B.
- One coarse global role applies per user. Ownership indicates responsibility rather
  than restricting access to a transaction or document.
- Local Compose stores original documents in a versioned MinIO bucket; production
  requires a private, encrypted, versioned S3 bucket.
- The first runnable deployment is loopback-only and Docker-based, with fixed
  synthetic credentials that must not be used for public exposure.
- Fixed-password local login and Google Workspace OIDC login both issue server-side
  sessions with named-permission enforcement. Local login is disabled in production.
  Public exposure remains blocked pending BILL-T09B, BILL-T10, and live verification.
- PDF upload, manual entry, and Stripe itemised Balance-report CSV import are the M1
  ingestion paths. The supported Stripe export is Reporting > Balance Summary
  Reports > Balance change from activity > Itemised, not Transactions > All
  activity. Stripe and CommBank CSV interfaces accept multiple files, require
  explicit per-file admission or rejection, and review combined counts before
  one batch confirmation. Each accepted CSV imports atomically and reports its
  own result. Invoice/evidence PDF upload accepts multiple files without a CSV
  batch decision. Evidence
  PDF uploads create reusable artifacts, not transactions. A fixed-profile
  CommBank CSV bank-activity import and explicit
  reconciliation workflow are implemented under BILL-T28; supported text-based
  CommBank PDF statements follow under BILL-T30. Email, webhooks, OCR, FOCUS projection, and
  direct tax lodgement are deferred.
- The dedicated Sources workspace has Stripe CSV, CommBank CSV, PDF evidence,
  and File library tabs. Unlinked artifacts remain visible in the library and
  may be permanently deleted after confirmation; linked artifacts are protected.
  New uploads
  retain an original filename for downloads; legacy records fall back to the
  stored display filename.
- Manual entry keeps common invoice fields visible and places payment, tax, and
  advanced fields behind progressive disclosure. PDF filenames matching
  `supplier-YYYY-MM-DD[-reference].pdf` suggest supplier and invoice date, plus
  reference when present; every suggestion remains editable.
- Supplier and operational-category fields remain free text but suggest eligible
  prior values. Document currency defaults to AUD with AUD and USD promoted; a
  non-AUD document reveals its effective settlement fields.
- Manual invoice, payment, and occurrence inputs are calendar dates. Imported Stripe
  activity retains provider timestamps. New AUD expense drafts start with
  Australian-GST-included document treatment. In new manual and bank-row-created
  drafts, this provisional treatment follows AUD/non-AUD document currency until
  the operator edits it; saved transaction edits never auto-switch treatment.
  Owner funding remains no tax. Currency does not establish GST-credit eligibility.
- The managed manual transaction form is the only form migrated to TanStack Form
  1.33.5 and React Aria Components 1.21.1. It retains money as exact editing strings,
  trims and normalises on submission, presents inline and linked-summary validation,
  offers creatable supplier, funding-source, category, and currency comboboxes,
  retains native date and file inputs, and exposes explicit `save_void`,
  `restore_draft`, and `restore_recorded` actions. Search, filters, user
  administration, and Stripe upload forms remain unchanged.
- New manual transactions default their editable owner to the authenticated actor.
  Manual saves require an owner at both the managed-form and authoritative server
  boundaries; imported Stripe transactions remain eligible to be unassigned.
- Manual field blur validation updates only the active field; complete cross-field
  validation still runs on submit. Empty combobox overlays are not mounted and an
  exiting overlay cannot receive pointer events.
- Manual fields use TanStack Form's documented validator callback values and direct
  blur handlers. Save actions use native named submit buttons and form submission.
  Official TanStack Form Devtools are mounted client-side only in development; their
  UI is absent from production builds.
- Each manual field declares its own explicit TanStack `onBlur` validator. A pure
  editing schema validates the supplied field value directly; no generated validator
  registry or whole-transaction blur parse is used. Cross-field and accounting rules
  remain submit-time validation. SSR render-to-hydration regression coverage verifies
  invalid money guidance and correction.
- Owner contributions, owner loans and principal repayments are explicit non-tax
  funding kinds. They are
  excluded from income, expense, and GST effects; a complete settled AUD funding
  record contributes only to the cash effect.
- A separate owner funding table shows cumulative recorded loans advanced,
  principal repaid, loan balance and other contributions through the selected
  financial-year end. It includes owners irrespective of tax profit-sharing
  percentages, exposes incomplete/unassigned/negative balances, and remains
  separate from frozen tax reviews. Repayments require an explicit lender and
  principal-only amount; contributions and transfers are not inferred to be loans
  or repayments. This is a records-based summary, not confirmation of a legal debt.
- The FY2025–26 partnership tax worksheet derives a row-level cash preparation
  ledger, separates expected exclusions from missing facts, and blocks review
  while imported bank rows are unresolved or in-period drafts remain. A reviewer
  enters reasoned income/deduction adjustments and agreed partner percentages
  totaling 100%; Folio stores each reviewed version as an append-only snapshot
  and exports CSV or JSON. A changed source fingerprint marks a saved version
  historical. This is a reviewed partnership net-result worksheet, not tax
  payable, a certified return, or direct lodgement. The reviewer must confirm
  all relevant source files were imported; Folio cannot prove that independently.
  Stripe cash preparation currently dates imported rows by their creation
  timestamp, not funds availability; income-tax timing remains a reviewer or
  accountant decision.
- Reports has Financial summary and Tax preparation child destinations in desktop and
  mobile navigation. The source-row table leads with a readable transaction
  summary and retains the transaction reference as secondary provenance.
- Standalone monetary displays and matching table headers are right-aligned with
  the existing application font. Currency labels, signs, colours, and precision
  remain unchanged. Inputs, exports, counts, percentages, and calculations do not
  use the display-only money wrapper. Normal copy within one marked monetary
  value removes grouping commas from the selected text, preserving currency,
  sign and decimals. Mixed/prose/editable selections, cut and exports retain
  native or existing behavior; unavailable/failed clipboard writes fall back
  to native copying. Real-browser clipboard acceptance remains pending.
- Imported bank rows are planned as immutable cash-movement evidence separate from
  Folio transactions. They affect no accounting or tax summary until explicitly used
  to create or reconcile a transaction. A transaction cannot be marked claimable
  without an attached, available invoice PDF.
- VPS and Lambda remain future deployment options; neither is implemented now.
- PostgreSQL schema and S3 object prefix are immutable process-start deployment
  settings. They provide environment and test isolation, not request-selected tenancy.

## Architecture

```text
browser
  |
  v
TanStack Start application
  |-- session cookie -> active user -> named permission -> trusted actor ID
  |-- UI and validated server operations
  |-- reporting and CSV export
  |-- presigned S3 upload/download coordination
  |
  |-- PostgreSQL: transactions, source-artifact metadata, and workflow
  `-- S3: immutable original documents
```

The browser uploads documents directly to S3 through short-lived presigned URLs.
The application records opaque object keys and verifies uploaded object metadata
before making a document available. It does not store document bodies in PostgreSQL
or depend on application-local files.

For manual entry, selecting a PDF and saving is one visible staged workflow:
validation, upload, confirmation, then database save. A confirmed artifact survives
a later database failure and can be linked by retrying the save without uploading it
again. Stripe CSV import exposes the corresponding validation, upload, confirmation,
and atomic-import stages. Cross-service atomicity is not claimed.

The manual form keeps raw field strings in managed form state and builds the exact
domain payload only on submission. `saveManualTransaction` authenticates and checks
permission before strongly parsing the request; invalid payloads return safe field or
form issues, successful persistence returns the existing saved discriminator, and
generic provider failures continue through the existing generic diagnostic path.
This client/server boundary changes no database schema or migration.

Protected server operations read the configured session cookie, resolve the current
active user, check the operation's named permissions, and pass that user's ID as the
trusted actor ID to repository and document operations. The browser supplies no actor
identity or authorization state. Email is a matching and display-only attribute;
transaction ownership remains a separate responsibility field. Workspace request
sequence guards discard stale load responses.

Expired protected server-function sessions return HTTP 401; authenticated users
without the required permission receive HTTP 403. Protected page navigation with
no active session redirects to login with a validated same-origin return path.
Unexpected session lookup failures remain errors rather than redirects.

MCP credentials have concrete, administrator-selected scopes. Credential creation
expands `*` or a known-resource wildcard such as `transactions:*` into the scopes
known at creation time; future scopes are not granted automatically.
Administrators can list credential metadata,
create a token with a one-time plaintext reveal, and revoke it from Administration
→ Access tokens. The token hash is never returned to the browser. MCP transaction
search includes all statuses. An MCP credential can edit all fields of its own
still-draft transactions with an exact updated-at token, and a separate scope
permits category-only edits to any transaction. Neither action approves evidence,
records a draft, or matches a bank row.

`FOLIO_DATABASE_SCHEMA` selects a validated PostgreSQL schema and
`FOLIO_S3_KEY_PREFIX` selects a validated application-owned S3 prefix. Neither value
may come from a request or user-controlled record. If multi-organisation tenancy is
later required, it will use an explicit tenant model rather than implicitly treating
deployment schemas as tenants.

BILL-T08 authentication is server-only. `/auth/login`, `/auth/callback`, and
`POST /auth/logout` are handled by the server auth module and route handlers; Google
tokens and client secrets are not sent to the browser. Production uses the exact
origin `https://folio.buildsight.com.au` and callback
`https://folio.buildsight.com.au/auth/callback`; development uses
`http://127.0.0.1:43230` and
`http://127.0.0.1:43230/auth/callback`. Google identity validation requires the
`buildsight.com.au` hosted-domain claim, verified email, and validated issuer,
audience, expiry, subject, and ID-token signature. The stable subject is bound only
to an existing eligible Folio user; unknown users are not auto-provisioned.

Login attempts are single-use rows in `auth_attempts`, keyed by a SHA-256 state hash
and retaining nonce, PKCE verifier, return path, and expiry. Sessions are revocable,
12-hour rows in `auth_sessions`: the browser receives an opaque random token while
the database stores only its SHA-256 hash. Callback rotation revokes the prior token.
No separate session-signing secret is required. Production uses the host-only,
secure `__Host-folio_session` cookie; plain-HTTP development uses the distinct
`folio_dev_session` cookie.

BILL-T09A applies the session-derived actor and named-permission policy without a
database migration. The confirmation-gated upload-recovery maintenance CLI remains
the only explicit actor-email path; it validates an active actor only for exact
pending-upload recovery.

## Domain workflow

```text
draft -> recorded -> void
```

An available source artifact is not overwritten. A replacement creates another
artifact and marks the earlier artifact superseded. Append-only mutation history and
formal review transitions remain deferred to BILL-T09B. Protected operations use the
authenticated session as the trustworthy actor.

Settlement is derived rather than stored as another transaction status. A complete
payment date, settlement amount, and settlement currency is settled; otherwise the
transaction remains pending for cash-basis preparation. Invoice date may suggest a
deterministic occurrence timestamp until the operator explicitly overrides it.

Initial summaries cover calendar months, BAS quarters, and Australian financial
years from 1 July through 30 June. They provide separate activity and cash bases,
show exclusions and unresolved classifications, and are labelled preparation and
reconciliation artefacts. They are not authoritative tax totals or representations
that a lodgement has occurred.

Operational views include a filterable, sortable transaction table; a distinct
transaction-backed artifact table; and a period chart of inflow, outflow, and net
movement. Stripe balance movement uses the imported source net value independently
of tax-preparation classification. The chart is not a running bank or Stripe balance.

## Technology

| Responsibility           | Initial choice                                                        |
| ------------------------ | --------------------------------------------------------------------- |
| UI and HTTP runtime      | TanStack Start on Node.js 24                                          |
| Packaging                | One application container                                             |
| Local/private deployment | Docker Compose                                                        |
| Structured persistence   | PostgreSQL with migrations                                            |
| Document persistence     | Versioned MinIO bucket locally; private S3 bucket for production      |
| Validation               | Zod                                                                   |
| Database access          | Drizzle                                                               |
| Authentication           | Local password or Google OIDC, server sessions, and named permissions |
| Managed manual form      | TanStack Form 1.33.5 and React Aria Components 1.21.1                 |

## Deployment portability

The initial build targets a standard Node server. Portability is maintained through
stateless request handling and narrow database, document-storage, identity, and
runtime boundaries. A Lambda deployment configuration is not built until selected.

A future Lambda deployment requires network-accessible managed PostgreSQL and an
appropriate connection-pooling boundary. The Dockerised database is not deployable
inside Lambda.

## Security baseline

- The unauthenticated application must bind only to an approved private boundary.
- Public S3 access is blocked and browser access uses short-lived presigned URLs.
- Supplied names never determine S3 object keys.
- Upload type and size are validated, and stored checksums support integrity checks.
- The application does not log document bodies or extracted personal information.
- Server operations emit one structured completion record (`success` or `failure`)
  with a correlation ID, duration, stable safe error code, retryability, and
  allow-listed provider/status metadata. Browser errors expose the matching
  reference and fixed guidance. Logs exclude raw errors, presigned URLs, actor
  details, credentials, object identifiers, SQL, document content, and stack traces.
- Protected server operations derive the actor from the session cookie, resolve an
  active user, enforce named permissions, and pass the trusted user ID to persistence
  and document operations. Email remains display-only and for identity matching; it
  is not a durable actor key. Transaction ownership is separate from the actor.
- BILL-T09A does not implement append-only audit history; that remains BILL-T09B.
- PostgreSQL is not exposed publicly.
- Public deployment is blocked until T09B, live Google/PostgreSQL/reverse-proxy
  verification under T07/T10, and the remaining deployment gates are complete.
- T29 still needs live/populated-browser verification. Its production build reported
  698.85 kB raw and 210.08 kB gzip; no previous bundle-size baseline is available.

## Operational baseline

Database and S3 recovery must be documented and tested before the register is relied
upon as the only working record. S3 versioning does not replace a deliberate backup
and restore procedure. Retention and tax classifications require accountant review.

M1 includes explicit migration, user-provisioning, stale-upload abandonment,
confirmation-gated upload recovery, database backup, and confirmation-gated restore
commands. Upload recovery is bounded to exact database-known keys. S3-only orphan
discovery, deletion, and lifecycle policy remain external operator controls because
the runtime role intentionally has no list or delete permission.

## Uncertainties

- The private host, network boundary, and production PostgreSQL location are not yet
  selected.
- The S3 region, bucket, object prefix, upload limit, and retention policy remain to
  be confirmed without committing credentials or account identifiers.
- Category vocabulary, export columns, and accountant workflow require
  representative synthetic examples and user review.
- The operator clarified that the business is a partnership and is not yet
  registered for GST as of 29 September 2026. M1 therefore
  defaults GST credits to not registered and zero, while retaining explicit fields
  so the treatment can change from an accountant-confirmed effective date.
- Whether the accountant eventually needs interactive access is undecided.
- The precise evidence fields and validation needed for income-tax deductibility,
  beyond requiring an invoice PDF, require accountant review.
- The authoritative reporting basis and foreign-currency valuation policy require
  accountant confirmation. M1 exposes neutral preparation views rather than deciding
  these tax policies.
