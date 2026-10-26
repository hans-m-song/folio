# Financial accounts and personalized reporting

Status: planning only, updated 13 October 2026. No implementation or migration is approved.

TaskView Personal/Folio project 8 now tracks selectable years (BILL-T95), financial
accounts (BILL-T96), purpose/individual attribution (BILL-T97) and personalized
views (BILL-T98). See [the current milestone index](./roadmap.md#current-roadmap--13-october-2026).

## Confirmed scope

- Product direction now focuses on individuals and small SaaS businesses. The
  existing business boundary remains one business per repository; personal rows
  may coexist in transaction records and complete exports. Multiple unrelated
  businesses and standalone personal-mode behavior are not defined by this plan.
- Personal amounts are excluded from business income, expense and GST/BAS totals.
  They may be ignored in business reports or attributed to an individual; missing
  individual attribution does not make them business amounts. Complete bank
  reconciliation must still explain their cash movements.
- Financial accounts mean bank accounts and payment-card accounts, not login
  accounts or a chart of accounts. They may be associated with users.
- Summaries should be personalized for the reviewing user, including directly
  attributed transactions and relevant shared allocations/account activity.
- Tax preparation must allow selection of a financial year instead of being fixed
  to FY2025–26.
- The earlier request to assess personal, sole-trader and Pty Ltd suitability
  remains a design review. A personalized business summary is not a complete
  individual tax return, and these reporting modes are not yet implemented.

## Planning checklist

- [x] Confirm financial-account meaning and single-business scope.
- [x] Inspect current attribution, report queries, year validation and snapshots.
- [x] Identify independent financial-year work and account/report dependencies.
- [ ] Confirm payment-versus-allocation behavior and account/user cardinality.
- [ ] Confirm which summary pages are personalized and their default views.
- [ ] Review implementation slices and verification scope before code changes.

## Current implementation

| Area                                                                                                        | Verified behavior                                                                                        | Planning implication                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Transaction schema](../src/database/schema.ts)                                                             | Transactions reference a user owner; no financial-account relationship exists.                           | Add account identity without silently redefining ownership.                                             |
| [Tax attribution](../src/domain/tax-attribution.ts)                                                         | Selected partners receive owned rows directly; other owners and unassigned rows enter the Business pool. | Account associations must not silently redirect this existing allocation. Review the policy separately. |
| [Source queries](../src/database/repository.ts)                                                             | The transaction list checks the actor, then queries the shared ledger.                                   | Personalization needs explicit projections; it is not existing record-level access control.             |
| [Tax request validation](../src/server/tax-operations.ts) and [review input](../src/domain/tax-workbook.ts) | Both accept only financial-year start 2025.                                                              | Remove the fixed-year contract consistently, not only the page label.                                   |
| [Tax route](../src/routes/reports_.tax.tsx)                                                                 | Loads, refreshes, submissions and labels assume FY2025–26.                                               | Propagate one selected year through every action.                                                       |
| [Ledger](../src/domain/reports.ts) and [bank review](../src/database/bank-repository.ts)                    | Both take a start year; bank review accepts 2000–2100 and uses July boundaries.                          | Reuse existing calculations and align validation.                                                       |
| [Snapshots](../src/database/tax-review-repository.ts)                                                       | Snapshots store the year and are append-only; the server filters them by year.                           | Retain historical reviews and use the selected year for current/stale comparisons.                      |
| [Worksheet model](../src/domain/tax-workbook.ts)                                                            | Partner allocations and GST-not-registered assumptions are explicit.                                     | Selecting another year does not establish a new tax regime or GST status.                               |

## Recommended attribution rule — awaiting acceptance

