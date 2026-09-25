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
  const active: SourceTab = pathname.endsWith("/stripe")
    ? "stripe"
    : pathname.endsWith("/pdf")
      ? "pdf"
      : pathname.endsWith("/library")
        ? "library"
        : "commbank";

  return (
    <div className="imports-workspace">
      <header>
        <p className="eyebrow">Sources</p>
        <h1>Sources</h1>
        <p>
          Import CSVs, upload reusable PDF evidence, and manage source files in
          one workspace.
        </p>
      </header>
      <SourceTabs active={active} />
      <Outlet />
    </div>
  );
};

export const Route = createFileRoute("/imports")({ component: SourcesPage });
