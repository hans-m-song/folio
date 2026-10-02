# Implementation candidates

Investigation date: 1 October 2026. These plans do not authorize implementation,
commits, new worktrees, live-data access, migrations, provider changes or deployment.
The operator approved the initial BILL-T68, BILL-T33 and BILL-T77 scopes on
1 October 2026 and authorized implementation in the current working tree with
synthetic tests and no commits on 2 October 2026. Separate worktrees and BILL-T78
provider tests remain outside that authorization.

## Investigation checklist

- [x] Inspect source boundaries and the current worktree baseline.
- [x] Confirm local invoice inspection without external uploads.
- [x] Confirm the Business pool uses the same agreed partner percentages.
- [x] Inventory the supplied PDFs by filename: 26 invoices, excluding two CBA statements.
- [x] Inspect supplier layouts and distinguish invoice facts from payment facts.
- [x] Specify BILL-T68 user-linked direct and Business-pool allocation.
- [x] Specify BILL-T33 explicit match/create-and-next behavior.
- [x] Specify BILL-T77 supplier invoice parsing and duplicate safeguards.
- [x] Specify BILL-T78 unversioned storage, integrity and preservation requirements.
- [x] Independently audit acceptance cases and parallel ownership.
- [x] Record remaining decisions and the safe implementation sequence.
- [x] Confirm initial attribution/adjustment rules, queue traversal and Stripe review-only scope.

Status on 2 October 2026: BILL-T68, BILL-T33 and BILL-T77 are code-complete with
independent focused review, 943 passing synthetic tests and one skipped test across
94 files. Sequential production build/TypeScript, scoped lint/formatting and
isolated built-extractor proof passed. Operator/browser and PostgreSQL execution
checks remain open; provider compatibility has not been tested.

## Implementation checklist

- [x] BILL-T68 actual-user allocation, frozen versioned snapshots and legacy compatibility.
- [x] BILL-T33 explicit match/create-and-next with authorized cross-page queue selection.
- [x] BILL-T77 deterministic parsers, bounded local extraction and reviewed field application.
- [x] Integrate shared interfaces without reverting the existing dirty-tree changes.
- [x] Independently verify synthetic behavior, TypeScript and production build.
- [x] Record verified outcomes and remaining operator-review steps.
- [ ] Operator review after rebuilding the application image.
- [ ] Separately authorized PostgreSQL execution checks for queue ordering/rank.

Production packaging: PDF.js 6.3.289 uses a Node-entry-anchored resolver and explicit
Nitro tracing of build-resolved legacy display/worker/native canvas paths. Extraction
passed from an isolated copy of the built server using only synthetic PDF bytes.
No live invoice, auth/runtime handler, provider switch, migration or deployment ran.

## Confirmed scope

The operator prefers parsing existing supplier invoices over CommBank statement
PDFs from the local invoice folder supplied by the operator.
The inventory contains ten Google Workspace invoices, nine Supabase invoices
and seven Stripe invoices. All 26 have extractable text and are unencrypted.
Nine representative files were rendered and their privacy-masked financial
regions inspected across all 15 pages. This establishes a bounded initial layout
set, not support for arbitrary future invoices or completeness of accounting records.

Partner allocation uses actual selected users. Included income and expenses
attributed directly to a partner are separate from the remaining Business pool.
Business expenses use the same agreed percentages and are added to direct partner
expenses. No amount may be counted in both buckets. Custom per-cost splits are
deferred. This changes allocation, not deductibility or ledger ownership.

## Constraints identified on 1 October 2026

- The invoice workflow currently extracts only supplier, date and optional reference
  from filenames. Content extraction must be a separate bounded read operation;
  suggestions do not approve an artifact, create a transaction or establish payment.
- Imported Stripe fees already contribute expense effects. Current invoice-evidence
  links accept manual transactions only, so linking monthly invoices to imported
  Stripe transactions requires a separately agreed integration boundary.
