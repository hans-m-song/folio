import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/imports/stripe")({
  beforeLoad: () => {
    throw redirect({
      href: "/imports/upload?profile=stripe_balance_itemised_csv_v1",
    });
  },
});
