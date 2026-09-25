import { createFileRoute } from "@tanstack/react-router";

import { NewBankImportPage } from "./banking.imports.new";
import bankingCss from "../styles/banking.css?url";

export const Route = createFileRoute("/imports/commbank")({
  head: () => ({ links: [{ rel: "stylesheet", href: bankingCss }] }),
  component: () => <NewBankImportPage embedded />,
});
