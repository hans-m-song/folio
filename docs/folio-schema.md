# Folio canonical database schema

Status: implemented through migration 0006 on 23 September 2026, including BILL-T08
authentication, BILL-T09A authorization policy, artifact profiles, BILL-T24 reusable
transaction evidence, and BILL-T28A/B bank import persistence  
Default database namespace: `folio`; configurable per deployment

## Scope and semantics

The schema supports a small invoice archive and transaction history. It is not a
general ledger, double-entry accounting model, or tax-lodgement system.

```text
folio.users
    |--< folio.transactions.owner_id
    |--< folio.source_artifacts.owner_id
    |--< folio.auth_sessions.user_id
    `--< created_by_id / updated_by_id (unverified in M1)

folio.auth_attempts (single-use state records)

folio.source_artifacts
    |--< folio.transaction_artifacts >-- folio.transactions
    `--< folio.bank_transaction_artifacts >-- folio.bank_transactions
```

Artifacts and transactions have a many-to-many relationship through
`transaction_artifacts`. A PDF can support multiple transactions, a transaction can
retain multiple PDFs, and one Stripe CSV can source many Stripe transactions. The
relationship has an immutable composite identity and optional JSON object metadata.

Direct bank-transaction ingestion is excluded. A transaction may be recorded without
an invoice while incomplete, but any claimable state requires at least one linked,
available `manual_invoice_pdf_v1` artifact. A bank debit is not evidence of an expense
or entitlement by itself.

All user-entered document and settlement amounts are non-negative magnitudes.
Financial effects are derived with explicit names; there is no ambiguous generic
signed `amount`. Stripe import columns retain the source signs exactly so an import
can be reconciled to Stripe.

## Recurring forecasts — migrations 0017/0018 prepared on 2 October 2026

`recurring_bill_schedules` stores a label, counterparty, optional description
match, document currency, nullable non-negative `numeric(19,4)` estimate,
monthly/annual frequency, calendar-anchor `date`, optional responsible user,
active flag and actor/timestamp audit fields. Responsibility does not change
transaction ownership. Schedules can be paused, not deleted by the application.
Migration 0018 adds `description_match_mode` (`contains`/`regex`, default `contains`)
and integer `days_early`/`days_late` (each 0–365, default 3). Existing rules retain
literal matching. Regex syntax is validated by the application, not executed in SQL.

`recurring_bill_links` stores explicit associations with a composite primary key
on `(schedule_id, expected_date)` and a unique transaction ID. Foreign keys restrict
deletion of schedules, transactions and audit users. Automatic unambiguous matching
is read-only; explicit associations use exact schedule revisions and short locked
transactions. Stored links are rechecked against current recorded status and
eligibility. These tables have no financial effect and do not relax ledger constraints.
Changing a schedule's anchor or frequency deletes that schedule's reminder links
inside the same revision-checked transaction; linked financial records are unchanged.

Migration registration and application-role grants are prepared; health checks
require both tables and registered migrations through 0018. No migration has been applied or checked
against a running PostgreSQL instance in this implementation slice.

## `folio.users`

| Column           | Type          | Constraint                             |
| ---------------- | ------------- | -------------------------------------- |
| `id`             | `uuid`        | primary key                            |
| `email`          | `text`        | required; case-insensitively unique    |
| `display_name`   | `text`        | nullable                               |
| `google_subject` | `text`        | nullable; unique when present          |
| `role`           | `text`        | `administrator`, `member`, or `viewer` |
| `active`         | `boolean`     | required; default true                 |
| `created_at`     | `timestamptz` | required; server generated             |

Email is a case-insensitive matching and display attribute, not the durable identity
key, authentication material, or audit identity. BILL-T08 maps the stable Google
`sub` claim to `google_subject` only for an existing active administrator or member;
authentication does not automatically create or activate a Folio user. A mismatched
or already-bound subject is rejected, and a viewer cannot create a session.

BILL-T09A protects server operations through the sequence `session cookie -> current
active user -> named permission -> trusted actor ID`. The resolved `users.id` is
passed to repository and document operations. Browser actor input and actor state
are removed. Members receive workspace, transaction, artifact, import, report,
download, and export permissions; administrators receive those permissions plus
user, audit, and session administration; viewers receive no permissions. The
explicit transaction `owner_id` remains a responsibility field distinct from the
trusted actor ID. The confirmation-gated upload-recovery maintenance CLI is the sole
explicit actor-email exception and uses that value only to validate an active actor
for exact pending-upload recovery.

Ownership records responsibility, not visibility. The coarse role is retained as the
source of the application-defined permission bundle; resource-level ACLs are not
implemented.

## `folio.auth_attempts`

