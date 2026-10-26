import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../auth/session-server";
import { getArtifactDetails } from "../server/operations";
import { FileDetailPage } from "./-file-detail";
import "../styles/file-detail.css";

export const Route = createFileRoute("/imports/files/$artifactId")({
  loader: async ({ params }) => {
    const session = await getCurrentSession();
    const artifact = session.authenticated
      ? await getArtifactDetails({ data: { id: params.artifactId } })
      : null;
    return { session, artifact };
  },
  component: () => {
    const { session, artifact } = Route.useLoaderData();
    if (!session.authenticated)
      return (
        <p>
          <a href="/auth/login?return_to=%2Fimports%2Flibrary">
            Sign in to view files
          </a>
        </p>
      );
    return <FileDetailPage key={artifact?.id} artifact={artifact} />;
  },
});
