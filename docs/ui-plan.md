# Folio UI and workflow plan

Status: **approved as directional UI architecture on 23 September 2026; mockups are
non-authoritative visual references**

The information architecture and workflow direction are approved. Exact fields,
labels, controls, and mock data remain subordinate to the banking domain contract,
accessibility verification, and implemented command/query interfaces.

## Purpose

Restructure Folio before bank activity, reconciliation, import history, and PDF
statement ingestion expand the existing single-page workspace. Preserve the current
financial and evidence semantics while making each operator task easier to locate,
resume, link, test, and authorize.

## Baseline at approval

- The authenticated `/` route rendered session state, manual capture, Stripe import,
  transactions, derived artifacts, reports, and user administration in one linear
  page.
- Transactions were searched on the server, then filtered, sorted, and paginated in
  browser state. Pagination does not bound the database result.
- The artifact table was derived from the currently loaded transaction rows, so it
  cannot independently represent an unreconciled bank CSV or statement PDF.
- Search, filters, sort, page, report selection, and edit state were not URL-addressable.
- A shared busy flag and status message coupled otherwise independent workflows.
- Server authorization protected user administration, but the presentation was not
  independently route- or permission-gated.

## Implementation checkpoint — 23 September 2026

The authenticated shell, dedicated Overview/Sources/Reports/Administration/Banking
routes, and transaction create/edit/detail/Stripe-import routes are implemented.
Transactions has URL-backed
server-filtered, server-sorted 50-row pages with an exact filtered count. Artifacts
has an independent bounded query. Overview has exact attention counts and bounded
recent-record snapshots; both Overview and Transactions show cash-movement lifetime
figures derived from the existing report service. Workflow-specific pending/status
state replaces the former shared busy flag.

BILL-T32 remains in progress. The lifetime report still loads all transactions
inside the server before aggregating them, although it sends only aggregates to
the browser. Returning from edit does not preserve the originating filtered-list
query. Browser-rendered workflow verification is still pending.
Populated visual, keyboard, and responsive acceptance of the new UI is unverified.
Overview, Reports, and Banking collection routes now have local retry controls.
Exact remaining gates are tracked in
[`docs/roadmap.md`](./roadmap.md) and [`.agents/handoff.md`](../.agents/handoff.md).

On 24 September 2026, the operator-feedback follow-up added a left-edge sticky
sidebar, compact disclosure navigation, wider Transactions content, container-aware
form fields, searchable reusable-PDF selection, safe sign-compatible bank-row
creation, a separate CommBank confirmation step, and paged Stripe row preview.
Reversible classifications have revision-checked Undo; consequential unmatch, void,
and user deactivation use in-app dialogs. Static and mounted-component checks pass,
but the revised layout and upload flows have not been accepted in a rendered browser.

## Proposed principles

1. Organise navigation around operator tasks, not database tables.
2. Keep bank activity distinct from Folio transactions.
3. Make unresolved work visible without turning the overview into another report.
4. Give imports, reconciliation, artifacts, and reports durable URLs.
5. Put query state in the URL and bound large collections at the server.
6. Keep creation globally available while moving complex imports into dedicated flows.
7. Scope loading, errors, and progress to the operation that owns them.
8. Preserve accessible tables, keyboard operation, exact-value alternatives to charts,
   and responsive record-card layouts.
9. Do not imply that bank balances, preparation summaries, or evidence establish a
   general ledger, GST entitlement, deductibility, or lodged tax position.

## Approved review outcomes

An independent review was considered on 22 September 2026. The following directions
are accepted; exact interaction details remain subject to implementation verification:

- Retain the user-facing term `Reconcile`. In the current scope it means reviewing
  Folio's overall imported cash position by resolving bank rows; it does not claim
  formal account/statement reconciliation, cleared balances, or a difference-to-zero
  process. Account-aware reconciliation may be added in the distant future.
