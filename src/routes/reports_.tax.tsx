import { AutocompleteSelect } from "../components/autocomplete";
import { MoneyText } from "../components/money-text";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { FinancialYearCashLedgerRow } from "../domain/reports";
import type { OwnerFundingSummary } from "../domain/owner-funding";
import {
  formatDecimal,
  formatMoneyAmount,
  parseDecimal,
} from "../domain/money";
import { calculateTaxAdjustments } from "../domain/tax-adjustments";
import { allocateTaxComponents } from "../domain/tax-partners";
import {
  taxReviewInputSchema,
  type ReviewedTaxSnapshot,
} from "../domain/tax-workbook";
import {
  exportTaxSource,
  exportTaxWorksheet,
  getTaxPartnerOptions,
  getTaxWorksheet,
  reviewTaxWorksheet,
} from "../server/tax-operations";
import "../styles/reports.css";

type EditableAdjustment = {
  id: string;
  transactionId: string;
  direction:
    | "increase_income"
    | "decrease_income"
    | "increase_deductible_expense"
    | "decrease_deductible_expense";
  amountAud: string;
  reason: string;
};

type EditablePartner = { userId: string; percentage: string };

export const Route = createFileRoute("/reports_/tax")({
  loader: async () => {
    const [worksheet, partnerOptions] = await Promise.all([
      getTaxWorksheet({ data: { financialYearStartYear: 2025 } }),
      getTaxPartnerOptions(),
    ]);
    return { ...worksheet, partnerOptions };
  },
  pendingComponent: () => (
    <main className="reports-page">
      <p role="status">Loading tax worksheet…</p>
    </main>
  ),
  errorComponent: () => (
    <main className="reports-page">
      <h1>Tax worksheet unavailable</h1>
      <p role="alert">Retry after checking your connection.</p>
    </main>
  ),
  component: TaxWorksheetPage,
});

