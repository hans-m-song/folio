import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getArtifactDetails } from "../server/operations";

import {
  loadManualTransactionRouteData,
  ManualTransactionRoute,
} from "./-transaction-workflow";
import "../styles/transactions.css";

export const Route = createFileRoute("/transactions_/new")({
  validateSearch: z.object({ artifactId: z.string().uuid().optional() }),
  loaderDeps: ({ search }) => ({ artifactId: search.artifactId }),
  loader: async ({ deps }) => {
    const data = await loadManualTransactionRouteData();
    const artifact =
      deps.artifactId && data.session.authenticated
        ? await getArtifactDetails({ data: { id: deps.artifactId } })
        : null;
    if (
      deps.artifactId &&
      data.session.authenticated &&
      (!artifact ||
        artifact.artifactProfile !== "manual_invoice_pdf_v1" ||
        artifact.state !== "available")
    )
      throw new Error(
        "Choose an approved invoice PDF before creating a transaction.",
      );
    return { ...data, initialArtifact: artifact };
  },
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
      initialArtifact={Route.useLoaderData().initialArtifact}
    />
  ),
});