- Overview attention indicators use absolute counts, not percentages.
- Reconciliation progress shows consistent counts such as `17 reviewed` and
  `7 unresolved`; percentages are omitted unless a later need justifies them.
- Suggested matches are not preselected. The operator selects a candidate before the
  primary Match action becomes available.
- Private, Transfer, Duplicate, Match, and Unmatch require explicit state semantics,
  named-action authorization, idempotency, conflict handling, current actor/time, and
  safe reversal where applicable. General action history remains deferred.
- Raw imported bank activity never appears as a Folio transaction. Only an explicitly
  created or matched transaction belongs in the Transactions view.
- Banking permissions require a capability matrix covering view, import, match,
  classify, reverse, download, and export. Hidden navigation is never authorization.
- Collection and reconciliation screens require designed empty, loading, malformed,
  duplicate, stale/conflict, permission-denied, retry, and success states.
- Icon-only controls require contextual accessible names; tooltips are supplementary.
- `Monthly cash movement` is preferred when a visual shows inflow, outflow, and net
  movement rather than an account balance. Its exact-value table remains part of the
  same accessible figure.

## Information architecture

```text
Folio
|-- Overview
|-- Transactions
|-- Banking
|   |-- Activity
|   |-- Reconcile
|   `-- Import history
|-- Sources [Stripe CSV / CommBank CSV / PDF evidence / File library]
|-- Reports
`-- Administration [permission-gated]
```

A persistent `+ Add` action offers:

- New manual transaction
- Import Stripe CSV
- Import CommBank CSV
- Upload PDF evidence
- Import CommBank PDF, disabled until BILL-T30 is delivered

Owner contributions and bank fees remain manual-transaction kinds or presets. A
top-level `Cash` destination is not proposed because it would be ambiguous beside
bank activity and cash-basis reporting.

## Mockup status

The version-four images in `docs/mockups/` are current composition and visual-
hierarchy references, not pixel-accurate specifications:

| Mockup                                                  | Status  | Required interpretation                                                                                                                    |
| ------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [Overview v4](./mockups/ui-overview-v4.png)             | Current | Counts and cash movement use Folio transactions; imported bank rows affect attention counts only.                                          |
| [Transactions v4](./mockups/ui-transactions-v4.png)     | Current | Evidence and match badges represent through-table relationships; mock values are illustrative.                                             |
| [Reconciliation v4](./mockups/ui-reconciliation-v4.png) | Current | Running balance is secondary source detail; there is no implied audit history; review state is derived and classifications need no reason. |

The v4 visual direction uses Geist or a metrically compatible neutral grotesk,
moderate heading weights, and elevated white surfaces with restrained soft shadows on
a pale cool-grey canvas. The v3, v2, and original images are superseded comparison
material. Responsive, keyboard, screen-reader, empty, loading, validation, conflict,
and error behavior is determined by acceptance tests rather than static images.

## Tentative routes

| Route                            | Responsibility                                          |
| -------------------------------- | ------------------------------------------------------- |
| `/`                              | Attention-oriented overview and recent activity         |
| `/transactions`                  | Lifetime summary and bounded transaction query          |
| `/transactions/new`              | Manual transaction creation                             |
| `/transactions/:id/edit`         | Manual transaction correction and state actions         |
| `/banking/activity`              | Immutable imported bank activity                        |
| `/banking/reconcile`             | Unresolved queue and candidate matching                 |
| `/banking/imports`               | Import history and progress                             |
| `/imports/{stripe,commbank,pdf}` | Tabbed source upload and review workspace               |
| `/artifacts`                     | Independent evidence and source-file library            |
| `/reports`                       | Preparation summaries, exports, and cash-movement chart |
| `/admin/users`                   | Permission-gated user and role administration           |

Provider-specific import steps may use nested routes or URL parameters after the
shared preview contract is defined. This plan does not require drawers or modals;
ordinary routes are the default for recoverability and browser navigation.

## Screen proposals

### Overview

