import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { getReport } from "../server/operations";
import "../styles/reports.css";

type ReportSearch = {
  basis: "activity" | "cash";
  period: "month" | "bas_quarter" | "financial_year";
};

export const parseReportSearch = (
  search: Record<string, unknown>,
): ReportSearch => ({
  basis: search.basis === "activity" ? "activity" : "cash",
  period:
    search.period === "bas_quarter" || search.period === "financial_year"
      ? search.period
      : "month",
});

const ReportsError = () => {
  const router = useRouter();

  return (
    <main className="reports-page">
      <section aria-labelledby="reports-unavailable-heading">
        <h1 id="reports-unavailable-heading">Reports unavailable</h1>
        <p role="alert">Retry the page after checking your connection.</p>
        <button type="button" onClick={() => void router.invalidate()}>
          Retry reports
        </button>
      </section>
    </main>
  );
};

export const Route = createFileRoute("/reports")({
  validateSearch: parseReportSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    getReport({
      data: { basis: deps.basis, periodType: deps.period, format: "json" },
    }),
  pendingComponent: () => (
    <main>
      <p role="status">Loading reports…</p>
    </main>
  ),
  errorComponent: ReportsError,
  component: ReportsPage,
});

function ReportsPage() {
  const result = Route.useLoaderData();
  const search = Route.useSearch();
  const [message, setMessage] = useState("");
  const report = result.report;
  const balance = result.balance;
  const lines = balance?.lines ?? [];
  const chartLines = lines.slice(-12);
  const largest = Math.max(
    1,
    ...chartLines.flatMap((line) => [
      Number(line.inflowAud),
      Number(line.outflowAud),
    ]),
  );

  const exportCsv = async () => {
    setMessage("Preparing export…");
    try {
      const response = await getReport({
        data: { basis: search.basis, periodType: search.period, format: "csv" },
      });
      if (!response.csv) throw new Error("The report was empty");
      const url = URL.createObjectURL(
        new Blob([response.csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `folio-${search.basis}-${search.period}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("CSV export ready.");
    } catch {
      setMessage("Export failed. Retry the report download.");
    }
  };

  return (
    <main className="reports-page">
      <header>
        <h1>Reports</h1>
        <p>
          Preparation views of recorded transactions; not an account balance or
          tax lodgement.
        </p>
      </header>
      <section aria-labelledby="report-heading">
        <div className="section-heading">
          <div>
            <h2 id="report-heading">
              {report?.basisLabel ?? "Preparation summary"}
            </h2>
            <p>
              Period totals and source warnings remain visible alongside the
              cash-movement chart.
            </p>
          </div>
          <button type="button" onClick={() => void exportCsv()}>
            Export CSV
          </button>
        </div>
        <form className="report-filters" method="get" action="/reports">
          <label>
            Basis
            <select name="basis" defaultValue={search.basis}>
              <option value="cash">Cash</option>
              <option value="activity">Activity</option>
            </select>
          </label>
          <label>
            Period
            <select name="period" defaultValue={search.period}>
              <option value="month">Calendar month</option>
              <option value="bas_quarter">BAS quarter (informational)</option>
              <option value="financial_year">Australian financial year</option>
            </select>
          </label>
          <button type="submit">Apply</button>
        </form>
        <p role="status" aria-live="polite">
          {message}
        </p>
        {report?.warnings.length ? (
          <details className="report-warnings">
            <summary>{report.warnings.length} source warnings</summary>
            <ul>
              {report.warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {report?.lines.length ? (
          <div className="table-scroll">
            <table>
              <caption>Preparation totals (AUD)</caption>
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col">Income effect</th>
                  <th scope="col">Expense effect</th>
                  <th scope="col">Cash effect</th>
                  <th scope="col">Included rows</th>
                </tr>
              </thead>
              <tbody>
                {report.lines.map((line) => (
                  <tr key={line.period}>
                    <td>{line.period}</td>
                    <td>{line.incomeEffectAud}</td>
                    <td>{line.expenseEffectAud}</td>
                    <td>{line.cashEffectAud}</td>
                    <td>{line.includedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No included transactions for this view.</p>
        )}
      </section>
      <section aria-labelledby="movement-heading">
        <h2 id="movement-heading">Periodic cash movement</h2>
        <p>Recorded inflow, outflow, and net movement. Not a bank balance.</p>
        {chartLines.length ? (
          <div
            className="report-chart"
            role="img"
            aria-label="Inflow and outflow by period; exact values appear in the table below"
          >
            {chartLines.map((line) => (
              <div className="report-chart-period" key={line.period}>
                <div className="report-chart-bars">
                  <span
                    className="report-chart-inflow"
                    style={{
                      height: `${Math.max(2, (Number(line.inflowAud) / largest) * 100)}%`,
                    }}
                  />
                  <span
                    className="report-chart-outflow"
                    style={{
                      height: `${Math.max(2, (Number(line.outflowAud) / largest) * 100)}%`,
                    }}
                  />
                </div>
                <span>{line.period}</span>
              </div>
            ))}
          </div>
        ) : (
          <p>No movement for this view.</p>
        )}
        {lines.length ? (
          <div className="table-scroll">
            <table>
              <caption>Exact movement values (AUD)</caption>
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col">Inflow</th>
                  <th scope="col">Outflow</th>
                  <th scope="col">Net movement</th>
                  <th scope="col">Included rows</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.period}>
                    <td>{line.period}</td>
                    <td>{line.inflowAud}</td>
                    <td>{line.outflowAud}</td>
                    <td>{line.netMovementAud}</td>
                    <td>{line.includedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
