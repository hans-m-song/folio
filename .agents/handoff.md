# Handoff

## Disposable verification and feature commits complete — 2026-10-03

- The operator accepted BILL-T85 visuals, approved disposable PostgreSQL checks,
  and authorized a commit. Future implementation work must be committed after
  successful verification. All verified application changes are approved; feature
  commits share dependencies, and verification covers the final combined tree.
- BILL-T86 uses a new container folio-bill-t86-postgres-20261003 and synthetic
  folio_test / folio_t28_verify only. All 18 migrations applied successfully.
- A tester owns new feature-verification.postgres.test.ts; main owns gates/docs.
  Check recurrence links/reset, repayment enforcement and reconciliation ordering.
- Both PostgreSQL integration files pass sequentially: 16 tests, including eight
  new cases for recurrence links/reset, repayment enforcement and queue traversal.
  The disposable container and synthetic volume were removed after verification.
- Full synthetic suite
  passes 1,086 tests, one skipped; build/TypeScript and source lint pass. Changed
  files pass formatting; unchanged document reconciliation/storage tests retain
  their pre-existing formatting warnings. Post-test TypeScript and new-file lint
  pass. Independent source audit confirms shared dependency closure.
- Feature commits: b273be1 (UI), 8010974 (reports), 8c63be2 (invoices),
  8ab15b3 (recurrence), 69d6bbf (MCP), 62fc5e2 (transaction integration).
  This documentation checkpoint records the verified scope and commit policy.
- Next: operator invoice extraction review, then separately authorized storage
  compatibility/unversioned transition work. No live migrations or deployment.
- Exclude docker-compose.yml and local .codex/.agents/skills configuration from
  staging or content reads absent separate permission. No live records/storage.

## Recurrence presentation and estimates code-complete — 2026-10-02

- BILL-T85 approved: description-priority widths, readable calendar dates, styled source
  links, unresolved reminders plus next Upcoming only, and historical min/max/average.
- Domain worker owns statistics and bounded missing-history pages; UI worker owns
  layout, date/link formatting, derived amount display and Show more missing.
  Main owns optional workspace offset plumbing, server tests and durable docs.
- Amounts use unambiguous on-cadence recorded history in document currency, without
  changing financial rows or relying on the manual estimate. Preserve persisted
  expectedAmount for compatibility; remove it from the user-facing estimate editor.
- Synthetic verification only; no actual records, secrets, migrations or browser/E2E.
- Backend/domain gates pass: 45 domain tests and 32 main-owned server/repository
  tests. Independent backend review passes; the repository regression verifies
  pre-anchor history contributes to estimates without activating past reminders.
- UI closure passes all 21 route tests. The terminal page cursor is authoritative,
  retry naming matches the visible action, and disclosure checks use expanded
  details. Same-revision workspace refresh clears cached pages and stale requests.
- Independent focused verification passes 98 tests and source audit finds no remaining
  scope issue. Full synthetic suite passes 1,086 tests, one skipped across 101 files;
  Narrow test-fixture inference was corrected with explicit domain-interface and DOM
  query types, without suppression casts. TypeScript and 21 UI tests now pass;
  final full suite passes 1,086 tests (one skipped), and sequential production
  build/TypeScript passes. Scoped lint/format pass.
- Visual review accepted on 3 October 2026. Next: disposable PostgreSQL checks and
  a verified commit under BILL-T86. Main worktree only.

## Recurring preview correction code-complete — 2026-10-02

- BILL-T84 is approved: backward historical preview only, standard creatable
  counterparty suggestions, and styled transaction recurring action. Reminder
  generation and matching still start at the chosen anchor date.
- Domain worker owns cadence helpers/tests; UI worker owns recurring workspace,
  editor and transaction actions/tests/styles. Main owns documentation and gates.
- Synthetic tests/build only; no live records, migrations or browser/E2E execution.
- Final full suite passes 1,071 tests, one skipped across 101 files. Independent
  focused verification passes 81 tests; post-closure domain verification passes 39.
  Lint, format and TypeScript passed; final sequential production build passed.
- Preview permits backward calendar indices; active reminder dates remain anchored.
  Pre-anchor stale linked dates are omitted defensively, while post-anchor stale
  associations remain visible for review/unlinking. Entry suggestions reuse the
  existing authorised repository method, without new SQL or schema changes.
- Next: operator checks supplier autocomplete, action layout and historical preview
  in the rebuilt app. No new worktree, staging or commit performed.

## Reminder-rule follow-up code-complete — 2026-10-02

- The operator rejected immutable date/cadence and permits resetting reminder
  history, not financial transactions. Approved description Contains/Regex mode,
  read-only live matching preview, directional early/late windows (default three
  days each), and Upcoming/Pending/Due states. Pending is within grace; Due is after.
  Attention counts missing occurrences rather than schedules.
- Main owns server preview/permissions, attention projection, pinned re2js 2.8.6
  dependency, existing health fixtures and documentation. Workers own domain rules,
  additive0018/storage and editor/Overview. Existing0017 remains unchanged. No actual
  migration/services/browser/live data/PII/secret access/commit/deployment authorized.
- Previous 1,030-pass checkpoint predates this follow-up. The final full suite now passes
  1,062 tests, one skipped across 101 files; scoped lint/format/whitespace checks
  pass. Independent review passes 60 backend/domain/server and 19 UI tests, and
  the closure suites pass 31 domain and 20 UI tests. Sequential production build
  and TypeScript passed. Independent closure review found no additional production
  defect; browser layout/very large counts remain visually unverified.
  Regex uses the safe RE2JS engine;
  unsupported constructs must reject rather than fall back to native JavaScript regex.
- Reminder matching is case-insensitive Contains/Regex with integer windows 0–365;
  preview checks the edited rule only and does not guarantee cross-schedule automatic
  matching. Stale responses are suppressed, blank patterns match any description,
  invalid patterns cannot be saved, and zero matches/misalignment do not block save.
  Date/cadence reset removes only that schedule's reminder links. Financial rows
  and tax/cash/partner calculations remain unchanged. Migrations0017/0018 remain
  unapplied. Only the main worktree exists; there is nothing to prune.
- Next: operator reviews the rebuilt Recurring bills editor, regex/date preview,
  grace windows and Overview counts. Obtain separate authorization before applying
  and verifying migrations0017/0018 against PostgreSQL. No staging or commit performed.

## Previous recurring bills and table sizing checkpoint — 2026-10-02

- The operator approved implementation of T81 recurrence, T82 source-attribution
  sizing and T83 independent kind-aware invoice status. Notifications are in-app
  only; a recorded transaction alone satisfies recurrence. Two occurrence states
  are Upcoming and Pending. Canonical scope: `docs/recurring-bills-plan.md`.
- Main owns existing invoice-status integration, server/runtime/permission wiring
  and durable documentation. Backend owns new recurring domain/repository and
  migration 0017; UI owns recurrence page, navigation/Overview and scoped tax-table
  sizing. Pure/mocked synthetic tests only; no live records, migration application, services,
  browser/E2E, staging, commit, deployment or new worktree. Existing changes and
  migrations 0013–0016 remain protected.
- Invoice status is implemented as attached/missing/not_expected, separate from
  general Evidence and financial state. Available manual-invoice PDF metadata is
  required; an opaque artifact ID or CSV is not proof. Overview uses the renamed
  `missingInvoiceOrCreditNoteCount` for recorded expected-document kinds only.
- Initial independent invoice/repository/server/detail gate passed 124 tests across
  four files. Recurrence server/auth/date/prefill and invoice-domain gates passed
  26 tests across three files. Full integration now passes 1,030 tests, one skipped
  across 101 files; independent recurrence/server/UI/tax gate passes 45 tests and
  focused domain/repository/schema/migration gate passes 28 tests. Sequential
  production build/TypeScript and scoped ESLint passed after route-loader and test
  typing corrections. T82/T83 are code-complete; the later reminder-rule follow-up
  supersedes the original two-state model and cadence-policy blocker below.
  No actual PostgreSQL enforcement is verified. Only the main worktree exists.
- The operator subsequently rejected immutable anchor/frequency: reminder history
  may be reset. The follow-up implements this policy and new grace/regex preview
  behavior. Migration application remains separately gated. Other schedule fields
  and explicit associations already use optimistic revisions and eligibility checks.

## Owner funding and report field width code-complete — 2026-10-02

- BILL-T79 is approved: separate owner funding balances through the selected
  financial-year end, plus explicit principal repayment tracking. Loans and other
  contributions stay separate from direct/Business/final tax allocation columns.
- BILL-T79 is implemented: new `owner_loan_repayment` principal-only cash-out type,
  explicit lender selection, manual/bank workflows, preserved signed matching
  safeguards and additive migration 0016. Positive principal and supplied positive
  settlement are required; null settlement permits an incomplete record. Existing
  loan/contribution zero-value behavior is preserved. Interest is a separate expense.
- The funding panel uses the full ledger, including earlier financial years, from
  the same authorized read as the selected year's tax source. It is current recorded
  funding, not part of frozen tax snapshots or reviewed exports. Unknown owners and
  incomplete/negative balances must remain visible. Existing contribution rows are
  not automatically changed into loans; arbitrary transfers are not repayments.
- The separate panel lists loans advanced, principal repaid, loan balance and other
  contributions, with date-sorted supporting links. Prior-year funding is included;
  future and non-recorded rows are excluded. Owners are not filtered by partner
  selection or percentage. Incomplete and negative balances warn without inventing
  facts or blocking tax review. Updating earlier funding leaves the selected tax
  source fingerprint unchanged. MCP repayment drafting is deliberately out of scope.
- BILL-T80 scopes the Period field to a responsive 20rem preferred width; Basis and
  other autocompletes are unchanged. Synthetic label/form regressions passed.
- Final stable synthetic suite: 965 passed, one skipped across 95 files. Sequential
  production build/TypeScript, scoped lint, formatting and whitespace checks passed;
  independent focused verification and read-only source audit completed.
- Synthetic tests only. No live data, database execution, services, staging, commits,
  deployment or new worktrees. Existing dirty changes and migrations 0013–0015 are
  protected. Migration application and operator acceptance remain separately gated.
- Next: rebuild the application image and visually review the Period field and
  funding panel. Obtain separate authorization before applying/verifying migration
  0016 against PostgreSQL. No real database trigger execution was verified. Only
  the main worktree exists; nothing required pruning.

## Implementation completed — 2026-10-02

- BILL-T68, BILL-T33 and BILL-T77 are code-complete in the existing working tree.
  Final stable synthetic suite: 943 passed, one skipped across 94 files. Sequential
  production build/TypeScript, scoped lint, formatting and whitespace checks passed.
  Independent focused reviews and read-only source/worktree audit completed.
- T68 selects unique active users and allocates matching-owner effects directly;
  other/unassigned owners form the Business pool, using the same agreed percentages.
  Linked adjustments follow the source; unlinked adjustments are shared. Signed
  exact allocations and frozen v2 snapshots preserve legacy v1 hashes/UI/exports.
  Source ownership changes stale v2 exports. No ledger ownership or tax-policy change.
- T33 adds explicit match/create-and-next across the active queue with one wrap,
  preserved filters and bounded page/concurrency handling. Successful matching and
  failed navigation remain separate; retry advances without a second financial write.
  URL-based freshness prevents own loader refreshes cancelling explicit next.
- T77 adds deterministic Workspace/Supabase/Stripe facts, pinned full-checksum
  reads, bounded local extraction and explicit five-field application. Paid/due/
  subtotal are distinct from total; ambiguous receipts require total/currency review.
  Stripe stays review-only. Uploaded PDFs are confirmed/reused, not automatically
  approved or saved; conflicts and late responses have synthetic coverage.
- PDF.js 6.3.289 is pinned. Nitro tracing uses build-resolved absolute paths for
  legacy display/worker and native canvas. Runtime resolution anchors to the actual
  Node server entry, not CWD or Nitro's synthetic import.meta. Isolated built-extractor
  proof passed from a fresh copy of server output, with synthetic bytes and no
  runtime/auth/handler imports. Published Nitro 2.13.4 archive matches lock integrity
  and confirms traceInclude despite differing upstream source; no dependency reset.
- Remaining operator checks: rebuild the application image; review actual-user
  choices, direct/Business totals, next-row behavior and invoice review UI. Real
  invoice parsing and browser/OS acceptance were not run in this slice. SQL queue
  execution against PostgreSQL remains unverified; repository tests mock results.
- No commits, staging, new worktrees, migrations, live writes or deployment occurred.
  BILL-T78 storage probes/transition remain separately gated. Existing untracked
  migrations 0013–0015 are protected prior-session work. Only the main worktree
  exists, so nothing was pruned. Canonical scope/checklist: implementation-candidates.

## Previous checkpoint — 2026-10-01

