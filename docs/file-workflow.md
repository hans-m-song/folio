# File upload and review

Opening a file or transaction from a workspace now shows a right-side pane while
retaining that workspace and its filters. File metadata editing opens a second
pane over file details. Transaction details, creation and editing, single-file
upload, and recurring-bill schedule editing use the same presentation.
Reports, administration and multi-file import queues remain workspace pages.

Close, Escape and outside clicks dismiss the active pane. Unsaved edits require
confirmation; pending operations block dismissal. Closing a child restores focus
to its trigger and retains the parent. Panes use the shared 150 ms horizontal
transition, disable motion for reduced-motion preferences and fill narrow screens.
Existing direct detail/form URLs remain available as standalone pages. Contextual
pane URLs restore their source workspace and stacked detail/form panes on refresh;
local metadata/schedule drafts are not serialized. Browser Back/Forward respects
dirty and pending guards. Successful transaction edits refresh retained details
without resetting other drafts; a failed refresh retains prior details and offers
a retry.

For an expense already present in bank activity, start in **Banking → Reconcile**.
Choose **Create transaction**, then the transaction kind, or choose a type shortcut
to open its form directly. Only types compatible with the bank movement direction
are offered. These actions open a draft without creating or matching a record.
A wide drawer opens
from the right, keeping the queue and selected row behind an inert overlay.
The selected bank movement appears inside the drawer. Select an approved PDF
from the library, or choose **Upload PDF** to open a second drawer over the
transaction, leaving a visible strip on desktop. Narrow screens use the full
width. The transaction form remains
beside the preview on wide screens; narrow screens stack the panels in a
full-width drawer. Return to the queue, press Escape or click outside the active
drawer to close; edited fields
and evidence selections require discard confirmation. Closing is blocked while
saving or the evidence workflow is pending. This confirmation covers drawer
controls, Escape and outside clicks; browser navigation still follows the existing
route reset. With the PDF drawer open, outside clicks dismiss only that drawer.

Bank row details show Transaction, Source and Folio metadata as always-visible,
vertically stacked bands. Each group heading has its own line above the fields,
with small labels above values. Transaction shows Description, Date and Movement
across its first row, followed by Payment hints. Fields flow across the available
width and wrap on narrow screens. The drawer summary scrolls with the form; only its header stays
outside that scroll area. Transaction-kind buttons occupy one desktop row and
wrap on narrow screens. Candidate match buttons sit side by side when space permits.
Selected-row actions are grouped in order: **Mark private / transfer / duplicate**;
generic creation and type shortcuts; then **Leave unresolved and continue** and
**Unmatch or reset to unresolved**. Buttons wrap within their group when needed.

Both outer drawers use a subtle horizontal 150 ms slide and fade. Reduced-motion
preferences disable these transitions. Form contents remain intact and cannot
be edited during exit; they are cleared after the drawer finishes closing.
Selecting a transaction kind reveals the inner form with a 150 ms upward motion.
Editing fields or selecting invoice evidence preserves the form and does not
restart that transition. Reduced-motion preferences disable this reveal too.

Reconciliation dates use short-month Australian calendar display, such as
27 Aug 2026. Review timestamps use 24-hour Brisbane time with AEST shown.
Profile keys and UIDs use wrapping monospace text. Display formatting preserves
date inputs, source descriptions, stored dates and matching behavior.

The reconciliation PDF preview uses a fixed Half page viewing area, capped by
the browser height. Preview size controls are hidden for now; this does not change
the PDF or its metadata.
Additional PDF pages scroll inside the viewer. The evidence panel and upload
fields share the PDF drawer's content scroll, without a separate evidence-panel
scrollbar or sticky positioning.

Invoice PDF upload retains the chosen filename, original-name suggestions,
optional supplier, document date, reference and notes. Coverage controls and date-copy shortcuts
are hidden for PDFs; previously stored coverage metadata is preserved.
Separate **Apply supplier**, **Apply document date** and **Apply reference**
actions each fill only their matching blank metadata field. Entered values are
preserved; supplier is optional text up to 200 characters. After upload confirmation, extract observed invoice
facts without applying them to the transaction. **Approve and return** closes the
PDF drawer and selects the approved file in the retained transaction form. The
preview and extracted facts remain available there, with explicit filename and
content suggestion actions. Duplicate warnings and source conflicts remain visible.
Bank-prefilled payment date and AUD settlement remain
protected; PDF suggestions describe the invoice. Uploading, previewing and approving
do not create a transaction. **Save and match** performs the financial write.

Finish reviewing a pending upload or dismiss it before saving. Uploaded evidence
remains reusable if you cancel the transaction or saving fails. The standalone
Files workflow remains useful for unpaid invoices and evidence uploaded ahead
of reconciliation.

