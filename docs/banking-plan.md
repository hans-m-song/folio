# Folio bank activity and reconciliation plan

Status: **approved implementation architecture on 23 September 2026**

This document is the implementation architecture for the approved BILL-T24 and
BILL-T28 vertical slice. BILL-T30 remains deferred until the CSV workflow is accepted.

Current PostgreSQL and S3 records are disposable test data. The implementation may use
a direct, destructive schema migration rather than dual-read/write compatibility or
object-key migration. This permission applies only to the current test environment and
does not authorize destructive handling after live data exists.

## Architecture decisions

- One source artifact is the batch identity; there is no `bank_imports` table.
- Artifact identity is `artifact_profile` plus `media_type`; profile registry data is
  not duplicated in database columns.
- One server-generated UUID identifies both the PostgreSQL artifact and S3 object key.
- `bank_transactions` contains only core matching fields, current reconciliation
  fields, and non-authoritative source metadata.
- `transaction_artifacts` and `bank_transaction_artifacts` are separate plain through
  tables with relationship metadata. Artifact metadata never stores related record
  identifiers.
- Reconciliation state is derived from match or classification; there is no disposition
  column, duplicate target, classification reason, or event history.
- Artifact lifecycle represents import completion; there is no separate import state.
- Natural business-state idempotence replaces a general idempotency ledger.
- Version one is exact signed-AUD, one-to-one, recorded-manual matching only.
- General audit history, accounts, complex matching, exchange-rate records, and Athena
  layout are deferred.

The initial product is a private, single-user sole-trader cashbook for an ABN holder.
It is not currently GST-registered and uses cash-oriented preparation summaries.
Company and multi-account bookkeeping are future scope; version one does not add
company, account, ledger, or accrual structures merely to anticipate that transition.

## Purpose

Import fixed-profile bank files as immutable bank transactions, attribute one or more
source artifacts to them, and let an operator either match each bank transaction to one
Folio transaction or classify it as private, transfer, or duplicate.

Imported bank transactions are not Folio transactions and never directly affect Folio
reports. `Reconcile` means resolving imported rows to understand Folio's overall
position; it does not claim formal account balancing. Accounts remain deferred.

## Artifact identity

Every artifact has two authoritative type fields:

```text
artifact_profile
media_type
```

Example profiles:

```text
manual_invoice_pdf_v1
stripe_balance_itemised_csv_v1
commbank_transaction_history_csv_v1
commbank_statement_pdf_v1
nab_transaction_history_csv_v1
```

The application profile registry derives source, purpose, parser, expected media type,
extension, evidence eligibility, and display label. `kind`, `source_system`, `purpose`,
and `format` are not independently persisted after migration.

The stored media type must equal the selected profile's registered media type.
Invoice-evidence eligibility comes from the profile; a bank statement PDF never
satisfies the invoice-PDF rule.

### Canonical object keys

The server generates one artifact UUID for PostgreSQL and S3:

```text
<prefix>/artifacts/<artifact-profile>/<artifact-id>.<extension>
```

The client never supplies an object key. Upload date and original filename remain in
PostgreSQL. The original filename is provenance; downloads use a server-derived
canonical filename. Existing objects are not renamed. S3 tags may mirror stable
infrastructure attributes, but PostgreSQL owns all workflow state.

## Confirmed initial profile

`commbank_transaction_history_csv_v1` is AUD, headerless, exactly four columns, uses
`dd/MM/yyyy`, and contains signed movement, source description, and running balance.
It contains no pending transactions. Other banks or layouts require explicit,
versioned profiles and fixtures; Folio never silently selects a different profile.

## Proposed data model

```text
source_artifacts
      |
      +-- transaction_artifacts -------- transactions
      |
      `-- bank_transaction_artifacts --- bank_transactions
                                               |
                                               `-- optional one-to-one match
                                                   to transactions
```

### Source artifacts