| Column          | Type          | Constraint                                |
| --------------- | ------------- | ----------------------------------------- |
| `state_hash`    | `varchar(64)` | primary key; lowercase SHA-256 state hash |
| `nonce`         | `text`        | required                                  |
| `code_verifier` | `text`        | required PKCE verifier                    |
| `return_path`   | `text`        | required validated same-origin path       |
| `expires_at`    | `timestamptz` | required                                  |
| `created_at`    | `timestamptz` | required; server generated                |

The server creates one attempt for `/auth/login` and deletes it before exchanging
the callback code. The raw state is not persisted; nonce and PKCE verifier remain
server-side until that single-use consume. Attempts expire after 10 minutes.

## `folio.auth_sessions`

| Column       | Type          | Constraint                                |
| ------------ | ------------- | ----------------------------------------- |
| `token_hash` | `varchar(64)` | primary key; lowercase SHA-256 token hash |
| `user_id`    | `uuid`        | required reference to `users`             |
| `expires_at` | `timestamptz` | required                                  |
| `revoked_at` | `timestamptz` | nullable                                  |
| `created_at` | `timestamptz` | required; server generated                |

The browser receives a 32-byte opaque random token, while PostgreSQL stores only its
SHA-256 hash. Sessions expire after 12 hours by application configuration, are
revoked on logout, and are rotated at a successful callback. No separate session
signing secret is required. Production and development use distinct cookie names
and security settings; see the overview for their exact origins and cookie policy.

## `folio.source_artifacts`

| Column            | Type          | Constraint                                           |
| ----------------- | ------------- | ---------------------------------------------------- |
| `id`              | `uuid`        | primary key                                          |
| `owner_id`        | `uuid`        | nullable reference to `users`                        |
| `created_by_id`   | `uuid`        | required reference to `users`                        |
| `kind`            | `text`        | `pdf` or `stripe_csv`                                |
| `object_key`      | `text`        | required and unique; application generated           |
| `version_id`      | `text`        | nullable until confirmed                             |
| `filename`        | `text`        | required; display only                               |
| `media_type`      | `text`        | required; allow-listed by `kind`                     |
| `byte_size`       | `bigint`      | required and positive                                |
| `checksum_sha256` | `text`        | required when available                              |
| `state`           | `text`        | `pending`, `available`, `superseded`, or `abandoned` |
| `created_at`      | `timestamptz` | required; server generated                           |
| `confirmed_at`    | `timestamptz` | nullable                                             |

The browser uploads directly to S3 using a short-lived presigned request. The server
confirms object metadata before changing `pending` to `available`. Failed or expired
uploads become `abandoned`; available objects are never overwritten in place.

## `folio.transactions`

### Identity and workflow

| Column               | Type          | Constraint                                                                                                                                                                         |
| -------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | `uuid`        | primary key                                                                                                                                                                        |
| `owner_id`           | `uuid`        | nullable reference to `users`                                                                                                                                                      |
| `created_by_id`      | `uuid`        | required reference to `users`                                                                                                                                                      |
| `updated_by_id`      | `uuid`        | required reference to `users`                                                                                                                                                      |
| `source_artifact_id` | `uuid`        | nullable reference to `source_artifacts`                                                                                                                                           |
| `source_system`      | `text`        | `manual` or `stripe`                                                                                                                                                               |
| `kind`               | `text`        | `sale`, `supplier_expense`, `processing_fee`, `sale_refund`, `supplier_credit`, `dispute`, `transfer`, `owner_contribution`, `owner_loan`, `owner_loan_repayment`, or `adjustment` |
| `reference`          | `text`        | nullable; invoice/reference or Stripe balance transaction ID                                                                                                                       |
| `counterparty`       | `text`        | nullable                                                                                                                                                                           |
| `description`        | `text`        | nullable                                                                                                                                                                           |
| `status`             | `text`        | `draft`, `recorded`, or `void`                                                                                                                                                     |
| `category`           | `text`        | nullable free text                                                                                                                                                                 |
| `notes`              | `text`        | nullable                                                                                                                                                                           |
| `metadata`           | `jsonb`       | required; default empty object                                                                                                                                                     |
| `created_at`         | `timestamptz` | required; server generated                                                                                                                                                         |
| `updated_at`         | `timestamptz` | required; server generated                                                                                                                                                         |

`owner_id` remains nullable at the database level because imported Stripe activity
may be unassigned. Manual transaction saves require a non-null owner in the manual
application contract; new manual entries default that editable assignment to the
authenticated actor.

`reference` is deliberately source-neutral. For Stripe it stores
`balance_transaction_id`; for manual records it may store an invoice number or
other supplier reference. Stripe references are unique within `source_system`.
Potential duplicate manual references produce a warning rather than a hard error.
`kind` describes the economic event rather than merely its direction. Stripe source
categories remain preserved separately. Stripe payouts are `transfer` and excluded
from income and expense totals. Unknown provider categories become `adjustment`, are
shown for reconciliation, and remain excluded from tax totals until classified.

