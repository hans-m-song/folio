import { useEffect, useId, useRef, useState } from "react";

import type { InvoiceParseResult } from "../domain/invoice-types";
import {
  applyInvoiceBlankFields,
  invoiceEditableSuggestions,
  invoiceSuggestionConflicts,
  reviewedInvoiceMoney,
  type InvoiceEditableFields,
} from "../domain/pdf-invoice-fields";
import { formatMoneyAmount } from "../domain/money";
import { extractInvoiceFields } from "../server/invoice-operations";
import { AutocompleteSelect } from "./autocomplete";
import { MoneyText } from "./money-text";
import "../styles/invoice-suggestions.css";

interface InvoiceReviewProps {
  file: File | null;
  artifacts: readonly {
    id: string;
    filename?: string;
    originalFilename?: string | null;
  }[];
  busy: boolean;
  observation?: InvoiceReviewObservation | null;
  observationOnly?: boolean;
  onObservation?: (observation: InvoiceReviewObservation) => void;
  prepareFile?: (file: File) => Promise<string>;
  getValues: () => InvoiceEditableFields;
  onApply: (changes: Partial<InvoiceEditableFields>) => void;
  canApplySettlement?: (settlement: ReviewedSettlementValues) => boolean;
  onApplySettlement?: (settlement: ReviewedSettlementValues) => boolean;
}

export interface ReviewedSettlementValues {
  settlementAmount: string;
  settlementCurrency: string;
}

export interface InvoiceReviewObservation {
  artifactId: string;
  result: InvoiceParseResult;
  duplicateMessage: string;
}

const fieldLabels: Record<keyof InvoiceEditableFields, string> = {
  counterparty: "Supplier",
  invoiceDate: "Invoice date",
  reference: "Reference",
  documentAmount: "Invoice total",
  documentCurrency: "Document currency",
};

const warningLabels: Record<string, string> = {
  ambiguous_currency:
    "The currency is not explicit. Select and confirm it before applying an amount.",
  currency_unconfirmed: "The currency needs confirmation.",
  conflicting_currency: "Currency labels disagree; review the source PDF.",
  conflicting_date: "Invoice dates disagree; no date is suggested.",
  conflicting_reference: "References disagree; no reference is suggested.",
  conflicting_total:
    "Totals disagree; enter and confirm the reviewed invoice total.",
  invoice_total_missing:
    "No explicit invoice total was found. Amount paid and subtotal are not an automatic substitute.",
  totals_do_not_reconcile:
    "The observed totals do not reconcile; review the source PDF.",
  stripe_duplicate_risk:
    "Stripe fees may already be included in imported transactions. These facts are review-only.",
  unknown_credit_note_layout: "This credit-note layout requires manual review.",
};