Purpose: answer `what needs attention?` and provide a short path to the next task.

```text
+--------------------------------------------------------------------+
| Lifetime: inflow | outflow | net movement | transaction count      |
+-------------------------------+------------------------------------+
| Needs attention               | Recent activity                    |
| unreconciled bank rows        | imports and transaction events     |
| transactions missing evidence |                                    |
| failed or incomplete imports  |                                    |
+-------------------------------+------------------------------------+
| Monthly cash movement chart with exact-value table                 |
+--------------------------------------------------------------------+
```

The overview is not a replacement for detailed reports. Absolute counts link to
filtered destination pages; percentages are not shown for attention queues.

### Transactions

Purpose: find, inspect, create, and correct Folio transactions.

- Always-visible lifetime summary remains above the table.
- Search, filters, sort, and pagination use URL state.
- The server returns a bounded page plus total count.
- Columns remain Date, Counterparty, Description, Type, Amount, State, Actions.
- Evidence and bank-match indicators may appear under State, but reconciliation
  commands remain under Banking.
- Row actions remain compact buttons with contextual accessible names, supplementary
  tooltips, and no horizontal overflow.
- Raw imported bank rows never appear in this table. A linked bank match is displayed
  only as relationship context on a genuine Folio transaction.

### Banking activity

Purpose: show every immutable imported bank row and its derived review state.

Columns are Posted, Description, Movement, Review state, Match, and Actions.
Bank-provided running balance is retained in source metadata and may appear in row or
artifact detail, but is not a primary day-to-day column and is never presented as
Folio's calculated balance.

### Reconcile

Purpose: resolve one bank row against compatible transactions with explicit operator
confirmation. In this plan `Reconcile` describes overall-position row review, not
formal account/statement reconciliation.

- Show source row and extracted hints together.
- Show source profile, import period, canonical filename, optional row locator, stable
  bank-row ID, raw description, currency, signed movement, and current actor/time.
- Rank exact-AUD candidates by date, counterparty, and reference similarity.
- Do not preselect a candidate. Enable Match only after explicit selection.
- Offer Match, Create transaction, Private, Transfer, Duplicate, and Leave unresolved.
- Never auto-confirm a suggestion.
- Make the selected row URL-addressable while retaining queue filters and import
  context.
- Define action-specific conflict response and safe reversal. Private, Transfer, and
  Duplicate are reversible current classifications and should apply without a native
  confirmation box; present an Undo action. They require no reason, duplicate
  target, or transfer counterpart in version one.
- Preserve a route to the import, source artifact, bank row, and matched transaction.

### Sources — import tabs

Purpose: start, preview, confirm, resume, and inspect Stripe or bank imports.

- Import history is derived from source artifacts and attributed bank rows and shows
  source, period, row counts, unresolved count, artifact state, actor, and actions.
- Stripe and CommBank CSV imports use upload, per-file Add to batch or Reject,
  combined batch review, one Confirm import action, and per-file results. A
  partial result retains failed files for individual retry.
- Preview shows every valid source row and any blocking row-level errors.
- Rejection before confirmation writes no bank transactions and leaves a
  visibly rejected CSV artifact; only rejected, unlinked CSVs can be deleted.
- Stripe CSV import previews derived transactions before explicit approval; this
  does not imply Stripe-payout-to-bank-deposit reconciliation.
- PDF evidence remains an upload-only tab, without batch admission or import.

### Sources — File library

Purpose: independently browse invoice PDFs, Stripe CSVs, bank CSVs, and supported
statement PDFs whether or not they are linked to a transaction.

- Query artifacts directly rather than deriving them from loaded transactions.
- Filter by kind, source, upload period, availability, and linkage state.
- Show transaction and import context as relationships.
- Retain Download and Copy artifact ID actions.

### Reports

Purpose: contain preparation summaries, report exports, lifetime metrics, and the
monthly cash-movement chart with an exact-value table.

