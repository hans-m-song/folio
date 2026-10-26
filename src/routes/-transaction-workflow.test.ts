// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import type { TransactionRecord } from "../domain/types";

const operations = vi.hoisted(() => ({
  getFolioUiConfig: vi.fn(),
  getProposedDraftEvidence: vi.fn(),
  discardProposedDraftEvidence: vi.fn(),
  getTransaction: vi.fn(),
  listArtifacts: vi.fn(),
  listAvailableInvoiceArtifacts: vi.fn(),
  listTransactionFormOptions: vi.fn(),
  confirmArtifactUpload: vi.fn(),
  approveArtifact: vi.fn(),
  previewArtifactForReview: vi.fn(),
  findArtifactFilenameMatches: vi.fn(),
  importStripeCsv: vi.fn(),
  previewStripeCsv: vi.fn(),
  getCsvDuplicateWarnings: vi.fn(),
  rejectArtifact: vi.fn(),
  saveManualTransaction: vi.fn(),
  startArtifactUpload: vi.fn(),
  voidTransaction: vi.fn(),
  deleteDraftTransaction: vi.fn(),
}));

const sessionMock = vi.hoisted(() => vi.fn());
const manualFormProbe = vi.hoisted(() => ({ props: vi.fn() }));
const routerMocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  navigate: vi.fn(),
}));
const contextPane = vi.hoisted(() => ({
  api: null as unknown,
  guard: vi.fn(),
}));

const stripePreviewResult = (overrides: Record<string, unknown> = {}) => ({
  artifactId: "44444444-4444-4444-8444-444444444444",
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
      reference: "txn_1",
      occurredAt: "2026-09-01T00:00:00.000Z",
      availableAt: "2026-09-03T00:00:00.000Z",
      sourceCurrency: "AUD",
      sourceGross: "10.0000",
      sourceFee: "0.3000",
      sourceNet: "9.7000",
      reportingCategory: "charge",
      kind: "sale",
      mappingWarning: null,
      importStatus: "will_import",
    },
  ],
  ...overrides,
});

const addStripeFiles = (files: File[], uploadFirst = false) => {
  const input = screen.getByLabelText("Stripe itemised CSV");
  fireEvent.change(input, { target: { files } });
  fireEvent.submit(input.closest("form")!);
  if (uploadFirst)
    fireEvent.click(
      screen.getByRole("button", {
        name: `Upload and preview ${files[0]!.name}`,
      }),
    );
};

const uploadHeadersFor = (
  artifactId: string,
  mediaType = "text/csv",
  checksumSha256 = "synthetic-checksum",
) => ({
  "Content-Type": mediaType,
  "x-amz-checksum-sha256": checksumSha256,
  "x-amz-meta-folio-artifact-id": artifactId,
  "If-None-Match": "*",
});

vi.mock("../auth/session-server", () => ({
  getCurrentSession: sessionMock,
}));

vi.mock("../components/context-pane", () => ({
  useContextPane: () => contextPane.api,
  usePaneGuard: contextPane.guard,
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => routerMocks,
}));

vi.mock("../components/manual-transaction-form", () => ({
  ManualTransactionForm: (props: {
    onSubmit: (value: unknown) => void;
    busy: boolean;
    [name: string]: unknown;
  }) => {
    manualFormProbe.props(props);
    return createElement(
      "form",
      { className: "manual-entry-form" },
      props.evidenceStatus as ReactNode,
      createElement(
        "div",
        { className: "actions wide" },
        createElement(
          "button",
          {
            type: "button",
            disabled: props.busy,
            onClick: () =>
              void props.onSubmit({
                action: "save_recorded",
                transaction: { ownerId: "actor" },
                artifactIds: [],
                file: null,
              }),
          },
          "Save manual transaction",
        ),
      ),
    );
  },
}));

vi.mock("../server/operations", () => ({
  ...operations,
  confirmArtifactUpload: operations.confirmArtifactUpload,
  approveArtifact: operations.approveArtifact,
  previewArtifactForReview: operations.previewArtifactForReview,
  importStripeCsv: operations.importStripeCsv,
  previewStripeCsv: operations.previewStripeCsv,
  rejectArtifact: operations.rejectArtifact,
  saveManualTransaction: operations.saveManualTransaction,
  startArtifactUpload: operations.startArtifactUpload,
  voidTransaction: operations.voidTransaction,
  deleteDraftTransaction: operations.deleteDraftTransaction,
}));

vi.mock("../server/bank-operations", () => ({
  getCsvDuplicateWarnings: operations.getCsvDuplicateWarnings,
}));

import {
  loadManualTransactionRouteData,
  ManualTransactionRoute,
  StripeImportRoute,
  voidTransactionConfirmation,
  deleteDraftConfirmation,
  safeTransactionWorkflowError,
} from "./-transaction-workflow";

it("retains actionable matched-edit guidance with its diagnostic reference", () => {
  const message =
    "Keep the recorded AUD amount/direction, or unmatch the bank row before changing it. Code BANK_MATCH_EDIT_CONFLICT. Reference 00000000-0000-4000-8000-000000000000.";
  expect(safeTransactionWorkflowError(new Error(message), "Save failed")).toBe(
    message,
  );
});

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
  contextPane.api = null;
  contextPane.guard.mockReset();
  manualFormProbe.props.mockReset();
  sessionMock.mockResolvedValue({
    authenticated: true,
    user: { id: "actor" },
  });
  routerMocks.invalidate.mockResolvedValue(undefined);
  routerMocks.navigate.mockResolvedValue(undefined);
  operations.listTransactionFormOptions.mockResolvedValue({
    users: [],
    entrySuggestions: {
      counterparties: [],
      categories: [],
      supplierCategories: [],
    },
  });
  operations.getFolioUiConfig.mockResolvedValue({
    gstRegistered: false,
    reportingTimezone: "Australia/Brisbane",
  });
  operations.getProposedDraftEvidence.mockResolvedValue(null);
  operations.discardProposedDraftEvidence.mockResolvedValue(null);
  operations.listAvailableInvoiceArtifacts.mockResolvedValue([]);
  operations.listArtifacts.mockResolvedValue({ total: 0, rows: [] });
  operations.startArtifactUpload.mockImplementation(async ({ data }) => ({
    artifact: { id: "44444444-4444-4444-8444-444444444444" },
    uploadUrl: "https://uploads.example.test/stripe.csv",
    uploadHeaders: uploadHeadersFor(
      "44444444-4444-4444-8444-444444444444",
      data.mediaType,
      data.checksumSha256,
    ),
  }));
  operations.findArtifactFilenameMatches.mockResolvedValue([]);
  operations.confirmArtifactUpload.mockResolvedValue({});
  operations.approveArtifact.mockResolvedValue({});
  operations.previewArtifactForReview.mockResolvedValue(
    "https://uploads.example.test/review.pdf",
  );
  operations.voidTransaction.mockResolvedValue(undefined);
  operations.deleteDraftTransaction.mockResolvedValue(undefined);
  operations.importStripeCsv.mockResolvedValue(1);
  operations.previewStripeCsv.mockResolvedValue(stripePreviewResult());
  operations.getCsvDuplicateWarnings.mockResolvedValue({
    artifactId: "44444444-4444-4444-8444-444444444444",
    profile: "stripe_balance_itemised_csv_v1",
    rowCount: 1,
    rowIdentityLimitReached: false,
    warnings: [],
  });
  operations.rejectArtifact.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  vi.stubGlobal("crypto", {
    subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)) },
  });
  if (
    !(File.prototype as File & { arrayBuffer?: () => Promise<ArrayBuffer> })
      .arrayBuffer
  )
    Object.defineProperty(File.prototype, "arrayBuffer", {
      configurable: true,
      value: vi.fn().mockResolvedValue(new TextEncoder().encode("csv").buffer),
    });
});

afterEach(() => cleanup());

describe("manual transaction route data", () => {
  it("shares form option loading without fetching a record for create", async () => {
    const data = await loadManualTransactionRouteData();

    expect(data.transaction).toBeNull();
    expect(operations.getTransaction).not.toHaveBeenCalled();
    expect(operations.listTransactionFormOptions).toHaveBeenCalledOnce();
    expect(operations.getFolioUiConfig).toHaveBeenCalledOnce();
    expect(operations.listAvailableInvoiceArtifacts).toHaveBeenCalledOnce();
  });

  it("loads the URL transaction directly for edit", async () => {
    const transaction = { id: "11111111-1111-4111-8111-111111111111" };
    operations.getTransaction.mockResolvedValue(transaction);

    const data = await loadManualTransactionRouteData(transaction.id);

    expect(data.transaction).toBe(transaction);
    expect(operations.getTransaction).toHaveBeenCalledWith({
      data: { id: transaction.id },
    });
  });

  it("stops before protected data calls when signed out", async () => {
    sessionMock.mockResolvedValue({ authenticated: false });

    const data = await loadManualTransactionRouteData();

    expect(data.session.authenticated).toBe(false);
    expect(operations.listTransactionFormOptions).not.toHaveBeenCalled();
    expect(operations.getFolioUiConfig).not.toHaveBeenCalled();
    expect(operations.listAvailableInvoiceArtifacts).not.toHaveBeenCalled();
    expect(operations.getTransaction).not.toHaveBeenCalled();
  });
});

