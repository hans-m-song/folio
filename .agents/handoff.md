# Handoff

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
