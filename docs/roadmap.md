# Folio delivery roadmap

## BILL-T86 — Disposable PostgreSQL verification and commit

Status: complete on 3 October 2026. The operator approved all verified application
changes, split into feature commits, with private local configuration excluded.

- [x] Accept the BILL-T85 visual review.
- [x] Apply all 18 migrations to a new disposable PostgreSQL database.
- [x] Verify recurrence links/reset, repayment constraints and reconciliation ordering.
- [x] Re-run the synthetic suite and production build/TypeScript.
- [x] Commit the confirmed, verified scope; exclude private local configuration.

No live database, actual source records or storage services are in scope.
Future implementation work must be committed after successful verification.
Feature commits: b273be1 (shared UI), 8010974 (reports), 8c63be2 (invoices),
8ab15b3 (recurrence), 69d6bbf (MCP), 62fc5e2 (transaction integration).
The final combined tree was verified; intermediate feature commits share dependencies.
Both PostgreSQL test files pass sequentially: 16 tests, including eight new cases
for recurrence links/stale revisions/cadence resets, repayment constraints/negative
matching and queue ordering/wrap/page position. The disposable container and its
synthetic data volume were removed after verification. The full synthetic suite
passes 1,086 tests with one skipped; production build/TypeScript and source lint
pass. Changed source/document/configuration files pass formatting. Two unchanged
document-service test files fail the broader formatting check and are left intact.

## BILL-T85 — Concise recurrence views and historical amount estimates

Status: code-complete on 2 October 2026; operator visual acceptance on 3 October 2026.

- [x] Confirm description-priority column widths, readable dates and styled source links.
- [x] Confirm only the next Upcoming and unresolved prior occurrences in the main list.
- [x] Confirm derived min–max/average from unambiguous on-cadence document amounts.
- [x] Implement bounded missing-history pages without expanding long forecast horizons.
- [x] Implement exact decimal statistics, excluding unusable and ambiguous amounts.
- [x] Verify synthetic tests and independent review.
- [x] Verify sequential production build/TypeScript.
- [x] Operator visual acceptance in the rebuilt application.

Keep source transactions unchanged. No new migration, query or dependency required.
Full synthetic suite: 1,086 passed, one skipped across 101 files. Independent focused
verification passes 98 tests; source audit and scoped lint/format checks pass.
Final sequential production build/TypeScript passes after explicit test-fixture
interface annotations. No type errors were suppressed.

## BILL-T84 — Historical cadence preview and recurring actions

Status: code-complete on 2 October 2026; operator visual acceptance pending.

- [x] Confirm historical preview extends backward, but reminders start at the anchor.
- [x] Correct backward monthly/annual preview with calendar-boundary regressions.
- [x] Reuse counterparty suggestions in the standard creatable combobox.
- [x] Style Track recurring bill alongside Edit transaction.
- [x] Verify synthetic tests, lint/format/TypeScript and production build.
- [ ] Operator checks visual layout in the rebuilt application.

No new migration, financial-record mutation, live data or browser/E2E execution.
Final synthetic suite: 1,071 passed, one skipped across 101 files. Independent
review found and verified a defensive guard against pre-anchor stale link rendering;
post-anchor ineligible associations remain visible for review and unlinking.

## BILL-T81 / BILL-T82 / BILL-T83 — Recurring bills, attribution sizing and invoice status

Status: T81/T82/T83 code-complete on 2 October 2026. Final synthetic and production
build/TypeScript gates pass. Visual and PostgreSQL acceptance remain separately gated.

Canonical scope and checklist: [recurring-bills plan](./recurring-bills-plan.md).
T81 delivers confirmed monthly/annual forecasts with Upcoming/Pending/Due states and
in-app attention; recorded transactions satisfy occurrences without invoices.
T82 prioritises Transaction in source-attribution columns without calculation changes.
T83 delivers independent kind-aware invoice/credit-note status and consistent filters
and Overview counts. Forecasts never become financial records automatically.

Synthetic verification only; additive migration preparation is allowed, application
and real PostgreSQL execution are separately gated. Preserve all existing dirty work,
prior migrations and source privacy. No staging, commits, deployment or new worktree.

Previous synthetic checkpoint: 1,030 passed, one skipped across 101 files.
The operator permits rebuilding reminder history on cadence/start-date edits and
approved live regex/date matching preview and configurable early/late windows.
States are Upcoming, Pending within grace, Due after grace, with occurrence counts.
Rule additions use additive migration 0018; both migrations remain unapplied.
Final full synthetic suite: 1,062 passed, one skipped across 101 files. Independent
boundary/UI checks and scoped lint/format/whitespace gates pass. Preview is read-only
and stale-response-safe; blank regex and zero-match saving have explicit assertions.
Sequential production build/TypeScript and scoped ESLint passed. Migration 0017
is prepared but unapplied; do not use the recurrence feature before applying it.

## BILL-T80 — Report period field width

Status: code-complete on 2 October 2026; operator visual acceptance pending.

Goal: show the complete selected period label, including BAS quarter and Australian
financial year, without widening every autocomplete or changing reporting behavior.
Keep the field responsive and the Apply action usable on small screens.

- [x] Confirm widening the Period field while preserving its labels.
- [x] Add scoped responsive field sizing and a synthetic route regression.
- [x] Verify scoped tests, style/type gates and the final build.
- [ ] Operator visual acceptance in the rebuilt application.

No browser/E2E execution, live records, migrations or deployment in this small fix.
The Period field alone uses a 20rem preferred width, bounded by its container.
Synthetic checks preserve both long labels, the GET form and the Apply action;
they do not establish visual fit in an actual browser.

## BILL-T79 — Owner funding balances and principal repayments

Status: code-complete on 2 October 2026; operator acceptance and PostgreSQL
migration verification pending.

Goal: show a separate owner funding table on Tax preparation, with recorded loans
advanced, principal repaid, loan balance and other contributions through the selected
financial-year end. Include funding owners regardless of their profit-sharing
percentage; unassigned funding remains explicit. These are current recorded funding
balances, not frozen tax allocations, taxable income or a confirmation of a legal debt.

Checklist:

- [x] Confirm separate funding display and explicit repayment tracking.
- [x] Add cash-out principal repayment type, validation and manual/bank workflows.
- [x] Prepare the additive migration and preserve bank-match safeguards.
- [x] Calculate cumulative owner balances with source links and completeness warnings.
- [x] Integrate the separate funding table without changing reviewed tax allocations.
- [x] Verify synthetic domain, repository and interface tests, typecheck and build.
- [ ] Operator acceptance and separately authorized database migration verification.

Constraints: preserve existing changes and migrations 0013–0015; no live records,
services, migration application, staging, commits, deployment or new worktrees.
Loan principal has zero income/expense effect. Contributions are not automatically
reclassified as loans. Transfers are not inferred to be repayments. Missing dates,
non-AUD cash facts, unassigned owners and negative recorded balances remain visible.
MCP repayment drafting is outside this slice: existing proposal drafts start with
no owner, whereas repayments require explicit lender selection in the human UI.

Final stable verification for T79/T80: 965 tests passed, one skipped across 95
files, using `pnpm exec vitest run --maxWorkers=4`. Sequential production build
and TypeScript, scoped ESLint, formatting and whitespace checks passed. Independent
focused verification and read-only source audit completed. Repayments require an
explicit lender and positive principal; a supplied settlement amount must be
positive, while null remains available for incomplete records. Existing zero-value
loan/contribution behavior is preserved. Migration 0016 is prepared but unapplied;
synthetic SQL assertions do not verify PostgreSQL trigger execution.

## BILL-T76 — Monetary alignment and single-amount copying

Status: approved regular-font right alignment and single-amount comma-free copying
are code-complete on 1 October 2026. Visual and native-copy acceptance in the rebuilt
application remain pending.

Scope: right-align displayed monetary values and their table headers in overview,
financial/tax reports, transaction tables/detail/summary, and bank review. Keep the
existing font, sizes, signs, currencies, grouping, and decimal precision. Inputs,
exports, calculations, percentages, counts, and source records remain unchanged.

Approved copy scope: normal copy of a selection wholly within one displayed
monetary value removes grouping commas only. Preserve the selected text's currency,
sign, and decimal places; mixed rows, surrounding prose, editable fields, cut,
and exports retain their existing behavior. A document-level listener is installed
and cleaned up by AppShell; failed or unavailable clipboard writes retain the native
fallback. Synthetic events do not validate the OS clipboard.

Checklist:

- [x] Confirm right alignment with the regular application font.
- [x] Confirm single-amount copy behavior.
- [x] Annotate monetary displays and headers without changing formatting.
- [x] Implement approved copy behavior with synthetic selection regressions.
- [x] Verify focused tests, full suite, typecheck, lint, formatting, and build.
- [ ] Operator visual/copy acceptance in the rebuilt application.

No live data, database changes, deployment, or application browser/E2E testing is
authorized in this slice.

Verification: the stable-source suite passed 826 tests, one skipped across 86
files, using `pnpm exec vitest run --maxWorkers=4` without a concurrent build.
Independent verification passed 153 focused tests and TypeScript; scoped lint,
formatting, and source audit passed. Mobile generated monetary-field labels remain
left-aligned; original strong/small semantics and amount tones remain intact.
Final production build/TypeScript passed against the stable snapshot.
Those gates preceded the approved copy follow-up. Final copy verification passed
837 tests, one skipped across 87 files, with maxWorkers=4 and no concurrent build.
Independent verification passed 28 focused tests plus scoped lint and formatting.
A nested-marker boundary found in review was closed with a conservative guard and
regression test. Final sequential production build/TypeScript, scoped lint,
formatting and whitespace checks passed. Existing explicit Copy ID behavior is
unchanged. No test timeout or runtime configuration was modified. No OS clipboard
or browser/E2E acceptance, live records, migration, deployment or commit was used.

## BILL-T75 — Atomic transaction metadata bulk editing

Status: code complete on 1 October 2026, including category-suggestion and compact-preview
follow-ups. Operator visual acceptance pending.

Goal: select transactions on the current Transactions page, preview one shared
counterparty, operational-category, or owner value, and explicitly apply it to
the whole selection. Page/query changes clear selection; selecting all filtered
results is not included. Financial fields, tax treatment, partner shares, deletion,
and MCP bulk tools are out of scope.

Acceptance: draft/recorded metadata edits include manual and Stripe rows; void or
missing rows, stale exact revision tokens, and invalid owner assignments reject
the entire batch. Preview performs no writes. Commit is one bounded database
transaction; unchanged rows are identified and not rewritten. Existing transaction
write permission applies. Owner targets are active Folio users.

Checklist:

- [x] Confirm fields, preview/atomic semantics, and current-page selection.
- [x] Implement and verify bounded schema, preview, and atomic repository update.
- [x] Add authorized preview/commit operations and actionable diagnostics.
- [x] Integrate selection and preview editor without query-state regressions.
- [x] Verify synthetic tests, typecheck, lint, formatting, build, and independent review.
- [x] Align editor field labels and add a tri-state header checkbox for visible eligible rows.
- [x] Include built-in categories and saved categories from every non-void transaction.
- [x] Replace preview cards with the approved compact, scrollable table.
- [ ] Operator acceptance in rebuilt UI.

Live-data access, database/E2E execution, deployment, and new migrations are not
authorized by this task. Disposable database testing would require separate agreement.

Verification: 811 tests passed and one was skipped across 85 files; TypeScript,
scoped lint, formatting, and production build passed. Synthetic regressions cover
full-page bounds, mixed eligible/ineligible batches, stale revisions, late previews,
no-op previews, uncertain apply outcomes, and navigation during an in-flight apply.
Independent review passed 170 focused tests and TypeScript, with no remaining
production defect identified. Rebuild the application image for operator review;
no live database was exercised.

Operator follow-up: the Field picker has a visible associated label, matching the
value control's label gap. A header checkbox selects or clears all visible eligible
rows, shows partial selection as mixed, and preserves captured revision tokens.
Void rows remain excluded; loading/applying/empty states disable the checkbox.
The follow-up passed 54 route tests and the full gate of 813 tests, one skipped,
plus TypeScript, scoped lint, formatting, production build, and independent review.
Visual acceptance
remains pending after rebuilding.

Further approved scope: bulk category suggestions merge the existing built-in
operating-expense labels with historical operational categories from all non-void
sources and kinds. Historical results remain bounded to 200; supplier-specific
category hints retain their existing filters. Preview columns are Transaction,
Type, Current value, New value, and Result, with a scrollable viewport and sticky
headers. No mutation or partner-allocation semantics change in this follow-up.

Category/table verification: 816 tests passed, one skipped across 85 files;
TypeScript, scoped lint, formatting, production build, and independent review
passed. Independent repository/route verification passed 111 tests. Transaction
and type context use two compact lines; full description text remains in the DOM
and title. Current/new values are not truncated. No live database or application
browser testing was performed.

## BILL-T74 — Query-chip presentation polish

Status: code complete on 1 October 2026; operator visual acceptance pending.

Scope: modest chip/label padding, centred sort direction and action icons,
left-aligned standard secondary clear buttons, and saved-chip editing styling.
No query-behaviour changes. Verification: 75 focused tests, TypeScript, scoped
lint, formatting, production build, and independent review passed.

## BILL-T73 — Compact mixed-clause query builder

Status: code complete on 1 October 2026; operator visual acceptance pending.

Goal: replace row-based filters and sorts with a shared, compact chip bar in
Transactions, Bank activity, Import history, and File library.

Acceptance: column → operator → value suggestions; inline string values;
searchable enum membership; completed edits commit on blur or Enter; incomplete
edits do not change the query; editable/removable/reorderable chips preserve AND
filter semantics, sort priority, existing saved URLs, and reset capabilities.
Dropdowns fit their content within the viewport rather than stretching across rows.

