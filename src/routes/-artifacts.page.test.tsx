// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement, type ComponentType } from "react";

const mocks = vi.hoisted(() => ({
  data: undefined as unknown,
  search: {
    filename: "",
    profile: "all",
    from: "",
    to: "",
    state: "all",
    linkage: "all",
    page: 1,
  },
  navigate: vi.fn(),
  invalidate: vi.fn(),
}));

const operations = vi.hoisted(() => ({
  approveArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  downloadArtifact: vi.fn(),
  listArtifacts: vi.fn(),
  previewArtifactForReview: vi.fn(),
  rejectArtifact: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (configuration: Record<string, unknown>) => ({
    ...configuration,
    useLoaderData: () => mocks.data,
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ invalidate: mocks.invalidate }),
}));

vi.mock("../server/operations", () => operations);

import { Route, validateArtifactSearch } from "./imports.library";

const artifactRoute = Route as unknown as { component: ComponentType };

const artifact = (
  id: string,
  filename: string,
  state: "pending" | "awaiting_review" | "available" | "rejected" | "deleting",
  mediaType: "text/csv" | "application/pdf",
  transactionCount = 0,
  bankRowCount = 0,
) => ({
  id,
  artifactProfile:
    mediaType === "application/pdf"
      ? "manual_invoice_pdf_v1"
      : "commbank_transaction_history_csv_v1",
  filename,
  mediaType,
  byteSize: "100",
  checksumSha256: "synthetic-checksum",
  state,
  createdAt: "2026-09-24T01:00:00.000Z",
  transactionCount,
  bankRowCount,
});

const pageData = (rows: ReturnType<typeof artifact>[]) => ({
  status: "loaded" as const,
  result: { rows, total: rows.length },
  pagination: { page: 1, pageCount: 1, start: 1, end: rows.length },
});

const renderFileLibrary = () => render(createElement(artifactRoute.component));

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
    },
  });
  vi.resetAllMocks();
  mocks.search = {
    filename: "",
    profile: "all",
    from: "",
    to: "",
    state: "all",
    linkage: "all",
    page: 1,
  };
  mocks.data = pageData([
    artifact("pending-id", "pending-import.csv", "pending", "text/csv"),
    artifact(
      "review-id",
      "awaiting-review.pdf",
      "awaiting_review",
      "application/pdf",
    ),
    artifact(
      "pdf-id",
      "available-evidence.pdf",
      "available",
      "application/pdf",
    ),
    artifact(
      "linked-id",
      "linked-evidence.pdf",
      "available",
      "application/pdf",
      1,
    ),
  ]);
  mocks.navigate.mockResolvedValue(undefined);
  mocks.invalidate.mockResolvedValue(undefined);
  operations.downloadArtifact.mockResolvedValue(
    "https://download.example.test",
  );
  operations.previewArtifactForReview.mockResolvedValue(
    "https://preview.example.test/pinned-version",
  );
  operations.approveArtifact.mockImplementation(async ({ data }) => ({
    id: data.id,
    state: "available",
  }));
  operations.rejectArtifact.mockImplementation(async ({ data }) => ({
    id: data.id,
    state: "rejected",
  }));
});

afterEach(() => cleanup());

