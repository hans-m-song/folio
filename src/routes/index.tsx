import { createFileRoute, useRouter } from "@tanstack/react-router";

import { getCurrentSession } from "../auth/session-server";
import { formatDecimal, parseDecimal } from "../domain/money";
import {
  transactionKindLabels,
  transactionSourceLabels,
} from "../domain/types";
import { getOverviewSummary, getReport } from "../server/operations";
import "../styles/overview.css";

const OverviewError = () => {
  const router = useRouter();

  return (
    <main className="overview-page overview-state">
      <h1>Overview unavailable</h1>
      <p role="alert">Retry the page after checking your connection.</p>
      <button type="button" onClick={() => void router.invalidate()}>
        Retry overview
      </button>
    </main>
  );
};

export const Route = createFileRoute("/")({
  loader: async () => {
    const session = await getCurrentSession();
    if (!session.authenticated)
      return { session, balance: null, summary: null };

    const [result, summary] = await Promise.all([
      getReport({
        data: { basis: "cash", periodType: "month", format: "json" },
      }),
      getOverviewSummary(),
    ]);
    return { session, balance: result.balance, summary };
  },
  pendingComponent: () => (
    <main className="overview-page overview-state">
      <p role="status" aria-live="polite">
        Loading overview…
      </p>
    </main>
  ),
  errorComponent: OverviewError,
  component: OverviewPage,
});

const money = (value: string) => {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals =
    fraction.slice(0, 2) + (fraction.slice(2).replace(/0+$/, "") || "");
  return `${negative ? "−" : ""}$${grouped}.${decimals.padEnd(2, "0")}`;
};

