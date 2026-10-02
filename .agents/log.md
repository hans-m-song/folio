# Folio standalone decisions

## 2026-10-03 — Verified commits and recurrence acceptance

- The operator accepted the BILL-T85 visual result and requested commits after
  verification from now on. Do not commit failed or unverified changes.
- BILL-T86 authorizes bounded disposable PostgreSQL checks for recurrence links,
  owner repayment constraints and reconciliation queue ordering, without live data.
- A new isolated PostgreSQL container accepted all 18 migrations in folio_t28_verify.
  This does not establish the migration state of any operator database.
- The working tree spans earlier feature slices; the operator approved committing
  all verified application changes, split into features where practical.
  docker-compose.yml and local agent/config directories remain excluded from review
  and staging because their potential sensitive contents have not been authorized.
- Both PostgreSQL files pass sequentially: 16 synthetic cases. Recurrence links,
  stale revisions and cadence resets preserve transactions; repayment constraints
  and negative matching, and queue ordering/wrap/page selection are exercised.
  The isolated container and data volume were removed. Full suite remains 1,086
  passed/one skipped; build/TypeScript, source lint and changed-file formatting pass.
  No live database acceptance or storage compatibility claim follows from these
  checks. Six feature commits record the verified application work: b273be1,
  8010974, 8c63be2, 8ab15b3, 69d6bbf and 62fc5e2. Intermediate commits share
  dependencies; test/build results describe the final combined application tree.

## 2026-10-02 — Recurrence presentation and historical estimates

- BILL-T85 keeps the existing preview column order while allocating most width to
  Description. Recurrence calendar dates use DD Mon YYYY in UTC for presentation;
  machine-readable dates remain ISO. Source links use scoped application styling.
- Show scheduled unresolved Pending/Due occurrences plus only the next scheduled
  Upcoming. Missing history uses bounded oldest-first pages; full attention counts
  are independent of paging. Completed and off-cadence linked associations remain
  accessible in details for review/unlinking, not as additional forecasts.
- Estimates derive from unambiguous on-cadence recorded document amounts, including
  pre-anchor history and excluding unusable amounts/future dates. Min/max preserve
  decimal precision; displayed averages round directly to cents with BigInt, avoiding
  double rounding. Persisted expectedAmount remains for compatibility but is no
  longer user-facing. No financial records, schema, queries or dependencies changed.
- Terminal null cursors are authoritative; workspace refresh clears page caches even
  with unchanged schedule revision. Trusted server context supplies estimate cutoffs.
- Full synthetic suite passes 1,086 tests, one skipped; independent focused review
  passes 98 tests and source audit/scoped lint/format and final sequential production
  build/TypeScript pass. Fixture helpers use explicit domain interfaces to avoid
  literal inference errors; no suppression casts were added. Visual/live PostgreSQL
  acceptance was not exercised in this slice.

## 2026-10-02 — Historical cadence preview boundary

- BILL-T84 extends preview backward through monthly/annual cadence, preserving
  the original calendar anchor's day and leap/month-end clamping. Active reminders
  still begin at the first expected date; historical preview is analysis only.
- Counterparty autocomplete reuses existing actor-authorised entry suggestions and
  permits custom text. Track recurring bill uses the Edit transaction action style.
- Independent review caught stale pre-anchor link dates rendering as reminders.
  A defensive display guard excludes only those dates; later ineligible links stay
  visible for review/unlinking. Normal cadence edits already clear schedule links.
- Final synthetic suite passes 1,071 tests with one skipped across 101 files;
  independent focused and closure checks, lint/format and production build/TypeScript
  pass. No financial records, new SQL,
  migrations, dependencies or live data were changed for this slice.

## 2026-10-02 — Reminder rules and grace terminology

- The operator permits reminder history loss on editing date/cadence; financial
  records remain protected. The earlier immutable-cadence proposal is discarded.
- Approved before-save live regex/date preview and configurable directional early/
  late windows. Preserve literal Contains rules; add case-insensitive Regex mode.
  Pinned RE2JS 2.8.6 supplies linear-time matching without executing native user regex.
- Terminology is Upcoming before date, Pending during inclusive grace window, Due
  afterward. Separate counts refer to missing occurrences, not schedules. Notifications
  remain in-app only. Prepare0018; no migration application or live verification.
- Full-history counts use calendar arithmetic, not expanded forecast rows. Preview
  respects directional windows and displays an eligible expected date when the
  nearest calendar date is outside an asymmetric window. Cached matchers include
  mode/pattern identity so editing a reused object cannot retain a stale expression.
- Stable full synthetic suite passes 1,062 tests, one skipped across 101 files;
  independent review and focused closure tests pass. Scoped lint/format/whitespace
  gates and sequential production build/TypeScript pass; visual and actual PostgreSQL
  acceptance remain separately gated. No financial transaction was changed.

## 2026-10-02 — Recurring bills implementation authorisation

- T81/T82/T83 implementation is approved in the existing dirty tree. Recurrence has
  two visible states, Upcoming/Pending, and a recorded transaction alone completes
  an occurrence. A missing invoice is an independent kind-aware document status.
  Supplier expenses expect invoices, supplier credits expect credit notes, other
  kinds do not default to invoice warnings. Provider/source evidence remains separate.
- In-app notification only, evaluated on load/refresh. Forecasts never contribute to
  ledger/tax/cash/partner totals. Pattern suggestions require explicit activation;
  ambiguous matches require association. Original calendar anchors preserve prior
  missing occurrences, month-end and leap-day behavior. Pausing is a separate action.
- T82 prioritises Transaction, not Target (the operator corrected their initial
  wording), in the source attribution table only; headers fit single lines and small
  screens retain horizontal scrolling. No financial calculations are changed.
- Migration 0017 preparation, exact optimistic revisions and unique occurrence
  associations are in scope; applying/verifying against real PostgreSQL is not.
  No secrets/live records, services, browser/E2E, commits, deployment or new worktree.
- Review corrected early recorded bills to advance immediately and prevented paused
  duplicates from competing for automatic matches. Explicit links remain reserved
  and stale links remain visible/unlinkable. An opaque artifact ID is not proof of
  invoice profile/availability; invoice status requires available PDF metadata.
- PostgreSQL constraint guidance shaped additive foreign keys, unique association
  identity, exact numeric estimates and short revision-locked writes. The project
  remains local PostgreSQL, not Supabase. Real database enforcement is unverified.
- Cadence edits exposed a history-loss risk. Immutable calendar anchor/frequency
  after creation was proposed to the operator; no decision or restriction is inferred.
- Stable synthetic checkpoint passes 1,030 tests with one skipped across 101 files;
  sequential production build/TypeScript and scoped ESLint passed. T82/T83 are
  code-complete; T81 remains open for the cadence-edit decision. Migration 0017
  remains unapplied. Source table browser acceptance is still pending.

## 2026-10-02 — Owner funding separation and report Period width

- BILL-T79 keeps recorded funding separate from frozen direct/Business/final tax
  allocations. The cumulative panel uses the full ledger through financial-year
  end from the existing authorized read, including earlier years and every funding
  owner regardless of partner percentage. Missing facts and negative balances warn;
  recorded funding is not a certification of legal debt or source completeness.
- Explicit owner-loan principal repayments are cash out with zero income/expense
  effect, positive principal and an explicit lender. Supplied settlement amounts
  must be positive; null remains valid for incomplete records. Existing loan and
  contribution behavior is preserved. Contributions and transfers are not inferred
  to be loans or repayments. Interest remains a separate expense transaction.
- Additive migration 0016 preserves signed amount/direction bank-match safeguards.
  PostgreSQL constraint guidance shaped explicit nullable checks; exact integer
  arithmetic preserves cumulative amounts. The project remains local PostgreSQL,
  not a Supabase deployment. No migration was applied or actual trigger execution
  verified. MCP repayment drafting remains outside this approved UI-focused slice.
- BILL-T80 widens only the report Period field with responsive bounds and preserves
  labels, GET submission and Apply. Actual-browser visual fit remains unverified.
- Final stable suite: 965 passed, one skipped across 95 files. Sequential production
  build/TypeScript, scoped lint/formatting, whitespace checks, independent focused
  verification and read-only audit passed. No staging, commit, live records,
  services, deployment or new worktree. Existing migrations 0013–0015 are preserved.

## 2026-10-02 — User attribution, next-row actions and invoice suggestions

- BILL-T68 implements direct owner effects plus the same-percentage Business pool,
  signed exact allocations and frozen v2 snapshots without changing tax exclusions
  or ledger owners. Legacy v1 fingerprints, calculations and exports are preserved;
  unknown model versions reject. Synthetic refunds/credits and owner-stale exports pass.
- BILL-T33 uses an authorized keyset/rank read and explicit success-only next actions.
  Root review closed an implicit-selection refresh edge case by keying freshness to
  validated URL fields. Normal actions, Undo, unmatch and upload retries are preserved.
- BILL-T77 separates invoice facts from payment facts, uses pinned checksum-verified
  reads and bounded local PDF.js extraction, and applies only five reviewed document
  fields. Unknown/ambiguous content falls back to human review; Stripe is read-only.
  Confirmation never substitutes for evidence approval or transaction saving.
- Production checks caught Nitro rewriting import.meta.resolve and omitting dynamic
  dependencies. The resolver now anchors to the absolute Node entry and converts to
  a file URL. Build tracing explicitly stages legacy display/worker and native canvas
  via resolved file paths. Isolated built-code extraction passed from copied output,
  without runtime/auth imports or workspace dependency fallback. The published Nitro
  archive matches the lockfile and supports traceInclude; upstream source differs.
- Final stable suite: 943 passed, one skipped across 94 files. Sequential build/type,
  scoped lint/formatting, independent focused checks and read-only audit passed.
  PostgreSQL query execution, actual invoices and operator browser review remain
  unverified. PDF guidance shaped local bounds/privacy; PostgreSQL guidance shaped
  exact allocation and queue ordering; documentation guidance preserves verified gates.
- Existing dirty-tree work and prior migrations remain intact. No commit, staging,
  new worktree, live migration/write, storage probe/change or deployment. BILL-T78
  remains a separately authorized follow-up; no external tasks were created.

## 2026-10-02 — Candidate implementation authorization

- The operator authorized implementation of BILL-T68, BILL-T33 and BILL-T77 in
  the current working tree with synthetic tests and no commits. Separate worktrees,
  migrations, live-data access, provider tests/configuration and deployment are not
  included. Existing tracked and untracked edits remain protected.
- Implementation and verification checklists are recorded in the candidate plan;
  ownership separates tax, reconciliation and new invoice modules while main owns
  shared interface/dependency integration and durable documentation.

## 2026-10-01 — Candidate scope approval

- The operator approved the three initial scopes in the candidate-plan report:
  BILL-T68 direct owner allocation plus Business percentages, with linked
  adjustments following source attribution and unlinked adjustments using Business;
  BILL-T33 explicit successful-match/create advance across the active filtered queue
  with one wrap; BILL-T77 supplier suggestions with Stripe review-only initially.
  Per-transaction allocation overrides and imported Stripe evidence linking remain
  outside this initial scope.
- Approval is recorded in the plan, roadmap and handoff. Implementation authorization
  and baseline selection remain open. Git inspection still shows only the main
  worktree with substantial tracked and untracked changes; no commit, worktree,
  production implementation or provider test was performed at this checkpoint.
- BILL-T78 disposable provider tests, migrations, live data/configuration and
  deployment retain their separate approval gates.

## 2026-10-01 — Candidate implementation-plan investigation

- The operator replaced CommBank statement parsing as a near-term candidate with
  supplier invoice parsing and authorized local PDF inspection without external
  uploads or recording personal identifiers. All 26 supplied supplier invoices
  have extractable text and are unencrypted: ten Workspace, nine Supabase and seven
  Stripe. Two CBA statement PDFs were excluded. Nine representative files were
  rendered and their privacy-masked financial regions inspected across 15 pages;
  originals remained unchanged. Temporary readers/renders are outside the repository.
- Inspected invoice facts require distinct total/paid/due fields, multi-page and
  repeated-summary handling, and currency confirmation for unqualified `$` in
  Supabase text. Stripe invoices include processing fees and sometimes Billing
  usage; zero due is not a zero expense. Current imported Stripe fees already affect
  reports and existing evidence rules exclude invoice links to Stripe records.
  Initial Stripe review-only extraction is proposed, not yet approved or implemented.
- The operator confirmed Business amounts use the existing agreed partner
  percentages. Direct/shared signed effects must partition totals without double
  counting. Actual-user identities and source ownership need frozen new-model
  snapshots and owner-aware fingerprints while retaining exact legacy v1 comparisons.