describe("transaction workflow route safety", () => {
  const routeData = (
    supplierCategories: { counterparty: string; category: string }[] = [],
  ) => ({
    session: {
      authenticated: true as const,
      user: { id: "actor" } as never,
    },
    formOptions: {
      users: [],
      entrySuggestions: {
        counterparties: [],
        categories: [],
        supplierCategories,
      },
    },
    uiConfig: {
      gstRegistered: false,
      reportingTimezone: "Australia/Brisbane",
    },
    availableArtifacts: [],
    transaction: null,
    proposedDraftEvidence: null,
  });
  const proposedEvidenceFixture = (
    transactionId: string,
    artifactId: string,
    state: "awaiting_review" | "available" | "rejected" = "awaiting_review",
    overrides: { discardedAt?: string | null; filename?: string } = {},
  ) => ({
    submissionId: "55555555-5555-4555-8555-555555555555",
    transactionId,
    artifactId,
    filename: overrides.filename ?? "synthetic-invoice.pdf",
    state,
    note: null,
    discardedAt: overrides.discardedAt ?? null,
  });
  const routeDataWithProposal = (
    proposedDraftEvidence: ReturnType<typeof proposedEvidenceFixture>,
    transactionOverrides: Partial<TransactionRecord> = {},
  ) => ({
    ...routeData(),
    transaction: {
      id: proposedDraftEvidence.transactionId,
      status: "draft",
      sourceSystem: "manual",
      sourceArtifacts: [],
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
      ...transactionOverrides,
    } as unknown as TransactionRecord,
    proposedDraftEvidence,
  });

  it("uses accurate headings and embedded containers for transaction panes", () => {
    const createView = render(
      createElement(ManualTransactionRoute, {
        data: routeData(),
        mode: "create",
        returnTo: "/transactions/new",
        embedded: true,
      }),
    );
    expect(
      screen.getByRole("heading", { name: "New manual transaction" }),
    ).toBeTruthy();
    expect(createView.container.querySelector("main")).toBeNull();
    createView.unmount();

    const transaction = {
      id: "11111111-1111-4111-8111-111111111111",
      status: "draft",
      sourceSystem: "manual",
      sourceArtifacts: [],
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    const editView = render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction },
        mode: "edit",
        returnTo: `/transactions/${transaction.id}/edit`,
        embedded: true,
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Edit draft transaction" }),
    ).toBeTruthy();
    expect(editView.container.querySelector("main")).toBeNull();
  });

  it("warns that restoring a voided transaction is not guaranteed", () => {
    expect(voidTransactionConfirmation("INV-1", "transaction-1")).toBe(
      "Voiding transaction INV-1 may not be reversible. Verify the record before continuing.",
    );
  });

  it("guards dirty and pending pane workflows", async () => {
    contextPane.api = {
      open: vi.fn(),
      close: vi.fn(),
      active: true,
      clearGuard: vi.fn(),
    };
    const transaction = {
      id: "11111111-1111-4111-8111-111111111111",
      reference: "INV-1",
      updatedAt: "2026-09-01T00:00:00.000Z",
      status: "draft",
      sourceSystem: "manual",
      sourceArtifacts: [],
      ownerId: null,
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction },
        mode: "edit",
        returnTo: `/transactions/${transaction.id}/edit`,
        embedded: true,
      }),
    );

    const formProps = manualFormProbe.props.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    act(() => (formProps.onDirtyChange as (dirty: boolean) => void)(true));
    await waitFor(() =>
      expect(contextPane.guard).toHaveBeenLastCalledWith({
        dirty: true,
        pending: false,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    await waitFor(() =>
      expect(contextPane.guard).toHaveBeenLastCalledWith({
        dirty: true,
        pending: true,
      }),
    );
    fireEvent.click(
      within(
        screen.getByRole("alertdialog", { name: "Delete draft?" }),
      ).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() =>
      expect(contextPane.guard).toHaveBeenLastCalledWith({
        dirty: true,
        pending: false,
      }),
    );

    let resolveSave: ((result: unknown) => void) | undefined;
    operations.saveManualTransaction.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save manual transaction" }),
    );
    await waitFor(() =>
      expect(contextPane.guard).toHaveBeenLastCalledWith({
        dirty: true,
        pending: true,
      }),
    );
    act(() => resolveSave?.({ status: "invalid", issues: [] }));
    await waitFor(() =>
      expect(contextPane.guard).toHaveBeenLastCalledWith({
        dirty: true,
        pending: false,
      }),
    );
  });

  it("prefills an approved library invoice without uploading or saving automatically", () => {
    render(
      createElement(ManualTransactionRoute, {
        data: routeData(),
        mode: "create",
        returnTo: "/transactions/new",
        initialArtifact: {
          id: "11111111-1111-4111-8111-111111111111",
          filename: "Chosen invoice.pdf",
          originalFilename:
            "Northstar-Renovations--2026-09-20--INV-ORIGINAL.pdf",
          supplier: "ReviewedSupplier",
          documentDate: "2026-09-21",
          reference: "INV-PERSISTED",
          notes: "Reviewed source",
        },
      }),
    );
    const props = manualFormProbe.props.mock.lastCall?.[0];
    expect(props).toMatchObject({
      attachedArtifactId: "11111111-1111-4111-8111-111111111111",
      attachedArtifactIds: ["11111111-1111-4111-8111-111111111111"],
      fileUploadHref: "/imports/upload?profile=manual_invoice_pdf_v1",
      transaction: {
        counterparty: "ReviewedSupplier",
        invoiceDate: "2026-09-21",
        reference: "INV-PERSISTED",
        notes: "Reviewed source",
      },
    });
    expect(
      screen.getByRole("region", { name: "Invoice PDF preview" }),
    ).toBeTruthy();
    expect(screen.getByText("Chosen invoice.pdf")).toBeTruthy();
    expect(operations.startArtifactUpload).not.toHaveBeenCalled();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
  });

  it("uses the original filename for transaction defaults when metadata is absent", () => {
    render(
      createElement(ManualTransactionRoute, {
        data: routeData(),
        mode: "create",
        returnTo: "/transactions/new",
        initialArtifact: {
          id: "11111111-1111-4111-8111-111111111111",
          filename: "Renamed.pdf",
          originalFilename: "Northstar-Repairs-2026-09-20-INV-42.pdf",
        },
      }),
    );

    expect(manualFormProbe.props.mock.lastCall?.[0].transaction).toMatchObject({
      counterparty: "Northstar-Repairs",
      invoiceDate: "2026-09-20",
      reference: "INV-42",
    });
  });

  it("previews the first selected library PDF and switches or clears the preview", async () => {
    const firstArtifactId = "22222222-2222-4222-8222-222222222222";
    const secondArtifactId = "33333333-3333-4333-8333-333333333333";
    const previewUrl = "https://uploads.example.test/selected.pdf";
    operations.previewArtifactForReview.mockResolvedValue(previewUrl);
    render(
      createElement(ManualTransactionRoute, {
        data: {
          ...routeData(),
          availableArtifacts: [
            { id: firstArtifactId, filename: "First.pdf" },
            { id: secondArtifactId, filename: "Second.pdf" },
          ] as never,
        },
        mode: "create",
        returnTo: "/transactions/new",
      }),
    );

    const getSelectionChange = () =>
      manualFormProbe.props.mock.lastCall?.[0].onSelectedArtifactsChange as (
        artifactIds: readonly string[],
      ) => void;

    act(() => getSelectionChange()([firstArtifactId, secondArtifactId]));
    await waitFor(() =>
      expect(operations.previewArtifactForReview).toHaveBeenCalledWith({
        data: { id: firstArtifactId },
      }),
    );
    const firstFrame = await screen.findByTitle("PDF preview: First.pdf");
    expect(firstFrame.getAttribute("src")).toBe(`${previewUrl}#view=FitH`);
    const previewLayout = firstFrame.closest(
      ".transaction-form-preview-layout",
    );
    expect(previewLayout).not.toBeNull();
    expect(
      previewLayout?.classList.contains("transaction-form-preview-layout"),
    ).toBe(true);
    expect(
      previewLayout?.classList.contains(
        "transaction-form-preview-layout--with-preview",
      ),
    ).toBe(true);
    expect(
      previewLayout?.classList.contains(
        "transaction-form-preview-layout--peek",
      ),
    ).toBe(false);
    expect(
      firstFrame.parentElement?.classList.contains(
        "transaction-pdf-preview--peek",
      ),
    ).toBe(false);

    act(() => getSelectionChange()([secondArtifactId]));
    await waitFor(() =>
      expect(operations.previewArtifactForReview).toHaveBeenLastCalledWith({
        data: { id: secondArtifactId },
      }),
    );
    const secondFrame = await screen.findByTitle("PDF preview: Second.pdf");
    expect(secondFrame.getAttribute("src")).toBe(`${previewUrl}#view=FitH`);

    act(() => getSelectionChange()([]));
    expect(
      screen.queryByRole("region", { name: "Invoice PDF preview" }),
    ).toBeNull();
    const layout = document.querySelector(".transaction-form-preview-layout");
    expect(layout).not.toBeNull();
    expect(layout?.classList.contains("transaction-form-preview-layout")).toBe(
      true,
    );
    expect(
      layout?.classList.contains(
        "transaction-form-preview-layout--with-preview",
      ),
    ).toBe(false);
    expect(operations.startArtifactUpload).not.toHaveBeenCalled();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
  });

  it("previews selected attached PDFs above the edit form with the compact viewer", async () => {
    const transactionId = "11111111-1111-4111-8111-111111111111";
    const firstArtifactId = "22222222-2222-4222-8222-222222222222";
    const secondArtifactId = "33333333-3333-4333-8333-333333333333";
    const previewUrl =
      "https://uploads.example.test/attached.pdf?signature=synthetic#page=2&zoom=125";
    operations.previewArtifactForReview.mockResolvedValue(previewUrl);
    const transaction = {
      id: transactionId,
      status: "draft",
      sourceSystem: "manual",
      sourceArtifacts: [
        { id: firstArtifactId, filename: "First attached.pdf" },
        { id: secondArtifactId, filename: "Second attached.pdf" },
      ],
      sourceArtifactId: firstArtifactId,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    const { container } = render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction },
        mode: "edit",
        returnTo: `/transactions/${transactionId}/edit`,
      }),
    );

    const selectionChange = () =>
      manualFormProbe.props.mock.lastCall?.[0].onSelectedArtifactsChange as (
        artifactIds: readonly string[],
      ) => void;
    const formNode = container.querySelector(".manual-entry-form");
    expect(
      manualFormProbe.props.mock.lastCall?.[0].attachedArtifactIds,
    ).toEqual([firstArtifactId, secondArtifactId]);

    const firstFrame = await screen.findByTitle(
      "PDF preview: First attached.pdf",
    );
    expect(firstFrame.getAttribute("src")).toBe(
      `${previewUrl}&view=FitH&toolbar=0`,
    );
    expect(
      firstFrame.parentElement?.classList.contains(
        "transaction-pdf-preview--peek",
      ),
    ).toBe(true);
    expect(
      firstFrame
        .closest(".transaction-form-preview-layout")
        ?.classList.contains("transaction-form-preview-layout--peek"),
    ).toBe(true);

    act(() => selectionChange()([secondArtifactId]));
    const secondFrame = await screen.findByTitle(
      "PDF preview: Second attached.pdf",
    );
    expect(secondFrame.getAttribute("src")).toBe(
      `${previewUrl}&view=FitH&toolbar=0`,
    );
    expect(operations.previewArtifactForReview).toHaveBeenLastCalledWith({
      data: { id: secondArtifactId },
    });

    act(() => selectionChange()([]));
    expect(
      screen.queryByRole("region", { name: "Invoice PDF preview" }),
    ).toBeNull();
    expect(container.querySelector(".manual-entry-form")).toBe(formNode);
    expect(screen.getByText(/Status: already attached/)).toBeTruthy();
    expect(operations.approveArtifact).not.toHaveBeenCalled();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
  });

  it("explains that draft deletion is permanent but leaves uploads intact", () => {
    expect(deleteDraftConfirmation("INV-1", "transaction-1")).toBe(
      "Permanently delete draft INV-1 and its suggestion? This cannot be undone. Uploaded files will remain in the file library.",
    );
  });

  it("renders save feedback outside the form action controls", async () => {
    operations.saveManualTransaction.mockRejectedValueOnce(
      new Error("Transaction changed after it was loaded."),
    );
    const data = routeData([
      { counterparty: "Acme Supplies", category: "Office and stationery" },
    ]);
    render(
      createElement(ManualTransactionRoute, {
        data,
        mode: "create",
        returnTo: "/transactions/new",
      }),
    );

    const initialProps = manualFormProbe.props.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(initialProps.autoDefaultTaxTreatment).toBe(true);
    expect(initialProps.supplierCategories).toEqual([
      { counterparty: "Acme Supplies", category: "Office and stationery" },
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Save manual transaction" }),
    );
    await waitFor(() => {
      const latestProps = manualFormProbe.props.mock.calls.at(
        -1,
      )?.[0] as Record<string, unknown>;
      expect(latestProps.submissionStatus).toBeUndefined();
      expect(latestProps.submissionError).toBeUndefined();
      const alert = screen.getByRole("alert");
      const saveButton = screen.getByRole("button", {
        name: "Save manual transaction",
      });
      const form = saveButton.closest(".manual-entry-form");
      expect(alert.textContent).toBe(
        "Transaction changed after it was loaded. Transaction was not saved. Retry save when ready.",
      );
      expect(alert.getAttribute("aria-live")).toBe("assertive");
      expect(alert.previousElementSibling).toBe(form?.parentElement);
      expect(form?.parentElement?.firstElementChild).toBe(form);
      expect(form?.lastElementChild?.classList.contains("actions")).toBe(true);
      expect(form?.querySelector(".actions.wide")?.contains(saveButton)).toBe(
        true,
      );
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("alert")),
    );
  });

  it("opens a focused void confirmation and closes it on Escape without voiding", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const transaction = {
      id,
      reference: "INV-1",
      updatedAt: "2026-09-01T00:00:00.000Z",
      status: "recorded",
      sourceSystem: "manual",
      sourceArtifacts: [],
      ownerId: null,
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    contextPane.api = {
      open: vi.fn(),
      close: vi.fn(),
      active: true,
      clearGuard: vi.fn(),
    };
    render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
      }),
    );
    const formProps = manualFormProbe.props.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(formProps.autoDefaultTaxTreatment).toBe(false);
    const voidButton = screen.getByRole("button", { name: "Void transaction" });
    expect(voidButton.classList.contains("danger")).toBe(true);
    const returnLink = screen.getByRole("link", { name: "← Transactions" });
    expect(
      returnLink.classList.contains("transaction-button-link") &&
        returnLink.classList.contains("transaction-button-link--secondary"),
    ).toBe(true);
    voidButton.focus();
    fireEvent.click(voidButton);

    const dialog = screen.getByRole("alertdialog", {
      name: "Void transaction?",
    });
    await waitFor(() =>
      expect(contextPane.guard).toHaveBeenLastCalledWith({
        dirty: false,
        pending: true,
      }),
    );
    expect(screen.getByText(/may not be reversible/)).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() =>
      expect(contextPane.guard).toHaveBeenLastCalledWith({
        dirty: false,
        pending: false,
      }),
    );
    expect(document.activeElement).toBe(voidButton);
    expect(operations.voidTransaction).not.toHaveBeenCalled();
  });

  it("keeps the guarded void flow available in a recorded transaction pane", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const transaction = {
      id,
      reference: "INV-1",
      updatedAt: "2026-09-01T00:00:00.000Z",
      status: "recorded",
      sourceSystem: "manual",
      sourceArtifacts: [],
      ownerId: null,
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    contextPane.api = {
      open: vi.fn(),
      close: vi.fn(),
      active: true,
      clearGuard: vi.fn(),
    };
    let resolveVoid: (() => void) | undefined;
    operations.voidTransaction.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveVoid = resolve;
      }),
    );
    render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
        embedded: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Void transaction" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Void transaction?",
    });
    await waitFor(() =>
      expect(contextPane.guard).toHaveBeenLastCalledWith({
        dirty: false,
        pending: true,
      }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Void transaction" }),
    );
    await waitFor(() =>
      expect(operations.voidTransaction).toHaveBeenCalledOnce(),
    );
    expect(contextPane.guard).toHaveBeenLastCalledWith({
      dirty: false,
      pending: true,
    });

    await act(async () => resolveVoid?.());
    await waitFor(() =>
      expect(contextPane.guard).toHaveBeenLastCalledWith({
        dirty: false,
        pending: false,
      }),
    );
    expect(screen.getByText(/Transaction voided\./)).toBeTruthy();
  });

  it("keeps edit completion feedback and its return action outside the form", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const transaction = {
      id,
      reference: "INV-1",
      updatedAt: "2026-09-01T00:00:00.000Z",
      status: "recorded",
      sourceSystem: "manual",
      sourceArtifacts: [],
      ownerId: null,
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    operations.saveManualTransaction.mockResolvedValue({
      status: "saved",
      transaction: { id },
    });
    render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save manual transaction" }),
    );

    expect(
      await screen.findByText(
        /Transaction saved. Return to the transaction list/,
      ),
    ).toBeTruthy();
    const returnLink = await screen.findByRole("link", {
      name: "Return to Transactions",
    });
    expect(
      returnLink.classList.contains("transaction-button-link") &&
        returnLink.classList.contains("transaction-button-link--secondary"),
    ).toBe(true);
    expect(returnLink.closest(".manual-entry-form")).toBeNull();
  });

  it("returns a reviewed draft to its selected bank row without claiming a match", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const bankId = "22222222-2222-4222-8222-222222222222";
    operations.saveManualTransaction.mockResolvedValue({
      status: "saved",
      transaction: { id },
    });
    render(
      createElement(ManualTransactionRoute, {
        data: {
          ...routeData(),
          transaction: {
            id,
            status: "draft",
            sourceSystem: "manual",
            sourceArtifacts: [],
            sourceArtifactId: null,
            kind: "supplier_expense",
            documentCurrency: "AUD",
          } as unknown as TransactionRecord,
        },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
        reviewReturnTo: `/banking/reconcile?bank=${bankId}`,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save manual transaction" }),
    );
    expect(await screen.findByText(/Recording did not match it/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Return to Reconcile" })
        .getAttribute("href"),
    ).toBe(`/banking/reconcile?bank=${bankId}`);
  });

  it("keeps a void failure in the confirmation dialog for retry", async () => {
    const transaction = {
      id: "11111111-1111-4111-8111-111111111111",
      reference: "INV-1",
      updatedAt: "2026-09-01T00:00:00.000Z",
      status: "recorded",
      sourceSystem: "manual",
      sourceArtifacts: [],
      ownerId: null,
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    operations.voidTransaction.mockRejectedValueOnce(
      new Error("Transaction changed after it was loaded."),
    );
    render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction },
        mode: "edit",
        returnTo: `/transactions/${transaction.id}/edit`,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Void transaction" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Void transaction?",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Void transaction" }),
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Transaction changed after it was loaded.",
    );
    expect(
      screen.getByRole("alertdialog", { name: "Void transaction?" }),
    ).toBeTruthy();
    expect(operations.voidTransaction).toHaveBeenCalledWith({
      data: {
        id: transaction.id,
        expectedUpdatedAt: transaction.updatedAt,
      },
    });
  });

  it("deletes a draft only after confirmation and notifies its embedded editor", async () => {
    const transaction = {
      id: "11111111-1111-4111-8111-111111111111",
      reference: "INV-1",
      updatedAt: "2026-09-01T00:00:00.000Z",
      status: "draft",
      sourceSystem: "manual",
      sourceArtifacts: [],
      ownerId: null,
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    const events: string[] = [];
    routerMocks.invalidate.mockRejectedValueOnce(new Error("refresh failed"));
    contextPane.api = {
      open: vi.fn(),
      close: vi.fn(),
      active: true,
      clearGuard: () => events.push("clear"),
    };
    const onDeleted = vi.fn(() => events.push("deleted"));
    render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction },
        mode: "edit",
        returnTo: `/transactions/${transaction.id}/edit`,
        embedded: true,
        onDeleted,
      }),
    );

    const formProps = manualFormProbe.props.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    act(() => (formProps.onDirtyChange as (dirty: boolean) => void)(true));
    await waitFor(() =>
      expect(contextPane.guard).toHaveBeenLastCalledWith({
        dirty: true,
        pending: false,
      }),
    );

    expect(
      screen.queryByRole("button", { name: "Void transaction" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    expect(operations.deleteDraftTransaction).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", { name: "Delete draft?" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete draft" }),
    );

    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(screen.getByRole("heading", { name: "Draft deleted" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete draft" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Save manual transaction" }),
    ).toBeNull();
    await waitFor(() =>
      expect(contextPane.guard).toHaveBeenLastCalledWith({
        dirty: false,
        pending: false,
      }),
    );
    expect(events).toEqual(["clear", "deleted"]);
    expect(operations.deleteDraftTransaction).toHaveBeenCalledWith({
      data: { id: transaction.id, expectedUpdatedAt: transaction.updatedAt },
    });
    expect(operations.voidTransaction).not.toHaveBeenCalled();
  });

  it("does not render the Stripe upload form when signed out", () => {
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: false },
      }),
    );

    expect(screen.queryByLabelText("Stripe itemised CSV")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Sign in required" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("/auth/login?return_to=%2Fimports%2Fstripe");
  });

  it("warns about an existing Stripe filename without preventing upload", async () => {
    operations.findArtifactFilenameMatches.mockResolvedValue([2]);
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    addStripeFiles([new File(["csv"], "stripe.csv", { type: "text/csv" })]);

    expect(
      await screen.findByText("2 existing artifacts match this filename."),
    ).toBeTruthy();
    expect(operations.findArtifactFilenameMatches).toHaveBeenCalledWith({
      data: {
        profile: "stripe_balance_itemised_csv_v1",
        filenames: ["stripe.csv"],
      },
    });
    const uploadButton = screen.getByRole("button", {
      name: "Upload and preview stripe.csv",
    }) as HTMLButtonElement;
    expect(uploadButton.disabled).toBe(false);
    fireEvent.click(uploadButton);

    await screen.findByRole("heading", { name: "Review stripe.csv" });
    expect(operations.startArtifactUpload).toHaveBeenCalledOnce();
  });

  it("confirms a preexisting matching Stripe CSV after a 412 without SubtleCrypto", async () => {
    const checksumSha256 = "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=";
    const artifactId = "44444444-4444-4444-8444-444444444444";
    const uploadUrl = "https://uploads.example.test/stripe.csv";
    const file = new File(["abc"], "stripe.csv", { type: "text/csv" });
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: async () => new Uint8Array([97, 98, 99]).buffer,
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 412 });
    vi.stubGlobal("crypto", {});
    vi.stubGlobal("fetch", fetchMock);
    expect(crypto.subtle).toBeUndefined();
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );

    addStripeFiles([file], true);

    await screen.findByRole("heading", { name: "Review stripe.csv" });
    expect(operations.startArtifactUpload).toHaveBeenCalledWith({
      data: {
        ownerId: null,
        artifactProfile: "stripe_balance_itemised_csv_v1",
        filename: "stripe.csv",
        mediaType: "text/csv",
        byteSize: 3,
        checksumSha256,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      uploadUrl,
      expect.objectContaining({
        method: "PUT",
        body: file,
        headers: expect.objectContaining({
          "Content-Type": "text/csv",
          "x-amz-checksum-sha256": checksumSha256,
          "x-amz-meta-folio-artifact-id": artifactId,
          "If-None-Match": "*",
        }),
      }),
    );
    expect(operations.confirmArtifactUpload).toHaveBeenCalledWith({
      data: { id: artifactId },
    });
    expect(operations.previewStripeCsv).toHaveBeenCalledWith({
      data: { artifactId, page: 1 },
    });
    expect(screen.getByText("txn_1")).toBeTruthy();
  });

  it("previews before admission and closing the preview creates no transactions", async () => {
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    addStripeFiles(
      [new File(["csv"], "stripe.csv", { type: "text/csv" })],
      true,
    );

    await screen.findByRole("heading", { name: "Review stripe.csv" });
    expect(screen.getByText(/1 rows: 1 new/)).toBeTruthy();
    expect(operations.previewStripeCsv).toHaveBeenCalledOnce();
    expect(operations.importStripeCsv).not.toHaveBeenCalled();

    const grossHeader = screen.getByRole("columnheader", { name: "Gross" });
    const table = grossHeader.closest("table")!;
    expect(grossHeader.classList.contains("money-column")).toBe(true);
    expect(
      screen
        .getByRole("columnheader", { name: "Fee" })
        .classList.contains("money-column"),
    ).toBe(true);
    expect(
      screen
        .getByRole("columnheader", { name: "Net" })
        .classList.contains("money-column"),
    ).toBe(true);

    const row = within(table).getAllByRole("row")[1]!;
    const cells = within(row).getAllByRole("cell");
    for (const [index, amount] of ["10.0000", "0.3000", "9.7000"].entries()) {
      const cell = cells[index + 4]!;
      expect(cell.classList.contains("money-column")).toBe(true);
      expect(cell.querySelector("[data-money-value]")?.textContent).toBe(
        amount,
      );
    }

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.getByText(/No import was started/)).toBeTruthy();
    expect(screen.getByLabelText("Stripe itemised CSV")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Review preview for stripe.csv" }),
    ).toBeTruthy();
    expect(operations.importStripeCsv).not.toHaveBeenCalled();
  });

  it("shows non-blocking duplicate CSV warnings after validation", async () => {
    operations.getCsvDuplicateWarnings.mockResolvedValue({
      artifactId: "44444444-4444-4444-8444-444444444444",
      profile: "stripe_balance_itemised_csv_v1",
      rowCount: 1,
      rowIdentityLimitReached: false,
      warnings: [
        {
          reason: "same_checksum",
          totalArtifactCount: 1,
          truncated: false,
          matches: [
            {
              artifactId: "55555555-5555-4555-8555-555555555555",
              filename: "prior.csv",
              matchingRowCount: null,
            },
          ],
        },
      ],
    });
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    addStripeFiles(
      [new File(["csv"], "stripe.csv", { type: "text/csv" })],
      true,
    );

    expect(await screen.findByText("Possible duplicate source")).toBeTruthy();
    expect(screen.getByText(/prior\.csv/)).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Review stripe.csv" }),
    ).toBeTruthy();
  });

  it("allows Stripe review when duplicate analysis is unavailable", async () => {
    operations.getCsvDuplicateWarnings.mockRejectedValue(
      new Error("unavailable"),
    );
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    addStripeFiles(
      [new File(["csv"], "stripe.csv", { type: "text/csv" })],
      true,
    );

    expect(
      await screen.findByText(
        "Could not check duplicate CSV content; review remains possible.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Review stripe.csv" }),
    ).toBeTruthy();
  });

  it("loads every preview page from the confirmed artifact", async () => {
    operations.previewStripeCsv
      .mockResolvedValueOnce(
        stripePreviewResult({
          totalCount: 201,
          displayedCount: 200,
          totalPages: 2,
        }),
      )
      .mockResolvedValueOnce(
        stripePreviewResult({
          totalCount: 201,
          page: 2,
          totalPages: 2,
          rows: [
            {
              ...stripePreviewResult().rows[0],
              reference: "txn_201",
              importStatus: "conflict",
            },
          ],
          willImportCount: 200,
          conflictCount: 1,
        }),
      );
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    addStripeFiles(
      [new File(["csv"], "stripe.csv", { type: "text/csv" })],
      true,
    );
    await screen.findByText(/Page 1 of 2/);

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText(/Page 2 of 2/);
    expect(screen.getByText("txn_201")).toBeTruthy();
    expect(operations.previewStripeCsv).toHaveBeenLastCalledWith({
      data: {
        artifactId: "44444444-4444-4444-8444-444444444444",
        page: 2,
      },
    });
  });

  it("retries preview only after the artifact was confirmed", async () => {
    operations.previewStripeCsv
      .mockRejectedValueOnce(new Error("Preview temporarily unavailable"))
      .mockResolvedValueOnce(stripePreviewResult());
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    addStripeFiles(
      [new File(["csv"], "stripe.csv", { type: "text/csv" })],
      true,
    );

    const retry = await screen.findByRole("button", {
      name: "Retry preview stripe.csv",
    });
    expect(screen.getByText(/validated artifact awaits review/)).toBeTruthy();
    fireEvent.click(retry);
    await screen.findByRole("heading", { name: "Review stripe.csv" });
    expect(operations.previewStripeCsv).toHaveBeenCalledTimes(2);
  });

  it("does not promise an archived retry when upload never confirms", async () => {
    operations.startArtifactUpload.mockRejectedValueOnce(
      new Error("Upload service unavailable"),
    );
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    addStripeFiles(
      [new File(["csv"], "stripe.csv", { type: "text/csv" })],
      true,
    );

    expect(
      await screen.findByText(
        /artifact is not confirmed and cannot be previewed/,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Retry preview stripe.csv" }),
    ).toBeNull();
  });

  it("retries uncertain upload confirmation against the same artifact", async () => {
    operations.confirmArtifactUpload.mockRejectedValueOnce(
      new Error("Confirmation response unavailable"),
    );
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    addStripeFiles(
      [new File(["csv"], "stripe.csv", { type: "text/csv" })],
      true,
    );

    const retry = await screen.findByRole("button", {
      name: "Retry confirmation for stripe.csv",
    });
    expect(screen.getByText(/same uploaded artifact/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Retry preview stripe.csv" }),
    ).toBeNull();
    fireEvent.click(retry);
    await screen.findByRole("button", { name: "Add to batch" });
    expect(operations.startArtifactUpload).toHaveBeenCalledOnce();
    expect(operations.confirmArtifactUpload).toHaveBeenCalledTimes(2);
    expect(operations.confirmArtifactUpload).toHaveBeenLastCalledWith({
      data: { id: "44444444-4444-4444-8444-444444444444" },
    });
  });

  it("imports only after explicit confirmation", async () => {
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    addStripeFiles(
      [new File(["csv"], "stripe.csv", { type: "text/csv" })],
      true,
    );
    await screen.findByRole("button", { name: "Add to batch" });
    expect(operations.importStripeCsv).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Add to batch" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await screen.findAllByText(/Import complete/);
    expect(operations.importStripeCsv).toHaveBeenCalledWith({
      data: { artifactId: "44444444-4444-4444-8444-444444444444" },
    });
  });

  it("restores a validated Stripe CSV without restoring its batch selection", async () => {
    const artifactId = "77777777-7777-4777-8777-777777777777";
    operations.listArtifacts.mockResolvedValue({
      total: 1,
      rows: [
        {
          id: artifactId,
          filename: "saved.csv",
          byteSize: "1024",
          state: "awaiting_review",
        },
      ],
    });
    operations.previewStripeCsv.mockResolvedValue(
      stripePreviewResult({ artifactId }),
    );

    const first = render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Load preview for saved.csv" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Add to batch" }),
    );
    expect(screen.getByText("1 files added to batch")).toBeTruthy();
    first.unmount();

    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Load preview for saved.csv" }),
    ).toBeTruthy();
    expect(screen.getByText("0 files added to batch")).toBeTruthy();
    expect(operations.startArtifactUpload).not.toHaveBeenCalled();
    expect(operations.listArtifacts).toHaveBeenCalledWith({
      data: expect.objectContaining({
        profile: "stripe_balance_itemised_csv_v1",
        state: "awaiting_review",
      }),
    });
  });

  it("keeps an unsupported file visible and imports only the reviewed file", async () => {
    const validArtifactId = "55555555-5555-4555-8555-555555555555";
    operations.startArtifactUpload
      .mockResolvedValueOnce({
        artifact: { id: "44444444-4444-4444-8444-444444444444" },
        uploadUrl: "https://uploads.example.test/all-activity.csv",
        uploadHeaders: uploadHeadersFor("44444444-4444-4444-8444-444444444444"),
      })
      .mockResolvedValueOnce({
        artifact: { id: validArtifactId },
        uploadUrl: "https://uploads.example.test/balance.csv",
        uploadHeaders: uploadHeadersFor(validArtifactId),
      });
    operations.previewStripeCsv
      .mockRejectedValueOnce(
        new Error(
          "This is a Stripe All activity export. Folio requires the itemised Balance change from activity CSV from Reporting > Balance Summary Reports. Code STRIPE_CSV_INVALID.",
        ),
      )
      .mockResolvedValueOnce(
        stripePreviewResult({ artifactId: validArtifactId }),
      );
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    const input = screen.getByLabelText("Stripe itemised CSV");
    addStripeFiles([
      new File(["activity"], "all-activity.csv", { type: "text/csv" }),
      new File(["balance"], "balance.csv", { type: "text/csv" }),
    ]);

    expect(input.hasAttribute("multiple")).toBe(true);
    expect(screen.getByText("2 files in queue")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Upload and preview all-activity.csv",
      }),
    );
    expect(
      await screen.findByText(/Unsupported Stripe All activity export/),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Reject all-activity.csv" }),
    );
    expect(
      await screen.findByText(/Rejected — archived file remains visible/),
    ).toBeTruthy();
    expect(operations.rejectArtifact).toHaveBeenCalledWith({
      data: { id: "44444444-4444-4444-8444-444444444444" },
    });
    expect(
      screen.getByRole("link", { name: "View rejected artifacts" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Upload and preview balance.csv" }),
    ).toBeTruthy();
    expect(operations.importStripeCsv).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Upload and preview balance.csv" }),
    );
    await screen.findByRole("heading", { name: "Review balance.csv" });
    expect(
      screen.getByText(/Unsupported Stripe All activity export/),
    ).toBeTruthy();
    expect(operations.importStripeCsv).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add to batch" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await screen.findAllByText(/Import complete/);
    expect(operations.importStripeCsv).toHaveBeenCalledOnce();
    expect(operations.importStripeCsv).toHaveBeenCalledWith({
      data: { artifactId: validArtifactId },
    });
    expect(screen.getByText("2 files in queue")).toBeTruthy();
  });

  it("keeps a rejected accepted file visibly rejected after its preview goes stale", async () => {
    const artifactId = "44444444-4444-4444-8444-444444444444";
    operations.previewStripeCsv
      .mockResolvedValueOnce(stripePreviewResult({ artifactId }))
      .mockRejectedValueOnce(new Error("Preview temporarily unavailable"));
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    addStripeFiles(
      [new File(["csv"], "stripe.csv", { type: "text/csv" })],
      true,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Add to batch" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    expect(
      await screen.findAllByText(/Preview temporarily unavailable/),
    ).toHaveLength(2);
    expect(operations.importStripeCsv).not.toHaveBeenCalled();

    const batch = screen.getByRole("region", { name: "Accepted files" });
    expect(within(batch).getByText("Review needs refresh")).toBeTruthy();
    fireEvent.click(
      within(batch).getByRole("button", { name: "Reject stripe.csv" }),
    );

    expect(
      await screen.findByText("Rejected — archived file remains visible"),
    ).toBeTruthy();
    expect(screen.queryByText("Review needs refresh")).toBeNull();
    expect(operations.rejectArtifact).toHaveBeenCalledWith({
      data: { id: artifactId },
    });
    expect(operations.importStripeCsv).not.toHaveBeenCalled();
  });

  it("retries only the selected Stripe file after another file remains reviewable", async () => {
    const secondArtifactId = "55555555-5555-4555-8555-555555555555";
    const retryArtifactId = "66666666-6666-4666-8666-666666666666";
    operations.startArtifactUpload
      .mockRejectedValueOnce(new Error("Temporary upload unavailable"))
      .mockResolvedValueOnce({
        artifact: { id: secondArtifactId },
        uploadUrl: "https://uploads.example.test/second.csv",
        uploadHeaders: uploadHeadersFor(secondArtifactId),
      })
      .mockResolvedValueOnce({
        artifact: { id: retryArtifactId },
        uploadUrl: "https://uploads.example.test/first.csv",
        uploadHeaders: uploadHeadersFor(retryArtifactId),
      });
    operations.previewStripeCsv
      .mockResolvedValueOnce(
        stripePreviewResult({ artifactId: secondArtifactId }),
      )
      .mockResolvedValueOnce(
        stripePreviewResult({ artifactId: retryArtifactId }),
      );
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    addStripeFiles([
      new File(["first"], "first.csv", { type: "text/csv" }),
      new File(["second"], "second.csv", { type: "text/csv" }),
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Upload and preview first.csv" }),
    );
    expect(
      await screen.findByText(
        /artifact is not confirmed and cannot be previewed/,
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Upload and preview second.csv" }),
    );
    await screen.findByRole("heading", { name: "Review second.csv" });
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(
      screen.getByRole("button", { name: "Review preview for second.csv" }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Retry upload first.csv" }),
    );
    await screen.findByRole("heading", { name: "Review first.csv" });
    expect(
      operations.startArtifactUpload.mock.calls.map(
        ([request]) => request.data.filename,
      ),
    ).toEqual(["first.csv", "second.csv", "first.csv"]);
    expect(
      screen.getByRole("button", { name: "Review preview for second.csv" }),
    ).toBeTruthy();
  });

  it("reviews accepted files together and refreshes later files before import", async () => {
    const firstArtifactId = "44444444-4444-4444-8444-444444444444";
    const secondArtifactId = "55555555-5555-4555-8555-555555555555";
    const alreadyImportedPreview = stripePreviewResult({
      artifactId: secondArtifactId,
      willImportCount: 0,
      alreadyImportedCount: 1,
      rows: [
        {
          ...stripePreviewResult().rows[0],
          importStatus: "already_imported",
        },
      ],
    });
    operations.startArtifactUpload
      .mockResolvedValueOnce({
        artifact: { id: firstArtifactId },
        uploadUrl: "https://uploads.example.test/first.csv",
        uploadHeaders: uploadHeadersFor(firstArtifactId),
      })
      .mockResolvedValueOnce({
        artifact: { id: secondArtifactId },
        uploadUrl: "https://uploads.example.test/second.csv",
        uploadHeaders: uploadHeadersFor(secondArtifactId),
      });
    operations.previewStripeCsv
      .mockResolvedValueOnce(
        stripePreviewResult({ artifactId: firstArtifactId }),
      )
      .mockResolvedValueOnce(
        stripePreviewResult({ artifactId: secondArtifactId }),
      )
      .mockResolvedValueOnce(
        stripePreviewResult({ artifactId: firstArtifactId }),
      )
      .mockResolvedValueOnce(alreadyImportedPreview);
    operations.importStripeCsv
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    addStripeFiles([
      new File(["same"], "first.csv", { type: "text/csv" }),
      new File(["same"], "second.csv", { type: "text/csv" }),
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Upload and preview first.csv" }),
    );
    await screen.findByRole("heading", { name: "Review first.csv" });
    fireEvent.click(screen.getByRole("button", { name: "Add to batch" }));
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Upload and preview second.csv" }),
    );
    await screen.findByRole("heading", { name: "Review second.csv" });
    fireEvent.click(screen.getByRole("button", { name: "Add to batch" }));

    const batch = screen.getByRole("region", { name: "Accepted files" });
    expect(within(batch).getByText("2 files added to batch")).toBeTruthy();
    expect(
      within(batch).getByText("Rows").nextElementSibling?.textContent,
    ).toBe("2");
    expect(operations.importStripeCsv).not.toHaveBeenCalled();
    fireEvent.click(
      within(batch).getByRole("button", { name: "Confirm import" }),
    );

    expect(
      await screen.findByText(/Batch finished: 2 files completed/),
    ).toBeTruthy();
    expect(operations.previewStripeCsv).toHaveBeenCalledTimes(4);
    expect(operations.importStripeCsv).toHaveBeenCalledTimes(2);
    expect(operations.importStripeCsv).toHaveBeenCalledWith({
      data: { artifactId: firstArtifactId },
    });
    expect(operations.importStripeCsv).toHaveBeenCalledWith({
      data: { artifactId: secondArtifactId },
    });
    expect(
      await screen.findAllByText(/Import complete — no new rows/),
    ).toHaveLength(2);
  });

  it("retries only failed files after a partial batch result", async () => {
    const firstArtifactId = "44444444-4444-4444-8444-444444444444";
    const secondArtifactId = "55555555-5555-4555-8555-555555555555";
    operations.startArtifactUpload
      .mockResolvedValueOnce({
        artifact: { id: firstArtifactId },
        uploadUrl: "https://uploads.example.test/first.csv",
        uploadHeaders: uploadHeadersFor(firstArtifactId),
      })
      .mockResolvedValueOnce({
        artifact: { id: secondArtifactId },
        uploadUrl: "https://uploads.example.test/second.csv",
        uploadHeaders: uploadHeadersFor(secondArtifactId),
      });
    operations.previewStripeCsv
      .mockResolvedValueOnce(
        stripePreviewResult({ artifactId: firstArtifactId }),
      )
      .mockResolvedValueOnce(
        stripePreviewResult({ artifactId: secondArtifactId }),
      )
      .mockResolvedValueOnce(
        stripePreviewResult({ artifactId: firstArtifactId }),
      )
      .mockResolvedValueOnce(
        stripePreviewResult({ artifactId: secondArtifactId }),
      )
      .mockResolvedValueOnce(
        stripePreviewResult({ artifactId: secondArtifactId }),
      )
      .mockResolvedValueOnce(
        stripePreviewResult({ artifactId: secondArtifactId }),
      );
    operations.importStripeCsv
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error("Temporary import failure"))
      .mockResolvedValueOnce(2);
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    addStripeFiles([
      new File(["first"], "first.csv", { type: "text/csv" }),
      new File(["second"], "second.csv", { type: "text/csv" }),
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Upload and preview first.csv" }),
    );
    await screen.findByRole("heading", { name: "Review first.csv" });
    fireEvent.click(screen.getByRole("button", { name: "Add to batch" }));
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Upload and preview second.csv" }),
    );
    await screen.findByRole("heading", { name: "Review second.csv" });
    fireEvent.click(screen.getByRole("button", { name: "Add to batch" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    expect(await screen.findAllByText(/Temporary import failure/)).toHaveLength(
      2,
    );
    await waitFor(() =>
      expect(operations.importStripeCsv).toHaveBeenCalledTimes(2),
    );
    const batch = screen.getByRole("region", { name: "Accepted files" });
    expect(
      (
        within(batch).getByRole("button", {
          name: "Confirm import",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      within(batch).getByRole("button", {
        name: "Refresh preview for second.csv",
      }),
    );
    await waitFor(() =>
      expect(
        (
          within(batch).getByRole("button", {
            name: "Confirm import",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(
      within(batch).getByRole("button", { name: "Confirm import" }),
    );
    expect(
      await screen.findByText(/Batch finished: 1 file completed/),
    ).toBeTruthy();
    expect(
      operations.importStripeCsv.mock.calls.map(
        ([request]) => request.data.artifactId,
      ),
    ).toEqual([firstArtifactId, secondArtifactId, secondArtifactId]);
  });

  it("refreshes uncertain outcomes before deciding that a file needs import", async () => {
    const artifactId = "44444444-4444-4444-8444-444444444444";
    const alreadyImportedPreview = stripePreviewResult({
      artifactId,
      willImportCount: 0,
      alreadyImportedCount: 1,
      rows: [
        {
          ...stripePreviewResult().rows[0],
          importStatus: "already_imported",
        },
      ],
    });
    operations.previewStripeCsv
      .mockResolvedValueOnce(stripePreviewResult({ artifactId }))
      .mockResolvedValueOnce(stripePreviewResult({ artifactId }))
      .mockResolvedValueOnce(alreadyImportedPreview)
      .mockResolvedValueOnce(alreadyImportedPreview);
    operations.importStripeCsv.mockRejectedValueOnce(
      new Error("Database response unavailable. Code DB_OUTCOME_UNKNOWN."),
    );
    operations.importStripeCsv.mockResolvedValueOnce(0);
    render(
      createElement(StripeImportRoute, {
        session: { authenticated: true, user: { id: "actor" } as never },
      }),
    );
    addStripeFiles(
      [new File(["csv"], "stripe.csv", { type: "text/csv" })],
      true,
    );
    await screen.findByRole("button", { name: "Add to batch" });
    fireEvent.click(screen.getByRole("button", { name: "Add to batch" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    expect(
      await screen.findAllByText(/Refresh this file before retrying/),
    ).toHaveLength(2);
    expect(operations.importStripeCsv).toHaveBeenCalledOnce();

    const batch = screen.getByRole("region", { name: "Accepted files" });
    fireEvent.click(
      within(batch).getByRole("button", {
        name: "Refresh preview for stripe.csv",
      }),
    );
    expect(
      await within(batch).findAllByText(/0 new, 1 already imported/),
    ).toHaveLength(1);
    fireEvent.click(
      within(batch).getByRole("button", { name: "Confirm import" }),
    );
    expect(
      await screen.findAllByText(/Import complete — no new rows/),
    ).toHaveLength(2);
    expect(operations.importStripeCsv).toHaveBeenCalledTimes(2);
  });

  it("navigates a successful create to its saved record and removes the active form", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    operations.saveManualTransaction.mockResolvedValue({
      status: "saved",
      transaction: { id },
    });
    render(
      createElement(ManualTransactionRoute, {
        data: routeData(),
        mode: "create",
        returnTo: "/transactions/new",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save manual transaction" }),
    );

    await waitFor(() =>
      expect(routerMocks.navigate).toHaveBeenCalledWith({
        to: "/transactions/$transactionId",
        params: { transactionId: id },
        replace: true,
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Save manual transaction" }),
    ).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "View transaction" })
        .getAttribute("href"),
    ).toBe(`/transactions/${id}`);
    expect(operations.saveManualTransaction).toHaveBeenCalledOnce();
  });

  it("calls the pane save callback before using route navigation", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const events: string[] = [];
    contextPane.api = {
      open: vi.fn(),
      close: vi.fn(),
      active: true,
      clearGuard: () => events.push("clear"),
    };
    const onSaved = vi.fn(
      (status: string, saved: { refreshSucceeded: boolean }) =>
        events.push(`saved:${status}:${saved.refreshSucceeded}`),
    );
    operations.saveManualTransaction.mockResolvedValue({
      status: "saved",
      transaction: { id, status: "recorded" },
    });
    routerMocks.invalidate.mockRejectedValueOnce(new Error("refresh failed"));
    const element = createElement(ManualTransactionRoute, {
      data: routeData(),
      mode: "create",
      returnTo: "/transactions/new",
      embedded: true,
      onSaved,
    });
    const view = render(element);
    const formProps = manualFormProbe.props.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    act(() => (formProps.onDirtyChange as (dirty: boolean) => void)(true));
    await waitFor(() =>
      expect(contextPane.guard).toHaveBeenLastCalledWith({
        dirty: true,
        pending: false,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save manual transaction" }),
    );

    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith("recorded", {
        transactionId: id,
        refreshSucceeded: false,
      }),
    );
    await waitFor(() =>
      expect(contextPane.guard).toHaveBeenLastCalledWith({
        dirty: false,
        pending: false,
      }),
    );
    expect(events).toEqual(["clear", "saved:recorded:false"]);
    expect(routerMocks.navigate).not.toHaveBeenCalled();
    expect(operations.saveManualTransaction).toHaveBeenCalledOnce();

    view.rerender(element);
    await waitFor(() =>
      expect(contextPane.guard).toHaveBeenLastCalledWith({
        dirty: false,
        pending: false,
      }),
    );
  });

  it("hands off match-next intent after a successful recorded draft save without sending it to the server", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const transaction = {
      id,
      status: "draft",
      sourceSystem: "manual",
      sourceArtifacts: [],
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    const onSaved = vi.fn();
    let finishRefresh: () => void = () => undefined;
    routerMocks.invalidate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    operations.saveManualTransaction.mockResolvedValue({
      status: "saved",
      transaction: { id, status: "recorded" },
    });
    render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
        embedded: true,
        allowSaveMatchNext: true,
        onSaved,
      }),
    );

    expect(manualFormProbe.props.mock.lastCall?.[0].allowSaveMatchNext).toBe(
      true,
    );
    const formProps = manualFormProbe.props.mock.lastCall?.[0] as {
      onSubmit: (submission: unknown) => void;
    };
    formProps.onSubmit({
      action: "save_recorded",
      afterSave: "match_next",
      transaction: { ownerId: "actor" },
      artifactIds: [],
      file: null,
    });

    await waitFor(() =>
      expect(routerMocks.invalidate).toHaveBeenCalledWith({ sync: true }),
    );
    expect(onSaved).not.toHaveBeenCalled();
    await act(async () => {
      finishRefresh();
    });
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith("recorded", {
        transactionId: id,
        afterSave: "match_next",
        refreshSucceeded: true,
      }),
    );
    expect(operations.saveManualTransaction).toHaveBeenCalledWith({
      data: {
        id,
        expectedUpdatedAt: null,
        action: "save_recorded",
        transaction: { ownerId: "actor", sourceArtifactId: null },
        artifactIds: [],
      },
    });
    expect(routerMocks.invalidate).toHaveBeenCalledWith({ sync: true });
    expect(
      operations.saveManualTransaction.mock.lastCall?.[0].data,
    ).not.toHaveProperty("afterSave");
  });

  it("waits for pre-save acknowledgement and releases cancellation for a fresh submission", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const transaction = {
      id,
      status: "draft",
      sourceSystem: "manual",
      sourceArtifacts: [],
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    let acknowledge: (confirmed: boolean) => void = () => undefined;
    const onBeforeSaveMatchNext = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            acknowledge = resolve;
          }),
      )
      .mockResolvedValueOnce(true);
    const onSaved = vi.fn();
    operations.saveManualTransaction.mockResolvedValue({
      status: "saved",
      transaction: { id, status: "recorded" },
    });
    render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
        embedded: true,
        allowSaveMatchNext: true,
        onBeforeSaveMatchNext,
        onSaved,
      }),
    );
    const formProps = manualFormProbe.props.mock.lastCall?.[0] as {
      onSubmit: (submission: unknown) => Promise<void>;
    };
    const submittedTransaction = {
      ownerId: "actor",
      documentAmount: "35.12",
      invoiceDate: "2026-09-22",
    };
    const submission = {
      action: "save_recorded",
      afterSave: "match_next",
      transaction: submittedTransaction,
      artifactIds: [],
      file: null,
    };
    let first: Promise<void>;
    act(() => {
      first = formProps.onSubmit(submission);
    });
    expect(onBeforeSaveMatchNext).toHaveBeenCalledExactlyOnceWith(
      submittedTransaction,
    );
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
    await act(async () => {
      await formProps.onSubmit(submission);
    });
    expect(onBeforeSaveMatchNext).toHaveBeenCalledTimes(1);
    await act(async () => {
      acknowledge(false);
      await first;
    });
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    await act(async () => {
      await formProps.onSubmit(submission);
    });
    expect(onBeforeSaveMatchNext).toHaveBeenCalledTimes(2);
    expect(operations.saveManualTransaction).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith("recorded", {
      transactionId: id,
      afterSave: "match_next",
      refreshSucceeded: true,
    });
  });

  it("does not run match-next acknowledgement for ordinary saves", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const transaction = {
      id,
      status: "draft",
      sourceSystem: "manual",
      sourceArtifacts: [],
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    const onBeforeSaveMatchNext = vi.fn().mockResolvedValue(false);
    operations.saveManualTransaction.mockResolvedValue({
      status: "saved",
      transaction: { id, status: "recorded" },
    });
    render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
        embedded: true,
        allowSaveMatchNext: true,
        onBeforeSaveMatchNext,
        onSaved: vi.fn(),
      }),
    );
    const formProps = manualFormProbe.props.mock.lastCall?.[0] as {
      onSubmit: (submission: unknown) => Promise<void>;
    };
    await act(async () => {
      await formProps.onSubmit({
        action: "save_recorded",
        transaction: { ownerId: "actor" },
        artifactIds: [],
        file: null,
      });
    });
    expect(onBeforeSaveMatchNext).not.toHaveBeenCalled();
    expect(operations.saveManualTransaction).toHaveBeenCalledTimes(1);
  });

  it("only enables match-next for a caller-enabled draft edit", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const draftTransaction = {
      id,
      status: "draft",
      sourceSystem: "manual",
      sourceArtifacts: [],
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    const disabledDraftView = render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction: draftTransaction },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
      }),
    );
    expect(manualFormProbe.props.mock.lastCall?.[0].allowSaveMatchNext).toBe(
      false,
    );
    disabledDraftView.unmount();

    const recordedTransaction = {
      id,
      status: "recorded",
      sourceSystem: "manual",
      sourceArtifacts: [],
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    const recordedView = render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction: recordedTransaction },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
        allowSaveMatchNext: true,
      }),
    );
    expect(manualFormProbe.props.mock.lastCall?.[0].allowSaveMatchNext).toBe(
      false,
    );
    recordedView.unmount();

    render(
      createElement(ManualTransactionRoute, {
        data: routeData(),
        mode: "create",
        returnTo: "/transactions/new",
        allowSaveMatchNext: true,
      }),
    );
    expect(manualFormProbe.props.mock.lastCall?.[0].allowSaveMatchNext).toBe(
      false,
    );
  });

  it("does not hand off a server-rejected save", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const transaction = {
      id,
      status: "draft",
      sourceSystem: "manual",
      sourceArtifacts: [],
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    const onSaved = vi.fn();
    operations.saveManualTransaction.mockResolvedValue({
      status: "invalid",
      issues: [],
    });
    render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
        embedded: true,
        allowSaveMatchNext: true,
        onSaved,
      }),
    );

    const formProps = manualFormProbe.props.mock.lastCall?.[0] as {
      onSubmit: (submission: unknown) => void;
    };
    formProps.onSubmit({
      action: "save_recorded",
      afterSave: "match_next",
      transaction: { ownerId: "actor" },
      artifactIds: [],
      file: null,
    });

    await waitFor(() =>
      expect(operations.saveManualTransaction).toHaveBeenCalledOnce(),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("does not hand off while proposed evidence still needs approval", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const transaction = {
      id,
      status: "draft",
      sourceSystem: "manual",
      sourceArtifacts: [],
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    const onSaved = vi.fn();
    render(
      createElement(ManualTransactionRoute, {
        data: {
          ...routeData(),
          transaction,
          proposedDraftEvidence: {
            submissionId: "55555555-5555-4555-8555-555555555555",
            transactionId: id,
            artifactId: "44444444-4444-4444-8444-444444444444",
            filename: "synthetic-invoice.pdf",
            state: "awaiting_review",
            note: null,
            discardedAt: null,
          },
        },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
        embedded: true,
        allowSaveMatchNext: true,
        onSaved,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save manual transaction" }),
    );
    expect(
      await screen.findByText(/Approve or remove the proposed PDF/),
    ).toBeTruthy();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("renders a terminal saved outcome after an embedded draft refresh failure", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const transaction = {
      id,
      status: "draft",
      sourceSystem: "manual",
      sourceArtifacts: [],
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    const onSaved = vi.fn();
    operations.saveManualTransaction.mockResolvedValue({
      status: "saved",
      transaction: { id, status: "recorded" },
    });
    routerMocks.invalidate.mockRejectedValueOnce(new Error("refresh failed"));
    render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
        embedded: true,
        allowSaveMatchNext: true,
        onSaved,
      }),
    );

    const formProps = manualFormProbe.props.mock.lastCall?.[0] as {
      onSubmit: (submission: unknown) => void;
    };
    formProps.onSubmit({
      action: "save_recorded",
      afterSave: "match_next",
      transaction: { ownerId: "actor" },
      artifactIds: [],
      file: null,
    });

    expect(
      await screen.findByText(
        /bank row remains unmatched because this view could not refresh/i,
      ),
    ).toBeTruthy();
    expect(onSaved).toHaveBeenCalledWith("recorded", {
      transactionId: id,
      afterSave: "match_next",
      refreshSucceeded: false,
    });
    expect(
      screen
        .getByRole("link", { name: "View transaction" })
        .getAttribute("href"),
    ).toBe(`/transactions/${id}`);
    expect(
      screen.queryByRole("button", { name: "Save manual transaction" }),
    ).toBeNull();
    expect(operations.saveManualTransaction).toHaveBeenCalledOnce();
  });

  it("renders a terminal saved outcome when an embedded draft callback throws", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const transaction = {
      id,
      status: "draft",
      sourceSystem: "manual",
      sourceArtifacts: [],
      sourceArtifactId: null,
      kind: "supplier_expense",
      documentCurrency: "AUD",
    } as unknown as TransactionRecord;
    const onSaved = vi.fn(() => {
      throw new Error("callback failed");
    });
    operations.saveManualTransaction.mockResolvedValue({
      status: "saved",
      transaction: { id, status: "recorded" },
    });
    render(
      createElement(ManualTransactionRoute, {
        data: { ...routeData(), transaction },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
        embedded: true,
        allowSaveMatchNext: true,
        onSaved,
      }),
    );

    const formProps = manualFormProbe.props.mock.lastCall?.[0] as {
      onSubmit: (submission: unknown) => void;
    };
    formProps.onSubmit({
      action: "save_recorded",
      afterSave: "match_next",
      transaction: { ownerId: "actor" },
      artifactIds: [],
      file: null,
    });

    expect(
      await screen.findByText(/matching handoff could not be confirmed/i),
    ).toBeTruthy();
    expect(onSaved).toHaveBeenCalledWith("recorded", {
      transactionId: id,
      afterSave: "match_next",
      refreshSucceeded: true,
    });
    expect(
      screen
        .getByRole("link", { name: "View transaction" })
        .getAttribute("href"),
    ).toBe(`/transactions/${id}`);
    expect(
      screen.queryByRole("button", { name: "Save manual transaction" }),
    ).toBeNull();
    expect(operations.saveManualTransaction).toHaveBeenCalledOnce();
  });

  it("requires explicit PDF review and approval before recording new evidence", async () => {
    const artifactId = "44444444-4444-4444-8444-444444444444";
    const file = new File(["synthetic pdf"], "invoice.pdf", {
      type: "application/pdf",
    });
    operations.confirmArtifactUpload.mockResolvedValue({ id: artifactId });
    operations.saveManualTransaction.mockResolvedValue({
      status: "saved",
      transaction: { id: "11111111-1111-4111-8111-111111111111" },
    });
    render(
      createElement(ManualTransactionRoute, {
        data: routeData(),
        mode: "create",
        returnTo: "/transactions/new",
      }),
    );

    const submit = () => {
      const props = manualFormProbe.props.mock.calls.at(-1)?.[0] as {
        onSubmit: (submission: unknown) => void;
      };
      props.onSubmit({
        action: "save_recorded",
        transaction: { ownerId: "actor" },
        artifactIds: [],
        file,
      });
    };
    submit();
    expect(await screen.findByText(/Status: awaiting review/)).toBeTruthy();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Prepare PDF preview" }),
    );
    const preview = await screen.findByRole("link", {
      name: "Open PDF preview",
    });
    expect(preview).toHaveProperty(
      "href",
      "https://uploads.example.test/review.pdf",
    );
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Approve PDF" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(preview);
    fireEvent.click(screen.getByRole("button", { name: "Approve PDF" }));
    expect(await screen.findByText(/Status: approved/)).toBeTruthy();
    expect(operations.approveArtifact).toHaveBeenCalledWith({
      data: { id: artifactId },
    });
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();

    submit();
    await waitFor(() =>
      expect(operations.saveManualTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ artifactIds: [artifactId] }),
        }),
      ),
    );
  });

  it("confirms a PDF for extraction without approval or saving and reuses it on submission", async () => {
    const artifactId = "44444444-4444-4444-8444-444444444444";
    const file = new File(["synthetic pdf"], "invoice.pdf", {
      type: "application/pdf",
    });
    operations.confirmArtifactUpload.mockResolvedValue({ id: artifactId });
    render(
      createElement(ManualTransactionRoute, {
        data: routeData(),
        mode: "create",
        returnTo: "/transactions/new",
      }),
    );
    const props = () =>
      manualFormProbe.props.mock.calls.at(-1)![0] as {
        onEvidenceChange: (file: File | null) => void;
        onPrepareInvoiceForExtraction: (
          file: File,
          ownerId: string,
        ) => Promise<string>;
        onSubmit: (submission: unknown) => Promise<void>;
      };
    act(() => props().onEvidenceChange(file));
    await act(async () =>
      expect(await props().onPrepareInvoiceForExtraction(file, "actor")).toBe(
        artifactId,
      ),
    );
    expect(operations.startArtifactUpload).toHaveBeenCalledOnce();
    expect(operations.confirmArtifactUpload).toHaveBeenCalledOnce();
    expect(operations.approveArtifact).not.toHaveBeenCalled();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
    await act(async () =>
      expect(await props().onPrepareInvoiceForExtraction(file, "actor")).toBe(
        artifactId,
      ),
    );
    await act(async () =>
      props().onSubmit({
        action: "save_recorded",
        transaction: { ownerId: "actor" },
        artifactIds: [],
        file,
      }),
    );
    expect(operations.startArtifactUpload).toHaveBeenCalledOnce();
    expect(operations.confirmArtifactUpload).toHaveBeenCalledOnce();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Preview and approve this PDF before saving/),
    ).toBeTruthy();
  });

  it("does not stage a cleared file when extraction upload confirmation arrives late", async () => {
    const file = new File(["synthetic pdf"], "invoice.pdf", {
      type: "application/pdf",
    });
    let complete!: (value: { id: string }) => void;
    operations.confirmArtifactUpload.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    render(
      createElement(ManualTransactionRoute, {
        data: routeData(),
        mode: "create",
        returnTo: "/transactions/new",
      }),
    );
    const props = () =>
      manualFormProbe.props.mock.calls.at(-1)![0] as {
        onEvidenceChange: (file: File | null) => void;
        onPrepareInvoiceForExtraction: (
          file: File,
          ownerId: string,
        ) => Promise<string>;
      };
    let pending!: Promise<string>;
    act(() => {
      props().onEvidenceChange(file);
      pending = props().onPrepareInvoiceForExtraction(file, "actor");
    });
    await waitFor(() =>
      expect(operations.confirmArtifactUpload).toHaveBeenCalledOnce(),
    );
    act(() => props().onEvidenceChange(null));
    await act(async () => {
      complete({ id: "44444444-4444-4444-8444-444444444444" });
      await pending;
    });
    expect(
      screen.queryByRole("button", { name: "Prepare PDF preview" }),
    ).toBeNull();
    expect(screen.queryByText(/Status: awaiting review/)).toBeNull();
    expect(operations.approveArtifact).not.toHaveBeenCalled();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
  });

  it("holds a suggested draft until its proposed PDF is approved or removed", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const artifactId = "44444444-4444-4444-8444-444444444444";
    const proposedDraftEvidence = {
      submissionId: "55555555-5555-4555-8555-555555555555",
      transactionId: id,
      artifactId,
      filename: "synthetic-invoice.pdf",
      state: "awaiting_review",
      note: "Review the PDF.",
      discardedAt: null,
    };
    operations.saveManualTransaction.mockResolvedValue({
      status: "saved",
      transaction: { id },
    });
    render(
      createElement(ManualTransactionRoute, {
        data: {
          ...routeData(),
          transaction: {
            id,
            status: "draft",
            sourceSystem: "manual",
            sourceArtifacts: [],
            sourceArtifactId: null,
            kind: "supplier_expense",
            documentCurrency: "AUD",
          } as unknown as TransactionRecord,
          proposedDraftEvidence,
        },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save manual transaction" }),
    );
    expect(
      await screen.findByText(
        /Approve or remove the proposed PDF before recording/,
      ),
    ).toBeTruthy();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Prepare PDF preview" }),
    );
    const preview = await screen.findByRole("link", {
      name: "Open PDF preview",
    });
    fireEvent.click(preview);
    fireEvent.click(screen.getByRole("button", { name: "Approve PDF" }));
    expect(
      await screen.findByText(
        /Saving as recorded will attach this approved PDF/,
      ),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Save manual transaction" }),
    );
    await waitFor(() =>
      expect(operations.saveManualTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ artifactIds: [artifactId] }),
        }),
      ),
    );
  });

  it("allows a reviewer to discard proposed evidence before recording a draft", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const proposedDraftEvidence = {
      submissionId: "55555555-5555-4555-8555-555555555555",
      transactionId: id,
      artifactId: "44444444-4444-4444-8444-444444444444",
      filename: "synthetic-invoice.pdf",
      state: "awaiting_review",
      note: null,
      discardedAt: null,
    };
    operations.discardProposedDraftEvidence.mockResolvedValue({
      ...proposedDraftEvidence,
      discardedAt: "2026-09-26T00:00:00.000Z",
    });
    operations.saveManualTransaction.mockResolvedValue({
      status: "saved",
      transaction: { id },
    });
    render(
      createElement(ManualTransactionRoute, {
        data: {
          ...routeData(),
          transaction: {
            id,
            status: "draft",
            sourceSystem: "manual",
            sourceArtifacts: [],
            sourceArtifactId: null,
            kind: "supplier_expense",
            documentCurrency: "AUD",
          } as unknown as TransactionRecord,
          proposedDraftEvidence,
        },
        mode: "edit",
        returnTo: `/transactions/${id}/edit`,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Remove proposed PDF" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Proposed PDF evidence" }),
      ).toBeNull(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save manual transaction" }),
    );
    await waitFor(() =>
      expect(operations.saveManualTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ artifactIds: [] }),
        }),
      ),
    );
  });

  it.each(["awaiting_review", "available"] as const)(
    "keeps an %s proposed PDF hidden by default",
    (state) => {
      const transactionId = "11111111-1111-4111-8111-111111111111";
      const artifactId = "44444444-4444-4444-8444-444444444444";
      render(
        createElement(ManualTransactionRoute, {
          data: routeDataWithProposal(
            proposedEvidenceFixture(transactionId, artifactId, state),
          ),
          mode: "edit",
          returnTo: `/transactions/${transactionId}/edit`,
        }),
      );

      expect(
        screen
          .getByRole("button", { name: "Show PDF" })
          .getAttribute("aria-expanded"),
      ).toBe("false");
      expect(
        screen.queryByRole("region", { name: "Invoice PDF preview" }),
      ).toBeNull();
      expect(operations.previewArtifactForReview).not.toHaveBeenCalled();
      expect(operations.approveArtifact).not.toHaveBeenCalled();
      expect(operations.saveManualTransaction).not.toHaveBeenCalled();
    },
  );

  it("restores a different selected PDF after hiding the proposed preview", async () => {
    const transactionId = "11111111-1111-4111-8111-111111111111";
    const proposedArtifactId = "44444444-4444-4444-8444-444444444444";
    const libraryArtifactId = "22222222-2222-4222-8222-222222222222";
    const { container } = render(
      createElement(ManualTransactionRoute, {
        data: {
          ...routeDataWithProposal(
            proposedEvidenceFixture(
              transactionId,
              proposedArtifactId,
              "awaiting_review",
              {
                filename: "Proposed invoice.pdf",
              },
            ),
          ),
          availableArtifacts: [
            { id: libraryArtifactId, filename: "Library invoice.pdf" },
          ] as never,
        },
        mode: "edit",
        returnTo: `/transactions/${transactionId}/edit`,
      }),
    );
    const formNode = container.querySelector(".manual-entry-form");
    const formProps = manualFormProbe.props.mock.lastCall?.[0] as Record<
      string,
      unknown
    >;
    act(() => {
      (formProps.onDirtyChange as (dirty: boolean) => void)(true);
      (
        formProps.onSelectedArtifactsChange as (
          artifactIds: readonly string[],
        ) => void
      )([libraryArtifactId]);
    });

    expect(
      await screen.findByTitle("PDF preview: Library invoice.pdf"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show PDF" }));
    expect(
      await screen.findByTitle("PDF preview: Proposed invoice.pdf"),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("region", { name: "Invoice PDF preview" }),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Hide PDF" }));
    await waitFor(() =>
      expect(
        screen.queryByTitle("PDF preview: Proposed invoice.pdf"),
      ).toBeNull(),
    );
    expect(
      await screen.findByTitle("PDF preview: Library invoice.pdf"),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("region", { name: "Invoice PDF preview" }),
    ).toHaveLength(1);
    expect(container.querySelector(".manual-entry-form")).toBe(formNode);
    expect(
      manualFormProbe.props.mock.lastCall?.[0].onSelectedArtifactsChange,
    ).toEqual(expect.any(Function));
    expect(contextPane.guard).toHaveBeenLastCalledWith({
      dirty: true,
      pending: false,
    });
    expect(operations.approveArtifact).not.toHaveBeenCalled();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
  });

  it("keeps inline preview refresh, new-tab, and error behavior display-only", async () => {
    const transactionId = "11111111-1111-4111-8111-111111111111";
    const artifactId = "44444444-4444-4444-8444-444444444444";
    const firstUrl = "https://uploads.example.test/proposed-first.pdf";
    const secondUrl = "https://uploads.example.test/proposed-second.pdf";
    const finalUrl = "https://uploads.example.test/proposed-final.pdf";
    operations.previewArtifactForReview
      .mockResolvedValueOnce(firstUrl)
      .mockResolvedValueOnce(secondUrl)
      .mockRejectedValueOnce(new Error("Synthetic preview failure"))
      .mockResolvedValueOnce(finalUrl);
    render(
      createElement(ManualTransactionRoute, {
        data: routeDataWithProposal(
          proposedEvidenceFixture(
            transactionId,
            artifactId,
            "awaiting_review",
            {
              filename: "Proposed invoice.pdf",
            },
          ),
        ),
        mode: "edit",
        returnTo: `/transactions/${transactionId}/edit`,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Show PDF" }));
    const firstFrame = await screen.findByTitle(
      "PDF preview: Proposed invoice.pdf",
    );
    expect(firstFrame.getAttribute("src")).toBe(
      `${firstUrl}#view=FitH&toolbar=0`,
    );
    const newTabLink = screen.getByRole("link", {
      name: "Open PDF in a new tab",
    });
    expect(newTabLink.getAttribute("href")).toBe(firstUrl);
    expect(newTabLink.getAttribute("target")).toBe("_blank");
    expect(newTabLink.getAttribute("rel")).toBe("noopener noreferrer");
    expect(
      screen
        .getByRole("button", { name: "Approve PDF" })
        .hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    await waitFor(() =>
      expect(operations.previewArtifactForReview).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(
        screen
          .getByTitle("PDF preview: Proposed invoice.pdf")
          .getAttribute("src"),
      ).toBe(`${secondUrl}#view=FitH&toolbar=0`),
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    expect(
      await screen.findByText(
        "PDF preview could not be prepared. Refresh to try again.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    await waitFor(() =>
      expect(operations.previewArtifactForReview).toHaveBeenCalledTimes(4),
    );
    await waitFor(() =>
      expect(
        screen
          .getByTitle("PDF preview: Proposed invoice.pdf")
          .getAttribute("src"),
      ).toBe(`${finalUrl}#view=FitH&toolbar=0`),
    );
    expect(operations.approveArtifact).not.toHaveBeenCalled();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
  });

  it("keeps a same-artifact proposal hidden through refresh and removal", async () => {
    const transactionId = "11111111-1111-4111-8111-111111111111";
    const artifactId = "44444444-4444-4444-8444-444444444444";
    const proposal = proposedEvidenceFixture(transactionId, artifactId);
    operations.getProposedDraftEvidence.mockResolvedValue(proposal);
    operations.discardProposedDraftEvidence.mockResolvedValue({
      ...proposal,
      discardedAt: "2026-09-26T00:00:00.000Z",
    });
    render(
      createElement(ManualTransactionRoute, {
        data: routeDataWithProposal(proposal),
        mode: "edit",
        returnTo: `/transactions/${transactionId}/edit`,
      }),
    );
    const formProps = manualFormProbe.props.mock.lastCall?.[0] as Record<
      string,
      unknown
    >;
    act(() =>
      (
        formProps.onSelectedArtifactsChange as (
          artifactIds: readonly string[],
        ) => void
      )([artifactId]),
    );
    expect(
      screen.queryByRole("region", { name: "Invoice PDF preview" }),
    ).toBeNull();
    expect(operations.previewArtifactForReview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show PDF" }));
    const proposedPreview = await screen.findByRole("region", {
      name: "Invoice PDF preview",
    });
    expect(
      proposedPreview.classList.contains("transaction-pdf-preview--peek"),
    ).toBe(true);
    expect(
      proposedPreview.parentElement?.classList.contains(
        "transaction-form-preview-layout--peek",
      ),
    ).toBe(true);
    expect(
      screen.getAllByRole("region", { name: "Invoice PDF preview" }),
    ).toHaveLength(1);
    expect(
      await screen.findByTitle("PDF preview: synthetic-invoice.pdf"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide PDF" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Invoice PDF preview" }),
      ).toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh PDF status" }));
    await waitFor(() =>
      expect(operations.getProposedDraftEvidence).toHaveBeenCalledWith({
        data: { transactionId },
      }),
    );
    expect(screen.getByRole("button", { name: "Show PDF" })).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Invoice PDF preview" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show PDF" }));
    expect(
      await screen.findByTitle("PDF preview: synthetic-invoice.pdf"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove proposed PDF" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Proposed PDF evidence" }),
      ).toBeNull(),
    );
    expect(
      screen.queryByRole("region", { name: "Invoice PDF preview" }),
    ).toBeNull();
    expect(operations.approveArtifact).not.toHaveBeenCalled();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
  });

  it("restores the selected preview after hiding the proposed peek", async () => {
    const transactionId = "11111111-1111-4111-8111-111111111111";
    const proposedArtifactId = "44444444-4444-4444-8444-444444444444";
    const selectedArtifactId = "22222222-2222-4222-8222-222222222222";
    render(
      createElement(ManualTransactionRoute, {
        data: routeDataWithProposal(
          proposedEvidenceFixture(transactionId, proposedArtifactId),
        ),
        mode: "edit",
        returnTo: `/transactions/${transactionId}/edit`,
      }),
    );

    const formProps = manualFormProbe.props.mock.lastCall?.[0] as Record<
      string,
      unknown
    >;
    act(() =>
      (
        formProps.onSelectedArtifactsChange as (
          artifactIds: readonly string[],
        ) => void
      )([selectedArtifactId]),
    );

    const selectedPreviewFrame = await screen.findByTitle(
      "PDF preview: Selected invoice PDF",
    );
    expect(selectedPreviewFrame.getAttribute("src")).toBe(
      "https://uploads.example.test/review.pdf#view=FitH&toolbar=0",
    );
    expect(
      selectedPreviewFrame.parentElement?.classList.contains(
        "transaction-pdf-preview--peek",
      ),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show PDF" }));

    const proposedPreviewFrame = await screen.findByTitle(
      "PDF preview: synthetic-invoice.pdf",
    );
    expect(
      proposedPreviewFrame.parentElement?.classList.contains(
        "transaction-pdf-preview--peek",
      ),
    ).toBe(true);
    expect(
      screen.getAllByRole("region", { name: "Invoice PDF preview" }),
    ).toHaveLength(1);
    expect(screen.queryByTitle("PDF preview: Selected invoice PDF")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hide PDF" }));
    const restoredPreviewFrame = await screen.findByTitle(
      "PDF preview: Selected invoice PDF",
    );
    expect(restoredPreviewFrame.getAttribute("src")).toBe(
      "https://uploads.example.test/review.pdf#view=FitH&toolbar=0",
    );
    expect(
      restoredPreviewFrame.parentElement?.classList.contains(
        "transaction-pdf-preview--peek",
      ),
    ).toBe(true);
    expect(
      screen.getAllByRole("region", { name: "Invoice PDF preview" }),
    ).toHaveLength(1);
    expect(
      screen.queryByTitle("PDF preview: synthetic-invoice.pdf"),
    ).toBeNull();
    expect(operations.approveArtifact).not.toHaveBeenCalled();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
  });

  it("does not restore a proposed preview hidden before its request resolves", async () => {
    const transactionId = "11111111-1111-4111-8111-111111111111";
    const artifactId = "44444444-4444-4444-8444-444444444444";
    let resolvePreview: ((url: string) => void) | undefined;
    operations.previewArtifactForReview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    render(
      createElement(ManualTransactionRoute, {
        data: routeDataWithProposal(
          proposedEvidenceFixture(transactionId, artifactId),
        ),
        mode: "edit",
        returnTo: `/transactions/${transactionId}/edit`,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Show PDF" }));
    await waitFor(() =>
      expect(operations.previewArtifactForReview).toHaveBeenCalledWith({
        data: { id: artifactId },
      }),
    );
    expect(await screen.findByText("Preparing PDF preview…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide PDF" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Invoice PDF preview" }),
      ).toBeNull(),
    );

    await act(async () =>
      resolvePreview?.("https://uploads.example.test/stale-hidden.pdf"),
    );
    expect(screen.getByRole("button", { name: "Show PDF" })).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Invoice PDF preview" }),
    ).toBeNull();
    expect(
      screen.queryByTitle("PDF preview: synthetic-invoice.pdf"),
    ).toBeNull();
    expect(operations.approveArtifact).not.toHaveBeenCalled();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
  });

  it("hides the old viewer when refresh replaces the proposed artifact", async () => {
    const transactionId = "11111111-1111-4111-8111-111111111111";
    const firstArtifactId = "44444444-4444-4444-8444-444444444444";
    const replacementArtifactId = "33333333-3333-4333-8333-333333333333";
    const firstProposal = proposedEvidenceFixture(
      transactionId,
      firstArtifactId,
      "awaiting_review",
      { filename: "First proposal.pdf" },
    );
    const replacementProposal = proposedEvidenceFixture(
      transactionId,
      replacementArtifactId,
      "available",
      { filename: "Replacement proposal.pdf" },
    );
    operations.getProposedDraftEvidence.mockResolvedValue(replacementProposal);
    operations.previewArtifactForReview
      .mockResolvedValueOnce("https://uploads.example.test/first.pdf")
      .mockResolvedValueOnce("https://uploads.example.test/replacement.pdf");
    render(
      createElement(ManualTransactionRoute, {
        data: routeDataWithProposal(firstProposal),
        mode: "edit",
        returnTo: `/transactions/${transactionId}/edit`,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Show PDF" }));
    expect(
      await screen.findByTitle("PDF preview: First proposal.pdf"),
    ).toBeTruthy();
    expect(operations.previewArtifactForReview).toHaveBeenLastCalledWith({
      data: { id: firstArtifactId },
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh PDF status" }));
    await waitFor(() =>
      expect(operations.getProposedDraftEvidence).toHaveBeenCalledWith({
        data: { transactionId },
      }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Show PDF" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(screen.queryByTitle("PDF preview: First proposal.pdf")).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Invoice PDF preview" }),
    ).toBeNull();
    expect(operations.previewArtifactForReview).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Show PDF" }));
    expect(
      await screen.findByTitle("PDF preview: Replacement proposal.pdf"),
    ).toBeTruthy();
    expect(screen.queryByTitle("PDF preview: First proposal.pdf")).toBeNull();
    expect(
      screen.getAllByRole("region", { name: "Invoice PDF preview" }),
    ).toHaveLength(1);
    expect(operations.previewArtifactForReview).toHaveBeenLastCalledWith({
      data: { id: replacementArtifactId },
    });
    expect(operations.approveArtifact).not.toHaveBeenCalled();
    expect(operations.saveManualTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["rejected", null],
    ["awaiting_review", "2026-09-26T00:00:00.000Z"],
  ] as const)(
    "does not show a %s or discarded proposed PDF",
    (state, discardedAt) => {
      const transactionId = "11111111-1111-4111-8111-111111111111";
      const artifactId = "44444444-4444-4444-8444-444444444444";
      render(
        createElement(ManualTransactionRoute, {
          data: routeDataWithProposal(
            proposedEvidenceFixture(transactionId, artifactId, state, {
              discardedAt,
            }),
          ),
          mode: "edit",
          returnTo: `/transactions/${transactionId}/edit`,
        }),
      );

      expect(screen.queryByRole("button", { name: "Show PDF" })).toBeNull();
      expect(
        screen.queryByRole("region", { name: "Invoice PDF preview" }),
      ).toBeNull();
      expect(operations.previewArtifactForReview).not.toHaveBeenCalled();
    },
  );

  it("does not revive a stale proposal preview after transaction identity changes", async () => {
    const firstTransactionId = "11111111-1111-4111-8111-111111111111";
    const firstArtifactId = "44444444-4444-4444-8444-444444444444";
    const nextTransactionId = "22222222-2222-4222-8222-222222222222";
    const nextArtifactId = "33333333-3333-4333-8333-333333333333";
    let resolveFirstPreview: ((url: string) => void) | undefined;
    operations.previewArtifactForReview
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstPreview = resolve;
          }),
      )
      .mockResolvedValueOnce("https://uploads.example.test/next.pdf");
    const view = render(
      createElement(ManualTransactionRoute, {
        data: routeDataWithProposal(
          proposedEvidenceFixture(
            firstTransactionId,
            firstArtifactId,
            "awaiting_review",
            { filename: "First proposal.pdf" },
          ),
        ),
        mode: "edit",
        returnTo: `/transactions/${firstTransactionId}/edit`,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Show PDF" }));
    await waitFor(() =>
      expect(operations.previewArtifactForReview).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText("Preparing PDF preview…")).toBeTruthy();

    view.rerender(
      createElement(ManualTransactionRoute, {
        data: routeDataWithProposal(
          proposedEvidenceFixture(
            nextTransactionId,
            nextArtifactId,
            "available",
            { filename: "Next proposal.pdf" },
          ),
        ),
        mode: "edit",
        returnTo: `/transactions/${nextTransactionId}/edit`,
      }),
    );
    expect(screen.getByRole("button", { name: "Show PDF" })).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Invoice PDF preview" }),
    ).toBeNull();

    await act(async () =>
      resolveFirstPreview?.("https://uploads.example.test/stale.pdf"),
    );
    expect(screen.queryByTitle("PDF preview: First proposal.pdf")).toBeNull();
    expect(operations.previewArtifactForReview).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Show PDF" }));
    expect(
      await screen.findByTitle("PDF preview: Next proposal.pdf"),
    ).toBeTruthy();
    expect(operations.previewArtifactForReview).toHaveBeenLastCalledWith({
      data: { id: nextArtifactId },
    });
  });
});