| Kind                   | Reporting treatment                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `sale`                 | gross income; any embedded processing fee remains a separate expense effect                                                    |
| `supplier_expense`     | expense supported by an available PDF invoice when claimable                                                                   |
| `processing_fee`       | standalone provider fee expense                                                                                                |
| `sale_refund`          | reversal of sale income                                                                                                        |
| `supplier_credit`      | reversal of supplier expense                                                                                                   |
| `dispute`              | explicit chargeback activity; effects derived from source values                                                               |
| `transfer`             | movement between accounts; neither income nor expense                                                                          |
| `owner_contribution`   | non-repayable owner funding; no income, expense, or GST effect; settled AUD value contributes positive cash only               |
| `owner_loan`           | owner funds lent to the business; no income, expense, or GST effect; settled AUD value contributes positive cash only          |
| `owner_loan_repayment` | principal returned to the selected lender; no income, expense, or GST effect; settled AUD value contributes negative cash only |
| `adjustment`           | unresolved provider activity; excluded from tax totals                                                                         |

### Dates and positive magnitudes

| Column                | Type            | Constraint                                                                                   |
| --------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `occurred_at`         | `timestamptz`   | nullable                                                                                     |
| `available_at`        | `timestamptz`   | nullable                                                                                     |
| `invoice_date`        | `date`          | nullable                                                                                     |
| `settled_at`          | `timestamptz`   | nullable                                                                                     |
| `document_currency`   | `varchar(3)`    | nullable ISO 4217 code                                                                       |
| `document_amount`     | `numeric(19,4)` | nullable; non-negative, tax inclusive when applicable                                        |
| `document_tax_amount` | `numeric(19,4)` | nullable; non-negative source-document tax                                                   |
| `tax_treatment`       | `text`          | `gst_included`, `gst_separately_shown`, `foreign_tax_included`, `no_tax`, or `unknown_mixed` |
| `settlement_currency` | `varchar(3)`    | nullable ISO 4217 code                                                                       |
| `settlement_amount`   | `numeric(19,4)` | nullable; non-negative effective amount paid or received                                     |

`document_tax_amount` records tax printed by the source document; it does not imply
an Australian GST credit. Document currency and effective settlement currency are
separate so a USD invoice paid in AUD can retain both values without an exchange-rate
table.

`document_amount` is always the final tax-inclusive amount payable. For an AUD
document marked `gst_included`, the UI may suggest one-eleventh as source-document
tax; foreign tax is never inferred. Owner funding requires `no_tax`, zero or absent
document tax, a non-claimable GST state, and zero claimable GST.

Migration 0016 adds owner-loan principal repayments with an explicit non-null owner
and a positive, non-null document amount. Amounts remain positive magnitudes;
the transaction kind supplies the negative cash direction. Interest is not part of
this principal-only type. A supplied repayment settlement amount must also be
positive; a missing amount remains incomplete rather than a settled repayment.
Existing contributions are not automatically reclassified
as loans, and arbitrary transfers are not inferred to be repayments.

The current-records owner funding view accumulates loans and principal repayments
from all recorded years through the selected financial-year end, using reporting
timezone periods. Other contributions remain separate. It is not a frozen tax
snapshot or proof of a legal debt; missing facts, unassigned funding and negative
recorded balances require review, and unrecorded history cannot be detected.

### Australian GST treatment

| Column              | Type            | Constraint                                                   |
| ------------------- | --------------- | ------------------------------------------------------------ |
| `gst_credit_status` | `text`          | `not_registered`, `unknown`, `not_claimable`, or `claimable` |
| `claimable_gst_aud` | `numeric(19,4)` | nullable; non-negative                                       |

While the business is not GST-registered, new M1 records default to
`not_registered` and `0.0000`. The source-document tax is still preserved. If GST
registration changes, defaults change only from an accountant-confirmed effective
date; existing records are not silently reclassified.

M1 configuration rejects `gst_credit_status = 'claimable'` while the business is
configured as not registered. The database vocabulary remains forward-compatible,
but enabling claims requires an accountant-confirmed registration effective date.

`gst_credit_status = 'claimable'` requires an available PDF invoice. Any future
income-tax deduction status must enforce the same minimum evidence rule and remain
separate from GST-credit status.

### Stripe source values

| Column            | Type            | Constraint                      |
| ----------------- | --------------- | ------------------------------- |
| `source_currency` | `varchar(3)`    | nullable; required for Stripe   |
| `source_gross`    | `numeric(19,4)` | nullable; source sign preserved |
| `source_fee`      | `numeric(19,4)` | nullable; source sign preserved |
| `source_net`      | `numeric(19,4)` | nullable; source sign preserved |