- Candidate plans in `docs/implementation-candidates.md` passed independent source
  audit and focused re-review for scope approval. Investigation is complete; the
  operator approved the three initial scopes on 1 October 2026. Implementation
  authorization and working-tree baseline selection remain pending.
  On 1 October 2026 the operator prioritized existing supplier invoice PDFs over
  CommBank statement PDF parsing and authorized local content/layout inspection
  of `/Users/axatol/Downloads/buildsight finance`, without external uploads or
  recording personal identifiers. Filename inventory: ten Google Workspace, nine
  Supabase and seven Stripe invoices; two CBA statements are excluded. All 26 have
  extractable text and are unencrypted. Nine privacy-masked representative renders
  were inspected across 15 pages, without changing originals. Plans specify pure
  vendor parsers, bounded local extraction and explicit field application, with
  Supabase currency ambiguity and Stripe total/due/duplicate-fee safeguards. The operator
  also confirmed the Business pool uses the same agreed partner percentages.
  This turn is investigation/planning only; no production implementation, live
  migration, provider change, commit or new worktree is authorized.
  Approved scope choices: initial owner/adjustment rules without per-row overrides;
  active-queue cross-page next with one wrap; Stripe review-only first release.
  The operator's “sounds good” confirmed these choices; no implementation, commit,
  new worktree or disposable storage-test permission is inferred from scope approval.
  New task IDs BILL-T77/BILL-T78 are reserved in the repository roadmap; TaskView
  tools are unavailable and no external tasks were created. T30 retains its ID and
  is deferred. Main alone edits this handoff/log. Storage integration is gated by
  a separately approved disposable synthetic capability probe and legacy preservation.
  Audit corrections specify one-based next-selection paging and queue-limit handling,
  invoiceTotal-only document mapping with operator confirmation for paid-only receipts,
  separate content/filename date application, and upload-expiry/deletion fencing.
  Source invoice/customer identifiers and host paths are omitted from the durable
  parser spec. Documentation formatting/whitespace checks passed; no production
  tests/services or live records were used. Only the main worktree exists.
- BILL-T76 regular-font right alignment is approved and code-complete. Shared
  `components/money-text.tsx` preserves displayed strings and semantic strong/small
  tags; `money-text`/`money-column` styles right-align with tabular figures without
  a font-family or font-size override. Overview/tax label selectors now target
  direct child labels so nested amount text retains its original tone. Focused
  shared-component coverage passes (4/4) after unused inline support was removed.
  Stable full-suite verification passed 826 tests, one skipped across 86 files
  with maxWorkers=4 and no concurrent build. Independent verification passed 153
  focused tests plus TypeScript; scoped lint, formatting, and read-only source
  audit passed. Earlier in-flight type/header failures are resolved; timeout
  failures seen during the concurrent build did not recur in the stable run.
  Final stable-snapshot production build/TypeScript passed. Application visual
  acceptance remains pending after rebuilding the application image; no deployment
  or live browser/data access was performed.
  Mobile pseudo-labels stay left-aligned and stronger table selectors preserve
  monetary header/value alignment against banking CSS. Inputs, exports, calculations, and
  decimal precision are protected. On 1 October 2026 the operator approved
  single-amount comma-free normal copy. The implementation uses a document-level
  listener in `components/money-copy.ts`, mounted/cleaned up by AppShell. It removes
  commas only when one range is wholly inside a non-editable marked monetary value,
  preserving selected currency/sign/decimals; rows, prose, edits, cut, exports and
  explicit Copy ID actions remain native/unchanged. Clipboard write failure preserves the
  native fallback. Independent review closed an endpoint-only nesting edge case
  with a conservative guard and regression; 28 focused tests, scoped lint and
  formatting passed. Final stable-source suite passed 837 tests, one skipped across
  87 files with maxWorkers=4; sequential production build/TypeScript, scoped lint,
  formatting and whitespace checks passed. Final read-only audit found no unexpected
  copy scope changes; attribution remains planning only. Real OS/browser copy acceptance remains
  unverified. Rebuild the application image and copy one grouped amount to verify;
  neither deployment nor live records were touched. Only the main worktree exists;
  no pruning or commit was performed.
- BILL-T75 category/table follow-up is code-complete: historical categories now
  cover every non-void source/kind, with trimming, distinct values, ordering, and
  limit 200; supplier history is unchanged. Bulk options merge built-in defaults
  and saved categories with exact deduplication; custom values remain supported.
  Five-column table context is two lines with full DOM/title text, untruncated
  current/new values, a bounded scroll viewport, and sticky headers. Previous
  selection/revision/mutation behavior is unchanged. Verification: 816 tests passed,
  one skipped; build/TypeScript, scoped lint, formatting, and independent review
  (111 repository/route tests) passed. Application visual acceptance remains pending.
- Approved standalone synthetic money preview was created and visually inspected:
  `/Volumes/Data/tmp/folio-money-preview.ujhgWE/money-formatting-preview.html`
  and `.png` (1280×1130). Table money is 16px; card money is 1.1rem. Proposed font
  stack is ui-monospace, SFMono-Regular, Menlo, Consolas, monospace with tabular
  figures and right alignment. Labels/counts/dates/percentages/input fields/exports
  remain unchanged. On 1 October 2026, the operator approved right alignment with
  the existing regular font instead of the mock-up's monospace proposal (BILL-T76).
  Rendering used an isolated static HTML browser profile; the temporary process
  was verified and stopped. No live application or personal browser data was used.
- BILL-T68 user-linked partner attribution remains a separate planning follow-up.
  Operator selected direct owned income/expense allocation plus percentage shares
  of the remaining pool. Main inspected generic partner schemas, owner-less tax
  cash-ledger projection, linked adjustment validation, active user choices,
  fingerprinting, route allocation, exports and append-only JSONB persistence.
  Proposed plan is in docs/roadmap.md: explicit active-user partner choices,
  matching-owner direct tax effects, all other effects in the shared pool, linked
  adjustments following matching owners and unlinked/non-matching adjustments shared,
  exact signed allocation and versioned frozen snapshots preserving legacy versions.
  New source fingerprints must be versioned: retain the exact owner-less v1
  projection for legacy current/stale checks and owner-aware v2 for new reviews.
  Preserve existing updatedAt-based staleness after actual ownership edits; never
  reinterpret legacy rows using live owner joins or accept unknown model versions.
  Adjustment/shared-pool rules were approved on 1 October 2026; implementation
  authorization and baseline selection remain pending.
  Operator added Business attribution on 1 October 2026: system-owned costs should
  be assignable to partners during review. Proposed Business (shared) target is
  separate from ledger owner; system/non-selected/unassigned owners default shared,
  selected owners default direct. Do not infer
  system account identity from names/roles; User has no such flag. Costs assigned
  to either direct or shared buckets must not be counted in both.
  Linked adjustments should follow final reviewed attribution, not the original
  responsibility field after later edits. Freeze classification/allocation in new
  snapshots without changing ledger owners. Operator clarified the initial scope:
  Business expenses are allocated by percentage in addition to direct partner
  transactions. Custom per-cost splits and direct Business-cost reassignment are
  deferred. The operator confirmed the Business pool uses the same agreed partner
  percentages on 1 October 2026. No allocation code changed.
  Owner defaults to the actor for new manual/reconciliation rows and denotes
  operational responsibility, not automatic tax entitlement; assignments need review.
  Current profit-share calculation remains unchanged; never double-count owned rows.
- On 1 October 2026 the operator asked which features could run concurrently in
  worktrees. Main reviewed current roadmap/source boundaries: BILL-T33 explicit
  match/create-and-next is bounded and tax-independent; unversioned document storage
  is a larger low-tax-overlap candidate needing preservation/provider decisions;
  pure supplier invoice parsers (BILL-T77) replace the earlier T30 statement-parser
  candidate after the operator's priority change. T33 needs a narrow authorized
  next-selection read, not changes to reconciliation writes or shared form code.
  T77 extractor/form integration overlaps T78 artifact/lifecycle/server integration
  and must be sequenced. Full dark appearance and audit history overlap T68's shared styling
  or operation/persistence boundaries. These are candidates only, not implementation
  or worktree/commit approval. Only the main worktree exists and recent code is dirty,
  including untracked tax modules. Agree a checkpoint or reviewed patch baseline
  before new worktrees; never share live database mutations across parallel tests.

## BILL-T75 code completion — 2026-10-01

Bulk metadata editing is approved for counterparty, operational category, and
owner, using current-page-only selection → server preview → all-or-nothing apply.
One field/value action per batch; no tax/financial/match/evidence changes or MCP
bulk tool. Domain contract is `src/domain/bulk-transactions.ts`, bounded to 50
unique IDs with exact `updatedAt` tokens. Repository methods validate the entire
locked selection before a metadata-only update; unchanged rows are not rewritten.
Controls use searchable autocomplete. Late previews are ignored, failed applies
clear selection and refresh before reselection, and navigation during apply cannot
leave the list locked. Metadata changes may stale saved tax reviews; owner edits
do not alter partner-share percentages.

Operator follow-up on 1 October 2026 approved a visible Field label to align the
editor controls and a header checkbox for all visible eligible rows. That narrow
UI correction is implemented. Partial selection shows a mixed state, void
rows remain excluded, and selection remains current-page-only. Existing captured
revision tokens are preserved when the header fills a partial selection; existing
backend and mutation semantics are unchanged.

Final code gates after the UI follow-up: 813 tests passed, one skipped across 85 files; TypeScript,
scoped lint, formatting, production build, and independent review passed.
Core independent checks passed 170 focused tests and TypeScript. Independent
follow-up route tests passed 54/54. Operator visual review after
rebuilding remains pending. No live database, E2E test, migration, deployment,
commit, or worktree deletion was performed. Preserve unrelated dirty changes.

## BILL-T73 checkpoint — 2026-10-01

The four mixed row builders now use `components/query-chip-builder.tsx` and
scoped chip-bar styling. Searchable column → operator → value entry and inline
editing emit completed clauses on blur, Enter, or explicit application; incomplete
edits remain local. Resetting sorts restores each route's default ordering with
collision-free IDs. Existing URL schemas and backend queries remain unchanged.

Autocomplete popup sizing is now intrinsic and viewport-bounded, without the old
24rem minimum. Optional input sizing keeps chip segments compact without changing
ordinary form controls. No native select controls were reintroduced.

Final verification: 782 tests passed, one skipped; TypeScript, scoped ESLint,
formatting, production build, and independent review passed. Operator visual
acceptance after rebuilding remains pending, especially popup width and responsive
chip wrapping. No deployment, live-data access, or database migration was performed.
Preserve the existing dirty worktree; no commit or worktree deletion was made.

Operator follow-up on 1 October 2026 approved modest chip padding, centred sort
direction/action icons, and left-aligned standard secondary Clear filters/Clear
sorts buttons. BILL-T74 implements this presentation-only correction without
changing query behaviour or shared-control APIs. The saved-chip editing class
separator also now survives formatting, with a regression assertion on that path.
Verification: 75 focused component/route tests, TypeScript, scoped lint, formatting,
production build, and independent review passed. Browser geometry remains pending.

## FOLIO-EXT-02 — 2026-09-19

The standalone extraction is installed at the repository root. Source, migrations,
operational shell/SQL files, generated route tree, local package tooling, Docker
packaging, and Folio docs are present. The source monorepo and destination LICENSE
were not modified.

Implementation deltas in this extraction:

- package metadata is standalone (`folio`, private, Node.js `>=24`, pnpm `10.13.1`);
- local Vitest, ESLint, Prettier, TypeScript, Vite, and pnpm lock configuration is
  used instead of monorepo projects, catalogs, filters, or workspace links;
- form saves read the native submit event and retain the clicked `draft`/`recorded`
  submitter status;
- owner display names fall back to nonblank owner email values;
- diagnostics emit completion-only records, with no start phase;
- the roadmap is reduced to Folio milestones and the operation docs describe the
  completion-only logging contract.

Destination verification passed with the frozen lockfile: 19 Vitest files and 92
tests, TypeScript, ESLint, Prettier, production Vite/Nitro build, and shell syntax.
The standalone Node 24 Alpine Docker image also built successfully. No secret files
or live resources were required for these gates. Live PostgreSQL, S3, browser, and
backup/restore verification remains part of BILL-T07.

## BILL-M3 code completion — 2026-09-19

BILL-T19 through BILL-T22 are code-complete. The transaction table now uses Date,
Counterparty, Description, Type, Amount, State, and Actions; evidence is a direct
PDF/CSV action, converted amounts retain the original currency, and Stripe rows show
net with gross/fee detail. Transaction review supports deterministic filters, sorting,
and 50-row presentation pagination.

The artifact table deduplicates attachments by artifact ID. The accessible balance
chart and exact-value table use a dedicated series that includes recorded Stripe
source-net movement independently of preparation-report classification. Stripe
categories use explicit mapping with a review-safe fallback; identical reimports are
skipped and conflicts fail safely.

