// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import type { TransactionRecord } from "../domain/types";

const operations = vi.hoisted(() => ({
  getFolioUiConfig: vi.fn(),
  getTransaction: vi.fn(),
  listAvailableInvoiceArtifacts: vi.fn(),
  listTransactionFormOptions: vi.fn(),
  confirmArtifactUpload: vi.fn(),
  findArtifactFilenameMatches: vi.fn(),
  importStripeCsv: vi.fn(),
  previewStripeCsv: vi.fn(),
  rejectArtifact: vi.fn(),
  saveManualTransaction: vi.fn(),
  startArtifactUpload: vi.fn(),
  voidTransaction: vi.fn(),
}));

const sessionMock = vi.hoisted(() => vi.fn());
const manualFormProbe = vi.hoisted(() => ({ props: vi.fn() }));
const routerMocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  navigate: vi.fn(),
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

vi.mock("../auth/session-server", () => ({
  getCurrentSession: sessionMock,
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
  importStripeCsv: operations.importStripeCsv,
  previewStripeCsv: operations.previewStripeCsv,
  rejectArtifact: operations.rejectArtifact,
  saveManualTransaction: operations.saveManualTransaction,
  startArtifactUpload: operations.startArtifactUpload,
  voidTransaction: operations.voidTransaction,
}));

import {
  loadManualTransactionRouteData,
  ManualTransactionRoute,
  StripeImportRoute,
  voidTransactionConfirmation,
} from "./-transaction-workflow";

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
  operations.listAvailableInvoiceArtifacts.mockResolvedValue([]);
  operations.startArtifactUpload.mockResolvedValue({
    artifact: { id: "44444444-4444-4444-8444-444444444444" },
    uploadUrl: "https://uploads.example.test/stripe.csv",
  });
  operations.findArtifactFilenameMatches.mockResolvedValue([]);
  operations.confirmArtifactUpload.mockResolvedValue({});
  operations.voidTransaction.mockResolvedValue(undefined);
  operations.importStripeCsv.mockResolvedValue(1);
  operations.previewStripeCsv.mockResolvedValue(stripePreviewResult());
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
  });

  it("warns that restoring a voided transaction is not guaranteed", () => {
    expect(voidTransactionConfirmation("INV-1", "transaction-1")).toBe(
      "Voiding transaction INV-1 may not be reversible. Verify the record before continuing.",
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
      expect(alert.previousElementSibling).toBe(form);
      expect(form?.lastElementChild?.classList.contains("actions")).toBe(true);
      expect(form?.querySelector(".actions.wide")?.contains(saveButton)).toBe(
        true,
      );
    });
    expect(document.activeElement).toBe(screen.getByRole("alert"));
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
    expect(screen.getByText(/may not be reversible/)).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).toBe(voidButton);
    expect(operations.voidTransaction).not.toHaveBeenCalled();
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

    expect(await screen.findByRole("status")).toBeTruthy();
    const returnLink = await screen.findByRole("link", {
      name: "Return to Transactions",
    });
    expect(
      returnLink.classList.contains("transaction-button-link") &&
        returnLink.classList.contains("transaction-button-link--secondary"),
    ).toBe(true);
    expect(returnLink.closest(".manual-entry-form")).toBeNull();
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

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.getByText(/No import was started/)).toBeTruthy();
    expect(screen.getByLabelText("Stripe itemised CSV")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Review preview for stripe.csv" }),
    ).toBeTruthy();
    expect(operations.importStripeCsv).not.toHaveBeenCalled();
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
    expect(screen.getByText(/confirmed artifact is available/)).toBeTruthy();
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

  it("does not claim reuse when upload confirmation has an uncertain outcome", async () => {
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

    expect(await screen.findByText(/may be pending or confirmed/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Retry preview stripe.csv" }),
    ).toBeNull();
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

  it("keeps an unsupported file visible and imports only the reviewed file", async () => {
    const validArtifactId = "55555555-5555-4555-8555-555555555555";
    operations.startArtifactUpload
      .mockResolvedValueOnce({
        artifact: { id: "44444444-4444-4444-8444-444444444444" },
        uploadUrl: "https://uploads.example.test/all-activity.csv",
      })
      .mockResolvedValueOnce({
        artifact: { id: validArtifactId },
        uploadUrl: "https://uploads.example.test/balance.csv",
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
      })
      .mockResolvedValueOnce({
        artifact: { id: retryArtifactId },
        uploadUrl: "https://uploads.example.test/first.csv",
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
      })
      .mockResolvedValueOnce({
        artifact: { id: secondArtifactId },
        uploadUrl: "https://uploads.example.test/second.csv",
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
    operations.importStripeCsv.mockResolvedValueOnce(1);
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
    expect(operations.importStripeCsv).toHaveBeenCalledOnce();
    expect(operations.importStripeCsv).toHaveBeenCalledWith({
      data: { artifactId: firstArtifactId },
    });
    expect(
      await screen.findAllByText(/Already imported — no new rows/),
    ).toHaveLength(2);
  });

  it("retries only failed files after a partial batch result", async () => {
    const firstArtifactId = "44444444-4444-4444-8444-444444444444";
    const secondArtifactId = "55555555-5555-4555-8555-555555555555";
    operations.startArtifactUpload
      .mockResolvedValueOnce({
        artifact: { id: firstArtifactId },
        uploadUrl: "https://uploads.example.test/first.csv",
      })
      .mockResolvedValueOnce({
        artifact: { id: secondArtifactId },
        uploadUrl: "https://uploads.example.test/second.csv",
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
      await screen.findAllByText(/Already imported — no new rows/),
    ).toHaveLength(2);
    expect(operations.importStripeCsv).toHaveBeenCalledOnce();
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
});
