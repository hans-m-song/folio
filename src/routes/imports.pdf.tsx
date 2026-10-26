import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/imports/pdf")({
  beforeLoad: () => {
    throw redirect({
      href: "/imports/upload?profile=manual_invoice_pdf_v1",
    });
  },
});