Verification passed: 20 Vitest files and 107 tests, TypeScript, ESLint, Prettier, and
the production Vite/Nitro build. Independent verification initially found clipped
negative chart movement and UTC period filtering; both were corrected and rechecked.
Live PostgreSQL, S3, populated-browser, responsive-layout, and operator acceptance
remain in BILL-T07.

BILL-T23 is code-complete following populated-interface feedback. It added composable
AND filters with field-appropriate operators, header and mobile sorting, unified
free-text suggestion controls, signed/colour-coded amounts, compact actions, copy
controls, responsive table reflow, and validated Stripe CSV filename normalisation.
Verification passed with 20 Vitest files and 123 tests plus TypeScript, ESLint,
Prettier, the production build, and an independent static responsive audit. Native
datalist, clipboard, and populated responsive behaviour remain browser gates in
BILL-T07.

## BILL-T24 planning — 2026-09-19

Reusable PDF evidence is now planned under BILL-M4. The confirmed requirement is
general: one PDF may support multiple manual transactions, with an optional locator
for the relevant page, line, or section. It is not limited to bank statements and
does not include PDF parsing, OCR, automatic classification, or many-to-many evidence.

The current manual-artifact unique index and evidence-replacement lifecycle conflict
with this requirement. Implementation must remove the uniqueness restriction, add
existing-artifact selection, preserve shared artifacts when one transaction changes
evidence, and retain transaction-specific GST validation. No BILL-T24 source or
migration changes have started.

## BILL-T25 planning — 2026-09-19

The implemented balance-activity chart currently appears only after a preparation
report action and sits below the transaction and artifact tables. BILL-T25 is planned
to move an automatically loaded default-period chart above the transaction table and
add an always-visible lifetime activity summary beside it.

The lifetime summary uses recorded, non-void movement and shows inflows, outflows,
net movement, covered dates, included count, and unresolved or adjustment count. It
is independent of transaction-table controls. Transfers remain included under current
semantics, so the result must not be represented as an account balance. No BILL-T25
implementation has started.

## BILL-M2 OIDC planning — 2026-09-20

BILL-T08 through BILL-T10 now contain an implementation-ready Google Workspace OIDC,
session, authorization, audit, and deployment-verification plan. Production uses
`https://folio.buildsight.com.au/auth/callback`; local development uses
`http://127.0.0.1:43230/auth/callback`; each has a separate Google web OAuth client.
The required hosted-domain claim is exactly `buildsight.com.au`.

OAuth client credentials are injected through environment configuration. Sessions
default to a 12-hour absolute lifetime and use opaque rotated tokens, SHA-256-only
server-side storage, and revocation without Google refresh tokens or a separate session
signing secret. A reverse proxy is expected, likely Traefik; its forwarded-header trust
boundary, HTTPS redirects, cookie behaviour, request limits, and security headers
require live verification.

The approved initial role model includes administrators and members only. Viewer is
not treated as a trivial extension: the existing database value fails closed until its
read/download/export permissions are deliberately implemented and tested. Members use
all ordinary transaction, artifact, reporting, import, download, and export workflows;
administrators additionally manage users and roles.

Authorization must be permission-based rather than direct role checks. Each server
operation declares a stable named action; application-defined, code-reviewed role
bundles grant those actions. The viewer bundle is empty initially. Do not introduce a
runtime policy engine or call this ABAC: in standard security terminology ABAC means
attribute-based access control.

First login binds an eligible unbound active user to Google `sub` using an exact
case-insensitive verified email match. Bound subjects are authoritative, unknown users
are not auto-provisioned, material email changes require administrator reconciliation,
and deactivation revokes sessions. Audit scope includes authentication, user and role
administration, mutations, artifact lifecycle and downloads, imports, and exports, but
not routine views or searches. Logout is Folio-only; no idle timeout is added.

## BILL-T08 code completion — 2026-09-20

BILL-T08 is code-complete. It adds pinned `openid-client` 6.8.8; exact production and
development origin validation; Google authorization-code login with state, nonce, S256
PKCE, and ID-token signature and claim checks; transactional pre-provisioned identity
binding; single-use login attempts; hash-only 12-hour opaque sessions; rotation,
revocation, login/callback/logout routes; production and development cookie policies;
and minimal session UI. Migration 0004 must be applied before running this build.

Independent testing exposed and corrected missing ID-token JWS verification in the
library's default direct-token mode by enabling non-repudiation checks. Verification
passed with 25 files and 149 tests, TypeScript, ESLint, Prettier, production build,
synthetic Compose configuration, and independent security review. Live Google,
PostgreSQL, TLS, secret-injection, and Traefik checks remain BILL-T07/T10 gates.

## BILL-T26 complete — 2026-09-20

BILL-T26 separates Folio diagnostic fields from the server-only `sourceError`. Ordinary
`Error` values retain `name`, JSON-safe scalar `code`, `message`, and `stack` when
available; Zod records only `name` and `issues`; hostile and non-Error throws degrade
safely. Clients receive generic guidance, the Folio diagnostic code, and a correlation
reference. Verification passed with 25 test files and 160 tests, typecheck, ESLint,
Prettier, and independent verification. Zod issue content can itself describe invalid
input.

## BILL-T09A complete — 2026-09-20

Protected web operations now resolve the current active user from the opaque session
cookie on every request, enforce code-defined named permissions, and pass the trusted
user ID into repository and document services. Browser `actorEmail` fields, editable
attribution UI, and actor session storage were removed; email is display-only and
`owner_id` remains a separate business assignment. The maintenance reconciliation CLI
retains explicit `--actor-email`. No migration was required. Verification passed with
26 test files and 170 tests, TypeScript, ESLint, Prettier, production build, and
independent review.

## Active blocker — BILL-T09B

Append-only audit history remains incomplete, so BILL-T09 is still in progress. Live
PostgreSQL, browser, and reverse-proxy verification and BILL-T10 also remain required;
the application must not be publicly exposed until those gates pass.

## BILL-T27 complete — 2026-09-20

The shared suggestion input now preserves raw custom text while editing, including
trailing spaces needed to type multi-word funding sources. Submission remains trimmed,
so persistence semantics did not change. The fix applies to every shared suggestion
field. Verification passed with 26 test files and 172 tests, TypeScript, ESLint,
Prettier, production build, and independent review. Browser-mounted component coverage
remains absent but no production defect was found in the controlled-input wiring.

## BILL-T28 planned — 2026-09-20

The roadmap now includes an ATO-aligned bank transaction-history CSV workflow. It
imports all valid statement rows after preview and classification rather than allowing
potentially relevant movements to disappear before import. Private/non-business,
transfer/drawing, mixed-purpose, and unresolved treatments remain visible while their
non-claimable amounts are excluded from tax totals. Void is reserved for post-import
duplicates and errors. The initial explicit profile is date, signed movement,
description, and running balance; the exact bank export and header format must be
confirmed before implementation.

## BILL-T29 complete — 2026-09-20

The manual transaction form is now a managed TanStack Form/React Aria vertical slice.
It preserves exact string money, normalises whitespace at submit, provides inline and
summary validation with hidden-section reveal/focus, and uses accessible creatable
comboboxes. Void edits can remain void or explicitly restore to draft/recorded. Save
requests authorize the session before strong parsing and return only sanitized field
issues or the saved transaction; provider failures remain generic. Other forms were
not migrated. No database migration was needed. Verification passed with 28 files and
193 tests, TypeScript, ESLint, Prettier, production build, mounted DOM coverage, and
independent review. Populated live-browser verification remains outstanding.

## BILL-T29A complete — 2026-09-20

The manual transaction form spacing now uses explicit responsive grid tracks and
field spans. Desktop rows fill 12 columns intentionally, the compact layout uses six
columns, and mobile collapses to one column without changing form or persistence
behaviour. Focused tests, TypeScript, ESLint, Prettier, and the production build pass.
A rendered browser check remains outstanding because no browser runtime was available.

## BILL-T29B complete — 2026-09-20

New manual entries default the editable owner to the authenticated actor, and both
local and authoritative manual-save validation prohibit ownerless manual records.
The owner selector remains under Advanced. Stripe imports remain nullable and
unchanged. Priority fields were reordered and Description is full-width. Verification
passed with 28 files and 197 tests plus TypeScript, ESLint, Prettier, and production
build; populated-browser verification remains outstanding.

## BILL-T29C code-complete — 2026-09-20

Manual blur validation is field-scoped, empty combobox overlays are suppressed, and
exiting overlays ignore pointer events. Google login requests `profile` and backfills
only null/blank display names, including rows initially created by `user:add`; curated
names and email identity matching are preserved. Verification passed with 28 files
and 202 tests plus all static/build gates. User browser confirmation of the original
multi-click defect remains required.

## BILL-T29D complete — 2026-09-20

The deferred blur boundary was removed after browser feedback showed it suppressed
field and save-action validation. Blur is synchronous and field-scoped; draft and
recorded saves run action-aware full validation. Pointer transition, both save
actions, and mouse/keyboard combobox regression tests pass. The full suite is 28 files
and 206 tests, with TypeScript, ESLint, Prettier, and build passing. User browser
confirmation remains required.

## BILL-T28 reconciliation code completion — 2026-09-23

BILL-T28A/B and the import/activity portion of T28E were previously completed and
dependency-verified. BILL-T28C/D and the remaining T28E code are now implemented:
migration 0007, canonical signed-AUD matching, ranked candidates, explicit state
transitions, optimistic revisions, atomic create-and-match, completion counts, and the
`/banking/reconcile` workspace.

Independent static review found one high-severity race between invoice-evidence
validation and supersession. It is closed by deterministic `FOR UPDATE` locking before
validation and linkage; re-review passed. The full constrained test run passes 37
files/272 tests, and TypeScript, ESLint, and Prettier pass when commands use
`NODE_DISABLE_COMPILE_CACHE=1`.

Operational gaps: the production build transforms 1,547 modules but stalls at
`rendering chunks`; Docker CLI commands are currently unresponsive. Do not claim the
real PostgreSQL two-session race/rollback gate or populated-browser acceptance until
those environment failures are resolved. The next session should diagnose the build
and Docker runtime, run migration 0007 against disposable PostgreSQL, exercise
concurrent matching/evidence supersession, and perform browser workflow/accessibility
checks.

## BILL-T29G awaiting browser trace — 2026-09-21

A development-only, non-PII trace now observes the Amount `onBlur` validator boundary.
Search the browser console for
`[folio:manual-transaction-form:documentAmount:onBlur]`; its `returnedError` value will
distinguish a missing callback from TanStack rejecting a returned error. Production
contains no trace. Verification passes with 28 files and 210 tests plus all
static/build gates.

## BILL-T29H complete — 2026-09-21

The browser trace isolated the failure to whole-transaction parsing during field blur.
Every blur validator now uses a direct editing-value schema; cross-field and accounting
rules remain submit-time concerns. Unexpected non-Zod failures are no longer silently
treated as valid, and the diagnostic trace was removed. Verification passes with 28
files and 215 tests plus all static/build gates. User browser confirmation remains
required.

## BILL-T29E code-complete — 2026-09-20

The manual form now follows TanStack Form's documented field-validator, direct-blur,
native-form, and named-submit-button lifecycle. Official Form Devtools are available
client-side in development only. Verification passes with 28 files and 207 tests plus
all static/build gates. The production UI bundle excludes Devtools UI; Form core's
existing devtools event client remains because it is a direct dependency of
`@tanstack/form-core`. User browser confirmation of blur and submit validation remains
required.

## BILL-T29F complete — 2026-09-21

The generated validator registry was removed after Devtools showed it produced no
browser error despite correct touched/blurred state. Every manual field now declares
an explicit TanStack `onBlur` validator backed by a pure domain field helper. SSR
render-to-hydration, pointer blur, correction, and native-submit regressions pass. The
full suite is 28 files and 209 tests with all static/build gates passing. User browser
confirmation remains required.

## BILL-T29I code-complete — 2026-09-22

The manual-entry form now presents Kind, Supplier, Reference, and Date on the first
desktop row, followed by Amount, Currency, and a half-width Description textarea.
Errors render below their controls and the amount error uses concise guidance. React
Aria supplier selection works by pointer and keyboard while retaining custom free
text. The focused 19 tests, full 28-file/215-test suite, TypeScript, ESLint, and
Prettier pass. The production build is blocked separately because
router-devtools-core 1.168.2 expects `getRouteSegments` from router-core 1.171.15;
dependency alignment requires a confirmed follow-up.

## BILL-T29J complete — 2026-09-22

All primary manual-entry field wrappers and controls now fill their assigned grid
columns. The approved field order, desktop spans, responsive reflow, and form behavior
are unchanged. Focused tests, TypeScript, ESLint, and Prettier pass. The remaining
verification is a populated-browser visual check; the separate TanStack production
build dependency mismatch remains unresolved.

## BILL-T28/BILL-T30 reconciliation plan confirmed — 2026-09-22