- Current reviewed tax snapshots have generic partner labels and no explicit model
  version. New ownership-aware snapshots must preserve legacy calculations, exports
  and source-fingerprint comparisons without rewriting historical records.
- Reconciliation filters and pagination already exist. Current “Leave unresolved
  and continue” wraps within the loaded page; it is not a successful-match advance
  action.
- Artifact confirmation and subsequent reads currently require real object version
  IDs. Removing bucket versioning is not a configuration-only change.
- Only the main Git worktree exists. Recent production changes include uncommitted
  tracked and untracked files; a new worktree at HEAD would omit them. A reviewed
  checkpoint or patch baseline must precede concurrent implementation. Worktrees do
  not isolate database, object storage or ports.

## Implementation order and ownership

| Track    | First deliverable                                      | Parallel boundary                                                       | Gate before integration                                  |
| -------- | ------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| BILL-T68 | Actual-user allocation and a reviewed source breakdown | Tax domain, tax server, tax route and tests                             | Attribution rules and versioned compatibility approved   |
| BILL-T33 | Explicit match/create-and-next                         | Reconciliation route, authorized queue-selection read and focused tests | Queue traversal rule approved                            |
| BILL-T77 | Deterministic supplier parsers with synthetic fixtures | New invoice domain modules and fixtures                                 | Parser contract, then extractor/form integration         |
| BILL-T78 | Synthetic S3 compatibility report                      | New isolated probe/test modules                                         | Disposable-test scope and provider capabilities approved |

T68, T33 and parser-only T77 can proceed independently after a reviewed baseline
and implementation approval. T33 must use the shared form's existing
`recordButtonLabel` interface, not edit the form. T77 form integration and T78
storage/lifecycle integration must be sequenced: both touch artifact reads,
upload orchestration and `src/server/operations.ts`. T68's narrow user-choice query
and T78 persistence changes also share `src/database/repository.ts`; assign
integration ownership to one worker at a time. Main owns planning/roadmap/handoff
documentation and dependency lockfiles. Do not run concurrent builds or point
parallel tests at the same database, bucket or live services.

BILL-T30 CommBank PDF parsing remains deferred, not deleted or renumbered.
BILL-T77 and BILL-T78 were unused IDs in the repository roadmap when assigned.
TaskView tools are unavailable in this session; these are repository task IDs,
not claims that external tasks have been created.

## BILL-T68 — Actual-user partner attribution

### Outcome and rules

Scope is the existing FY2025–26 worksheet, not a new multi-year tax engine.
Choose an active Folio user for each partner and enter agreed percentages totalling
exactly 100%. A user account is not automatically a partnership member. Duplicate
user IDs reject; inactive users cannot be selected for a new review. Read-only
historical reviews retain their frozen identities, including subsequently inactive
users. Options expose IDs and display labels, not email addresses or full user rows.

Confirmed on 1 October 2026: direct attributed income/expenses plus percentage
shares of the remainder; Business expenses use the same agreed percentages.
Matching selected owners are direct; other/unassigned owners are Business.
Linked adjustments follow this classification, while unlinked adjustments use
Business. Per-transaction Business overrides, direct reassignment and custom splits
remain outside the approved initial scope.

```text
Included source effects + reviewed adjustments
                    |
          owner matches a selected partner?
              /                         \
          direct                     Business pool
              |                         |
       matching partner          agreed percentages
              \                         /
                  final partner totals
```

Each partner's final income and expense equal direct effects plus their respective
Business shares; net equals income minus expense. Partition every effect exactly
once. Owner contributions/loans have zero income/expense effects even where their
cash movement is included. Exclusions and deductible-expense judgments remain
unchanged. Show Business explicitly in the attribution breakdown; never invent a
Business user record or infer system accounts from names or administrator roles.

Illustrative synthetic acceptance case:

| Partner | Share | Direct income | Business income share | Direct expense | Business expense share | Final income | Final expense | Net    |
| ------- | ----- | ------------- | --------------------- | -------------- | ---------------------- | ------------ | ------------- | ------ |
| User A  | 60%   | 100.00        | 120.00                | 10.00          | 60.00                  | 220.00       | 70.00         | 150.00 |
| User B  | 40%   | 50.00         | 80.00                 | 20.00          | 40.00                  | 130.00       | 60.00         | 70.00  |
| Total   | 100%  | 150.00        | 200.00                | 30.00          | 100.00                 | 350.00       | 130.00        | 220.00 |

### Interfaces and compatibility

- New review input contains `{ userId, percentage }` partners, not trusted client
  labels. A narrow option query uses `report:read` plus `report:review` and returns
  `{ id, label }`; server-side validation rechecks active targets. Ambiguous labels
  include a stable ID distinction. No live user rows were inspected for this plan.
- Enrich the tax source ledger with owner IDs from the same loaded transaction
  set. Keep profile labels out of financial fingerprints; label changes do not
  change attribution. Do not change the operational owner field to implement tax
  allocation.
- Use a new, separately versioned snapshot model, `modelVersion: 2`, and
  `sourceFingerprintVersion: 2`. Freeze selected IDs/labels, percentages, each
  source's owner and classification, direct/Business/final signed income and
  expense allocations, and adjustment attribution. Stored version numbering and
  snapshot-model versioning are distinct.
- Read absent model versions as legacy v1 only. Keep their generic-label amounts,
  UI component calculation and CSV/JSON exports unchanged. Do not map old labels
  to live users or rewrite append-only snapshots. Reject unknown model versions.
- Preserve the exact v1 owner-less fingerprint projection, key order, version
  marker, row ordering and revisions for legacy current/stale checks. New reviews
  use owner-aware v2 fingerprints. Existing owner edits still stale legacy reviews
  through `updatedAt`; adding a field at deployment must not stale them alone.
- Use exact signed 1/10,000-AUD units and deterministic remainder assignment by
  stable user ID, excluding zero-percentage partners from shared remainders.
  Direct effects can be negative after refunds/credits. Do not reuse the current
  non-negative component allocator unchanged. Final column sums and each row's
  income-minus-expense identity must hold. Preserve the existing money formatter's
  non-zero sub-cent precision, rather than independently rounding columns to cents.
- New-version UI and exports consume frozen allocations; they must not recalculate
  from live owners or current percentages. New CSV columns expose direct, Business
  and final components with existing formula-injection escaping. Preserve old CSV
  contracts. Generic legacy percentages may seed editable shares, but user identity
  requires explicit selection.
- Preserve source-readiness, attestation and source-change checks on save/export.
  Current source read and snapshot insert are separate operations: a change after
  the read may make the new result stale. Do not claim atomic ledger locking; reload
  after saving and retain stale-export rejection. Stronger commit-time source CAS is
  a separate persistence decision, not a guarantee of this plan.

### Edit surface and verification

Own tax domain modules (`tax-partners`, `tax-source-review`, `tax-workbook`, new
`tax-attribution`), `server/tax-operations`, `routes/reports_.tax`, scoped tax CSS and
tests, plus a narrowly integrated user-options query. Snapshot JSONB already permits
additional keys; no historical rewrite or tax-table migration is planned.

Synthetic cases: the table above; signed refunds/credits; mixed direct/shared
adjustments; zero-percent direct-only partners; duplicate/inactive users; malformed
percentages; exact remainders; reversed input order; owner funding/exclusions;
source ownership edits; unchanged legacy fingerprints, UI and exports; unknown
versions; saved labels/amounts unchanged after profile edits; unauthorized choices
and review. Finish with an operator review of source attribution and totals.

Source evidence: [current partner contract](../src/domain/tax-partners.ts),
[owner-less ledger](../src/domain/reports.ts), [fingerprint v1](../src/domain/tax-source-review.ts),
[review payload/exports](../src/domain/tax-workbook.ts), [save/export guards](../src/server/tax-operations.ts),
[append-only repository](../src/database/tax-review-repository.ts),
[JSONB constraints](../migrations/0014_folio_tax_review_snapshots.sql), and
[authorization](../src/server/authorization.ts).