export const InvoiceSuggestionReview = ({
  file,
  artifacts,
  busy,
  observation,
  observationOnly = false,
  onObservation,
  prepareFile,
  getValues,
  onApply,
  canApplySettlement,
  onApplySettlement,
}: InvoiceReviewProps) => {
  const id = useId();
  const artifactKey = artifacts.map(({ id }) => id).join(",");
  const defaultSource = file ? "selected-file" : (artifacts[0]?.id ?? "");
  const [source, setSource] = useState(defaultSource);
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<InvoiceParseResult | null>(null);
  const [message, setMessage] = useState("");
  const [total, setTotal] = useState("");
  const [currency, setCurrency] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [duplicateMessage, setDuplicateMessage] = useState("");
  const requestVersion = useRef(0);
  const valuesRef = useRef(getValues);
  valuesRef.current = getValues;
  const targetRef = useRef({ source, file, artifactKey });
  targetRef.current = { source, file, artifactKey };
  const matchingObservation =
    !file &&
    observation &&
    artifacts.some(({ id }) => id === observation.artifactId)
      ? observation
      : null;

  useEffect(() => {
    requestVersion.current += 1;
    setResult(matchingObservation?.result ?? null);
    setMessage(
      matchingObservation
        ? matchingObservation.result.status === "unsupported"
          ? observationOnly
            ? "This invoice layout is unsupported. No transaction changes were made."
            : "This invoice layout is unsupported. Continue with manual entry."
          : observationOnly
            ? "Review the observed facts against the confirmed PDF. Transaction fields remain unchanged."
            : "Review the suggestions against the PDF before applying them."
        : "",
    );
    setDuplicateMessage(matchingObservation?.duplicateMessage ?? "");
    setExtracting(false);
    setSource(matchingObservation?.artifactId ?? defaultSource);
    setTotal(matchingObservation?.result.fields.invoiceTotal?.amount ?? "");
    setCurrency(matchingObservation?.result.fields.currency ?? "");
    setConfirmed(false);
    return () => {
      requestVersion.current += 1;
    };
  }, [artifactKey, defaultSource, file, matchingObservation]);

  const clearResult = (next: string) => {
    requestVersion.current += 1;
    setSource(next);
    setResult(null);
    setMessage("");
    setDuplicateMessage("");
    setExtracting(false);
    setTotal("");
    setCurrency("");
    setConfirmed(false);
  };

  const extract = async () => {
    if (busy || extracting || !source) return;
    const version = ++requestVersion.current;
    const target = { source, file, artifactKey };
    const startingValues = JSON.stringify(valuesRef.current());
    const stillCurrent = () =>
      version === requestVersion.current &&
      target.source === targetRef.current.source &&
      target.file === targetRef.current.file &&
      target.artifactKey === targetRef.current.artifactKey;
    setExtracting(true);
    setResult(null);
    setMessage("");
    setDuplicateMessage("");
    try {
      const artifactId =
        source === "selected-file" && file && prepareFile
          ? await prepareFile(file)
          : source;
      if (!stillCurrent()) return;
      if (artifactId === "selected-file") {
        setMessage(
          "Upload and confirm this PDF first, or choose an available invoice PDF.",
        );
        return;
      }
      const response = await extractInvoiceFields({ data: { artifactId } });
      if (!stillCurrent()) return;
      if (startingValues !== JSON.stringify(valuesRef.current())) {
        setMessage(
          "Transaction fields changed during extraction. Extract again to review suggestions against the current values.",
        );
        return;
      }
      if (response.status === "unsupported") {
        setMessage(
          observationOnly
            ? "This PDF could not be safely extracted. No transaction changes were made."
            : "This PDF could not be safely extracted. Continue with manual entry.",
        );
        return;
      }
      const duplicateFacts = [
        response.duplicateHints.linkedTransactions
          ? `${response.duplicateHints.linkedTransactions} existing transaction link(s)`
          : "",
        response.duplicateHints.matchingReferenceTransactions
          ? `${response.duplicateHints.matchingReferenceTransactions} transaction(s) with the same reference`
          : "",
        response.duplicateHints.matchingChecksumArtifacts
          ? `${response.duplicateHints.matchingChecksumArtifacts} other PDF(s) with the same checksum`
          : "",
      ].filter(Boolean);
      const nextDuplicateMessage = duplicateFacts.length
        ? `Review possible duplicates: ${duplicateFacts.join("; ")}. Shared evidence may be legitimate; no records were blocked or changed.`
        : "";
      const nextObservation = {
        artifactId,
        result: response.result,
        duplicateMessage: nextDuplicateMessage,
      } satisfies InvoiceReviewObservation;
      setResult(response.result);
      setDuplicateMessage(nextDuplicateMessage);
      onObservation?.(nextObservation);
      setTotal(response.result.fields.invoiceTotal?.amount ?? "");
      setCurrency(response.result.fields.currency ?? "");
      setConfirmed(false);
      setMessage(
        response.result.status === "unsupported"
          ? observationOnly
            ? "This invoice layout is unsupported. No transaction changes were made."
            : "This invoice layout is unsupported. Continue with manual entry."
          : observationOnly
            ? "Review the observed facts against the confirmed PDF. Transaction fields remain unchanged."
            : "Review the suggestions against the PDF before applying them.",
      );
    } catch {
      if (stillCurrent())
        setMessage(
          "Invoice extraction failed. Retry or continue with manual entry; no transaction was changed.",
        );
    } finally {
      if (stillCurrent()) setExtracting(false);
    }
  };

  const apply = (changes: Partial<InvoiceEditableFields>) => {
    onApply(changes);
    setMessage(
      Object.keys(changes).length
        ? "Applied reviewed invoice fields. Payment, occurrence date, ownership and tax fields were not changed."
        : "No compatible blank fields were available. Use a field-specific action to replace an existing value.",
    );
  };
  const review = { amount: total, currency, confirmed };
  const money = result ? reviewedInvoiceMoney(result, review) : null;
  const settlement = money
    ? {
        settlementAmount: money.documentAmount,
        settlementCurrency: money.documentCurrency,
      }
    : null;
  const settlementAvailable =
    settlement &&
    confirmed &&
    onApplySettlement &&
    canApplySettlement?.(settlement);
  const applySettlement = () => {
    if (!settlement || !confirmed || !canApplySettlement?.(settlement)) {
      setMessage(
        "Settlement fields changed or are already populated. Review them before applying the reviewed amount.",
      );
      return;
    }
    if (onApplySettlement?.(settlement) === false) {
      setMessage(
        "Settlement fields changed or are already populated. Review them before applying the reviewed amount.",
      );
      return;
    }
    setMessage(
      "Applied the reviewed amount and currency to settlement fields. Payment date and invoice fields were not changed.",
    );
  };
  const suggestions = result ? invoiceEditableSuggestions(result) : {};
  const currentValues = getValues();
  const sourceFilename =
    source === "selected-file"
      ? file?.name
      : (() => {
          const artifact = artifacts.find(({ id }) => id === source);
          return artifact?.originalFilename ?? artifact?.filename;
        })();
  const conflicts = result
    ? invoiceSuggestionConflicts(currentValues, result, sourceFilename)
    : [];
  const reviewOnly = result?.parser.id === "stripe";
  const facts = result
    ? [
        ...(
          [
            "invoiceTotal",
            "amountPaid",
            "amountDue",
            "subtotal",
            "tax",
          ] as const
        ).flatMap((name) => {
          const fact = result.fields[name];
          return fact
            ? [
                {
                  label: {
                    invoiceTotal: "Invoice total",
                    amountPaid: "Amount paid",
                    amountDue: "Amount due",
                    subtotal: "Subtotal",
                    tax: "Tax shown",
                  }[name],
                  ...fact,
                },
              ]
            : [];
        }),
        ...result.fields.fees.map((fact) => ({
          label: `${fact.kind.replaceAll("_", " ")} fee`,
          ...fact,
        })),
      ]
    : [];

  if (!file && artifacts.length === 0) return null;
  return (
    <section
      className="invoice-suggestion-review"
      aria-label="Invoice content suggestions"
    >
      <h3>Invoice content suggestions</h3>
      <p>
        {observationOnly
          ? "Observed facts from this confirmed PDF are for review only. No transaction fields or amounts are applied here."
          : "Extract locally from a confirmed PDF. Applying suggestions does not approve, link or save the transaction."}
      </p>
      <div className="invoice-extraction-actions">
        {observationOnly ? (
          <p>
            Source:{" "}
            {(() => {
              const artifact = artifacts.find(({ id }) => id === source);
              return (
                artifact?.originalFilename ??
                artifact?.filename ??
                "Confirmed invoice PDF"
              );
            })()}
          </p>
        ) : (
          <>
            <label htmlFor={`invoice-extraction-source-${id}`}>
              PDF to review
            </label>
            <AutocompleteSelect
              id={`invoice-extraction-source-${id}`}
              aria-label="PDF to review"
              value={source}
              onValueChange={clearResult}
              disabled={busy || extracting}
            >
              {file && (
                <option value="selected-file">
                  Selected file: {file.name}
                </option>
              )}
              {artifacts.map((artifact) => (
                <option key={artifact.id} value={artifact.id}>
                  {artifact.filename ?? `Invoice PDF ${artifact.id}`}
                </option>
              ))}
            </AutocompleteSelect>
          </>
        )}
        <button
          type="button"
          disabled={
            busy ||
            extracting ||
            !source ||
            (source === "selected-file" && !prepareFile)
          }
          onClick={() => void extract()}
        >
          {extracting
            ? "Extracting…"
            : source === "selected-file"
              ? "Upload and extract invoice fields"
              : observationOnly
                ? "Extract observed invoice facts"
                : "Extract invoice fields"}
        </button>
      </div>
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
      {duplicateMessage && (
        <p className="invoice-duplicate-warning">{duplicateMessage}</p>
      )}
      {result && result.status !== "unsupported" && (
        <>
          <p>
            Parser: {result.parser.id} v{result.parser.version}.{" "}
            {reviewOnly
              ? "Stripe review-only; no fields can be applied."
              : "Content and filename suggestions are separate."}
          </p>
          {result.warnings.length > 0 && (
            <ul className="invoice-warning-list">
              {result.warnings.map((code) => (
                <li key={code}>
                  {warningLabels[code] ?? code.replaceAll("_", " ")}
                </li>
              ))}
            </ul>
          )}
          {!observationOnly && conflicts.length > 0 && (
            <ul
              className="invoice-warning-list"
              aria-label="Invoice field conflicts"
            >
              {conflicts.map(
                ({ field, source: conflictSource, existing, observed }) => (
                  <li key={`${field}-${conflictSource}`}>
                    {fieldLabels[field]} differs from{" "}
                    {conflictSource === "filename"
                      ? "the filename"
                      : "the entered value"}
                    : {existing} → PDF {observed}. Review before replacing.
                  </li>
                ),
              )}
            </ul>
          )}
          <div className="invoice-facts-scroll">
            <table className="invoice-facts-table">
              <caption>Observed invoice facts</caption>
              <thead>
                <tr>
                  <th>Fact</th>
                  <th>Value</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {(["counterparty", "invoiceDate", "reference"] as const).map(
                  (name) => {
                    const value = {
                      counterparty: result.fields.supplier,
                      invoiceDate: result.fields.issueDate,
                      reference: result.fields.reference,
                    }[name];
                    const provenance = {
                      counterparty: result.provenance.supplier,
                      invoiceDate: result.provenance.issueDate,
                      reference: result.provenance.reference,
                    }[name];
                    return value ? (
                      <tr key={name}>
                        <th scope="row">{fieldLabels[name]}</th>
                        <td>{value}</td>
                        <td>
                          {provenance
                            .map(
                              (item) =>
                                `Page ${item.pageNumber}: ${item.label}`,
                            )
                            .join("; ")}
                        </td>
                      </tr>
                    ) : null;
                  },
                )}
                {facts.map((fact, index) => (
                  <tr key={`${fact.label}-${index}`}>
                    <th scope="row">{fact.label}</th>
                    <td className="money-column">
                      <span className="invoice-facts-currency-label">
                        {fact.currency
                          ? `${fact.currency} `
                          : "Currency unconfirmed · "}
                      </span>
                      <MoneyText>{formatMoneyAmount(fact.amount)}</MoneyText>
                    </td>
                    <td>
                      {fact.provenance
                        .map((item) => `Page ${item.pageNumber}: ${item.label}`)
                        .join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!observationOnly && !reviewOnly && (
            <>
              <div className="invoice-field-actions">
                {(["counterparty", "invoiceDate", "reference"] as const).map(
                  (name) =>
                    suggestions[name] ? (
                      <div key={name}>
                        <span>
                          {fieldLabels[name]}: {currentValues[name] || "blank"}{" "}
                          → {suggestions[name]}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => apply({ [name]: suggestions[name] })}
                        >
                          Use {fieldLabels[name].toLowerCase()}
                        </button>
                      </div>
                    ) : null,
                )}
              </div>
              <fieldset className="invoice-money-review">
                <legend>Reviewed document total</legend>
                <p>
                  Enter the invoice total, not its unpaid balance. Amount paid
                  and subtotal are shown only as evidence.
                </p>
                <div className="invoice-money-fields">
                  <label htmlFor={`reviewed-invoice-total-${id}`}>
                    Invoice total
                    <input
                      id={`reviewed-invoice-total-${id}`}
                      inputMode="decimal"
                      value={total}
                      onChange={(event) => {
                        setTotal(event.currentTarget.value);
                        setConfirmed(false);
                      }}
                    />
                  </label>
                  <div>
                    <label htmlFor={`reviewed-invoice-currency-${id}`}>
                      Currency
                    </label>
                    <AutocompleteSelect
                      id={`reviewed-invoice-currency-${id}`}
                      aria-label="Currency"
                      value={currency}
                      onValueChange={(value) => {
                        setCurrency(value);
                        setConfirmed(false);
                      }}
                    >
                      <option value="">Select currency</option>
                      <option value="AUD">AUD</option>
                      <option value="USD">USD</option>
                    </AutocompleteSelect>
                  </div>
                </div>
                <label className="invoice-confirmation">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) =>
                      setConfirmed(event.currentTarget.checked)
                    }
                  />
                  I checked the invoice total and currency against the source
                  PDF.
                </label>
                <button
                  type="button"
                  disabled={busy || !money}
                  onClick={() => money && apply(money)}
                >
                  Use reviewed invoice total and currency
                </button>
                {onApplySettlement && (
                  <>
                    <p>
                      Use this only when the reviewed amount and currency are
                      the payment actually made. This does not convert
                      currencies or change the payment date.
                    </p>
                    {settlement?.settlementCurrency === "USD" && (
                      <p>
                        Use only if payment was in USD; reconcile an AUD bank
                        movement to record its AUD settlement.
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={busy || !settlementAvailable}
                      onClick={applySettlement}
                    >
                      Use reviewed amount as settlement
                    </button>
                  </>
                )}
              </fieldset>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  apply(applyInvoiceBlankFields(getValues(), result, review))
                }
              >
                Apply to blank fields
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
};