const download = (filename: string, mediaType: string, content: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: mediaType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const directionLabel = (direction: EditableAdjustment["direction"]) =>
  ({
    increase_income: "Increase income",
    decrease_income: "Decrease income",
    increase_deductible_expense: "Increase deductible expense",
    decrease_deductible_expense: "Decrease deductible expense",
  })[direction];

const reportingDate = (timestamp: string | null, timezone: string) =>
  timestamp
    ? new Intl.DateTimeFormat("en-AU", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(timestamp))
    : "—";

const kindLabel = (kind: FinancialYearCashLedgerRow["kind"]) =>
  kind.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

const taxTypeLabel = (kind: FinancialYearCashLedgerRow["kind"]) => {
  if (kind === "supplier_expense") return "Expense";
  if (kind === "sale_refund") return "Refund";
  if (kind === "supplier_credit") return "Expense refund";
  if (kind === "processing_fee") return "Fee";
  return kindLabel(kind);
};

const TaxTransactionSummary = ({
  row,
  supplierOnly = false,
}: {
  row: FinancialYearCashLedgerRow;
  supplierOnly?: boolean;
}) => {
  const type = kindLabel(row.kind);
  const sourceLabel = row.sourceSystem === "stripe" ? "Stripe" : "Manual";
  const title = supplierOnly
    ? row.counterparty || sourceLabel
    : row.counterparty ||
      row.description ||
      `${sourceLabel} ${type.toLowerCase()}`;
  const details = [
    ...(!supplierOnly ? [`${type} · ${sourceLabel}`] : []),
    ...(row.reference ? [`Ref ${row.reference}`] : []),
    ...(row.category ? [row.category] : []),
  ].join(" · ");

  return (
    <div className="tax-transaction-summary">
      <a
        className="tax-transaction-link"
        href={`/transactions/${encodeURIComponent(row.transactionId)}`}
        aria-label={`View transaction ${row.reference ?? row.transactionId}`}
      >
        {title}
      </a>
      {details ? <span className="tax-transaction-meta">{details}</span> : null}
      {row.description && row.description !== title ? (
        <span className="tax-transaction-description">{row.description}</span>
      ) : null}
    </div>
  );
};

const OwnerFundingPanel = ({
  summary,
  partnerOptions,
}: {
  summary: OwnerFundingSummary | undefined;
  partnerOptions: { id: string; label: string }[];
}) => {
  if (!summary)
    return (
      <section aria-labelledby="owner-funding-heading">
        <h2 id="owner-funding-heading">Owner funding</h2>
        <p>Owner funding summary unavailable; no balance is inferred.</p>
      </section>
    );

  const ownerLabel = (ownerId: string | null) => {
    if (ownerId === null) return "Unassigned owner";
    return (
      partnerOptions.find((option) => option.id === ownerId)?.label ??
      `Unavailable owner · ${ownerId}`
    );
  };
  const issuesByTransactionId = new Map<string, string[]>();
  for (const issue of summary.issues) {
    const reasons = issuesByTransactionId.get(issue.transactionId) ?? [];
    reasons.push(issue.reason.replaceAll("_", " "));
    issuesByTransactionId.set(issue.transactionId, reasons);
  }
  const rows = [...summary.rows].sort(
    (left, right) =>
      (left.cashDate ?? "").localeCompare(right.cashDate ?? "") ||
      left.transactionId.localeCompare(right.transactionId),
  );
  const issueCount = new Set(
    summary.issues.map(({ transactionId }) => transactionId),
  ).size;

  return (
    <section aria-labelledby="owner-funding-heading">
      <h2 id="owner-funding-heading">Owner funding</h2>
      <p>
        Current recorded funding through 30 June{" "}
        {summary.financialYearStartYear + 1} ({summary.financialYear}). This
        current-records view is separate from the saved or frozen tax review.
      </p>
      <p>
        It uses recorded loan and principal repayment rows available through
        this year-end; it cannot confirm all historical funding was imported or
        establish a legal debt. Contributions remain separate and do not affect
        tax allocations.
      </p>
      {summary.issues.length ? (
        <div className="tax-blockers">
          <p>
            This summary is partial: {issueCount} recorded funding transaction
            {issueCount === 1 ? " needs" : "s need"} review. Only usable
            recorded manual AUD cash facts are included. Do not treat these loan
            balances as authoritative debt while issues remain.
          </p>
        </div>
      ) : null}
      <div className="table-scroll">
        <table className="tax-owner-funding-table">
          <caption>Current recorded owner funding through FY end</caption>
          <thead>
            <tr>
              <th scope="col">Owner</th>
              <th scope="col" className="money-column">
                Loans advanced AUD
              </th>
              <th scope="col" className="money-column">
                Principal repaid AUD
              </th>
              <th scope="col" className="money-column">
                Loan balance AUD
              </th>
              <th scope="col" className="money-column">
                Other contributions AUD
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.owners.map((owner) => (
              <tr key={owner.ownerId ?? "unassigned"}>
                <th scope="row">{ownerLabel(owner.ownerId)}</th>
                <td className="money-column">
                  <MoneyText>
                    {formatMoneyAmount(owner.loansAdvancedAud)}
                  </MoneyText>
                </td>
                <td className="money-column">
                  <MoneyText>
                    {formatMoneyAmount(owner.principalRepaidAud)}
                  </MoneyText>
                </td>
                <td className="money-column">
                  <MoneyText>
                    {formatMoneyAmount(owner.loanBalanceAud)}
                  </MoneyText>
                </td>
                <td className="money-column">
                  <MoneyText>
                    {formatMoneyAmount(owner.otherContributionsAud)}
                  </MoneyText>
                </td>
              </tr>
            ))}
            {summary.owners.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  {summary.issues.length
                    ? "No usable recorded funding; review the linked records below."
                    : "No recorded owner funding through this financial-year end."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {rows.length ? (
        <details>
          <summary>
            {rows.length} recorded funding transaction
            {rows.length === 1 ? "" : "s"} and supporting details
          </summary>
          <div className="table-scroll">
            <table className="tax-owner-funding-detail-table">
              <caption>Recorded owner funding transactions</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Type</th>
                  <th scope="col">Transaction</th>
                  <th scope="col" className="money-column">
                    Funding movement AUD
                  </th>
                  <th scope="col">Issue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.transactionId}>
                    <td>
                      {row.cashDate
                        ? reportingDate(row.cashDate, summary.timezone)
                        : "Date unavailable"}
                    </td>
                    <td>{ownerLabel(row.ownerId ?? null)}</td>
                    <td>{kindLabel(row.kind)}</td>
                    <td>
                      <TaxTransactionSummary row={row} />
                    </td>
                    <td className="money-column">
                      {row.cashEffectAud === null ? (
                        "—"
                      ) : (
                        <MoneyText>
                          {formatMoneyAmount(row.cashEffectAud)}
                        </MoneyText>
                      )}
                    </td>
                    <td>
                      {issuesByTransactionId
                        .get(row.transactionId)
                        ?.join(", ") ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
};

function TaxWorksheetPage() {
  const {
    source,
    latest,
    latestIsCurrent,
    reviewedVersionCount,
    partnerOptions,
    ownerFunding,
  } = Route.useLoaderData();
  const router = useRouter();
  const saved = latest?.snapshot as ReviewedTaxSnapshot | undefined;
  const [adjustments, setAdjustments] = useState<EditableAdjustment[]>(
    () =>
      saved?.humanAdjustments.map((item) => ({
        ...item,
        transactionId: item.transactionId ?? "",
      })) ?? [],
  );
  const [partners, setPartners] = useState<EditablePartner[]>(
    () =>
      saved?.partnerShares.map((partner) => ({
        userId:
          "userId" in partner &&
          partnerOptions.some((option) => option.id === partner.userId)
            ? partner.userId
            : "",
        percentage: partner.percentage,
      })) ?? [],
  );
  const [attested, setAttested] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const rowsNeedingAction = source.cashLedger.rows.filter(
    (row) => row.disposition === "action_required",
  );
  const includedRows = source.cashLedger.rows
    .filter((row) => row.disposition === "included")
    .sort(
      (left, right) =>
        (left.cashDate ?? "").localeCompare(right.cashDate ?? "") ||
        left.transactionId.localeCompare(right.transactionId),
    );
  const sourceNet = formatDecimal(
    parseDecimal(source.cashLedger.totals.incomeEffectAud) -
      parseDecimal(source.cashLedger.totals.expenseEffectAud),
  );
  const partnerAllocations =
    saved && saved.modelVersion !== 2
      ? allocateTaxComponents(
          saved.totals.reviewedIncomeAud,
          saved.totals.reviewedDeductibleExpenseAud,
          saved.partnerShares.map(({ label, percentage }) => ({
            label,
            percentage,
          })),
        )
      : [];
  const savedSourceRows = new Map(
    saved?.cashLedger.rows.map((row) => [row.transactionId, row]) ?? [],
  );
  const savedPartnerLabels = new Map(
    saved?.partnerShares.flatMap((partner) =>
      "userId" in partner ? [[partner.userId, partner.label] as const] : [],
    ) ?? [],
  );
  const savedAdjustments = new Map(
    saved?.humanAdjustments.map((adjustment) => [adjustment.id, adjustment]) ??
      [],
  );
  const selectedPartnerIds = new Set(
    partners.map(({ userId }) => userId).filter(Boolean),
  );
  const businessSourceRows = source.cashLedger.rows.filter(
    (row) =>
      row.disposition === "included" &&
      (!row.ownerId || !selectedPartnerIds.has(row.ownerId)),
  );
  const businessSourceOwnerTotals = new Map<
    string | null,
    { rowCount: number; income: bigint; expense: bigint }
  >();
  for (const row of businessSourceRows) {
    const ownerId = row.ownerId ?? null;
    const totals = businessSourceOwnerTotals.get(ownerId) ?? {
      rowCount: 0,
      income: 0n,
      expense: 0n,
    };
    totals.rowCount += 1;
    totals.income += parseDecimal(row.incomeEffectAud ?? "0.0000");
    totals.expense += parseDecimal(row.expenseEffectAud ?? "0.0000");
    businessSourceOwnerTotals.set(ownerId, totals);
  }
  const businessSourceIncome = formatDecimal(
    businessSourceRows.reduce(
      (total, row) => total + parseDecimal(row.incomeEffectAud ?? "0.0000"),
      0n,
    ),
  );
  const businessSourceExpense = formatDecimal(
    businessSourceRows.reduce(
      (total, row) => total + parseDecimal(row.expenseEffectAud ?? "0.0000"),
      0n,
    ),
  );
  const draftRows = source.cashLedger.rows.filter(
    (row) =>
      row.status === "draft" &&
      (row.period === null || row.period === source.financialYear),
  );

  const addPartner = () => {
    setPartners([...partners, { userId: "", percentage: "" }]);
  };

  const saveReview = async () => {
    if (!attested) {
      setMessage("Confirm the source and tax review before saving.");
      return;
    }
    const input = taxReviewInputSchema.safeParse({
      financialYearStartYear: 2025,
      sourceFingerprint: source.fingerprint,
      adjustments: adjustments.map((item) => ({
        id: item.id,
        ...(item.transactionId.trim()
          ? { transactionId: item.transactionId.trim() }
          : {}),
        direction: item.direction,
        amountAud: item.amountAud,
        reason: item.reason,
      })),
      partners,
      reviewerAttestation: `I reviewed the source records, income, deductible expenses, timing, and agreed partner percentages.${reviewNote.trim() ? ` Note: ${reviewNote.trim()}` : ""}`,
    });
    if (!input.success) {
      setMessage(
        input.error.issues[0]?.message ?? "Complete the review fields.",
      );
      return;
    }
    const sourceTransactionIds = new Set(
      source.cashLedger.rows.map((row) => row.transactionId),
    );
    if (
      input.data.adjustments.some(
        (adjustment) =>
          adjustment.transactionId &&
          !sourceTransactionIds.has(adjustment.transactionId),
      )
    ) {
      setMessage(
        "A linked adjustment transaction must appear in this financial year's source ledger.",
      );
      return;
    }
    try {
      calculateTaxAdjustments({
        baseIncomeAud: source.cashLedger.totals.incomeEffectAud,
        baseDeductibleExpenseAud: source.cashLedger.totals.expenseEffectAud,
        adjustments: input.data.adjustments,
      });
    } catch {
      setMessage(
        "Reviewed income and deductible expenses must each be nonnegative. Add reasoned adjustments for negative source totals or correct the source records.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await reviewTaxWorksheet({ data: input.data });
      setMessage("Reviewed worksheet saved.");
      await router.invalidate();
    } catch {
      setMessage(
        "Review could not be saved. Refresh the source review and retry.",
      );
    } finally {
      setBusy(false);
    }
  };

  const exportReview = async (format: "csv" | "json") => {
    if (!latest) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await exportTaxWorksheet({
        data: { snapshotId: latest.id, format },
      });
      download(result.filename, result.mediaType, result.content);
    } catch {
      setMessage("Export failed. Retry the download.");
    } finally {
      setBusy(false);
    }
  };

  const exportSource = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await exportTaxSource({
        data: { financialYearStartYear: 2025 },
      });
      download(result.filename, result.mediaType, result.content);
    } catch {
      setMessage("Source ledger export failed. Retry the download.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="reports-page tax-worksheet-page">
      <header>
        <h1>FY2025–26 partnership tax worksheet</h1>
        <p>
          Review cash-basis source effects, enter explicit tax adjustments, and
          save a versioned partnership net result. This is not tax payable or a
          lodged return.
        </p>
      </header>

      <section aria-labelledby="tax-source-heading">
        <h2 id="tax-source-heading">Source completeness</h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportSource()}
        >
          Export source CSV
        </button>
        <p>
          The worksheet uses recorded cash effects in AUD. No GST registration
          is assumed for this financial year; the source expense total is a
          candidate amount, not an automatic deduction.
        </p>
        {source.cashLedger.rows.some((row) => row.sourceSystem === "stripe") ? (
          <p>
            Stripe rows use the imported creation date, not the funds-available
            date. Confirm the appropriate income-tax timing before review.
          </p>
        ) : null}
        <div className="tax-summary-grid">
          <div>
            <span>Source income</span>
            <MoneyText as="strong">
              {`AUD ${formatMoneyAmount(source.cashLedger.totals.incomeEffectAud)}`}
            </MoneyText>
          </div>
          <div>
            <span>Candidate expenses</span>
            <MoneyText as="strong">
              {`AUD ${formatMoneyAmount(source.cashLedger.totals.expenseEffectAud)}`}
            </MoneyText>
          </div>
          <div>
            <span>Source net result</span>
            <MoneyText as="strong">
              {`AUD ${formatMoneyAmount(sourceNet)}`}
            </MoneyText>
          </div>
          <div>
            <span>Included transactions</span>
            <strong>{source.cashLedger.totals.includedCount}</strong>
          </div>
          <div>
            <span>Bank rows reviewed</span>
            <strong>
              {source.bankRows.length - source.unresolvedBankCount} /{" "}
              {source.bankRows.length}
            </strong>
          </div>
        </div>
        {source.readyForReview ? (
          <p className="tax-ready">
            No unresolved imported bank rows, in-period drafts, or missing cash
            facts were found. Confirm that all relevant source files were
            imported before saving.
          </p>
        ) : (
          <div className="tax-blockers" role="alert">
            <p>
              Review is blocked: {source.actionRequiredCount} transaction
              {source.actionRequiredCount === 1 ? "" : "s"} need cash facts;{" "}
              {source.unresolvedBankCount} bank row
              {source.unresolvedBankCount === 1 ? "" : "s"}{" "}
              {source.unresolvedBankCount === 1 ? "remains" : "remain"}{" "}
              unresolved; {source.draftCount} in-period draft
              {source.draftCount === 1 ? "" : "s"}{" "}
              {source.draftCount === 1 ? "remains" : "remain"}.
            </p>
            {source.unresolvedBankCount ? (
              <a href="/banking/reconcile">Review bank rows</a>
            ) : null}
          </div>
        )}
        {rowsNeedingAction.length ? (
          <div className="table-scroll">
            <table>
              <caption>Transactions needing cash facts</caption>
              <thead>
                <tr>
                  <th scope="col">Transaction</th>
                  <th scope="col">Issue</th>
                </tr>
              </thead>
              <tbody>
                {rowsNeedingAction.map((row) => (
                  <tr key={row.transactionId}>
                    <td>
                      <TaxTransactionSummary row={row} />
                    </td>
                    <td>{row.issues.join(", ").replaceAll("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {draftRows.length ? (
          <ul>
            {draftRows.map((row) => (
              <li key={row.transactionId}>
                <TaxTransactionSummary row={row} />
                <span>Draft transaction awaiting a date or decision</span>
              </li>
            ))}
          </ul>
        ) : null}
        <details>
          <summary>{includedRows.length} included source rows</summary>
          <div className="table-scroll">
            <table className="tax-source-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Supplier / source</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="money-column">
                    Income AUD
                  </th>
                  <th scope="col" className="money-column">
                    Expense AUD
                  </th>
                </tr>
              </thead>
              <tbody>
                {includedRows.map((row) => (
                  <tr key={row.transactionId}>
                    <td>{reportingDate(row.cashDate, source.timezone)}</td>
                    <td>
                      <TaxTransactionSummary row={row} supplierOnly />
                    </td>
                    <td>{taxTypeLabel(row.kind)}</td>
                    <td className="money-column">
                      {row.incomeEffectAud === null ? (
                        "—"
                      ) : (
                        <MoneyText>
                          {formatMoneyAmount(row.incomeEffectAud)}
                        </MoneyText>
                      )}
                    </td>
                    <td className="money-column">
                      {row.expenseEffectAud === null ? (
                        "—"
                      ) : (
                        <MoneyText>
                          {formatMoneyAmount(row.expenseEffectAud)}
                        </MoneyText>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <OwnerFundingPanel
        summary={ownerFunding}
        partnerOptions={partnerOptions}
      />

      {latest && saved ? (
        <section aria-labelledby="tax-saved-heading">
          <div className="section-heading">
            <div>
              <h2 id="tax-saved-heading">Latest reviewed result</h2>
              <p>
                {latestIsCurrent
                  ? "Current against the source records"
                  : "Historical snapshot — source records have changed; review again before using or exporting it"}{" "}
                · version {reviewedVersionCount} · saved {latest.reviewedAt}
              </p>
            </div>
            <div className="tax-export-actions">
              <button
                type="button"
                disabled={busy || !latestIsCurrent}
                onClick={() => void exportReview("csv")}
              >
                Export CSV
              </button>
              <button
                type="button"
                disabled={busy || !latestIsCurrent}
                onClick={() => void exportReview("json")}
              >
                Export JSON
              </button>
            </div>
          </div>
          <div className="tax-summary-grid">
            <div>
              <span>Reviewed income</span>
              <MoneyText as="strong">
                {`AUD ${formatMoneyAmount(saved.totals.reviewedIncomeAud)}`}
              </MoneyText>
            </div>
            <div>
              <span>Reviewed deductions</span>
              <MoneyText as="strong">
                {`AUD ${formatMoneyAmount(saved.totals.reviewedDeductibleExpenseAud)}`}
              </MoneyText>
            </div>
            <div>
              <span>Partnership net result</span>
              <MoneyText as="strong">
                {`AUD ${formatMoneyAmount(saved.totals.reviewedNetResultAud)}`}
              </MoneyText>
            </div>
          </div>
          {saved.modelVersion === 2 ? (
            <>
              <div className="tax-summary-grid tax-business-pool-summary">
                <div>
                  <span>Business shared income before partner shares</span>
                  <MoneyText as="strong">
                    {formatMoneyAmount(
                      saved.attribution.businessPool.incomeAud,
                    )}
                  </MoneyText>
                </div>
                <div>
                  <span>Business shared expenses before partner shares</span>
                  <MoneyText as="strong">
                    {formatMoneyAmount(
                      saved.attribution.businessPool.expenseAud,
                    )}
                  </MoneyText>
                </div>
                <div>
                  <span>Business shared net before partner shares</span>
                  <MoneyText as="strong">
                    {formatMoneyAmount(saved.attribution.businessPool.netAud)}
                  </MoneyText>
                </div>
              </div>
              <div className="table-scroll">
                <table className="tax-partner-table tax-partner-attribution-table">
                  <caption>
                    Direct and Business shared allocation from the frozen review
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Partner</th>
                      <th scope="col">Share</th>
                      <th scope="col" className="money-column">
                        Direct income
                      </th>
                      <th scope="col" className="money-column">
                        Business income share
                      </th>
                      <th scope="col" className="money-column">
                        Final income
                      </th>
                      <th scope="col" className="money-column">
                        Direct expense
                      </th>
                      <th scope="col" className="money-column">
                        Business expense share
                      </th>
                      <th scope="col" className="money-column">
                        Final expense
                      </th>
                      <th scope="col" className="money-column">
                        Net
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {saved.partnerShares.map((partner) => (
                      <tr key={partner.userId}>
                        <th scope="row">{partner.label}</th>
                        <td>{partner.percentage.replace(/\.?0+$/, "")}%</td>
                        <td className="money-column">
                          <MoneyText>
                            {formatMoneyAmount(partner.directIncomeAud)}
                          </MoneyText>
                        </td>
                        <td className="money-column">
                          <MoneyText>
                            {formatMoneyAmount(partner.businessIncomeAud)}
                          </MoneyText>
                        </td>
                        <td className="money-column">
                          <MoneyText>
                            {formatMoneyAmount(partner.finalIncomeAud)}
                          </MoneyText>
                        </td>
                        <td className="money-column">
                          <MoneyText>
                            {formatMoneyAmount(partner.directExpenseAud)}
                          </MoneyText>
                        </td>
                        <td className="money-column">
                          <MoneyText>
                            {formatMoneyAmount(partner.businessExpenseAud)}
                          </MoneyText>
                        </td>
                        <td className="money-column">
                          <MoneyText>
                            {formatMoneyAmount(partner.finalExpenseAud)}
                          </MoneyText>
                        </td>
                        <td className="money-column">
                          <MoneyText>
                            {formatMoneyAmount(partner.netAud)}
                          </MoneyText>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>Source and adjustment attribution</summary>
                <div className="table-scroll">
                  <table className="tax-partner-table tax-attribution-detail-table tax-source-attribution-table">
                    <caption>Source transaction attribution</caption>
                    <thead>
                      <tr>
                        <th scope="col">Transaction</th>
                        <th scope="col">Target</th>
                        <th scope="col" className="money-column">
                          Direct income
                        </th>
                        <th scope="col" className="money-column">
                          Direct expense
                        </th>
                        <th scope="col" className="money-column">
                          Business income
                        </th>
                        <th scope="col" className="money-column">
                          Business expense
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {saved.attribution.sources.map((attribution) => {
                        const row = savedSourceRows.get(
                          attribution.transactionId,
                        );
                        const partnerLabel = attribution.partnerUserId
                          ? savedPartnerLabels.get(attribution.partnerUserId)
                          : undefined;
                        return (
                          <tr key={attribution.transactionId}>
                            <th scope="row">
                              {row ? (
                                <TaxTransactionSummary row={row} />
                              ) : (
                                attribution.transactionId
                              )}
                            </th>
                            <td>
                              {partnerLabel
                                ? `Direct · ${partnerLabel}`
                                : "Business shared"}
                            </td>
                            <td className="money-column">
                              <MoneyText>
                                {formatMoneyAmount(attribution.directIncomeAud)}
                              </MoneyText>
                            </td>
                            <td className="money-column">
                              <MoneyText>
                                {formatMoneyAmount(
                                  attribution.directExpenseAud,
                                )}
                              </MoneyText>
                            </td>
                            <td className="money-column">
                              <MoneyText>
                                {formatMoneyAmount(
                                  attribution.businessIncomeAud,
                                )}
                              </MoneyText>
                            </td>
                            <td className="money-column">
                              <MoneyText>
                                {formatMoneyAmount(
                                  attribution.businessExpenseAud,
                                )}
                              </MoneyText>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <table className="tax-partner-table tax-attribution-detail-table">
                    <caption>Human adjustment attribution</caption>
                    <thead>
                      <tr>
                        <th scope="col">Reason</th>
                        <th scope="col">Target</th>
                        <th scope="col">Direction</th>
                        <th scope="col" className="money-column">
                          Income effect
                        </th>
                        <th scope="col" className="money-column">
                          Expense effect
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {saved.attribution.adjustments.map((attribution) => {
                        const adjustment = savedAdjustments.get(attribution.id);
                        const partnerLabel = attribution.partnerUserId
                          ? savedPartnerLabels.get(attribution.partnerUserId)
                          : undefined;
                        return (
                          <tr key={attribution.id}>
                            <th scope="row">
                              {adjustment?.reason ?? attribution.id}
                            </th>
                            <td>
                              {partnerLabel
                                ? `Direct · ${partnerLabel}`
                                : "Business shared"}
                            </td>
                            <td>
                              {attribution.direction.replaceAll("_", " ")}
                            </td>
                            <td className="money-column">
                              <MoneyText>
                                {formatMoneyAmount(attribution.incomeEffectAud)}
                              </MoneyText>
                            </td>
                            <td className="money-column">
                              <MoneyText>
                                {formatMoneyAmount(
                                  attribution.expenseEffectAud,
                                )}
                              </MoneyText>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <div className="table-scroll">
              <table className="tax-partner-table">
                <caption>
                  Partner allocation of reviewed income, deductions, and net
                  result
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Partner label</th>
                    <th scope="col">Share</th>
                    <th scope="col" className="money-column">
                      Income AUD
                    </th>
                    <th scope="col" className="money-column">
                      Deductions AUD
                    </th>
                    <th scope="col" className="money-column">
                      Net AUD
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {partnerAllocations.map((partner) => (
                    <tr key={partner.label}>
                      <th scope="row">{partner.label}</th>
                      <td>{partner.percentage.replace(/\.?0+$/, "")}%</td>
                      <td className="money-column">
                        <MoneyText>
                          {formatMoneyAmount(partner.incomeAud)}
                        </MoneyText>
                      </td>
                      <td className="money-column">
                        <MoneyText>
                          {formatMoneyAmount(partner.expenseAud)}
                        </MoneyText>
                      </td>
                      <td className="money-column">
                        <MoneyText>
                          {formatMoneyAmount(partner.amountAud)}
                        </MoneyText>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <section aria-labelledby="tax-review-heading">
        <h2 id="tax-review-heading">
          {latest ? "Create a new reviewed version" : "Review and save result"}
        </h2>
        <p>
          Adjustments are human tax judgments outside the transaction ledger.
          Add a reason for each; the source record remains unchanged.
        </p>
        {adjustments.map((item, index) => (
          <fieldset className="tax-entry" key={item.id}>
            <legend>Adjustment {index + 1}</legend>
            <div className="tax-adjustment-fields">
              <label>
                Direction
                <AutocompleteSelect
                  aria-label="Direction"
                  value={item.direction}
                  onValueChange={(event) =>
                    setAdjustments(
                      adjustments.map((row) =>
                        row.id === item.id
                          ? {
                              ...row,
                              direction:
                                event as EditableAdjustment["direction"],
                            }
                          : row,
                      ),
                    )
                  }
                >
                  {(
                    [
                      "increase_income",
                      "decrease_income",
                      "increase_deductible_expense",
                      "decrease_deductible_expense",
                    ] as const
                  ).map((direction) => (
                    <option key={direction} value={direction}>
                      {directionLabel(direction)}
                    </option>
                  ))}
                </AutocompleteSelect>
              </label>
              <label>
                Amount AUD
                <input
                  inputMode="decimal"
                  value={item.amountAud}
                  onChange={(event) =>
                    setAdjustments(
                      adjustments.map((row) =>
                        row.id === item.id
                          ? { ...row, amountAud: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Related transaction ID (optional)
                <input
                  value={item.transactionId}
                  onChange={(event) =>
                    setAdjustments(
                      adjustments.map((row) =>
                        row.id === item.id
                          ? { ...row, transactionId: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Reason
                <input
                  value={item.reason}
                  onChange={(event) =>
                    setAdjustments(
                      adjustments.map((row) =>
                        row.id === item.id
                          ? { ...row, reason: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="secondary tax-entry-remove"
              onClick={() =>
                setAdjustments(adjustments.filter((row) => row.id !== item.id))
              }
            >
              Remove adjustment
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setAdjustments([
              ...adjustments,
              {
                id: crypto.randomUUID(),
                transactionId: "",
                direction: "increase_income",
                amountAud: "",
                reason: "",
              },
            ])
          }
        >
          Add adjustment
        </button>
        <h3>Agreed partner shares</h3>
        <p>
          Select each partner as an active Folio user. Percentages must total
          exactly 100%; confirm they match the partnership agreement.
        </p>
        <div className="tax-business-preview">
          <strong>Business shared pool before adjustments</strong>
          <span>
            Included rows with an unassigned or non-selected owner:{" "}
            {businessSourceRows.length}
          </span>
          <span>
            Income AUD {formatMoneyAmount(businessSourceIncome)} · Expenses AUD{" "}
            {formatMoneyAmount(businessSourceExpense)}
          </span>
          <div className="table-scroll">
            <table className="tax-business-owner-table">
              <caption>Business source effects by owner</caption>
              <thead>
                <tr>
                  <th scope="col">Owner</th>
                  <th scope="col">Rows</th>
                  <th scope="col" className="money-column">
                    Income AUD
                  </th>
                  <th scope="col" className="money-column">
                    Expense AUD
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...businessSourceOwnerTotals.entries()]
                  .sort(([left], [right]) =>
                    (left ?? "").localeCompare(right ?? ""),
                  )
                  .map(([ownerId, totals]) => {
                    const option = ownerId
                      ? partnerOptions.find(({ id }) => id === ownerId)
                      : undefined;
                    return (
                      <tr key={ownerId ?? "unassigned"}>
                        <th scope="row">
                          {ownerId === null
                            ? "Unassigned owner"
                            : (option?.label ??
                              `Unavailable owner · ${ownerId}`)}
                        </th>
                        <td>{totals.rowCount}</td>
                        <td className="money-column">
                          <MoneyText>
                            {formatMoneyAmount(formatDecimal(totals.income))}
                          </MoneyText>
                        </td>
                        <td className="money-column">
                          <MoneyText>
                            {formatMoneyAmount(formatDecimal(totals.expense))}
                          </MoneyText>
                        </td>
                      </tr>
                    );
                  })}
                {businessSourceOwnerTotals.size === 0 ? (
                  <tr>
                    <td colSpan={4}>No Business source rows</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        {partners.map((partner, index) => (
          <div className="tax-partner-row" key={`${partner.userId}-${index}`}>
            <div className="tax-partner-identity">
              <label>
                Partner {index + 1}
                <AutocompleteSelect
                  aria-label={`Partner ${index + 1} user`}
                  required
                  placeholder="Choose an active user"
                  value={partner.userId}
                  onValueChange={(userId) =>
                    setPartners(
                      partners.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, userId } : row,
                      ),
                    )
                  }
                >
                  {partnerOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </AutocompleteSelect>
              </label>
            </div>
            <label>
              Percentage
              <input
                inputMode="decimal"
                value={partner.percentage}
                onChange={(event) =>
                  setPartners(
                    partners.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, percentage: event.target.value }
                        : row,
                    ),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setPartners(
                  partners.filter((_, rowIndex) => rowIndex !== index),
                )
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={addPartner}>
          Add partner
        </button>
        <label className="tax-review-note">
          Review note (optional)
          <textarea
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
          />
        </label>
        <label className="tax-attestation">
          <input
            type="checkbox"
            checked={attested}
            onChange={(event) => setAttested(event.target.checked)}
          />
          <span>
            I reviewed the source records, tax adjustments, timing, deductible
            expenses, and partner percentages, and confirm all relevant files
            were imported.
          </span>
        </label>
        <p role="status" aria-live="polite">
          {message}
        </p>
        <button
          type="button"
          disabled={busy || !source.readyForReview}
          onClick={() => void saveReview()}
        >
          Save reviewed result
        </button>
      </section>
    </main>
  );
}