describe("PDF artifact review controls", () => {
  it("reloads awaiting-review PDFs into the library without exposing them as evidence", async () => {
    const awaitingPdf = artifact(
      "review-id",
      "awaiting-review.pdf",
      "awaiting_review",
      "application/pdf",
    );
    const awaitingCsv = artifact(
      "review-csv-id",
      "awaiting-review.csv",
      "awaiting_review",
      "text/csv",
    );
    operations.listArtifacts.mockResolvedValueOnce({
      rows: [awaitingPdf, awaitingCsv],
      total: 2,
    });
    const loadLibrary = (
      Route as unknown as {
        loader: (input: {
          deps: ReturnType<typeof validateArtifactSearch>;
        }) => Promise<unknown>;
      }
    ).loader;
    mocks.data = await loadLibrary({ deps: validateArtifactSearch({}) });
    expect(validateArtifactSearch({ state: "awaiting_review" }).state).toBe(
      "awaiting_review",
    );

    expect(operations.listArtifacts).toHaveBeenCalledWith({
      data: {
        search: "",
        profile: null,
        from: null,
        to: null,
        state: null,
        linkage: "all",
        limit: 25,
        offset: 0,
      },
    });
    renderFileLibrary();

    expect(
      screen.getAllByText("Awaiting review", {
        selector: ".artifact-library-state",
      }),
    ).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Preview awaiting-review.pdf" }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Approve awaiting-review.pdf",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Reject awaiting-review.pdf" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Download awaiting-review.pdf" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Preview awaiting-review.csv" }),
    ).toBeNull();
    expect(screen.getAllByText("Download unavailable")).toHaveLength(2);
  });

  it("requires a current-session preview of the same PDF before approval", async () => {
    const current = mocks.data as ReturnType<typeof pageData>;
    mocks.data = pageData([
      ...current.result.rows,
      artifact(
        "second-review-id",
        "second-review.pdf",
        "awaiting_review",
        "application/pdf",
      ),
    ]);
    const view = renderFileLibrary();

    const approveFirst = screen.getByRole("button", {
      name: "Approve awaiting-review.pdf",
    }) as HTMLButtonElement;
    const approveSecond = screen.getByRole("button", {
      name: "Approve second-review.pdf",
    }) as HTMLButtonElement;
    expect(approveFirst.disabled).toBe(true);
    expect(approveSecond.disabled).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Preview awaiting-review.pdf" }),
    );

    const previewLink = await screen.findByRole("link", {
      name: "Open PDF preview for awaiting-review.pdf",
    });
    expect(operations.previewArtifactForReview).toHaveBeenCalledWith({
      data: { id: "review-id" },
    });
    expect(previewLink.getAttribute("href")).toBe(
      "https://preview.example.test/pinned-version",
    );
    expect(previewLink.getAttribute("target")).toBe("_blank");
    expect(previewLink.getAttribute("rel")).toContain("noopener");
    expect(approveFirst.disabled).toBe(false);
    expect(approveSecond.disabled).toBe(true);
    expect(operations.approveArtifact).not.toHaveBeenCalled();

    view.unmount();
    renderFileLibrary();
    expect(
      (
        screen.getByRole("button", {
          name: "Approve awaiting-review.pdf",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("approves only after an explicit action and refreshes the available state", async () => {
    const view = renderFileLibrary();
    mocks.invalidate.mockImplementationOnce(async () => {
      const current = mocks.data as ReturnType<typeof pageData>;
      mocks.data = pageData(
        current.result.rows.map((row) =>
          row.id === "review-id"
            ? { ...row, state: "available" as const }
            : row,
        ),
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Preview awaiting-review.pdf" }),
    );
    await screen.findByRole("link", {
      name: "Open PDF preview for awaiting-review.pdf",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Approve awaiting-review.pdf" }),
    );

    expect(
      await screen.findByText(
        "awaiting-review.pdf approved and available as evidence.",
      ),
    ).toBeTruthy();
    expect(operations.approveArtifact).toHaveBeenCalledWith({
      data: { id: "review-id" },
    });
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    view.rerender(createElement(artifactRoute.component));
    const approvedRow = screen.getByText("awaiting-review.pdf").closest("tr");
    expect(
      approvedRow?.querySelector(".artifact-library-state")?.textContent,
    ).toBe("Available");
    expect(
      screen.getByRole("button", { name: "Download awaiting-review.pdf" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Approve awaiting-review.pdf" }),
    ).toBeNull();
  });

  it("reports approval failures and leaves the PDF awaiting review", async () => {
    operations.approveArtifact.mockRejectedValueOnce(new Error("rejected"));
    renderFileLibrary();

    fireEvent.click(
      screen.getByRole("button", { name: "Preview awaiting-review.pdf" }),
    );
    await screen.findByRole("link", {
      name: "Open PDF preview for awaiting-review.pdf",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Approve awaiting-review.pdf" }),
    );

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Could not confirm the approve action for awaiting-review\.pdf/,
    );
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Approve awaiting-review.pdf" }),
    ).toBeTruthy();
    expect(screen.getAllByText("Download unavailable")).toHaveLength(2);
  });

  it("rejects an awaiting-review PDF and refreshes its rejected state", async () => {
    const view = renderFileLibrary();
    mocks.invalidate.mockImplementationOnce(async () => {
      const current = mocks.data as ReturnType<typeof pageData>;
      mocks.data = pageData(
        current.result.rows.map((row) =>
          row.id === "review-id" ? { ...row, state: "rejected" as const } : row,
        ),
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Reject awaiting-review.pdf" }),
    );

    expect(
      await screen.findByText(
        "awaiting-review.pdf rejected. It is not available as evidence.",
      ),
    ).toBeTruthy();
    expect(operations.rejectArtifact).toHaveBeenCalledWith({
      data: { id: "review-id" },
    });
    view.rerender(createElement(artifactRoute.component));
    expect(
      screen.getByText("Rejected", {
        selector: ".artifact-library-state",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Preview awaiting-review.pdf" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Approve awaiting-review.pdf" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Reject awaiting-review.pdf" }),
    ).toBeNull();
  });
});

describe("File library deletion controls", () => {
  it("offers confirmation for unlinked pending CSV and available PDF, but not linked artifacts", () => {
    renderFileLibrary();

    expect(
      screen.getByRole("button", {
        name: "Delete artifact pending-import.csv",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Delete artifact available-evidence.pdf",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Delete artifact linked-evidence.pdf",
      }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete artifact pending-import.csv",
      }),
    );

    expect(
      screen.getByRole("alertdialog", {
        name: "Permanently delete artifact?",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Upload PDF evidence" }),
    ).toBeNull();
    expect(screen.getByText(/upload is still in progress/i)).toBeTruthy();
    expect(operations.deleteArtifact).not.toHaveBeenCalled();
  });

  it("shows pending and completed deletion states after confirmation", async () => {
    let finishDeletion: (() => void) | undefined;
    operations.deleteArtifact.mockImplementationOnce(
      ({ data }: { data: { id: string } }) =>
        new Promise<void>((resolve) => {
          finishDeletion = () => {
            const current = mocks.data as ReturnType<typeof pageData>;
            mocks.data = pageData(
              current.result.rows.filter((row) => row.id !== data.id),
            );
            resolve();
          };
        }),
    );
    renderFileLibrary();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete artifact pending-import.csv",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() =>
      expect(operations.deleteArtifact).toHaveBeenCalledWith({
        data: { id: "pending-id" },
      }),
    );
    expect(screen.getByRole("alertdialog").getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Delete artifact pending-import.csv" })
        .textContent,
    ).toBe("Deleting…");

    finishDeletion?.();

    expect(
      await screen.findByText("Artifact pending-import.csv deleted."),
    ).toBeTruthy();
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", {
        name: "Delete artifact pending-import.csv",
      }),
    ).toBeNull();
  });

  it("refreshes failed deletions into a retryable deleting row", async () => {
    operations.deleteArtifact
      .mockImplementationOnce(async () => {
        mocks.data = pageData([
          artifact("pending-id", "pending-import.csv", "deleting", "text/csv"),
          artifact(
            "pdf-id",
            "available-evidence.pdf",
            "available",
            "application/pdf",
          ),
          artifact(
            "linked-id",
            "linked-evidence.pdf",
            "available",
            "application/pdf",
            1,
          ),
        ]);
        throw new Error("storage unavailable");
      })
      .mockImplementationOnce(async ({ data }: { data: { id: string } }) => {
        const current = mocks.data as ReturnType<typeof pageData>;
        mocks.data = pageData(
          current.result.rows.filter((row) => row.id !== data.id),
        );
      });
    renderFileLibrary();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete artifact pending-import.csv",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Deletion failed for pending-import\.csv/,
    );
    expect(
      screen.getByRole("button", {
        name: "Retry deletion of pending-import.csv",
      }).textContent,
    ).toBe("Retry deletion");
    expect(
      screen.getByText("Deleting", { selector: ".artifact-library-state" }),
    ).toBeTruthy();
    expect(mocks.invalidate).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Retry deletion of pending-import.csv",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() =>
      expect(operations.deleteArtifact).toHaveBeenCalledTimes(2),
    );
    expect(
      await screen.findByText("Artifact pending-import.csv deleted."),
    ).toBeTruthy();
  });
});