```text
id
artifact_profile
media_type
object_key
original_filename
byte_size
checksum_sha256
state
version_id
owner_id
created_by_id
created_at
confirmed_at
```

No artifact metadata column is proposed. Profile, currency, header behavior, and
parser are registered; bank row count and covered period are derived.

### Bank transactions

```text
id
posted_date
amount_aud
description
metadata

matched_transaction_id     nullable
classification             nullable

revision
updated_by_id
updated_at
created_at
```

Only matching and review fields are typed. Retained source values Folio does not track
semantically live in metadata:

```json
{
  "sourceRow": 3,
  "runningBalance": "113.88",
  "valueDate": "2026-08-13",
  "foreignCurrency": "USD",
  "foreignAmount": "35.19"
}
```

The source artifact remains authoritative. Metadata does not affect totals, match
eligibility, or authorization. Suggested counterparties are derived, not persisted.

Tentative constraints:

```text
amount_aud != 0
classification in (private, transfer, duplicate) or null
not (matched_transaction_id is not null and classification is not null)
unique(matched_transaction_id) where matched_transaction_id is not null
```

Derived state:

| Match          | Classification | State      |
| -------------- | -------------- | ---------- |
| null           | null           | unresolved |
| transaction ID | null           | matched    |
| null           | `private`      | private    |
| null           | `transfer`     | transfer   |
| null           | `duplicate`    | duplicate  |

No `disposition`, `duplicate_of_id`, or `classification_reason` is proposed.
Authenticated actor and update time provide current-state attribution. General history
remains deferred.

### Artifact attribution

Supporting evidence and bank-source provenance are different relationships and use
separate through tables:

```text
transaction_artifacts
---------------------
transaction_id
source_artifact_id
metadata
```

```text
bank_transaction_artifacts
--------------------------
bank_transaction_id
source_artifact_id
metadata
```

Each table has foreign keys and a composite primary key that prevents duplicate
attribution. `transaction_artifacts` means that a file supports a recorded Folio
transaction. `bank_transaction_artifacts` means that an imported bank row came from or
appears in a source file. The relationship metadata is optional, non-authoritative
provenance that is not queried during ordinary operation:

```json
{ "row": 3 }
```

A PDF relationship may use empty metadata. Future parsers may record a page or entry
without changing the schema. The database does not interpret locators; profile parser
tests ensure every source row is emitted once and attributed correctly. A bank
transaction may be attributed to a CSV, a PDF statement, or both.

## Module boundaries

```text
src/artifacts/profiles.ts
  immutable artifact-profile registry and media/extension/evidence rules

src/domain/bank-transactions.ts
  parser-neutral bank row, classification, commands, and validation

src/domain/bank-profiles/commbank-transaction-history-v1.ts
  fixed CommBank CSV parser and metadata extraction

src/domain/cash-effect.ts
  canonical signed-AUD projection shared by reports and matching

src/database/bank-repository.ts
  atomic confirmation, queries, commands, locking, and create-and-match

src/server/bank-operations.ts
  authentication, action authorization, parsing orchestration, and safe outcomes

src/routes/banking/*
  preview, activity, reconciliation, and import-history presentation
```

The artifact service owns object integrity and lifecycle but does not parse bank
formats. Profile parsers are pure and know no PostgreSQL, S3, HTTP, or UI state. The
repository does not infer classifications or matching scores.

## Authoritative operations

```text
prepareArtifactUpload(profile, originalFilename, size, checksum)
previewBankCsv(profile, bytes)
confirmBankImport(artifactId, expectedArtifactRevision)
listBankImports(query)
listBankTransactions(query)
listMatchCandidates(bankTransactionId, window)
reconcileBankTransaction(command)
createTransactionFromBankTransaction(command)
```

Preview may be computed before upload, but confirmation reparses the pinned S3 object
server-side before committing. Client-supplied parsed rows are never authoritative.

## Import completion

The existing artifact lifecycle supplies completion state:

