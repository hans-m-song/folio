import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import {
  transactionKindLabels,
  transactionSourceLabels,
} from "../domain/types";
import { downloadArtifact, getTransaction } from "../server/operations";
import "../styles/transaction-detail.css";

export const Route = createFileRoute("/transactions_/$transactionId")({
  loader: ({ params }) =>
    getTransaction({ data: { id: params.transactionId } }),
  pendingComponent: () => (
    <main>
      <p role="status">Loading transaction…</p>
    </main>
  ),
  component: TransactionDetailPage,
});

const show = (value: string | Date | null | undefined) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) return "—";
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return value?.trim() || "—";
};

function TransactionDetailPage() {
  const transaction = Route.useLoaderData();
  const [message, setMessage] = useState("");
  if (!transaction)
    return (
      <main>
        <header>
          <h1>Transaction not found</h1>
          <p>This record may have been removed or is unavailable.</p>
          <a href="/transactions">Back to Transactions</a>
        </header>
      </main>
    );

  const artifacts = transaction.sourceArtifacts ?? [];
  const download = async (id: string) => {
    setMessage("");
    try {
      const url = await downloadArtifact({ data: { id } });
      window.location.assign(url);
    } catch {
      setMessage(
        "The source file could not be downloaded. Retry or check its state.",
      );
    }
  };

  return (
    <main className="transaction-detail-page">
      <a className="transaction-detail-back" href="/transactions">
        ← Transactions
      </a>
      <header>
        <p className="eyebrow">Transaction</p>
        <h1>
          {show(transaction.counterparty) !== "—"
            ? transaction.counterparty
            : transactionKindLabels[transaction.kind]}
        </h1>
        {transaction.sourceSystem === "manual" && (
          <a
            className="transaction-detail-edit"
            href={`/transactions/${transaction.id}/edit`}
          >
            Edit transaction
          </a>
        )}
      </header>
      <section aria-labelledby="transaction-detail-heading">
        <div className="section-heading">
          <h2 id="transaction-detail-heading">Record details</h2>
          <span className="transaction-detail-state">{transaction.status}</span>
        </div>
        <dl className="transaction-detail-grid">
          <div>
            <dt>Type</dt>
            <dd>{transactionKindLabels[transaction.kind]}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{transactionSourceLabels[transaction.sourceSystem]}</dd>
          </div>
          <div>
            <dt>Reference</dt>
            <dd>{show(transaction.reference)}</dd>
          </div>
          <div>
            <dt>Invoice date</dt>
            <dd>{show(transaction.invoiceDate)}</dd>
          </div>
          <div>
            <dt>Document amount</dt>
            <dd>
              {transaction.documentAmount
                ? `${transaction.documentCurrency ?? ""} ${transaction.documentAmount}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Settlement amount</dt>
            <dd>
              {transaction.settlementAmount
                ? `${transaction.settlementCurrency ?? ""} ${transaction.settlementAmount}`
                : "—"}
            </dd>
          </div>
          {transaction.sourceSystem === "stripe" && (
            <div>
              <dt>Stripe net</dt>
              <dd>
                {transaction.sourceNet
                  ? `${transaction.sourceCurrency ?? ""} ${transaction.sourceNet}`
                  : "—"}
              </dd>
            </div>
          )}
          <div className="transaction-detail-wide">
            <dt>Description</dt>
            <dd>{show(transaction.description)}</dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby="transaction-evidence-heading">
        <h2 id="transaction-evidence-heading">Source artifacts</h2>
        <p role="status" aria-live="polite">
          {message}
        </p>
        {artifacts.length === 0 ? (
          <p>No source artifact is linked to this transaction.</p>
        ) : (
          <ul className="transaction-detail-artifacts">
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                <span>{artifact.filename}</span>
                <span>{artifact.state}</span>
                {artifact.state === "available" && (
                  <button
                    type="button"
                    onClick={() => void download(artifact.id)}
                  >
                    Download
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