Verification: synthetic component and route interaction tests, TypeScript, lint,
formatting, and production build. Live data, database changes, and browser/E2E
execution are outside this task; operator visual acceptance remains required.

Verification result: 782 tests passed and one was skipped across 83 files;
TypeScript, scoped ESLint, formatting, and production build passed. Independent
source and synthetic interaction review passed. Existing URL schemas and backend
queries were preserved; no database migration or deployment was performed.

Approved directional UI restructuring is documented in
[`docs/ui-plan.md`](./ui-plan.md). Its `UI-R*` identifiers are sequencing labels rather
than independent roadmap tasks. BILL-T32 owns the UI revamp; BILL-T24 and BILL-T28
retain their underlying evidence and banking behaviour gates.

## BILL-T32 — UI and workflow revamp

Status: in progress on 24 September 2026.

Goal: make the approved v4 information architecture usable as a coherent, responsive
sole-trader application, including a discoverable CommBank CSV import entry point.

Scope: shared navigation and Add menu; distinct Overview, Transactions, Banking,
Sources (including the File library), Reports, and Administration destinations; the approved visual system;
bounded collection queries where required; workflow-specific states; and browser
verification with synthetic data. `UI-R01` through `UI-R09` in the UI plan describe
the implementation sequence.

Constraints: preserve existing transaction, import, reconciliation, permission, and
financial semantics. Do not expose data through client-side route visibility alone.
No speculative bank accounts, GST workflow, PDF extraction, or live-data testing.

Acceptance: an authenticated user can find every existing workflow from persistent
navigation, start a CommBank CSV upload from the Add entry point, use the core
screens without a single overgrown page, and navigate responsively by keyboard and
pointer. Collection totals and state labels reflect the underlying data accurately.

Role: UI implementation owners with independent verification. Dependencies:
BILL-T24 and the implemented BILL-T28 CSV/reconciliation slice. Verification gates:
typecheck, lint, formatting, tests, production build, and synthetic browser checks.

Checkpoint on 23 September 2026: the shared shell, distinct Overview/Artifacts/
Reports/Administration/Banking routes, bounded URL-backed Transactions table, exact
Overview attention counts, lifetime cash-movement summaries, scoped workflow states,
route-local retry controls, and dedicated transaction create/edit/Stripe destinations
are implemented. The integrated static gate passed 43 test files/335 tests,
typecheck, lint, formatting, and a production build. The remaining verification
gates include a PostgreSQL-backed smoke test of the new queries and populated
visual/keyboard/responsive review. The report service still aggregates after an
unbounded server-side transaction read; returning from edit drops the originating
transaction-list query.

User feedback on 24 September 2026 adds these in-scope acceptance checks: readable
transaction entry actions; full-width aligned desktop navigation and a non-scrolling
mobile menu; container-responsive forms with kind-relevant fields and safe bank-row
prefill; an explicit existing-PDF picker; an actual CommBank confirmation screen
followed by post-import classification; Stripe row preview before import; and no
native browser confirmation boxes for reversible reconciliation actions. Stripe
payout-to-bank matching and non-PDF artifact reuse are not part of this slice.

Code checkpoint on 24 September 2026: these feedback items are implemented. The
CommBank review and confirmation steps are distinct; overlap acknowledgement binds
to the current overlap set under a serialized import. Stripe preview is paged so
every derived row can be inspected before atomic confirmation. Reconciliation offers
sign-compatible kinds, safe owner-funding defaults, PDF reuse, and revision-checked
Undo. Independent source/test review found no remaining production defect. The full
gate passed 47 files/377 tests, typecheck, lint, formatting, and production build.
BILL-T32 remains in progress pending synthetic PostgreSQL/MinIO smoke, rendered
responsive/keyboard workflow acceptance, and the earlier query-scaling and
return-navigation follow-ups.

Further populated-UI feedback on 24 September 2026 reopened the bank-row creation
and detail acceptance gate: source-derived fields must be offered for explicit
acceptance rather than silently written, a new PDF chosen in Reconcile must have a
working save path, transaction DATE values must render without a client exception,
and form failures must be visible at the action. Sidebar group width and tax/category
suggestions are included in this correction. The correction code is implemented;
the integrated gate passed 48 files/392 tests, typecheck, lint, formatting, and
production build. Source hints, historical category, and foreign-tax treatment
are offered for explicit application rather than silently persisted. New invoice
PDFs use the available-artifact upload flow before atomic create-and-match;
transaction DATE values are normalized before detail rendering. Independent
review and rendered/browser plus disposable PostgreSQL/object-store acceptance
remain open. A lost upload-start response can create an orphaned pending artifact
on retry because that API has no idempotency key; this is a known follow-up, not
a verified data-integrity failure.

Operator follow-up on 24 September 2026: transaction-table links and edit-page
actions were aligned with the visual system. CommBank description-derived
counterparty hints were removed from new rows and ignored in legacy row review,
prefill, and candidate ranking after a bank-fee description produced a false
supplier. Raw description and signed AUD movement remain visible; neither bank
value date nor import period is treated as invoice date. Matching PDF filenames
again offer supplier, invoice-date, and reference values for explicit application
to blank fields. Local authentication was not changed: the user confirmed that
the configured `127.0.0.1` origin works, whereas `localhost` does not. The full
code gate passes 48 files/400 tests, typecheck, lint, formatting, and build.
Independent code/test review found no production defect in the inspected scope;
rendered browser acceptance remains unavailable in this environment.

## BILL-M4B — Bulk source uploads

Status: code complete; rendered acceptance pending. Task: BILL-T36 — Upload
multiple Stripe Balance Summary itemised CSVs, CommBank transaction-history
CSVs, or invoice/evidence PDFs.

Goal: select multiple files within an explicit source profile, see per-file
validation and progress, and complete each file independently without losing
the rest of the queue.

Scope: retain the existing Stripe row preview and atomic per-file import;
retain CommBank row preview, duplicate-file rejection, and overlap
acknowledgement; upload invoice/evidence PDFs to the artifact library without
creating transactions. Clarify the required Stripe report and distinguish an
unsupported All activity export from a malformed CSV.

Constraints: each CSV requires explicit per-file review and confirmation;
one failure cannot silently import or discard other files; PDF upload alone
changes no accounting data. Bank-statement PDF parsing and mixed-profile
autodetection are out of scope.

Acceptance: a multi-file selection can be processed and reviewed per file;
successful, failed, and pending files remain distinguishable; retry affects
only the selected file; duplicate/conflicting Stripe rows and overlapping
CommBank periods, including overlap created by an earlier file in the same
batch, remain visible before confirmation; uploaded PDFs appear as
reusable evidence artifacts and create no transactions.

Verification gates: focused interaction and server/domain regression tests,
typecheck, lint, formatting, build, and responsive keyboard/browser review.

Code verification: 50 test files/422 tests, lint, formatting, and production
build/typecheck pass. An independent PDF retry review found no material defect.
Rendered keyboard/browser review remains pending because the in-app browser
reported no available browser.

## BILL-M4C — Currency-aware document tax defaults

Status: code complete; rendered acceptance pending. Task: BILL-T37 — Follow
currency while document tax treatment remains unedited.

Goal: start new AUD expenses with Australian GST included and change the
provisional document treatment to foreign tax included for non-AUD currency,
reverting to Australian GST included if currency returns to AUD.

Constraints: never overwrite an explicit tax-treatment choice, preserve saved
transactions on edit, keep owner funding at no tax, and do not equate document
tax treatment with eligibility to claim an Australian GST credit. Clear only
stale auto-suggested Australian tax when currency changes.

Acceptance: new manual and bank-row-created expenses use the same default;
currency changes follow the selected rule until the treatment is manually
edited; manual treatment and tax-amount edits remain intact; owner funding and
GST-credit status retain their existing rules.

Verification gates: focused form/domain tests, typecheck, lint, formatting,
build, and rendered keyboard/browser review when available.

Code verification: focused form/workflow tests pass (77/77); the integrated
50-file/422-test suite, lint, formatting, and production build/typecheck pass.
Rendered keyboard/browser review remains pending because the in-app browser
reported no available browser.

## BILL-M4D — Import batch review and unified workspace

Status: code complete; rendered responsive acceptance pending. Confirmed 24 September 2026.

- BILL-T38 — Stripe and CommBank CSV imports use upload, explicit per-file
  admission or rejection, combined batch review, and one batch confirmation.
  Each accepted file remains an independent atomic import; partial results are
  reported by file. PDF evidence retains upload-only behavior.
- BILL-T39 — Persist rejected CSV artifacts visibly and allow explicit,
  permanent deletion only while rejected and unlinked. Remove the recorded S3
  object version before deleting its metadata; keep an undeleted rejected
  record visible if storage deletion fails. Artifact downloads use the original
  filename through signed Content-Disposition.
- BILL-T40 — Make Imports a dedicated tabbed workspace for Stripe, CommBank,
  and PDF evidence; route other Add actions to those tabs. Align Banking and
  other top-level pages to one layout, surface, typography, and responsive
  navigation system while retaining page-appropriate content widths.

Acceptance: rejected files never create rows; the batch review exposes per-file
errors and combined counts before confirmation; retries affect only failed
files; no duplicate import follows a partial result; rejected linked/imported
artifacts cannot be deleted. The Import tabs contain their workflows, not
links to disconnected pages. Downloaded artifacts use their original filenames.

Verification gates: focused state, storage, service, route, and interaction
tests; PostgreSQL/S3 integration where the local dependency stack is available;
typecheck, lint, formatting, build, and responsive keyboard/browser review.

Verified 24 September 2026: 50 unit-test files/445 tests; isolated PostgreSQL
integration 6/6, including a reject/link concurrency test; lint, formatting,
and production build/typecheck passed. The rebuilt local Compose app served a
healthy `/health` route. Independent source/test review found no confirmed
functional defect. Rendered mobile/keyboard acceptance remains open because
the browser connector reported no available browser. Exact-version S3 deletion
has mocked service/storage coverage but was not exercised end-to-end against
the local object store. Legacy artifacts cannot recover filenames already
overwritten before `original_filename` was added.

## BILL-M4E — Import correction and unlinked artifact cleanup

Status: code complete on 24 September 2026; independent code review found no
confirmed defect; rendered browser acceptance pending.

- BILL-T41 — Correct CommBank confirmation ordering so the artifact becomes
  available before bank-row provenance links are inserted in the same database
  transaction. Verify success and rollback against PostgreSQL.
- BILL-T42 — Permit deliberate permanent deletion of unlinked artifacts,
  including pending CommBank CSVs and available PDFs. Preserve the linked-data
  guard and exact-version storage deletion. The user chose immediate cleanup
  and accepted the risk that a still-valid PUT URL can create a later orphan.
- BILL-T43 — Warn, without blocking upload, when a selected filename matches
  an existing artifact. Match exact filenames within the same profile across
  the Stripe CSV, CommBank CSV, and PDF tabs.

Acceptance: failed imports leave no bank rows; a retry can complete; linked
artifacts cannot be deleted; every unlinked artifact shown in the reported
Artifacts view has a clear delete path or an explicit safe-pending state;
filename matches are advisory only. Verification gates: focused tests,
isolated PostgreSQL and object-store checks for relevant races, lint,
formatting, build, local Compose health, and rendered review when available.
The automated gates passed: 457 unit tests, 12 isolated PostgreSQL tests,
one opt-in MinIO version-deletion test, lint, formatting, and build. The
rebuilt local Compose service is healthy and `/health` returns HTTP 200.
The in-app browser was unavailable, so the rendered interaction gate remains
open. Immediate deletion of pending uploads retains the user-accepted risk
of a late PUT recreating an orphaned object. The exact-key object-store race
has not been exercised end-to-end.

## BILL-M4F — Source navigation and table readability

Status: code complete on 24 September 2026; rendered browser acceptance
pending.

- BILL-T44 — Give non-description columns fixed desktop widths in Banking
  Activity and Transactions, leaving Description to fill remaining space.
  Preserve mobile layouts and display both table dates as `16 May 2026`.
- BILL-T45 — Combine Imports and Artifacts into one top-level Sources page
  with Stripe CSV, CommBank CSV, PDF evidence, and File library tabs. Remove
  the redundant PDF upload button. Update all internal links and remove the
  pre-v1 `/artifacts` route without a compatibility redirect.

Acceptance: both tables prioritize description without desktop clipping or
mobile regression; the shared date presentation does not change sorting or
calendar days; all upload flows and artifact library controls remain
reachable from Sources, with no stale `/artifacts` links. Verification gates:
focused tests, typecheck, lint, formatting, build, and rendered review if
available.

Implementation checks passed: 459 unit tests, lint, formatting, and build.
The rebuilt local Compose app returned HTTP 200 from `/health`, the new
`/imports/library` route resolved, and `/artifacts` returned HTTP 404 as
intended. An independent code review found no confirmed regression; visual
and keyboard browser checks remain open.

### BILL-T46 — Readable table columns and compact actions

Status: code complete on 24 September 2026; rendered browser acceptance
pending.

The first fixed-width table pass made short fields too narrow in Transactions.
Give Date, Counterparty, Type, Amount, State, and Actions readable minimum
widths while Description fills the rest. Avoid arbitrary mid-word breaks;
allow horizontal scrolling before the existing card layout takes over.
Replace Actions text in Banking Activity and Transactions with compact icons,
hover/focus tooltips, and accessible names. Keep text labels in mobile cards.
Remove the non-action `Read-only import` label from Transactions Actions.
Acceptance: no broken words or clipped amounts/statuses at representative
desktop widths, all actions remain keyboard/screen-reader identifiable, and
mobile cards preserve clear labels. Verification gates: focused tests, lint,
formatting, build, rendered desktop/narrow-width checks.