The roadmap now treats imported bank rows as immutable bank activity separate from
Folio transactions. The initial profile is a headerless four-column AUD CommBank CSV
with posted date, signed movement, description, and running balance and no pending
rows. BILL-T28 stages preview, persistence, one-to-one exact-AUD reconciliation,
create-from-row, and completion status. BILL-T30 later adds one supported text-based
CommBank PDF layout through the same pipeline; OCR remains excluded. The next planning
topic is an overall DX/UI information-architecture review for these planned workflows.

## Tentative UI plan prepared — 2026-09-22

`docs/ui-plan.md` is the handoff document for review. It proposes an authenticated
shell with Overview, Transactions, Banking, Artifacts, Reports, and permission-gated
Administration; Banking contains Activity, Reconcile, and Imports. The plan is
explicitly tentative, uses provisional `UI-R*` identifiers, and must not be promoted
to committed roadmap work until its review questions and gates are resolved.

## Tentative UI review folded in — 2026-09-22

The user retained `Reconcile` for overall-position bank-row resolution and preferred
absolute counts over percentages. Other independent-review findings were accepted
tentatively and incorporated into `docs/ui-plan.md`. Version-two Overview,
Transactions, and Banking/Reconcile mockups are in `docs/mockups/`; original mockups
remain for comparison. The plan remains tentative and has not been promoted to stable
roadmap tasks.

## Tentative banking plan prepared — 2026-09-22

`docs/banking-plan.md` proposes a simplified version-one model: source artifacts own
file/import metadata and `bank_transactions` owns immutable source rows plus current
reconciliation state. It specifies exact signed-AUD one-to-one matching, atomic
create-and-match, dispositions, permissions, reporting isolation, and replay/conflict
semantics. It is explicitly tentative, awaits independent adversarial review, and does
not yet amend BILL-T28/BILL-T30.

Independent adversarial review subsequently accepted the simplified model but found
four blockers: typed artifact import completion, explicit idempotency scope, matched-
transaction mutation protection, and a canonical signed-AUD matching projection. The
review status and unapproved recommendations are recorded in `docs/banking-plan.md`.

The plan was then simplified further: artifact profile plus media type replaces
duplicated type axes; bank rows retain only core typed fields plus metadata; a plain
through table attributes CSV/PDF artifacts; reconciliation state is derived from match
or classification; and artifact lifecycle supplies import completion. This revision
was independently reviewed. The model was accepted in principle; staged profile
migration, a shared artifact UUID, serialized checksum/profile confirmation, and
database protection of matched transaction fields remain blockers. Source-row locator
provenance in the through table remains an open decision.

Those decisions have now been resolved in a complete candidate architecture and
provisional implementation plan. Current data is explicitly disposable test data;
relationship source positions are optional metadata; and nine `BANK-I*` slices cover
profiles, cash effects, schema, parser, confirmation, reconciliation, create-and-match,
UI integration, and later PDF support.

Final independent adversarial review returned do-not-promote. Six gates remain:
reconcile the candidate with stable BILL-T24/T28, settle artifact replay semantics,
make confirmation/recovery profile-aware, specify database match constraints and lock
ordering, complete shared-PDF lifecycle rules, and define raw bank-description
privacy/redaction. The result is recorded in `docs/banking-plan.md`; implementation has
not begun.

On 23 September 2026 the initial scope was confirmed as a private, non-GST-registered
sole-trader cashbook, with company and multi-account bookkeeping deferred. Separate
`transaction_artifacts` and `bank_transaction_artifacts` through tables were chosen;
artifact metadata will not store relationship IDs. Exact profile/checksum duplicates
are rejected, while non-identical imports show precise date-range overlaps and allow
explicit continuation. These decisions are reflected in the candidate plan.

The architecture was then promoted for implementation. BILL-T24 and BILL-T28 are
ready; BILL-T30 stays deferred until CSV acceptance. Integration dependencies must run
in disposable Docker containers using PostgreSQL 17 and a versioned S3-compatible
service. The UI v2 mockups are retained as directional references, with Reconcile
requiring the corrections recorded in `docs/ui-plan.md`.

The three desktop mockups were revised as v3 using the supplied theme samples. They
are current references in `docs/mockups/`; v2 and original files are superseded.
Reconcile v3 reflects the approved source-detail, derived-state, and classification
semantics. `docs/ui-plan.md` links the current files and records their limits.

V4 supersedes v3 as the current visual reference. It retains the same workflow and
domain semantics while using Geist-like typography and subtly elevated white surfaces
on a pale cool-grey canvas.

BILL-T24 is complete after three independent verification passes. Migration 0005
implements artifact profiles, canonical shared UUID keys, and many-to-many
`transaction_artifacts`; the manual workflow supports multiple existing/new PDFs and
Stripe provenance uses the same relationship table. Real PostgreSQL verification
covered migration/backfill, claimable evidence, concurrency, immutable relationship
identity, and safe supersession. All 226 tests and static/build gates pass. The
populated-browser check remains pending. BILL-T28 is marked in progress; bank tables
and parser are not implemented yet.

BILL-T28A/B and the import/activity portion of T28E are now implemented and
independently verified. Migration 0006, the fixed CommBank parser, atomic pinned-object
confirmation, duplicate/overlap handling, cancellation, history/activity routes,
exact-decimal display, and safe presign-cleanup diagnostics are complete. Docker
PostgreSQL and MinIO gates passed; all 247 tests and static/build gates pass.
BILL-T28C/D reconciliation and create-from-bank remain next. Mounted-browser QA is
still unavailable.

## BILL-T28 backend acceptance update — 2026-09-23

The previous build and Docker blockers are resolved. Router 1.170.36 and router-core
1.171.30 satisfy the router-devtools peer requirement; frozen lockfile installation
and the production build pass. Disposable PostgreSQL applied migrations 0001–0007 and
passed five dedicated reconciliation tests covering exact matching, reset/protection,
concurrency, rollback/retry, and invoice-evidence supersession. The Compose project
and volumes were removed after testing.

Ordinary tests pass with Docker stopped (37 files/272 tests). TypeScript, ESLint, and
Prettier pass. The dedicated database test command and migration setup are in
`ops/test-dependencies.md`. The only BILL-T28 acceptance gate still open is populated-
browser workflow and accessibility review: the local app responds, but browser
discovery found no available browser in this session. Do not claim that gate passed.

## BILL-T28 Playwright follow-up — 2026-09-23

The previous browser limitation was bypassed with standalone Playwright and an
isolated, synthetic PostgreSQL/MinIO app on loopback. The focused Chrome workflow
passed import-history rendering, explicit match and reset, private classification
and reset, create-form amount blur validation and cancel, recorded create-and-match,
and a 390 px viewport with no horizontal overflow or uncaught page errors.

Two defects found by that run are fixed. TanStack Start/Router/Devtools now resolve
a compatible Router Core 1.171.28 API; frozen install, production build, typecheck,
and lint passed. PostgreSQL `DATE` is projected as text in bank list/detail queries;
the one-day timezone regression was reproduced before the fix and passed afterward
in real database tests. Ordinary tests passed 37 files/272 tests; the dedicated
PostgreSQL suite passed 5/5.

Remaining BILL-T28 browser work: exercise the CSV upload/preview/overlap/confirm path
in a browser with S3-compatible local configuration, perform screen-reader/keyboard
review, and bring the functional reconciliation workspace into visual alignment with
the approved version-four UI mockups. The Playwright screenshots showed no horizontal
overflow but crowded raw-detail presentation and a development-only Devtools overlay
that obscures some mobile actions. Do not treat the focused workflow pass as full UI
or accessibility acceptance.

## Local self-contained Compose slice — completed, 2026-09-23

Confirmed scope: turn the repository Compose stack into a loopback-only local setup
with PostgreSQL, a versioned MinIO bucket, and a fixed synthetic-password login.
Local login must issue ordinary database-backed sessions and retain action-based
permissions; Google OIDC remains the production path and local mode fails closed in
production. Hard-coded credentials are only for the explicitly local stack.

Checklist:

- [x] Add local authentication and idempotent synthetic administrator seed.
- [x] Add separate internal/public S3 endpoints and same-origin browser object route.
- [x] Wire Folio, database migration/seed, MinIO initialization, and local proxy in Compose.
- [x] Verify static checks, unit tests, Docker build/start, local login, and one
      synthetic presigned object roundtrip; document remaining gaps.

The default Compose stack now uses fixed synthetic credentials, a loopback-only
Caddy entrypoint, PostgreSQL, a versioned MinIO bucket, and a migration/seed job.
`FOLIO_LOCAL_PORT` changes the loopback port and Folio/public-S3 origin together.
The original 43230 port was occupied by an existing user process, so verification
used a separate `folio-local-verification` Compose project on port 43231 without
touching it. The production build, Docker image build, and clean Compose startup
passed. Health, wrong-password rejection, valid session issuance, authenticated
workspace, two signed PUTs with distinct version IDs, and pinned GET through Caddy
passed. A headless Chrome Playwright run completed local login, synthetic CommBank CSV
upload, preview, and cancellation without page errors. Ordinary tests passed 37
files/284 tests; typecheck, lint, and formatting passed. The isolated Compose project
and its synthetic PostgreSQL/MinIO volumes were removed after verification.

The configuration rejects local auth in production; Google OIDC remains in code but
the default Compose file is local-only. Do not expose its proxy or reuse its fixed
credentials. Production HTTPS/OIDC, backup/restore, and broader BILL-T28 review are
separate open gates.

## BILL-T32 UI revamp checkpoint — 2026-09-23

The approved v4 UI plan is being implemented under BILL-T32. Completed code slices
as of this checkpoint: authenticated responsive shell with Overview, Transactions,
Banking, Artifacts, Reports, and permission-gated Administration navigation; global
Add links for manual entry, Stripe CSV, and CommBank CSV; Overview and dedicated
Transactions, Artifacts, Reports, Administration, and transaction-detail routes;
direct bounded artifact query over source files and both relationship tables;
banking page hierarchy, activity/import pagination, and classification/reset
confirmations. The legacy Transactions page has dropped duplicate artifact, report,
and user-management sections. Manual and Stripe workflow-state separation is complete.

Checklist:

- [x] Shell/navigation and discoverable CommBank CSV entry point.
- [x] Dedicated artifact query and page; dedicated reports/admin/detail destinations.
- [x] Overview chart with exact values and distinct Banking pages.
- [x] Banking collection paging and action confirmations in code.
- [x] Verify integrated code after workflow-state, bounded-query, and Overview edits.
- [ ] Rebuild and smoke-test the new query paths against PostgreSQL. Two isolated
      Docker builds stalled during Nitro packaging; the test stack was removed.
- [ ] Finish browser visual, responsive, keyboard, and populated-workflow review.
- [x] Implement URL-backed, server-bounded Transactions search/filter/sort/page.
- [x] Add independent lifetime summaries and exact Overview attention counts with
      bounded recent-record snapshots.
- [x] Finish Banking, Overview, and Reports loader-local retry boundaries.
- [x] Split transaction creation/editing and Stripe import from the list route.
- [ ] Decide whether edit/cancel should preserve the originating filtered-list URL.

The latest integrated gate passed 43 test files/335 tests, typecheck, lint,
formatting, and production build. A named,
isolated local Compose stack on loopback port 43231 passed health and authenticated
HTTP route checks before the latest query changes, including the direct artifact
query and transaction detail. Its updated image did not finish building.
In-app browser discovery returned no available browser, so no visual browser gate
has passed. An independent reviewer identified the existing report service's
unbounded server-side transaction scan for lifetime summaries, a low-probability
count/page snapshot race, and an unbounded linked-artifact projection per page row.
These are not browser collection fetches, but remain scaling/consistency limits. The
isolated stack and its synthetic PostgreSQL/MinIO volumes were removed after the
failed build attempts. No new-query PostgreSQL smoke or new-layout browser check
passed. The pre-existing application on port 43230 was not touched.

## BILL-T32 follow-up in progress — 2026-09-24

The user confirmed classification after CommBank import, Stripe row review before
confirming import (not payout-to-bank reconciliation), and existing PDF selection
only. The latest screenshots show a blank blue New transaction action, constrained
desktop content and uneven sidebar links, a horizontally scrolling mobile nav,
crowded reconciliation form fields, a transient-only CommBank confirmation step,
native confirmation boxes for reversible classification, and insufficient kind-aware
bank-row prefill. The current form already supports linked available invoice PDFs,
but the control is buried and absent when none are available.

Checklist for this follow-up:

- [x] Fix transaction action contrast and desktop/sidebar/mobile layout in code.
- [x] Make manual form container-responsive, kind-aware, and expose PDF selection.
- [x] Make bank-row creation prefill only safe source-derived fields and restrict
      create-and-match kinds to compatible signed cash effects.
- [x] Add explicit CommBank confirmation and post-import review path.
- [x] Add paged Stripe preview and approval before atomic import.
- [x] Replace native confirmations with direct reversible actions or app dialogs.
- [x] Run static, mounted-component, independent source review, and build gates.
- [ ] Run disposable PostgreSQL/MinIO import and overlap-concurrency gates.
- [ ] Run rendered browser, responsive, keyboard, and populated-workflow acceptance.

