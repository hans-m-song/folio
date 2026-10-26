// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ContextPaneHost,
  type ContextPaneContentLoader,
} from "./context-pane-host";
import {
  canonicalPaneTarget,
  ContextPaneProvider,
  maximumContextPaneDepth,
  PaneLink,
  parseContextPaneSearch,
  SidePane,
  useContextPane,
  usePaneGuard,
} from "./context-pane";

const fileHref = "/imports/files/11111111-1111-4111-8111-111111111111";
const replacementFileHref =
  "/imports/files/33333333-3333-4333-8333-333333333333";
const transactionHref = "/transactions/22222222-2222-4222-8222-222222222222";

const ReplacePaneButton = () => {
  const pane = useContextPane();
  return (
    <button onClick={() => pane?.replace(replacementFileHref)}>
      Replace current pane
    </button>
  );
};

const setupRouter = async (
  loadContent: ContextPaneContentLoader,
  initialEntry = "/workspace?page=3&query=kept",
) => {
  const backgroundLoad = vi.fn(() => null);
  const root = createRootRoute({
    validateSearch: parseContextPaneSearch,
    component: () => (
      <ContextPaneProvider>
        <Outlet />
        <ContextPaneHost loadContent={loadContent} />
      </ContextPaneProvider>
    ),
  });
  const workspace = createRoute({
    getParentRoute: () => root,
    path: "/workspace",
    validateSearch: (search: Record<string, unknown>) => ({
      page: Number(search.page) || 1,
      query: String(search.query ?? ""),
    }),
    loader: backgroundLoad,
    component: () => {
      const pane = useContextPane();
      return (
        <main>
          <h1>Source workspace</h1>
          <input aria-label="Source draft" defaultValue="" />
          <a href={fileHref}>Inspect file</a>
          <PaneLink href={transactionHref}>Inspect transaction</PaneLink>
          <button onClick={() => pane?.replace(replacementFileHref)}>
            Replace pane
          </button>
          <button onClick={() => pane?.replace("/imports/files/../upload")}>
            Replace with invalid target
          </button>
        </main>
      );
    },
  });
  const other = createRoute({
    getParentRoute: () => root,
    path: "/other",
    component: () => <h1>Other page</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([workspace, other]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    defaultPendingMinMs: 0,
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await screen.findByRole("heading", {
    name: "Source workspace",
    hidden: true,
  });
  return { router, backgroundLoad, ...view };
};

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  if (!HTMLDialogElement.prototype.showModal)
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: () => undefined,
    });
  if (!HTMLDialogElement.prototype.close)
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: () => undefined,
    });
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function (this: HTMLDialogElement) {
      this.open = true;
    },
  );
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("pane search contract", () => {
  it("accepts only bounded supported local targets", () => {
    expect(
      parseContextPaneSearch({
        pane: [
          fileHref,
          transactionHref,
          "/transactions/new?artifactId=11111111-1111-4111-8111-111111111111",
          "/imports/upload?profile=manual_invoice_pdf_v1",
        ],
      }).pane,
    ).toHaveLength(4);
    for (const pane of [
      ["https://example.invalid/transactions/new"],
      ["//example.invalid/imports/upload"],
      ["/transactions/new?unexpected=true"],
      ["/imports/files/../upload"],
      ["/imports/upload#section"],
      Array(maximumContextPaneDepth + 1).fill(fileHref),
      "invalid",
    ])
      expect(parseContextPaneSearch({ pane })).toEqual({});
    expect(canonicalPaneTarget("/imports/upload?profile=unknown")).toBeNull();
  });
});

