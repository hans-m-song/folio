import { createFileRoute } from "@tanstack/react-router";

import {
  loadManualTransactionRouteData,
  ManualTransactionRoute,
} from "./-transaction-workflow";
import "../styles/transactions.css";

export const Route = createFileRoute("/transactions_/new")({
  loader: () => loadManualTransactionRouteData(),
  pendingComponent: () => (
    <main>
      <p role="status">Loading transaction form…</p>
    </main>
  ),
  component: () => (
    <ManualTransactionRoute
      data={Route.useLoaderData()}
      mode="create"
      returnTo="/transactions/new"
    />
  ),
});
