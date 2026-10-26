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
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextPaneProvider, SidePane } from "../components/context-pane";
import { FileDetailPage } from "./-file-detail";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  navigate: vi.fn(),
  approveArtifact: vi.fn(),
  downloadArtifact: vi.fn(),
  getArtifactDetails: vi.fn(),
  listArtifacts: vi.fn(),
  loadFileReviewQueue: vi.fn(),
  updateArtifactMetadata: vi.fn(),
  previewArtifactForReview: vi.fn(),
  previewStripeCsv: vi.fn(),
  importStripeCsv: vi.fn(),
  previewBankCsv: vi.fn(),
  confirmBankImport: vi.fn(),
  getCsvDuplicateWarnings: vi.fn(),
  location: {
    pathname: "/imports/library",
    search: {} as Record<string, unknown>,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    invalidate: mocks.invalidate,
    navigate: mocks.navigate,
  }),
  useRouterState: ({
    select,
  }: {
    select: (state: {
      location: { pathname: string; search: Record<string, unknown> };
    }) => unknown;
  }) =>
    select({
      location: mocks.location,
    }),
  useBlocker: vi.fn(),
}));
vi.mock("../server/operations", () => ({
  ...mocks,
}));
vi.mock("../server/bank-operations", () => mocks);
vi.mock("../artifacts/file-review-queue", () => ({
  loadFileReviewQueue: mocks.loadFileReviewQueue,
}));

const withContextPane = (children: ReactNode) => (
  <ContextPaneProvider>{children}</ContextPaneProvider>
);

const withActiveContextPane = (children: ReactNode) => (
  <ContextPaneProvider>
    <SidePane
      title="File review"
      isOpen
      owner="file-review-test"
      onClose={() => undefined}
    >
      {children}
    </SidePane>
  </ContextPaneProvider>
);

const artifact = {
  id: "11111111-1111-4111-8111-111111111111",
  artifactProfile: "manual_invoice_pdf_v1" as const,
  filename: "Chosen invoice.pdf",
  originalFilename: "original-upload.pdf",
  mediaType: "application/pdf",
  state: "awaiting_review" as const,
  byteSize: "1234",
  checksumSha256: "synthetic",
  confirmedAt: "2026-10-18T00:00:00.000Z",
  uploadExpiresAt: null,
  createdAt: "2026-10-18T00:00:00.000Z",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  supplier: "Reviewed supplier",
  documentDate: "2026-09-20",
  reference: "INV-TEST",
  notes: "Reviewed source",
  linkedTransactionIds: [] as string[],
  bankRowCount: 0,
};

const stripePreview = {
  artifactId: artifact.id,
  totalCount: 1,
  willImportCount: 1,
  alreadyImportedCount: 0,
  conflictCount: 0,
  page: 1,
  pageSize: 200,
  totalPages: 1,
  displayedCount: 1,
  rows: [
    {
      reference: "txn-test",
      occurredAt: "2026-09-03T00:00:00Z",
      availableAt: null,
      sourceCurrency: "AUD",
      sourceGross: "10.00",
      sourceFee: "1.00",
      sourceNet: "9.00",
      reportingCategory: "charge",
      kind: "stripe_charge",
      mappingWarning: null,
      importStatus: "will_import",
    },
  ],
};

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    },
  });
  vi.resetAllMocks();
  mocks.location.pathname = "/imports/library";
  mocks.location.search = {};
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.navigate.mockResolvedValue(undefined);
  mocks.previewArtifactForReview.mockResolvedValue(
    "https://storage.example.test/signed-inline-preview",
  );
  mocks.approveArtifact.mockResolvedValue({ ...artifact, state: "available" });
  mocks.getArtifactDetails.mockResolvedValue(artifact);
  mocks.listArtifacts.mockResolvedValue({ rows: [artifact], total: 1 });
  mocks.loadFileReviewQueue.mockResolvedValue([
    { id: artifact.id, state: "awaiting_review" },
  ]);
  mocks.updateArtifactMetadata.mockImplementation(({ data }) =>
    Promise.resolve({
      ...artifact,
      filename: data.filename,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
    }),
  );
  mocks.previewStripeCsv.mockResolvedValue(stripePreview);
  mocks.importStripeCsv.mockResolvedValue(1);
  mocks.getCsvDuplicateWarnings.mockResolvedValue(null);
  mocks.previewBankCsv.mockResolvedValue({
    rows: [
      {
        sourceRow: 1,
        postedDate: "2026-09-03",
        description: "Synthetic payment",
        amountAud: "-10.00",
        metadata: {},
      },
    ],
    errors: [],
    earliestDate: "2026-09-03",
    latestDate: "2026-09-03",
  });
});
afterEach(cleanup);

