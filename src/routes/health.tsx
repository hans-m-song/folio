import { createFileRoute } from "@tanstack/react-router";

import { healthCheck } from "../server/operations";

export const Route = createFileRoute("/health")({
  loader: () => healthCheck(),
  component: HealthPage,
});

function HealthPage() {
  const health = Route.useLoaderData();
  return (
    <main>
      <h1>Folio {health.status}</h1>
    </main>
  );
}
