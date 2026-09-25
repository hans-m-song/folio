import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/transactions_/import/stripe")({
  beforeLoad: () => {
    throw redirect({ to: "/imports/stripe" });
  },
});