The 24 September gate passed 47 test files/377 tests, TypeScript, ESLint, Prettier,
and production build. A mounted CommBank interaction test proves row review does not
call import, the confirmation page is distinct, and only its final action calls
import. Independent acceptance review found no remaining production defect in the
requested behavior; viewport styling was source-checked only. In-app browser
discovery returned no target, so no revised-layout browser acceptance is claimed.
The current implementation has not been exercised against disposable PostgreSQL and
MinIO in this follow-up; the earlier 23 September synthetic gates predate it.
The 23 September report-scaling and filtered-list return-navigation limits remain.

## BILL-T32 operator-feedback correction — 2026-09-24

The user supplied populated screenshots showing a narrow Banking nav group, raw
bank-row detail dominated by inferred hints and source running balance, a bank-row
creation form that appears to do nothing when a new PDF is selected, and a browser
`TypeError: s?.trim is not a function` after manual creation.

Verified causes before implementation: `.app-nav-group` is a grid without an
explicit full-width track; `createBankTransactionPrefill` writes a parsed
counterparty hint directly into the transaction; the parser derives metadata from
free-text bank descriptions; Reconcile's create-and-match handler rejects selected
new PDFs and places the explanation above the form; the detail route calls `.trim()`
on `invoiceDate`, while the repository passes PostgreSQL DATE values through and the
local `pg` DATE parser returns a `Date` object. The browser exception is therefore
not a server-operation error. No live user data was inspected.

Confirmed implementation boundary: allow PDF upload within create-and-match; keep
source-derived values and historical category/tax suggestions opt-in; do not infer
`foreign_tax_included` solely from a non-AUD currency. The tax section should be
expanded for non-AUD documents and present an explicit suggestion. Work checklist:

- [x] Normalize transaction DATE fields and repair detail rendering/error reporting.
- [x] Make the Banking sidebar group full width.
- [x] Remove unapproved inferred prefill/detail fields and source running balance UI.
- [x] Upload new PDF evidence in Reconcile with local progress/error feedback.
- [x] Add opt-in source, category, and foreign-tax suggestions.
- [x] Run focused and integrated code gates: 48 test files/392 tests, typecheck,
      lint, formatting, and production build all passed.
- [x] Complete independent code/test review. No new blocking defect found;
      upload-start response loss remains a P2 idempotency gap for follow-up.
- [ ] Verify rendered browser and disposable PostgreSQL/object-store paths.

## BILL-T32 operator follow-up — 2026-09-24

The user confirmed the local-password login works at `127.0.0.1`; `localhost`
is outside the configured exact-origin contract, so authentication remains
unchanged. The screenshot of an international transaction fee demonstrates that
description stripping produces a false counterparty suggestion. The approved
correction removes that inference, while keeping source facts separate from an
invoice date. The existing PDF filename parser is to be reconnected as an
explicit, blank-fields-only suggestion. Action styling is also to be repaired.

- [x] Remove description-derived counterparty hints from new CommBank rows and
      reconciliation, including legacy metadata.
- [x] Restore opt-in supplier/date/reference suggestions from matching PDF
      filenames in the transaction form.
- [x] Align table links and edit-page Void/save feedback styling.
- [x] Run focused/full gates and independent code review. Final integrated
      validation passed 48 test files/400 tests, typecheck, lint, formatting,
      and production build. The independent reviewer found no production defect
      in inspected behavior; responsive rendering remains unverified because
      browser discovery returned no available browser.

## Navigation contrast and tentative future scope — 2026-09-24

The user approved a stronger active child-navigation state and asked to record
dark mode, local Codex MCP proposal ingestion, and reconciliation throughput as
future milestones. `.app-nav-link--child[data-active="true"]` now uses the navy
accent with white text. The roadmap contains BILL-M5/T33 (candidate review and
save/match-and-next), BILL-M6/T34 (local stateless Codex MCP proposals requiring
Folio approval), and BILL-M7/T35 (dark mode), all explicitly tentative. Remote
MCP is later and remains gated by public-exposure work. Open behavior choices
are recorded in each milestone rather than silently decided.

Verification: typecheck, lint, formatting, 48 test files/400 tests, and build
passed. No browser rendering was performed for this CSS-only change; the user
must rebuild the local image to view it in the running Compose app. No live
data, credentials, or environment values were inspected.

## Bulk source uploads and currency-aware tax defaults — code complete, 2026-09-24

The user confirmed multi-file selection for Stripe Balance Summary itemised
CSVs, CommBank transaction-history CSVs, and invoice/evidence PDFs. CSVs require
independent per-file review and confirmation; PDFs are uploaded as reusable
artifacts without transaction creation. Bank-statement PDF parsing is out of
scope. BILL-M4B/T36 records the implementation and verification checklist.

Stripe and CommBank import pages now retain multiple selected CSVs and review
each file before its independent confirmation. A new `/artifacts/upload` route
uploads multiple invoice/evidence PDFs without creating transactions; a known
transient S3 confirmation failure retries against the same artifact ID, while
an uncertain confirmation directs the operator to Artifacts before retrying.
Shared Imports navigation distinguishes the three source profiles. Stripe's
Transactions > All activity export has distinct headers from the supported
itemised Balance Summary report; the parser identifies it and the client
explains the required report.

For BILL-M4C/T37, new manual and bank-row-created expense drafts start at
Australian GST included for AUD and foreign tax included for non-AUD, following
currency until a manual treatment choice. Existing transaction edits do not
auto-switch. Stale auto-suggested Australian GST amounts clear; manually entered
amounts are retained. Owner funding remains no tax, and GST-credit fields are
unchanged. This document classification is not a GST-credit claim.

The integrated gate passed 50 test files/422 tests, lint, formatting, and
production build/typecheck. Read-only PDF retry and tax-default reviews found
no material defect in their inspected boundaries. Rendered keyboard/mobile
acceptance is outstanding because the in-app browser reported no available
browser. No live import, database/S3 integration, or Docker-backed dependency
test was performed for this code-only slice.

## Import batch and artifact lifecycle follow-up — code complete, 2026-09-24

The user approved a shared CSV workflow: upload files, explicitly add each to
the batch or reject it, review the accepted batch, then confirm with one action.
Confirmation remains per-file atomic under that one action, so partial outcomes
are shown by file. Imports becomes a tabbed workspace containing Stripe CSV,
CommBank CSV, and PDF evidence flows. Other Add actions link to its tabs.
Banking and other top-level pages should share the Folio design system.

The user explicitly approved permanent deletion for rejected, unlinked CSV
artifacts only, with confirmation. This requires a durable rejected state,
exact-version S3 deletion, and metadata deletion. Linked/imported evidence
must remain protected. Artifact downloads should use original filenames via
signed Content-Disposition. BILL-M4D/T38–T40 records acceptance gates.

The first artifact-lifecycle worker did not start because its assigned model
was at capacity; a second worker completed the same scoped backend task.

Verified boundary: CommBank CSV previews remain pending until import, while
Stripe previews are available; rejection must handle both states without
creating bank rows. Existing Stripe import renames `source_artifacts.filename`,
so new uploads need a separate nullable original filename. Legacy Stripe
artifacts cannot recover the prior original name and will fall back to the
stored display filename for download.

Completed checklist:

- [x] Stripe and CommBank upload → Add/Reject per file → combined batch review
      → one Confirm import; per-file atomic outcomes and failed-file retry.
- [x] Tabbed `/imports/stripe`, `/imports/commbank`, and `/imports/pdf` routes;
      old import URLs redirect; navigation and shared top-level styling updated.
- [x] Persistent rejected CSV state, visible Artifacts filter/badge, explicit
      deletion dialog, linked-artifact database guards, exact-version S3
      deletion, and original-filename signed downloads for new uploads.
- [x] Independent source/test review; no confirmed functional defect.
- [x] Final unit 50 files/445 tests, isolated PostgreSQL 6/6 (including link
      concurrency), lint, formatting, and production build/typecheck.
- [x] Rebuilt local Compose Folio image; `/health` returned Folio ok.
- [ ] Rendered responsive and keyboard QA: no browser was available to this
      session. Repeat when a browser connection is available.
- [ ] Exercise rejected exact-version deletion end-to-end against local MinIO;
      service/storage mocked tests pass, but this boundary was not run live.

Local dependency note: workspace disk-space pressure required moving the
regenerable `node_modules` tree to
`/Volumes/Data/tmp/folio-deps.18bPUk/node_modules` and leaving a symlink in the
repository. The target is temporary; reinstall dependencies if that directory
is removed. Source and persistent data were not deleted. Isolated test
PostgreSQL/MinIO containers were stopped after verification; their test-only
volumes were retained.

## BILL-M4E correction and cleanup — code complete, 2026-09-24

The user reported `confirm_commbank_import` failing with PostgreSQL P0001
`Artifact links must reference an available artifact`, and showed unlinked
pending CSVs and available PDFs lacking Delete. Source review confirmed the
bank importer inserted provenance links before transitioning the CSV from
pending to available; BILL-T41 moves that transition earlier within the same
transaction. The user approved the fix and asked for all visible unlinked
artifacts to be deletable, plus a non-blocking existing-filename warning.

The pending-upload deletion boundary requires care: a presigned PUT lasts
five minutes while pending/abandoned artifacts have no pinned version. The
user confirmed exact-filename, same-profile, non-blocking warnings on all
three upload tabs and chose immediate deletion with explicit acceptance of
the late-PUT orphan risk. CommBank confirmation now transitions the artifact
to available before provenance links are inserted, within the same database
transaction. Failed link insertion rolls back the transition and bank rows.
Deletion reserves a non-linkable `deleting` state under row lock, checks both
link tables, removes all enumerated versions for the exact S3 key, then removes
metadata. Failed storage cleanup leaves a retryable row. The Artifacts page
offers Delete for unlinked pending and available artifacts; linked artifacts
remain protected. Upload warnings are advisory and compare case-insensitive
exact filenames within one profile on all three tabs.

Verification: 457 unit tests passed (one opt-in test skipped there), 12/12
isolated PostgreSQL tests passed, and the opt-in MinIO version-deletion test
passed separately. Lint, formatting, and build passed. The rebuilt local
Compose service is healthy and `/health` returned HTTP 200. Test-only
PostgreSQL/MinIO containers were stopped; their volumes were retained. The
in-app browser had no available instance, so rendered interaction and keyboard
acceptance remain open. Independent read-only review found no confirmed code
defect. The exact-key object-store race has not been exercised end-to-end.
No live uploaded content or user PII was inspected.

## BILL-M4F source navigation and tables — code complete, 2026-09-24

The user requested fixed-width supporting table columns so Description fills
remaining desktop space in Banking Activity and Transactions, plus consistent
`16 May 2026` date presentation. They also approved merging Imports and
Artifacts into one top-level Sources page with Stripe CSV, CommBank CSV, PDF
evidence, and File library tabs. The redundant PDF upload button should be
removed. Because Folio is pre-v1, the user explicitly rejected a compatibility
redirect for `/artifacts`; internal links should be updated to
`/imports/library` and the old route removed. Both implementation tasks are
complete. The integrated unit suite passed 459 tests, and lint, formatting,
and build passed. The rebuilt local Compose service returned HTTP 200 from
`/health`; `/imports/library` resolved and `/artifacts` returned HTTP 404 as
intended. Independent read-only review found no confirmed regression. Rendered
responsive and keyboard acceptance remains open because no in-app browser was
available. The global Add menu still has a PDF upload shortcut; the redundant
button removed was the one inside the File library.

## BILL-M6 MCP proposal specification — prioritised draft, 2026-09-24

The user asked to prioritise MCP support and flesh out the plan while
BILL-M4F implementation continues. [docs/mcp-plan.md](../docs/mcp-plan.md)
is a tentative first-slice contract: Codex submits durable proposals through
a local MCP endpoint; only the Folio UI can approve and commit. It proposes
read tools, idempotent batch submission/status, existing artifact references,
row-level review, and reuse of transaction/reconciliation validation. The
user confirmed row-level review with approve-selected and existing artifact
references only, with uploads left in Sources. The user also confirmed
loopback-only stateless Streamable HTTP with a restricted bearer credential.
Remote exposure and OAuth remain out of scope. No MCP code is authorised or
started. This proposal-inbox/approve-selected design was superseded by the
26 September 2026 draft-in-Reconcile revision below.

## BILL-T46 table readability and icon actions — code complete, 2026-09-24