describe("unified file details", () => {
  it("shows chosen and original filenames and embeds the verified PDF", async () => {
    render(withContextPane(<FileDetailPage artifact={artifact} />));
    expect(screen.getByText("original-upload.pdf")).toBeTruthy();
    expect(screen.getByText("2026-09-01")).toBeTruthy();
    expect(screen.getByText("Reviewed supplier")).toBeTruthy();
    expect(screen.getByText("INV-TEST")).toBeTruthy();
    const frame = await screen.findByTitle("PDF preview: Chosen invoice.pdf");
    expect(frame.getAttribute("src")).toContain("signed-inline-preview");
    expect(mocks.previewArtifactForReview).toHaveBeenCalledWith({
      data: { id: artifact.id },
    });
    expect(mocks.approveArtifact).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Download" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("renames an invoice while preserving its original filename and stored coverage", async () => {
    const renamedFilename = "Chosen invoice revised.pdf";
    mocks.previewArtifactForReview
      .mockResolvedValueOnce("https://storage.example.test/old-name-preview")
      .mockResolvedValueOnce("https://storage.example.test/new-name-preview");
    render(withContextPane(<FileDetailPage artifact={artifact} />));
    await screen.findByTitle("PDF preview: Chosen invoice.pdf");

    fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
    expect(screen.getByLabelText("Filename")).toMatchObject({
      value: artifact.filename,
    });
    expect(screen.queryByLabelText("Coverage start")).toBeNull();
    expect(screen.queryByLabelText("Coverage end")).toBeNull();
    fireEvent.change(screen.getByLabelText("Filename"), {
      target: { value: renamedFilename },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save metadata" }));

    await waitFor(() =>
      expect(mocks.updateArtifactMetadata).toHaveBeenCalledWith({
        data: {
          id: artifact.id,
          filename: renamedFilename,
          periodStart: artifact.periodStart,
          periodEnd: artifact.periodEnd,
          expected: {
            filename: artifact.filename,
            periodStart: artifact.periodStart,
            periodEnd: artifact.periodEnd,
          },
        },
      }),
    );
    expect(screen.getByRole("heading", { name: renamedFilename })).toBeTruthy();
    expect(screen.getByText("original-upload.pdf")).toBeTruthy();
    expect(screen.getByText(artifact.periodStart)).toBeTruthy();
    expect(mocks.approveArtifact).not.toHaveBeenCalled();
    expect(mocks.importStripeCsv).not.toHaveBeenCalled();
    expect(mocks.confirmBankImport).not.toHaveBeenCalled();

    const renamedPreview = await screen.findByTitle(
      `PDF preview: ${renamedFilename}`,
    );
    expect(renamedPreview.getAttribute("src")).toContain("new-name-preview");
    expect(mocks.previewArtifactForReview).toHaveBeenCalledTimes(2);

    const renamedAgain = "Chosen invoice final.pdf";
    fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
    fireEvent.change(screen.getByLabelText("Filename"), {
      target: { value: renamedAgain },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save metadata" }));
    await waitFor(() =>
      expect(mocks.updateArtifactMetadata).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByRole("heading", { name: renamedAgain })).toBeTruthy();
    expect(screen.getByText("original-upload.pdf")).toBeTruthy();
    expect(mocks.updateArtifactMetadata.mock.calls[1]?.[0]).toMatchObject({
      data: {
        id: artifact.id,
        filename: renamedAgain,
        expected: {
          filename: renamedFilename,
          periodStart: artifact.periodStart,
          periodEnd: artifact.periodEnd,
        },
      },
    });
    await screen.findByTitle(`PDF preview: ${renamedAgain}`);
    expect(mocks.previewArtifactForReview).toHaveBeenCalledTimes(3);
  });

  it("applies original and edited CSV coverage hints only to blank fields", async () => {
    const commbank = {
      ...artifact,
      artifactProfile: "commbank_transaction_history_csv_v1" as const,
      mediaType: "text/csv",
      filename: "commbank-2026-08-01-2026-08-31.csv",
      originalFilename: "commbank-2026-07-01-2026-07-31.csv",
      periodStart: null,
      periodEnd: null,
    };
    render(withContextPane(<FileDetailPage artifact={commbank} />));
    await screen.findByText("Synthetic payment");

    fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
    const coverageStart = screen.getByLabelText("Coverage start");
    const coverageEnd = screen.getByLabelText("Coverage end");
    expect(coverageStart).toMatchObject({ value: "" });
    expect(coverageEnd).toMatchObject({ value: "" });
    expect(
      screen.getByText(/Original filename .*2026-07-01 to 2026-07-31/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Edited filename .*2026-08-01 to 2026-08-31/),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Apply original filename coverage",
      }),
    );
    expect(coverageStart).toMatchObject({ value: "2026-07-01" });
    expect(coverageEnd).toMatchObject({ value: "2026-07-31" });

    fireEvent.change(coverageStart, { target: { value: "2026-06-15" } });
    fireEvent.change(coverageEnd, { target: { value: "" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Apply edited filename coverage",
      }),
    );
    expect(coverageStart).toMatchObject({ value: "2026-06-15" });
    expect(coverageEnd).toMatchObject({ value: "2026-08-31" });

    fireEvent.change(screen.getByLabelText("Filename"), {
      target: { value: "stripe-2026-09-01-2026-09-30.csv" },
    });
    expect(
      screen.queryByRole("button", {
        name: "Apply edited filename coverage",
      }),
    ).toBeNull();
    expect(mocks.updateArtifactMetadata).not.toHaveBeenCalled();
  });

  it("clears CSV coverage without removing its imported row or transaction link", async () => {
    const transactionId = "33333333-3333-4333-8333-333333333333";
    const commbank = {
      ...artifact,
      artifactProfile: "commbank_transaction_history_csv_v1" as const,
      mediaType: "text/csv",
      state: "available" as const,
      filename: "commbank-2026-09-01-2026-09-30.csv",
      originalFilename: "original-commbank-export.csv",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      linkedTransactionIds: [transactionId],
      bankRowCount: 1,
    };
    render(withContextPane(<FileDetailPage artifact={commbank} />));
    await screen.findByText("Synthetic payment");
    fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
    fireEvent.change(screen.getByLabelText("Filename"), {
      target: { value: "Chosen CommBank export.csv" },
    });
    fireEvent.change(screen.getByLabelText("Coverage start"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Coverage end"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save metadata" }));

    await waitFor(() =>
      expect(mocks.updateArtifactMetadata).toHaveBeenCalledWith({
        data: {
          id: commbank.id,
          filename: "Chosen CommBank export.csv",
          periodStart: null,
          periodEnd: null,
          expected: {
            filename: commbank.filename,
            periodStart: commbank.periodStart,
            periodEnd: commbank.periodEnd,
          },
        },
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Chosen CommBank export.csv" }),
    ).toBeTruthy();
    expect(screen.getByText("original-commbank-export.csv")).toBeTruthy();
    expect(screen.getAllByText("Not specified")).toHaveLength(2);
    expect(screen.getByText("1 imported bank activity rows.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: `View transaction ${transactionId}` }),
    ).toBeTruthy();
    expect(await screen.findByText("Synthetic payment")).toBeTruthy();
    expect(mocks.confirmBankImport).not.toHaveBeenCalled();
    expect(mocks.importStripeCsv).not.toHaveBeenCalled();
  });

  it("preserves invalid and rejected drafts until the user cancels", async () => {
    const user = userEvent.setup();
    const stripe = {
      ...artifact,
      artifactProfile: "stripe_balance_itemised_csv_v1" as const,
      mediaType: "text/csv",
      filename: "stripe-2026-09-01-2026-09-30.csv",
    };
    mocks.updateArtifactMetadata.mockRejectedValueOnce(
      new Error("stale record"),
    );
    render(withContextPane(<FileDetailPage artifact={stripe} />));
    await screen.findByText("txn-test");
    fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
    const filename = screen.getByLabelText("Filename");
    const coverageStart = screen.getByLabelText("Coverage start");
    const coverageEnd = screen.getByLabelText("Coverage end");
    fireEvent.change(filename, {
      target: { value: "stripe revised.csv" },
    });
    fireEvent.change(coverageStart, { target: { value: "2026-10-01" } });
    fireEvent.change(coverageEnd, { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save metadata" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Period end must be on or after period start",
    );
    expect(filename).toHaveProperty("value", "stripe revised.csv");
    expect(coverageStart).toHaveProperty("value", "2026-10-01");
    expect(coverageEnd).toHaveProperty("value", "2026-09-30");
    expect(mocks.updateArtifactMetadata).not.toHaveBeenCalled();

    fireEvent.change(coverageStart, { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save metadata" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "File metadata could not be saved. Reload the file before trying again.",
    );
    expect(filename).toHaveProperty("value", "stripe revised.csv");
    expect(coverageStart).toHaveProperty("value", "2026-09-01");
    expect(coverageEnd).toHaveProperty("value", "2026-09-30");
    expect(mocks.updateArtifactMetadata).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const confirmation = await screen.findByRole("alertdialog", {
      name: "Discard unsaved changes?",
    });
    expect(
      screen.getByRole("dialog", { name: "Edit file metadata" }),
    ).toBeTruthy();
    await user.click(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.getByLabelText("Filename")).toHaveProperty(
      "value",
      "stripe revised.csv",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const discard = await screen.findByRole("alertdialog", {
      name: "Discard unsaved changes?",
    });
    await user.click(
      within(discard).getByRole("button", { name: "Discard changes" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit file metadata" }),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(document.querySelector(".context-pane-overlay")).toBeNull(),
    );
    expect(screen.queryByLabelText("Filename")).toBeNull();
    expect(screen.getByRole("heading", { name: stripe.filename })).toBeTruthy();
    expect(screen.getByText(stripe.periodStart)).toBeTruthy();
    expect(screen.getByText(stripe.periodEnd)).toBeTruthy();
  });

  it("confirms dirty Escape and outside dismissals while preserving the file", async () => {
    const user = userEvent.setup();
    const stripe = {
      ...artifact,
      artifactProfile: "stripe_balance_itemised_csv_v1" as const,
      mediaType: "text/csv",
      filename: "stripe-2026-09-01-2026-09-30.csv",
    };
    render(withContextPane(<FileDetailPage artifact={stripe} />));
    await screen.findByText("txn-test");
    await user.click(screen.getByRole("button", { name: "Edit metadata" }));
    await user.clear(screen.getByLabelText("Filename"));
    await user.type(screen.getByLabelText("Filename"), "stripe revised.csv");

    await user.keyboard("{Escape}");
    const escapeConfirmation = await screen.findByRole("alertdialog", {
      name: "Discard unsaved changes?",
    });
    await user.click(
      within(escapeConfirmation).getByRole("button", { name: "Cancel" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Edit file metadata" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Filename")).toHaveProperty(
      "value",
      "stripe revised.csv",
    );

    const overlay = document.querySelector(".context-pane-overlay");
    if (!overlay) throw new Error("Metadata pane overlay is missing");
    await user.click(overlay);
    const outsideConfirmation = await screen.findByRole("alertdialog", {
      name: "Discard unsaved changes?",
    });
    await user.click(
      within(outsideConfirmation).getByRole("button", {
        name: "Discard changes",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit file metadata" }),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(document.querySelector(".context-pane-overlay")).toBeNull(),
    );
    expect(screen.queryByLabelText("Filename")).toBeNull();
    expect(screen.getByRole("heading", { name: stripe.filename })).toBeTruthy();
    expect(screen.getByText(stripe.periodStart)).toBeTruthy();
    expect(screen.getByText(stripe.periodEnd)).toBeTruthy();
    expect(mocks.updateArtifactMetadata).not.toHaveBeenCalled();
  });

  it("locks the editor during save and ignores an old-file response after navigation", async () => {
    const user = userEvent.setup();
    const firstArtifact = { ...artifact };
    const secondArtifact = {
      ...artifact,
      id: "22222222-2222-4222-8222-222222222222",
      filename: "Other invoice.pdf",
      originalFilename: "other-original.pdf",
    };
    let finishUpdate: ((value: typeof artifact) => void) | undefined;
    const updatePending = new Promise<typeof artifact>((resolve) => {
      finishUpdate = resolve;
    });
    mocks.updateArtifactMetadata.mockReturnValueOnce(updatePending);
    const view = render(
      withContextPane(<FileDetailPage artifact={firstArtifact} />),
    );
    await screen.findByTitle(`PDF preview: ${firstArtifact.filename}`);
    fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
    fireEvent.change(screen.getByLabelText("Filename"), {
      target: { value: "First invoice revised.pdf" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save metadata" }));
    await waitFor(() =>
      expect(mocks.updateArtifactMetadata).toHaveBeenCalledTimes(1),
    );

    expect(
      (screen.getByLabelText("Filename") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Saving metadata…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.keyboard("{Escape}");
    const overlay = document.querySelector(".context-pane-overlay");
    if (!overlay) throw new Error("Metadata pane overlay is missing");
    await user.click(overlay);
    expect(
      screen.getByRole("dialog", { name: "Edit file metadata" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("alertdialog", {
        name: "Discard unsaved changes?",
      }),
    ).toBeNull();

    view.rerender(
      withContextPane(<FileDetailPage artifact={secondArtifact} />),
    );
    expect(
      screen.getByRole("heading", { name: secondArtifact.filename }),
    ).toBeTruthy();
    await act(async () => {
      finishUpdate?.({
        ...firstArtifact,
        filename: "First invoice revised.pdf",
      });
      await updatePending;
    });
    expect(
      screen.getByRole("heading", { name: secondArtifact.filename }),
    ).toBeTruthy();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("marks an invoice approved before refreshing stale details", async () => {
    let finishApproval: (() => void) | undefined;
    let failRefresh: (() => void) | undefined;
    mocks.approveArtifact.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishApproval = () => resolve({ ...artifact, state: "available" });
        }),
    );
    mocks.invalidate.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failRefresh = () => reject(new Error("refresh failed"));
        }),
    );
    const view = render(
      withContextPane(<FileDetailPage artifact={artifact} />),
    );
    await screen.findByTitle("PDF preview: Chosen invoice.pdf");
    expect(
      screen.queryByRole("link", { name: "Create transaction from invoice" }),
    ).toBeNull();
    const pendingApprovalButton = screen.getByRole("button", {
      name: "Confirm",
    }) as HTMLButtonElement;
    fireEvent.click(pendingApprovalButton);
    expect(pendingApprovalButton.disabled).toBe(true);
    await act(async () => {
      finishApproval?.();
    });
    await waitFor(() => expect(mocks.approveArtifact).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(1));
    const approvedButton = await screen.findByRole("button", {
      name: "Confirmed",
    });
    expect((approvedButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(approvedButton);
    expect(mocks.approveArtifact).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("link", { name: "Create transaction from invoice" })
        .getAttribute("href"),
    ).toBe(`/transactions/new?artifactId=${artifact.id}`);
    expect(screen.getByText("available")).toBeTruthy();
    expect(
      screen.getByText(/Invoice approved\. You can now create a transaction/),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      failRefresh?.();
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "details could not be refreshed",
    );

    view.rerender(withContextPane(<FileDetailPage artifact={artifact} />));
    expect(
      (screen.getByRole("button", { name: "Confirmed" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    view.rerender(
      withContextPane(
        <FileDetailPage artifact={{ ...artifact, state: "rejected" }} />,
      ),
    );
    expect(screen.queryByRole("button", { name: "Confirmed" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Create transaction from invoice" }),
    ).toBeNull();
    expect(screen.getByText("rejected")).toBeTruthy();
  });

  it("moves through the active pane in filtered order and skips candidates approved elsewhere", async () => {
    const earlierArtifactId = "22222222-2222-4222-8222-222222222222";
    const skippedArtifactId = "33333333-3333-4333-8333-333333333333";
    const nextArtifactId = "44444444-4444-4444-8444-444444444444";
    const filters = [
      { field: "filename", operator: "contains", value: "September" },
    ];
    const sort = [{ field: "uploaded", direction: "asc" }];
    const sourceSearch = {
      filters,
      sort,
      page: 4,
      pane: [`/imports/files/${artifact.id}`],
    };
    mocks.location.search = sourceSearch;
    mocks.loadFileReviewQueue.mockResolvedValue([
      { id: earlierArtifactId, state: "awaiting_review" },
      { id: artifact.id, state: "awaiting_review" },
      { id: skippedArtifactId, state: "awaiting_review" },
      { id: nextArtifactId, state: "awaiting_review" },
    ]);
    mocks.getArtifactDetails.mockImplementation(({ data }) =>
      Promise.resolve({
        ...artifact,
        id: data.id,
        state: data.id === skippedArtifactId ? "available" : "awaiting_review",
      }),
    );
    render(withActiveContextPane(<FileDetailPage artifact={artifact} />));

    const nextButton = screen.getByRole("button", { name: "Skip" });
    await waitFor(() =>
      expect((nextButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(nextButton);

    await waitFor(() =>
      expect(mocks.getArtifactDetails).toHaveBeenCalledTimes(2),
    );
    expect(mocks.getArtifactDetails).toHaveBeenNthCalledWith(1, {
      data: { id: skippedArtifactId },
    });
    expect(mocks.getArtifactDetails).toHaveBeenNthCalledWith(2, {
      data: { id: nextArtifactId },
    });
    expect(mocks.approveArtifact).not.toHaveBeenCalled();
    expect(mocks.loadFileReviewQueue).toHaveBeenCalledWith(
      { filters, sort },
      expect.any(Function),
    );

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
    const [replaceOptions] = mocks.navigate.mock.calls[0] as [
      {
        search: (previous: Record<string, unknown>) => Record<string, unknown>;
      },
    ];
    expect(replaceOptions.search(sourceSearch)).toEqual({
      ...sourceSearch,
      pane: [`/imports/files/${nextArtifactId}`],
    });
  });

  it("releases the next action when a blocked pane navigation stays pending", async () => {
    const nextArtifactId = "22222222-2222-4222-8222-222222222222";
    mocks.loadFileReviewQueue.mockResolvedValue([
      { id: artifact.id, state: "awaiting_review" },
      { id: nextArtifactId, state: "awaiting_review" },
    ]);
    mocks.getArtifactDetails.mockImplementation(({ data }) =>
      Promise.resolve({
        ...artifact,
        id: data.id,
        state: "awaiting_review",
      }),
    );
    mocks.navigate
      .mockReturnValueOnce(new Promise<void>(() => undefined))
      .mockResolvedValueOnce(undefined);
    render(withActiveContextPane(<FileDetailPage artifact={artifact} />));

    const nextButton = await screen.findByRole("button", {
      name: "Skip",
    });
    await waitFor(() =>
      expect((nextButton as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(nextButton);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect((nextButton as HTMLButtonElement).disabled).toBe(false),
    );
    expect(mocks.getArtifactDetails).toHaveBeenCalledOnce();

    fireEvent.click(nextButton);
    await waitFor(() =>
      expect(mocks.getArtifactDetails).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(2));
    expect((nextButton as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not navigate after the active artifact changes during a candidate read", async () => {
    let resolveCandidate: ((value: typeof artifact) => void) | undefined;
    const nextArtifactId = "22222222-2222-4222-8222-222222222222";
    mocks.loadFileReviewQueue.mockResolvedValue([
      { id: artifact.id, state: "awaiting_review" },
      { id: nextArtifactId, state: "awaiting_review" },
    ]);
    mocks.getArtifactDetails.mockReturnValue(
      new Promise((resolve) => {
        resolveCandidate = resolve;
      }),
    );
    const view = render(
      withContextPane(<FileDetailPage artifact={artifact} />),
    );
    const nextButton = await screen.findByRole("button", {
      name: "Skip",
    });
    await waitFor(() =>
      expect((nextButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(nextButton);
    await waitFor(() =>
      expect(mocks.getArtifactDetails).toHaveBeenCalledOnce(),
    );
    expect((nextButton as HTMLButtonElement).disabled).toBe(true);

    const replacement = {
      ...artifact,
      id: "55555555-5555-4555-8555-555555555555",
      filename: "Replacement invoice.pdf",
    };
    view.rerender(withContextPane(<FileDetailPage artifact={replacement} />));
    await act(async () => {
      resolveCandidate?.({ ...artifact, id: nextArtifactId });
    });

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: replacement.filename }),
    ).toBeTruthy();
  });

  it("retries a failed queue load without presenting a false end state", async () => {
    const nextArtifactId = "22222222-2222-4222-8222-222222222222";
    mocks.loadFileReviewQueue
      .mockRejectedValueOnce(new Error("temporary list failure"))
      .mockResolvedValueOnce([
        { id: artifact.id, state: "awaiting_review" },
        { id: nextArtifactId, state: "awaiting_review" },
      ]);
    const view = render(
      withContextPane(<FileDetailPage artifact={artifact} />),
    );

    expect(
      await screen.findByText(/review queue could not be loaded/i),
    ).toBeTruthy();
    expect(screen.queryByText("No more files to review.")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Skip",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Confirm and next",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Retry review queue" }));
    await waitFor(() =>
      expect(mocks.loadFileReviewQueue).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Skip",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(view.container.textContent).not.toContain(
      "No more files to review.",
    );
  });

  it("approves before advancing and keeps the current file after approval failure", async () => {
    const nextArtifactId = "22222222-2222-4222-8222-222222222222";
    mocks.loadFileReviewQueue.mockResolvedValue([
      { id: artifact.id, state: "awaiting_review" },
      { id: nextArtifactId, state: "awaiting_review" },
    ]);
    mocks.approveArtifact
      .mockRejectedValueOnce(new Error("approval failed"))
      .mockResolvedValueOnce({ ...artifact, state: "available" });
    mocks.getArtifactDetails.mockResolvedValue({
      ...artifact,
      id: nextArtifactId,
      state: "awaiting_review",
    });
    render(withContextPane(<FileDetailPage artifact={artifact} />));
    await screen.findByTitle("PDF preview: Chosen invoice.pdf");
    const approveNext = await screen.findByRole("button", {
      name: "Confirm and next",
    });

    fireEvent.click(approveNext);
    await screen.findByRole("alert");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();

    fireEvent.click(approveNext);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        href: `/imports/files/${nextArtifactId}`,
      }),
    );
    expect(mocks.approveArtifact).toHaveBeenCalledTimes(2);
    expect(mocks.getArtifactDetails).toHaveBeenCalledWith({
      data: { id: nextArtifactId },
    });
  });

  it("does not start candidate lookup when approval resolves after unmount", async () => {
    const nextArtifactId = "22222222-2222-4222-8222-222222222222";
    let resolveApproval:
      | ((value: Omit<typeof artifact, "state"> & { state: string }) => void)
      | undefined;
    mocks.loadFileReviewQueue.mockResolvedValue([
      { id: artifact.id, state: "awaiting_review" },
      { id: nextArtifactId, state: "awaiting_review" },
    ]);
    mocks.approveArtifact.mockReturnValue(
      new Promise((resolve) => {
        resolveApproval = resolve;
      }),
    );
    render(withContextPane(<FileDetailPage artifact={artifact} />));
    await screen.findByTitle("PDF preview: Chosen invoice.pdf");
    const approveNext = await screen.findByRole("button", {
      name: "Confirm and next",
    });
    await waitFor(() =>
      expect((approveNext as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(approveNext);
    await waitFor(() => expect(mocks.approveArtifact).toHaveBeenCalledOnce());
    expect((approveNext as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    await act(async () => {
      resolveApproval?.({ ...artifact, state: "available" });
    });

    expect(mocks.getArtifactDetails).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("includes awaiting-review CSV files and locks navigation during explicit import", async () => {
    const nextArtifactId = "22222222-2222-4222-8222-222222222222";
    let resolveImport: ((count: number) => void) | undefined;
    mocks.loadFileReviewQueue.mockResolvedValue([
      { id: artifact.id, state: "awaiting_review" },
      { id: nextArtifactId, state: "awaiting_review" },
    ]);
    mocks.getArtifactDetails.mockResolvedValue({
      ...artifact,
      id: nextArtifactId,
      state: "awaiting_review",
    });
    mocks.importStripeCsv.mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );
    render(
      withContextPane(
        <FileDetailPage
          artifact={{
            ...artifact,
            artifactProfile: "stripe_balance_itemised_csv_v1",
            mediaType: "text/csv",
            filename: "Chosen.csv",
          }}
        />,
      ),
    );
    await screen.findByText("txn-test");
    const nextButton = await screen.findByRole("button", {
      name: "Skip",
    });
    await waitFor(() =>
      expect((nextButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mocks.importStripeCsv).toHaveBeenCalledOnce());
    expect((nextButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveImport?.(1);
    });
    await waitFor(() =>
      expect((nextButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(nextButton);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        href: `/imports/files/${nextArtifactId}`,
      }),
    );
    expect(mocks.approveArtifact).not.toHaveBeenCalled();
    expect(mocks.importStripeCsv).toHaveBeenCalledOnce();
  });

  it("confirms the last file before showing queue completion", async () => {
    render(withContextPane(<FileDetailPage artifact={artifact} />));
    await screen.findByTitle("PDF preview: Chosen invoice.pdf");
    expect(await screen.findByText("No more files to review.")).toBeTruthy();

    const confirmAndNext = screen.getByRole("button", {
      name: "Confirm and next",
    }) as HTMLButtonElement;
    expect(confirmAndNext.disabled).toBe(false);
    fireEvent.click(confirmAndNext);

    expect(
      await screen.findByRole("button", { name: "Confirmed" }),
    ).toBeTruthy();
    expect((confirmAndNext as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.approveArtifact).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByText("No more files to review.")).toBeTruthy();
  });

  it("allows retry after an approval request fails", async () => {
    mocks.approveArtifact
      .mockRejectedValueOnce(new Error("approval failed"))
      .mockResolvedValueOnce({ ...artifact, state: "available" });
    render(withContextPane(<FileDetailPage artifact={artifact} />));
    await screen.findByTitle("PDF preview: Chosen invoice.pdf");

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByRole("alert");
    expect(
      (
        screen.getByRole("button", {
          name: "Confirm",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const approvedButton = await screen.findByRole("button", {
      name: "Confirmed",
    });
    expect((approvedButton as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.approveArtifact).toHaveBeenCalledTimes(2);
  });

  it("requires the approval response to identify the available artifact", async () => {
    mocks.approveArtifact
      .mockResolvedValueOnce({ ...artifact, id: "different-artifact-id" })
      .mockResolvedValueOnce({ ...artifact, state: "awaiting_review" })
      .mockResolvedValueOnce({ ...artifact, state: "available" });
    render(withContextPane(<FileDetailPage artifact={artifact} />));
    await screen.findByTitle("PDF preview: Chosen invoice.pdf");

    for (const attempt of [1, 2]) {
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
      await waitFor(() =>
        expect(mocks.approveArtifact).toHaveBeenCalledTimes(attempt),
      );
      expect(
        (
          screen.getByRole("button", {
            name: "Confirm",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    }

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(
      await screen.findByRole("button", { name: "Confirmed" }),
    ).toBeTruthy();
    expect(mocks.approveArtifact).toHaveBeenCalledTimes(3);
  });

  it("keeps approval state scoped to the artifact and shows available invoices as approved", async () => {
    const view = render(
      withContextPane(<FileDetailPage artifact={artifact} />),
    );
    await screen.findByTitle("PDF preview: Chosen invoice.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByRole("button", { name: "Confirmed" });

    const secondArtifact = {
      ...artifact,
      id: "22222222-2222-4222-8222-222222222222",
      filename: "Second invoice.pdf",
    };
    view.rerender(
      withContextPane(<FileDetailPage artifact={secondArtifact} />),
    );
    await screen.findByTitle("PDF preview: Second invoice.pdf");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirmed" })).toBeNull();

    view.rerender(
      withContextPane(
        <FileDetailPage artifact={{ ...secondArtifact, state: "available" }} />,
      ),
    );
    const alreadyConfirmed = screen.getByRole("button", { name: "Confirmed" });
    expect((alreadyConfirmed as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.approveArtifact).toHaveBeenCalledTimes(1);
  });

  it("loads CSV proposals without importing and confirms only on request", async () => {
    render(
      withContextPane(
        <FileDetailPage
          artifact={{
            ...artifact,
            artifactProfile: "stripe_balance_itemised_csv_v1",
            mediaType: "text/csv",
            filename: "Chosen.csv",
          }}
        />,
      ),
    );
    await screen.findByText("txn-test");
    expect(mocks.importStripeCsv).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(mocks.importStripeCsv).toHaveBeenCalledWith({
        data: { artifactId: artifact.id },
      }),
    );
  });

  it("blocks Stripe confirmation when the preview contains conflicts", async () => {
    mocks.previewStripeCsv.mockResolvedValue({
      ...stripePreview,
      conflictCount: 1,
    });
    render(
      withContextPane(
        <FileDetailPage
          artifact={{
            ...artifact,
            artifactProfile: "stripe_balance_itemised_csv_v1",
            mediaType: "text/csv",
          }}
        />,
      ),
    );
    await screen.findByText("txn-test");
    expect(
      (
        screen.getByRole("button", {
          name: "Confirm",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(mocks.importStripeCsv).not.toHaveBeenCalled();
  });

  it("requires acknowledging the latest bank overlap before advancing", async () => {
    const nextArtifactId = "22222222-2222-4222-8222-222222222222";
    mocks.loadFileReviewQueue.mockResolvedValue([
      { id: artifact.id, state: "awaiting_review" },
      { id: nextArtifactId, state: "awaiting_review" },
    ]);
    mocks.getArtifactDetails.mockImplementation(({ data }) =>
      Promise.resolve({
        ...artifact,
        id: data.id,
        state: "awaiting_review",
      }),
    );
    mocks.confirmBankImport
      .mockResolvedValueOnce({
        status: "overlap_acknowledgement_required",
        overlapFingerprint: "f".repeat(64),
        overlaps: [
          {
            artifactId: "other",
            filename: "Existing.csv",
            overlapStart: "2026-09-01",
            overlapEnd: "2026-09-30",
          },
        ],
      })
      .mockResolvedValueOnce({
        status: "imported",
        artifactId: artifact.id,
        rowCount: 1,
      });
    render(
      withContextPane(
        <FileDetailPage
          artifact={{
            ...artifact,
            artifactProfile: "commbank_transaction_history_csv_v1",
            mediaType: "text/csv",
          }}
        />,
      ),
    );
    await screen.findByText("Synthetic payment");
    const confirmAndNext = screen.getByRole("button", {
      name: "Confirm and next",
    });
    fireEvent.click(confirmAndNext);
    const acknowledgement = await screen.findByRole("checkbox", {
      name: /I reviewed these overlaps/,
    });
    expect((confirmAndNext as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(acknowledgement);
    fireEvent.click(confirmAndNext);
    await waitFor(() =>
      expect(mocks.confirmBankImport).toHaveBeenLastCalledWith({
        data: {
          artifactId: artifact.id,
          acknowledgedOverlapFingerprint: "f".repeat(64),
        },
      }),
    );
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        href: `/imports/files/${nextArtifactId}`,
      }),
    );
    expect(
      (screen.getByRole("button", { name: "Confirmed" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Confirm and next",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(mocks.confirmBankImport).toHaveBeenCalledTimes(2);
  });

  it("keeps a link to the existing import when a duplicate bank file is rejected", async () => {
    const existingArtifactId = "22222222-2222-4222-8222-222222222222";
    const nextArtifactId = "33333333-3333-4333-8333-333333333333";
    const bankArtifact = {
      ...artifact,
      artifactProfile: "commbank_transaction_history_csv_v1" as const,
      mediaType: "text/csv",
      filename: "Chosen bank.csv",
    };
    mocks.confirmBankImport.mockResolvedValue({
      status: "already_imported",
      artifactId: existingArtifactId,
      rowCount: 1,
    });
    mocks.loadFileReviewQueue.mockResolvedValue([
      { id: bankArtifact.id, state: "awaiting_review" },
      { id: nextArtifactId, state: "awaiting_review" },
    ]);
    mocks.getArtifactDetails.mockImplementation(({ data }) =>
      Promise.resolve({
        ...bankArtifact,
        id: data.id,
        state: "awaiting_review",
      }),
    );
    const view = render(
      withContextPane(<FileDetailPage artifact={bankArtifact} />),
    );
    await screen.findByText("Synthetic payment");

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    const importedActivityLink = await screen.findByRole("link", {
      name: "Review imported bank activity",
    });
    expect(importedActivityLink.getAttribute("href")).toBe(
      `/banking/reconcile?artifact=${existingArtifactId}`,
    );
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Confirmed" })).toBeNull();

    view.rerender(
      withContextPane(
        <FileDetailPage artifact={{ ...bankArtifact, state: "rejected" }} />,
      ),
    );

    expect(
      screen.getByText(
        "This file is not available for content review in its current state.",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Review imported bank activity" })
        .getAttribute("href"),
    ).toBe(`/banking/reconcile?artifact=${existingArtifactId}`);
    const skip = screen.getByRole("button", { name: "Skip" });
    expect((skip as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(skip);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        href: `/imports/files/${nextArtifactId}`,
      }),
    );
    expect(
      screen
        .getByRole("link", { name: "Review imported bank activity" })
        .getAttribute("href"),
    ).toBe(`/banking/reconcile?artifact=${existingArtifactId}`);
  });

  it("does not offer another import for already imported bank activity", async () => {
    render(
      withContextPane(
        <FileDetailPage
          artifact={{
            ...artifact,
            artifactProfile: "commbank_transaction_history_csv_v1",
            mediaType: "text/csv",
            state: "available",
            bankRowCount: 1,
          }}
        />,
      ),
    );
    await screen.findByText("Synthetic payment");
    expect(
      (
        screen.getByRole("button", {
          name: "Confirmed",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("link", {
        name: "Review and create or match transactions",
      }),
    ).toBeTruthy();
  });

  it("uses the same action row after review content for all supported profiles", async () => {
    const supportedProfiles = [
      { artifact, content: "PDF preview" },
      {
        artifact: {
          ...artifact,
          artifactProfile: "stripe_balance_itemised_csv_v1" as const,
          mediaType: "text/csv",
          filename: "Stripe.csv",
        },
        content: "Proposed transactions",
      },
      {
        artifact: {
          ...artifact,
          artifactProfile: "commbank_transaction_history_csv_v1" as const,
          mediaType: "text/csv",
          filename: "CommBank.csv",
        },
        content: "Proposed transactions",
      },
    ];

    for (const { artifact: currentArtifact, content } of supportedProfiles) {
      const view = render(
        withContextPane(<FileDetailPage artifact={currentArtifact} />),
      );
      const reviewContent = await screen.findByRole("region", {
        name: content,
      });
      const actions = screen.getByRole("region", {
        name: "File review actions",
      });

      expect(
        screen.getAllByRole("region", { name: "File review actions" }),
      ).toHaveLength(1);
      expect(
        within(actions)
          .getAllByRole("button")
          .slice(0, 3)
          .map((button) => button.textContent),
      ).toEqual(["Confirm", "Confirm and next", "Skip"]);
      expect(actions.querySelector(".file-detail-actions")).toBeTruthy();
      expect(
        reviewContent.compareDocumentPosition(actions) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        screen.queryByRole("navigation", { name: "File review navigation" }),
      ).toBeNull();

      view.unmount();
    }
  });

  it("advances after a Stripe import and never confirms when Skip is used", async () => {
    const nextArtifactId = "22222222-2222-4222-8222-222222222222";
    const stripeArtifact = {
      ...artifact,
      artifactProfile: "stripe_balance_itemised_csv_v1" as const,
      mediaType: "text/csv",
      filename: "Chosen.csv",
    };
    mocks.loadFileReviewQueue.mockResolvedValue([
      { id: artifact.id, state: "awaiting_review" },
      { id: nextArtifactId, state: "awaiting_review" },
    ]);
    mocks.getArtifactDetails.mockImplementation(({ data }) =>
      Promise.resolve({ ...artifact, id: data.id, state: "awaiting_review" }),
    );
    const view = render(
      withContextPane(<FileDetailPage artifact={stripeArtifact} />),
    );
    await screen.findByText("txn-test");
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Confirm and next",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm and next" }));
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        href: `/imports/files/${nextArtifactId}`,
      }),
    );
    expect(mocks.importStripeCsv).toHaveBeenCalledOnce();
    expect(mocks.approveArtifact).not.toHaveBeenCalled();

    view.unmount();
    vi.clearAllMocks();
    mocks.invalidate.mockResolvedValue(undefined);
    mocks.navigate.mockResolvedValue(undefined);
    mocks.previewArtifactForReview.mockResolvedValue(
      "https://storage.example.test/signed-inline-preview",
    );
    mocks.loadFileReviewQueue.mockResolvedValue([
      { id: artifact.id, state: "awaiting_review" },
      { id: nextArtifactId, state: "awaiting_review" },
    ]);
    mocks.getArtifactDetails.mockImplementation(({ data }) =>
      Promise.resolve({ ...artifact, id: data.id, state: "awaiting_review" }),
    );
    render(withContextPane(<FileDetailPage artifact={stripeArtifact} />));
    await screen.findByText("txn-test");
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Skip" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        href: `/imports/files/${nextArtifactId}`,
      }),
    );
    expect(mocks.importStripeCsv).not.toHaveBeenCalled();
    expect(mocks.approveArtifact).not.toHaveBeenCalled();
  });

  it("keeps Stripe confirmed and blocks repeated writes when preview refresh fails", async () => {
    mocks.previewStripeCsv
      .mockResolvedValueOnce(stripePreview)
      .mockRejectedValueOnce(new Error("refresh failed"));
    render(
      withContextPane(
        <FileDetailPage
          artifact={{
            ...artifact,
            artifactProfile: "stripe_balance_itemised_csv_v1",
            mediaType: "text/csv",
          }}
        />,
      ),
    );
    await screen.findByText("txn-test");

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(
      await screen.findByRole("button", { name: "Confirmed" }),
    ).toBeTruthy();
    expect(
      await screen.findByText(/Stripe import was confirmed, but source rows/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Confirm and next",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(mocks.importStripeCsv).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "Stripe",
      profile: "stripe_balance_itemised_csv_v1" as const,
      successMessage: /Stripe import confirmed/,
    },
    {
      name: "CommBank",
      profile: "commbank_transaction_history_csv_v1" as const,
      successMessage: /1 bank activity rows imported/,
    },
  ])(
    "keeps $name confirmed when file detail refresh fails",
    async ({ profile, successMessage }) => {
      const nextArtifactId = "22222222-2222-4222-8222-222222222222";
      const csvArtifact = {
        ...artifact,
        artifactProfile: profile,
        mediaType: "text/csv",
      };
      mocks.invalidate.mockRejectedValue(new Error("refresh failed"));
      mocks.loadFileReviewQueue.mockResolvedValue([
        { id: csvArtifact.id, state: "awaiting_review" },
        { id: nextArtifactId, state: "awaiting_review" },
      ]);
      mocks.getArtifactDetails.mockImplementation(({ data }) =>
        Promise.resolve({
          ...csvArtifact,
          id: data.id,
          state: "awaiting_review",
        }),
      );
      if (profile === "commbank_transaction_history_csv_v1") {
        mocks.confirmBankImport.mockResolvedValue({
          status: "imported",
          artifactId: csvArtifact.id,
          rowCount: 1,
        });
      }

      render(withContextPane(<FileDetailPage artifact={csvArtifact} />));
      await screen.findByText(
        profile === "stripe_balance_itemised_csv_v1"
          ? "txn-test"
          : "Synthetic payment",
      );

      const confirmAndNext = screen.getByRole("button", {
        name: "Confirm and next",
      }) as HTMLButtonElement;
      await waitFor(() => expect(confirmAndNext.disabled).toBe(false));
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

      const confirmed = await screen.findByRole("button", {
        name: "Confirmed",
      });
      const refreshError = await screen.findByRole("alert");
      expect(refreshError.textContent).toContain(
        "File details could not be refreshed after confirmation",
      );
      expect(await screen.findByText(successMessage)).toBeTruthy();
      expect((confirmed as HTMLButtonElement).disabled).toBe(true);
      expect(confirmAndNext.disabled).toBe(true);

      fireEvent.click(confirmed);
      fireEvent.click(confirmAndNext);

      expect(mocks.importStripeCsv).toHaveBeenCalledTimes(
        profile === "stripe_balance_itemised_csv_v1" ? 1 : 0,
      );
      expect(mocks.confirmBankImport).toHaveBeenCalledTimes(
        profile === "commbank_transaction_history_csv_v1" ? 1 : 0,
      );
      expect(mocks.navigate).not.toHaveBeenCalled();
    },
  );

  it("does not advance after an invalid bank import", async () => {
    mocks.loadFileReviewQueue.mockResolvedValue([
      { id: artifact.id, state: "awaiting_review" },
      { id: "22222222-2222-4222-8222-222222222222", state: "awaiting_review" },
    ]);
    mocks.confirmBankImport.mockResolvedValue({
      status: "invalid",
      errors: [{ row: 2, message: "Invalid amount" }],
    });
    render(
      withContextPane(
        <FileDetailPage
          artifact={{
            ...artifact,
            artifactProfile: "commbank_transaction_history_csv_v1",
            mediaType: "text/csv",
          }}
        />,
      ),
    );
    await screen.findByText("Synthetic payment");
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Confirm and next",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm and next" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.getArtifactDetails).not.toHaveBeenCalled();
  });

  it("keeps CSV advancement stale-safe when the artifact changes during confirmation", async () => {
    const nextArtifactId = "22222222-2222-4222-8222-222222222222";
    const stripeArtifact = {
      ...artifact,
      artifactProfile: "stripe_balance_itemised_csv_v1" as const,
      mediaType: "text/csv",
    };
    let resolveImport: ((count: number) => void) | undefined;
    mocks.loadFileReviewQueue.mockResolvedValue([
      { id: artifact.id, state: "awaiting_review" },
      { id: nextArtifactId, state: "awaiting_review" },
    ]);
    mocks.importStripeCsv.mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );
    const view = render(
      withContextPane(<FileDetailPage artifact={stripeArtifact} />),
    );
    await screen.findByText("txn-test");

    fireEvent.click(screen.getByRole("button", { name: "Confirm and next" }));
    await waitFor(() => expect(mocks.importStripeCsv).toHaveBeenCalledOnce());

    const replacement = {
      ...stripeArtifact,
      id: "55555555-5555-4555-8555-555555555555",
      filename: "Replacement.csv",
    };
    view.rerender(withContextPane(<FileDetailPage artifact={replacement} />));
    await screen.findByRole("heading", { name: replacement.filename });
    await act(async () => {
      resolveImport?.(1);
    });

    expect(mocks.getArtifactDetails).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.importStripeCsv).toHaveBeenCalledOnce();
  });

  it("offers Skip for registered profiles without a supported importer", async () => {
    const nextArtifactId = "22222222-2222-4222-8222-222222222222";
    const unsupportedArtifact = {
      ...artifact,
      artifactProfile: "nab_transaction_history_csv_v1" as const,
      mediaType: "text/csv",
      filename: "NAB.csv",
    };
    mocks.loadFileReviewQueue.mockResolvedValue([
      { id: artifact.id, state: "awaiting_review" },
      { id: nextArtifactId, state: "awaiting_review" },
    ]);
    mocks.getArtifactDetails.mockImplementation(({ data }) =>
      Promise.resolve({ ...artifact, id: data.id, state: "awaiting_review" }),
    );
    render(withContextPane(<FileDetailPage artifact={unsupportedArtifact} />));
    const actions = await screen.findByRole("region", {
      name: "File review actions",
    });
    expect(
      within(actions).getByText(/not supported for this file profile/),
    ).toBeTruthy();
    expect(
      (
        within(actions).getByRole("button", {
          name: "Confirm",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        within(actions).getByRole("button", {
          name: "Confirm and next",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await waitFor(() =>
      expect(
        (
          within(actions).getByRole("button", {
            name: "Skip",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );

    fireEvent.click(within(actions).getByRole("button", { name: "Skip" }));
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        href: `/imports/files/${nextArtifactId}`,
      }),
    );
    expect(mocks.previewBankCsv).not.toHaveBeenCalled();
    expect(mocks.confirmBankImport).not.toHaveBeenCalled();
    expect(mocks.importStripeCsv).not.toHaveBeenCalled();
  });
});
