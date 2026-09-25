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
  deleteArtifact: vi.fn(),
  downloadArtifact: vi.fn(),
  listArtifacts: vi.fn(),
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

import { Route } from "./imports.library";

const artifactRoute = Route as unknown as { component: ComponentType };

const artifact = (
  id: string,
  filename: string,
  state: "pending" | "available" | "deleting",
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
});

afterEach(() => cleanup());

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