The user showed the first fixed-rem column pass causing Type, Amount, State,
and Actions to wrap mid-word in Transactions. They approved a correction with
readable minimum widths, Description using the remainder, horizontal scrolling
before card layout, and compact icon Actions in both Transactions and Banking
Activity. Tooltips must work on hover/focus, icon controls need accessible
names, and mobile cards retain text labels. The imported-row `Read-only import`
text is a non-action and should leave the Actions cell. Rendered width checks
are part of acceptance. The shared icon control now has accessible labels,
44px targets, and portal tooltips on hover/focus; the mobile card breakpoint
restores visible text. Transactions has a 72rem minimum table width and
horizontal scrolling above 760px; Banking Activity has a 56rem minimum table
width. The integrated 461-test suite, lint, formatting, and build passed. The
rebuilt local Compose app is healthy and `/health` returned HTTP 200.
Independent read-only review found no confirmed defect. The in-app browser
reported no available instance and no local browser runner was installed, so
desktop and narrow-width rendered checks remain open.

## BILL-T32 reconciliation creation follow-up — code complete, 2026-09-25

The user approved automatically applying verified bank-source fields during
transaction creation and a prominent link to the matched Folio transaction.
The Reconcile form no longer has an Apply source hints step. Choosing a kind
prefills imported posted date as settlement date, AUD movement magnitude as
settlement amount, and raw description; positive owner funding also retains
its safe document amount. Supplier, invoice date, and occurrence date remain
blank. A View matched transaction link appears on the selected row after
successful create-and-match and when a matched row is revisited. Focused tests
passed (20); the full suite passed on rerun (462), and lint, formatting, and
build passed. One unrelated transaction-workflow focus assertion failed on
the first full run, then passed alone and in the full rerun. Rendered browser
acceptance remains open. Independent focused review found no production defect;
the link's immediate fallback and persisted revisit paths were tested, but not
the same-mount loader refresh transition. The local Folio Compose app was
rebuilt and restarted; `http://127.0.0.1:43230/health` returned HTTP 200.

## BILL-T32 presentation correction — code complete, 2026-09-25

The matched-transaction CTA had dark text on a dark background because the
selected-panel ordinary-link selector overrode its primary-button color.
Primary matched links now retain white text in normal, visited, hover, and
focus states; secondary links are excluded from that override. Transaction
detail no longer repeats the description under its title, retaining it under
Record details, and its Edit transaction link is styled as a secondary button
with visible keyboard focus. The full unit suite passed (463 tests), as did
lint, formatting, typecheck, and build. Independent CSS review identified and
prompted the secondary-link exclusion. The final local Folio Compose image was
rebuilt and restarted; `/health` returned HTTP 200. The in-app browser was
unavailable, so rendered visual acceptance remains open. Historical
counterparty suggestions remain a separate unresolved issue: the database
query currently includes only manual supplier expenses and credits; no
user example or scope decision has yet confirmed whether to broaden it.

## BILL-T32 compact reconciliation queue — code complete, 2026-09-25

The user confirmed that the Reconcile bank-row queue should be more compact
and independently height-limited so it cannot extend below the transaction
form. Cards now show date and state above description and signed amount. The
row list scrolls inside a 36rem cap, reduced to 20rem below 760px; pagination
remains outside the scroll viewport. Selection and page changes bring the
selected row into that viewport by changing only the queue's scrollTop.
Focused interaction tests passed (13), as did the full unit suite (464 tests),
lint, formatting, and build. Independent static review found no production
defect. The local Folio Compose image was rebuilt; proxied `/health` returned
HTTP 200. Browser-rendered sizing, focus, and scroll behavior remain unverified.
The user reported that historical counterparty suggestions appear again; no
suggestion-query change was made.

On 25 September 2026, the user approved increasing the wider-screen queue
cap from 30rem to 36rem. The narrow-screen 20rem cap is unchanged. Formatting
and production build passed; the local Folio Compose app was rebuilt and its
proxied `/health` returned HTTP 200. Rendered sizing remains unverified.

## BILL-T32 explicit creation suggestions — code complete, 2026-09-25

The user requested direct transaction-kind creation buttons in Reconcile and
explicit actions to use bank payment values or a selected invoice PDF's
filename. The PDF scope is filename parsing only, primarily invoice date and
reference; PDF contents are out of scope. The implementation must not silently
infer document fields or overwrite edited values. A later explicit selected-PDF
action may replace its own edited field. Bank AUD amount must not be
copied into an already foreign-currency document field. Reconcile now exposes
direct `Create …` buttons for sign-compatible kinds. Bank-backed non-funding
forms have an explicit Use payment values action that fills only blank invoice
date and AUD document amount/currency; existing positive owner-funding prefill
remains unchanged. Selected existing invoice PDFs with a parseable filename
offer source-specific date/reference application and a separate optional
supplier action. Multiple PDFs do not silently choose a suggestion source.
Independent review found no production defect; its two test coverage gaps
were closed. The full unit suite passed (471 tests), as did lint, formatting,
and build. The local Folio Compose app was rebuilt and returned HTTP 200 at
`/health`. Rendered browser acceptance remains open.

## BILL-T32 selected-PDF suggestion controls — code complete, 2026-09-25

The user requested a compact per-PDF filename line and separate supplier,
date, and reference buttons. These buttons must remain available after
application so a later manual change can be restored explicitly. For a parsed
supplier, prefer a unique matching historical counterparty label; otherwise
split camel-case words, such as `GoogleWorkspace` to `Google Workspace`.
Selected PDF controls now show `PDF N: filename` and persistent, separate
Apply supplier/date/reference buttons. Explicit reapplication replaces only
the selected field; Apply date also updates an auto-managed occurrence date,
but preserves a manually edited occurrence date. New-upload behavior remains
unchanged. Independent review found no production defect; its ambiguous
historical-name test gap was closed. The full unit suite passed (472 tests),
as did lint, formatting, and build. The local Folio Compose app was rebuilt
and returned HTTP 200 at `/health`. Rendered browser acceptance remains open.

## Bank foreign-payment hint actions — code complete, 2026-09-26

The reconciliation transaction form now offers persistent, independent actions
for a valid parsed foreign currency and amount. Applying them sets document
currency and invoice total respectively, without changing the imported AUD
settlement. Bank-description hints remain unverified; neither value is
prefilled. Focused interaction tests and the full unit suite passed (474 tests,
one skipped), as did TypeScript, targeted ESLint, and formatting of changed
source files. Rendered browser acceptance remains open.

## BILL-M6 draft-in-Reconcile revision — 2026-09-26

The user rejected a new Proposals page and first-class AI/MCP UI. The intended
workflow is now MCP-created manual drafts and match suggestions shown in the
existing Reconcile suggestions area. A human uses the ordinary transaction
editor to promote a draft to recorded, then explicitly matches the recorded
transaction to the bank row; an intermediate recorded-but-unmatched state is
accepted by the latest design direction. A temporary neutral draft badge and
an explanatory note are sufficient user-facing cues. Internal credential,
idempotency, and intended-bank-row provenance remains necessary because notes
are editable. `docs/mcp-plan.md` and `docs/roadmap.md` now reflect this
direction. The user confirmed recording one reviewed draft at a time, with no
bulk-record approval in the first slice. The earlier top-level Proposals
wireframes are superseded by the Reconcile wireframes in `docs/mcp-plan.md`.
No MCP code has been written. The 2026-07-28 MCP transport revision remains an
integration gate with installed Codex.

## BILL-M6 individual submission and artifact-read scope — 2026-09-26

The user deferred batch submission: one idempotent draft or match suggestion
per MCP call is enough initially. They also requested an artifact-retrieval
tool. The scope of retrieval is still being clarified: metadata, original PDF
contents, or PDF and CSV contents. Existing Folio downloads issue five-minute
signed URLs for available versioned artifacts, but MCP reachability and read
authority must be designed explicitly. `docs/mcp-plan.md` and the roadmap now
reflect individual submission; no MCP code has been written.

## BILL-M6 artifact intake and import review — 2026-09-26

The user expanded the first local Codex workflow: provide an invoice or monthly
export to Codex; Codex extracts tentative data, uploads the original artifact,
then submits individual draft transactions; the operator reviews and records
drafts in Folio. They confirmed metadata and original-content retrieval for
all artifact profiles as separate capabilities, a two-step upload with a
short-lived PUT URL and confirmation, and that uploaded Stripe/CommBank CSVs
should enter the existing per-file/batch import review rather than be
auto-imported. No actual artifacts or personal data were read.

`docs/mcp-plan.md` and `docs/roadmap.md` now describe this design. Current
code confirms a significant bridge is required: the CSV batch queues live in
browser component state, CommBank artifacts stay pending until import
confirmation, and generic upload confirmation rejects bank profiles. MCP
upload cannot simply call generic confirmation and assume that a CSV is ready
for review. The plan calls for a durable intake listing and a human preview,
Add to batch/Reject, combined review, Confirm import sequence. The user has
since confirmed that metadata may show all artifact states while original
bytes remain limited to approved, available, versioned artifacts. MCP binary-result
compatibility with installed Codex also remains unverified. No MCP code or
schema has been written.

Follow-up: the user clarified that all uploaded artifacts, whether submitted
by Codex or through the UI, should await human review. This includes both
Stripe and CommBank CSVs, with duplicate warnings in both paths. The proposed
post-upload `awaiting_review` state and shared Sources review intake are now
documented in `docs/mcp-plan.md`; existing `pending` and `available` semantics
do not represent this boundary consistently.

The user then confirmed that a draft may cite an unapproved PDF ID as proposed
evidence, but Folio must block recording with that PDF until artifact approval.
The approved evidence link is created only after revalidation at save. They
also confirmed duplicate-warning signals for both upload paths: exact
same-profile checksum, overlapping source rows, and same-profile filename;
filename alone is a weak, non-blocking signal. The user then confirmed that
Codex must not draft Stripe CSV rows: its CSV upload goes to human import
review, and confirmed Stripe import alone creates those transactions. No MCP
code has been written.

## Git checkpoint and commit discipline — 2026-09-26

The user requested that work completed so far be checked in and that future
user-verified fixes and tasks be committed as they are completed. The initial
project snapshot was committed locally as `50f26b9` (`Initial Folio application
snapshot`), following the existing LICENSE-only commit. It contains the app,
migrations, docs, and agent handoff, but excludes the `node_modules` symlink,
local `docs/samples/` screenshots, and secret-like paths. The worktree was
clean immediately after that commit. Do not push without a separate request.
For subsequent work, commit coherent, user-verified changes after appropriate
validation and a staged-file audit; leave incomplete or unverified work
uncommitted and report it explicitly.

## BILL-M6 final pre-implementation choices — 2026-09-26

The user confirmed three remaining scope choices. A draft may be submitted
before CommBank CSV import using the uploaded artifact ID plus source row
number; once the human import creates a bank row, Reconcile shows the draft
beside it without matching automatically. The first MCP upload/review release
supports invoice-evidence PDFs, Stripe balance CSVs, and CommBank
transaction-history CSVs only. Metadata and original-content reads still
cover every registered profile, subject to approved/available state for bytes;
NAB CSV and CommBank statement PDF uploads wait for their own import workflows.
Each local MCP credential binds one permitted default transaction owner;
Codex cannot select another owner, but the human reviewer may change it before
recording. `docs/mcp-plan.md` and BILL-M6 in `docs/roadmap.md` now reflect
these choices. No MCP code has been written. Remaining work is implementation
and verification, including Codex protocol/binary handling and the durable
artifact-review intake bridge.

## BILL-M6 retrieval, privacy, and durable inbox boundary — 2026-09-26

The user deferred MCP original-file retrieval. The first release retains
paginated artifact metadata discovery but has no original-file read tool,
download URL, or read-content credential scope. The existing Folio UI
download behavior is unchanged. This supersedes earlier MCP content-read
scope statements above and in the previous plan revision.

Validated UI and MCP uploads must persist as Awaiting review and reappear
after a page reload. `Add to batch` is only temporary browser selection;
selection resets on reload, without discarding uploaded files. The plan uses
the artifact lifecycle as the durable inbox, not a new persisted batch entity.

The user authorised a narrow per-file exception to the repository's
no-PII-reading instruction: Codex may inspect an original invoice/export
only when the operator explicitly submits that specific file for review or
approves its read. Metadata discovery and upload do not grant permission to
inspect contents; background reads remain prohibited. No real file has been
read for this planning decision. `docs/mcp-plan.md` and BILL-M6 in
`docs/roadmap.md` have been updated; no MCP code has started.

## BILL-M6 implementation checkpoint — 2026-09-26

The user authorised implementation with synthetic functional tests only;
end-to-end testing is deferred. The shared artifact-review core now confirms
validated uploads into `awaiting_review`, requires explicit PDF approval, and
publishes CSV artifacts only through human-confirmed import. Stripe and
CommBank queues can reload validated files by artifact ID after a page reload;
batch selections remain temporary. Manual transaction upload now stages a new
PDF for explicit preview and approval before the transaction can be saved with
that evidence. The focused tests, full synthetic Vitest suite (488 passed, one
skipped), typecheck, scoped ESLint, and `git diff --check` passed at this
checkpoint. No live data or end-to-end services were used.