## BILL-T33 — Explicit match/create-and-next

### Outcome and interaction

Add “Match and next” beside normal Match. For create-and-match, use a route-owned
continue option and the existing form submit-label prop. Normal match/save actions
keep the current selection. Advance only for `applied` or `already_applied`; stay
on invalid, stale-revision or failed results. Successful reconciliation and
subsequent navigation are separate outcomes: if queue lookup fails, say the row was
matched but advancing failed, with navigation retry only, not another financial write.

Traversal approved on 1 October 2026: next unresolved row in descending posted
date/ID order within the active import/filter, across pages, wrapping once to the
first remaining unresolved row. No unresolved row means keep the resolved detail
visible and announce the queue is complete. Preserve artifact, unresolved and
window query values; set the target bank ID and correct page. “Leave unresolved and
continue” remains a non-resolving action; do not silently change it in this slice.

Capture the current row's stable date/ID anchor before mutation. After successful
reload, do not use its old array index: unresolved-only rows disappear and offset
positions shift. The helper must choose from fresh queue state and skip resolved
rows, including those another operator resolved. Ignore late navigation responses
after the operator changes import, selection or filters.

### Implementation boundary

The existing authorized reconciliation query accepts artifact, unresolved-only,
window and page offset and returns 100 rows ordered by `posted_date DESC, id DESC`.
The selected implementation is a narrow authorized bank-selection GET, not repeated
whole-queue page scans. Input: current bank-row ID, active artifact filter and the
displayed unresolved-only flag. Read the immutable posted date/ID anchor server-side;
verify the anchor belongs to the active import when one is selected. Return
`{ status: "target", bankId, page }`, `{ status: "none" }`, or
`{ status: "advance_incomplete", reason }`. Page is one-based, matching the route,
with offset `(page - 1) * 100`. Preserve the matching-window value in
route navigation; it controls candidate matching, not queue row filtering.

Choose the first unresolved `(posted_date, id)` tuple after the anchor, then the
first unresolved row before it if wrapping is enabled. Exclude the current ID.
Calculate the target's rank/page in the actual displayed list: include resolved
rows in the rank when unresolved-only is false. Choose target and rank against one
database statement snapshot; use existing actor and bank-read gates. Do not alter
match/create operations, bank records, financial identities or the paging contract.
If the target is resolved between query and loader refresh, re-query once; further
queue changes produce a matched-but-advance-incomplete notice, not an infinite loop
or false completion claim. A late response cannot override newer navigation.
Keep the existing page-101/offset-10,000 limits. A target outside the reachable
10,100-row window returns `advance_incomplete: queue_limit`, never a clamped page
or `none`; suggest narrowing the import/filter and keep the matched detail visible.

Own reconciliation route/helper, a narrow `server/bank-operations` read entry and
`database/bank-repository` selection method, plus focused tests. Protect shared form code,
tax allocation, owner choices, import/profile definitions, matching constraints,
classification Undo and unmatch confirmation. Candidate review links opening in a
new tab are a separate remaining T33 UX choice; do not bundle them unannounced.

Synthetic cases: both explicit success paths; no advance for ordinary actions;
`already_applied`; invalid/stale/throw; preserved filters; page contraction after
resolution; same-date IDs; one-based page/offset conversion; page-101 boundary and
beyond-limit targets; cross-page target; wrap once; empty queue; concurrently
resolved targets; failed navigation retry; changed-filter late-response guard;
unchanged upload retries, Undo and unmatch confirmation. No live reconciliation
or database test is authorized by this plan.

Source evidence: [route actions and search](../src/routes/banking.reconcile.tsx),
[authorized paging query](../src/server/bank-operations.ts),
[queue ordering](../src/database/bank-repository.ts),
[existing form label interface](../src/components/manual-transaction-form.tsx), and
[interaction tests](../src/routes/-banking.reconcile.interactions.test.tsx).

## BILL-T77 — Supplier invoice PDF suggestions

### Inspected layouts and first-release behavior

