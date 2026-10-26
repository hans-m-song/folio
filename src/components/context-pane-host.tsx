import { Component, useEffect, useState, type ReactNode } from "react";

import {
  SidePane,
  useContextPane,
  useContextPaneRevision,
  useContextPaneStack,
} from "./context-pane";

export type ContextPaneContentLoader = (href: string) => Promise<ReactNode>;

const loadContextPaneContent: ContextPaneContentLoader = async (href) => {
  const url = new URL(href, "http://folio.invalid");
  if (url.pathname.startsWith("/imports/files/")) {
    const [{ FileDetailPage }, { getArtifactDetails }] = await Promise.all([
      import("../routes/-file-detail"),
      import("../server/operations"),
    ]);
    const artifact = await getArtifactDetails({
      data: { id: url.pathname.split("/")[3] },
    });
    return <FileDetailPage artifact={artifact} />;
  }
  if (url.pathname === "/imports/upload") {
    const [
      { FileUploadPage, isFileUploadProfile },
      { loadTransactionWorkflowSession },
    ] = await Promise.all([
      import("../routes/-file-upload"),
      import("../routes/-transaction-workflow"),
    ]);
    const session = await loadTransactionWorkflowSession();
    const profile = url.searchParams.get("profile");
    return (
      <PaneActions
        render={(pane) => (
          <FileUploadPage
            embedded
            session={session}
            navigateToArtifact={(id) => {
              pane.clearGuard();
              pane.open(`/imports/files/${id}`);
            }}
            initialProfile={isFileUploadProfile(profile) ? profile : undefined}
          />
        )}
      />
    );
  }
  if (url.pathname === "/transactions/new" || url.pathname.endsWith("/edit")) {
    const { ManualTransactionRoute, loadManualTransactionRouteData } =
      await import("../routes/-transaction-workflow");
    const isCreate = url.pathname === "/transactions/new";
    const data = await loadManualTransactionRouteData(
      isCreate ? undefined : url.pathname.split("/")[2],
    );
    const artifactId = url.searchParams.get("artifactId");
    const { getArtifactDetails } = await import("../server/operations");
    const artifact =
      artifactId && data.session.authenticated
        ? await getArtifactDetails({ data: { id: artifactId } })
        : null;
    if (
      artifactId &&
      data.session.authenticated &&
      (!artifact ||
        artifact.artifactProfile !== "manual_invoice_pdf_v1" ||
        artifact.state !== "available")
    )
      throw new Error("Invoice unavailable");
    return (
      <PaneActions
        render={(pane) => (
          <ManualTransactionRoute
            data={data}
            mode={isCreate ? "create" : "edit"}
            returnTo={href}
            initialArtifact={artifact}
            embedded
            onCancel={pane.close}
            onSaved={() => {
              pane.clearGuard();
              pane.refresh();
              pane.close();
            }}
            onDeleted={() => {
              pane.clearGuard();
              pane.refresh();
              pane.close();
            }}
          />
        )}
      />
    );
  }
  const [{ TransactionDetailContent }, { getTransaction }] = await Promise.all([
    import("../routes/transactions_.$transactionId"),
    import("../server/operations"),
  ]);
  const transaction = await getTransaction({
    data: { id: url.pathname.split("/")[2] },
  });
  return <TransactionDetailContent transaction={transaction} embedded />;
};

const PaneActions = ({
  render,
}: {
  render: (pane: NonNullable<ReturnType<typeof useContextPane>>) => ReactNode;
}) => {
  const pane = useContextPane();
  return pane ? render(pane) : null;
};

const paneTitle = (href: string): string => {
  const pathname = href.split("?")[0];
  if (pathname === "/imports/upload") return "Upload file";
  if (pathname.startsWith("/imports/files/")) return "File details";
  if (pathname === "/transactions/new") return "New transaction";
  if (pathname.endsWith("/edit")) return "Edit transaction";
  return "Transaction details";
};

