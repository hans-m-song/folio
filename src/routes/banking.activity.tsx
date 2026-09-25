import {
  createFileRoute,
  useNavigate,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import { TableIconAction } from "../components/table-icon-action";
import { formatAudDecimal } from "../domain/money";
import { listBankTransactions } from "../server/bank-operations";
import bankingCss from "../styles/banking.css?url";

export const bankActivityPageSize = 50;
export const bankActivityFetchLimit = bankActivityPageSize + 1;
export const bankActivityMaxPage = 201;

export interface BankActivitySearch {
  page: number;
}

export const parseBankActivitySearch = (
  search: Record<string, unknown>,
): BankActivitySearch => {
  const page = Number(search.page ?? 1);
  return {
    page:
      Number.isInteger(page) && page >= 1 && page <= bankActivityMaxPage
        ? page
        : 1,
  };
};

export const bankActivityQueryForPage = (page: number) => ({
  limit: bankActivityFetchLimit,
  offset: (page - 1) * bankActivityPageSize,
});

export const visibleBankActivityPage = <T,>(rows: readonly T[]) => ({
  rows: rows.slice(0, bankActivityPageSize),
  hasNextPage: rows.length > bankActivityPageSize,
});

export const Route = createFileRoute("/banking/activity")({
  head: () => ({ links: [{ rel: "stylesheet", href: bankingCss }] }),
  validateSearch: parseBankActivitySearch,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ deps }) =>
    listBankTransactions({ data: bankActivityQueryForPage(deps.page) }),
  pendingComponent: BankActivityPending,
  errorComponent: BankActivityError,
  component: BankActivityPage,
});

function BankActivityPending() {
  return (
    <main className="banking-page banking-route-state">
      <p className="eyebrow">Banking</p>
      <h1>Bank activity</h1>
      <p className="banking-route-pending" role="status" aria-live="polite">
        Loading bank activity…
      </p>
    </main>
  );
}

function BankActivityError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  const retry = () => {
    reset();
    void router.invalidate();
  };

  return (
    <main className="banking-page banking-route-state">
      <p className="eyebrow">Banking</p>
      <section className="banking-panel banking-route-error">
        <h1>Bank activity unavailable</h1>
        <p role="alert">
          Folio could not load bank activity. Check your access or connection,
          then retry.
        </p>
        <button type="button" onClick={retry}>
          Retry bank activity
        </button>
      </section>
    </main>
  );
}

export const bankActivityAmountDisplay = (amountAud: string) => ({
  text: formatAudDecimal(amountAud),
  className: amountAud.startsWith("-") ? "amount-negative" : "amount-positive",
});

const bankActivityDateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export const bankActivityDateDisplay = (postedDate: string): string => {
  const date = new Date(`${postedDate}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf())
    ? postedDate
    : bankActivityDateFormatter.format(date);
};

function BankActivityPage() {
  const loadedRows = Route.useLoaderData();
  const { page } = Route.useSearch();
  const navigate = useNavigate({ from: "/banking/activity" });
  const { rows, hasNextPage } = visibleBankActivityPage(loadedRows);
  const canGoNext = hasNextPage && page < bankActivityMaxPage;

  return (
    <main className="banking-page">
      <header className="banking-header">
        <p className="eyebrow">Banking</p>
        <h1>Banking</h1>
        <p className="banking-lead">
          Review immutable imported bank rows and their current review state.
        </p>
      </header>

      <nav className="banking-tabs" aria-label="Banking sections">
        <a href="/banking/activity" aria-current="page">
          Activity
        </a>
        <a href="/banking/reconcile">Reconcile</a>
        <a href="/banking/imports">Imports</a>
      </nav>

      <section
        className="banking-panel"
        aria-labelledby="bank-activity-heading"
      >
        <div className="banking-panel-heading">
          <div>
            <p className="banking-kicker">Imported source rows</p>
            <h2 id="bank-activity-heading">Bank activity</h2>
            <p className="banking-muted">
              Bank-provided running balances remain source details; Folio does
              not calculate an account balance here.
            </p>
          </div>
          <a className="banking-button-link" href="/imports/commbank">
            Import CommBank CSV
          </a>
        </div>

        {rows.length === 0 ? (
          <div className="banking-empty-state">
            <h3>
              {page === 1
                ? "No bank activity yet"
                : "No bank rows on this page"}
            </h3>
            <p>
              {page === 1
                ? "Import a CommBank CSV to review its source rows in Folio."
                : `Page ${page} has no bank rows. The collection may have changed; use Previous to return to available rows.`}
            </p>
            {page === 1 && (
              <a className="banking-button-link" href="/imports/commbank">
                Import a CSV
              </a>
            )}
          </div>
        ) : (
          <div className="banking-table-scroll">
            <table className="banking-table banking-records-table banking-activity-table">
              <thead>
                <tr>
                  <th scope="col">Posted</th>
                  <th scope="col">Description</th>
                  <th scope="col">Movement</th>
                  <th scope="col">Review state</th>
                  <th scope="col">Match</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const amount = bankActivityAmountDisplay(row.amountAud);
                  return (
                    <tr key={row.id}>
                      <td data-label="Posted">
                        <time dateTime={row.postedDate}>
                          {bankActivityDateDisplay(row.postedDate)}
                        </time>
                      </td>
                      <td data-label="Description">{row.description}</td>
                      <td data-label="Movement" className={amount.className}>
                        {amount.text}
                      </td>
                      <td data-label="Review state">
                        <span
                          className={`banking-state banking-state-${row.reviewState}`}
                        >
                          {row.reviewState}
                        </span>
                      </td>
                      <td data-label="Match">
                        {row.matchedTransactionId ? (
                          <a
                            href={`/transactions/${encodeURIComponent(row.matchedTransactionId)}`}
                            aria-label={`View matched Folio transaction ${row.matchedTransactionId}`}
                          >
                            View transaction
                          </a>
                        ) : (
                          <span aria-label="No matched transaction">—</span>
                        )}
                      </td>
                      <td data-label="Actions">
                        <TableIconAction
                          icon="review"
                          label="Review row"
                          accessibleLabel={`Review bank row posted ${row.postedDate}`}
                          tooltip="Review row"
                          className="banking-table-action"
                          href={`/banking/reconcile?bank=${encodeURIComponent(row.id)}&window=14`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {(page > 1 || rows.length > 0) && (
          <nav className="banking-pagination" aria-label="Bank activity pages">
            <button
              type="button"
              className="secondary"
              disabled={page <= 1}
              onClick={() =>
                void navigate({ search: { page: Math.max(1, page - 1) } })
              }
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              type="button"
              className="secondary"
              disabled={!canGoNext}
              onClick={() => void navigate({ search: { page: page + 1 } })}
            >
              Next
            </button>
          </nav>
        )}
      </section>
    </main>
  );
}