| Supplier         | Files and coverage in supplied folder | Observed shape                                                                                                        | Initial behavior                                                                                                               |
| ---------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Google Workspace | 10; November 2025–August 2026         | Two-page AUD invoice; summary and itemization repeat totals, subtotal and GST                                         | Suggest invoice fields and tax-inclusive document total; repeated equal totals are one fact                                    |
| Supabase         | 9; January–September 2026             | One to three pages; paid amount, subscription/usage lines and credits; summaries can follow a page break              | Suggest supplier/reference/date; show paid/subtotal facts, require document-total review and currency confirmation when needed |
| Stripe           | 7; January–June and August 2026       | One-page AUD monthly fee invoice; processing fees, sometimes Billing usage, GST, deducted fees and zero remaining due | Proposed review-only extraction and duplicate warnings; do not pre-fill a new expense                                          |

All 26 were inspected for text/page/label availability. Rendered privacy-masked
representatives were the earliest/latest Workspace invoices; January/April/August
Stripe invoices; and January/February/June/September Supabase invoices. No source
PDF, raw extraction, bill-to name, email, address, card detail, account identifier
or project identifier is to be committed or logged. Temporary review tooling and
privacy-masked renders are outside the repository; original PDFs remain unchanged.
Source filenames, invoice/customer references and host-specific document paths are
omitted from this durable parser specification. The representative coverage above
records the inspected supplier/date/layout boundaries without reproducing invoice data.

The supplied set contains no July 2026 Stripe invoice; this is not proof that one
should exist or that other records are complete. CBA PDFs are excluded. No OCR,
bank-statement parsing, external AI/upload service or automatic record approval.

### Parser and extraction contracts

1. Define a pure, versioned parser contract in new invoice domain modules. Input is
   normalized per-page text items with positions, not a filename alone. Output is
   `recognized`, `needs_review` or `unsupported`, parser ID/version, typed financial
   suggestions, page/label provenance and warning codes. Recognition requires
   content anchors; filenames remain optional corroborating hints. Reference is
   optional. Missing/contradictory facts are not replaced by fabricated defaults.
2. Separate `invoiceTotal`, `amountPaid`, `amountDue`, subtotal, tax and line-item
   fees. Never select the first, last or largest number generically. Dates distinguish
   invoice issue, service ranges and payment evidence. Supabase contains different
   periods for usage and subscription lines; do not collapse them into an invented
   cash/activity date. Recognize repeated equal summaries; contradictory repeats,
   broken totals, unknown credit-note layouts or currency conflicts require review.
   Normalize extraction whitespace inside recognized numeric/date fields, including
   the inspected split decimal in a Supabase paid amount, not arbitrary token joins.
3. Keep every monetary value as an exact decimal string. Explicit `AUD`/`A$` or
   `USD`/`US$` supports currency suggestions; unqualified `$` alone does not.
   No FX rate/AUD settlement inference, GST registration/claim inference, operational
   category selection or deductible classification from supplier identity.