- `docs/implementation-candidates.md` now specifies source evidence, contracts,
  ownership, synthetic acceptance cases, deliverable slices and approval gates for
  BILL-T68, BILL-T33, BILL-T77 and BILL-T78. T30 remains deferred with its original ID.
  The PDF guidance informed local privacy-masked inspection, PostgreSQL guidance
  informed exact arithmetic and snapshot/locking boundaries, and documentation
  guidance kept confirmed facts separate from proposed defaults.
- Next-row planning uses an authorized keyset selection read and the existing
  descending date/ID queue order, with page rank computed against the displayed
  filter and a bounded concurrency retry. Reconciliation writes, normal actions and
  shared form implementation remain protected. Traversal/wrap confirmation is pending.
- Storage confirmation, recovery, imports/proposals and reads depend on real version
  IDs. Proposed unversioned mode must preserve old object locators, enforce signed
  create-only PUTs and checksums, register every issued URL's expiry atomically with
  pending-state checks, and fence deletion until outstanding PUT URLs expire.
  SeaweedFS is the first documentation-based probe candidate, not locally verified;
  Garage's exact required capabilities remain unverified. No provider was selected.
- Only the main worktree exists; dirty tracked and untracked production files require
  an approved baseline before parallel work. No production code, application
  dependency, migration, live record, provider/configuration, commit or worktree was
  changed by this investigation. Disposable storage tests and implementation require
  separate approval. TaskView tools were unavailable, so no external tasks were created.
- Independent source audit and focused re-review passed for scope approval after
  clarifying one-based queue pages and the existing 10,100-row cap, documentAmount's
  invoiceTotal-only mapping and reviewed paid-only totals, content/filename date
  separation, and upload/deletion fencing. No provider/production test was run.
  Three operator scope choices, baseline approval and disposable-test approval
  remain pending; investigation completion is not implementation approval.

## 2026-10-01 — Percentage Business expenses and parallel-work candidates (BILL-T68)

- Operator clarified the initial model: each partner receives directly attributed
  transactions plus a percentage allocation of Business expenses. Custom per-cost
  splits and direct reassignment of individual Business costs are deferred. The
  proposed percentage source is the agreed partner shares; separate Business-cost
  shares remain unconfirmed. No allocation code or live ownership changed.
- Current code/backlog inspection identified tax-independent candidate boundaries:
  explicit match/create-and-next (BILL-T33), document storage/versioning transition
  with preservation checks, and parser-only CommBank PDF support (BILL-T30) after
  its supported layout is confirmed. Full dark appearance and audit history have
  shared styling or operation/persistence overlap and are weaker full-feature pairings.
- Current document confirmation explicitly rejects missing immutable version IDs;
  downloads and reads also require them. Unversioned support needs lifecycle and
  legacy-object compatibility work, not merely switching a container image.
- Git inspection found only the main worktree and broadly uncommitted recent code,
  including untracked tax modules. A new HEAD-based worktree would not contain those
  changes. A shared checkpoint or reviewed tracked/untracked patch baseline needs
  approval before parallel implementation. No worktree, commit, test environment,
  migration, object-store change or extra feature implementation was created.

## 2026-10-01 — Business-attribution requirement (BILL-T68)

- Operator requested Business as an allocation option, giving system-owned costs
  as an example, with partner attribution chosen during review. This requirement
  extends the pending plan; no implementation or live records changed.
- Source inspection confirms User has no system-account marker and transaction
  owner is a user reference. Proposed review targets are Business (shared) or an
  explicitly selected partner, separate from operational ownership. Non-selected
  system accounts, other non-matching owners and unassigned rows default shared;
  no system identity inference by names/roles or fake user record is proposed.
- Proposed review overrides remove directly assigned costs from the percentage
  pool, preserving source/reviewed totals and avoiding double counting. Linked
  adjustments follow final reviewed attribution; unlinked adjustments remain shared.
  Save overrides in the versioned review snapshot, leaving ledger owners unchanged.
- One target per transaction is the proposed minimal scope; custom multi-partner
  splits are unconfirmed, as are the full adjustment/shared-pool plan and
  implementation authorization. No database migration or test run was performed.

## 2026-10-01 — User-attribution plan checkpoint (BILL-T68)

- Source inspection confirms the tax partner contract still stores generic labels
  and percentages; tax ledger rows omit owner IDs. New manual/reconciliation rows
  default owner to the actor. Ownership is operational responsibility, not proof
  of the agreed partner allocation; no live ownership records were inspected.
- Reviewed results are append-only JSONB with extensible object keys. Proposed new
  versions freeze selected user IDs/labels, source ownership, percentages and exact
  direct/shared/final amounts, while legacy generic-label versions retain their
  original calculations. No record rewrite or schema migration was performed.
  Adding owner IDs to the source hash requires a new fingerprint version; legacy
  comparisons must retain their exact v1 owner-less shape/version/key order so an
  upgrade alone does not stale old reviews. Actual ownership edits continue to
  stale them through the existing updatedAt source revision.
- Proposed adjustment rule: linked adjustments follow matching selected owners;
  unlinked/non-matching-owner adjustments remain in the shared pool. All other
  non-matching/unassigned tax effects also use the shared pool, with review totals
  visible. Owner funding contributes no tax income/expense effect merely from its
  cash movement. These rules and implementation authorization await confirmation.
- PostgreSQL review guidance informed the exact-numeric and append-only compatibility
  checks. The source investigation made no tax allocation or database changes.

## 2026-10-01 — Monetary alignment decision (BILL-T76)

- Operator approved right-aligned monetary displays with the existing regular
  application font, not the preview's monospace proposal. Formatting precision,
  signs, currencies, inputs, and exports remain unchanged.
- Shared MoneyText presentation preserves strings and strong/small semantics.
  Numeric alignment uses tabular figures without font-family/size overrides.
  Overview and tax-card span selectors were narrowed to their direct labels to
  preserve nested value colours. Table selectors override banking cell alignment;
  mobile pseudo-labels explicitly remain left-aligned. Unused inline support was
  removed; compound financial detail remains unmarked and proposal prose unchanged.
- Stable full-suite verification passed 826 tests, one skipped across 86 files,
  using maxWorkers=4 without a concurrent build; independent verification passed
  153 focused tests and TypeScript. Scoped lint, formatting, and source audit
  passed. An earlier run during final edits/concurrent build had stale header
  assertions and timeout failures; these did not recur against stable source.
  No timeout/config changes were made. Final stable-snapshot production build and
  TypeScript passed. Application visual review is pending; no deployment, live
  data/database access, browser/E2E test, commit, or worktree deletion occurred.