```text
pending    upload or atomic bank-row confirmation incomplete
available  object verified and every confirmed bank row committed
abandoned  cancelled or expired
superseded existing replacement semantics where applicable
```

Bank confirmation:

1. locks the pending artifact;
2. verifies the uploaded S3 object and version;
3. inserts every validated bank transaction;
4. inserts every artifact attribution;
5. changes the artifact to available;
6. commits the PostgreSQL transaction.

Provider verification and PostgreSQL remain separate systems. A rollback leaves the
artifact pending and retryable. Import history is derived from artifacts, attributed
bank transactions, classifications, and matches. No `bank_imports` table or stored
summary is proposed.

An identical checksum for the same profile returns the existing available import with
an `already_imported` outcome and cannot be confirmed as a new import. A pending match
resumes confirmation. For a non-identical file, preview compares its earliest and
latest posted dates with existing imports of the same profile. Every intersecting date
interval is shown with the existing artifact and overlap start/end dates. The operator
may continue explicitly; rows are never silently deduplicated or merged.

Same-profile/checksum confirmation is serialized by locking the matching artifact row
and a database uniqueness constraint. The exact constraint includes profile and
checksum and applies to active bank-source artifacts. Concurrent losers reload and
return the committed import rather than inserting another set of rows.

## Migration strategy

All existing records and objects are disposable test data. Use one forward destructive
migration for the current environment:

1. remove existing transaction/artifact test records and obsolete S3 test objects;
2. replace artifact `kind` with non-null `artifact_profile`;
3. update evidence constraints to require `manual_invoice_pdf_v1` exactly;
4. add `bank_transactions`, `transaction_artifacts`, and
   `bank_transaction_artifacts`;
5. add profile/media, classification/match, checksum, and foreign-key constraints;
6. update application-role grants and migration health checks;
7. change upload preparation to generate one UUID and persist it explicitly;
8. adopt canonical profile/UUID keys for every new artifact.

No dual-read/write compatibility or old-key migration is required. Before any live
data exists, verification must prove that a bank PDF cannot satisfy invoice evidence
and a manual invoice PDF cannot enter a bank importer.

## Reconciliation commands

```text
bankTransactionId
expectedRevision
command
```

Command is a discriminated union:

```text
match      { transactionId }
classify   { classification: private | transfer | duplicate }
reset      {}
```

`match` sets the transaction and clears classification; `classify` sets classification
and clears the match; `reset` clears both. Repeated requests already reflected in
authoritative state return `already_applied`; conflicting requests return a revision
or state conflict. Version one uses natural business-state idempotence rather than an
idempotency table or arbitrary key. `Leave unresolved` is navigation, not a mutation.

## Matching contract

One pure domain function provides an eligible transaction's signed AUD cash effect.
Reports, signed presentation, overview, and bank matching use the same primitive.

Version-one candidates are manually entered, recorded, non-void, completely settled
in AUD, not already matched, not transfer or adjustment kinds, and have an unambiguous
signed cash effect. Stripe rows are excluded because Stripe balance movement is not
necessarily the bank settlement event.

Eligibility requires exact signed-AUD equality. Dates, description, counterparty, and
reference rank candidates but never override amount or direction. The default window
is plus or minus 14 days, with 31-day and search-all options.

Split, aggregate, partial, tolerance, combined-fee/refund, and many-to-many cases remain
unresolved. Folio never encourages synthetic balancing transactions.

### Create and match

One PostgreSQL transaction locks and revision-checks the unresolved bank transaction,
creates the reviewed Folio transaction, links it, and commits. After an unknown client
outcome, reloading the bank transaction reveals whether it committed.

### Matched transaction protection

Reset/unmatch is required before an edit makes the transaction ineligible or changes
its exact signed AUD cash effect. Description, reference, category, evidence, document
facts, settlement date, and same-direction eligible classification remain editable.
The transaction must remain manual, recorded, settled, and denominated in AUD for its
settlement; voiding still requires unmatching.

The canonical signed effect follows current manual cash semantics:

```text
sale, supplier_credit, owner_contribution, owner_loan  positive
supplier_expense, processing_fee, sale_refund, owner_loan_repayment  negative
transfer, adjustment, dispute                         ineligible in version one
```

Migration 0015 revalidates the edited transaction against the immutable matched bank
amount instead of rejecting every identity-field change. Repository checks provide
an actionable `BANK_MATCH_EDIT_CONFLICT` without changing the match. Bank-row locks
precede the transaction lock; the trigger also protects direct database writes.

Migration 0016 extends both match eligibility and matched-edit validation to
owner-loan principal repayments. Their cash effect is negative with no tax expense.
Creating a repayment from an outgoing bank row leaves its lender unset for explicit
selection, rather than assuming that the editor is the recipient.
Reset removes the match before an incompatible edit or void.

## Permissions

```text
bank_activity:view
bank_activity:import
bank_activity:reconcile
```

Existing artifact-download authorization remains authoritative. Every operation
authorizes independently; hidden presentation is never authorization. Administrators
and members may view, import, reconcile, and download permitted artifacts;
administrators alone manage users and permissions.

Raw bank descriptions and metadata are accessible only through `bank_activity:view`;
source downloads additionally require artifact-download authorization. They never
enter diagnostic logs. Card hints retain only masked suffixes. Retention follows the
source artifact retention policy and must be confirmed before live imports.

## Overview and reporting

Bank transactions never directly contribute to Folio reports. A server aggregate,
independent of table filters, provides recorded inflow/outflow magnitudes, signed net,
recorded count, unresolved bank count, missing required invoice evidence, pending bank
uploads, covered range, basis, and warnings.

Missing evidence delegates to the authoritative evidence predicate. Bank matches and
bank artifacts never count as invoice evidence.

| Context                | Convention                                     |
| ---------------------- | ---------------------------------------------- |
| Transaction table      | signed movement                                |
| Bank activity          | signed source movement                         |
| Summary inflow/outflow | positive magnitudes                            |
| Summary net            | signed                                         |
| Cash chart             | inflow above, outflow below axis               |
| Exact chart table      | positive inflow/outflow magnitudes, signed net |

## Tentative acceptance criteria

- Upload keys are server-controlled profile/UUID paths; original names never enter S3
  keys.
- Profile selects parser, purpose, source, evidence eligibility, and media type.
- Bank CSV/PDF artifacts never satisfy invoice-evidence requirements.
- Confirmation atomically makes the artifact available and writes every bank row and
  attribution; rollback leaves it pending.
- Bank rows affect no Folio report directly and may reference CSV, PDF, or both.
- Matching is explicit, one-to-one, recorded-manual-only, and exact signed AUD.
- Create-and-match is atomic; matched financial fields cannot change before reset.
- Private, transfer, and duplicate are simple zero-effect classifications without a
  required target or reason.
- Repeated operations recover through checksum, revision, constraints, and current
  state rather than an idempotency ledger.
- Unsupported complex matches remain unresolved.
- Named permissions protect every operation and source download.

## Resolved design questions

- Current data is disposable, so `kind` is replaced directly by non-null
  `artifact_profile`; no rollout compatibility is required.
- Profile plus media type is sufficient. The server registry derives all other type
  axes and evidence behavior.
- Bank confirmation reparses the pinned object and commits rows, attributions, and
  artifact availability in one PostgreSQL transaction.
- Artifact attribution uses only its composite key and optional metadata. CSV row or
  future PDF position is provenance metadata, not a database invariant.
- Exact profile/checksum duplicates are rejected as new imports. Date-range overlaps
  are disclosed precisely and require an explicit continue action, but are allowed.
- Private, transfer, and duplicate require neither a target nor a reason in version
  one. Current actor/time and reset provide the accepted review model.
- Natural business-state idempotence is sufficient. Unknown outcomes reload current
  state; no general idempotency ledger is added.
- Eligible transaction kinds and signs are fixed in the matching contract; dispute,
  transfer, adjustment, and Stripe are excluded.