Separate the cost allocation from the source of payment. Account association
should determine related payment activity, not automatically create a second cost
allocation or a personal deduction. This follows common expense-management
practice: company-funded spending and personally funded reimbursable claims are
distinct. [Xero's expense workflow](https://blog.xero.com/product-updates/new-xero-expenses-features/)
and [account assignment](https://central.xero.com/0/article/New-Expenses-user-permissions)
were checked on 11 October 2026.

```text
One business transaction
  |-- Direct/shared allocation --> Who receives the allocated income/cost
  `-- Financial account -------> Where payment occurred / related user activity

Example: $100 cost allocated to A, paid from B's personal card
  Business expense             $100 once
  A's allocated cost           $100
  B's payment activity         $100, separately labelled
  Possible reimbursement       Separate classification; never inferred
```

The same transaction may appear in both views, but its expense must not be added
twice. Matching imported bank evidence to a transaction must also not duplicate
the expense. Account association must not imply access restrictions, account legal
ownership, an amount owed, or a tax deduction.

Proposed presentation:

```text
Financial year [FY2025–26 v]       View [My summary v]

Allocated to me
  Direct income / costs
  Shared allocation
  Total allocated result

Related account activity
  Payments / receipts, with the account and allocation shown
  Not added again to allocated totals
```

Business-wide source review remains necessary. Filtering a personal view must not
hide unresolved business records from the existing review-completeness checks.
Whether those checks block a separate personal export needs explicit definition.

## Account funding and transaction purpose — proposed

The operator asked how business/personal cards and business/personal purchases
should affect the model. On 13 October 2026 personal-row export, exclusion from
business totals and optional individual attribution were confirmed. The remaining
account relationships, mixed-amount model and payment/allocation rules below are
proposals, not accepted implementation specifications.

- Account funding context: business or personal. A business card may be assigned
  to a user without making that user the owner of the funds.
- Account association: identify the relevant user and their role (personal account
  holder or business cardholder). A shared business account need not have a user.
  Recommendation for the first version: one optional associated user per account;
  explicitly shared/joint personal accounts remain an open requirement, not an
  invitation to infer equal ownership or duplicate costs.
- Transaction purpose: business, personal, mixed or needs review. Account defaults
  may suggest purpose, but the operator must be able to correct it.
- Cost allocation: retained separately from payment context and purpose. A user
  assigned a business card does not automatically receive its costs as deductions.

| Funding context | Purpose  | Business cost view                          | Personalized payment view                                                                                    |
| --------------- | -------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Business        | Business | Include the eligible business expense once. | Show as business-funded activity for the associated cardholder, if any.                                      |
| Personal        | Business | Include the eligible business expense once. | Show as business spending paid personally; reimbursement/funding treatment needs review.                     |
| Business        | Personal | Exclude from business expense totals.       | Show the private use of business funds for review; do not automatically classify a drawing, loan or benefit. |
| Personal        | Personal | Exclude from business expense totals.       | Optionally show for an attributed individual; retain labelled rows in complete exports.                      |

For mixed purchases, require reviewed business/private amounts that reconcile to
the transaction total. The business portion is only a candidate expense: capital,
tax and timing treatment remain separate. Leave unknown purpose visible as needs
review rather than presuming a deduction.

Personal spending may remain in transaction records and complete exports, with
optional individual attribution, while staying excluded from business preparation.
Preserve the bank movement's full amount when matching a mixed purchase, while
using only the reviewed business portion in expense preparation. This requires
review of current exact-amount reconciliation and report effects before coding.

Personally paid business expenses should be visible even if the cost was allocated
to someone else. Do not infer reimbursement entitlement or a loan merely from the
payment account. A later reimbursement must not create the original expense again.
Full reimbursement workflows remain outside the initial scope.

Separating personal and business banking is consistent with government guidance;
mixed accounts require identification of personal payments. [Business bank-account
guidance](https://business.gov.au/finance/set-up-your-finances/set-up-your-business-bank-account),
checked on 11 October 2026. This proposal applies that distinction without treating
an account label as proof of a transaction's purpose.

## Proposed delivery slices

These are candidate slices, not approved implementation tasks.

### 1. Selectable financial year

Deliverable: select a year, inspect its worksheet, save a review and export that
year's records. This slice is independent of accounts.

- Use one validated start-year value throughout route state, reads, review input,
  source exports, refreshes, labels and filenames. Proposed initial range is the
  existing bank-review range, 2000–2100.
- Proposed URL state retains the selected year across refresh/navigation. Default
  year policy remains open: latest completed year versus current year.
- Switching years must not carry adjustments, reviewer attestations or stale
  responses into another year. Define confirmation for unsaved review edits.
- Preserve old snapshots, their model versions and their embedded reporting year.
  Export a saved review using its stored year, not the current page selection.
- Verify 30 June/1 July in the configured reporting timezone, two different years,
  empty-year behavior, malformed years, review/export consistency and existing
  FY2025–26 compatibility. Undated unresolved rows must not silently disappear.
- Expected edit surface: tax route, request/review validation and focused tests;
  repository changes only where year-scoped loading is warranted. No migration is
  currently identified as necessary for year selection.

### 2. Financial-account attribution

Deliverable: identify a bank/card account and attach it to relevant payment
activity without changing tax allocation totals.

- Propose a stable account ID, display label, bank/card kind and archive state.
  Do not require full bank/card numbers or provider credentials.
- Decide whether accounts can relate to one or several users before schema design.
  Do not infer legal ownership from this relationship.
- Explicitly select an account during bank import where the source lacks a reliable
  identifier. Inspect duplicate detection, overlapping statements and reconciliation
  for account scope; do not weaken duplicate protections merely to accept an import.
- Confirm whether one account per transaction is enough for the initial slice.
  Split payments, card-versus-underlying-account representation and transfers need
  an explicit supported boundary; do not silently force unsupported relationships.
- Existing records remain unassigned until explicitly attributed. Do not infer
  accounts from names or the transaction's current owner.
- Account archival must preserve historical links. Decide whether user/account
  association changes affect past live summaries; reviewed snapshots stay frozen.
- Expected edit surface: schema/repository, bank import and manual/reconciled
  payment paths, authorized operations and account selectors. Inventory MCP writers
  before implementation so they share the same persistence rules.

### 3. Personalized summaries

Deliverable: reviewing users can see their direct attribution, shared allocation
and related payment activity, with source rows explaining each result.

- Confirm which pages change and whether business-wide views remain selectable.
- Reuse one attribution calculation for UI and exports; maintain exact amounts and
  allocation-total reconciliation.
- Apply the accepted conflict rule and count an expense once, even when the user
  is both its allocation recipient and associated with its payment account.
- Preserve permission checks. Personalization is proposed as presentation within
  the existing shared workspace, not a new privacy guarantee.
- If account associations affect frozen reviews, version their snapshot/fingerprint
  representation. Do not reinterpret historical reviews using current associations.
- Verify direct-only, shared-only, account-only and overlapping relevance, account
  reassignment, archived accounts and unauthorized report access.

### 4. Review business-structure suitability

Deliverable: a reviewed capability/gap matrix for the one business's chosen
structure, before calling the output a personal, sole-trader or company tax report.

A sole trader reports business results within individual tax reporting; a company
has its own return. Personalized company cost allocations must not be relabelled
as individual deductions. [Australian Government comparison](https://business.gov.au/planning/business-structures-and-types/business-structures/tax-differences-between-a-sole-trader-and-a-company).
Business/private portions require appropriate treatment independently of payment
source. [Deduction guidance](https://business.gov.au/finance/tax/tax-deductions).
Sources checked on 11 October 2026; no rates or tax-payable calculation are proposed.

Review the existing partner-based allocation, per-year GST assumptions, candidate
deductions, funding/reimbursements and unsupported adjustments against the intended
business structure. Keep the current worksheet labelled with its actual scope
until that review is accepted. No multi-business architecture, full general ledger,
automatic reimbursement, tax calculation or lodgement is included here.

## Open decisions

1. Accept allocation/payment separation above, or specify another conflict rule.
2. Confirm account funding context and the mixed-amount representation. Personal
   exclusion and optional individual attribution are confirmed; is one optional
   associated user per account sufficient, or are joint accounts required?
3. Which pages should default to personalized summaries, and which remain business-wide?
4. Latest completed or current financial year as the initial selection?
5. What does direct transaction attribution mean operationally: responsibility,
   agreed cost allocation, or another meaning? It does not itself establish tax treatment.

## Verification boundary

This plan is based on source inspection and the operator's confirmed requirements.
No code, migrations, live data, credentials or deployment settings were changed or
tested. Proposed implementation should start with focused synthetic functional
tests; database integration and browser/E2E depth require confirmation before use.