describe("context pane navigation", () => {
  it("restores a validated nested stack directly from the source URL", async () => {
    const initialEntry = `/workspace?page=4&query=reload&pane=${encodeURIComponent(JSON.stringify([fileHref, transactionHref]))}`;
    const { router } = await setupRouter(
      async (href) => (
        <p>{href === fileHref ? "Restored file" : "Restored transaction"}</p>
      ),
      initialEntry,
    );
    await screen.findByText("Restored transaction");
    expect(
      screen.getByRole("dialog", { name: "Transaction details" }),
    ).toBeTruthy();
    expect(document.body.textContent).toContain("Restored file");
    expect(router.state.location.search).toMatchObject({
      page: 4,
      query: "reload",
      pane: [fileHref, transactionHref],
    });
  });
  it("preserves the mounted source, filters and page through nesting and Back/Forward", async () => {
    const mounts = vi.fn();
    const unmounts = vi.fn();
    const FileContent = () => {
      useEffect(() => {
        mounts();
        return unmounts;
      }, []);
      return (
        <section>
          <input aria-label="File draft" defaultValue="" />
          <a href={transactionHref}>Related transaction</a>
        </section>
      );
    };
    const loader = vi.fn(async (href: string) =>
      href === fileHref ? <FileContent /> : <p>Loaded transaction</p>,
    );
    const { router, backgroundLoad } = await setupRouter(loader);
    const source = screen.getByRole("textbox", { name: "Source draft" });
    fireEvent.change(source, { target: { value: "preserved source" } });
    fireEvent.click(screen.getByRole("link", { name: "Inspect file" }));
    const draft = await screen.findByRole("textbox", { name: "File draft" });
    fireEvent.change(draft, { target: { value: "preserved file" } });
    expect(router.state.location.pathname).toBe("/workspace");
    expect(router.state.location.search).toMatchObject({
      page: 3,
      query: "kept",
      pane: [fileHref],
    });
    fireEvent.click(screen.getByRole("link", { name: "Related transaction" }));
    await screen.findByText("Loaded transaction");
    expect(router.state.location.search.pane).toEqual([
      fileHref,
      transactionHref,
    ]);
    expect((draft as HTMLInputElement).value).toBe("preserved file");
    expect(mounts).toHaveBeenCalledOnce();
    expect(unmounts).not.toHaveBeenCalled();
    await act(async () => router.history.back());
    await waitFor(() =>
      expect(router.state.location.search.pane).toEqual([fileHref]),
    );
    expect((draft as HTMLInputElement).value).toBe("preserved file");
    await act(async () => router.history.back());
    await waitFor(() =>
      expect(router.state.location.search.pane).toBeUndefined(),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("textbox", { name: "Source draft" })).toBe(source);
    expect((source as HTMLInputElement).value).toBe("preserved source");
    expect(backgroundLoad).toHaveBeenCalledOnce();
    await act(async () => router.history.forward());
    await screen.findByRole("dialog", { name: "File details" });
  });

  it("replaces the top pane while retaining lower panes and background search", async () => {
    const loader = vi.fn(async (href: string) =>
      href === fileHref ? (
        <>
          <p>Loaded {href}</p>
          <a href={transactionHref}>Related transaction</a>
        </>
      ) : href === transactionHref ? (
        <>
          <p>Loaded {href}</p>
          <ReplacePaneButton />
        </>
      ) : (
        <p>Loaded {href}</p>
      ),
    );
    const { router, backgroundLoad } = await setupRouter(loader);
    fireEvent.click(screen.getByRole("link", { name: "Inspect file" }));
    await screen.findByText(`Loaded ${fileHref}`);
    fireEvent.click(screen.getByRole("link", { name: "Related transaction" }));
    await screen.findByText(`Loaded ${transactionHref}`);

    fireEvent.click(
      screen.getByRole("button", { name: "Replace current pane" }),
    );
    await screen.findByText(`Loaded ${replacementFileHref}`);

    expect(router.state.location.pathname).toBe("/workspace");
    expect(router.state.location.search).toMatchObject({
      page: 3,
      query: "kept",
      pane: [fileHref, replacementFileHref],
    });
    expect(backgroundLoad).toHaveBeenCalledOnce();
    expect(loader.mock.calls.map(([href]) => href)).toEqual([
      fileHref,
      transactionHref,
      replacementFileHref,
    ]);
  });

  it("opens an empty stack and ignores invalid replacement targets", async () => {
    const loader = vi.fn(async (href: string) => <p>Loaded {href}</p>);
    const { router } = await setupRouter(loader);

    fireEvent.click(
      screen.getByRole("button", { name: "Replace with invalid target" }),
    );
    expect(router.state.location.search.pane).toBeUndefined();
    expect(loader).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Replace pane" }));
    await screen.findByText(`Loaded ${replacementFileHref}`);
    expect(router.state.location.search.pane).toEqual([replacementFileHref]);
  });

  it("keeps pending panes blocked and requires confirmation before replacing dirty panes", async () => {
    const GuardedContent = () => {
      const [pending, setPending] = useState(true);
      usePaneGuard({ dirty: true, pending });
      return (
        <>
          <button onClick={() => setPending(false)}>Finish pending work</button>
          <ReplacePaneButton />
        </>
      );
    };
    const { router } = await setupRouter(async (href) =>
      href === fileHref ? <GuardedContent /> : <p>Replacement file loaded</p>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Inspect file" }));
    await screen.findByRole("button", { name: "Finish pending work" });

    fireEvent.click(
      screen.getByRole("button", { name: "Replace current pane" }),
    );
    expect(router.state.location.search.pane).toEqual([fileHref]);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Finish pending work" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Replace current pane" }),
    );
    const canceled = await screen.findByRole("alertdialog");
    fireEvent.click(within(canceled).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(router.state.location.search.pane).toEqual([fileHref]);

    fireEvent.click(
      screen.getByRole("button", { name: "Replace current pane" }),
    );
    const confirmed = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(confirmed).getByRole("button", { name: "Discard changes" }),
    );
    await screen.findByText("Replacement file loaded");
    expect(router.state.location.search.pane).toEqual([replacementFileHref]);
  });

  it("retains native hrefs and modified-click behavior", async () => {
    const loader = vi.fn(async () => <p>Panel</p>);
    const { router } = await setupRouter(loader);
    const link = screen.getByRole("link", { name: "Inspect transaction" });
    expect(link.getAttribute("href")).toBe(transactionHref);
    for (const modifier of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      const nativeClick = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...modifier,
      });
      const preventBrowserNavigation = (event: Event) => {
        expect(event.defaultPrevented).toBe(false);
        event.preventDefault();
      };
      document.addEventListener("click", preventBrowserNavigation, {
        once: true,
      });
      fireEvent(link, nativeClick);
    }
    expect(loader).not.toHaveBeenCalled();
    expect(router.state.location.search.pane).toBeUndefined();
    fireEvent.click(link);
    await screen.findByText("Panel");
    expect(loader).toHaveBeenCalledOnce();
  });

  it("blocks pending dismissal/history and confirms dirty closure without losing the form on cancel", async () => {
    const GuardedContent = () => {
      const [pending, setPending] = useState(true);
      usePaneGuard({ dirty: true, pending });
      return (
        <>
          <input aria-label="Unsaved draft" defaultValue="keep" />
          <button onClick={() => setPending(false)}>Finish operation</button>
        </>
      );
    };
    const { router } = await setupRouter(async () => <GuardedContent />);
    fireEvent.click(screen.getByRole("link", { name: "Inspect file" }));
    await screen.findByRole("textbox", { name: "Unsaved draft" });
    fireEvent.click(screen.getByRole("button", { name: "Close File details" }));
    await act(async () => {
      void router.navigate({ href: "/other" });
    });
    expect(router.state.location.search.pane).toEqual([fileHref]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Finish operation" }));
    await act(async () => {
      void router.navigate({ href: "/other" });
    });
    const confirmation = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(
      (
        screen.getByRole("textbox", {
          name: "Unsaved draft",
        }) as HTMLInputElement
      ).value,
    ).toBe("keep");
    fireEvent.click(screen.getByRole("button", { name: "Close File details" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Discard changes" }),
    );
    await waitFor(() =>
      expect(router.state.location.search.pane).toBeUndefined(),
    );
  });

  it("clears a successful mutation guard before returning to the source", async () => {
    const SavedContent = () => {
      const pane = useContextPane();
      usePaneGuard({ dirty: true, pending: true });
      return (
        <button
          onClick={() => {
            pane?.clearGuard();
            pane?.close();
          }}
        >
          Saved
        </button>
      );
    };
    const { router } = await setupRouter(async () => <SavedContent />);
    fireEvent.click(screen.getByRole("link", { name: "Inspect file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Saved" }));
    await waitFor(() =>
      expect(router.state.location.search.pane).toBeUndefined(),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("refreshes read-only parents after child success while retaining source and unsaved form layers", async () => {
    let version = "Before save";
    const newHref = "/transactions/new";
    const editHref = `${transactionHref}/edit`;
    const ReadOnlyFile = ({ value }: { value: string }) => (
      <>
        <p>File {value}</p>
        <input aria-label="Local file draft" />
        <a href={newHref}>Create draft</a>
      </>
    );
    const UnsavedForm = () => {
      usePaneGuard({ dirty: true, pending: false });
      return (
        <>
          <input aria-label="Unsaved creation" />
          <a href={transactionHref}>Inspect draft evidence</a>
        </>
      );
    };
    const TransactionDetail = ({ value }: { value: string }) => (
      <>
        <p>Transaction {value}</p>
        <input aria-label="Local detail draft" />
        <a href={editHref}>Edit nested transaction</a>
      </>
    );
    const Mutation = () => {
      const pane = useContextPane();
      usePaneGuard({ dirty: true, pending: false });
      return (
        <button
          onClick={() => {
            version = "After save";
            pane?.clearGuard();
            pane?.refresh();
            pane?.close();
          }}
        >
          Save nested transaction
        </button>
      );
    };
    const loader = vi.fn(async (href: string) => {
      if (href === fileHref) return <ReadOnlyFile value={version} />;
      if (href === newHref) return <UnsavedForm />;
      if (href === transactionHref)
        return <TransactionDetail value={version} />;
      return <Mutation />;
    });
    const { router, backgroundLoad } = await setupRouter(loader);
    const source = screen.getByRole("textbox", { name: "Source draft" });
    fireEvent.change(source, { target: { value: "source retained" } });
    fireEvent.click(screen.getByRole("link", { name: "Inspect file" }));
    const fileDraft = await screen.findByRole("textbox", {
      name: "Local file draft",
    });
    fireEvent.change(fileDraft, { target: { value: "file draft retained" } });
    fireEvent.click(screen.getByRole("link", { name: "Create draft" }));
    const creation = await screen.findByRole("textbox", {
      name: "Unsaved creation",
    });
    fireEvent.change(creation, { target: { value: "creation retained" } });
    fireEvent.click(
      screen.getByRole("link", { name: "Inspect draft evidence" }),
    );
    const detailDraft = await screen.findByRole("textbox", {
      name: "Local detail draft",
    });
    fireEvent.change(detailDraft, {
      target: { value: "detail draft retained" },
    });
    fireEvent.click(
      screen.getByRole("link", { name: "Edit nested transaction" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Save nested transaction" }),
    );
    await screen.findByText("Transaction After save");
    expect(document.body.textContent).toContain("File After save");
    expect(router.state.location.search).toMatchObject({
      page: 3,
      query: "kept",
      pane: [fileHref, newHref, transactionHref],
    });
    for (const [input, value] of [
      [source, "source retained"],
      [fileDraft, "file draft retained"],
      [creation, "creation retained"],
      [detailDraft, "detail draft retained"],
    ] as const) {
      expect(document.body.contains(input)).toBe(true);
      expect((input as HTMLInputElement).value).toBe(value);
    }
    expect(backgroundLoad).toHaveBeenCalledOnce();
    expect(loader.mock.calls.filter(([href]) => href === newHref)).toHaveLength(
      1,
    );
    expect(
      loader.mock.calls.filter(([href]) => href === editHref),
    ).toHaveLength(1);
    expect(
      loader.mock.calls.filter(([href]) => href === fileHref),
    ).toHaveLength(2);
    expect(
      loader.mock.calls.filter(([href]) => href === transactionHref),
    ).toHaveLength(2);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("retains existing parent content when refresh fails and retries without remounting drafts", async () => {
    const Detail = ({ value }: { value: string }) => {
      const pane = useContextPane();
      return (
        <>
          <p>{value}</p>
          <input aria-label="Refresh-safe draft" />
          <button onClick={() => pane?.refresh()}>Refresh details</button>
        </>
      );
    };
    const loader = vi
      .fn<ContextPaneContentLoader>()
      .mockResolvedValueOnce(<Detail value="Original details" />)
      .mockRejectedValueOnce(new Error("private refresh failure"))
      .mockResolvedValue(<Detail value="Updated details" />);
    await setupRouter(loader);
    fireEvent.click(screen.getByRole("link", { name: "Inspect file" }));
    const draft = await screen.findByRole("textbox", {
      name: "Refresh-safe draft",
    });
    fireEvent.change(draft, { target: { value: "keep during retry" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh details" }));
    await screen.findByRole("alert");
    expect(screen.getByText("Original details")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Refresh-safe draft" })).toBe(
      draft,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await screen.findByText("Updated details");
    expect(screen.getByRole("textbox", { name: "Refresh-safe draft" })).toBe(
      draft,
    );
    expect((draft as HTMLInputElement).value).toBe("keep during retry");
  });

  it("aggregates local pending/dirty guards and dismisses only the topmost local pane", async () => {
    const LocalEditor = () => {
      const [open, setOpen] = useState(true);
      const [pending, setPending] = useState(true);
      return (
        <>
          <p>Retained parent content</p>
          <SidePane
            title="Metadata"
            isOpen={open}
            pending={pending}
            dirty
            onClose={() => setOpen(false)}
          >
            {({ requestClose }) => (
              <>
                <input aria-label="Local draft" defaultValue="local changes" />
                <button onClick={() => setPending(false)}>
                  Finish metadata save attempt
                </button>
                <button onClick={requestClose}>Cancel metadata</button>
              </>
            )}
          </SidePane>
        </>
      );
    };
    const { router } = await setupRouter(async () => <LocalEditor />);
    fireEvent.click(screen.getByRole("link", { name: "Inspect file" }));
    const editor = await screen.findByRole("dialog", { name: "Metadata" });
    fireEvent.click(
      within(editor).getByRole("button", { name: "Cancel metadata" }),
    );
    await act(async () => {
      void router.navigate({ href: "/other" });
    });
    expect(router.state.location.search.pane).toEqual([fileHref]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(
      within(editor).getByRole("button", {
        name: "Finish metadata save attempt",
      }),
    );
    fireEvent.click(
      within(editor).getByRole("button", { name: "Cancel metadata" }),
    );
    const alert = await screen.findByRole("alertdialog");
    expect(editor.contains(alert)).toBe(true);
    fireEvent.click(within(alert).getByRole("button", { name: "Cancel" }));
    expect(
      (screen.getByRole("textbox", { name: "Local draft" }) as HTMLInputElement)
        .value,
    ).toBe("local changes");
    fireEvent.click(
      within(editor).getByRole("button", { name: "Cancel metadata" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Metadata" })).toBeNull(),
    );
    expect(screen.getByRole("dialog", { name: "File details" })).toBeTruthy();
    expect(router.state.location.search.pane).toEqual([fileHref]);
  });

  it("contains pane rendering failures and leaves the source workspace mounted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const BrokenContent = (): ReactNode => {
      throw new Error("internal render error");
    };
    const { router } = await setupRouter(async () => <BrokenContent />);
    const source = screen.getByRole("textbox", { name: "Source draft" });
    fireEvent.click(screen.getByRole("link", { name: "Inspect file" }));
    await screen.findByRole("alert");
    expect(document.body.contains(source)).toBe(true);
    expect(screen.queryByText("internal render error")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close File details" }));
    await waitFor(() =>
      expect(router.state.location.search.pane).toBeUndefined(),
    );
  });

  it("ignores a stale async result after closure and retries a safe load error", async () => {
    let resolve!: (node: ReactNode) => void;
    const loader = vi
      .fn<ContextPaneContentLoader>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockRejectedValueOnce(new Error("private internal failure"))
      .mockResolvedValue(<p>Recovered</p>);
    const { router } = await setupRouter(loader);
    fireEvent.click(screen.getByRole("link", { name: "Inspect file" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Close File details" }));
    await waitFor(() =>
      expect(router.state.location.search.pane).toBeUndefined(),
    );
    await act(async () => resolve(<p>Stale result</p>));
    expect(screen.queryByText("Stale result")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Inspect file" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("private internal failure")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open full page" }).getAttribute("href"),
    ).toBe(fileHref);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Recovered");
  });
});

describe("local SidePane", () => {
  it("guards render-prop Cancel outside the host provider", async () => {
    const closed = vi.fn();
    render(
      <SidePane title="Metadata" isOpen dirty onClose={closed}>
        {({ requestClose }) => (
          <button onClick={requestClose}>Cancel editor</button>
        )}
      </SidePane>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel editor" }),
    );
    expect(closed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(closed).toHaveBeenCalledOnce();
  });
});
