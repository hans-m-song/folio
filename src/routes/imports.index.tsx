import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/imports/")({
  beforeLoad: () => {
    throw redirect({ to: "/imports/commbank" });
  },
});