- Browser normal-copy events can replace clipboard text, verified against the
  [MDN copy-event documentation](https://developer.mozilla.org/en-US/docs/Web/API/Element/copy_event)
  on 1 October 2026. The operator approved the follow-up, limited to selections
  within one monetary display, removing grouping commas only. AppShell now owns a
  document-level listener lifecycle; the helper preserves native behavior for
  non-monetary/mixed/editable selections and unavailable or failed clipboard writes.
  Focused worker verification passed 23 tests, TypeScript, scoped lint and formatting.
  Those gates preceded independent review; synthetic copy events do not verify
  the OS clipboard.
- Independent synthetic review found an endpoint-only containment edge case with
  nested monetary markers. Current MoneyText accepts string children, but the copy
  helper must conservatively reject malformed/nested markers as multiple-value
  copying. A minimal guard and synthetic regression close the edge case without
  expanding scope. Independent verification passed 28 focused tests, scoped lint
  and formatting. Final stable full suite passed 837 tests, one skipped across 87
  files with maxWorkers=4 and no concurrent build; sequential production
  build/TypeScript, scoped lint, formatting and whitespace checks passed. No live
  records, database/migration, OS clipboard/browser E2E, deployment, commit or
  worktree deletion occurred. Final read-only source audit found no unexpected
  copy scope or tax-attribution implementation. Rebuilt-app visual/copy acceptance
  remains pending.

## 2026-10-01 — Bulk category options, compact preview, and presentation follow-ups

- Operational category discovery now includes all non-void transaction sources and
  kinds, keeping trimmed distinct nonblank values, deterministic ordering, and the
  limit of 200. Supplier-specific category history is unchanged. Built-in expense
  suggestions merge with saved categories; exact deduplication preserves case variants.
- Bulk preview cards became a semantic five-column table with compact two-line
  context, full description text in the DOM/title, untruncated change values,
  bounded internal scrolling, and sticky headers. Mutation/selection semantics are
  unchanged. Verification passed: 816 tests, one skipped; build/TypeScript, scoped
  lint, formatting, and independent review (111 repository/route tests).
- An approved standalone table-and-cards money-formatting mock-up uses synthetic
  amounts and matching font sizes, comparing proportional/left-aligned values to
  monospace/right-aligned values. It was rendered and visually inspected; production
  typography remains unchanged pending review. Rendering used a fresh isolated
  profile and did not access Folio or the personal browser profile.
- For BILL-T68, the operator selected direct allocation of owner-linked income and
  expenses plus percentage allocation of the remaining pool. Implementation is not
  started; exclusions, tax adjustments, and saved-version compatibility need a plan.

## 2026-10-01 — Bulk editor alignment and header selection (BILL-T75 follow-up)

- The Field picker now has a visible associated label. Field, owner, and creatable
  controls use the same scoped label-to-input gap; global form styling is unchanged.
- The table header now selects or clears all visible eligible rows, shows partial
  selection as mixed, and disables when loading, applying, or no eligible rows exist.
  Void rows remain excluded; viewer controls remain hidden. Filling a partial
  selection preserves previously captured revision tokens.
- Verification passed: 54 route tests and the full suite of 813 tests, one skipped;
  TypeScript, scoped lint, formatting, production build, and independent review passed.
  Rebuilt-UI visual
  acceptance remains pending; no backend, migration, or live-data change was made.

## 2026-10-01 — Bounded metadata bulk edits (BILL-T75)

- Approved fields are counterparty, operational category, and owner; the earlier
  tax-classification mention was withdrawn. One nonempty field/value action applies
  to explicitly selected rows on the current page, bounded to 50 unique IDs.
- Preview is read-only. Commit reparses the allowlisted payload, locks transaction
  rows in ID order, validates every exact revision before writing, and skips no-ops.
  An active target owner is share-locked. Changed rows receive monotonic audit
  timestamps; financial identity, evidence, matching, and partner shares are untouched.
- Existing transaction-write permissions govern the server operations. Missing,
  void, stale, or invalid-owner selections reject the batch. No bulk MCP tool,
  migration, deployment, or live-data access is included.
- UI controls are searchable; previews are tied to the exact selection and change.
  Apply failures invalidate the preview and clear/reload selection. Parent busy
  state clears even when navigation unmounts the editor during a pending commit.
- Final code gates passed: 811 tests, one skipped; TypeScript, scoped lint,
  formatting, production build, and independent review (170 focused tests and
  TypeScript). Operator visual review remains pending.

## 2026-10-01 — Query-chip presentation polish (BILL-T74)

- Increased chip and label padding; sort direction is a separate decorative span,
  centred alongside its label. Action icons use centred inline-flex alignment.
- Clear filters and Clear sorts are left-aligned standard secondary buttons.
  Query semantics, disabled states, and accessible labels are unchanged.
- Fixed the existing-chip editing class separator outside the conditional string
  so formatting preserves it; a regression test covers editing a saved sort chip.
- Verification passed: 75 focused tests, TypeScript, scoped lint, formatting,
  production build, and independent review. Browser visual acceptance is pending.

## 2026-10-01 — Compact query-builder design (BILL-T73)

- The operator approved a shared mixed filter/sort chip bar in Transactions,
  Bank activity, Import history, and File library, replacing stretched row controls.
- Completed edits apply on blur or Enter; incomplete edits stay local. String
  fields default to contains and enum fields to searchable membership.
- Existing URL schemas, AND filter semantics, and sort priority remain the
  contract. This task does not authorize database changes or live-data testing.
- The implemented shared control rejects incomplete or route-invalid commits,
  preserves legacy scalar enum operators, prevents duplicate sorts, and cancels
  stale edits after URL/history changes. Default sort resets assign unique IDs.
- Fixed-choice popup sizing no longer imposes a 24rem minimum; compact chip inputs
  opt into intrinsic sizing. No native select controls were reintroduced.
- Final code gates passed: 782 tests, one skipped; TypeScript, scoped ESLint,
  formatting, production build, and independent review. Visual acceptance is
  pending; no deployment or database migration was performed.

## 2026-09-19 — FOLIO-EXT-02 extraction

- The repository is a standalone Folio application at its root. It has no pnpm
  workspace file, catalog references, workspace protocol dependencies, or imports
  from the former monorepo.
- The package is named `folio`, remains private, pins pnpm `10.13.1`, and requires
  Node.js `>=24`. The Docker build and runtime use `node:24-alpine`.
- TanStack's generated `src/routeTree.gen.ts` is retained because the application
  imports it at runtime; `.output`, `.nitro`, `.tanstack`, `dist`, and dependencies
  are generated or local-only and are excluded from the extracted tree.
- Manual saves preserve the submitter-selected `draft` or `recorded` status by
  reading the native submit event's submitter control. Owner labels use a nonblank
  display name and fall back to the owner's email before reporting an unassigned
  transaction.
- Server diagnostics emit one completion record per operation (`success` or
  `failure`); the previous start-phase record was removed. Safe completion metadata
  and correlation references remain unchanged.
- Secrets, credential files, live databases, S3 objects, and personal information
  were not read or copied.

## 2026-09-19 — BILL-M3 operational-visibility scope

- Operational-visibility improvements are planned after BILL-M1 operational
  acceptance and are independent of the deferred Google Workspace access milestone.
- Artifact browsing is a separate table derived from artifacts already linked to
  transactions. It does not introduce standalone artifact management or inline
  document rendering.
- The balance-activity chart shows periodic inflows, outflows, and net movement from
  existing preparation-report data. It is not a running bank or Stripe balance.
- The transaction table will prioritise meaningful review fields and add deterministic
  sorting, filtering, and bounded loading while preserving existing actions.
- BILL-M3 was implemented before BILL-T07. The transaction table uses the confirmed
  seven-column layout, reporting-timezone dates, client-side filters and sorting, and
  50-row presentation pages. Evidence labels are direct download actions.
- Stripe reporting categories use an explicit mapping. Unknown or deliberately
  unresolved adjustment categories remain reviewable; identical balance-transaction
  reimports are skipped and conflicting reimports fail with a typed safe diagnostic.
- Balance-series calculation is separate from preparation-report effects. Recorded
  Stripe rows contribute their source net value exactly once; the chart does not
  represent a running account balance.
- BILL-T23 replaced fixed review filters with allow-listed, composable AND clauses
  using field-appropriate text, date, numeric, and enum operators. Sorting is exposed
  in table headers and through visible mobile controls.
- Manual amount signs are derived from transaction kind; Stripe signs preserve the
  imported source net value. Signed values use restrained positive, negative, and
  neutral presentation colours.
- Stripe CSV artifact display names are normalised after validation to
  `Stripe-<created-from>-<created-to>.csv` using the configured reporting timezone.
  The rename is transactional metadata only; immutable object keys and bodies do not
  change.

## 2026-09-19 — Reusable PDF evidence decision

- PDF reuse is a general evidence requirement, not a bank-statement-specific import
  feature: one available PDF may support multiple manually attributed transactions.
- The immediate model remains one-to-many from artifact to transactions, with no
  more than one primary source artifact on a transaction. General many-to-many
  evidence remains deferred until required.
- Each attribution should permit an optional page, line, or section locator. Reuse
  does not imply automatic parsing, classification, or GST sufficiency.
- BILL-T24 records the work. Shared-artifact replacement and supersession behaviour
  must be corrected and tested as part of its implementation.

## 2026-09-19 — Always-visible activity decision

- The balance-activity chart is currently hidden until an operator runs a preparation
  report and is positioned below the transaction and artifact tables. This does not
  meet the intended discoverability of the operational-visibility milestone.
- BILL-T25 will place an automatically loaded default-period chart and an always-visible
  lifetime activity summary above the transaction table.
- Lifetime values cover recorded, non-void transactions and do not respond to table
  search, filters, sorting, or pagination. They show inflow, outflow, net movement,
  covered dates, included rows, and unresolved or adjustment rows.
- Transfers remain included under existing movement semantics. The UI must not call
  these values an account balance; account-aware transfer matching remains out of scope.

## 2026-09-20 — Google Workspace OIDC deployment decisions

- Folio will use application-managed Google OIDC with server-side authorization-code
  exchange rather than GCP IAP or SAML.
- Production origin is `https://folio.buildsight.com.au`; development origin is
  `http://127.0.0.1:43230`. Both use `/auth/callback`, with separate production and
  development Google web OAuth clients.
- The exact accepted Google hosted-domain claim is `buildsight.com.au`. Workspace
  membership does not replace Folio's explicit active-user allow-list.
- OAuth client credentials are injected through the process environment. They must
  not enter source control, Terraform state, browser bundles, or logs. Folio uses
  32-byte opaque session tokens and persists only SHA-256 hashes, so it does not need
  a separate session signing secret.
- Folio sessions will default to a 12-hour absolute lifetime, use opaque rotated
  tokens backed by hashed server-side records, and support explicit revocation. Google
  refresh tokens are not required.
- A reverse proxy is expected, likely Traefik. Redirect URIs use validated configured
  origins, and authentication must not trust arbitrary host or forwarding headers.
- Initial authorization supports administrators and members only. Members can use
  transaction, artifact, report, import, download, and export workflows; administrators
  additionally manage users and roles. The existing viewer database value remains for
  compatibility but fails closed until a read-only role is intentionally implemented.
- Authorization is permission-based: each server operation declares and checks a stable
  named action, while roles are code-reviewed bundles of those permissions. Use cases
  must not branch directly on role names. Runtime-editable policy machinery is deferred
  until a concrete requirement justifies it. This is not labelled ABAC, which ordinarily
  means attribute-based access control.
- First login may transactionally bind an unbound active user with an exact
  case-insensitive verified email match to the Google `sub`. Once bound, the subject is
  authoritative; material email changes require administrator reconciliation. Unknown
  users are never provisioned automatically, and deactivation revokes all sessions.
- Audit history covers authentication outcomes, logout, revocation, user and role
  administration, transaction mutations, artifact lifecycle and downloads, imports,
  and exports. Routine page views and searches are not audited; rejected authentication
  records use safe reason codes without submitted identity details.
- Logout ends only the Folio session. Sessions have a 12-hour absolute lifetime with
  no separate idle timeout and rotate after authentication and privilege changes.

## 2026-09-20 — BILL-T08 code completion

- Google OIDC login, callback, and logout are implemented as server routes using
  `openid-client` 6.8.8 with state, nonce, S256 PKCE, exact configured redirect URIs,
  verified email, exact hosted domain, and issuer, audience, expiry, and signature
  validation.
- Migration 0004 adds single-use `auth_attempts` and revocable `auth_sessions`.
  Attempts store only a SHA-256 state hash; sessions store only a SHA-256 hash of a
  32-byte opaque browser token.
- First login transactionally binds an existing active administrator or member to the
  Google subject. Unknown, inactive, viewer, and conflicting identities are rejected.
- Independent verification found that openid-client's default direct-token processing
  did not verify the ID-token JWS signature. Non-repudiation checks were enabled and a
  synthetic wrong-key regression now proves rejection.
- Docker Compose passes the exact production origin and environment-injected Google
  client credentials only to the application container. The migration container does
  not require OAuth credentials.
- Verification passed: 25 Vitest files and 149 tests, TypeScript, ESLint, Prettier,
  production build, Compose configuration, and independent security review.
- BILL-T08 does not authorize the existing workspace operations. Browser-supplied
  `actorEmail` remains authoritative until BILL-T09, so public exposure remains blocked.

## 2026-09-20 — BILL-T26 actionable server diagnostics

- Failure records keep Folio diagnostic fields distinct from the server-only
  `sourceError` object. Ordinary `Error` values preserve `name`, a JSON-safe scalar
  `code` when present, `message`, and `stack` when available.
- Zod failures record only `name` and `issues`. Hostile and non-Error throws degrade
  to safe records without changing operation behaviour.
- Client failures remain generic and include fixed guidance, the Folio diagnostic code,
  and a correlation reference; source-error details are not returned to the client.
- Verification passed: 25 test files and 160 tests, typecheck, ESLint, Prettier, and
  independent verification.
- Residual risk: Zod issue content can itself describe invalid input.

## 2026-09-20 — BILL-T09A session-derived attribution and permissions

- Browser-supplied actor attribution was removed. Protected web operations resolve the
  current active Folio user from the opaque session cookie on every request and pass
  the trusted user ID into repository and document services.
- Authorization uses stable named actions and code-reviewed role bundles. Members have
  ordinary workspace, transaction, artifact, Stripe import, report, download, and
  export actions; administrators add user, audit, and session administration; viewers
  have no actions.
- Email is display data, not the web authorization or attribution key. Transaction and
  artifact `owner_id` remain separate optional business assignments.
- Strict request schemas reject forged `actorEmail` fields. The editable actor control,
  browser actor state, and session-storage helper were removed. The operator-only
  reconciliation CLI retains explicit `--actor-email` because it has no SSO session.
- No schema migration was required. Verification passed with 26 test files and 170
  tests, TypeScript, ESLint, Prettier, production build, and independent authorization
  review.
- BILL-T09 is not complete: append-only audit history remains BILL-T09B. Live
  PostgreSQL, browser, and reverse-proxy checks and BILL-T10 also remain required before
  public exposure.

## 2026-09-20 — BILL-T27 multi-word suggestion input fix

- The shared suggestion input previously rendered its controlled value through the
  submission resolver, which trimmed an intermediate trailing space and prevented
  typing multi-word values such as a funding source.
- Editing now renders the raw custom value. Submission still trims through the existing
  resolver, so stored-value normalisation is unchanged across funding source,
  counterparty, category, and currency uses.
- Verification passed with 26 test files and 172 tests, TypeScript, ESLint, Prettier,
  production build, and independent review. A mounted browser component test is not
  present; helper coverage and static controlled-input review passed.

## 2026-09-20 — BILL-T28 bank CSV import semantics

- Bank transaction-history CSV import is planned as a complete reconciliation record,
  not a selected list of proposed deductions. Valid statement rows remain recorded.
- Pre-import review classifies rows as business, private/non-business,
  transfer/drawing, mixed-purpose, or unresolved. Private activity, transfers, and the
  private portion of mixed expenses are excluded from tax totals without deleting the
  underlying movement.
- Void remains a post-import correction for duplicates, errors, or transactions that
  did not occur. A bank payment is not treated as sufficient invoice evidence or proof
  of deductibility.
- The first importer targets an explicit four-column date, signed movement,
  description, and running-balance profile. The exact export/header variant remains an
  implementation blocker; universal heuristic bank parsing is rejected.
- Entity type remains material: company-paid private expenses stay visible for
  accountant classification and are not automatically classified as sole-trader
  drawings.

## 2026-09-20 — BILL-T29 managed manual form

- The manual transaction form now uses pinned TanStack Form 1.33.5 and React Aria
  Components 1.21.1. Search, filters, user administration, authentication, and Stripe
  upload forms remain outside this migration.
- Money remains an exact string. Raw editing values are preserved, surrounding
  whitespace is normalised at submission, and Zod supplies field-specific decimal and
  cross-field errors without binary floating-point conversion.
- Validation renders inline errors plus a linked summary, opens closed detail sections,
  and focuses the first invalid field. Creatable comboboxes support suggestions and
  arbitrary text; native date and file inputs remain.
- Voided manual transactions may save changes while remaining void or explicitly
  restore to draft or recorded. Recorded transactions expose a single explicit save
  action. Exact revision checks remain transactional.
- The save transport is opaque until the current session and transaction-write action
  are authorized. Strong parsing then returns only a sanitized `invalid` field result
  or a `saved` transaction result; repository and provider failures retain generic
  correlation-ID diagnostics.
- No migration was required. Verification passed with 28 test files and 193 tests,
  TypeScript, ESLint, Prettier, production build, mounted DOM tests, and independent
  review. Current client JavaScript is 698.85 kB raw / 210.08 kB gzip without a
  trustworthy pre-change baseline; populated live-browser review remains operational.

## 2026-09-20 — BILL-T29A manual form spacing

- The manual transaction form now uses explicit responsive grid tracks instead of
  the shared auto-fit grid: 12 desktop columns, six compact columns, and one mobile
  column.
- Primary desktop rows resolve exactly as `3 + 3 + 6` and `3 + 3 + 3 + 3`;
  full-width regions retain deliberate spans and controls are constrained against
  horizontal overflow.
- Artifact selection, form behaviour, domain rules, server operations, persistence,
  schema, and dependencies were unchanged.
- Focused tests, TypeScript, ESLint, Prettier, and the production build passed.
  Browser rendering could not be checked because no browser runtime was available.

## 2026-09-20 — BILL-T29B manual attribution and priority layout

- New manual entries default `owner_id` to the authenticated actor, while the owner
  remains editable under Advanced. Ownerless manual saves are rejected by local form
  validation and the authoritative manual-save parser.
- The global transaction schema and database column remain nullable so Stripe imports
  retain their existing unassigned ownership semantics. Existing manual ownership is
  preserved; an ownerless manual row must be assigned before its next save.
- Primary fields now render as Kind, Supplier/counterparty, Amount, and Currency,
  followed by Reference and Invoice date; Description spans the full form width.
- Verification passed with 28 files and 197 tests, TypeScript, ESLint, Prettier, and
  the production build. Populated-browser verification remains outstanding.

## 2026-09-20 — BILL-T29C selection interaction and OIDC display names

- Whole-form blur validation could rewrite all field metadata during a combobox
  pointer sequence. Blur validation is now field-scoped, while submission retains
  complete validation; empty popovers are suppressed and exiting popovers cannot
  receive pointer events.
- Google OIDC now requests `openid email profile`. The optional verified `name` claim
  is trimmed and bounded to 200 Unicode code points, then used only to backfill a null
  or blank `users.display_name` during successful eligible login. Existing curated
  names, email identity matching, roles, authorization, and `user:add` are unchanged.
- Rows created by `user:add` without a display name are populated on the user's next
  successful Google login.
- Verification passed with 28 files and 202 tests, TypeScript, ESLint, Prettier, and
  the production build. The user's browser must confirm the original pointer defect.

## 2026-09-20 — BILL-T29D pointer and save validation regression

- Deferring field blur with `setTimeout` allowed focus movement but suppressed
  pointer-driven field validation and could prevent the following save-button click
  from reaching submit validation.
- Blur now synchronously validates only the active field. Submit validation reads the
  selected save action before handling the submission; full validation applies to
  both draft and recorded actions.
- Regression coverage combines invalid Amount entry with a one-click move to another
  field, one-click draft/recorded saves, and mouse/keyboard combobox selection.
- Verification passed with 28 files and 206 tests plus all static/build gates. Live
  browser confirmation remains required.

## 2026-09-20 — BILL-T29E documented TanStack lifecycle and Devtools

- Manual fields now use TanStack validator callback values and direct
  `field.handleBlur`; the form uses native submission and named submit buttons for
  draft, recorded, void, and restore actions. Form-level `{ fields }` errors block
  persistence and feed existing accessible field/summary rendering.
- Official `@tanstack/react-devtools` 0.10.12 and
  `@tanstack/react-form-devtools` 0.2.34 are pinned as development dependencies. Their
  UI is loaded lazily through `ClientOnly` only when `import.meta.env.DEV`.
- Production output excludes the Devtools UI. `@tanstack/form-core` 1.33.5 itself
  depends on `@tanstack/devtools-event-client` 0.4.4, so the core event client remains
  in production independently of the new UI integration.
- Verification passed with 28 files and 207 tests plus all static/build gates. User
  browser validation remains the acceptance gate for the reported defect.

## 2026-09-21 — BILL-T29F explicit hydrated field validators

- Live Devtools evidence showed the invalid Amount value was touched and blurred but
  retained an empty error map. Direct domain validation returned the expected error,
  isolating the defect to the generated validator registry.
- All 19 manual form fields now declare explicit documented TanStack `onBlur`
  validators. A pure domain helper substitutes the active field value into the current
  form snapshot and returns only that field's error.
- SSR `renderToString` to `hydrateRoot` coverage now verifies pointer blur for `asda`,
  visible and ARIA-invalid guidance, correction clearing, and invalid draft/recorded
  native submissions.
- Verification passed with 28 files and 209 tests plus all static/build gates. Live
  browser confirmation remains required.

## 2026-09-21 — BILL-T29G development validator trace

- A clean development restart still showed `documentAmount` as touched and blurred
  with no `onBlur` error entry, so the failure remains unresolved.
- Development builds now log the stable marker
  `[folio:manual-transaction-form:documentAmount:onBlur]` at the exact field-validator
  boundary with only field, trigger, invocation number, and returned error. No entered
  values, form data, user data, IDs, or files are logged.
- The validator returns the traced error unchanged. Production output contains no
  trace marker or trace implementation.
- Verification passed with 28 files and 210 tests plus all static/build gates. The
  browser trace result is required to choose the next correction.

## 2026-09-21 — BILL-T29H direct editing-value validation

- The development trace proved TanStack called the Amount blur validator but the
  whole-transaction helper returned `undefined`. That helper coupled local validation
  to unrelated fields and silently returned valid for unexpected non-Zod failures.
- Blur validation now uses direct field editing schemas for optional exact decimal
  amounts, currency codes, dates, required owner, enums, and text lengths. Optional
  empty values remain valid. Cross-field, evidence, action, owner-funding, and
  accounting validation remains authoritative on form submission.
- Unexpected non-Zod failures are rethrown rather than converted to an empty error
  map. The temporary browser trace and obsolete whole-transaction field helper were
  removed.
- Verification passed with 28 files and 215 tests plus all static/build gates. Live
  browser confirmation remains required.

## 2026-09-22 — BILL-T29I form presentation

- The primary manual-entry grid is ordered Kind, Supplier, Reference, Date, then
  Amount, Currency, and Description. Desktop spans are 3/3/3/3 then 3/3/6, with
  responsive reflow retained.
- Field errors occupy their own row beneath the associated control. The amount error
  is concise and the Description control remains a textarea.
- The supplier ComboBox uses React Aria's selected-key lifecycle while preserving
  exact option selection, keyboard and pointer interaction, and arbitrary free text.
- Verification passes with 19 focused tests and 28 files/215 tests overall, plus
  TypeScript, ESLint, and Prettier. Production build verification is blocked by a
  TanStack router-devtools-core/router-core version mismatch unrelated to the form
  presentation code; dependency alignment has not been authorized.

## 2026-09-22 — BILL-T29J full-width field sizing

- Primary manual-entry wrappers, native controls, React Aria controls, and combobox
  rows now fill their assigned grid columns. React Aria custom root classes had
  prevented several wrappers from matching the previous sizing selectors.
- The desktop 3/3/3/3 then 3/3/6 spans and the existing compact/mobile reflow are
  unchanged.
- Verification passed with 19 focused tests, TypeScript, ESLint, and Prettier.
  Populated-browser computed-layout confirmation remains outstanding.

## 2026-09-22 — BILL-T28 bank-activity reconciliation plan

- The confirmed initial CommBank export is headerless AUD CSV with exactly four
  columns: posted date (`dd/MM/yyyy`), signed movement, source description, and
  running balance. It contains no pending transactions.
- Imported bank rows are immutable cash-movement evidence, not Folio transactions.
  They affect no transaction, accounting, or tax total until explicitly reconciled or
  used to create a transaction.
- BILL-T28 is split into parse/preview, immutable persistence, reconciliation,
  create-from-row, and completion-status vertical slices. Initial confirmed matches
  require exact AUD settlement amounts and are one-to-one; automatic confirmation,
  split/aggregate matching, and tolerances are deferred.
- BILL-T30 plans one explicit text-based CommBank PDF layout using the same canonical
  bank-activity pipeline. OCR and arbitrary PDF parsing remain out of scope.

## 2026-09-22 — Tentative UI information architecture

- `docs/ui-plan.md` records a review proposal, not an approved implementation plan.
- The proposed shell separates Overview, Transactions, Banking, Artifacts, Reports,
  and permission-gated Administration. Banking groups Activity, Reconcile, and
  Imports; a global Add menu replaces a permanently visible multi-purpose capture
  area.
- Provisional `UI-R*` tasks stage route separation, bounded URL-backed queries,
  independent artifacts, banking surfaces, overview, scoped operation state, and
  populated-browser verification. Stable roadmap IDs require review.

## 2026-09-22 — Tentative UI independent-review revisions

- `Reconcile` remains the chosen user-facing term for overall-position bank-row
  resolution; it explicitly does not claim formal account/statement balancing.
- Overview attention and reconciliation progress use absolute counts rather than
  percentages. Suggested matches are not preselected.
- The tentative plan now requires consistent source/audit context, explicit action
  consequences and reversal, banking capability permissions, scoped failure/conflict
  states, accessible action names, transaction/bank-row separation, and accessible
  cash-movement labelling with exact values.
- Three version-two mockups preserve the original review set and visualise these
  changes for Overview, Transactions, and Banking/Reconcile.

## 2026-09-22 — Tentative banking-domain simplification

- `docs/banking-plan.md` proposes using the source artifact as the import-level record
  and one `bank_transactions` table for immutable source rows and current
  reconciliation state. A separate `bank_imports` table is not proposed for version
  one.
- PostgreSQL artifact metadata remains authoritative; S3 tags may mirror stable
  infrastructure attributes but never own workflow state.
- The proposal defines dispositions, one-to-one exact signed-AUD matching, atomic
  create-and-match, command revisions/idempotency, three banking permissions, overview
  projections, sign conventions, and unsupported-complex-match behaviour.
- The document is tentative and awaiting independent adversarial review. It does not
  amend stable roadmap contracts.

## 2026-09-22 — Tentative banking-plan adversarial review

- The independent review accepted one artifact per import plus `bank_transactions` as
  a coherent low-volume version-one model; it did not require `bank_imports`.
- Blockers are durable typed import completion, a narrowed or persisted idempotency
  contract, protection against editing/voiding matched Folio transactions, and a
  canonical signed-AUD eligibility projection.
- Reviewer proposals for artifact-kind compatibility, required classification reasons,
  overlap rechecks, matching eligibility, retention, and replay remain tentative and
  are recorded in `docs/banking-plan.md` for decision.

## 2026-09-22 — Tentative banking-plan simplification revision

- The tentative plan now uses `artifact_profile` plus `media_type`, a minimal
  `bank_transactions` table, and a plain many-to-many artifact attribution table.
- Running balance, source row, value date, and foreign hints are non-authoritative bank
  metadata. Disposition, duplicate target, classification reason, import table,
  idempotency table, and reconciliation history are removed.
- Reconciliation state is derived from an optional matched transaction or an optional
  private/transfer/duplicate classification. Import completion reuses artifact state.
- S3 keys are `artifacts/<profile>/<artifact-id>.<extension>` using the same UUID as
  PostgreSQL. The revision awaits fresh independent adversarial review.

## 2026-09-22 — Simplified banking-plan adversarial review

- The reviewer accepted no import table, no artifact metadata, derived reconciliation
  state, natural command idempotence, and deferred accounts/audit/complex matching.
- Blockers are staged profile migration/evidence safety, one shared PostgreSQL/S3 UUID,
  serialized checksum/profile import confirmation, and database protection of matched
  financial fields.
- The reviewer challenged the locator-free through table and recommended a required
  per-artifact source row/locator. This and duplicate-reason policy remain unapproved
  decisions recorded in `docs/banking-plan.md`.

## 2026-09-22 — Candidate banking architecture codified

- Current database and S3 content is confirmed disposable test data, so the candidate
  uses a direct destructive profile/schema migration rather than dual compatibility.
- The architecture fixes artifact profile/media identity, shared PostgreSQL/S3 UUID,
  minimal bank rows, relationship metadata, derived reconciliation state, artifact-
  lifecycle import completion, natural idempotence, signed-AUD matching, matched-field
  protection, permissions, and report isolation.
- Module ownership and nine provisional `BANK-I*` vertical slices are defined in
  `docs/banking-plan.md`. The candidate awaits final independent adversarial review
  before promotion to the stable roadmap.

## 2026-09-22 — Final candidate banking architecture review

- Independent review returned do-not-promote, while accepting the core separation of
  bank activity, exact signed-AUD matching, destructive test-data migration, and
  deferred accounts/Athena/audit scope.
- Promotion is blocked on stable-roadmap reconciliation, explicit artifact replay
  semantics, profile-aware upload recovery, database match invariants, BILL-T24 shared
  artifact lifecycle, and raw-description privacy/redaction.
- These findings are recorded as review gates in `docs/banking-plan.md`; none were
  silently adopted as implementation decisions.

## 2026-09-23 — Sole-trader scope and artifact relationships confirmed

- Version one targets a private single-user sole-trader cashbook. The business is not
  GST-registered; company, multi-account, ledger, and accrual structures remain future
  scope rather than anticipatory schema.
- Supporting evidence and bank provenance use separate `transaction_artifacts` and
  `bank_transaction_artifacts` through tables. Artifact metadata does not contain
  related record identifiers.
- Exact profile/checksum duplicate imports are rejected. Non-identical imports compare
  earliest/latest transaction dates, identify each overlapping interval, warn, and
  allow explicit continuation without silent row merging.

## 2026-09-23 — Banking architecture promoted for implementation

- BILL-T24 and BILL-T28 now reflect the approved typed through tables, derived review
  state, artifact-level checksum idempotence, precise date-range overlap warning,
  profile-aware recovery, and database match invariants. BILL-T30 remains deferred.
- Dependency-backed tests will use disposable Docker containers: PostgreSQL 17 and a
  versioned S3-compatible service, isolated from development and production data.
- UI v2 mockups remain directional. Overview and Transactions remain relevant;
  Reconcile must demote running balance, remove implied action history, and use the
  simplified derived-state/classification contract.

## 2026-09-23 — UI mockups revised to approved theme direction

- Overview, Transactions, and Reconcile v3 desktop mockups adopt the supplied theme:
  oversized sans-serif headings, navy ink, pale blue-grey surfaces, rounded cards,
  compact outlined controls, and left navigation.
- Reconcile v3 demotes running balance to source details, removes implied history,
  keeps match selection empty, and uses reason-free derived classifications.
- V3 files are current project references; v2 and original images remain superseded
  comparison material.

## 2026-09-23 — UI typography and surface direction refined

- V4 mockups replace the heavy display type with a Geist-like neutral grotesk using
  moderate heading weights and compact UI proportions.
- Primary panels use elevated white surfaces, restrained soft shadows, minimal borders,
  and a pale cool-grey page canvas.
- V4 is current; v3 and earlier images remain comparison material.

## 2026-09-23 — BILL-T24 reusable evidence completed

- Migration 0005 replaces artifact kind with immutable profiles, uses the same UUID in
  PostgreSQL and canonical S3 keys, and moves manual/Stripe relationships into
  `transaction_artifacts`.
- Manual transactions can select, upload, retain, and unlink multiple invoice PDFs;
  shared artifacts remain available and artifact contexts show every linked
  transaction.
- Independent verification initially found claimable-link deletion, concurrent-delete,
  composite-key mutation, generic bank recovery, profile mutation, supersession, fresh
  migration, and presentation defects. Two correction rounds closed all findings.
- Final verification passed 30 files/226 tests, static/build gates, and real PostgreSQL
  fresh/legacy migration and concurrency checks. Populated-browser verification is the
  remaining operational gap.
- BILL-T24 is complete and BILL-T28 is now in progress.

## 2026-09-23 — BILL-T28A/B CommBank CSV slice completed

- Migration 0006 adds immutable bank transactions, typed artifact attribution,
  profile/checksum uniqueness, deferred availability enforcement, and report-neutral
  persistence.
- The fixed CommBank profile supports full preview, safe row/field errors, pinned
  server-side reparse, atomic confirmation, exact-duplicate replay, explicit overlap
  acknowledgement, cancellation, import history, and bounded activity views.
- Docker PostgreSQL and versioned MinIO checks passed atomicity, rollback, duplicate
  concurrency, overlaps, pinned confirmation, and overwrite rejection.
- Independent review required corrections for stranded pending artifacts, floating-
  point display, and safe cleanup-failure observability. Final verification passed 35
  files/247 tests and all static/build gates.
- BILL-T28C/D matching, classification, and create-from-bank remain next. Mounted-
  browser responsive/accessibility verification remains pending.

## 2026-09-23 — BILL-T28 reconciliation slice code-complete

- Migration 0007 and the repository enforce exact signed-AUD eligibility, one-to-one
  matching, reset-before-reassignment, and protection of matched financial identity.
- The reconciliation workspace provides bounded candidate ranking, explicit
  match/classify/reset actions, completion counts, and atomic create-and-match using a
  stable client-generated transaction UUID. Suggestions never apply automatically.
- Manual invoice evidence remains separate from bank provenance. Independent review
  found a supersession race; create-and-match now locks deduplicated artifact IDs in
  deterministic order and validates them after locking.
- TypeScript, ESLint, Prettier, and the full single-worker suite pass (37 files, 272
  tests). Production build currently stalls while rendering chunks and Docker CLI
  commands are unresponsive, so live PostgreSQL race/rollback and populated-browser
  verification remain explicit operational gaps rather than claimed passes.

## 2026-09-23 — BILL-T28 backend acceptance gates verified

- The build failure reproduced as a TanStack Router devtools peer mismatch. The direct
  React Router dependency is now 1.170.36 and router-core resolves to 1.171.30; frozen
  lockfile installation and the production Vite/Nitro build pass.
- Disposable Docker PostgreSQL applied migrations 0001–0007 to a synthetic schema. A
  dedicated five-test suite passed exact signed-AUD matching, reset and field
  protection, concurrent matching, create-and-match rollback/retry, and concurrent
  invoice supersession. The named test Compose project and volumes were removed.
- The ordinary 37-file/272-test suite passes with Docker stopped; dedicated database
  tests are excluded from that runner and documented separately. TypeScript, ESLint,
  and Prettier pass.
- Browser discovery returned no available browsers despite the local app responding.
  Populated-browser interaction and accessibility checks remain open.

## 2026-09-23 — Focused Playwright browser acceptance

- A disposable synthetic PostgreSQL/MinIO environment and standalone headless Chrome
  made a populated Playwright check possible after in-app browser discovery returned
  no browser. No live account or document data was used.
- Initial server rendering failed because TanStack Start server core and Router Core
  disagreed on `getMatchedRoutes`; after package alignment, Router Devtools still
  called `interpolatePath` with an object against an incompatible Core optional peer.
  The final dependency graph pins the compatible Router Core 1.171.28; the production
  build, typecheck, lint, and browser run pass.
- Playwright exposed a bank posted-date regression: PostgreSQL `DATE` read as a JS
  `Date` became the prior calendar day in Australia/Brisbane. Explicit SQL text
  projection now preserves the stored date; the regression was reproduced before the
  fix and passed afterward in real PostgreSQL list/detail assertions.
- The focused browser run passed import-history rendering; explicit match/reset;
  private classification/reset; create-form amount blur validation/cancel; recorded
  create-and-match; and 390 px horizontal-overflow check. No uncaught page exceptions
  remained. CSV upload/preview, screen-reader review, and visual alignment with the
  approved UI mockups are still open.

## 2026-09-23 — Self-contained local Compose deployment

- The default Compose file is now explicitly local-only. It starts Folio, PostgreSQL,
  a versioned MinIO bucket, a migration/synthetic-admin seed job, and a Caddy proxy
  published only on loopback. Fixed credentials are synthetic. Google OIDC remains
  the production mode; local password authentication is rejected in production and
  issues the same hashed, expiring server sessions with named permissions.
- Folio uses separate internal MinIO and browser-visible S3 presign clients. The
  bucket path must be forwarded unchanged through Caddy. Independent review caught
  an initial Host rewrite that would have omitted the non-default port and broken
  SigV4; the final proxy preserves the incoming Host and URI.
- Port 43230 was already occupied by a user process. An isolated verification
  Compose project used `FOLIO_LOCAL_PORT=43231` without touching that process. Docker
  image build and clean startup passed. Live checks passed health, invalid/valid
  local login, authenticated workspace, two signed PUT versions and pinned GET,
  and Playwright CSV upload/preview/cancel with no page exceptions.
- Ordinary tests passed 37 files/284 tests; TypeScript, ESLint, Prettier, and the
  production build passed. Public deployment, backup/restore, and remaining banking
  accessibility/confirmation gates remain separate.

## 2026-09-23 — BILL-T32 UI revamp checkpoint

- The approved v4 layout now has an authenticated shell and distinct Overview,
  Artifacts, Reports, Administration, and Banking destinations. Transactions and
  transaction detail are separate, but manual creation and Stripe import still
  occupy the Transactions list route; this misses the planned create/edit route
  split and remains a BILL-T32 acceptance gap.
- The Transactions table uses a validated, authorized server query with URL-backed
  search, filters, sort, and 50-row pages. A separate form-options operation
  preserves member-accessible owner and suggestion controls without loading the
  legacy unbounded workspace collection. The lifetime cash summary is independent
  of table filters, but its existing report service still scans all transactions
  server-side before returning aggregates.
- Overview attention counts use exact database aggregates for unresolved bank rows,
  imports with unresolved rows, linked-evidence gaps, and pending/abandoned CSV
  upload states. Abandoned does not mean failed. Recent records are bounded
  snapshots, not an audit history. Banking, Overview, and Reports have local retry
  controls; workflow pending/status messages are scoped to their actions.
- The final static gate passed 42 test files/331 tests, typecheck, lint, Prettier,
  and production build. Independent review identified the route split, the report
  scan, a count/page concurrent-write race, and an unbounded linked-artifact
  projection within each 50-row page. The latter two are documented as
  consistency/scaling risks for this sole-trader slice; no acceptance decision
  has been made, and neither was shown to break the ordinary workflow.
- The in-app browser service exposed no browser. Two Docker image builds stalled
  during Nitro packaging, so the new query was not run against PostgreSQL. The
  isolated Compose project and its synthetic PostgreSQL/MinIO volumes were removed;
  the pre-existing local app was untouched. Do not mark BILL-T32 complete until
  visual/keyboard verification and a new-query database smoke pass.

## 2026-09-23 — BILL-T32 dedicated transaction workflows

- Manual create, manual edit, and Stripe CSV import now have direct routes rather
  than embedded sections on the Transactions list. The list keeps the lifetime
  summary, bounded query, and table. AppShell Add and transaction detail/list
  actions link to these routes.
- Independent review found two meaningful post-split regressions: the signed-out
  Stripe form was visible despite server-side mutation authorization, and a
  successful create could leave the null-ID form active for a second insertion.
  Route-local session-first loading and signed-out boundaries now suppress the
  forms; successful create immediately removes the active form and navigates to
  the created detail, with a locked success fallback if navigation fails. The
  misleading irreversible-void confirmation was also corrected; Restore remains
  an explicit user action.
- The post-fix static gate passed 43 test files/335 tests, typecheck, ESLint,
  Prettier, and production build. Filtered-list query context is not retained on
  edit/cancel; no return-query contract was added during this extraction.

## 2026-09-24 — BILL-T32 operator-feedback decisions

- CommBank import retains every valid source row; classification happens after
  import in Reconcile. The import stepper must include a real, separate confirmation
  screen rather than labeling the transient network request as a step.
- Stripe import gains a derived-transaction preview and explicit approval before
  committing rows. This request does not include Stripe-payout-to-bank matching.
- Reusable evidence selection is limited to available PDFs for this slice. CSV
  source provenance is distinct from invoice evidence.
- Reversible bank classifications should apply without native browser confirmation
  boxes and expose Undo. App dialogs are appropriate only when a consequential
  action still warrants explicit confirmation. Mobile navigation must use an
  accessible menu rather than horizontal overflow; desktop sidebar items should
  fill a consistent width near the left viewport edge.

## 2026-09-24 — BILL-T32 implementation and review

- Stripe approval reviews paged derived transaction rows before atomic commit;
  conflicts are visible across pages and block confirmation. Confirmed archived
  uploads can reopen preview; failed or uncertain upload states do not promise an
  unavailable retry path. Payout-to-bank matching remains out of scope.
- CommBank confirmation is a separate operator step. A profile-scoped transaction
  advisory lock serializes overlapping imports; the acknowledgement fingerprint
  binds consent to the precise current overlap set. Classification follows import.
- Bank-row create-and-match offers only kinds with a compatible signed AUD cash
  effect. Owner funding is not inferred from an outflow. Existing evidence selection
  remains available-PDF-only; bank CSV provenance is not invoice evidence.
- Reversible classifications use revision-checked Undo. Removing a match, voiding a
  transaction, and deactivating a user use in-app confirmation dialogs rather than
  native browser prompts. Independent review found and corrected the owner-funding
  sign bug and incompatible-kind choices.
- Full static/build gate: 47 files/377 tests, TypeScript, ESLint, Prettier, and
  production build pass. Browser rendering and new disposable database/object-store
  checks remain unverified; BILL-T32 is not complete.

## 2026-09-24 — BILL-T32 populated-UI correction checkpoint

- A bank CSV description is payment provenance, not approved accounting data.
  Parsed source hints are visually labelled as unverified and enter the new
  transaction form only after an explicit Apply action. Raw row detail omits the
  source running balance and card suffix.
- Foreign document currency opens tax classification but does not itself establish
  foreign tax inclusion. The form offers an explicit tax-treatment action;
  historical supplier category is offered only when one unambiguous matching
  category is found, without writing it automatically.
- A newly selected invoice PDF in Reconcile follows the existing
  `manual_invoice_pdf_v1` upload and confirmation path before atomic transaction
  creation and bank match. Confirmed upload intent and transaction ID are reused
  for retry. A response lost during upload initiation may leave a pending artifact
  because the start API lacks an idempotency key.
- PostgreSQL DATE values are normalized to date-only strings at repository mapping,
  with defensive detail rendering. The prior `s?.trim` render failure was not a
  server-operation failure. A recoverable client boundary now sends a strictly
  sanitized name/code/message diagnostic to the server, with correlation and
  rate limiting; it does not transmit form data or a stack trace.
- Full static/build gate after these edits: 48 files/392 tests, TypeScript, ESLint,
  Prettier, and production build pass. Browser and disposable database/object-store
  acceptance remain open; no user data was inspected.

## 2026-09-24 — BILL-T32 fee-row and entry-action follow-up

- A CommBank international-fee description demonstrated that stripping card,
  currency, and value-date tokens is not a reliable supplier extractor. New
  imports no longer create `counterpartySuggestion`; reconciliation ignores the
  legacy field for display, prefill, and candidate ranking. Raw description and
  CSV amount/date facts remain available. Bank value date is only a payment
  timing hint, never an invoice date.
- A matching `supplier-YYYY-MM-DD-reference.pdf` filename again offers opt-in
  blank-fields-only supplier, invoice date, and reference values in the shared
  manual form. User-entered values are not overwritten. The uploaded PDF is
  evidence; its filename is not authoritative accounting data.
- Transaction-list action links, edit Void, and save feedback received distinct
  styling so actions wrap and the destructive action is legible. Local auth is
  unchanged: the user confirmed the configured `127.0.0.1` origin works and
  `localhost` does not.
- Final full code gate: 48 files/400 tests, typecheck, lint, formatting, and
  production build pass. Save errors now use assertive announcement and focus
  adjacent to the form action area. Independent read-only review found no
  production defect in the inspected scope. In-app browser discovery found no
  available browser, so rendered visual acceptance is unverified.

## 2026-09-24 — Active navigation contrast and future milestones

- The Banking child active state previously used `--accent-soft` against the
  light canvas, making selection visually faint despite dark text. It now uses
  `--accent-strong` with white text, about 13.08:1 text contrast. This changes
  only the active child navigation treatment, including the mobile menu.
- The user placed candidate review/next-row reconciliation, local Codex MCP
  proposal ingestion with Folio approval, and dark mode into tentative future
  milestones BILL-M5/T33, BILL-M6/T34, and BILL-M7/T35. Remote MCP access is
  explicitly later. Next-row semantics, batch approval granularity, MCP local
  transport/auth, and dark-mode manual override remain unconfirmed.
- Static validation after the contrast edit: 48 files/400 tests, typecheck,
  lint, formatting, and production build pass. Rendered visual acceptance was
  not run in this turn.

## 2026-09-24 — Bulk import scope and Stripe report distinction

- The user confirmed BILL-M4B/T36: multi-file selection for Stripe Balance
  Summary itemised CSVs, CommBank transaction-history CSVs, and invoice/evidence
  PDFs. CSV review and confirmation remain per file. PDF upload alone creates
  no transaction; bank-statement PDF extraction is not part of this slice.
- A Stripe Transactions > All activity export is not the same as the itemised
  Balance Summary report required by the current parser. Its known header set
  now produces explicit unsupported-report guidance rather than implying the
  Stripe export itself is corrupt.
- The user confirmed an auto-until-edited tax-treatment rule for new expenses:
  AUD proposes Australian GST included, non-AUD proposes foreign tax included,
  and manual tax choices are preserved. This document classification is not a
  GST-credit claim; owner funding remains no tax.

## 2026-09-24 — Bulk upload and tax-default implementation gate

- Stripe and CommBank CSV imports now keep per-file queues and confirmation;
  invoice/evidence PDFs use a separate multi-file artifact-upload route. A
  known transient S3 confirmation failure retries the same artifact ID to
  avoid blind duplicate starts; uncertain outcomes require an artifact check.
- New expense drafts follow AUD/non-AUD document currency for provisional tax
  treatment only until the user edits treatment. Existing transaction edits
  retain saved treatment, manually entered document tax amounts are preserved,
  owner funding remains no tax, and GST-credit fields are unchanged.
- Integrated verification passed 50 test files/422 tests, lint, formatting,
  and production build/typecheck. Read-only PDF retry and tax-default reviews
  passed. Browser acceptance remains pending because the in-app browser was
  unavailable; no live provider or Docker-backed dependency test was run for
  this slice.

## 2026-09-24 — Batch imports and rejected artifact decision

- The user chose a single batch review/confirmation action after accepting or
  rejecting individual uploaded CSV files. Files remain independently atomic
  under that action; partial results must be reported by file.
- Rejected CSV artifacts must be durably marked and may be permanently deleted
  only when unlinked, after explicit confirmation. The recorded object version
  and database record are both deletion targets; linked/imported evidence is
  protected. This decision expands the artifact lifecycle beyond its current
  pending/available/superseded/abandoned states.
- Imports should contain Stripe, CommBank, and PDF tabs rather than linking to
  disconnected pages. Banking and the other top-level pages should share the
  Folio page system. Signed downloads should present original filenames.

## 2026-09-24 — Batch import implementation and artifact invariants

- Stripe and CommBank now require explicit file admission or rejection before
  a combined batch review. One Confirm import action processes accepted files
  independently and preserves per-file results/retries. PDF evidence remains
  upload-only. Legacy import URLs redirect to the tabbed Imports workspace.
- Migration 0008 adds a rejected CSV state and nullable original filename.
  Rejecting a pending CommBank CSV first verifies and pins its S3 version.
  Artifact-link triggers lock the source row and require it to remain available;
  rejection also rejects already-linked artifacts. Deletion is confined to a
  rejected, unlinked CSV and targets its recorded S3 version before metadata.
  The signed download filename is sanitized for path/control characters.
- The independent review withdrew an initial link/reject race concern after
  checking existing trigger order and PostgreSQL snapshot semantics. An
  additional explicit locked-row state check and isolated concurrency test
  were retained as defense in depth. The isolated PostgreSQL suite passed 6/6;
  the unit suite passed 445/445, and lint, formatting, build/typecheck passed.
- The local Compose app was rebuilt and `/health` returned Folio ok. Browser
  discovery returned no available browser; rendered responsive/keyboard
  acceptance remains unverified. Exact-version S3 deletion has mocked coverage
  but no live object-store end-to-end test in this slice. Older artifacts with
  overwritten display filenames cannot recover their original filenames.

## 2026-09-24 — BILL-M4E import and artifact cleanup decision

- CommBank confirmation must make the CSV available before inserting bank-row
  provenance links, within one transaction. A failure rolls back both changes.
- An artifact is deletable only when neither transactions nor bank activity
  link to it. Deletion first reserves a non-linkable `deleting` state under
  row lock, then removes exact-key object versions before metadata. Storage
  failure retains a retryable row.
- The user chose immediate deletion of pending uploads and accepted that a
  still-valid upload URL can recreate an orphan object after cleanup. This is
  a known residual risk, not a guaranteed prevention mechanism.
- Duplicate filename warnings are non-blocking, case-insensitive exact matches
  within the same profile, across Stripe CSV, CommBank CSV, and PDF uploads.
- Synthetic verification passed: 457 unit tests, 12 PostgreSQL tests, one
  opt-in MinIO test, lint, formatting, build, and rebuilt Compose health. The
  in-app browser was unavailable; rendered acceptance remains open. Independent
  code review found no confirmed defect; the object-store race was not tested
  end-to-end.

## 2026-09-24 — MCP design priority

- The user prioritised local Codex MCP support as the next planned milestone.
  The tentative contract is in `docs/mcp-plan.md`; no implementation began.
- Proposal submission must not mutate financial records. Folio approval is
  the sole commit boundary; the proposer and approving actor remain distinct.
- Official OpenAI MCP guidance supports focused schema-defined tools and
  server-enforced authorization. The user confirmed row-level approval,
  existing-artifact-only references, and loopback-only stateless Streamable
  HTTP with a proposal-scoped bearer credential. Remote OAuth is deferred.

## 2026-09-24 — BILL-M4F Sources and table presentation

- Imports and Artifacts are now one top-level Sources destination. File library
  lives at `/imports/library`; the pre-v1 `/artifacts` route was removed, not
  redirected. Internal links and filter-bearing destinations were updated.
- Banking Activity and Transactions reserve fixed desktop widths for supporting
  columns and leave Description the remainder. Their date display uses
  `16 May 2026`; Transactions sorting and date-source rules were unchanged.
- The integrated 459-test suite, lint, formatting, build, Compose health, and
  route checks passed. Independent code review found no confirmed regression.
  Rendered responsive/keyboard acceptance remains open.

## 2026-09-24 — BILL-T46 table readability correction

- The first fixed-rem widths were too narrow for short fields. Transactions
  now has readable supporting widths, a 72rem minimum table width, and
  horizontal scrolling above the 760px card breakpoint. Banking Activity
  similarly reserves 56rem and keeps Description flexible.
- Table Actions now use shared icon controls with accessible names, 44px
  targets, hover/focus tooltips outside the scroll container, and visible
  mobile-card labels. The non-action imported-row text was removed.
- The integrated 461-test suite, lint, formatting, build, rebuilt Compose
  health, and independent code review passed. Browser-rendered widths and
  tooltip placement remain unverified because no browser was available.

## 2026-09-25 — Bank-row creation and matched navigation

- The bank import's posted date, AUD movement, and raw description are source
  facts, so they now prefill automatically after kind selection. Parsed supplier
  and invoice date remain unfilled because the bank description does not prove
  either value. Positive owner-funding amount remains safely prefilled.
- Matched bank rows expose a button-style transaction link immediately after
  create-and-match and when revisited. Candidate review and match-and-next
  remain tentative future workflow items.
- Focused tests passed (20); full suite passed on rerun (462); lint,
  formatting, and build passed. An unrelated transaction-workflow focus test
  failed once in the first full run but passed alone and on full rerun.
- Independent focused review found no production defect. The local Folio
  Compose app was rebuilt and restarted; its proxied `/health` returned 200.

## 2026-09-25 — Matched CTA contrast and transaction detail header

- A selected-panel ordinary-link selector overrode the primary matched CTA's
  white text. The explicit primary CTA state selector now excludes secondary
  links, preserving their contrasting foregrounds.
- Transaction detail keeps its description in Record details only; the manual
  Edit action is a secondary button-style link with keyboard focus styling.
- Full suite passed (463 tests), with lint, formatting, typecheck, and build.
  The local Compose app was rebuilt and returned HTTP 200 at `/health`.
  Rendered browser verification remains open because no browser was available.

## 2026-09-25 — Reconciliation queue height

- The bank-row queue is now a compact, independently scrolling region capped
  at 30rem (20rem below 760px), with pagination outside the scroll region.
  Selected-row visibility adjusts queue scrollTop without moving document
  scroll position; the transaction form retains normal page scrolling.
- Focused tests passed (13), full suite passed (464), and lint, formatting,
  and build passed. Independent static review found no code defect. Rebuilt
  Compose returned HTTP 200 at `/health`. Browser-rendered checks remain open.
- Historical counterparty suggestions reappeared for the user without a code
  change, so the prior missing-suggestion report was not treated as a confirmed
  repository defect.
- After user review, the wider-screen queue cap increased from 30rem to 36rem;
  the narrow-screen 20rem cap remains unchanged. The local Compose app was
  rebuilt and returned HTTP 200 at `/health`; rendered sizing remains open.

## 2026-09-25 — Explicit bank and invoice-filename suggestions

- Reconcile's transaction kind is chosen by a direct `Create …` button for
  each cash-sign-compatible kind; this opens create-and-match, not a bank-row
  classification. The form retains its compatible-kind filter.
- A non-funding bank-backed form offers an explicit payment-values action for
  blank document date/AUD amount/currency fields. It does not replace manual
  entries or copy AUD amount into a foreign-currency document. Existing safe
  positive owner-funding prefill remains automatic.
- For existing selected invoice PDFs, filename-derived date/reference can be
  applied per source PDF; supplier remains a separate optional action. No PDF
  content extraction was added. Invalid filename patterns offer no action.
- Independent review found no production defect. Full unit suite passed (471
  tests), with lint, formatting, and build. Rebuilt Compose returned HTTP 200
  at `/health`; rendered browser acceptance remains open.

## 2026-09-25 — Compact selected-PDF suggestion actions

- Each selected existing PDF now shows its source filename once and separate
  persistent Apply supplier/date/reference buttons. Explicit clicks can
  restore that field after a manual change; other fields remain untouched,
  except an auto-managed occurrence date follows an applied invoice date.
- Supplier labels use a unique normalized historical counterparty name when
  available; otherwise camel-case filename text is split for display and
  application. Ambiguous historical matches use the fallback. Stored filenames
  and new-upload filename suggestions are unchanged.
- Full unit suite passed (472 tests), with lint, formatting, and build.
  Independent review found no production defect. Rebuilt Compose returned
  HTTP 200 at `/health`; browser-rendered layout remains unverified.

## 2026-09-26 — Explicit foreign-payment hint application

- CommBank description-derived foreign currency and amount are suggestions, not
  automatically trusted invoice facts. For a bank-backed non-funding transaction,
  separate persistent actions apply validated values to document currency and
  invoice total only when the operator selects them. The AUD settlement stays
  unchanged.
- The document-currency action uses the same tax-default transition as manual
  currency entry and preserves an operator-edited treatment. The full unit
  suite passed (474 tests, one skipped), with TypeScript and targeted ESLint.

## 2026-09-26 — MCP proposal review visual design

- The confirmed first slice uses a 100-item batch limit, row-level review,
  approve-selected, existing artifact references, local stateless Streamable
  HTTP, and a proposal-only bearer credential. Human Folio approval remains
  the sole financial commit boundary.
- `docs/mcp-plan.md` records low-fidelity lifecycle and UI sketches. A top-level
  Proposals destination is an unconfirmed navigation proposal. No source code
  or database schema for MCP has been changed.
- The 2026-07-28 MCP transport revision differs from the draft's older
  assumptions; current SDK and installed Codex compatibility require a local
  protocol smoke test before implementation is considered verified.

## 2026-09-26 — Draft-in-Reconcile replaces proposal inbox

- The user prefers MCP-created manual draft transactions and suggested existing
  matches to appear in Reconcile's existing suggestions area. Human promotion
  to recorded is transaction approval; matching remains a separate explicit
  human action. No first-class AI/MCP navigation or permanent badge is wanted.
- A note is sufficient for user-facing explanation, but immutable internal
  submission identity and idempotency still need separate storage. The existing
  candidate query excludes drafts, so Reconcile needs a source-linked draft
  suggestion query without making all drafts match candidates.
- The user confirmed one-at-a-time human recording for this first slice, so
  the earlier approve-selected UI is superseded. Batch submission remains
  deferred. No MCP implementation has started.

## 2026-09-26 — Individual MCP submission and artifact retrieval request

- The user prefers individual idempotent draft or match-suggestion submissions
  for the first slice; bulk submission is later. The earlier 100-item first
  batch limit is therefore not an initial acceptance criterion.
- The user requested an artifact-retrieval tool. Metadata versus original file
  contents, and PDF-only versus CSV access, remain an explicit authority choice.
  No MCP code has been written.

## 2026-09-26 — Artifact-first local MCP workflow

- The user confirmed that Codex should be able to upload original invoice
  PDFs and Stripe/CommBank CSVs before submitting draft transactions. A
  two-step upload intent, short-lived PUT, and server confirmation is accepted.
  Extracted fields remain suggestions; the artifact is retained as the source.
- The user requested separate retrieval of artifact metadata and original
  contents across all current artifact profiles. Whether content reads include
  rejected/superseded files remains unresolved; the provisional boundary is
  all-state metadata and available-versioned bytes only.
- Uploaded CSVs must enter human per-file/batch import review, not auto-import.
  Existing queue state is browser-local and CommBank pending uploads are not
  generically confirmable. A durable intake bridge is therefore part of the
  MCP scope. No MCP implementation has started.
- The user subsequently clarified that every uploaded artifact, including
  invoice PDFs and both CSV types, awaits human review regardless of whether
  Codex or the UI uploaded it. Both CSV types need duplicate warnings in both
  upload paths. The proposed `awaiting_review` state separates validated
  uploads from unfinished PUTs and approved evidence/imports; exact duplicate
  signals and pending-PDF draft association remain undecided.
- The user confirmed that an MCP draft may retain an unapproved PDF ID only
  as proposed evidence. Human recording must revalidate approval and cannot
  attach that PDF while it is awaiting review. The user also confirmed
  duplicate warnings for both CSV upload paths on same-profile checksum,
  overlapping source rows, and same-profile filename; filename alone is weak
  evidence and remains non-blocking. Import-time duplicate constraints stay
  authoritative.
- The user resolved the Stripe duplication boundary: Codex may upload a
  Stripe CSV for human import review, but may not submit transaction drafts
  derived from its rows. Confirmed Stripe import is the sole creation path for
  those recorded transactions.
- The user confirmed that MCP artifact metadata may cover all states, while
  original file contents are retrievable only after artifact approval and
  only from an available, versioned artifact.

## 2026-09-26 — Commit practice

- The user authorised a local initial project snapshot and asked that future
  user-verified fixes and tasks be committed when completed. The initial
  snapshot is `50f26b9`; the preceding repository history contained only
  LICENSE. Commit coherent verified changes after staged-file review, without
  including dependencies, local data, or secret-like files. Pushes are not
  implied by this instruction.

## 2026-09-26 — MCP pre-implementation boundary

- The user confirmed pre-import CommBank drafts keyed by uploaded artifact ID
  and source row number. Import can resolve the locator for Reconcile display
  but never creates a match. Rejected or absent rows leave the draft unlinked.
- Initial MCP upload/review is limited to invoice-evidence PDF, Stripe CSV,
  and CommBank transaction-history CSV profiles. Approved artifacts of any
  registered profile remain eligible for metadata/content reads. The
  registered NAB CSV and CommBank statement PDF upload flows remain future
  work because their import workflows do not exist.
- Each local MCP credential has one permitted default transaction owner;
  Codex cannot override it. A human with ordinary permissions may edit owner
  before recording. Protocol and binary transfer details are verification
  gates, not unresolved user-facing policy choices.

## 2026-09-26 — MCP retrieval deferred and artifact inbox clarified

- The user deferred original-file retrieval through MCP. Initial tools retain
  all-profile artifact metadata discovery, but expose no file bytes, signed
  download URL, or content-read scope. Folio UI downloads are unchanged.
- A validated uploaded artifact persists in Awaiting review. Add-to-batch is
  an ephemeral browser selection; reload clears the selection, not the files.
  The artifact lifecycle is the durable inbox for this slice, without a
  persisted batch entity.
- The user authorised Codex to inspect a specific original file containing
  personal information only when they explicitly submit it for review or
  approve its read. This is a per-file exception to the repository's default
  no-PII-reading instruction; no automatic or background reads are permitted.
  No original file was inspected while recording this decision.
- The operator expects artifact filenames to have no PII. MCP metadata may
  include original filenames without separate per-file approval or redaction.
  This is an input convention, not a Folio-verified guarantee, and grants no
  permission to inspect file contents.

## 2026-09-26 — MCP implementation boundary and artifact review checkpoint

- The user authorised MCP implementation with synthetic functional tests and
  deferred end-to-end verification. Work is in progress, not a completed
  milestone.
- Validated uploads now enter a durable `awaiting_review` state. PDF approval
  and CSV import are separate human actions; neither generic confirmation nor
  a reload of the browser queue may promote a file to usable evidence or
  imported financial records.
- Stripe and CommBank review queues reload validated artifacts by ID. Their
  Add-to-batch selections remain ephemeral. The manual transaction PDF path
  requires explicit preview and approval before save can attach a new file.
- At the 26 September 2026 checkpoint, synthetic Vitest ran 488 passing tests
  with one skipped, and typecheck, scoped ESLint, and diff checks passed. No
  live PostgreSQL, storage, real customer file, or end-to-end test was used.

## 2026-09-26 — MCP synthetic implementation boundary

- The initial MCP server binds only to `127.0.0.1`, checks Host and Origin,
  authenticates each stateless Streamable HTTP request, and exposes domain
  tools according to six persisted credential scopes. Bearer tokens are
  stored as hashes, with a distinct actor and forced default owner.
- Eight scoped tools cover bounded bank/transaction/artifact metadata, two-step
  artifact upload, draft creation, existing-match suggestions, and own
  submission status. Original-file retrieval, artifact approval, CSV import,
  draft promotion, and bank matching are not MCP tools.
- A credential-bound upload key now persists an artifact intent atomically.
  Same-key/same-payload retries reuse the pending artifact with a fresh URL;
  changed payloads conflict and terminal/deleted artifacts receive no URL.
- The Reconcile suggestion UI keeps human recording distinct from bank
  matching. Retained proposed PDF evidence must be approved and linked before
  a draft can become recorded; the database has a deferred enforcement trigger.
  The trigger has structural tests only until live PostgreSQL tests are
  authorised.
- The unified synthetic suite passed 559 tests in 63 files, with one skipped;
  typecheck, lint, and diff checks passed on 26 September 2026. Live migration,
  Codex-to-Folio connection, and browser E2E are deferred, so this is not a
  deployed or operator-verified milestone.

## 2026-09-26 — MCP web-listener integration

- The user approved replacing the separate MCP process with `/mcp` on Folio's
  existing web listener, gated by `FOLIO_MCP_ENABLED=true` (default off).
  Disabled requests return 404 without constructing the MCP runtime.
- The route accepts only the configured Folio Host and Origin, verifies bearer
  credentials on each request, and does not use browser cookies. Existing
  credential generation, hash persistence, scopes, and revocation are unchanged.
- Sharing the web listener removes the former independent loopback bind. If
  enabled on a publicly routed deployment, the endpoint is network-reachable
  despite its bearer requirement; production enablement requires an explicit
  proxy/remote-access decision. No live Codex or database test has established
  rollout readiness.

## 2026-09-26 — MCP credential setup discovery

- The user approved a `pnpm mcp:credential` wrapper for the existing explicit
  create/revoke command, a read-only `scopes` action, and a generic Copy ID
  control in Admin → Users. Scope discovery does not open a database connection.
- Credential creation still requires explicit administrator, dedicated actor,
  default owner, label, and scopes; it generates a token only on `create` and
  shows it once. No live credential was issued during verification.

## 2026-09-26 — Database CLI failure diagnostics

- The user encountered a generic credential-create failure with distinct actor
  and requested proper error logging for credential and migration commands.
- Both commands now report operation, stage, safe error code, and constrained
  guidance. Migration failures identify the migration ID when applicable and
  preserve rollback. Raw database messages, SQL parameters, connection
  strings, user records, and credential values are not logged.
- A synthetic migration failure at migration 0011 confirmed stage/code output,
  rollback, and redaction. The actual local failure remains unidentified until
  the operator retries the command; no live database was inspected.

## 2026-09-26 — Participant-specific MCP credential diagnostics

- The operator retried with a distinct actor and received `USER_INELIGIBLE`.
  Repository checks now distinguish the administrator, actor, and owner, with
  fixed reasons for missing, inactive, wrong-role, or non-distinct users.
  These failures occur before credential insertion and contain no user IDs or
  personal fields in CLI output.
- Synthetic repository and formatter tests passed. No live users or database
  were inspected, so the operator's exact failing participant remains unknown
  until they retry with the updated command.

## 2026-09-26 — Local MCP connection and operator workflow skill

- An authenticated call to the exact local `/mcp` route returned `pong`.
  A synthetic `initialize` and `tools/list` exchange returned the ping tool.
  The operator reports successful Folio tool discovery in a fresh Codex CLI
  session, while the resumed session remained failed even after a fork. The
  latter is session-specific evidence, not a diagnosed Codex root cause.
- A repo-local `folio-mcp` skill now teaches Codex how and why to use the
  scoped tools to stage files, manual drafts, and match suggestions for human
  review. It deliberately omits server-maintenance steps and preserves the
  no-auto-approval, no-Stripe-row-draft, and no-original-file-retrieval
  boundaries. No real file or transaction was submitted in this checkpoint.

## 2026-09-27 — Composable queries and Sources navigation

- The operator confirmed Transactions as the filter-builder pattern for Banking
  Activity, Bank Import History, and Sources File Library, with ordered sort
  clauses in all four tables. The four Sources tabs also appear as sidebar
  children; in-page tabs remain.
- Filter clauses use field-specific operators and AND semantics. Ordered sort
  clauses are editable and reorderable. Server queries apply them before
  pagination with a stable ID tie-breaker; URL state retains the query across
  navigation, and query changes reset the page to one. Existing header/mobile
  sort controls remain available as single-field shortcuts.
- Synthetic verification passed 602 tests (one skipped), typecheck, lint,
  scoped formatting, production build, and diff check. No populated-browser
  or live-database review was run. These changes remain uncommitted pending
  operator verification.

## 2026-09-27 — Structured operation logging refinement

- The operator kept the `folio_access` operation name but requested only
  unusual outcomes to be logged. Its successful runtime-availability checks
  are now silent; failures still carry a log/UI correlation reference.
- Remaining Folio operation and client-render-failure events include the
  incoming HTTP method and pathname, excluding query parameters. Routine
  success records omit correlation IDs. Health checks emit no Folio event,
  including when `/health` fails into the root error boundary; unlogged health
  failures do not return an unresolvable reference.
- Synthetic verification passed 608 tests (one skipped), typecheck, lint,
  scoped formatting, production build, and independent read-only review.
  No live HTTP or populated-browser check was run. Changes remain uncommitted
  pending operator verification.

## 2026-09-27 — Mixed query builders, Overview navigation, MCP diagnostics

- The operator confirmed one mixed filter/sort clause list on Transactions,
  Banking Activity, Bank Import History, and File Library. Sort priority is
  the top-to-bottom occurrence of sort rows; filters still combine with AND.
  Each route preserves mixed order in URL state and translates it to the
  existing server query contract. Synthetic tests cover Apply, page reset,
  row movement, pagination, and URL history restoration.
- Reports is now a child of Overview in desktop and mobile navigation, without
  changing `/reports`. Structured Folio events omit request method/path when
  the incoming pathname is `/_serverFn` or under it; ordinary route pathnames
  retain those fields without query parameters.
- The local Folio `/mcp` endpoint returned HTTP 401 without a credential on
  27 September 2026, consistent with an enabled, reachable auth boundary.
  No authenticated call, bearer token, Codex configuration, or Codex log was
  inspected. The cause of the reported Codex failure remains unknown.
- Verification passed: 620 synthetic tests (one skipped), typecheck, lint,
  scoped formatting, production build, diff check, and independent review.
  Browser E2E remained deferred. Changes are uncommitted pending operator
  verification.

## 2026-09-27 — Live query and draft evidence affordances

- Mixed query builders now apply valid edits after 300 ms and replace the URL
  entry; this avoids a browser-history entry for every keystroke. Incomplete
  filter rows remain local while the valid clauses apply.
- The existing draft-promotion action attaches an approved proposed PDF.
  The UI now says so explicitly and exposes per-field filename suggestions
  without treating the proposed file as already attached. Invoice total is
  not inferred from a filename.
- The operator requested future MCP edits of its own draft transactions
  without revision tokens, plus in-place draft editing in Reconcile. Neither
  is implemented. Omitting revision checks allows last-writer-wins conflicts
  between MCP and human draft edits and does not alter evidence approval.
- Focused route tests (94), two draft-editor affordance tests, typecheck,
  lint, and production build passed. Rendered acceptance is pending; existing
  React-Aria field-interaction tests remain unreliable in isolation.

## 2026-09-27 — Inline draft editor and credential-bound MCP edits

- The proposed approved PDF is now checked but locked in the evidence list;
  it is a proposed selection for recording, not an attached draft artifact.
  The dedicated Remove proposed PDF action remains the way to exclude it.
- Reconcile embeds the existing transaction editor instead of creating a
  second save/evidence workflow. Recording is still separate from bank-row
  matching. The operator's selected row stays visible while editing.
- MCP edits are patch-based and scoped to drafts created by the same
  credential. The current transaction owner and evidence links are preserved.
  No revision token is required by operator choice; last-writer-wins can
  overwrite another draft edit, so the tool is not marked replay-idempotent.
- Focused synthetic tests, TypeScript, ESLint, and production build passed.
  Browser and live-database verification remain pending; existing React-Aria
  interaction tests still fail in isolation.

## 2026-09-27 — Draft-only suggestions and permanent deletion

- Reconcile draft proposals display only while their linked transaction is a
  draft, even when the bank row is resolved. Existing-match proposals remain
  visible until their bank row resolves, with a warning if stale. Promoted drafts
  then appear only through the ordinary candidate workflow.
- Human-only draft deletion removes the manual draft and its MCP submission
  in one transaction, but retains uploaded artifacts. Deletion also removes
  submission status and idempotency history; replaying the original MCP
  submission can create a new draft, as accepted by the operator.
- The app role needs DELETE on transactions and MCP submissions; the migrator
  reapplies these grants on its next run. The unresolved-only queue uses the
  existing bank-state predicate and unresolved count for server-side pages.
- 133 focused synthetic tests across nine files and the queue interaction
  test passed, as did typecheck, lint, scoped formatting, build, and diff
  check. Nine pre-existing React-Aria form-interaction tests still fail at
  `getMetaValue`; live database and browser acceptance are pending.

## 2026-09-27 — Reconcile search parser regression

- The installed TanStack Router decodes `unresolved=1` to numeric `1`.
  Reconcile accepted boolean `true` and string `"1"`, but not the number, so
  selecting a queue row cleared the unresolved filter. Row links now write
  `unresolved=true` and the parser also accepts numeric `1` for old URLs.
  Synthetic tests exercise the router parser and row-link behavior. Operator
  re-verification is pending.

## 2026-09-28 — Descriptive category effects in Reports

- Reports groups eligible recorded AUD income and expense effects by report
  period and saved free-text transaction category; custom categories are
  preserved, while missing categories use a transaction-kind-specific
  Uncategorised label. This is a preparation view, not tax classification.
- Stripe sales may create two category contributions: gross sale income and
  an uncategorised processing-fee expense. Category monetary effects reconcile
  to existing period totals; category contribution counts therefore need not
  equal period transaction counts. Owner funding has no income or expense
  effect and does not appear in category rows.
- CSV keeps the existing columns and adds category and row_type. Custom
  category labels are formula-neutralised. Fifteen focused synthetic tests,
  TypeScript, targeted ESLint, targeted source formatting, production build,
  and diff check passed. Operator review is pending; no commit was made.

## 2026-09-28 — Credential scopes, token administration, warnings, and sessions

- MCP `proposals:submit` combined draft and bank-match authority. New concrete
  scopes separate `transactions:draft`, `bank_matches:suggest`, and
  `transactions:categorize`. Migration 0013 preserves existing submit-token
  authority by replacing it with the first two scopes. New credential `*` and
  known-resource wildcard patterns expand to current concrete scopes at creation, not
  future scopes. The migration has not been applied to a live database.
- `edit_transaction` requires the exact prior microsecond `updatedAt`. Own
  drafts allow existing field patches; `transactions:categorize` allows only
  category changes on any transaction. This immediately changes report
  classification without an append-only revision history; that audit history
  remains a separate deferred boundary.
- Administrators now have Access tokens UI for metadata listing, one-time
  secret display on creation, and confirmed revocation. Reports is top-level
  navigation and structured warning records link to transactions with compact
  descriptions and reasons. PDF reference suffixes are optional.
- Typed unauthenticated server-function failures request HTTP 401, permission
  denials 403, and protected page navigation redirects expired sessions to
  login with a validated return path. An in-process transport assertion of
  the serialized HTTP response was not run.
- Focused cross-slice tests passed (133). Full suite: 655 passed, 19 existing
  React Aria form-interaction failures, one skipped. TypeScript, ESLint, and
  production build passed. Browser and live-database acceptance remain open.

## 2026-09-29 — FY2025–26 reviewed partnership tax worksheet

- The operator clarified the business is a partnership, is not yet GST
  registered, and wants Folio to retain a reviewed net result plus exports.
  Partner shares are entered as percentages totaling 100%; Folio account users
  are not assumed to be legal partners. The worksheet is limited to FY2025–26
  so later GST-registration policy cannot be inferred from this decision.
- A row-level exact-AUD cash ledger reuses report effects and separates
  included transactions, expected exclusions, missing cash facts, and other
  financial years. Imported bank review state, unknown-year drafts, and
  missing facts gate human review. A separate CSV exports the unreviewed
  source ledger even when review is blocked.
- Explicit reasoned adjustments and exact partner allocation produce an
  append-only reviewed snapshot in migration 0014. Optional adjustment links
  must identify a selected-year source transaction. Source and bank-row
  versions form a fingerprint; changes mark the saved review historical and
  reviewed CSV/JSON export rejects stale snapshots. Review and export checks
  are not atomic with source edits; concurrent edits can create an immediately
  stale version, detectable on the next load/export.
- The reviewed result is not tax payable or an ATO-lodged return. Candidate
  expenses are not assumed deductible, no GST credit is inferred, and Stripe
  income-tax timing still needs operator/accountant confirmation because the
  source projection uses Stripe creation timestamps rather than availability.
- Seventy focused synthetic tests across 11 files, lint, production build
  (including TypeScript), diff check, and a read-only
  independent audit were run. The audit found and prompted fixes for undated
  drafts, signed refund/credit bases, and reporting-timezone date display.
  No live PostgreSQL migration, populated financial data, or browser E2E was run.
  Operator verification and check-in remain pending.

## 2026-09-29 — Reports tax-worksheet navigation fix

- The generated `/reports/tax` route was nested under `/reports`, whose page
  did not render a child outlet, so the worksheet could not appear through its
  link. The route now uses the established non-nested `reports_.tax.tsx`
  convention while retaining the same URL. The Reports link is styled as a
  primary action. Generated route metadata confirms the root parent; eight
  focused UI tests and the production build passed. Operator visual verification
  remains pending; no commit was made.

## 2026-09-29 — Tax-preparation navigation and source-row identity

- The operator selected `Tax preparation` as the Reports child label. Reports
  now groups Preparation and Tax preparation in both desktop and mobile
  navigation; the Reports-page action link was removed. The active child is
  exact-path selected while Reports remains the group location.
- FY cash-ledger rows now carry saved counterparty and category alongside kind,
  description, reference, and source. The worksheet renders a styled primary
  transaction link and muted provenance/detail line, so Stripe IDs are no
  longer the primary label. Monetary effects and review gates are unchanged.
- Forty-eight focused synthetic tests across six files, production build with
  TypeScript, ESLint, and diff whitespace check passed. No populated browser
  review was run. Operator verification and check-in remain pending.

## 2026-09-30 — Tax presentation and MCP status-tool removal

- The operator confirmed Financial summary / Tax preparation navigation, source
  net display, per-partner reviewed income/deductions/net by agreed percentages,
  date-ordered source rows, and form-layout corrections. BILL-T66 implements
  those changes and retains exact saved calculations and export precision.
- Ordinary report amounts now display two decimals; non-zero sub-cent precision
  remains visible. Partner component allocations reconcile to each existing net
  share and to the reviewed totals under fractional remainders.
- The operator confirmed future actual-user partner identities. BILL-T68 records
  the deferred requirement; current generic labels and historical snapshots are
  unchanged.
- BILL-T67 removes `get_submission_status` and its repository helper. New scope
  issuance and wildcard expansion omit `submissions:read`, while existing
  credentials with that legacy scope remain authenticated. The operator skill
  describes idempotent retry and transaction search after a lost response.
- The full synthetic suite passed 725 tests with one skipped; production build,
  TypeScript, focused lint, and whitespace checks passed. Docker visual acceptance
  and scoped check-in remain pending. No live records, migration, or browser E2E
  were used.

### 30 September 2026 — Compatible matched edits (BILL-T69)

- Migration 0007's blanket financial-identity guard rejected harmless settlement-date
  and same-direction classification corrections. Migration 0015 now revalidates
  eligibility and exact signed AUD amount instead; historical migrations are unchanged.
- Bank matches remain intact for compatible edits. Incompatible edits and voiding
  require explicit unmatch and produce actionable `BANK_MATCH_EDIT_CONFLICT` guidance.
  Existing bank-before-transaction locks and manual-edit revision checks remain.
- The synthetic suite passed 739 tests with one skipped; eight dedicated disposable
  PostgreSQL reconciliation tests passed. Only the test schema was migrated. Live
  migration, operator verification, application Docker rebuild, and commit remain pending.
- Independent review found no production defect; its suggested direct UI error-sanitizer
  assertion was added and passed. Test PostgreSQL was stopped, preserving test volumes.

### 30 September 2026 — Autocomplete polish (BILL-T72)

- Menus open on focus, grow beyond narrow triggers within viewport bounds, and
  wrap labels without horizontal scrolling. Multi-select chips share a bordered
  Group with the query input; React Aria measures that full group for popup sizing.
- All four table builders default new text fields to contains, retaining saved
  operators and numeric/date/enum defaults. Add controls moved below clause rows.
- Earlier manual-form/PDF failures were missing pointer-event support in jsdom.
  Common DOM test setup provides absent pointer/scroll/CSS APIs, and focused
  validation tests dismiss open suggestions before querying accessible summaries.
  All 50 manual-form tests and 773 synthetic tests pass; one test is skipped.
  Production build, typecheck, focused lint, formatting and whitespace checks pass.
- No real-browser geometry verification, live changes or migration. Operator
  visual acceptance remains pending; bulk actions remain deferred.

### 30 September 2026 — Complete counterparty suggestions (BILL-T71)

- Counterparty suggestions previously excluded funding, processing-fee and imported
  transaction counterparties because they required manual supplier kinds. The
  user approved all non-void transaction counterparties, including drafts.
- Removed only the counterparty source/kind predicates; supplier/category queries,
  authorization, normalization, stable ordering and the 200-item bound remain.
- 54 repository and 33 workflow tests passed, as did typecheck and focused lint.
  Extra manual-form tests failed 13 of 49 existing dropdown/PDF interactions;
  no form code changed. No live data or migration. Bulk actions remain deferred.

### 30 September 2026 — Searchable selection and enum membership (BILL-T70)

- Operator confirmed app-wide autocomplete replacement. All former native select
  dropdowns now use the shared fixed-choice component; existing creatable fields
  retain custom values. Named fields preserve underlying submission values and
  required/disabled/reset behavior.
- Enum filters default to contains any of and also support contains none of, using
  searchable multi-selection with removable chips. Values within a row use exact OR
  membership; separate rows remain AND. Legacy scalar bookmarks remain valid.
- Database membership is parameterized and applied before pagination, including
  file-library linkage. Existing pagination and stable sort behavior are retained.
  No database migration is required. Bulk apply-field/value actions remain a proposal.
- Independent review identified a required-field bypass from nonempty query text.
  Selected-key validation now rejects unmatched keyboard submissions; unspecified
  external validity stays undefined so it cannot override React Aria validation.
- The full synthetic suite passed 768 tests with one skipped; TypeScript, focused
  lint, formatting, whitespace checks, and production build passed. No live records,
  schema migration, browser E2E, Docker app rebuild, or commit were used. Operator
  visual acceptance remains pending.
