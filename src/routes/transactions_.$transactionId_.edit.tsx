import { createFileRoute } from "@tanstack/react-router";

import {
  loadManualTransactionRouteData,
  ManualTransactionRoute,
} from "./-transaction-workflow";
import "../styles/transactions.css";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

export const parseTransactionEditSearch = (
  search: Record<string, unknown>,
) => ({
  bank:
    typeof search.bank === "string" && uuidPattern.test(search.bank)
      ? search.bank
      : undefined,
});

export const Route = createFileRoute("/transactions_/$transactionId_/edit")({
  validateSearch: parseTransactionEditSearch,
  loader: ({ params }) => loadManualTransactionRouteData(params.transactionId),
  pendingComponent: () => (
    <main>
      <p role="status">Loading transaction…</p>
    </main>
  ),
  component: () => {
    const { transactionId } = Route.useParams();
    const { bank } = Route.useSearch();
    return (
      <ManualTransactionRoute
        data={Route.useLoaderData()}
        mode="edit"
        returnTo={`/transactions/${transactionId}/edit${bank ? `?bank=${bank}` : ""}`}
        reviewReturnTo={bank ? `/banking/reconcile?bank=${bank}` : undefined}
      />
    );
  },
});