MCP data/provenance and loopback transport are being implemented on separate
file surfaces. Neither is integrated yet. Remaining gates include credential
provisioning, all eight scoped tools, duplicate warnings shared by UI/MCP,
draft/PDF promotion rules, Reconcile suggestion UI, and protocol/security
verification with synthetic data. Do not represent BILL-M6 as complete.

The user further confirmed that artifact filenames will not contain PII.
`list_artifacts` may therefore return original filenames without per-file
approval or redaction. This is an operator-provided convention, not a
guarantee verified by Folio; it does not authorise original-file content
reads. No artifact metadata or original files were inspected for this decision.

## BILL-M6 synthetic implementation checkpoint — 2026-09-26

The loopback-only stateless MCP server, six credential scopes, eight domain
tools, durable credential-bound upload intents, draft and match-suggestion
persistence, Reconcile suggestion cards, proposed-PDF review gate, and shared
CSV duplicate warnings are integrated. The MCP upload profiles are invoice
PDF, Stripe itemised CSV, and CommBank history CSV; original-file retrieval is
absent. Repeating a begin-upload key with the same canonical payload reuses
the pending artifact and signs a fresh URL; conflicting payloads fail. Human
PDF approval, CSV import, draft recording, and bank matching remain separate
actions. Stale and resolved suggestions have explicit warnings.

Unified synthetic `pnpm test` passed: 63 files and 559 tests, with one skipped.
`pnpm typecheck`, `pnpm lint`, and `git diff --check` passed. No live database,
real artifact, browser E2E, or Codex-to-Folio smoke test ran, per the user's
testing boundary. The deferred PostgreSQL evidence trigger has structural
tests but has not been executed against a live database. Before operator use,
apply migrations 0010–0012 in the local environment, provision a distinct
credential actor and permitted owner, issue a restricted bearer credential,
and verify the local connection. Do not claim rollout complete until those
steps succeed.

## BILL-M6 web-listener integration — 2026-09-26

The user approved moving MCP from a separate process to the existing Folio
server. `/mcp` is now a TanStack server route, off by default; set
`FOLIO_MCP_ENABLED=true` in the Folio server process to enable it. Local Codex
should target `http://127.0.0.1:43230/mcp`. Credential issuance and hashed
storage did not change. Synthetic route/protocol tests cover the flag,
stateless requests, bearer verification, Host/Origin checks, and limits.
The full synthetic suite passed 564 tests (one skipped); production build,
typecheck, lint, scoped formatting, and diff checks passed.
Because the route shares the web listener, production enablement would expose
it through the public Folio path unless the proxy blocks it. Do not enable it
remotely without an explicit network-access decision. Live migrations,
credential issuance, and Codex connection remain unverified.

## BILL-M6 credential setup discovery — 2026-09-26

`pnpm mcp:credential scopes` now lists six scopes and descriptions without
database access. `pnpm mcp:credential create` and `revoke` expose the existing
credential operation. Admin → Users has a generic Copy ID action so operators
can identify the administrator, dedicated actor, and default owner without a
database query. Synthetic clipboard success/failure and CLI parsing tests pass.
The full synthetic suite passed 567 tests (one skipped); production build,
typecheck, lint, and diff checks passed. No real user records, credentials,
database, or Codex connection were accessed. The changes remain uncommitted
pending operator verification.

## BILL-M6 CLI diagnostics — 2026-09-26

Credential issuance and `pnpm migrate` now emit safe operation/stage/code
diagnostics on failure. The migration script reports committed migration IDs
on success, identifies a failing migration ID, and logs rollback failures
separately. A synthetic migration-0011 database failure passed checks for
rollback and no raw database detail in output. This does not establish the
cause of the operator's current credential failure: retrying with the new
command will show whether it is missing migration (`42P01`), ineligible user
(`USER_INELIGIBLE`), or another condition. No live user/database details were
read and no credential was issued.
The full synthetic suite passed 572 tests (one skipped); production build,
typecheck, lint, scoped formatting, and diff checks passed.

## BILL-M6 credential participant diagnostics — 2026-09-26

The operator's retry returned `USER_INELIGIBLE` with a distinct actor. The
credential repository now reports which participant fails and whether the
reason is missing, inactive, wrong role, or not distinct. The CLI renders a
fixed safe code such as `ACTOR_NOT_FOUND`, without IDs or personal data.
Failures still roll back before insertion. No live database/user records were
read; the exact operator failure requires a retry with the updated command.
The full synthetic suite passed 578 tests (one skipped); production build,
typecheck, lint, scoped formatting, and diff checks passed.

## BILL-M6 local MCP connection and operator skill — 2026-09-26

The operator generated a bearer credential and demonstrated an authenticated
`folio_ping` call to `http://127.0.0.1:43230/mcp`: HTTP 200 with `pong`. The
earlier 500 `Only HTML requests are supported here` was reproduced with a
doubled `/mcp/mcp` path; the exact `/mcp` route returned 401 without a token.
A synthetic `initialize` then `tools/list` exchange returned the ping tool.
The operator reports that a fresh Codex CLI session discovers Folio tools, but
the previously resumed session remains failed even after restarts and a fork.
Do not assume a Folio endpoint failure from that old session. The cause of its
stale failure is unproven. No original file, live upload, draft submission,
human approval, or import was exercised through Codex.

The repo-local `.agents/skills/folio-mcp/SKILL.md` is operator-facing: it
coaches a fresh session through authorised file intake, scoped MCP tools,
uncertain evidence, and the human review boundary. It does not coach MCP
server implementation. `docs/mcp-plan.md` has the full contract. The current
MCP code and docs remain uncommitted pending user verification of the complete
workflow. The untracked `.codex/config.toml` was neither read nor staged; it
may contain local configuration or credentials and must not be committed by
default. Next work is a read-only tool-discovery check with the new skill in a
fresh Codex CLI session. File upload, draft submission, and Folio review are
stateful cross-system smoke tests and require a separate user-approved test
boundary; the user deferred E2E testing.

## BILL-M4G query and navigation code completion — 2026-09-27

Sources now has Stripe CSV, CommBank CSV, PDF evidence, and File Library
sidebar children. Transactions, Banking Activity, Bank Import History, and
File Library have ordered, reorderable sort clauses; the latter three use
Transaction-style composable filter builders. Queries are URL-backed and
execute filters/sorts before pagination with stable ID tie-breaks. The File
Library operation normalizes existing scalar callers so upload review and MCP
artifact listing retain their contract.

Verification passed: 68 test files and 602 synthetic tests (one test/file
skipped), TypeScript, ESLint, scoped Prettier, production build, and
`git diff --check`. No populated browser, live database, or E2E run occurred,
per the user's test boundary. The operator still needs to review the rendered
tables and navigation. The current task changes have not been committed;
commit only after user verification. Preserve unrelated dirty MCP work and do
not read or stage the local `.codex` directory by default.

## Operation logging refinement — 2026-09-27

`folio_access` retains its name but logs only failures. `/health` suppresses
the access check and health-operation logs, and the root error boundary does
not report health failures as client-render events. Structured Folio events
now include the incoming HTTP method and pathname without query parameters.
Successful operation records omit correlation IDs; failures retain matching
log/UI references. Unlogged health failures have no reference.

Verification passed: 69 test files and 608 synthetic tests (one test/file
skipped), TypeScript, ESLint, scoped Prettier, production build, diff check,
and independent read-only review. No live HTTP or browser test was run. The
changes remain uncommitted pending operator verification; preserve unrelated
MCP changes and the untracked `.codex` directory.

## BILL-M4H code completion and MCP diagnostic checkpoint — 2026-09-27

Transactions, Banking Activity, Bank Import History, and File Library now show
one mixed filter/sort builder. Mixed clause order persists in route URL state;
filters retain AND semantics and sort priority follows the occurrence of sort
rows. Reports is nested under Overview in both sidebars. Folio structured
logs omit request method/path for `/_serverFn` requests and retain pathname-
only logging for other requests. Existing server filter/sort contracts and
`/reports` route remain unchanged.

Verification passed: 69 test files and 620 synthetic tests (one skipped),
TypeScript, ESLint, scoped Prettier, production build, diff check, and
independent mixed-builder review. No rendered browser E2E was run. The
current changes remain uncommitted pending user verification.

MCP remains undiagnosed: unauthenticated `http://127.0.0.1:43230/mcp`
returned HTTP 401, but no authenticated Codex request was observed. Ask the
operator whether the failure reproduces in a fresh Codex CLI session and for
redacted error lines from `/mcp`, `codex-tui.log` (one-off
`codex -c log_dir=./.codex-log`), or
`docker compose logs --follow --tail=100 folio`. Do not read secrets, bearer tokens, local `.codex` configuration, or
raw logs without explicit permission. Do not infer a Folio protocol defect
from the stale resumed-session failure alone.

## Live builders and proposed-draft UI checkpoint — 2026-09-27

Transactions, Banking Activity, Bank Import History, and File Library now
apply valid mixed filter/sort changes after a 300 ms debounce, replacing the
current URL entry and resetting to page 1. Incomplete filter rows remain in
the builder. Remove controls are consistently ordered after movement controls
and rendered as secondary buttons. Transaction detail has header spacing.
The draft editor states that saving as recorded attaches an approved proposed
PDF; its filename suggestions are visible without selecting the PDF. Filename
parsing can suggest supplier, date, and reference, not an invoice total.

Focused synthetic verification passed: 94 route tests plus two draft-editor
affordance tests, TypeScript, ESLint, and production build. Rendered operator
review is pending. The existing React-Aria form interaction tests still fail
in isolation; one selected-PDF suggestion test fails in the same way as the
new suggested-PDF interaction, so no claim is made that those interactions
pass in the test environment. Do not commit this UI work until the operator
verifies it. Preserve unrelated dirty changes.

Next: the operator wants draft editing in Reconcile like transaction creation,
then an MCP tool that edits only drafts created by its own credential without
a revision token. Those changes are not implemented. MCP draft fields require
verified structured values; the invoice total cannot be inferred from the
filename. The MCP connection failure was resolved by starting the shared
Codex daemon from a shell with the Folio bearer token available; no Folio
transport change was required.

## Inline Reconcile draft editing and MCP patch tool — 2026-09-27

An approved proposed PDF now appears checked and locked in the transaction
editor's available-PDF list, with explicit text that Save draft does not
attach it and Remove proposed PDF excludes it. The existing record action
still attaches it only on promotion. The operator visually verified the
header spacing and filename-suggestion actions before this checkbox change.
The isolated header-spacing CSS was committed as `764a4a2`; the suggestion
and subsequent changes remain uncommitted pending review.

Reconcile suggestion cards now open an MCP-created draft within the selected
bank row's right panel. The embedded editor reuses the transaction workflow,
including file review and human Save draft / Record actions. Candidate and
classification controls are hidden while editing; recording refreshes the
queue but does not match the bank row. The existing full editor remains
available via the transaction page.

The new `edit_draft_transaction` MCP tool takes a non-empty patch under
`proposals:submit`. The repository checks that the same credential created
the transaction, locks the row, requires manual/draft status, preserves the
current human-selected owner and evidence links, validates the merged draft,
and never changes status or bank matches. There is no revision token as
requested; overlapping edits are last-writer-wins. Tool metadata correctly
does not claim replay-idempotence.

Focused synthetic tests for these additions passed, as did TypeScript,
ESLint, and a production build. Broader Reconcile form-interaction tests
still fail in the React-Aria test environment with `getMetaValue`; this was
also present before the inline editor. No live PostgreSQL, populated browser,
or E2E check was run. Operator visual verification and commit are pending.

## Draft deletion and unresolved queue checkpoint — 2026-09-27

The operator confirmed the MCP edit tool works; it and credential-eligibility
diagnostics were committed as `8cc8310`. The inline Reconcile editor and
proposed-PDF checkbox remain unverified in the working tree.

BILL-T57 is code-complete. Reconcile shows draft proposals only while their
transactions are drafts, including on resolved bank rows; existing-match
proposals remain until the bank row resolves, with stale ones warned. Both editors
offer confirmed permanent deletion of manual drafts. Deletion removes the
draft and its linked MCP submission, retaining artifacts; replay of the
original MCP request can
recreate the draft because its idempotency row is removed. The unresolved-only
queue filters server-side across pages and uses the unresolved count for
pagination. Switching the toggle clears selection and starts at page one; an
explicit bank-row URL may still show a resolved detail beside the filtered
queue.

The migrator now grants DELETE on transactions and MCP submissions. Run
`pnpm migrate` before exercising deletion with the app role in an existing
database. Nine relevant synthetic test files passed (133 tests), as did the
new queue interaction test, typecheck, lint, scoped formatting, build, and
diff check. Nine broader Reconcile form-interaction tests still fail in
React-Aria `getMetaValue`; they were not counted as passing. No live
PostgreSQL or populated browser test was run. BILL-T57 is uncommitted pending
operator verification.

## Reconcile filter regression and category-report decision — 2026-09-27

