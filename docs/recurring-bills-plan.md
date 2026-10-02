# Recurring bills and independent invoice status

Approved for implementation on 2 October 2026 in the existing working tree.
Repository task IDs: BILL-T81 (recurring bills), BILL-T82 (source-attribution
column sizing), BILL-T83 (kind-aware document status). TaskView is unavailable;
no external tasks have been created.

## Confirmed behavior

- Recurring schedules have three visible occurrence states: Upcoming before the
  expected bill date, Pending from the expected date through the late window
  inclusive, and Due after that window when no matching recorded transaction exists.
  Attention displays separate Pending and Due occurrence counts, not schedule counts.
- A matching recorded transaction alone completes an occurrence. An invoice is
  not required for recurrence completion; draft/void transactions do not complete it.
- Advance against the original monthly/annual calendar anchor, not upload date or
  the date the operator resolves the alert. Older missing occurrences remain visible
  unless the operator changes the reminder's calendar anchor or cadence.
- Forecasts are separate records; they never enter ledger, tax, cash or allocations.
- Notifications are in-app only: a persistent Overview attention count links to
  Recurring bills under Transactions. Evaluate on load/refresh; no external delivery,
  scheduler, permission expansion, MCP tool, automatic transaction creation or payment.
- Kind-aware document status is independent of draft/recorded/void. Supplier expenses
  expect invoices, supplier credits expect credit notes; other kinds do not trigger
  invoice warnings by default. Available invoice PDFs count; CSV/bank evidence does not.
- Prioritise Transaction in the source-attribution table. Target and money columns
  remain compact with single-line headers; keep narrow-screen horizontal scrolling.

## Initial implementation boundary

Monthly/annual schedules store label, counterparty, optional description matching
text with Contains/Regex mode, early/late day windows, document currency,
optional amount estimate, calendar anchor and optional
responsible user. Responsibility does not change financial transaction ownership.
Pause/resume is an action, not a third occurrence status. No destructive deletion.
Dates use the configured reporting timezone. Calendar calculation clamps month-end
and leap-day dates without moving the original anchor. Early and late windows
default to three days and accept integer values from zero through 365. A zero late
window leaves the expected date Pending and becomes Due the following day.

The operator explicitly permits reminder history to be rebuilt when start date or
cadence changes. Remove the schedule's stored reminder associations in the same
revision-checked save; never remove or edit the associated financial transactions.

Detection proposes groups from recorded supplier expenses: three monthly or two
annual occurrences, regular dates and compatible supplier/service/currency. Amount
changes are allowed. Show supporting source IDs and prefill an editable schedule;
confirmation is required to activate it. Never infer schedules from funding/refunds.

Confirmed schedules use conservative exact-normalised counterparty/currency and
optional case-insensitive description matching, with configured directional date
windows. Contains remains the default for existing rules; Regex uses bounded
RE2-compatible syntax, rejecting invalid/unsupported expressions. A unique one-to-one match
can satisfy an occurrence during a read; ambiguous candidates require an explicit
association. A transaction cannot satisfy two occurrences or schedules. Stored
associations remain subject to current recorded status and eligibility, so voiding
or changing a linked transaction reopens the occurrence. Do not discard prior gaps
except for operator-confirmed anchor/cadence edits.