class PaneRenderBoundary extends Component<
  { children: ReactNode; href: string; retry: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed)
      return (
        <PaneLoadFailure href={this.props.href} retry={this.props.retry} />
      );
    return this.props.children;
  }
}

const PaneLoadFailure = ({
  href,
  retry,
}: {
  href: string;
  retry: () => void;
}) => (
  <div role="alert">
    <p>This panel could not be loaded.</p>
    <button type="button" onClick={retry}>
      Try again
    </button>
    <a href={href} data-context-pane="off">
      Open full page
    </a>
  </div>
);

const PaneContent = ({
  href,
  loadContent,
}: {
  href: string;
  loadContent: ContextPaneContentLoader;
}) => {
  const pane = useContextPane();
  const active = pane?.active ?? false;
  const revision = useContextPaneRevision();
  const pathname = href.split("?")[0];
  const readOnly =
    pathname.startsWith("/imports/files/") ||
    (pathname.startsWith("/transactions/") &&
      pathname !== "/transactions/new" &&
      !pathname.endsWith("/edit"));
  const refreshRevision = readOnly ? revision : 0;
  const [result, setResult] = useState<{
    href: string;
    content?: ReactNode;
    failed?: boolean;
    refreshFailed?: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let current = true;
    setResult((previous) =>
      previous?.href === href && !previous.failed ? previous : null,
    );
    void Promise.resolve()
      .then(() => loadContent(href))
      .then(
        (content) => {
          if (current) setResult({ href, content });
        },
        () => {
          if (current)
            setResult((previous) =>
              previous?.href === href && !previous.failed
                ? { ...previous, refreshFailed: true }
                : { href, failed: true },
            );
        },
      );
    return () => {
      current = false;
    };
  }, [href, loadContent, attempt, active, refreshRevision]);
  if (result?.href !== href)
    return <p role="status">Loading {paneTitle(href).toLowerCase()}…</p>;
  const retry = () => {
    setResult(null);
    setAttempt((value) => value + 1);
  };
  if (result.failed) return <PaneLoadFailure href={href} retry={retry} />;
  return (
    <PaneRenderBoundary href={href} retry={retry}>
      {result.refreshFailed && (
        <p role="alert">
          This panel could not refresh. The previous details are still shown.{" "}
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry refresh
          </button>
        </p>
      )}
      {result.content}
    </PaneRenderBoundary>
  );
};

export const ContextPaneHost = ({
  loadContent = loadContextPaneContent,
}: {
  loadContent?: ContextPaneContentLoader;
}) => {
  const stack = useContextPaneStack();
  const pane = useContextPane();
  const signature = JSON.stringify(stack);
  const [displayed, setDisplayed] = useState(() => ({
    signature,
    entries: stack.slice(0, 1).map((href, index) => ({
      href,
      key: `${index}:${href}`,
      open: true,
    })),
  }));
  useEffect(() => {
    setDisplayed((previous) => {
      const active = new Map(
        stack.map((href, index) => [`${index}:${href}`, href]),
      );
      const entries = previous.entries.map((entry) => ({
        ...entry,
        open: active.has(entry.key),
      }));
      const missing = [...active].find(
        ([key]) => !entries.some((entry) => entry.key === key),
      );
      if (missing)
        entries.push({ key: missing[0], href: missing[1], open: true });
      if (
        previous.signature === signature &&
        !missing &&
        previous.entries.every(
          (entry, index) => entry.open === entries[index].open,
        )
      )
        return previous;
      return { signature, entries };
    });
  }, [signature, displayed.entries.length]);
  return displayed.entries.map(({ href, key, open }) => (
    <SidePane
      key={key}
      owner={key}
      title={paneTitle(href)}
      isOpen={open}
      onClose={() => pane?.close()}
      onExited={() =>
        setDisplayed((previous) => ({
          ...previous,
          entries: previous.entries.filter(
            (entry) => entry.key !== key || entry.open,
          ),
        }))
      }
    >
      <PaneContent href={href} loadContent={loadContent} />
    </SidePane>
  ));
};
