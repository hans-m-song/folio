import { createFileRoute } from "@tanstack/react-router";

import { isFileUploadProfile, FileUploadPage } from "./-file-upload";
import { loadTransactionWorkflowSession } from "./-transaction-workflow";
import type { FileUploadProfile } from "./-file-upload";
import fileWorkspaceCss from "../styles/file-workspace.css?url";

export const parseFileUploadSearch = (
  search: Record<string, unknown>,
): { profile: FileUploadProfile } => ({
  profile: isFileUploadProfile(search.profile)
    ? search.profile
    : "manual_invoice_pdf_v1",
});

const FileUploadRoute = () => (
  <FileUploadPage
    session={Route.useLoaderData()}
    initialProfile={Route.useSearch().profile}
  />
);

export const Route = createFileRoute("/imports/upload")({
  validateSearch: parseFileUploadSearch,
  loader: loadTransactionWorkflowSession,
  head: () => ({ links: [{ rel: "stylesheet", href: fileWorkspaceCss }] }),
  component: FileUploadRoute,
});