function OverviewPage() {
  const { session, balance, summary } = Route.useLoaderData();
  if (!session.authenticated)
    return (
      <main className="overview-page">
        <header>
          <h1>Folio</h1>
          <p>Sign in to open your private workspace.</p>
        </header>
        <a className="overview-primary-link" href="/auth/login?return_to=%2F">
          Sign in
        </a>
      </main>
    );

  const lines = balance?.lines ?? [];
  const inflow = formatDecimal(
    lines.reduce((sum, line) => sum + parseDecimal(line.inflowAud), 0n),
  );
  const outflow = formatDecimal(
    lines.reduce((sum, line) => sum + parseDecimal(line.outflowAud), 0n),
  );
  const net = formatDecimal(
    lines.reduce((sum, line) => sum + parseDecimal(line.netMovementAud), 0n),
  );
  const count = lines.reduce((sum, line) => sum + line.includedCount, 0);
  const recentLines = lines.slice(-12);
  const attention = summary?.attention;
  const recentTransactions = summary?.recent.transactions ?? [];
  const recentBankRows = summary?.recent.bankRows ?? [];
  const largest = Math.max(
    1,
    ...recentLines.flatMap((line) => [
      Number(line.inflowAud),
      Number(line.outflowAud),
    ]),
  );

  return (
    <main className="overview-page">
      <header className="overview-header">
        <div>
          <h1>Overview</h1>
          <p>Your recorded cash movement at a glance.</p>
        </div>
        <a className="overview-primary-link" href="/transactions#entry-heading">
          New transaction
        </a>
      </header>
      <section
        aria-labelledby="overview-summary-heading"
        className="overview-summary"
      >
        <div className="section-heading">
          <h2 id="overview-summary-heading">Lifetime summary</h2>
          <span>Recorded movement · All time · AUD</span>
        </div>
        <div className="overview-metrics">
          <div>
            <span>Inflow</span>
            <strong>{money(inflow)}</strong>
          </div>
          <div>
            <span>Outflow</span>
            <strong>{money(outflow)}</strong>
          </div>
          <div>
            <span>Net movement</span>
            <strong
              className={
                net.startsWith("-") ? "amount-negative" : "amount-positive"
              }
            >
              {money(net)}
            </strong>
          </div>
          <div>
            <span>Included movements</span>
            <strong>{count}</strong>
          </div>
        </div>
      </section>
      <div className="overview-workbench">
        <section
          aria-labelledby="overview-attention-heading"
          className="overview-attention"
        >
          <div className="section-heading">
            <div>
              <h2 id="overview-attention-heading">Needs attention</h2>
              <p>Absolute counts across the workspace.</p>
            </div>
          </div>
          <div className="overview-attention-list">
            <a className="overview-attention-card" href="/banking/reconcile">
              <strong>{attention?.unresolvedBankRows ?? 0}</strong>
              <span>Unresolved imported bank rows</span>
            </a>
            <a className="overview-attention-card" href="/banking/imports">
              <strong>{attention?.importsWithUnresolvedRows ?? 0}</strong>
              <span>Imports with unresolved rows</span>
            </a>
            <a
              className="overview-attention-card"
              href="/transactions#transactions-heading"
            >
              <strong>{attention?.transactionLinkedEvidenceGaps ?? 0}</strong>
              <span>Transactions without linked evidence</span>
            </a>
          </div>
          <div
            aria-labelledby="overview-upload-states-heading"
            className="overview-upload-states"
            role="group"
          >
            <h3 id="overview-upload-states-heading">CSV upload states</h3>
            <p>
              Counts cover Stripe and CommBank CSV uploads. Abandoned uploads
              may be cancelled or duplicates.
            </p>
            <div className="overview-upload-state-list">
              <a
                className="overview-attention-card"
                href="/imports/library?state=pending"
              >
                <strong>{attention?.pendingImportUploads ?? 0}</strong>
                <span>Pending CSV import uploads</span>
              </a>
              <a
                className="overview-attention-card"
                href="/imports/library?state=abandoned"
              >
                <strong>{attention?.abandonedImportUploads ?? 0}</strong>
                <span>Abandoned CSV import uploads</span>
              </a>
            </div>
          </div>
          <a className="overview-secondary-link" href="/imports/commbank">
            Import a bank CSV
          </a>
        </section>
        <section
          aria-labelledby="overview-recent-heading"
          className="overview-activity"
        >
          <div className="section-heading">
            <div>
              <h2 id="overview-recent-heading">Recent activity</h2>
              <p>Latest record snapshots, not a full event history.</p>
            </div>
          </div>
          <div className="overview-activity-grid">
            <section aria-labelledby="overview-recent-transactions-heading">
              <h3 id="overview-recent-transactions-heading">
                Folio transactions
              </h3>
              {recentTransactions.length === 0 ? (
                <p className="overview-activity-empty">
                  No recent Folio transactions.
                </p>
              ) : (
                <ul className="overview-activity-list">
                  {recentTransactions.map((transaction) => (
                    <li key={transaction.id}>
                      <a
                        className="overview-activity-item"
                        href={`/transactions/${encodeURIComponent(transaction.id)}`}
                      >
                        <strong>
                          {transactionKindLabels[transaction.kind]}
                        </strong>
                        <span>
                          {transactionSourceLabels[transaction.sourceSystem]}
                        </span>
                        <span className="overview-activity-state">
                          {transaction.status}
                        </span>
                        <time dateTime={transaction.updatedAt}>
                          Updated {transaction.updatedAt.slice(0, 10)}
                        </time>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="overview-recent-bank-heading">
              <h3 id="overview-recent-bank-heading">Imported bank rows</h3>
              {recentBankRows.length === 0 ? (
                <p className="overview-activity-empty">
                  No imported bank rows yet.
                </p>
              ) : (
                <ul className="overview-activity-list">
                  {recentBankRows.map((row) => (
                    <li key={row.id}>
                      <a
                        className="overview-activity-item"
                        href={`/banking/reconcile?bank=${encodeURIComponent(row.id)}`}
                      >
                        <strong>{money(row.amountAud)}</strong>
                        <span>Posted {row.postedDate}</span>
                        <span className="overview-activity-state">
                          {row.reviewState}
                        </span>
                        <time dateTime={row.updatedAt}>
                          Updated {row.updatedAt.slice(0, 10)}
                        </time>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </section>
      </div>
      <section
        aria-labelledby="overview-movement-heading"
        className="overview-movement"
      >
        <div className="section-heading">
          <div>
            <h2 id="overview-movement-heading">Monthly cash movement</h2>
            <p>Recorded transactions · Not a bank balance</p>
          </div>
          <a href="/reports">Open reports →</a>
        </div>
        {recentLines.length === 0 ? (
          <p>
            No recorded cash movement yet. Add a transaction or import a source
            file to begin.
          </p>
        ) : (
          <div className="overview-movement-grid">
            <div
              className="overview-chart"
              role="img"
              aria-label="Monthly inflow and outflow; exact values are in the adjacent table"
            >
              {recentLines.map((line) => (
                <div className="overview-chart-month" key={line.period}>
                  <div className="overview-chart-bars">
                    <span
                      className="overview-bar-inflow"
                      style={{
                        height: `${Math.max(2, (Number(line.inflowAud) / largest) * 100)}%`,
                      }}
                    />
                    <span
                      className="overview-bar-outflow"
                      style={{
                        height: `${Math.max(2, (Number(line.outflowAud) / largest) * 100)}%`,
                      }}
                    />
                  </div>
                  <span>{line.period.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="table-scroll">
              <table>
                <caption>Exact monthly values (AUD)</caption>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Inflow</th>
                    <th scope="col">Outflow</th>
                    <th scope="col">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {recentLines.map((line) => (
                    <tr key={line.period}>
                      <td>{line.period}</td>
                      <td>{money(line.inflowAud)}</td>
                      <td>{money(line.outflowAud)}</td>
                      <td
                        className={
                          line.netMovementAud.startsWith("-")
                            ? "amount-negative"
                            : "amount-positive"
                        }
                      >
                        {money(line.netMovementAud)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