Period and basis are URL state. Labels must distinguish preparation movement from an
account balance or accounting ledger. The exact-value table is available with the
chart rather than hidden behind a separate workflow.

### Administration

Purpose: isolate user and role management from daily financial workflows.

The route and navigation item are hidden without `user:admin`; server action-based
authorization remains authoritative. A separate capability matrix must define bank
activity, import, artifact, reconciliation, reversal, download, and export access.

## Responsive proposal

- Desktop: persistent left-edge sidebar, page-appropriate content width, data tables.
- Compact: accessible navigation menu, two-column summary cards, reduced table
  density.
- Mobile: one-column cards; tables use the existing labelled-record transformation;
  reconciliation actions remain visible without horizontal scrolling.
- Primary actions remain reachable without relying on hover-only controls.

## Delivery sequence

These UI identifiers remain local sequencing labels rather than separate roadmap
commitments; BILL-T24 and BILL-T28 own their delivered behavior.

1. `UI-R01` — Add authenticated application shell, primary navigation, permission-
   aware administration link, and global Add menu.
2. `UI-R02` — Move existing Transactions, Artifacts, Reports, and Administration
   sections into routes without changing their domain behaviour.
3. `UI-R03` — Introduce URL-backed transaction query state and bounded server-side
   search, filters, sorting, pagination, and totals.
4. `UI-R04` — Replace transaction-derived artifacts with an independent artifact
   query and route.
5. `UI-R05` — Add Banking navigation, activity shell, reconciliation shell, and
   imports history contract for BILL-T28.
6. `UI-R06` — Implement the attention-oriented Overview using existing aggregates and
   later bank/import counts.
7. `UI-R07` — Separate operation-specific loading, progress, error, and retry state.
8. `UI-R08` — Complete keyboard, responsive, populated-browser, and permission-
   visibility verification across the new shell.
9. `UI-R09` — Specify and verify collection/reconciliation empty, loading, malformed,
   duplicate, stale/conflict, permission-denied, retry, reversal, and success states.

The route split should precede bank reconciliation UI. BILL-T28 parser and persistence
work can proceed in parallel after its command/query interfaces are fixed.

## Resolved UI assumptions

- Overview is the default landing page and Transactions remains a primary destination.
- Global `+ Add` replaces a permanently expanded capture form.
- Banking groups Activity, Reconcile, and Imports; Stripe remains available from the
  import entry flow without requiring a separate top-level destination.
- Overview contains the concise monthly cash-movement figure and links to Reports for
  detailed periods and exports.
- Server permissions remain action-based even though version one is private and
  single-user.
- Collection queries are bounded from the start; no speculative high-volume or
  multi-company UI is introduced.

## Review and approval gates

- Product review of navigation, terminology, default landing page, and capture entry.
- Security review of route visibility and named actions.
- Data/query review before committing server-pagination contracts.
- Accessibility review of navigation, import steps, reconciliation controls, tables,
  and chart alternatives.
- Workflow review of every reconciliation action's consequence, confirmation,
  idempotency, conflict handling, history, and reversal.
- Populated desktop, compact, and mobile browser review using synthetic data.
- Formal promotion of approved provisional tasks into stable roadmap identifiers.

## Mockup references

The v4 images communicate the approved theme direction, hierarchy, density, and
workflow placement; they do not approve a component library or override field and
interaction contracts. Their current disposition is defined in the earlier mockup-
status table.

- [Overview dashboard v4](./mockups/ui-overview-v4.png)
- [Transactions v4](./mockups/ui-transactions-v4.png)
- [Banking reconciliation v4](./mockups/ui-reconciliation-v4.png)

The v3, v2, and original review sets remain available beside the current files as
superseded comparison material.

The mockups were generated as high-fidelity desktop concepts using the supplied theme
samples and existing Folio screens as references. Mobile layouts, interaction states,
validation, permissions, empty/loading/error states, and exact copy remain
implementation work.