Regex engine reference: [RE2JS](https://github.com/le0pard/re2js), pinned to 2.8.6.

Creating/editing a schedule shows a debounced, read-only preview before saving:
description-match, on-cadence, misaligned and ambiguous counts plus a compact
date/description/expected-date/result table. Include description nonmatches and
missing dates so operators can validate regex and window checks separately. Invalid
regex blocks saving; zero matches/misalignment warn but do not block. Stale responses
must not replace the preview for a newer edited rule. Preview never writes a schedule,
association or transaction and uses the configured reporting timezone/session actor.

Historical preview extends the monthly/annual cadence backward from the calendar
anchor, preserving its original day and month-end/leap-year clamping. This analysis
does not activate reminders before the first expected date: reminder generation,
automatic completion and explicit associations remain bounded by the anchor.
The editor uses the existing transaction-entry counterparty suggestions in a
creatable autocomplete; custom counterparties remain valid. The transaction's
Track recurring bill action shares the Edit transaction action styling.

The recurrence views display calendar dates as `13 Jan 2026`, retaining ISO dates
in inputs and machine-readable attributes. Preserve Date, Description, Expected
date, Result order while giving Description most of the table width. Date/result
columns remain compact, nonbreaking and responsive. Source transaction
links use consistent application styling.

The main occurrence list shows unresolved Pending/Due reminders and only the next
Upcoming. Completed history is omitted from that list; stale ineligible associations
remain accessible separately for review/unlinking. Missing history uses bounded
oldest-first pages with Show more missing, not a long forward forecast. Full-history
attention counts remain independent of the visible page.

Replace the manual amount estimate display/editor with historical document-currency
minimum, maximum and average. Use unambiguous on-cadence recorded supplier expenses
matching the edited rule, including pre-anchor history; exclude missing/unusable
amounts and transactions dated after the trusted reporting date. Preview candidates
and cadence counts can still show future-dated records for rule analysis. No matches
means No estimate; one matching amount is shown once. Use exact decimal arithmetic
and half-up rounding directly to cents for the displayed average; preserve original
transaction amounts and persisted legacy expectedAmount for compatibility.

Store schedules and explicit associations in additive migration 0017; prepare
additive migration 0018 for rule mode and bounded integer windows. Require active
actors, validate responsible users, preserve exact optimistic revision tokens and
unique association constraints. Do not apply the migration in this slice.

## Integration contract

Domain module `src/domain/recurring-bills.ts` exports input schemas, schedule/link
types, timezone date conversion, calendar occurrence generation, conservative
matching, detection and `buildRecurringBillViews`. Views contain schedule, status
(Upcoming/Pending/Due), nextExpectedDate, pendingCount, dueCount, candidateTransactionIds and
completed occurrence information. Paused schedules are excluded from attention.

Repository module `src/database/recurring-bill-repository.ts` owns authorised
schedule/list/save and explicit occurrence association writes. It does not create
or edit financial transactions. Main integrates runtime, permissions and server
operations. UI owns new recurring route/styles, navigation, Overview alert and the
source-attribution layout fix. Main owns kind-aware invoice policy/filter integration.
Main alone edits durable documentation. Workers must coordinate contracts before UI
integration and preserve the existing dirty tree and migrations 0013–0016.

## Verification gates

- [x] Pure calendar, recurrence/detection and matching tests with synthetic records.
- [x] Mocked repository actor, revision, association uniqueness and rollback tests.
- [x] Synthetic server authorization and in-app UI regressions.
- [x] Kind-aware invoice status, filter and attention-count consistency.
- [x] Scoped lint, TypeScript, full synthetic suite, sequential build.
- [x] Independent boundary review and resumable handoff.
- [ ] Operator visual acceptance after rebuilding the application.
- [ ] Separately authorised PostgreSQL migration/execution verification.

No live records, invoice files, secrets, environment values, service execution,
browser/E2E, staging, commits, deployment or new worktrees are authorised here.

## Review checkpoint — 2 October 2026

The full synthetic suite passes 1,030 tests with one skipped across 101 files.
Independent recurrence/server/UI/tax verification passes 45 tests; the focused
domain/repository/schema/migration gate passes 28 tests. No live PostgreSQL or
visual acceptance claim follows from these tests.
Production build/TypeScript and scoped ESLint passed; T82/T83 are code-complete.

The operator rejected immutable cadence: reminder history is non-critical and may
be rebuilt. On 2 October 2026 the operator approved live regex/date preview,
configurable matching windows and separate occurrence counts; clarified Pending
means within grace and Due means grace expired. This follow-up supersedes the
preceding implementation checkpoint.

The completed follow-up passes the full synthetic suite: 1,062 tests, one skipped
across 101 files. Independent scoped verification passes 60 domain/storage/server
tests and 19 UI tests; closure assertions add blank-regex matching, 365/366-day schema
boundaries and saving despite a zero-match preview. Final focused suites pass 31
domain tests and 20 UI tests. Scoped lint, formatting and whitespace checks pass.
Sequential production build/TypeScript passed. The implementation is code-complete;
operator visual acceptance and real PostgreSQL verification/application remain
separately gated and were not run in this slice.