After approval, separate **Apply supplier …**, **Apply date …**, and
**Apply reference …** buttons show the original-filename suggestions. Each fills
only its named empty transaction field. Existing values, activity/payment dates,
bank settlement and file metadata are preserved. The PDF drawer has no transaction
apply controls. A saved document supplier takes precedence over filename inference
for the explicit supplier action and retains its reviewed spelling. Approval
itself does not fill transaction fields. Closing the PDF drawer with pending
evidence asks for confirmation; transfer
and approval operations block closing. Discarding the pending selection preserves
the underlying transaction. An uploaded artifact remains in the file library.

Open **Files → Upload file**. Select one file and its profile: invoice PDF,
Stripe itemised balance CSV or CommBank transaction history CSV.

The **Filename** field controls the filename used for browser preview and
downloads. Keep the profile's extension. The original upload name is retained
separately. CSV coverage dates describe the declared export interval and do not
filter CSV rows or change transaction dates. Use the export's requested range;
first/last transaction dates do not establish coverage on quiet days. This records
metadata without asserting that missing dates imply missing transactions.

For an existing confirmed file, open **Files → File library**, select its filename,
then choose **Edit metadata**. Change the download filename and, for a CSV, its
coverage start/end. Dates can be cleared. **Save metadata** preserves the original
upload name, stored file, imported rows and transaction links; it does not reimport.
**Cancel** discards the draft. A stale save is rejected if these metadata fields
have changed since the editor opened. PDF coverage is preserved without edit controls.
The CSV editor offers separate coverage actions for the original and edited
filename when the provider matches its profile. Each fills blank dates only;
existing dates must be cleared before applying a different range.

Recognized original names such as `Supplier-2026-09-20-INV123.pdf` offer separate
supplier/date/reference metadata actions. None changes the transaction directly.

Preferred CSV names use provider, start date and end date in kebab case:

```text
Stripe-2026-09-01-2026-09-30.csv
CommBank-2026-09-01-2026-09-30.csv
```

The original filename can suggest its provider/profile and coverage range. Choose
**Use Stripe CSV profile** or **Use CommBank CSV profile** when it differs from the
selected profile; this is explicit and retains the chosen file. Then **Apply to
file metadata** fills blank coverage bounds. Entered values are preserved and
invalid, ambiguous or reversed date ranges are ignored. Changing the display
filename does not change the original-name hints. Generic upload accepts supported
PDF/CSV selections; the invoice-only reconciliation drawer remains PDF-only.
Older supported range separators still offer coverage-only hints after selecting
the CSV profile; those legacy names do not infer or change the provider profile.

After upload, the file detail page can be reopened from **File library**.

- Invoice PDFs render inline. Approve the evidence, then select **Create
  transaction from invoice**. Review the transaction fields before saving;
  uploading or approving a PDF does not create a transaction.
  The PDF appears beside the transaction form on wide screens and above it on
  narrow screens. The form has a bounded width and the PDF uses the remaining
  page width, with a fit-width viewer request and a sticky desktop preview.
  Selecting library evidence updates the preview without resetting
  form edits. Original-name supplier/date/reference defaults remain editable;
  saved file metadata takes priority. Existing explicit **Replace** suggestion
  buttons can replace a field when chosen. Preview has refresh and new-tab controls.
  **Use reviewed invoice total and currency** updates invoice facts. The separate
  **Use reviewed amount as settlement** action requires the review checkbox and
  fills missing payment amount/currency without changing invoice facts or payment
  date. Payment details open for inspection. Existing amounts, protected currency
  choices and bank-prefilled settlement are preserved. Use a foreign amount only
  when payment was actually in that currency; bank reconciliation supplies the
  AUD amount for an AUD bank movement. Neither action saves the transaction.
- Stripe CSVs show proposed rows, previously imported rows and conflicts before
  explicit confirmation. Conflicts prevent confirmation.
- CommBank CSVs show proposed bank activity. Confirmation imports activity;
  reconciliation then explicitly creates or matches financial transactions.
  Overlapping periods require acknowledgement. Duplicate imports link to the
  existing activity.

Bank reconciliation can suggest recorded invoices without settlement details.
After matching, **View matched transaction** opens the linked record. The matched
view hides the duplicate ID detail and candidate picker; unmatch/reset remains
available, and returning to unresolved restores candidate selection.
AUD document totals match the bank movement by amount/direction. Foreign totals
use exact currency/amount hints from the bank source and remain unverified until
reviewed. Confirming an invoice match records bank posted-date/AUD settlement and
links the existing transaction. The default search window is ±31 days; explicit
±14 days and all dates remain available. Date windows still apply; equal monthly totals do
not establish that two records belong together. Resetting the link preserves the
recorded settlement. See [banking plan](./banking-plan.md).

If upload confirmation fails, retry confirmation for the same pending file.
After an uncertain import result, refresh and inspect existing records before
retrying. Metadata remains fixed for an upload attempt.

## Deployment gate

Migrations `0020_folio_artifact_metadata` and `0021_folio_artifact_supplier` add
nullable metadata columns and must run before serving the rebuilt application.
Supplier remains null for existing rows; no data backfill runs. No new
environment variables are required for this workflow. Local synthetic tests and
browser fixtures do not establish live database or object-store acceptance.
