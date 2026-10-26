import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/imports/commbank")({
  beforeLoad: () => {
    throw redirect({
      href: "/imports/upload?profile=commbank_transaction_history_csv_v1",
    });
  },
});