4. Add a dedicated server-side local text extractor, proposed Mozilla PDF.js via
   the documented Node/display API, rather than an exception in the CSV reader.
   It receives bounded bytes, never a caller-supplied URL/path. Proposed limits:
   the lesser of existing upload limit and 10 MiB, ten pages, 250,000 extracted
   characters and a ten-second worker deadline. Terminate on limits; return a safe
   unsupported/manual-review result for encrypted, scanned, malformed or unfamiliar
   content. Do not evaluate invoice-derived code; load dependencies locally, without
   external resources. The pinned PDF.js 6.3.289 display/worker source has no
   `isEvalSupported` setting or `new Function` evaluator. The Node worker's `eval`
   option launches constant application-owned source, never invoice text.
   Pin a maintained release and verify its Node 24 and production-bundle compatibility
   against synthetic PDFs before accepting the dependency. Investigation's Python
   tooling is not a production dependency. [Official Node example](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs),
   [API layers](https://mozilla.github.io/pdf.js/getting_started/).
5. Extraction reads the exact confirmed `manual_invoice_pdf_v1` artifact in
   awaiting-review or available state through a document-service method. Recheck
   profile/state, actor access, size, checksum and pinned object identity. Return
   artifact ID/checksum and parser provenance, not full invoice text. Approval,
   linking and transaction save remain explicit existing operations. Keep current
   versioned reads first; integrate the T78 object-reference interface later.

### Review UI and duplicate safeguards

Add an “Extract invoice fields” action and compact review panel. Proposed authority:
`artifact:download` plus `artifact:upload`, matching the existing PDF-review boundary;
applying/saving still uses transaction/link permissions. Use a focused server module
with a narrow operation entry point; no new MCP tool in this initial slice.

For Workspace/Supabase, offer explicit Apply-to-blank for supplier, invoice date,
optional reference, document amount and explicit currency. Keep observed tax and
service/payment details informational initially. Flag filename/content and existing
field conflicts. Map the form's `documentAmount` only from a recognized
`invoiceTotal`, not `amountPaid`, `amountDue`, a unit price or subtotal alone.
When a supported paid receipt exposes only subtotal and amount paid, as in the
inspected Supabase samples, show those facts but require the operator to enter or
explicitly confirm the reviewed document total before it can be applied. Do not
invent a parsed invoice total by equating payment with billing. For an invoice with
total 100, paid 60 and due 40, document amount is 100; without a recognized total,
neither 60 nor 40 is an automatic substitute. Test this mapping and partial payments.
Deliberate replacement requires a field-level choice. An ambiguous
amount/currency pair must not be applied to an assumed existing currency. Ignore late
results if the chosen file/artifact changes or the operator has edited the target.
Never fill settlement amount/date, occurred/activity date, tax classification, owner
or GST claim. Existing filename behavior remains unchanged and clearly labelled.
Implement content application separately from `applyPdfSuggestionsToBlankFields`,
whose existing invoice-date branch also sets `occurredAt` when unedited. New content
application must not inherit that side effect; test it alongside unchanged filename
application behavior.

Stripe requires separate treatment. Imported balance rows already contribute fee
expenses and may include separate fee types; a monthly fee invoice is not evidence
of a missing expense. Billing usage is not automatically absent from the CSV either.
Current database evidence rules reject linking PDFs to imported Stripe transactions.
The first release, approved on 1 October 2026, shows parsed processing/Billing/tax/total/due facts and warns
against duplication, without new-expense amount prefill or import-link writes.
Enabling either later requires an explicit many-to-many evidence model and a review
of exact CSV coverage, no automatic inferred matching. More generally, existing
invoice/reference/checksum/link matches produce review warnings, not a new global
uniqueness rule that would invalidate legitimate shared evidence.

### Deliverable slices and synthetic acceptance

- BILL-T77.1: pure Workspace/Supabase/Stripe recognizers and versioned synthetic
  text-item fixtures. Include two-page repeated Workspace totals; one-, two- and
  three-page Supabase layouts, usage credits and four-place unit prices; standard
  and Billing-usage Stripe layouts. No real PDFs/text in repository fixtures.
- BILL-T77.2: bounded extractor and authorized immutable-artifact read using tiny
  synthetic PDFs; production build, deadline/limit and failure behavior verified.
- BILL-T77.3: review panel/apply semantics. Cover blank-only versus deliberate
  replacement, optional reference, ambiguous currency, zero due/non-zero expense,
  page breaks, repeated/conflicting totals, wrong supplier anchors, invoice/payment
  dates, late results, privacy-safe diagnostics and Stripe no-expense-prefill.

Own new `src/domain/invoice-*` modules and synthetic fixtures first, then new
`src/documents/invoice-extraction`/`src/server/invoice-operations` modules. Main
integrates document read interfaces, shared form, existing-artifact options,
authorization, package/lockfile and operation call sites in an agreed sequence.
Keep artifact profile `manual_invoice_pdf_v1`; supplier parser versions do not
create new artifact-profile enums. Operator must review the suggestions on their
own documents after rebuilding; live record mutation/E2E is not implied.

Source evidence: [filename parser](../src/domain/pdf-filename.ts),
[form application behavior](../src/components/manual-transaction-form.tsx),
[PDF lifecycle and CSV-only reader](../src/documents/service.ts),
[manual-only evidence linking](../src/database/repository.ts),
[Stripe fee mappings](../src/domain/stripe-semantics.ts),
[artifact profiles](../src/artifacts/profiles.ts), and
[permissions](../src/server/authorization.ts).

## BILL-T78 — Unversioned object storage without losing evidence

### Provider decision and invariants

Unversioned storage is the confirmed direction, not permission to suspend versioning
on the existing bucket or replace its data directory. Versioned legacy reads must
continue to address the exact stored version. Removing bucket history still requires
application-level write-once keys, verified integrity, backups and linked-document
deletion safeguards.

Documentation checked on 1 October 2026: SeaweedFS documents atomic conditional
PUT, making it the recommended first compatibility-probe candidate, not a verified
drop-in. Garage documents core S3/presigned URLs but lacks versioning and S3 bucket
policies; its table does not establish Folio's exact checksum/conditional-write
contract. Test either pinned image before selection. [SeaweedFS conditionals](https://github.com/seaweedfs/seaweedfs/wiki/S3-Conditional-Operations),
[Garage compatibility](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/).

AWS documents that unversioned same-key PUT overwrites unless protected by a
conditional write. UUID keys alone do not prevent a presigned upload URL being
replayed. Require signed `If-None-Match: *` on every unversioned upload and a scoped
write boundary that prevents unconditional overwrites. Do not silently replace
SHA-256 verification with ETag or user-controlled metadata. [AWS conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).

### Compatibility probe, before production changes

Proposed BILL-T78.1 test scope needs explicit approval: isolated disposable storage
containers, synthetic bytes only, private test credentials generated for that run,
loopback-only ports and fresh volumes/directories under allowed temporary roots.
No host invoice mounts, real buckets/volumes, existing Compose services, credential
files or environment-value reads. Do not start this test under the planning request.

Record the exact image tag/digest and SDK version. Test path-style signing,
presigned PUT/GET, content length/type, SHA-256 validation plus checksum-mode HEAD,
artifact-ID metadata, Range reads, PDF signature, CORS/required upload headers,
retry behavior, wrong checksums, expiry, concurrent/replayed same-key PUT, deletion
and restart persistence. A rejected second PUT must leave original bytes unchanged.
Missing native checksums require a separately approved bounded server-hash design,
not acceptance of an unverified provider. Fail selection if atomic create-only
writes cannot be enforced. Multipart is out of scope; Folio currently uses
single-part PUT. Do not infer single-part failures or success from multipart issues.

### Object-reference and lifecycle contract

- Persist an explicit per-artifact storage mode and stable storage-location alias:
  `versioned { locationId, key, versionId }` or
  `unversioned { locationId, key, expectedSha256 }`. Finalized mode is not inferred
  from a null version ID, which currently also denotes pending uploads. Never
  fabricate an S3 version ID such as `unversioned` or reinterpret old IDs.
- Backfill existing metadata as versioned/legacy without changing keys, versions,
  checksums, review state or links. Keep the legacy backend accessible. New uploads
  can use the chosen new location; aliases cannot silently be repointed to another
  backend. A new schema migration updates state/confirmation checks and Drizzle
  together. Reserve the migration ID at integration, not independently in worktrees.
- Keep locator details server-side where possible; deliberately version any public
  DTO changes. Retain existing artifact fields for compatible clients. Dispatch
  exact versioned reads to the old path and create-only unversioned reads to the
  new path; do not change tax, parser or matching semantics.
- Upload intents retain profile/opaque UUID keys, size/type/SHA-256 and artifact-ID
  metadata. Return required signed upload headers as an explicit contract and
  update all browser PDF/CSV upload paths, reconciliation uploads and MCP upload
  responses/instructions. Never assume adding a storage header changes callers.
  Register the maximum issued PUT expiry on the pending artifact before exposing
  each URL, including replay reissues. Registration must check pending state under
  the same row-lock/CAS boundary as deletion, so no new URL can be issued after
  a deleting claim. Include conservative clock-skew grace in the cleanup cutoff.
- Confirmation verifies the exact upload intent, byte identity and PDF signature;
  retries return the already confirmed artifact. A replayed conditional PUT's 412
  is a storage conflict, not an artifact confirmation failure: check/confirm the
  original upload if its intent matches. Wrong/missing bytes must not be approved.
- Recovery, preview/download, rejection, CSV import commits and MCP proposal source/
  evidence checks must accept the explicit locator, preserving state/revision CAS.
  Null-versus-string checks alone would otherwise reject every unversioned artifact.
- Preserve transactional linked-artifact deletion checks and the deleting tombstone.
  Versioned cleanup continues deleting relevant versions; unversioned cleanup uses
  exact-key delete with retries and metadata removal only after successful cleanup.
  An unexpired upload URL can recreate a deleted unversioned key: prevent final
  deletion until all issued URLs have expired, or explicitly revoke the upload
  boundary. Retain the deleting tombstone and return a typed retryable/deferred
  result with the cutoff; do not block an HTTP request waiting for a five-minute
  URL to expire. Final cleanup retries use the same locator and guard. Do not remove
  metadata while an upload remains writable.
- Keep original objects and old Compose volumes. No migration/copy/prune/delete is
  included in the first integration slice. Legacy copy/retirement needs a separate
  approved manifest, byte/checksum/access verification, backup/restore proof and
  rollback path; do not mount a MinIO data directory into another provider.

### Integration ownership and acceptance

BILL-T78.2 owns the object-reference port, document service/recovery and synthetic
adapter tests; main integrates artifact repository/schema/new migration, bank/import
and proposal consumers, upload callers, server DTOs and runtime aliases. BILL-T78.3
switches new uploads only after provider selection, approved disposable tests and
explicit deployment/configuration review. Use both a legacy versioned and new
unversioned fixture in every lifecycle path. Keep old snapshots and evidence links
readable, reject altered bytes, preserve idempotent recovery/delete behavior and
verify rollback without rewriting locators. Database integration tests and browser
upload/CORS acceptance require separately confirmed depth/environment.

Source evidence: [storage port/signing](../src/documents/storage.ts),
[confirmation/read/delete lifecycle](../src/documents/service.ts),
[pending recovery](../src/documents/reconciliation.ts),
[artifact state constraint](../migrations/0010_folio_artifact_review.sql),
[schema](../src/database/schema.ts), [artifact/import persistence](../src/database/repository.ts),
[bank import checks](../src/database/bank-repository.ts),
[proposal checks](../src/database/proposal-repository.ts),
[browser uploads](../src/routes/-transaction-workflow.tsx), and
[MCP upload output](../src/mcp/tools.ts).

## Approval gates

- Initial scopes approved on 1 October 2026: owner-based direct/Business allocation
  and linked/unlinked adjustment rules without overrides; cross-page active-queue
  traversal with one wrap; Stripe review-only first release.
- Implementation of BILL-T68, BILL-T33 and BILL-T77 in the current working tree
  with synthetic tests and no commits was authorized on 2 October 2026. Separate
  worktrees still require a reviewed baseline; no checkpoint commit was made.
- Separately approve BILL-T78.1's disposable provider-test scope before running it;
  choose a pinned provider only after the report. Live credentials, bucket migration,
  old-object retirement, database tests/migrations and deployment are not authorized.
- Independent source audit and focused re-review passed for scope approval after
  clarifying one-based paging/queue limits, paid-versus-total field mapping,
  filename/content date side effects, upload-issuance/deletion fencing and omission
  of source identifiers/host paths from the parser spec. Documentation formatting
  and whitespace checks passed. No production tests, services or live application records were used
  for this planning-only change.