The integrated suite passed 461 tests; lint, formatting, and build passed.
The rebuilt local Compose service is healthy and `/health` returned HTTP 200.
Independent code review found no confirmed defect. No in-app browser or local
browser runner was available, so actual visual clipping and tooltip placement
remain unverified.

## BILL-M4G — Source navigation and composable table queries

Status: code-complete on 27 September 2026; rendered operator review pending.

- BILL-T47 — Add the four Sources tabs as sidebar children with correct active
  states in desktop and mobile navigation; retain the in-page tabs.
- BILL-T48 — Give Banking Activity and Import History composable filter and
  ordered sort clauses, applied by the database before pagination.
- BILL-T49 — Replace the File Library's fixed filter grid with composable
  clauses and add ordered sort clauses, applied before pagination.
- BILL-T50 — Extend the existing Transactions filter-builder pattern to
  ordered sort clauses without losing header or mobile sort affordances.

Acceptance: field-appropriate operators and values; multiple filter clauses
combine with AND; sort clauses apply in visible priority order with a stable
tie-breaker; URL state survives navigation and resets to page one when a query
changes; all pages sort and filter the full result set rather than only the
visible page. Reports, Administration, and preview tables are outside this
slice. Verify with synthetic functional tests, typecheck, lint, formatting,
and production build; rendered E2E review remains deferred by the operator.

Verification on 27 September 2026: 602 synthetic tests passed (one skipped),
TypeScript, ESLint, scoped Prettier, production build, and diff check passed.
No populated-browser or live-database test was run for this slice.

## BILL-M4H — Unified query builder and navigation refinement

Status: BILL-T51–T53 code-complete on 27 September 2026; BILL-T54 awaits a
fresh Codex CLI failure report or relevant redacted logs.

- [x] BILL-T51 — Present filter and sort clauses in one mixed ordered builder on
      Transactions, Banking Activity, Bank Import History, and File Library. Sort
      priority follows sort-clause occurrence from top to bottom; filters retain
      AND semantics. Apply and reset actions preserve URL-backed state.
- [x] BILL-T52 — Move Reports beneath Overview in desktop and mobile sidebar
      navigation, retaining the `/reports` route and correct active states.
- [x] BILL-T53 — Omit request method and path from Folio structured logs for
      `/_serverFn` requests while retaining them for other routes.
- [ ] BILL-T54 — Diagnose the reported local Codex MCP discovery failure without
      reading bearer credentials or secret-bearing configuration. Use official
      Codex diagnostics and distinguish a fresh-session failure from a resumed
      session failure before changing the Folio MCP protocol.

Verification: synthetic functional tests, typecheck, lint, formatting, and
production build. Browser E2E remains deferred. The MCP investigation is
read-only until a reproducible failure identifies a safe in-scope fix.
Code verification on 27 September 2026: 620 synthetic tests passed (one
skipped), typecheck, lint, scoped formatting, production build, diff check,
and independent mixed-builder review passed. No browser E2E was run. The
unauthenticated local `/mcp` response was HTTP 401; this proves reachability
and does not diagnose authenticated Codex discovery.

### BILL-T55 — Live query and draft-review affordances

Status: code complete on 27 September 2026; rendered operator acceptance pending.

Goal: make query changes immediate and make the existing draft-evidence promotion
step legible. Scope: apply valid filter/sort edits automatically on Transactions,
Banking Activity, Bank Import History, and File Library; keep incomplete rows
editable; align and style Remove controls; space the transaction detail header;
show approved proposed-PDF filename suggestions in the draft editor; and label
the record action to state that it attaches the PDF. Invoice totals remain
verified draft data, not filename inferences.

Verification: 94 focused synthetic route tests and two draft-editor affordance
tests passed; TypeScript, ESLint, and production build passed.
Rendered review and broader UI regression remain open. Existing React-Aria
form-interaction tests have independent failures and were not treated as proof
of this change's behavior.

### BILL-T56 — Edit MCP-created drafts in Reconcile

Status: code complete on 27 September 2026; rendered and live-database
acceptance pending.

Goal: let the operator edit a suggested draft from Reconcile in the same
workspace used to create transactions, and let the originating MCP credential
correct its own still-draft transaction fields. The operator requested no
revision token for MCP draft edits. Restrict the MCP action to drafts created
by that credential and keep record promotion, evidence approval, and bank
matching human-only. Reconcile embeds the existing transaction workflow while
retaining the selected bank row. Synthetic tests cover loading an inline draft,
credential ownership, draft-only status, parsed field patches, and forbidden
status changes. TypeScript, ESLint, and production build pass. Browser and
live-database verification remain open.

### BILL-T57 — Draft-only suggestions, deletion, and unresolved queue

Status: code complete on 27 September 2026; operator acceptance pending.

Goal: keep Reconcile focused on actionable draft review and unresolved bank rows.
Scope: show proposed drafts only while their transactions remain drafts,
including drafts linked to resolved bank rows; retain existing-match proposals
while their bank rows are unresolved, including stale proposals with a warning;
permanently delete a manual draft and its
MCP submission from either transaction editor, retaining uploaded artifacts;
and provide a URL-backed unresolved-only bank-row queue toggle with pagination.
Deleting an MCP submission also removes its status and idempotency key, so a
replayed submission can create a new draft. No MCP delete tool or batch action.

Acceptance: promoted/void draft suggestions and resolved match proposals
disappear without deleting their records; resolved-row drafts remain visible;
only drafts can be deleted after confirmation;
uploaded artifacts survive; unresolved filtering works across pages and retains
the currently selected resolved detail until selection changes. Verification:
synthetic functional tests, typecheck, lint, and build. Browser E2E is deferred.

Code verification on 27 September 2026: 133 focused synthetic tests passed
across nine files, plus the new unresolved-queue interaction test. TypeScript,
ESLint, scoped Prettier, build, and diff check passed. Nine existing broader
Reconcile form-interaction tests still fail in React-Aria `getMetaValue` and
were not treated as evidence for this change. Re-run `pnpm migrate` before
deploying draft deletion so the app role receives DELETE on transactions and
MCP submissions. Live PostgreSQL and browser acceptance remain open.

Operator regression on 27 September 2026: selecting a bank row after enabling
Unresolved only cleared the filter. The installed TanStack Router parses
`unresolved=1` as numeric `1`, which the route validator did not accept. Queue
links now use `unresolved=true`, and the validator also accepts numeric `1`
for existing links. Router-parser and queue-selection synthetic tests pass;
operator re-verification is pending.

### BILL-T58 — Descriptive transaction-category report

Status: code complete on 28 September 2026; operator acceptance pending.

Goal: make recorded income and expense effects reviewable by period and
transaction category for tax preparation without asserting deductibility.
Scope: use each saved free-text category, retain custom values, and place
missing categories in Uncategorised buckets separated by transaction kind.
Group using the existing report basis, period, AUD inclusion rules, and source
warnings. Show the breakdown in Reports and its CSV. Present Stripe sale fees
as a separate uncategorised processing-fee effect rather than burying them in
the sale row. Do not infer private-use portions, capital treatment, or ATO
return labels from category text.

Acceptance: category effects reconcile to the report's income and expense
totals, credits net correctly, excluded and non-AUD rows stay excluded with
warnings, CSV category text is formula-safe, and the UI labels the table as
preparation figures rather than deductions. Verification: synthetic domain
and UI tests, typecheck, lint, formatting, build; no browser E2E.

Verification on 28 September 2026: 15 focused synthetic tests across the
report domain and route passed, as did TypeScript, targeted ESLint, targeted
source formatting, production build, and diff check. No browser or live-data
review was run. Whole-roadmap Prettier check still reports formatting in
pre-existing sections of this already-dirty document.

### BILL-T59 — MCP transaction editing and credential scopes

Status: code complete on 28 September 2026; operator acceptance and migration
application pending.

Goal: make transaction discovery and editing usable for reviewed MCP drafts
without granting unrestricted recorded-record changes. Search includes every
status and returns category and exact updated-at revision. Rename the edit tool
to `edit_transaction`: the credential may edit its own drafts under
`transactions:draft`, or change only category on any transaction under
`transactions:categorize`, using exact expected-updated-at concurrency checks.
Separate match suggestions under `bank_matches:suggest`; retain submission
status reads. Accept invoice PDF filenames without a reference. Expand `*` and
known-resource wildcards to currently known concrete scopes at credential creation;
migrate existing proposal-submit credentials to equivalent concrete scopes.
Verification: synthetic functional and migration tests, typecheck, lint, build;
no browser E2E or live credentials.

Code verification: 224 focused synthetic tests passed across 17 files. Full suite:
655 passed, 19 existing React Aria form-interaction failures, one skipped.
TypeScript, ESLint, and production build passed. Independent review confirmed
all resource wildcard prefixes and MCP edit-tool logging. Migration 0013 has
not been applied to a live database.

### BILL-T60 — Administrator access-token management

Status: code complete on 28 September 2026; operator acceptance pending.

Goal: let administrators list MCP credential metadata, create a credential with
explicit or wildcard scopes, reveal its secret once, and revoke it after
confirmation. Do not expose stored hashes or recover plaintext tokens. Retain
the CLI. Verification: synthetic permission, operation, repository, and UI
tests; no live credential creation or browser E2E.

Six focused token-management route and operation tests passed. No real token
was created or displayed during verification.

### BILL-T61 — Report warning detail and navigation

Status: code complete on 28 September 2026; operator acceptance pending.

Goal: show each report source warning with its transaction description and a
link to that transaction using structured warning data. Keep the CSV warning
output. Move Reports to a top-level sidebar item so Overview is not active on
the Reports route. Verification: synthetic domain and UI tests, typecheck,
lint, build; no browser E2E.

Twenty-eight focused report and navigation tests passed. Warning links use
structured transaction IDs; CSV warning text retains its existing format.

### BILL-T62 — Expired-session responses

Status: code complete on 28 September 2026; operator acceptance pending.

Goal: return HTTP 401 from protected server functions on expired sessions
instead of wrapping unauthenticated errors as HTTP 500. Protected page loads
redirect to login with a safe return path. Unexpected authentication failures
remain errors. Verification: synthetic status and route-redirect tests,
typecheck, lint, build; no browser E2E.

Fifty-one focused status and route tests and 37 existing operation tests passed.
The direct serialized HTTP response was not exercised; tests verify the
framework response-status setter and protected-route redirect behavior.

### BILL-T63 — Reconciled financial-year cash ledger

Status: code-complete on 29 September 2026; operator acceptance and live
migration pending.

Goal: make the selected financial year's cash-preparation totals traceable to
transaction rows and actionable source exceptions. Scope: exact AUD row effects,
explicit inclusion and exclusion reasons, separate expected exclusions from
missing facts, identify pending source-review work, and export the row-level
ledger. Stripe gross income and fees must remain distinct from internal payout
movements. No automatic tax classification. Verification: synthetic functional
tests, typecheck, lint, build; no browser E2E or live-financial-data read.

### BILL-T64 — Reviewed partnership tax adjustments

Status: code-complete on 29 September 2026; operator acceptance and live
migration pending. The operator confirmed no GST registration yet.

Goal: let Folio hold a human-reviewed FY2025–26 partnership net-income
preparation figure without claiming ATO certification. Scope: durable explicit
signed adjustments with reasons and source links, an immutable finalisation
snapshot or equivalent stale-source guard, no-GST-registration treatment for
this year, and a reproducible export. Deductibility, private use, capital
treatment, foreign-currency valuation, and timing remain operator decisions.
Verification: synthetic calculation, concurrency, permission, persistence,
and export tests; no live database or browser E2E without later approval.

### BILL-T65 — Partner allocation and review workflow

Status: code-complete on 29 September 2026; operator acceptance pending.
The operator selected percentages totaling 100%.

Goal: allocate the reviewed partnership figure to partners and show
why the worksheet is ready or still incomplete. Scope: partner shares that
reconcile to the reviewed net result, review controls, and accountant-facing
export; no direct ATO lodgement. Verification: synthetic functional and
authorization tests, followed by operator review against real records.

Implementation checkpoint on 29 September 2026: the worksheet is limited to
FY2025–26, uses no-GST-registration treatment, stores append-only reviewed
snapshots in migration 0014, and exports a separate unreviewed source ledger
and current reviewed CSV/JSON. Review blocks unknown-year drafts, missing AUD
cash facts, and unresolved imported bank rows. A fingerprint change labels the
snapshot historical and prevents reviewed export until re-review. Exact
adjustments require reasons; optional transaction links must belong to the
selected source ledger. Generic partner labels and exact percentages allocate
the reviewed net result. Stripe cash timing still follows imported creation
dates and requires operator/accountant confirmation. Source-fingerprint check
and insert are not atomic; a concurrent edit can create an immediately stale
historical version, which the next load/export detects. No live migration,
populated-data review, or browser E2E was run.

### BILL-T66 — Tax-preparation presentation corrections

Status: code-complete on 30 September 2026; operator visual verification pending.

- [x] Rename the general Reports child Financial summary and remove the worksheet
      back link.
- [x] Show source net as income minus expenses, independently of owner-funding
      cash movements; show each partner's income, deductions, and net using the
      agreed percentage with exact remainder allocation.
- [x] Order included source transactions oldest-first with a stable ID tie-breaker
      and Date, Supplier/source, Type, Income, Expense columns. Use the saved
      counterparty, otherwise Stripe or Manual; do not infer CommBank provenance.
