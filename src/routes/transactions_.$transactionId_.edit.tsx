import { createFileRoute } from "@tanstack/react-router";

import {
  loadManualTransactionRouteData,
  ManualTransactionRoute,
} from "./-transaction-workflow";
import "../styles/transactions.css";

export const Route = createFileRoute("/transactions_/$transactionId_/edit")({
  loader: ({ params }) => loadManualTransactionRouteData(params.transactionId),
  pendingComponent: () => (
    <main>
      <p role="status">Loading transaction…</p>
    </main>
  ),
  component: () => {
    const { transactionId } = Route.useParams();
    return (
      <ManualTransactionRoute
        data={Route.useLoaderData()}
        mode="edit"
        returnTo={`/transactions/${transactionId}/edit`}
      />
    );
  },
});
