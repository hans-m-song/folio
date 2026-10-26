# Folio and Australian accounting SaaS

This dated research record preserves the cited comparison. Recheck vendor
capabilities, pricing and integration terms before a new decision.

Research date: 13 October 2026. Scope: Australian small-business products;
MYOB Business is distinguished from AccountRight. Vendor sources establish advertised
features, not independently tested quality. Folio findings reflect documentation and
source inspection, not live deployment acceptance. No production data was inspected.

## Assessment

Folio is an expense/evidence register with bank matching and reviewed tax-preparation
exports. Its documented purpose excludes general accounting, payments and lodgement.
It should not currently be described as a replacement for Xero or MYOB.
See [scope and boundaries](overview.md).

```text
Folio:       evidence -> reviewed transactions -> preparation exports -> accountant
Accounting: transactions -> ledger -> financial statements / GST / payroll workflows
```

## Feature comparison

“Plan” means tier limits, additional fees or a separate integration apply. SaaS
columns summarize product families, not features included in every entry plan.

| Capability            | Xero AU                      | MYOB AU                                   | QuickBooks Online AU           | Zoho Books AU                              | Folio                                                           |
| --------------------- | ---------------------------- | ----------------------------------------- | ------------------------------ | ------------------------------------------ | --------------------------------------------------------------- |
| Expense documents     | Hubdoc/document capture      | Receipt capture                           | Receipt capture                | Autoscan quotas                            | PDF library; bounded text-PDF suggestions                       |
| Supplier bills        | Yes; entry limits            | Yes                                       | Essentials+                    | Professional+                              | Supplier expenses/credits; no full payable ledger               |
| Bank activity         | Feeds/reconciliation         | Feeds/reconciliation; plan limits         | Feeds/matching                 | Statement import; feeds Standard+          | CommBank CSV; explicit reviewed matching                        |
| Sales invoices/quotes | Yes; entry limits            | Yes                                       | Yes                            | Yes; annual limits                         | No customer billing workflow identified                         |
| Accounting reports    | Financial/accounting reports | Accounting reports                        | Accounting/reporting           | Accounts/journals/reports                  | Cash/activity/category preparation summaries                    |
| GST/BAS               | Tracking and lodgement       | Tracking and lodgement; Solo tracks only  | Tracking and e-lodgement       | GST/BAS reports; external filing           | Preparation only; current worksheet assumes not GST registered  |
| Payroll               | Plan headcounts              | Add-on or AccountRight inclusion          | Paid Employment Hero add-on    | Third-party route                          | None identified                                                 |
| Inventory/projects    | Product/plan dependent       | Business/AccountRight capabilities differ | Plus+ inventory/projects       | Professional+ stock; higher advanced tiers | None identified                                                 |
| Foreign currency      | Plan dependent               | AccountRight Premier                      | Essentials+                    | Plan dependent                             | Document/settlement amounts; AUD preparation, not FX accounting |
| Collaboration         | Unlimited users              | Product/role dependent                    | 1/3/5/25 users plus accountant | Tiered users/accountant invite             | Shared business records; named permissions; accountant exports  |
| Integrations          | App ecosystem                | App ecosystem                             | App ecosystem                  | Zoho/third-party apps                      | CSV ingestion and scoped MCP draft/suggestion tools             |

Vendor evidence: [Xero plan limits](https://central.xero.com/s/article/Xero-pricing-plans-AU)
and [features](https://www.xero.com/au/accounting-software/);
[MYOB pricing/feature matrix](https://www.myob.com/au/pricing)
and [Business](https://www.myob.com/au/products/myob-business);
[QuickBooks AU matrix](https://quickbooks.intuit.com/au/pricing/);
[Zoho AU matrix](https://www.zoho.com/au/books/pricing/pricing-comparison.html),
[BAS filing workflow](https://www.zoho.com/au/books/help/reports/tax-reports.html)
and [third-party payroll](https://marketplace.zoho.com/app/books/payroll-hub-for-zoho).

Folio evidence: [overview](overview.md), [report calculations](../src/domain/reports.ts),
[bank operations](../src/server/bank-operations.ts),
[supplier parsers](../src/domain/invoice-parser.ts),
[tax snapshot model](../src/domain/tax-workbook.ts),
[MCP boundaries](../src/mcp/tools.ts). Negative findings mean no corresponding
workflow identified within these boundaries, not a formal exhaustive code audit.

## Folio's useful distinctions

- Human-reviewed separation of source evidence, bank movements and transactions.
- Explicit owner contributions, loans and repayments, with cash-only treatment.
- Reviewed partnership worksheet snapshots, source fingerprints and CSV/JSON exports.
- Scoped MCP tools can prepare drafts and matching suggestions without recording or
  approving them automatically.
- Self-managed PostgreSQL/object storage permits deployment control. It also makes
  backup, restore, maintenance and incident response operator responsibilities.

These are useful fit advantages for the documented private, low-volume workflow.
They are not claims that SaaS competitors cannot provide equivalent workflows.

## Material limitations

1. No general ledger or authoritative balance sheet. Cash/activity summaries should
   not be presented as equivalent to complete financial statements.
2. Tax review is restricted to FY2025–26: the [input schema](../src/domain/tax-workbook.ts)
   uses `z.literal(2025)` and the [route](../src/routes/reports_.tax.tsx) supplies 2025.
   GST registration and business-structure suitability need separate policy review.
3. Bank/card account identity and personalized summaries are [planning only](account-attribution-plan.md).
   Transaction owner does not establish payment-account ownership.
4. Invoice extraction supports selected Google Workspace, Supabase and Stripe text
   layouts; it is not general OCR. Operator acceptance remains open under
   [BILL-T77](roadmap.md#bill-t77--supplier-invoice-pdf-suggestions).
5. Full append-only mutation history and authenticated deployment verification remain
   incomplete in the roadmap. Append-only tax snapshots do not close the broader
   audit-history gap.

## Recommended direction — proposal only

Preserve Folio's narrow role unless a concrete need requires accounting expansion.
Prioritize selectable financial years, bank/card attribution, change history and
operational verification. Add import profiles and accountant-friendly exports for
actual sources and accountant requirements. Consider broader receipt capture only
after measuring manual-entry effort.

Defer payroll, inventory, sales billing and a general ledger until required. If those
become necessary, evaluate adopting an accounting SaaS as the ledger while retaining
Folio for specialized evidence/review work; define one authoritative record per
financial fact to avoid conflicting books.

Folio is not cost-free merely because it has no vendor subscription. Compare total
annual hosting/storage, maintenance, operator entry/reconciliation time and accountant
cleanup against normal SaaS pricing and add-ons. No measured cost or usability winner
is established by this review.