- [x] Align adjustment fields, partner labels, controls, and the review checkbox
      with responsive layouts. Reports show two-decimal AUD amounts where
      possible and retain non-zero sub-cent precision.
- [x] Verify synthetic functional requirements, typecheck, lint, and production
      build. The full suite passed 725 tests, with one skipped, on 30 September 2026.
- [ ] Verify the rebuilt Docker app visually, then check in the accepted changes.

Existing reviewed snapshots and exact exports are unchanged; the partner
breakdown is derived from saved totals and percentages. No live financial data,
database migration, or browser E2E was used for verification.

### BILL-T67 — Retire MCP submission-status lookup

Status: code-complete on 30 September 2026; operator verification pending.

Remove `get_submission_status` and its unused repository helper. Retain exact-key,
same-payload submission retry for idempotent response recovery, and use transaction
search for linked record status. New CLI/web credentials and wildcard expansion
exclude `submissions:read`; existing stored credentials still authenticate with
the legacy scope, which no longer exposes a tool. No credential migration is
required. Synthetic tools, scopes, credential issuance, and repository tests pass;
the operator skill and MCP contract reflect the removal.

### BILL-T69 — Compatible edits to matched transactions

Status: code-complete on 30 September 2026; live migration and operator verification pending.

Goal: preserve an existing bank match when an edit retains eligibility and the
exact signed AUD settlement. Allow date and same-direction classification edits;
reject incompatible amounts, currencies, directions, and voiding with an
actionable conflict. Never silently unmatch a bank row. Add migration 0015 and
synthetic repository, diagnostic, and PostgreSQL trigger tests. No live-data access
or populated-browser testing is in scope.

Verification: 739 synthetic tests passed with one skipped; eight disposable PostgreSQL
reconciliation tests passed, including direct trigger writes and concurrent matching.
Migration 0015 was applied only to the dedicated test schema. No live migration or
Docker app rebuild was performed.

### BILL-T72 — Autocomplete layout and interaction polish

Status: code-complete on 30 September 2026; operator visual verification pending.

Prevent horizontal popup overflow, widen menus for labels within the viewport,
open suggestions on focus, and place wrapping enum selection chips inside the
input container. New string filters default to contains; saved operators remain.
Investigate prior dropdown/PDF component-test failures and verify synthetic
interaction behaviour, typecheck, lint and build. No live data or browser E2E.

Add filter/sort controls now follow the rows in all four builders. The full
synthetic suite passed 773 tests with one skipped. Build, typecheck, focused lint,
formatting and whitespace checks passed. Prior manual-form failures were resolved
as test-harness gaps: common DOM setup supplies missing pointer, scroll and CSS
APIs. Focus-open validation tests dismiss suggestions before querying the summary.
Geometry remains unverified in a real browser; no migration is required.

### BILL-T71 — Complete counterparty suggestions

Status: code-complete on 30 September 2026; operator verification pending.

Include counterparties from all non-void transactions, including drafts and imported
records. Keep blank/null exclusion, trimmed distinct values, stable ordering, actor
authorization, and the existing 200-item bound. Supplier/category associations and
category suggestions remain unchanged. Verify with synthetic repository regression
tests; no live data or database migration. Bulk actions remain deferred.

Verification: 54 repository and 33 transaction-workflow tests passed; typecheck,
focused lint, formatting and whitespace checks passed. Broader manual-form checks
failed 13 of 49 existing dropdown/PDF tests; no manual-form code was changed in
this task. Those failures require separate investigation.

### BILL-T70 — Searchable dropdowns and enum multi-select filters

Status: code-complete on 30 September 2026; operator visual verification pending.

Replace native dropdowns with shared searchable fixed-choice autocomplete controls,
retaining creatable supplier/counterparty and currency inputs. Enum filters default
to contains any of, allow contains none of, and use searchable multi-selection with
removable chips. Match any selected value within a row; match all separate rows.
Preserve immediate application, scalar is/is-not bookmarks, typed enum validation,
parameterized queries before pagination, keyboard access, and form submission.
Verify using synthetic unit/component tests, typecheck, lint, and production build.
Bulk selection and apply-field/value actions remain a proposal, not this task's scope.

Verification: 768 synthetic tests passed with one skipped; TypeScript, focused lint,
formatting, whitespace checks, and production build passed. Named autocomplete tests
cover actual keyboard selection, unmatched-text keyboard submission rejection,
required choices, disabled values, native reset,
submitted enum values, and multi-select chips. All former native select dropdowns were
replaced; creatable fields remain. No live records, migration, browser E2E, Docker app
rebuild, or commit was performed.

### BILL-T68 — User-linked partner allocations

