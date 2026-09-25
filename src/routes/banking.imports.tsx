import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouter,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import { listBankImports } from "../server/bank-operations";
import bankingCss from "../styles/banking.css?url";

export const bankImportsPageSize = 50;
export const bankImportsFetchLimit = bankImportsPageSize + 1;
export const bankImportsMaxPage = 201;

export interface BankImportsSearch {
  page: number;
}

export const parseBankImportsSearch = (
  search: Record<string, unknown>,
): BankImportsSearch => {
  const page = Number(search.page ?? 1);
  return {
    page:
      Number.isInteger(page) && page >= 1 && page <= bankImportsMaxPage
        ? page
        : 1,
  };
};

export const bankImportsQueryForPage = (page: number) => ({
  limit: bankImportsFetchLimit,
  offset: (page - 1) * bankImportsPageSize,
});

export const visibleBankImportsPage = <T,>(imports: readonly T[]) => ({
  imports: imports.slice(0, bankImportsPageSize),
  hasNextPage: imports.length > bankImportsPageSize,
});

export const Route = createFileRoute("/banking/imports")({
  head: () => ({ links: [{ rel: "stylesheet", href: bankingCss }] }),
  validateSearch: parseBankImportsSearch,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ deps }) =>
    listBankImports({ data: bankImportsQueryForPage(deps.page) }),
  pendingComponent: BankImportsPending,
  errorComponent: BankImportsError,
  component: BankImportsPage,
});

function BankImportsPending() {
  return (
    <main className="banking-page banking-route-state">
      <p className="eyebrow">Banking</p>
      <h1>Import history</h1>
      <p className="banking-route-pending" role="status" aria-live="polite">
        Loading bank import history…
      </p>
    </main>
  );
}

function BankImportsError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  const retry = () => {
    reset();
    void router.invalidate();
  };

  return (
    <main className="banking-page banking-route-state">
      <p className="eyebrow">Banking</p>
      <section className="banking-panel banking-route-error">
        <h1>Import history unavailable</h1>
        <p role="alert">
          Folio could not load bank import history. Check your access or
          connection, then retry.
        </p>
        <button type="button" onClick={retry}>
          Retry import history
        </button>
      </section>
    </main>
  );
}

function BankImportsPage() {
  const loadedImports = Route.useLoaderData();
  const { page } = Route.useSearch();
  const navigate = useNavigate({ from: "/banking/imports" });
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { imports, hasNextPage } = visibleBankImportsPage(loadedImports);
  const canGoNext = hasNextPage && page < bankImportsMaxPage;
  if (pathname !== "/banking/imports") return <Outlet />;

  return (
    <main className="banking-page">
      <header className="banking-header">
        <p className="eyebrow">Banking</p>
        <h1>Banking</h1>
        <p className="banking-lead">
          Review imported CommBank source files and their processing state.
        </p>
      </header>

      <nav className="banking-tabs" aria-label="Banking sections">
        <a href="/banking/activity">Activity</a>
        <a href="/banking/reconcile">Reconcile</a>
        <a href="/banking/imports" aria-current="page">
          Imports
        </a>
      </nav>

      <section className="banking-panel" aria-labelledby="bank-imports-heading">
        <div className="banking-panel-heading">
          <div>
            <p className="banking-kicker">CommBank CSV</p>
            <h2 id="bank-imports-heading">Import history</h2>
            <p className="banking-muted">
              Row counts and review state describe imported bank activity, not
              Folio transactions.
            </p>
          </div>
          <a className="banking-button-link" href="/imports/commbank">
            Import CSV
          </a>
        </div>

        {imports.length === 0 ? (
          <div className="banking-empty-state">
            <h3>
              {page === 1 ? "No bank imports yet" : "No imports on this page"}
            </h3>
            <p>
              {page === 1
                ? "Choose a CommBank transaction history CSV to begin."
                : `Page ${page} has no imports. The collection may have changed; use Previous to return to available imports.`}
            </p>
            {page === 1 && (
              <a className="banking-button-link" href="/imports/commbank">
                Start an import
              </a>
            )}
          </div>
        ) : (
          <div className="banking-table-scroll">
            <table className="banking-table banking-records-table banking-imports-table">
              <thead>
                <tr>
                  <th scope="col">Source file</th>
                  <th scope="col">Period</th>
                  <th scope="col">Rows</th>
                  <th scope="col">Reviewed</th>
                  <th scope="col">Unresolved</th>
                  <th scope="col">Import state</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((item) => (
                  <tr key={item.artifactId}>
                    <td data-label="Source file">{item.filename}</td>
                    <td data-label="Period">
                      {item.earliestDate && item.latestDate
                        ? `${item.earliestDate} to ${item.latestDate}`
                        : "—"}
                    </td>
                    <td data-label="Rows">{item.rowCount}</td>
                    <td data-label="Reviewed">
                      {item.rowCount - item.unresolvedCount}
                    </td>
                    <td data-label="Unresolved">{item.unresolvedCount}</td>
                    <td data-label="Import state">
                      <span
                        className={`banking-state banking-state-${item.state}`}
                      >
                        {item.state}
                      </span>
                    </td>
                    <td data-label="Actions">
                      {item.rowCount > 0 ? (
                        <a
                          className="banking-table-action"
                          href={`/banking/reconcile?artifact=${encodeURIComponent(item.artifactId)}&window=14`}
                          aria-label={`${item.unresolvedCount > 0 ? "Review unresolved rows in" : "View rows in"} ${item.filename}`}
                        >
                          {item.unresolvedCount > 0
                            ? "Review rows"
                            : "View rows"}
                        </a>
                      ) : (
                        <span aria-label="No imported rows">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(page > 1 || imports.length > 0) && (
          <nav className="banking-pagination" aria-label="Import history pages">
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
