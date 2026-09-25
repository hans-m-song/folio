import { createFileRoute } from "@tanstack/react-router";

import { loadTransactionWorkflowSession } from "./-transaction-workflow";
import { ArtifactPdfUploadPage } from "./-artifacts.upload";
import artifactsCss from "../styles/artifacts.css?url";

export const Route = createFileRoute("/imports/pdf")({
  loader: loadTransactionWorkflowSession,
  head: () => ({ links: [{ rel: "stylesheet", href: artifactsCss }] }),
  component: () => (
    <ArtifactPdfUploadPage session={Route.useLoaderData()} embedded />
  ),
});