Status: direct-plus-remainder model selected on 1 October 2026; same agreed
percentages for Business expenses confirmed on 1 October 2026. Detailed
[implementation plan](./implementation-candidates.md#bill-t68--actual-user-partner-attribution)
passed source readiness review for scope approval; attribution/adjustment defaults and implementation
boundaries were approved on 1 October 2026. Implementation in the current working
tree with synthetic tests and no commits was authorized on 2 October 2026.
Code-complete and synthetic-verified on 2 October 2026; operator review remains open.

Use actual Folio users for partner identity instead of generic labels. The operator
selects partnership members explicitly during review; a user account alone
does not establish partnership membership. Preserve historical reviewed
allocations when a user's profile or agreed percentage changes.

Operator requested attributing transactions whose owner matches the chosen user,
and selected direct allocation of owned income/expenses plus percentage allocation
of the remaining pool. Do not add owned amounts to percentage shares of the same
full result. Linked adjustments follow the source's direct/Business attribution;
unlinked adjustments use Business. Preserve existing exclusions and previous saved reviewed versions.
Legacy percentage-allocation calculations and exports remain unchanged.

Operator additionally requested an explicit Business allocation option, using a
system-owned transaction as an example, and the ability to assign those costs to
partners during review. The initial percentage-pool rule is implemented; custom
per-cost reassignment remains outside the approved initial scope.
On 1 October 2026 the operator narrowed the initial rule: Business expenses are
allocated to partners by percentage, in addition to transactions directly attributed
to them. A custom per-transaction split editor or direct reassignment of individual
Business costs is not part of this confirmed initial scope. The operator confirmed
the Business pool uses the same agreed partner percentages on 1 October 2026;
separate Business-cost percentages are out of the initial scope.

Source review on 1 October 2026: current partners contain generic labels and
percentages, not user IDs. The tax cash ledger omits owner IDs, while reviewed
results are append-only JSONB snapshots. Manual/reconciliation defaults assign
the acting user as owner; the existing ownership field denotes operational
responsibility, not proof of an agreed tax allocation. Owners must be reviewed
before their values drive partner amounts. The current user model has only ID,
email, display name, role and active state; it has no system-account marker. The
transaction owner remains a user reference, not a free-form allocation target.

Approved implementation boundary:

- Select one actual active Folio user per partner; reject duplicates and validate
  percentages total exactly 100%. Explicit selection identifies members for this
  review, not every user account. A narrowly authorized option query returns stable
  IDs and display labels rather than the current all-users/email form-option payload;
  missing or ambiguous labels use a stable ID distinction. Validate active targets
  on the server, without trusting client-supplied labels.
- Project owner IDs into the tax source ledger. Allocate included income/expense
  effects directly when the owner matches a selected partner; allocate all other
  effects through the shared percentage pool. Show non-matching/unassigned owner
  totals before saving. Owner funding's cash movement must not become tax income.
- Add Business (shared) as an explicit review-attribution target, distinct from an
  actual partner and from the ledger's user-owner field. A system account not
  selected as a partner, other non-matching owners and unassigned rows default to
  this shared target; do not guess account type from names or roles. Business
  expenses contribute each partner's percentage share on top of their directly
  attributed expenses, never on top of a share of the same full expense total.
  Keep ledger ownership unchanged. Custom per-cost splits and Business-cost direct
  reassignment are deferred; any Business/partner classification override needs
  an explicit agreed UI boundary before implementation.
- Linked tax adjustments follow the linked transaction's final reviewed attribution,
  without a per-cost reassignment editor; unlinked adjustments use the Business pool.
  These rules were approved on 1 October 2026. Preserve existing included/excluded tax
  effects and total reviewed income/deductions; attribution changes distribution,
  not deductibility or the total net result.
- Use exact signed decimal arithmetic and deterministic rounding so partner income,
  deductions and net reconcile to the full reviewed result without double counting.
- Version the new snapshot payload and freeze user IDs, displayed labels, agreed
  percentages, source ownership and direct/shared/final amounts. Preserve legacy
  generic-label calculations and exports; do not reinterpret old reviewed versions.
  Freeze Business/direct classification and allocation amounts in the new snapshot;
  do not reconstruct them from later live ownership changes.
  JSONB permits additional fields without rewriting the append-only records.
  Compare legacy reviews against their original owner-less fingerprint projection,
  including its version tag/key order; compare new reviews against a versioned
  owner-aware fingerprint. A deployment must not stale legacy reviews merely by
  adding owner IDs, but actual owner edits still change existing row revisions.
  Unknown future snapshot versions must reject rather than silently use legacy rules.
- Cover allocation, refunds, exclusions, adjustment attribution, duplicate/inactive
  users, Business defaults, stale ownership, rounding and legacy versions
  with synthetic tests. Live
  data, DB migration and browser/E2E work remain outside the approved scope.

Checklist:

- [x] Confirm direct owner allocation plus percentage shares of the remainder.
- [x] Inspect owner options, ledger projection and saved-version boundaries.
- [x] Record the explicit Business target and review-time cost-attribution requirement.
- [x] Confirm percentage allocation of Business expenses in addition to direct transactions.
- [x] Confirm the Business pool uses the same agreed partner percentages.
- [x] Confirm shared-pool and linked/unlinked adjustment rules without per-row overrides.
- [x] Authorize implementation in the current working tree with synthetic tests and no commits.
- [x] Implement domain allocation, validated user selection and versioned snapshots.
- [x] Verify synthetic behavior and preserve existing exports/legacy calculations.
- [ ] Operator review of ownership and resulting allocations.

Parallel-work candidates reviewed on 1 October 2026; this is not authorization to
create worktrees, commit changes or implement another feature:

- BILL-T33 match/create-and-next: reconciliation route/interaction tests and a
  narrow authorized next-selection read with existing one-based paging limits;
  existing unresolved filtering is already implemented. Limit this to an explicit
  success-and-advance action preserving queue filters, leaving tax allocation,
  shared owner options and financial-match rules unchanged.
- BILL-T78 unversioned object-storage support: separate document storage/lifecycle work,
  starting with a scoped compatibility and preservation plan. Current confirmation,
  reads and downloads require version IDs. Old artifact access, checksums, overwrite
  protection and recovery/deletion behavior need explicit acceptance; do not migrate
  or delete live objects. Provider selection and live tests require separate approval.
- BILL-T77 supplier-invoice parsing: on 1 October 2026 the operator prioritized the
  existing Google Workspace, Supabase and Stripe invoices instead of CommBank
  statements. Isolate pure, versioned recognizers and synthetic fixtures first;
  sequence extraction/form integration separately. BILL-T30 remains deferred.

Full dark appearance (BILL-T35) overlaps shared/tax CSS and needs theme behavior
confirmed; full audit history (BILL-T09B) spans the same operation/persistence
boundaries. Neither is a clean concurrent full-feature implementation for this slice.
Only the main worktree currently exists. Recent changes remain uncommitted, including
untracked tax modules; a new worktree at HEAD would miss that code. Agree a checkpoint
commit or an explicitly reviewed tracked/untracked patch baseline before parallel
implementation. Separate worktrees do not isolate ports, live services or databases.

### BILL-T77 — Supplier invoice PDF suggestions

Status: initial scope approved on 1 October 2026; implementation in the current
working tree with synthetic tests and no commits authorized on 2 October 2026 and
code-complete. Synthetic parser/extraction/UI tests and isolated built-code extraction
passed on 2 October 2026; actual-invoice and operator visual acceptance remain open.
See the [detailed plan](./implementation-candidates.md#bill-t77--supplier-invoice-pdf-suggestions).

Goal: turn the operator's supported supplier invoice PDFs into bounded,
human-reviewed transaction field suggestions, without inventing payment facts.

Verified inventory: ten Google Workspace, nine Supabase and seven Stripe invoices;
all have extractable text and are unencrypted. Nine privacy-masked representative
renders cover the inspected one-, two- and three-page shapes. Local inspection was
explicitly approved; originals remain unchanged and no files were uploaded externally.

Vertical slices: pure vendor parsers/synthetic fixtures, then a local bounded
extractor/authorized exact-artifact read, then explicit review/apply UI. Keep the
invoice artifact profile and optional filename reference. Unknown/scanned/encrypted
or conflicting layouts fall back to manual entry. Amount due is not the invoice
total; unqualified `$` needs currency confirmation. Stripe monthly invoices can
overlap imported fees and cannot currently link to imported Stripe transactions.
The approved first release extracts Stripe facts for review only, without expense
prefill or evidence-schema changes.

Acceptance: recognized supplier anchors, multi-page/repeated totals, exact amounts,
date roles, ambiguous currency, optional references, privacy-safe diagnostics,
bounded extraction, explicit blank-only/conflict handling and no duplicate-fee
automation. Main owns shared form/lifecycle/dependency integration; parser-only
work can be isolated after an approved dirty-tree baseline. No OCR, MCP extension,
live writes or browser/database integration tests are included in this planning turn.

### BILL-T78 — Unversioned object-storage compatibility and transition

Status: source/provider-documentation investigation on 1 October 2026. See the
[detailed plan](./implementation-candidates.md#bill-t78--unversioned-object-storage-without-losing-evidence).
No provider test, configuration switch or live migration was performed.

Goal: allow new artifacts to use unversioned storage while preserving access to
existing exact-version evidence and application-level write-once integrity.

First slice is an explicitly approved, disposable synthetic compatibility probe;
SeaweedFS is the documentation-based first candidate, not a verified drop-in.
Garage remains a candidate with checksum/conditional-write capability gates.
Subsequent slices introduce explicit per-artifact storage mode/location references,
legacy-compatible lifecycle/CAS checks and required signed upload headers, then
switch new uploads only. Preserve old backend access, objects and volumes.

Acceptance: content/checksum/metadata verification, atomic create-only upload/replay
protection, all PDF/CSV/MCP upload callers, recovery/reads/import commits/proposals,
linked-delete protection and unexpired-upload deletion races, restart persistence,
old/new artifact coexistence and rollback. A new migration must preserve existing
IDs/keys/versions and state checks. Provider/container tests, database integration,
live credentials/configuration, legacy copying/retirement and deployment each need
separate scope approval. Storage integration overlaps invoice lifecycle/form/server
integration and must not run concurrently on those files.

## Tentative future milestones — recorded 24 September 2026

These are planning candidates, not authorization to implement them. Their open
choices must be confirmed before work starts.

### BILL-M5 — Reconciliation review throughput

Status: approved explicit next-row slice code-complete on 2 October 2026; candidate
new-tab review remains tentative. Task: BILL-T33 — Review candidates and advance the queue.

Goal: let the operator inspect an existing transaction without losing the bank
row, then advance after a successful reconciliation action.

Scope: a candidate review link, a clearer link for an already matched
transaction, and an explicit save/match-and-next action. Opening candidate review
in a new tab remains proposed and outside the approved next-row slice. Advancing
to the next unresolved bank row within the active import/filter was approved on
1 October 2026.

Readiness investigation on 1 October 2026 recorded an explicit success-only advance
plan and synthetic cases in
[implementation candidates](./implementation-candidates.md#bill-t33--explicit-matchcreate-and-next).
Cross-page traversal within the active queue, wrapping once to earlier unresolved
rows, was approved on 1 October 2026. Preserve filter values, use a stable
date/ID anchor after queue contraction, and distinguish matched-success from failed
navigation. Existing unresolved filtering and loaded-page leave-unresolved actions
are already implemented. The explicit next-row slice was authorized for implementation
in the current working tree with synthetic tests and no commits on 2 October 2026;
implementation and synthetic interaction verification are complete. Candidate
new-tab review remains deferred; PostgreSQL queue execution and operator review
remain unverified. Final combined suite passed 943 tests with one skipped, plus
sequential production build/TypeScript and scoped lint/formatting.

Checkpoint on 25 September 2026: the already-matched transaction now has a
prominent View matched transaction link, including immediately after a
successful create-and-match. The candidate review and next-row actions remain
tentative. The separate source-hints confirmation was removed from bank-row
creation; imported posted date, AUD movement, and raw description populate
when a transaction kind is selected, while supplier and invoice date remain
blank for review. The full unit suite passed on rerun (462 tests); lint,
formatting, and build passed. Rendered browser acceptance remains open.

Presentation follow-up on 25 September 2026: the matched link's normal-state
contrast was corrected without changing secondary links. Transaction detail
now shows its description once, under Record details, and presents Edit as a
secondary action. The full suite passed (463 tests), alongside lint,
formatting, typecheck, and build. The rebuilt local app returned HTTP 200 at
`/health`; rendered browser acceptance remains open.

Reconciliation queue follow-up on 25 September 2026: compact bank-row cards
and a 36rem internal scroll cap (20rem below 760px) prevent the queue from
extending below the transaction form. Pagination remains outside the scroll
region; selecting a row adjusts only its internal scroll position. The full
suite passed (464 tests), with lint, formatting, and build. Independent static
review found no defect and the rebuilt app returned HTTP 200 at `/health`;
rendered browser acceptance remains open.

Creation follow-up on 25 September 2026: direct sign-compatible `Create …`
buttons replace the intermediate kind dropdown. An explicit Use payment
values action fills only blank invoice-date and AUD document-value fields in
non-funding bank-backed forms; it preserves foreign-currency and manually
entered values. A selected existing invoice PDF can provide filename-derived
date/reference suggestions through a per-PDF action, with supplier optional.
The full unit suite passed (471 tests), plus lint, formatting, and build.
Independent review found no production defect; the rebuilt local app returned
HTTP 200 at `/health`. Rendered browser acceptance remains open.

Selected-PDF presentation follow-up on 25 September 2026: each source now
shows a compact filename line and persistent field-specific Apply supplier,
date, and reference actions. An explicit reapplication can restore an edited
field; Apply date preserves the form's auto-managed occurrence-date behavior
without overriding a manually edited occurrence date. A unique matching
historical supplier label is preferred over camel-case filename fallback.
The full unit suite passed (472 tests), with lint, formatting, and build;
independent review found no production defect and rebuilt local health
returned HTTP 200. Rendered browser acceptance remains open.

Constraints: no automatic matching or approval; retain exact signed-AUD and
revision checks; failed saves leave the operator on the current row.

Acceptance: the candidate can be reviewed and, where permitted, edited; a
successful action advances once; stale or failed actions do not advance; the
end of the queue has a clear completion state.

Role: reconciliation UI owner with independent verification. Dependencies:
BILL-T28C/D and BILL-T32. Verification gates: focused interaction tests,
typecheck, lint, formatting, build, and responsive keyboard/browser review.
Blockers: operator review and separately authorized PostgreSQL execution checks.
Navigation/wrap semantics were approved on 1 October 2026. Parallel boundary: UI
navigation can be developed separately from candidate-query changes.

### BILL-M6 — Local Codex MCP artifact and draft intake

Status: implementation passes synthetic functional tests as of 26 September
2026; local rollout and live-database verification remain, ahead of BILL-M5
and BILL-M7. Task:
BILL-T34 — Upload source artifacts, submit drafts and match suggestions, and
review them through existing Folio workflows. Detailed tentative contract:
[MCP artifact and draft intake](mcp-plan.md).

Implementation checklist (synthetic functional tests only; end-to-end deferred):

- [x] Persist validated PDF and CSV uploads in a shared Awaiting review inbox;
      retain human approval/import gates and reload-safe file listing.
- [x] Expose scoped MCP metadata and two-step upload tools on the existing web
      listener, with `/mcp` disabled by default.
- [x] Accept idempotent draft and match suggestions without recording or matching;
      show them in existing Reconcile and transaction-review workflows.
- [x] Verify functional requirements with synthetic fixtures, typecheck, and lint
      (559 tests passed, one skipped on 26 September 2026).
- [ ] Verify migrations and deferred evidence trigger against a live local
      PostgreSQL instance; run local Codex-to-Folio smoke and browser E2E only
      when the operator authorises that later test phase.

Goal: let local Codex submit source artifacts, draft-transaction and match
suggestions through a stateless MCP endpoint, without recording a transaction,
importing CSV rows, or matching a bank row until a human acts in Folio.

Scope: bounded, idempotent individual submission and status tools; artifact
metadata discovery across all profiles, with original-file retrieval deferred;
two-step artifact upload limited initially to invoice PDFs, Stripe CSVs, and CommBank
transaction-history CSVs, with validated confirmation and the same human
review as UI uploads; CSV uploads queued for existing per-file and batch
import review with duplicate warnings for both Stripe and CommBank; uploaded
files persist in Awaiting review, but Add-to-batch selections reset on reload;
MCP-created manual drafts and stored existing-match suggestions, excluding
drafts derived from Stripe CSV rows;
pre-import CommBank drafts may cite the uploaded artifact and source row and
resolve beside a bank row after import without creating a match; review within
the current Reconcile suggestions area and ordinary transaction editor. Human
promotion from draft to recorded approves a new transaction; a separate manual match
approves reconciliation. No separate proposal inbox or first-class AI/MCP
navigation. Human recording is one reviewed draft at a time; there is no
bulk-record approval in the first slice. Remote MCP access is a separate future
extension.

Constraints: local/private exposure only; MCP can upload and queue artifacts
but not approve a PDF, confirm a CSV import, record drafts, or match bank rows;
drafts may cite uploaded but unapproved PDFs as proposed evidence, while
recording requires each retained PDF to be approved and available; Stripe CSV
rows create transactions only through confirmed import; metadata,
upload, and draft-submit permissions are separate; editable
notes are not the sole provenance mechanism; each MCP credential binds one
permitted default owner, and the human reviewer may change it before recording;
metadata includes original filenames under the operator's non-PII filename
convention, without per-file approval or a PII-detection guarantee;
revalidate duplicates, signed amounts, ownership, and revisions when recording
or matching.

Acceptance: repeated MCP calls do not duplicate drafts or upload intents;
uploads from MCP and the UI await human review; both CSV types appear in
Sources → Imports for per-file review with non-blocking duplicate warnings
without creating rows; proposed PDF evidence cannot become an approved link
until artifact approval and draft recording; unrecorded drafts and unused
match suggestions leave reports and bank matches unchanged; submitting a
draft derived from a Stripe CSV row is rejected; a human records and
attributes each transaction; only an explicit human match changes the bank
row; a pre-import CommBank locator never matches automatically and
remains unlinked if its source row is rejected or absent; unsupported bank
statement PDF and NAB CSV uploads are rejected in this first slice, while
approved artifacts of those profiles remain discoverable as metadata; stale
suggestions surface actionable conflicts.

Role: MCP/auth, submission persistence, and Reconcile UI owners with
independent security and financial verification. Dependencies: BILL-T09A,
BILL-T28, and the manual-entry workflow. Verification gates: protocol
conformance, permission and idempotency tests, PostgreSQL-backed draft/save/
match tests, and a local Codex-to-Folio smoke test. Blockers: verify current
SDK/Codex protocol compatibility, implement credential-bound owner attribution
for MCP-created drafts, validate the durable CSV review-queue bridge and shared
duplicate-warning signals (same-profile checksum, overlapping source rows,
same-profile filename), and verify loopback deployment.
Transport/authentication, individual submission,
all-profile artifact metadata discovery, three-profile two-step upload,
pre-import CommBank row locators, and human-reviewed CSV import
are confirmed. MCP original-file retrieval is deferred, including download
URLs and binary responses. Codex may inspect a specific file containing PII
only after the operator explicitly submits it for review or approves its read;
no background inspection is authorised. Remote access also depends on
BILL-T09B, BILL-T10, and public-exposure verification. Parallel
boundary: protocol endpoint and Reconcile suggestion UI share one domain
contract. Synthetic functional verification is complete; PostgreSQL-backed
workflow, local Codex smoke, and browser E2E gates are deferred at the user's
request and are not evidence of current runtime readiness.

### BILL-M7 — Dark appearance

Status: tentative. Task: BILL-T35 — Theme the full application.

Goal: make the existing Folio workflows legible in dark mode without altering
their layout or accounting behavior.

Scope: theme tokens for surfaces, text, controls, charts, statuses, hover, and
focus; system color preference first. A manual override and persistence policy
remain open choices.

Constraints: maintain contrast and recognizable state cues; avoid page-specific
one-off palettes or a flash of the wrong theme on initial render.

Acceptance: core routes, dialogs, forms, tables, and charts remain readable and
keyboard-usable in both schemes. Role: visual-system owner with independent
accessibility review. Dependencies: BILL-T32 visual system. Verification gates:
color-contrast checks and rendered desktop/mobile review. Blocker: confirm
manual override behavior. Parallel boundary: token design precedes route-level
adoption and visual acceptance.

Approved version-one banking-domain decisions are documented in
[`docs/banking-plan.md`](./banking-plan.md). The candidate now includes resolved
architecture decisions, module boundaries, migration strategy, and provisional
`BANK-I*` implementation slices. The six independent-review gates were resolved on 23
September 2026. BILL-T24 and BILL-T28 are the active implementation boundary;
BILL-T30 remains deferred until the CSV workflow is accepted.

## BILL-M1 — Private manual expense register

Status: extracted standalone build; operational acceptance remains pending.

Goal: record supplier expenses, archive original evidence in S3, import Stripe
activity, and produce reviewable Australian period-based preparation summaries
without representing Folio as accounting or lodgement software.

- [x] BILL-T01 — Canonicalise transaction, source-artifact, user, money, GST,
      actor-attribution, and Stripe CSV semantics.
- [x] BILL-T02 — Establish the TanStack Start application, Node.js 24 packaging,
      PostgreSQL migration workflow, validated schema/S3-prefix configuration,
      and private-mode guard.
- [x] BILL-T03 — Implement users, transactions, fixed-precision source magnitudes,
      derived effects, GST treatment, status transitions, and ownership.
- [x] BILL-T04 — Implement direct presigned S3 upload, metadata confirmation,
      integrity metadata, download, and replacement semantics.
- [x] BILL-T05 — Implement accessible entry, list, detail, edit, ownership,
      typed private-mode actor selection, and void UI.
- [x] BILL-T06 — Implement activity/cash preparation summaries and CSV export.
- [x] BILL-T11 — Simplify manual entry with progressive disclosure, filename
      suggestions, integrated PDF evidence, and a separate Stripe import surface.
- [x] BILL-T12 — Add reusable suggestions, AUD-first currency entry, foreign
      settlement fields, tax treatment, settlement state, and owner funding kinds.
- [x] BILL-T13 — Make dates calendar-only, stage upload/import progress, and add
      safe server diagnostics and route boundaries.
- [x] BILL-T14 — Emit completion-only structured operation records by default,
      with stable codes, retryability, and matching client guidance. Routine
      Folio access successes and health-check events are suppressed; remaining
      events include HTTP method and pathname without query parameters, and
      correlation references appear on failures only (revised 27 September 2026).
- [x] BILL-T15 — Bind checksum and artifact metadata into S3 upload signatures.
- [x] BILL-T16 — Preserve exact revision tokens, typed conflicts, confirmed
      evidence across failed saves, and select/custom-value controls.
- [x] BILL-T17 — Accept Stripe Dashboard itemised Balance CSV timestamps and
      sanitise validation detail.
- [x] BILL-T18 — Restore tab-scoped actor attribution after refresh and protect
      against stale workspace responses.
- [x] FOLIO-EXT-02 — Extract Folio into this standalone repository with local
      package, lockfile, tooling, Docker packaging, docs, and agent handoff files.
- [ ] BILL-T07 — Verify backup/restore, private exposure, upload recovery,
      permissions, representative workflows, and complete vertical-slice behaviour.

Constraints: no public unauthenticated deployment; no real invoices, credentials,
personal information, live cloud mutations, email ingestion, Stripe webhooks, OCR,
FOCUS projection, direct tax lodgement, or
speculative Lambda configuration. Original document bodies do not enter PostgreSQL
or application-local persistent storage. A claimable transaction requires an
available invoice PDF.

Acceptance: trusted operators can privately enter, edit, void, find, and export
synthetic transactions; PDFs and Stripe CSVs remain private and recoverable;
financial totals are deterministic; and changes carry explicitly unverified typed
user attribution.

Verification gates: unit tests with synthetic data; TypeScript; ESLint; Prettier;
production Vite/Nitro build; shell syntax; standalone lockfile install; and a
Docker image build when Docker is available. Live PostgreSQL, S3, browser, backup,
network, IAM, retention, and accountant-policy checks remain operational gates.

### BILL-T26 — Actionable server failure diagnostics

Status: complete on 20 September 2026.

Goal: make failed operation records useful for server-side diagnosis while keeping
client failures generic and correlation-ID based.

Scope: preserve Folio's diagnostic fields separately from a server-only `sourceError`
object. Ordinary `Error` values preserve source name, JSON-safe scalar code, message,
and stack when available. Zod failures record only their name and issue array. Hostile
and non-Error throws degrade to safe records without changing operation behaviour.

Constraints: source-error details are server-only and must never enter the client
response. Folio diagnostic fields and source-error fields remain distinct. Client
failures remain generic and carry only fixed guidance, the Folio diagnostic code, and
a correlation reference.

Acceptance criteria: a boot configuration validation failure identifies its invalid
fields through Zod issues; ordinary exceptions retain one-to-one name, code, and
message values in the server record; the client receives only existing fixed guidance,
diagnostic code, and correlation reference.

Role: diagnostics implementation owner with independent verification.
Dependencies: existing `runOperation` diagnostics boundary.

Verification passed: 25 test files and 160 tests, typecheck, ESLint, Prettier, and
independent verification.

Residual risk: Zod issue content can itself describe invalid input.

## BILL-M2 — Google Workspace access control

Status: BILL-T08 and BILL-T09A code-complete on 20 September 2026; BILL-T09B
and BILL-T10 remain incomplete and public exposure is blocked.

Goal: replace typed private-mode attribution with authenticated, allow-listed users
and introduce trustworthy mutation history.

### BILL-T08 — Google OIDC and server sessions

Status: code-complete on 20 September 2026; Google, PostgreSQL, and reverse-proxy
verification remains pending under BILL-T07 and BILL-T10.

Goal: authenticate Folio operators through the BuildSight Google Workspace without
placing Google tokens or OAuth secrets in the browser.

Scope: implement server-only authorization-code login through `/auth/login`, callback
handling through `/auth/callback`, and `POST /auth/logout`; use state, nonce, and PKCE;
validate Google discovery metadata, ID-token signature, issuer, audience, expiry,
verified email, and the exact `buildsight.com.au` hosted-domain claim; bind the stable
`sub` claim to a pre-provisioned `users.google_subject`; and issue an opaque, rotated
Folio session backed by a hashed server-side record with expiry and revocation.
The implementation is in `src/auth/*`, `src/database/auth-repository.ts`, and the
server-only `/auth/*` route handlers. Migration 0004 adds `auth_attempts` and
`auth_sessions` under the configured schema.

Constraints: production origin is `https://folio.buildsight.com.au`; local origin is
`http://127.0.0.1:43230`; their exact callbacks are `/auth/callback` on those origins
and use separate OAuth clients. `FOLIO_ORIGIN`, `FOLIO_GOOGLE_CLIENT_ID`, and
`FOLIO_GOOGLE_CLIENT_SECRET` are process-environment settings; the client secret must
never enter browser bundles, logs, Terraform state, or source control. Generate
redirect URIs from validated configured origins, not request host headers. The default
session lifetime is 12 hours with no Google refresh-token dependency. Sessions are
opaque random tokens; only SHA-256 token hashes are persisted, so no separate session
signing secret is required.

Acceptance criteria: a valid allow-listed Workspace account receives a revocable
Folio session; wrong issuer, audience, hosted domain, subject binding, state, nonce,
PKCE verifier, expiry, or inactive user is rejected without identity leakage; callback
attempts cannot be replayed; login redirects only to validated same-origin paths; and
logout revokes the server record and clears the browser cookie.

Role: identity implementation owner with independent protocol and security review.
Dependencies: BILL-T03 and production HTTPS/reverse-proxy configuration.

Verification gates: 25 test files and 149 tests; TypeScript, ESLint, Prettier, and
production build; and independent protocol verification passed. Live Google identity,
PostgreSQL, and reverse-proxy verification remains pending under BILL-T07 and
BILL-T10.

Blockers: the reverse-proxy deployment, PostgreSQL, Google clients, and secret-injection
mechanism must be verified operationally before public exposure. Traefik is the likely
proxy but is not selected as an application dependency.

### BILL-T09 — Allow-list authorization and audit history

Status: in progress on 20 September 2026. BILL-T09A is complete; BILL-T09B retains
append-only audit history. Public exposure remains blocked until BILL-T09B, BILL-T10,
and live verification pass.

Goal: replace browser-supplied actor attribution with authorization derived from the
authenticated Folio session and retain trustworthy mutation history.

#### BILL-T09A — Session-derived actor attribution and named permissions

Status: complete on 20 September 2026.

Scope: every protected server operation reads the session cookie, resolves the
current active user, checks its declared named permissions, and passes that user's
ID as the trusted actor ID to repository and document operations. Email is a
matching and display-only attribute; the explicit transaction owner remains a
separate responsibility field. Browser actor input and actor state are removed.
The maintenance upload-recovery CLI is the sole explicit actor-email exception:
confirmed recovery requires `--actor-email` and uses it only to validate an active
actor before exact pending-upload recovery. No database migration was required.

Permission identifiers cover workspace and transaction reads/writes, artifact
upload/download, Stripe import, report read/export, user administration, audit
access, and session administration. Members receive the ordinary workspace,
transaction, artifact, import, report, download, and export permissions;
administrators receive those permissions plus user, audit, and session
administration; viewers receive no permissions.

Verification passed: 26 test files and 170 tests, TypeScript, ESLint, Prettier,
production build, and independent verification. This records code and test
verification only; it does not claim live deployment verification.

Scope: preserve explicit user provisioning and active-state control; bind a previously
unbound active user to a matching verified Google identity transactionally without
auto-provisioning unknown accounts; and retain the completed T09A permission policy
while appending immutable audit events for authentication, user administration,
transaction mutation, artifact lifecycle, download, import, and export operations
under T09B. The existing viewer database value maps to no permissions.

Constraints: email is a matching and display attribute, not the durable identity key;
Google `sub` is durable. Permission identifiers and role bundles are application-defined
and reviewed in code; do not add runtime-editable policy machinery without a concrete
need. Do not authorize from client state, role-name conditionals in use cases,
`user_metadata`, display names, email suffix alone, or unverified proxy headers. Audit
events must exclude tokens, secrets, presigned URLs, document contents, and unsafe
provider errors.

Acceptance criteria: unknown or inactive users cannot create sessions; a Google subject
cannot silently rebind to another Folio user; every protected read and mutation uses
the authenticated actor and checks its required named permission; members receive the
ordinary workspace, transaction, artifact, report, import, download, and export actions;
administrators receive those actions plus user, audit, and session administration;
unsupported viewers receive no permissions; changing a role changes its effective
permission bundle predictably; deactivation revokes access; and security-relevant and
domain mutations produce attributable append-only events under T09B.

Role: authorization and persistence implementation owner with independent access-
control and audit-integrity review. Dependencies: BILL-T08 and BILL-T14.

Verification gates: provisioning, binding race, duplicate subject, inactive user,
permission catalogue, role-bundle, per-operation denial, privilege-escalation,
unsupported-viewer, deactivation, audit completeness, redaction, concurrency, and
migration tests; direct server-operation authorization tests; TypeScript, ESLint,
Prettier, and production build.

Blockers: the initial administrator and allow-listed users must be provisioned through
an operator-controlled process before enforcement is enabled.

### BILL-T10 — Authenticated deployment verification

Status: planned.

Goal: demonstrate that the public HTTPS deployment rejects unauthenticated and
unauthorised access across routes, operations, documents, and failure paths.

Scope: verify login, callback, logout, session rotation, absolute expiry, revocation,
CSRF protection, same-origin redirects, route protection, server-operation protection,
presigned artifact access, and audit attribution behind the selected reverse proxy.
For the likely Traefik deployment, verify canonical HTTPS redirects, forwarded-header
trust boundaries, request-size limits, and security headers without trusting arbitrary
client-supplied forwarding headers.

Constraints: production uses a host-only `__Host-folio_session` cookie with `Secure`,
`HttpOnly`, `SameSite=Lax`, and `Path=/`; plain-HTTP local development uses a distinct
development-only cookie configuration. Do not enable broad CORS. HSTS is enabled only
after canonical HTTPS operation is confirmed.

Acceptance criteria: unauthenticated requests cannot read workspace or artifact data;
every operation enforces its declared permission and the administrator, member, and
unsupported-viewer bundles behave as approved; CSRF and forged forwarding-header
attempts fail; expired, revoked, duplicated, and logged-out sessions fail closed; and
production logs and audit events remain useful without exposing authentication material
or personal data unnecessarily.

Role: independent security and deployment verifier. Dependencies: BILL-T08, BILL-T09,
and the public reverse-proxy deployment. Parallel boundary: static protocol and role
tests may proceed before deployment; live callback, cookie, proxy, and TLS gates cannot.

Verification gates: browser login/logout and multi-tab tests; direct unauthenticated
HTTP probes; CSRF, open-redirect, replay, cookie, cache, forwarding-header, role, and
artifact-access tests; session expiry and revocation; audit reconciliation; and the
applicable BILL-T07 backup, recovery, and private-data controls.

## BILL-M3 — Operational visibility

Status: BILL-T19 through BILL-T23 are code-complete; BILL-T25 is planned. Live
browser and provider verification remain part of BILL-T07.

Goal: make existing records easier to inspect and interpret without expanding Folio
into an accounting system or introducing new persistence concepts.

### BILL-T19 — Transaction-backed artifact table

Status: code-complete on 19 September 2026; operational verification pending.

Goal: provide a separate table for browsing artifacts already linked to transactions.

Scope: derive one artifact row per distinct transaction attachment; show its filename,
kind, source, linked transaction context, and download action. Do not add a standalone
artifact-management model, inline document rendering, content indexing, or mutation
controls.

Acceptance criteria: an operator can locate and download every artifact represented
by the loaded transaction records; repeated Stripe-import attachments appear once;
and artifact identifiers are not presented as the primary human-readable label.

Role: implementation owner with independent UI and access-control verification.
Dependencies: BILL-T04 and BILL-T05. Parallel boundary: may proceed independently
of BILL-T20, but should coordinate shared table patterns with BILL-T21.

Verification gates: synthetic manual and Stripe attachments; deduplication tests;
authorised download tests; empty-state, keyboard, responsive-layout, TypeScript,
ESLint, Prettier, and production-build checks.

### BILL-T20 — Balance-activity chart

Status: code-complete on 19 September 2026; operational verification pending.

Goal: visualise periodic balance activity as inflows, outflows, and net movement.

Scope: chart a dedicated deterministic balance series for the selected period and
basis while keeping tax-preparation effects separate. This is activity over time,
not a running bank or Stripe balance; it does not introduce opening balances or
reconciliation claims.

Acceptance criteria: chart values agree exactly with its accessible data table;
period and basis controls remain consistent with the tabular summaries; excluded or
unresolved transactions retain visible warnings; and the chart has an accessible
non-visual representation.

Role: implementation owner with independent report and accessibility verification.
Dependencies: BILL-T06 and BILL-T22. Parallel boundary: independent of BILL-T19
apart from shared page composition.

Verification gates: deterministic chart-series unit tests across month, BAS-quarter,
and financial-year periods; zero, negative, and mixed activity; accessible labels;
responsive rendering; TypeScript, ESLint, Prettier, and production-build checks.

### BILL-T21 — Task-oriented transaction table

Status: code-complete on 19 September 2026; operational verification pending.

Goal: make the transaction list useful for routine review and follow-up.

Scope: prioritise date, counterparty, description, type, source-aware amount,
workflow and settlement state, evidence state, and actions. Add sorting and
filters for period, source, type, status, settlement, and evidence. Move secondary
metadata out of the primary scan path and bound the number of loaded or rendered
rows.

Acceptance criteria: manual and Stripe rows show a meaningful date and amount;
operators can isolate common review queues; sorting and filtering are deterministic;
evidence and settlement gaps are apparent without opening a row; and edit, download,
and void behaviour remains unchanged.

Role: implementation owner with independent interaction and regression verification.
Dependencies: BILL-T05 and BILL-T22. Parallel boundary: data-query work may proceed
independently of BILL-T19 and BILL-T20; shared table presentation should be
coordinated with BILL-T19.

Verification gates: synthetic mixed-source datasets; filter and sort tests; bounded
loading behaviour; empty and no-match states; keyboard and responsive-table checks;
TypeScript, ESLint, Prettier, and production-build checks.

### BILL-T22 — Stripe transaction semantics

Status: code-complete on 19 September 2026; operational verification pending.

Goal: preserve Stripe balance meaning while making imported rows predictable and
reviewable.

Scope: replace substring category classification with an explicit mapping and a
visible review fallback; use Stripe net values for balance movement independently
of tax-preparation effects; display Stripe as a source fallback rather than a stored
economic counterparty; retain imported descriptions and expose gross and fee as
secondary detail. Define safe handling for duplicate and conflicting balance
transaction identifiers.

Acceptance criteria: every supported reporting category has a deterministic tested
classification; unknown categories import without acquiring an unjustified tax
classification and remain visibly reviewable; balance activity includes every
recorded Stripe row exactly once using its source net value; and reimports distinguish
identical existing rows from conflicting data.

Role: implementation owner with independent domain and financial-regression
verification. Dependencies: BILL-T17. Parallel boundary: domain mapping can proceed
independently of table presentation, but BILL-T20 and BILL-T21 must consume its
published display and balance semantics.

Verification gates: category-table tests; unknown-category and conflict tests;
positive, negative, fee, refund, dispute, payout, transfer, and adjustment fixtures;
exact net-movement totals; TypeScript, ESLint, Prettier, and production-build checks.

### BILL-T23 — Review interaction refinement

Status: code-complete on 19 September 2026; populated-browser verification pending.

Goal: improve transaction-review legibility and reduce interaction friction observed
in the populated M3 interface.

Scope: replace the fixed filter grid with composable field/operator/value clauses;
move sorting to table headers; replace the separate custom-value select workflow with
an accessible free-text suggestion combobox; display source-aware signed and
colour-coded amounts; use compact vertical or tooltip-labelled actions; add copy
actions for transaction references and artifact identifiers; shorten visible download
labels; and normalise validated Stripe CSV filenames to
`Stripe-<created-from>-<created-to>.csv` in the configured reporting timezone.

Acceptance criteria: filters do not overlap at supported widths; multiple clauses
compose deterministically with AND; sorting is visible and keyboard operable; new and
existing counterparties use one control; expense and fee signs agree; copy actions
provide success or failure feedback; tables avoid horizontal overflow at desktop
widths and reflow legibly on narrow screens; and Stripe artifact names use the
validated imported activity range.

Role: implementation owner with independent interaction, accessibility, and
regression verification. Dependencies: BILL-T19, BILL-T21, and BILL-T22. Parallel
boundary: Stripe filename normalisation may proceed independently of the UI changes.

Verification gates: pure filter/operator/sort tests; combobox keyboard and free-text
tests; signed-amount fixtures; clipboard failure handling; responsive browser review;
Stripe range/timezone tests; TypeScript, ESLint, Prettier, and production-build checks.

Constraints: reuse existing transaction and report semantics; do not expose document
contents, presigned URLs, or sensitive metadata in logs; do not claim that net
movement is an account balance; and do not add artifact mutation or deletion.

### BILL-T25 — At-a-glance activity dashboard

Status: planned.

Goal: expose lifetime movement and the balance-activity chart without requiring an
operator to discover and run preparation-report actions.

Scope: place an always-visible lifetime activity summary and automatically loaded
default-period activity chart above the transaction table. Show lifetime inflows,
outflows, net movement, covered date range, included transaction count, and unresolved
or adjustment count. Keep table search and filters independent from lifetime totals;
retain detailed tax-preparation summaries and CSV exports in their existing section.

Constraints: include recorded, non-void movement using the existing deterministic
balance-series semantics; exclude drafts and void transactions; include transfers
until account-aware matching exists; label all results as activity or net movement,
not account balance. Do not introduce opening balances, account ledgers, transfer
matching, or reconciliation claims.

Acceptance criteria: opening a workspace loads the lifetime summary and default-period
chart without an extra action; both appear above the transaction table; lifetime
values remain unchanged when table search, filters, sorting, or pagination changes;
the covered date range and unresolved count are explicit; zero-data, loading, error,
and partial-warning states remain visible; and chart values agree with its accessible
exact-value table.

Role: implementation owner with independent report, accessibility, and populated-UI
verification.

Dependencies: BILL-T20, BILL-T21, and BILL-T22.

Verification gates: lifetime fixtures spanning multiple financial years; recorded,
draft, void, transfer, and adjustment cases; independence from transaction-table
controls; automatic-loading and stale-response tests; keyboard and responsive-browser
checks; TypeScript, ESLint, Prettier, and production build.

Blockers: none known. Transfer totals may overstate economic activity if both sides of
an internal transfer are later recorded; resolving that requires an account-aware
model outside this task.

Parallel boundary: lifetime aggregation and automatic report loading may proceed
separately from page composition after their response contract is fixed.

Milestone acceptance: operators can scan transactions, browse their distinct linked
artifacts, and interpret period movement without cross-checking opaque identifiers or
manually translating the textual preparation summaries.

## BILL-M4 — Guided transaction capture

Status: BILL-T27 and BILL-T29 complete on 20 September 2026; remaining capture
tasks are planned.

Goal: reduce repeated data entry while preserving explicit operator review and the
distinction between source evidence and accounting classification.

### BILL-T29 — Managed manual-entry form and accessible field controls

Status: complete on 20 September 2026.

Layout follow-up BILL-T29A was completed on 20 September 2026. It adds a consistent
12-column desktop grid, six-column compact layout, single-column mobile layout, and
intentional field spans for the manual transaction form. Artifact selection and all
persistence behaviour are excluded. Focused tests, TypeScript, ESLint, Prettier, and
the production build passed; visual browser verification remains outstanding because
no browser runtime was available.

Follow-up BILL-T29B was completed on 20 September 2026. It reorders the primary
manual-entry fields for capture priority, keeps the owner control under Advanced,
defaults new manual transactions to the authenticated actor, and prohibits ownerless
manual saves. Stripe-import ownership is unchanged. Verification passed with 28 test
files and 197 tests, TypeScript, ESLint, Prettier, and the production build; populated
browser verification remains outstanding.

Follow-up BILL-T29C is code-complete on 20 September 2026. It fixes
selection-control click interception by scoping blur validation to the active field,
suppressing empty combobox overlays, and making exiting overlays non-interactive. It
also requests the verified OIDC profile name and backfills only null or blank stored
display names during login without changing email identity matching. Verification
passed with 28 files and 202 tests, TypeScript, ESLint, Prettier, and the production
build. User browser confirmation of the original pointer defect remains required.

Follow-up BILL-T29D was completed on 20 September 2026 after browser verification
showed that deferred blur handling suppressed pointer-driven field and save-action
validation. The correction retains field-scoped blur validation and removes the
deferred event boundary, with combined pointer regression coverage. Verification
passed with 28 files and 206 tests, TypeScript, ESLint, Prettier, and the production
build; user browser confirmation remains required.

Follow-up BILL-T29E is code-complete on 20 September 2026. It replaces the unsuccessful
event-timing workarounds with the documented TanStack Form field-validator and native
form-submission lifecycle, and adds the official TanStack Form Devtools in development
only. Existing domain validation and explicit save actions remain authoritative.
Verification passed with 28 files and 207 tests, TypeScript, ESLint, Prettier, and the
production build. The Devtools UI is excluded from production; Form core's own
devtools event client remains part of `@tanstack/form-core`. User browser confirmation
of blur and native-submit validation remains required.

Follow-up BILL-T29F was completed on 21 September 2026 after Devtools confirmed that
the browser field reached touched and blurred state but the generated validator
registry produced no error. It replaces that registry with explicit documented
per-field validators and adds hydration-aware regression coverage. Verification
passed with 28 files and 209 tests, TypeScript, ESLint, Prettier, and the production
build; user browser confirmation remains required.

Follow-up BILL-T29G diagnosed the failure on 21 September 2026. A clean
development-process restart still produced no `onBlur` error entry, so a
development-only, non-PII trace established that TanStack invoked the Amount validator
but the whole-transaction helper returned `undefined`. The trace was removed by
BILL-T29H.

Follow-up BILL-T29H was completed on 21 September 2026. The browser trace proved
TanStack invoked the Amount validator but the whole-transaction field helper returned
`undefined`. Field blur validation now uses direct editing-value schemas, while
cross-field and accounting validation remain form-submit concerns; the temporary trace
was removed. Verification passed with 28 files and 215 tests, TypeScript, ESLint,
Prettier, and the production build; user browser confirmation remains required.

Follow-up BILL-T29I is code-complete on 22 September 2026. Validation errors receive
a dedicated row below each control, and the primary manual form is reordered as Kind,
Supplier, Reference, Date followed by Amount, Currency, and a Description field
spanning the remaining half-row. Pointer and keyboard supplier selection, free-text
entry, and the concise amount error are preserved. The focused 19 tests and full
28-file, 215-test suite pass, as do TypeScript, ESLint, and Prettier. Final completion
is blocked by an independently discovered TanStack package-version mismatch in the
production build: router-devtools-core 1.168.2 imports `getRouteSegments` from
router-core 1.171.15, which does not export it. Resolving dependency alignment is a
separate change requiring confirmation.

Follow-up BILL-T29J was completed on 22 September 2026. Every primary manual-entry
field wrapper and control now fills its assigned grid columns without changing the
approved field order, spans, responsive reflow, or form behaviour. Verification passed
with 19 focused tests, TypeScript, ESLint, and Prettier; populated-browser visual
confirmation remains outstanding.

Goal: make manual transaction entry and correction explicit, accessible, and
diagnosable without relying on generic browser constraint messages or scattered local
state.

Scope: migrate only the manual transaction form to pinned TanStack Form 1.33.5 with
the existing Zod domain contract; add reusable Folio-styled text, exact-decimal money,
closed select, creatable combobox, error-summary, and submit-action controls using
React Aria Components 1.21.1 where interaction semantics are non-trivial; preserve
raw editing strings and trim/normalise only when building the submitted transaction;
show field-specific errors on blur and failed submission; focus the first invalid
field; keep validation actions clickable; and support explicit `save_void`,
`restore_draft`, and `restore_recorded` actions. Native date and file inputs remain
in use. Return safe, structured server validation issues to the corresponding
fields. Search, filters, user administration, and Stripe upload forms are unchanged.

The `saveManualTransaction` operation authenticates and authorizes before strongly
parsing the payload. Invalid envelopes and fields return safe form/field issues;
successful persistence returns the existing saved discriminator and transaction.
Generic provider failures remain on the existing generic diagnostic path.

Constraints: money remains an exact decimal string and must not pass through binary
floating-point state; server validation remains authoritative; retain the existing
visual language; do not migrate search, filters, user administration, or Stripe upload
forms; editing a void transaction must not restore it implicitly; and no database
migration is required.

Acceptance criteria: values such as `35.1` and surrounding whitespace submit as the
canonical accepted decimal while malformed or over-precision amounts receive specific
inline guidance; creatable supplier, funding-source, category, and currency controls
support keyboard selection and arbitrary text; failed submission presents an error
summary and focuses the first invalid control; submit actions remain operable for
validation; void transactions can save changes without changing state or explicitly
restore to draft or recorded; and safe server issues map back to fields without raw
provider details.

Role: form implementation owner with independent accessibility, workflow, and
regression verification.

Dependencies: BILL-T09A, BILL-T16, BILL-T27, and the existing transaction schema.

Verification passed: 28 test files and 193 tests; TypeScript typecheck; ESLint;
Prettier formatting; production build; and independent verification. The build
reported 698.85 kB raw and 210.08 kB gzip for the bundle; no prior bundle-size
baseline is available. Live/populated-browser verification remains outstanding.

Residual project blockers are unchanged: append-only audit history (BILL-T09B),
authenticated deployment verification (BILL-T10), and the operational gates under
BILL-T07 still block public exposure.

### BILL-T27 — Multi-word suggestion input editing

Status: complete on 20 September 2026.

Goal: allow operators to type spaces in funding-source and other free-text suggestion
fields without changing their stored-value normalisation.

Scope: preserve the raw custom value while the shared suggestion control is being
edited, and trim only when resolving the submitted value.

Constraints: apply consistently to every use of the shared control; do not change
database validation or canonical submission semantics.

Acceptance criteria: an intermediate trailing space remains visible while typing a
multi-word value such as `Director loan`, and the submitted value remains trimmed.

Verification gates: focused regression tests, full unit suite, TypeScript, ESLint,
Prettier, and production build.

Verification passed: 26 test files and 172 tests, TypeScript, ESLint, Prettier,
production build, and independent verification.

Residual risk: the browser-mounted component test remains an operational/manual
confidence gap.

### BILL-T28 — Bank transaction-history CSV review and import

Status: implementation, backend acceptance, and focused populated-browser workflow
passed on 23 September 2026; browser upload/preview and assistive-technology review
remain open. Approved implementation architecture is in
[`docs/banking-plan.md`](./banking-plan.md).

Goal: import a fixed CommBank transaction-history CSV as immutable bank activity and
reconcile it to Folio transactions without duplicating accounting records or treating
every bank movement as a deductible expense.

Confirmed source profile: the account currency is AUD; the file has no header and
always contains exactly four columns in this order: posted date (`dd/MM/yyyy`), signed
AUD movement, source description, and running account balance. The export contains no
pending transactions. Additional banks or layouts require explicit profiles and
fixtures rather than heuristic parsing.

Bank activity is evidence of cash movement, not a Folio transaction. Unmatched bank
activity does not affect Folio balances, transaction reports, income, expenses, GST,
or tax-preparation summaries. A match links existing records without silently
rewriting the transaction. The original CSV is payment evidence, not an invoice or
proof of GST entitlement or deductibility.

#### BILL-T28A — Fixed-profile parse and preview

Status: complete on 23 September 2026; independently verified.

Scope: upload and retain the original CSV as a source artifact; parse every row using
exact decimal and calendar-date rules; preserve row number and all original source
values; preview all rows before any database commit; and extract optional value date,
foreign-currency amount, cleaned counterparty suggestion, and restricted card-suffix
metadata when the description supports it. Extracted description fields are hints,
not authoritative accounting facts.

Acceptance criteria: positive movements preview as inflows and negative movements as
outflows; quoted values and commas inside descriptions parse correctly; malformed
rows identify their row and field and block confirmation; source signs and running
balances remain unchanged; cancellation writes no bank transactions and abandons any
pending artifact; and the preview does not silently omit valid rows.

#### BILL-T28B — Immutable bank-activity persistence

Status: complete on 23 September 2026; independently verified.

Scope: treat the CSV source artifact as the import identity and atomically create one
immutable bank transaction per valid source row plus its
`bank_transaction_artifacts` attribution. Store posted date, signed AUD amount, source
description, non-authoritative source metadata, current actor/time, optional
classification, and optional matched transaction. Reject the same profile/checksum as
a new import. For a different file, compare its earliest/latest posted dates with
existing imports and show every overlapping interval before allowing explicit
continuation.

Review state is derived: no match or classification is unresolved; a linked
transaction is matched; otherwise classification is `private`, `transfer`, or
`duplicate`. Classifications require no reason or target in version one. Classified
rows remain visible and do not affect Folio accounting or tax totals.

Acceptance criteria: confirmation reparses the pinned object and atomically persists
all rows, attributions, and artifact availability; source values cannot be edited;
generic confirmation/recovery rejects bank profiles; profile-aware recovery is
retryable; a profile/checksum uniqueness constraint rejects exact duplicate files;
date-range overlap warnings identify the existing artifact and overlap start/end dates
but may be acknowledged; and imported activity alone changes no existing report total.

#### BILL-T28C — Reconciliation workspace

Status: code-complete on 23 September 2026; independent review, live PostgreSQL
concurrency verification, and focused populated-browser workflow passed.

Scope: list bank activity by source artifact and derived review state; suggest compatible existing
transactions using exact AUD settlement amount, cash direction, posted/value-date
proximity, normalised counterparty, reference text, and current reconciliation state;
and allow explicit match, unmatch, private, transfer, duplicate, or unresolved actions.

Constraints: suggestions never confirm themselves. Confirmed reconciliation requires
an identical AUD settlement amount. Date or text similarity may rank candidates but
cannot override an amount mismatch. Initially, one bank row may match at most one
Folio transaction and one Folio transaction may match at most one bank row. Split,
aggregate, and tolerance-based reconciliation are deferred until demonstrated cases
justify a many-to-many model.

Acceptance criteria: matched records remain distinct and traceable; already-matched
transactions are excluded from ordinary suggestions; matching and unmatching are
explicit; foreign document amounts are compared only as supporting hints while the
AUD settlement amount controls eligibility; and an import is `reviewed` only when no
rows remain unresolved. Reviewed does not mean deductible or invoice-supported.

Integrity constraints: `matched_transaction_id` references a Folio transaction and is
unique when non-null. Match, unmatch, edit, and create-and-match operations lock the
bank row before the Folio transaction. Repository eligibility checks and a database
trigger prevent matched financial identity from changing until explicit unmatch.

#### BILL-T28D — Create a transaction from bank activity

Status: code-complete on 23 September 2026; independent review, live PostgreSQL
rollback/concurrency verification, and focused create-and-match browser workflow passed.

Scope: open the managed manual form from an unresolved bank row with suggested kind,
cleaned counterparty, absolute amount, AUD currency, posted date, and source payment
details. The operator reviews all accounting fields. Link the new transaction only
after a successful save.

Constraints: do not infer GST entitlement, deductibility, owner funding, private use,
or transfer semantics. Creating a transaction does not turn the CSV into invoice
evidence and does not bypass the existing evidence rules.

Acceptance criteria: cancellation leaves the bank row unresolved; validation failures
preserve the draft without linking it; successful creation produces one transaction
and one reconciliation; retry cannot duplicate either record; and the linked source
facts remain unchanged.

#### BILL-T28E — Reconciliation status and completion

Status: code-complete on 23 September 2026. Import history, immutable activity,
derived-state counts, bounded activity views, and reconciliation mutations are
implemented.

Scope: show counts for unresolved, matched, private, transfer, and duplicate activity;
derive source-artifact progress; and keep unresolved activity visible until an
operator acts on it.

Dependencies: BILL-T04, BILL-T09A, BILL-T13, BILL-T14, BILL-T21, BILL-T22, BILL-T24,
and BILL-T29.

Role: bank-import and reconciliation implementation owner with independent financial
semantics, idempotency, authorization, and workflow verification.

Verification gates: fixed headerless fixtures; exact decimal, sign, `dd/MM/yyyy`,
quoted-description, running-balance, value-date, and foreign-amount parsing; malformed
rows; preview cancellation; atomic confirmation; file idempotency; overlap warnings;
immutable
source facts; exact settlement matching; candidate ordering; already-reconciled
exclusion; match and unmatch; create-from-row failure and retry; private/transfer/
duplicate exclusion from accounting and tax totals; artifact linkage; named-action
authorization; Docker-backed PostgreSQL constraint/concurrency tests; Docker-backed
S3-compatible confirmation/recovery tests; TypeScript; ESLint; Prettier; production
build; and focused populated-browser verification. Only synthetic financial data is
used in automated tests. Accountant review remains required for entity-specific
classifications.

Parallel boundaries: parser fixtures and canonical row projection may proceed before
persistence; reconciliation candidate ranking may proceed after the bank-activity and
transaction interfaces are fixed; page composition follows the command/query contract.

Implementation result through BILL-T28A/B and the import/activity portion of T28E: 35
test files and 247 tests, TypeScript, ESLint, Prettier, and production build passed.
Docker PostgreSQL and versioned MinIO verification covered fresh/legacy migrations,
atomicity, rollback, duplicate races, overlap acknowledgement, bounded queries, pinned
object confirmation, and overwrite rejection. Independent review required three
iterations to close pending-artifact cleanup and exact-decimal presentation defects.
Mounted-browser responsive and screen-reader verification remains pending.

Implementation result for BILL-T28C/D and the remaining T28E scope: migration 0007,
the shared exact signed-AUD cash projection, ranked candidate lookup, explicit
match/classify/reset commands, atomic create-and-match, reconciliation counts, and a
paginated reconciliation workspace are implemented. The full single-worker suite
passes with 37 test files and 272 tests, together with TypeScript, ESLint, and
Prettier. Independent review found and closed a concurrent evidence-supersession race
by locking invoice artifacts in deterministic order before validation and linkage.
The build failure was an incompatible TanStack Router/core dependency pair; aligned
versions now pass the production Vite/Nitro build and TypeScript. The disposable Docker
PostgreSQL suite passes five real-database tests covering migration 0007, exact cash
matching, reset and matched-field protection, rollback/retry, concurrent matches, and
invoice-evidence supersession. Ordinary tests pass with Docker stopped; the database
suite runs through a separate documented command. Standalone Playwright in a disposable
synthetic environment exposed and then verified fixes for a Router Devtools/Core API
mismatch and a PostgreSQL date shifted back one day by timezone conversion. The
focused Chrome workflow passed import-history rendering; explicit match, reset,
private classification, and reset; create-form amount validation and cancellation;
recorded create-and-match; and a 390 px viewport without horizontal overflow or
uncaught page exceptions. A later local-Compose Playwright run passed synthetic CSV
upload, preview, and cancellation through the same-origin MinIO proxy. Browser
overlap/confirm, screen-reader review, and the broader approved UI restructuring
remain open. The reconciliation page is functional
but not yet visually aligned with the version-four mockups.

### BILL-T30 — CommBank PDF statement ingestion

Status: deferred after BILL-T28. On 1 October 2026 the operator prioritized supplier
invoice parsing (BILL-T77) instead. This statement-ingestion task retains its ID
and scope but is not a current parallel implementation candidate.

Goal: project a supported text-based CommBank PDF statement into the same canonical
bank-activity preview and reconciliation pipeline as the CSV importer.

Scope: support one explicitly versioned CommBank statement layout; retain the original
PDF as the source artifact; extract its transaction rows; preview every row; and reuse
BILL-T28 persistence, idempotency, and reconciliation semantics. Multiple extracted
rows link to the same PDF artifact.

Constraints: no OCR, scanned-document support, arbitrary-PDF heuristics, or silent
fallback. An unsupported or structurally ambiguous PDF is rejected before commit.

Acceptance criteria: the supported fixture projects the same canonical fields as CSV;
all extracted rows are visible before confirmation; cancellation writes nothing;
confirmation is atomic and idempotent; and unsupported layouts return an actionable
validation error without partial ingestion.

Dependencies: BILL-T28A through BILL-T28E and BILL-T24.

Verification gates: synthetic text-PDF fixtures, layout-version detection, page and
row boundaries, exact decimals and dates, malformed/ambiguous statements, preview
cancellation, artifact linkage, atomic commit, idempotency, reconciliation reuse,
TypeScript, ESLint, Prettier, production build, and populated-browser verification.

### BILL-T31 — Self-contained local Compose deployment

Status: implemented and smoke-tested on 23 September 2026. This is a local-only
development deployment, not a production security or backup acceptance gate.

Goal: start a usable synthetic Folio environment with one Compose command and no
external PostgreSQL, object store, or Google OAuth dependency.

Scope: compose Folio, PostgreSQL, a versioned MinIO bucket and initializer, a
one-shot migration/synthetic-admin seed, and a loopback-bound proxy. A fixed local
password issues ordinary hashed, expiring server sessions and retains action-based
permissions. Separate internal and browser-visible S3 clients preserve same-origin
presigned uploads and downloads. Google OIDC remains the production identity path.

Constraints: hard-coded credentials are synthetic and must not be exposed publicly.
Local password mode is rejected in production. MinIO and PostgreSQL have no published
host ports; only the proxy publishes a configurable loopback port. Local data is not
backed up by Compose.

Acceptance criteria: clean Compose startup applies migrations, seeds the local
administrator idempotently, initializes bucket versioning, and serves the app; an
invalid password fails, a valid password creates a normal session, and browser CSV
upload/preview/cancel works. A signed object can be uploaded twice and the first
version downloaded by its version ID through the proxy.

Role: local deployment implementation with independent read-only security/proxy
review. Dependencies: BILL-T08, BILL-T09A, BILL-T24, and BILL-T28A/B.

Verification passed: 37 ordinary test files/284 tests, TypeScript, ESLint,
Prettier, production build, Docker image build and isolated Compose startup on
port 43231, health and local-login HTTP checks, signed two-version PUT and pinned
GET through the proxy, and Playwright CSV upload/preview/cancel without page errors.
Production deployment, backup/restore, and broader BILL-T28 acceptance remain open.

### BILL-T24 — Reusable PDF evidence

Status: complete on 23 September 2026; independently verified prerequisite for
BILL-T28.

Goal: represent supporting evidence through an explicit `transaction_artifacts`
relationship so one artifact can support multiple transactions and one transaction can
retain multiple supporting artifacts.

Scope: remove the direct one-manual-transaction-per-PDF restriction; add the typed
through table with foreign keys, composite uniqueness, immutable relationship identity,
and optional metadata; let an operator select an existing available PDF while creating
or editing a transaction; and show every linked transaction in artifact context.

Constraints: artifact metadata describes the file and never embeds transaction IDs.
Relationship metadata may contain a page, line, or section locator but is not required
or interpreted by the database. Do not add PDF parsing, OCR, inferred transactions,
statement-specific behaviour, or automatic GST classification. Reusing a PDF does not
make it sufficient evidence for every linked transaction or tax treatment.

Acceptance criteria: an available PDF can be linked to two or more manual transactions
without duplication; a transaction can retain more than one supporting artifact;
optional locators remain relationship data; artifact browsing reports the correct
distinct transaction count and contexts; replacing or unlinking evidence on one
transaction does not make a shared artifact unavailable; and claimable-GST validation
remains transaction-specific.

Role: implementation owner with independent schema, workflow, and regression
verification.

Dependencies: BILL-T04, BILL-T05, and BILL-T19.

Verification gates: migration and Docker-backed PostgreSQL tests for many-to-many
linkage, foreign keys, uniqueness, and shared lifecycle; create, edit, unlink, and
replacement tests; claimable and non-claimable GST fixtures sharing one PDF; artifact
count and context tests; TypeScript; ESLint; Prettier; production build; and focused
populated-browser verification.

Verification result: 30 test files and 226 tests, TypeScript, ESLint, Prettier, and
production build passed. Docker PostgreSQL verification covered fresh and legacy
migration, FKs, composite identity, claimable-evidence invariants, concurrent removal,
shared-artifact availability, profile-compatible supersession, and multi-artifact
projection. Independent verification passed on its third review after closing two
rounds of integrity defects. Populated-browser runtime verification remains pending.

Parallel boundary: schema and repository lifecycle work may proceed separately from
the existing-artifact selector after their interface is fixed. PDF parsing remains
separate future work.