- A focused database trigger plus repository checks protects matched financial fields.
- Bank descriptions and masked hints are permission-controlled and excluded from logs;
  live retention duration requires explicit operational confirmation.

## Provisional implementation plan

Identifiers are local to this candidate plan until final review and roadmap promotion.

### BANK-I01 — Artifact profiles and canonical keys

Replace artifact kind with the server profile registry and media validation; generate
one UUID for PostgreSQL and S3; enforce `artifacts/<profile>/<uuid>.<extension>`; update
invoice evidence, Stripe, downloads, the two typed artifact through tables, tests,
grants, and health checks.

Verification: profile registry tests, profile/media mismatch rejection, evidence
isolation, key traversal/shape tests, checksum binding, and complete artifact lifecycle.

### BANK-I02 — Canonical signed-AUD cash effect

Extract the manual cash-effect primitive from reporting and reuse it in reports,
signed transaction presentation, overview totals, and matching eligibility.

Verification: every eligible kind and exclusion, exact decimal scale normalization,
incomplete/non-AUD settlement, draft/void, and regression parity with reports.

### BANK-I03 — Bank schema and repository

Add minimal bank transactions and artifact attribution, typed constraints, indexes,
permissions, immutable source-field updates, checksum serialization, derived states,
revision commands, and matched-transaction protection.

Verification: migration/schema tests, concurrency, checksum races, classification,
reset, one-to-one uniqueness, protected versus harmless edits, and rollback.

### BANK-I04 — CommBank parser and preview

Implement the fixed profile as a pure parser, preserve exact source strings in the
preview/metadata projection, return safe row/field errors, and add the staged upload
and cancel flow.

Verification: headerless four-column fixtures, quoting, dates, signs, decimal bounds,
malformed rows, metadata hints, no omitted/duplicated rows, and cancellation.

### BANK-I05 — Atomic confirmation and import history

Reparse the pinned object server-side, atomically insert bank rows/attributions and
make the artifact available, return replay outcomes, warn on overlapping files, and
provide derived import-history queries.

Verification: S3 verification mismatch, transaction rollback, pending retry,
same-profile/checksum concurrency, exact-duplicate rejection, precise date-range
overlap warnings and acknowledgement, already-imported recovery, and bounded history
queries.

### BANK-I06 — Activity and reconciliation queries

Add bounded URL-addressable bank activity, derived state counts, deterministic exact-
AUD candidate ranking, explicit match/classify/reset commands, and conflict outcomes.

Verification: authorization, filters/pagination, date windows, tie-breaks, stale
revisions, already-applied commands, double-match races, and unsupported complex cases.

### BANK-I07 — Create transaction from bank transaction

Prefill the managed manual form and atomically create-and-match after review without
allowing bank artifacts to satisfy invoice evidence.

Verification: cancellation, field validation, failure rollback, unknown-outcome
reload, duplicate retry, evidence isolation, and matched-field protection.

### BANK-I08 — Banking UI and overview integration

Implement Imports, Activity, and Reconcile routes plus Overview absolute counts using
operation-scoped loading/error states and the approved tentative UI architecture.

Verification: empty/loading/error/conflict/retry/permission states, keyboard and
screen-reader interaction, 320px reflow, populated desktop/mobile review, full static
gates, and production build.

### BANK-I09 — CommBank PDF profile

After the CSV vertical slice is accepted, implement the explicit text-PDF profile and
attribute statement artifacts to existing or newly confirmed bank transactions. OCR
and arbitrary layouts remain excluded.

Verification: synthetic PDFs, layout/version rejection, preview, atomic attribution,
ambiguous-row review, CSV/PDF coexistence, and artifact access.

### Sequencing and parallel boundaries

```text
BANK-I01 -> BANK-I03 -> BANK-I04 -> BANK-I05 -> BANK-I06 -> BANK-I07 -> BANK-I08
      \-> BANK-I02 -----------/

BANK-I09 follows accepted CSV reconciliation.
```

