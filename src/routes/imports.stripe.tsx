import { createFileRoute } from "@tanstack/react-router";

import {
  loadTransactionWorkflowSession,
  StripeImportRoute,
} from "./-transaction-workflow";
import "../styles/transactions.css";
import "../styles/stripe-import.css";

export const Route = createFileRoute("/imports/stripe")({
  loader: loadTransactionWorkflowSession,
  component: () => (
    <StripeImportRoute session={Route.useLoaderData()} embedded />
  ),
});