The operator found that selecting a bank row after enabling Unresolved only
cleared the filter. The installed TanStack Router decodes `unresolved=1` to
numeric `1`; the route validator did not accept it. Row links now write
`unresolved=true` and the validator also accepts numeric `1`. Two focused
synthetic tests pass; operator re-verification and check-in are pending.

The operator accepted a descriptive category breakdown on 28 September 2026;
a tax-deductibility workflow remains out of scope.

## Category-report checkpoint — 2026-09-28

BILL-T58 adds a period/category breakdown to Reports and its CSV. It uses saved
free-text categories, including custom values; missing categories are grouped
as Uncategorised by transaction kind. A Stripe sale's gross income and fee
expense appear in separate category rows. Supplier credits net against their
saved category. The table explicitly labels values as preparation effects, not
deductible amounts. Only recorded, eligible AUD income and expense effects
contribute; the existing report warnings and period totals are retained.

Fifteen focused synthetic tests passed, covering category totals, exclusions,
credit netting, formula-safe CSV, and report UI copy. TypeScript, targeted
ESLint, targeted source formatting, production build, and diff check passed.
No browser or live-data review was run. The entire roadmap file still fails
Prettier in existing sections. The category report, Reconcile unresolved-link
fix, and other unverified working-tree changes remain uncommitted pending
operator verification. Do not stage the entire dirty worktree as one commit.

## MCP, token administration, Reports, and session checkpoint — 2026-09-28

BILL-T59–T62 are code-complete and await operator review. MCP search includes
draft, recorded, and void statuses, exposing category and exact updatedAt.
`edit_transaction` replaces `edit_draft_transaction`; it accepts all prior
field patches only for a draft submitted by the same credential under
`transactions:draft`. A separate `transactions:categorize` scope permits
category-only edits on any transaction, including Stripe and void rows, with
an exact expectedUpdatedAt check. Match suggestions use
`bank_matches:suggest`; `get_submission_status` remains. Creation-time `*`
and known-resource wildcards (for example `transactions:*` and `artifacts:*`)
store only concrete current scopes.
Migration 0013 converts existing `proposals:submit` grants to the two equivalent
scopes. Run `pnpm migrate` before deploying this server build; the migration
was not applied during this session.

Administration → Access tokens lists metadata, creates one-time-visible bearer
tokens, and revokes after confirmation. Reports is top-level in desktop/mobile
navigation. Reports warnings carry structured transaction details and show
compact links, descriptions, and reasons. PDF filename references are optional.
Expired sessions request 401 from protected server functions, while protected
page navigation redirects to login with a validated return path; permission
denial requests 403. The direct serialized HTTP response remains untested.

Verification: 224 focused synthetic tests passed across 17 files. Full synthetic suite had
655 pass, 19 pre-existing React Aria form-interaction failures across two files,
and one skipped. TypeScript, ESLint, and production build passed. Independent
review confirmed wildcard expansion and redacted MCP edit-tool logging. No browser or live-database testing occurred. Do not
commit these unverified changes; preserve other dirty worktree edits.

## FY2025–26 partnership tax worksheet checkpoint — 2026-09-29

BILL-T63–T65 are code-complete, not operator-verified or committed. The
operator confirmed the business is a partnership, no GST registration yet,
and partner shares as percentages totaling 100%. The new `/reports/tax`
worksheet uses a row-level exact-AUD cash ledger, separate imported bank-row
readiness, explicit reasoned tax adjustments, generic partner labels, and
append-only reviewed snapshots (migration 0014). It exports the unreviewed
source ledger CSV and current reviewed CSV/JSON; reviewed exports reject stale
source fingerprints. `pnpm migrate` is required before using the page with
the app role; it was not run against live PostgreSQL.

Independent audit found an undated-draft readiness gap, negative source
refund/credit bases rejected without guidance, and UTC boundary dates shown
instead of Australia/Brisbane dates. These were fixed with synthetic regression
tests. Adjustment transaction links are now checked against selected-year
source rows. The fingerprint check and snapshot insert remain non-atomic: a
concurrent source edit can create an immediately historical snapshot, flagged
on the next load and blocked from reviewed export. Stripe preparation still
uses imported creation timestamps rather than funds-available timestamps;
income-tax timing requires operator/accountant confirmation. Folio cannot
prove that every relevant source file was imported, so the reviewer attests.

Final post-audit verification passed: 70 focused synthetic tests across 11
files, ESLint, production build including TypeScript, and diff whitespace
check. No live data, live database, or browser E2E was used. Operator review
of the FY worksheet and exports, then a scoped commit, remains the next step.

Reports worksheet-link follow-up on 29 September 2026: the original
`reports.tax.tsx` file generated `/reports/tax` as a child of `/reports`, but
the Reports page lacked an outlet. It was moved to `reports_.tax.tsx`, which
generates the same URL as a root child. The link now uses a primary-action
style. Generated route metadata, eight focused synthetic UI tests, and the
production build passed. Operator re-verification and check-in are pending.

Tax-preparation navigation follow-up on 29 September 2026: Reports now has
Preparation and Tax preparation children in desktop/mobile navigation, and
the in-page worksheet action was removed. The FY cash ledger includes
counterparty and category, and the source-row table shows a styled readable
transaction summary with reference/category/detail below instead of a raw
Stripe ID as the main label. Forty-eight focused synthetic tests across six
files, production build with TypeScript, ESLint, and whitespace check passed.
The running Docker image still needs a rebuild for the operator to see this
change; no live database, browser E2E, or commit was performed. Await operator
visual verification before check-in.

## Tax presentation and MCP status-tool retirement — 2026-09-30

The operator's screenshots demonstrated the Reports child navigation and a saved
reviewed result, then identified additional presentation defects. BILL-T66 is now
code-complete: Financial summary replaces Preparation; the worksheet back link is
removed; source income minus expenses is visible as Source net result; partner
rows show reviewed income, deductions, and net; included transactions sort
oldest-first with Date, Supplier/source, Type, Income, Expense columns. Supplier
labels use saved counterparties, falling back to Stripe or Manual. CommBank
provenance is not inferred. Adjustment controls use a responsive grid; partner
labels and the attestation checkbox are aligned. Report amounts display two
decimal places when possible and retain non-zero sub-cent digits; internal
money and exports retain their exact precision.

Partner component allocations share a common income/expense base and preserve
the existing deterministic net allocation. This keeps income minus deductions
equal to net for every partner and the columns equal to the saved totals, even
when fractional remainders exist. Existing snapshot data is unchanged. The
operator confirmed that partner identities should use actual Folio users in a
future slice; BILL-T68 records that requirement without changing the current
generic-label workflow.

BILL-T67 removes `get_submission_status`, its repository helper/type, and the
obsolete request-log identity. CLI/web creation, help, UI choices, and wildcard
expansion exclude `submissions:read`, while the stored/authenticated credential
schema retains it for compatibility. Existing credentials remain valid; no
scope-cleanup migration was performed. The MCP plan and operator skill now
explain exact-key, same-payload retries and transaction-status search.

Verification passed: 725 synthetic tests with one skipped, production build with
TypeScript, focused lint, and whitespace checks. The skill's existing frontmatter
and narrow instruction change were inspected manually; its bundled validator
could not run because the local Python installation lacks PyYAML. No live data,
database migration, browser E2E, Docker rebuild, or commit was performed. Rebuild
the Docker app for operator visual verification, then make scoped commits of
accepted changes; preserve the other pre-existing dirty files and local `.codex`
configuration.

## Matched transaction edits — BILL-T69, 30 September 2026

The reported P0001 came from migration 0007 rejecting any change to kind, settlement
date, settlement amount/currency, status, or source on a matched transaction. New
migration 0015 replaces the function, leaving the historical migration unchanged.
It allows edits preserving manual/recorded/settled eligibility and the exact signed
AUD settlement against the matched bank row. Date and same-direction classification
changes are allowed; invalid amount/currency/direction/status and voiding still require
explicit unmatch. No automatic unmatch occurs.

`updateManual` retains the bank-row-before-transaction lock order and revision check,
then uses the shared cash-effect calculation to reject incompatible edits before SQL.
`voidTransaction` now raises the same typed `BANK_MATCH_EDIT_CONFLICT`. The diagnostic
returns actionable guidance and HTTP 409 rather than exposing a raw PostgreSQL error.

Verification: 739 synthetic tests passed, one skipped; all eight dedicated disposable
PostgreSQL reconciliation tests passed. Only the synthetic `folio_t28_verify` schema
at port 55432 received migrations. No live data, live migration, app Docker rebuild,
or commit occurred. Deploy migration 0015 and rebuild before operator verification.
Independent read-only review found no production defect. A direct workflow test
confirms that the complete conflict guidance and reference survive the UI's error
sanitizer. The PostgreSQL test container was stopped without removing its volumes.

## Autocomplete polish — BILL-T72, 30 September 2026

User confirmed wider viewport-bounded dropdowns without horizontal scrolling,
focus-open suggestions, chips inside a single bordered control, and contains as
the default for new string filters; they also requested Add filter/Add sort below
the rows. These changes are implemented across all four builders. Saved operators
and numeric/date/enum defaults remain unchanged. Shared multi-select uses React
Aria Group so its popup trigger measures the whole chip/input container; ordinary
creatable fields use the shared popup styles and open on focus too.

Prior BILL-T71 manual-form failures were missing DOM test APIs, not PDF handlers.
`src/test/dom-setup.ts` now supplies absent PointerEvent, scrollTo and CSS.escape
for jsdom tests through Vitest setupFiles; selection helper no longer owns global
bootstrap. Native browser APIs are not replaced. Validation focus opens suggestions,
so tests Escape out before querying summaries. Manual-form suite passes all 50.
Full synthetic suite passes 773 tests with one skipped; production build,
typecheck, focused lint, formatting and whitespace checks passed. Browser geometry remains
unverified; operator rebuild and visual acceptance pending. No migration, live
data changes, browser E2E or Docker rebuild. Bulk actions still deferred.

Independent source review passed. It noted a pre-existing low-impact File Library
inconsistency: Add sort always seeds filename, so repeated additions can duplicate
sort keys rather than choosing an unused field. Deferred beyond this layout task.

## Counterparty suggestion completeness — BILL-T71, 30 September 2026

User approved collecting counterparties from all non-void transactions, including
drafts and imported records. Only the first query in `listEntrySuggestions` changed:
manual-source and supplier-kind restrictions were removed. Actor authorization,
trimmed distinct values, null/blank exclusion, stable sort and LIMIT 200 remain.
Category and supplier/category association queries are unchanged. Synthetic
regression includes CommBank and checks that source/kind/recorded-only predicates
are absent. No live records were inspected or modified; no migration is needed.

54 repository and 33 workflow tests passed; typecheck, focused lint, formatting and
whitespace checks passed. Extra manual-form checks failed 13 of 49 existing tests
around dropdown/PDF interactions; the form was not modified in this task. This
broader test failure remains for separate investigation. Rebuild for operator
verification. Bulk actions remain deferred, with no bulk page or edit endpoint.

## Searchable dropdowns and enum multi-select — BILL-T70, 30 September 2026

The operator confirmed app-wide dropdown replacement and enum multi-select filters.
Bulk actions remain a proposal, not implementation authorization. All former native
select dropdowns in forms, reports, admin pages, reconciliation, and the four query
builders now use `components/autocomplete.tsx`. Fixed choices reject arbitrary input;
existing creatable supplier/counterparty, category, and currency controls are preserved.
Named hidden values preserve form submission, and uncontrolled controls reset on the
native form reset event. Empty required placeholders are not selected choices.
Required validation checks the enabled selected key, not the visible query text;
the keyboard regression rejects unmatched text followed by Enter twice. Do not pass
`isInvalid={false}` by default: React Aria treats it as controlled validity and it
overrides the selected-key validator. Leave it undefined without an external error.

New enum clauses default to `contains_any` with a searchable multi-selection and
removable chips; `contains_none` is available. Selections are OR within a clause,
and clauses remain AND. Empty builder selections are inactive; server validators
bound and validate enum arrays. Existing scalar `is`/`is_not` bookmarks retain their
meaning. Membership filters use bound `ANY`/`ALL` SQL arrays before pagination,
including computed artifact linkage. No schema migration is required for BILL-T70.

Synthetic interaction tests now exercise actual autocomplete choices. The shared test
helper supplies the jsdom CSS.escape shim and closes the popup with Escape. A brittle
exact intermediate request-count assertion was replaced by an exact final query/URL
assertion because immediate filtering may request intermediate states. Artifact and
bank builder assertions likewise wait for the exact final debounced navigation;
the longer transaction keyboard interaction has a bounded 15-second test timeout.
No live data,
browser E2E, Docker app rebuild, commit, or bulk transaction edits were performed.

Verification: 768 synthetic tests passed with one skipped. TypeScript, focused lint,
formatting, whitespace checks, and production build passed. Rebuild the Docker app for
operator visual acceptance. The previous BILL-T69 migration 0015 still needs live
deployment independently of this UI/query-only task.