I01 and I02 may run in parallel. Parser fixtures may begin after the profile contract
is fixed, but persistence and UI must not assume parser output before its canonical row
interface is accepted. UI route-shell work may proceed independently; mutation screens
wait for command/query contracts.

## Review gates

- Independent adversarial domain and schema review.
- Migration review for profiles and current evidence constraints.
- Database review of atomic confirmation, uniqueness, conflicts, and matched-field
  protection.
- Security review of profile selection, artifact access, and permissions.
- Financial review of signed effects and exclusions.
- Accessibility/browser review of preview, matching, classification, conflict, retry,
  and recovery.
- Synthetic fixtures only until retention/privacy decisions are confirmed.

Testing dependencies run in disposable Docker containers. Use PostgreSQL 17 for real
constraint, transaction, trigger, and concurrency tests and an S3-compatible container
with versioning enabled for object-integrity, presign, confirmation, and recovery
tests. Tests must not depend on the development database, production database, or live
S3. Container images are pinned during implementation, state is isolated per run, and
fixtures contain no real financial or personal data.

## Independent adversarial review — 22 September 2026

Verdict: **do not promote yet**. The reviewer found the direction conservative and
implementable, but identified the following promotion blockers:

1. Reconcile the candidate with stable BILL-T28: either amend its disposition,
   duplicate-reason, and fingerprint requirements or restore those semantics here.
2. Remove the unspecified `expectedArtifactRevision` argument or define an artifact
   revision model. The minimal resolution is row locking plus explicit state/replay
   semantics without an artifact revision.
3. Make upload confirmation and pending-upload recovery profile-aware. Generic paths
   must reject bank profiles; bank recovery must reparse and atomically persist rows
   and attributions before making the artifact available.
4. Specify the `matched_transaction_id` foreign key, target-eligibility enforcement,
   transaction/edit lock ordering, and real PostgreSQL concurrency verification.
5. Resolve BILL-T24 first: shared PDF attribution and replacement lifecycle must not
   allow an artifact still referenced by another transaction to be superseded.
6. Define a privacy boundary for raw bank descriptions, sanitized data copied into a
   Folio transaction, and typed/redacted bank-operation diagnostics.

Important pre-implementation refinements are canonical download filenames, exact
profile enforcement at database boundaries, preservation or deliberate rejection of
lexical source values, cancellation semantics for pending artifacts, exact-decimal UI
adapters, operation-permission matrices, bounded candidate search, through-table
foreign keys/immutability/indexes, and integration tests for PostgreSQL and pinned S3
recovery.

The reviewer accepted destructive migration of disposable test data, exact one-to-one
signed-AUD matching, separation of bank activity from Folio transactions, natural
business-state idempotence once replay rules are explicit, and deferral of accounts,
Athena, complex matching, and general audit history.

### Resolution — 23 September 2026

The candidate is promoted with these resolutions:

1. BILL-T24 and BILL-T28 use separate typed through tables, derived reconciliation
   state, optional locator metadata, and artifact-level checksum idempotence.
2. Artifact revision is removed from confirmation. Commands lock the artifact row and
   resolve replay from its current state.
3. Upload confirmation and recovery dispatch by profile. Generic confirmation rejects
   bank profiles; bank confirmation reparses and commits every row before availability.
4. Matching uses a foreign key, unique non-null match, repository eligibility checks,
   database mutation protection, and bank-row-then-transaction lock order.
5. Shared evidence lifecycle is delivered by BILL-T24 before bank-statement PDF work.
6. Raw bank descriptions remain in authorized bank projections, never URL query state
   or logs. Create-from-bank prefills an editable description rather than silently
   copying authoritative source text.

Exact profile/checksum duplicates are rejected. For non-identical imports, every
overlap between the new earliest/latest posted-date interval and an existing import is
shown; explicit acknowledgement permits continuation. Similar individual rows are not
automatically merged.
