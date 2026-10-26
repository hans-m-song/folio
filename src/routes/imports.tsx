import {
  createFileRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";

import { SourceTabs, type SourceTab } from "../components/import-profile-tabs";

const SourcesPage = () => {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const active: SourceTab =
    pathname.endsWith("/library") || pathname.startsWith("/imports/files/")
      ? "library"
      : "upload";

  return (
    <div className="imports-workspace">
      <header>
        <p className="eyebrow">Sources</p>
        <h1>Sources</h1>
        <p>Upload supported files and manage them in one library.</p>
      </header>
      <SourceTabs active={active} />
      <Outlet />
    </div>
  );
};

export const Route = createFileRoute("/imports")({ component: SourcesPage });