The itemised Stripe Balance-report importer also maps `created`, `available_on`,
`reporting_category`, and `description` into their named columns or `metadata`.
For the accepted sample format it validates `source_gross - source_fee = source_net`
at currency precision and rejects duplicate Stripe balance transaction IDs.

## Derived values

Queries and report views expose explicit values such as `cash_effect_aud`,
`income_effect_aud`, and `expense_effect_aud`. Their sign is derived from `kind` and
the relevant positive magnitude. Reports must not substitute document amount for
settlement amount or claimable GST for source-document tax.

A `sale` may produce both gross income and a processing-fee expense from one Stripe
row. A transfer has no income or expense effect. Because Folio does not ingest the
bank side, M1 must not present Stripe payout movements as a consolidated cash balance.

Calendar month and Australian financial year are derived from the relevant date and
the configured reporting timezone. BAS-quarter reporting is informational while the
business is not GST-registered.

M1 provides two explicitly labelled preparation bases:

| Basis    | Supplier transaction date/value                             | Stripe date/value                   |
| -------- | ----------------------------------------------------------- | ----------------------------------- |
| activity | `invoice_date` and AUD document amount                      | `occurred_at` and AUD source values |
| cash     | complete `settled_at`, AUD settlement amount/currency tuple | `occurred_at` and AUD source values |

Rows missing the required date or an explicit AUD value are excluded from the basis
total and reported as warnings. Transfers, drafts, voids, and unresolved adjustments
remain visible for reconciliation but outside income and expense totals. These rules
are neutral preparation conventions, not an accountant-approved tax policy.

Owner contributions, owner loans and principal repayments are excluded from activity
income/expense and GST totals. On the cash basis, complete settled AUD contributions
and loans contribute positive cash; principal repayments contribute negative cash.
All three have zero income and expense; pending or foreign rows are warned and
excluded. Settlement state itself is derived: all three settlement fields are
required for `settled`, otherwise the row is `pending`.

## Artifact profiles and relationships

Migration 0005 replaces artifact `kind` with immutable `artifact_profile`, uses one
UUID for the database artifact and canonical S3 key, and introduces
`transaction_artifacts`. Profile definitions own media type, extension, source,
purpose, and invoice-evidence eligibility. Relationship metadata describes only the
attribution; artifact metadata never embeds transaction IDs. Transaction-driven link,
unlink, or replacement does not change artifact availability.

## Bank activity

Migration 0006 adds immutable `bank_transactions` and typed
`bank_transaction_artifacts`. CommBank CSV confirmation reparses the pinned object and
atomically inserts every row and attribution before making its artifact available.
Review state is derived from an optional matched transaction or private, transfer, or
duplicate classification. Imported rows do not enter Folio transaction reports.

Exact profile/checksum duplicates are rejected. Non-identical imports expose precise
date-range overlaps for explicit acknowledgement without silently merging similar
rows. Running balance and source hints remain non-authoritative row metadata.

Migration 0007 adds reconciliation integrity. A bank row may match only an eligible
recorded manual transaction with the same exact signed AUD cash effect. Matched
financial identity cannot change until the bank row is explicitly reset. Repository
commands lock the bank row first, apply optimistic revisions, and support explicit
match, private, transfer, duplicate, and reset states. Create-and-match inserts the
manual transaction, invoice-evidence links, and bank match in one database transaction;
invoice artifacts are locked in deterministic ID order before their profile and
availability are validated.

## Deferred structures

Split, aggregate, and tolerance-based reconciliation remain deferred until observed
cases justify them. PDF bank-statement parsing remains deferred to BILL-T30; see
[`banking-plan.md`](./banking-plan.md).

- append-only audit events and revision history, planned for BILL-T09B after the
  BILL-T08 session and BILL-T09A authorization policy exist
- payments and partial-payment allocation
- line items and split allocations
- controlled category tables
- exchange-rate sources and records
- resource ACLs beyond the coarse BILL-T09A named-permission bundles
- accounting journals and accounts
- FOCUS projections

These require observed workflow evidence or an explicit scope decision before being
added.

## Standards and authoritative references

- [Stripe Balance report](https://docs.stripe.com/reports/balance) and
  [Balance report schemas](https://docs.stripe.com/reports/report-types/balance)
- [FinOps Open Cost and Usage Specification 1.4](https://focus.finops.org/docs/specification/v1-4/),
  used only as vocabulary guidance rather than an accounting standard
- [ATO guidance on claiming GST credits](https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/claiming-gst-credits)
- [Google OpenID Connect reference](https://developers.google.com/identity/openid-connect/reference)
