// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { createElement, type ComponentType } from "react";

import {
  buildActivityChartSeries,
  activityChartBar,
  activityChartGeometry,
  artifactDownloadLabel,
  copyText,
  defaultReportingTimezone,
  deriveArtifactRows,
  displaySelectCustomValue,
  displayUserName,
  filterTransactions,
  formatAudAmount,
  formatTransactionDate,
  mergeReportWarnings,
  nextTransactionSort,
  paginateTransactions,
  manualSaveFailureDetail,
  parseTransactionSearch,
  resolveSelectCustomValue,
  resetTransactionFilterField,
  selectCustomValueFor,
  sortTransactions,
  transactionAmountDisplay,
  transactionCounterparty,
  transactionDescription,
  transactionPeriod,
  transactionFiltersForPage,
  transactionFilterValueForOperator,
  transactionPageQueryForSearch,
  transactionStatusFromSubmitter,
  Route,
} from "./transactions";
import { selectAutocompleteOption } from "../components/autocomplete-test-helpers";
import type { TransactionRecord } from "../domain/types";

const selectQueryChipOption = async (
  input: HTMLElement,
  label: string,
  closeMenu = false,
) => {
  const user = userEvent.setup();
  await user.clear(input);
  await user.type(input, label);
  await user.click(await screen.findByRole("option", { name: label }));
  if (closeMenu) await user.keyboard("{Escape}");
};

const operationMocks = vi.hoisted(() => ({
  confirmArtifactUpload: vi.fn(),
  applyBulkTransactionEdit: vi.fn(),
  downloadArtifact: vi.fn(),
  getFolioUiConfig: vi.fn(),
  getReport: vi.fn(),
  importStripeCsv: vi.fn(),
  listAvailableInvoiceArtifacts: vi.fn(),
  listTransactionFormOptions: vi.fn(),
  listTransactionPage: vi.fn(),
  previewBulkTransactionEdit: vi.fn(),
  listWorkspace: vi.fn(),
  saveManualTransaction: vi.fn(),
  startArtifactUpload: vi.fn(),
  voidTransaction: vi.fn(),
}));

const routerMocks = vi.hoisted(() => {
  const defaultSearch = () => ({
    search: "",
    filters: [],
    sort: { key: "date", direction: "desc" },
    sortClauses: [],
    page: 1,
  });
  let currentSearch: Record<string, unknown> = defaultSearch();
  let currentRole: "member" | "viewer" = "member";
  let history = [currentSearch];
  let position = 0;
  const subscribers = new Set<() => void>();
  const publish = () => subscribers.forEach((subscriber) => subscriber());

  return {
    getRole: () => currentRole,
    setRole: (role: "member" | "viewer") => {
      currentRole = role;
    },
    getSearch: () => currentSearch,
    subscribe: (subscriber: () => void) => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    resetSearch: (search: Record<string, unknown> = {}) => {
      currentSearch = { ...defaultSearch(), ...search };
      history = [currentSearch];
      position = 0;
      publish();
    },
    navigate: (options: unknown) => {
      const { search, replace } = options as {
        search:
          | Record<string, unknown>
          | ((previous: Record<string, unknown>) => Record<string, unknown>);
        replace?: boolean;
      };
      const next =
        typeof search === "function" ? search(currentSearch) : search;
      currentSearch = { ...next };
      if (replace) history[position] = currentSearch;
      else {
        history = [...history.slice(0, position + 1), currentSearch];
        position += 1;
      }
      publish();
    },
    back: () => {
      if (position === 0) return;
      currentSearch = history[--position]!;
      publish();
    },
    forward: () => {
      if (position >= history.length - 1) return;
      currentSearch = history[++position]!;
      publish();
    },
    getHistory: () => history.map((entry) => ({ ...entry })),
  };
});

vi.mock("@tanstack/react-router", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    createFileRoute: () => (configuration: Record<string, unknown>) => ({
      ...configuration,
      useLoaderData: () => ({
        authenticated: true,
        user: {
          id: "owner",
          displayName: "Workspace owner",
          email: "owner@example.test",
          role: routerMocks.getRole(),
        },
      }),
      useSearch: () =>
        useSyncExternalStore(
          routerMocks.subscribe,
          routerMocks.getSearch,
          routerMocks.getSearch,
        ),
    }),
    useNavigate: () => routerMocks.navigate,
  };
});

vi.mock("../auth/session-server", () => ({ getCurrentSession: vi.fn() }));
vi.mock("../server/operations", () => operationMocks);
vi.mock("../components/manual-transaction-form", async () => {
  const { createElement } = await import("react");
  return {
    ManualTransactionForm: ({
      busy,
      onSubmit,
    }: {
      busy: boolean;
      onSubmit: (submission: never) => Promise<void> | void;
    }) =>
      createElement(
        "button",
        {
          type: "button",
          disabled: busy,
          onClick: () =>
            void onSubmit({
              action: "save_recorded",
              transaction: { ownerId: "owner" },
              artifactIds: [],
              file: null,
            } as never),
        },
        "Save manual transaction",
      ),
  };
});

const formOptions = {
  users: [],
  entrySuggestions: { counterparties: [], categories: [] },
};

const emptyTransactionPage = {
  rows: [],
  total: 0,
  page: 1,
  pageSize: 50,
};

const lifetimeBalance = {
  basis: "cash",
  basisLabel: "Recorded balance movement view",
  periodType: "month",
  includedCountLabel: "included balance-movement rows",
  lines: [
    {
      period: "2025-07",
      inflowAud: "1200.0000",
      outflowAud: "35.0000",
      netMovementAud: "1165.0000",
      includedCount: 2,
    },
    {
      period: "2026-08",
      inflowAud: "0.0001",
      outflowAud: "20.0000",
      netMovementAud: "-19.9999",
      includedCount: 1,
    },
  ],
  warnings: [
    "row-pending: pending settlement",
    "row-review: review Stripe reporting category",
  ],
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const renderTransactionsPage = async () => {
  const Page = (Route as unknown as { component: ComponentType }).component;
  render(createElement(Page));
  await screen.findByRole("button", { name: "Search" });
  await waitFor(() => expect(transactionButtonDisabled("Search")).toBe(false));
};

const transactionButtonDisabled = (name: string) =>
  (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

beforeEach(() => {
  vi.resetAllMocks();
  routerMocks.setRole("member");
  routerMocks.resetSearch();
  operationMocks.listTransactionFormOptions.mockResolvedValue(formOptions);
  operationMocks.listTransactionPage.mockResolvedValue(emptyTransactionPage);
  operationMocks.previewBulkTransactionEdit.mockResolvedValue({
    change: { field: "counterparty", value: "Updated vendor" },
    rows: [],
    changedCount: 0,
  });
  operationMocks.applyBulkTransactionEdit.mockResolvedValue({
    selectedCount: 0,
    updatedCount: 0,
  });
  operationMocks.getFolioUiConfig.mockResolvedValue({
    gstRegistered: false,
    reportingTimezone: "Australia/Brisbane",
  });
  operationMocks.getReport.mockResolvedValue({ balance: lifetimeBalance });
  operationMocks.listAvailableInvoiceArtifacts.mockResolvedValue([]);
  operationMocks.startArtifactUpload.mockResolvedValue({
    artifact: { id: "artifact-1" },
    uploadUrl: "https://upload.example.test/artifact-1",
  });
  operationMocks.confirmArtifactUpload.mockResolvedValue({ id: "artifact-1" });
  operationMocks.downloadArtifact.mockResolvedValue(
    "https://download.example.test/artifact-1",
  );
  operationMocks.voidTransaction.mockResolvedValue({ status: "voided" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  vi.stubGlobal("crypto", {
    subtle: {
      digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    },
  });
  vi.stubGlobal("File", window.File);
  vi.stubGlobal("FormData", window.FormData);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const transaction = (
  overrides: Partial<TransactionRecord> = {},
): TransactionRecord => ({
  id: "transaction-1",
  ownerId: null,
  sourceArtifactId: null,
  createdById: "actor",
  updatedById: "actor",
  sourceSystem: "manual",
  kind: "supplier_expense",
  reference: "INV-1",
  counterparty: "Acme",
  description: "Hosting",
  status: "recorded",
  category: "Software and subscriptions",
  notes: null,
  occurredAt: null,
  availableAt: null,
  invoiceDate: "2026-07-15",
  settledAt: "2026-07-16T00:00:00Z",
  documentCurrency: "AUD",
  documentAmount: "129.0000",
  documentTaxAmount: null,
  taxTreatment: "gst_included",
  settlementCurrency: "AUD",
  settlementAmount: "129.0000",
  gstCreditStatus: "not_registered",
  claimableGstAud: "0.0000",
  sourceArtifactFilename: null,
  sourceGross: null,
  sourceFee: null,
  sourceNet: null,
  sourceCurrency: null,
  metadata: {},
  createdAt: "2026-07-15T00:00:00Z",
  updatedAt: "2026-07-15T00:00:00Z",
  ...overrides,
});

describe("bulk transaction editing", () => {
  it("selects only eligible current-page rows, previews the captured versions, and applies explicitly", async () => {
    const user = userEvent.setup();
    const selected = transaction({
      id: "11111111-1111-4111-8111-111111111111",
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
    const voided = transaction({
      id: "22222222-2222-4222-8222-222222222222",
      status: "void",
      reference: "INV-VOID",
      description: "Voided hosting",
    });
    operationMocks.listTransactionPage.mockResolvedValue({
      rows: [selected, voided],
      total: 2,
      page: 1,
      pageSize: 50,
    });
    operationMocks.previewBulkTransactionEdit.mockResolvedValue({
      change: { field: "counterparty", value: "Updated vendor" },
      rows: [
        {
          id: selected.id,
          updatedAt: selected.updatedAt,
          counterparty: selected.counterparty,
          category: selected.category,
          ownerId: selected.ownerId,
          reference: selected.reference,
          description: selected.description,
          kind: selected.kind,
          status: selected.status,
          sourceSystem: selected.sourceSystem,
          beforeValue: "Acme",
          afterValue: "Updated vendor",
          changed: true,
        },
      ],
      changedCount: 1,
    });
    operationMocks.applyBulkTransactionEdit.mockResolvedValue({
      selectedCount: 1,
      updatedCount: 1,
    });

    await renderTransactionsPage();
    await user.click(screen.getByRole("button", { name: "Select this page" }));

    const fieldLabel = screen.getByText("Field", { selector: "label" });
    const fieldPicker = screen.getByRole("combobox", { name: "Field" });
    expect(fieldLabel.getAttribute("for")).toBe("bulk-transaction-field");
    expect(fieldPicker.id).toBe("bulk-transaction-field");

    const selectedCheckbox = screen.getByRole("checkbox", {
      name: "Select transaction: Hosting",
    }) as HTMLInputElement;
    expect(selectedCheckbox.checked).toBe(true);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Select transaction: Voided hosting",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);

    await selectAutocompleteOption(fieldPicker, "Operational category");
    expect(
      screen.getByRole("combobox", { name: "Operational category" }),
    ).toBeTruthy();
    await selectAutocompleteOption(fieldPicker, "Counterparty");

    const counterpartyInput = await screen.findByRole("combobox", {
      name: "Counterparty",
    });
    await user.clear(counterpartyInput);
    await user.type(counterpartyInput, "Updated vendor");
    await user.click(screen.getByRole("button", { name: "Preview changes" }));

    await screen.findByText("Updated vendor");
    expect(operationMocks.previewBulkTransactionEdit).toHaveBeenCalledWith({
      data: {
        transactions: [{ id: selected.id, updatedAt: selected.updatedAt }],
        change: { field: "counterparty", value: "Updated vendor" },
      },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Apply changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    await user.click(screen.getByRole("button", { name: "Apply changes" }));
    await screen.findByText(
      "Updated 1 of 1 selected transactions. Options refreshed.",
    );
    expect(operationMocks.applyBulkTransactionEdit).toHaveBeenCalledWith({
      data: {
        transactions: [{ id: selected.id, updatedAt: selected.updatedAt }],
        change: { field: "counterparty", value: "Updated vendor" },
      },
    });
    expect(screen.getByText("0 selected on this page")).toBeTruthy();
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Select transaction: Hosting",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(operationMocks.listTransactionPage).toHaveBeenCalledTimes(2);
    expect(operationMocks.listTransactionFormOptions).toHaveBeenCalledTimes(2);
  });

  it("invalidates a failed apply and requires reloading and reselecting before another preview", async () => {
    const user = userEvent.setup();
    const selected = transaction({
      id: "55555555-5555-4555-8555-555555555555",
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
    const refreshed = transaction({
      ...selected,
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    let pageLoads = 0;
    operationMocks.listTransactionPage.mockImplementation(async () => {
      pageLoads += 1;
      return {
        rows: [pageLoads === 1 ? selected : refreshed],
        total: 1,
        page: 1,
        pageSize: 50,
      };
    });
    operationMocks.previewBulkTransactionEdit.mockImplementation(
      async ({
        data,
      }: {
        data: {
          transactions: { id: string; updatedAt: string }[];
          change: { field: string; value: string };
        };
      }) => ({
        change: data.change,
        rows: [
          {
            id: data.transactions[0]!.id,
            updatedAt: data.transactions[0]!.updatedAt,
            counterparty: "Acme",
            category: "Software and subscriptions",
            ownerId: null,
            reference: "INV-1",
            description: "Hosting",
            kind: "supplier_expense",
            status: "recorded",
            sourceSystem: "manual",
            beforeValue: "Acme",
            afterValue: data.change.value,
            changed: true,
          },
        ],
        changedCount: 1,
      }),
    );
    operationMocks.applyBulkTransactionEdit.mockRejectedValueOnce(
      new Error("update outcome unavailable"),
    );

    await renderTransactionsPage();
    await user.click(screen.getByRole("button", { name: "Select this page" }));
    const input = await screen.findByRole("combobox", {
      name: "Counterparty",
    });
    await user.type(input, "Updated vendor");
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    await screen.findByText("Updated vendor");
    await user.click(screen.getByRole("button", { name: "Apply changes" }));

    expect(
      await screen.findByText(
        /Reload the transaction list and select the transactions again before retrying/,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply changes" })).toBeNull();
    await waitFor(() => expect(pageLoads).toBe(2));

    await user.click(
      screen.getByRole("checkbox", { name: "Select transaction: Hosting" }),
    );
    await screen.findByRole("button", { name: "Preview changes" });
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    await waitFor(() =>
      expect(
        operationMocks.previewBulkTransactionEdit,
      ).toHaveBeenLastCalledWith({
        data: {
          transactions: [{ id: refreshed.id, updatedAt: refreshed.updatedAt }],
          change: { field: "counterparty", value: "Updated vendor" },
        },
      }),
    );
    expect(operationMocks.applyBulkTransactionEdit).toHaveBeenCalledTimes(1);
  });

  it("ignores a late preview after the selected rows change", async () => {
    const user = userEvent.setup();
    const first = transaction({
      id: "66666666-6666-4666-8666-666666666666",
      description: "First bulk row",
    });
    const second = transaction({
      id: "77777777-7777-4777-8777-777777777777",
      description: "Second bulk row",
    });
    const pendingPreview = deferred<unknown>();
    operationMocks.listTransactionPage.mockResolvedValue({
      rows: [first, second],
      total: 2,
      page: 1,
      pageSize: 50,
    });
    operationMocks.previewBulkTransactionEdit.mockReturnValueOnce(
      pendingPreview.promise,
    );

    await renderTransactionsPage();
    await user.click(screen.getByRole("button", { name: "Select this page" }));
    const counterpartyInput = await screen.findByRole("combobox", {
      name: "Counterparty",
    });
    await user.type(counterpartyInput, "Updated vendor");
    await user.click(screen.getByRole("button", { name: "Preview changes" }));

    await user.click(
      screen.getByRole("checkbox", {
        name: "Select transaction: Second bulk row",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("1 selected on this page")).toBeTruthy(),
    );
    pendingPreview.resolve({
      change: { field: "counterparty", value: "Updated vendor" },
      rows: [first, second].map((item) => ({
        id: item.id,
        updatedAt: item.updatedAt,
        counterparty: item.counterparty,
        category: item.category,
        ownerId: item.ownerId,
        reference: item.reference,
        description: item.description,
        kind: item.kind,
        status: item.status,
        sourceSystem: item.sourceSystem,
        beforeValue: "Acme",
        afterValue: "Updated vendor",
        changed: true,
      })),
      changedCount: 2,
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Preview changes" }),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByRole("table", { name: "Transaction change preview" }),
    ).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Apply changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("keeps Apply disabled when a preview has no changed rows", async () => {
    const user = userEvent.setup();
    const selected = transaction({
      id: "88888888-8888-4888-8888-888888888888",
    });
    operationMocks.listTransactionPage.mockResolvedValue({
      rows: [selected],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    operationMocks.previewBulkTransactionEdit.mockResolvedValue({
      change: { field: "counterparty", value: "Acme" },
      rows: [
        {
          id: selected.id,
          updatedAt: selected.updatedAt,
          counterparty: selected.counterparty,
          category: selected.category,
          ownerId: selected.ownerId,
          reference: selected.reference,
          description: selected.description,
          kind: selected.kind,
          status: selected.status,
          sourceSystem: selected.sourceSystem,
          beforeValue: "Acme",
          afterValue: "Acme",
          changed: false,
        },
      ],
      changedCount: 0,
    });

    await renderTransactionsPage();
    await user.click(screen.getByRole("button", { name: "Select this page" }));
    const counterpartyInput = await screen.findByRole("combobox", {
      name: "Counterparty",
    });
    await user.type(counterpartyInput, "Acme");
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    await screen.findByText("Unchanged");

    expect(
      (
        screen.getByRole("button", {
          name: "Apply changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(operationMocks.applyBulkTransactionEdit).not.toHaveBeenCalled();
  });

  it("combines default and saved category suggestions without duplicate options and keeps custom entry", async () => {
    const user = userEvent.setup();
    const selected = transaction({
      id: "12121212-1212-4212-8212-121212121212",
    });
    operationMocks.listTransactionPage.mockResolvedValue({
      rows: [selected],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    operationMocks.listTransactionFormOptions.mockResolvedValue({
      users: [],
      entrySuggestions: {
        counterparties: [],
        categories: [
          "Advertising and marketing",
          "Saved team category",
          "Advertising and marketing",
        ],
      },
    });

    await renderTransactionsPage();
    await user.click(screen.getByRole("button", { name: "Select this page" }));
    const fieldPicker = screen.getByRole("combobox", { name: "Field" });
    await selectAutocompleteOption(fieldPicker, "Operational category");
    const categoryInput = await screen.findByRole("combobox", {
      name: "Operational category",
    });

    await user.click(categoryInput);
    expect(
      await screen.findAllByRole("option", {
        name: "Advertising and marketing",
      }),
    ).toHaveLength(1);
    await user.type(categoryInput, "Saved");
    await user.click(
      await screen.findByRole("option", { name: "Saved team category" }),
    );
    expect((categoryInput as HTMLInputElement).value).toBe(
      "Saved team category",
    );

    await user.clear(categoryInput);
    await user.type(categoryInput, "Custom one-off category");
    await user.click(screen.getByRole("button", { name: "Preview changes" }));

    await waitFor(() =>
      expect(
        operationMocks.previewBulkTransactionEdit,
      ).toHaveBeenLastCalledWith({
        data: {
          transactions: [{ id: selected.id, updatedAt: selected.updatedAt }],
          change: { field: "category", value: "Custom one-off category" },
        },
      }),
    );
  });

  it("offers built-in category suggestions when there are no saved categories", async () => {
    const user = userEvent.setup();
    const selected = transaction({
      id: "16161616-1616-4616-8616-161616161616",
    });
    operationMocks.listTransactionPage.mockResolvedValue({
      rows: [selected],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    operationMocks.listTransactionFormOptions.mockResolvedValue({
      users: [],
      entrySuggestions: { counterparties: [], categories: [] },
    });

    await renderTransactionsPage();
    await user.click(screen.getByRole("button", { name: "Select this page" }));
    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Field" }),
      "Operational category",
    );
    const categoryInput = await screen.findByRole("combobox", {
      name: "Operational category",
    });
    await user.click(categoryInput);

    expect(
      await screen.findByRole("option", {
        name: "Advertising and marketing",
      }),
    ).toBeTruthy();
  });

  it("renders a semantic preview table with transaction context, resolved values, and outcomes", async () => {
    const user = userEvent.setup();
    const owner = {
      id: "13131313-1313-4313-8313-131313131313",
      displayName: "Preview owner",
      email: "preview-owner@example.test",
      role: "member" as const,
      active: true,
    };
    const changed = transaction({
      id: "14141414-1414-4414-8414-141414141414",
      reference: "INV-PREVIEW-1",
      counterparty: "Acme",
      description: "Monthly subscription",
      sourceSystem: "stripe",
      status: "recorded",
    });
    const unchanged = transaction({
      id: "15151515-1515-4515-8515-151515151515",
      reference: null,
      counterparty: "Northwind",
      description: null,
      kind: "sale_refund",
      sourceSystem: "manual",
      status: "draft",
    });
    operationMocks.listTransactionFormOptions.mockResolvedValue({
      users: [owner],
      entrySuggestions: { counterparties: [], categories: [] },
    });
    operationMocks.listTransactionPage.mockResolvedValue({
      rows: [changed, unchanged],
      total: 2,
      page: 1,
      pageSize: 50,
    });
    operationMocks.previewBulkTransactionEdit.mockResolvedValue({
      change: { field: "ownerId", value: owner.id },
      rows: [
        {
          id: changed.id,
          updatedAt: changed.updatedAt,
          counterparty: changed.counterparty,
          category: changed.category,
          ownerId: null,
          reference: changed.reference,
          description: changed.description,
          kind: changed.kind,
          status: changed.status,
          sourceSystem: changed.sourceSystem,
          beforeValue: null,
          afterValue: owner.id,
          changed: true,
        },
        {
          id: unchanged.id,
          updatedAt: unchanged.updatedAt,
          counterparty: unchanged.counterparty,
          category: unchanged.category,
          ownerId: owner.id,
          reference: unchanged.reference,
          description: unchanged.description,
          kind: unchanged.kind,
          status: unchanged.status,
          sourceSystem: unchanged.sourceSystem,
          beforeValue: owner.id,
          afterValue: owner.id,
          changed: false,
        },
      ],
      changedCount: 1,
    });

    await renderTransactionsPage();
    await user.click(screen.getByRole("button", { name: "Select this page" }));
    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Field" }),
      "Owner",
    );
    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Owner" }),
      "Preview owner",
    );
    await user.click(screen.getByRole("button", { name: "Preview changes" }));

    const table = await screen.findByRole("table", {
      name: "Transaction change preview",
    });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Transaction", "Type", "Current value", "New value", "Result"]);
    expect(screen.getByText("1 changed")).toBeTruthy();
    expect(screen.getByText("1 unchanged")).toBeTruthy();
    expect(
      screen.getByText(
        /Editing transaction metadata may make saved tax review results out of date/,
      ),
    ).toBeTruthy();

    const previewRows = within(table).getAllByRole("row").slice(1);
    const changedCells = within(previewRows[0]!).getAllByRole("cell");
    expect(changedCells[0]!.textContent).toContain("INV-PREVIEW-1");
    expect(changedCells[0]!.textContent).toContain("Acme");
    expect(changedCells[0]!.textContent).toContain("Monthly subscription");
    expect(
      changedCells[0]!.querySelector(
        ".bulk-transaction-editor__context-primary",
      )?.textContent,
    ).toBe("Acme · INV-PREVIEW-1");
    expect(
      changedCells[0]!
        .querySelector(".bulk-transaction-editor__context-secondary")
        ?.getAttribute("title"),
    ).toBe("Monthly subscription");
    expect(changedCells[1]!.textContent).toContain("Supplier expense");
    expect(changedCells[1]!.textContent).toContain("Stripe import");
    expect(changedCells[1]!.textContent).toContain("Recorded");
    expect(
      changedCells[1]!.querySelector(
        ".bulk-transaction-editor__context-secondary",
      )?.textContent,
    ).toBe("Stripe import · Recorded");
    expect(changedCells[2]!.textContent).toBe("—");
    expect(changedCells[3]!.textContent).toBe("Preview owner");
    expect(changedCells[4]!.textContent).toBe("Changed");

    const unchangedCells = within(previewRows[1]!).getAllByRole("cell");
    expect(unchangedCells[0]!.textContent).toContain("Northwind");
    expect(unchangedCells[0]!.textContent).toContain(unchanged.id);
    expect(
      unchangedCells[0]!.querySelector(
        ".bulk-transaction-editor__context-primary",
      )?.textContent,
    ).toBe(`Northwind · ${unchanged.id}`);
    expect(
      unchangedCells[0]!.querySelector(
        ".bulk-transaction-editor__context-secondary",
      ),
    ).toBeNull();
    expect(unchangedCells[1]!.textContent).toContain("Sale refund");
    expect(unchangedCells[1]!.textContent).toContain("Manual entry");
    expect(unchangedCells[1]!.textContent).toContain("Draft");
    expect(unchangedCells[2]!.textContent).toBe("Preview owner");
    expect(unchangedCells[3]!.textContent).toBe("Preview owner");
    expect(unchangedCells[4]!.textContent).toBe("Unchanged");
  });

  it("releases page busy state when navigation unmounts the editor during apply", async () => {
    const user = userEvent.setup();
    const selected = transaction({
      id: "99999999-9999-4999-8999-999999999999",
      description: "Pending apply row",
    });
    const nextPageRow = transaction({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      description: "Next page row",
    });
    const pendingApply = deferred<{
      selectedCount: number;
      updatedCount: number;
    }>();
    operationMocks.listTransactionPage.mockImplementation(
      async ({ data }: { data: { page: number } }) => ({
        rows: [data.page === 1 ? selected : nextPageRow],
        total: 51,
        page: data.page,
        pageSize: 50,
      }),
    );
    operationMocks.previewBulkTransactionEdit.mockResolvedValue({
      change: { field: "counterparty", value: "Updated vendor" },
      rows: [
        {
          id: selected.id,
          updatedAt: selected.updatedAt,
          counterparty: selected.counterparty,
          category: selected.category,
          ownerId: selected.ownerId,
          reference: selected.reference,
          description: selected.description,
          kind: selected.kind,
          status: selected.status,
          sourceSystem: selected.sourceSystem,
          beforeValue: "Acme",
          afterValue: "Updated vendor",
          changed: true,
        },
      ],
      changedCount: 1,
    });
    operationMocks.applyBulkTransactionEdit.mockReturnValueOnce(
      pendingApply.promise,
    );

    await renderTransactionsPage();
    await user.click(screen.getByRole("button", { name: "Select this page" }));
    const counterpartyInput = await screen.findByRole("combobox", {
      name: "Counterparty",
    });
    await user.type(counterpartyInput, "Updated vendor");
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    await screen.findByText("Updated vendor");
    await user.click(screen.getByRole("button", { name: "Apply changes" }));

    const transactionRegion = screen.getByRole("region", {
      name: "Transactions",
    });
    await waitFor(() =>
      expect(transactionRegion.hasAttribute("inert")).toBe(true),
    );
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Select all visible transactions",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    routerMocks.navigate({
      search: { ...routerMocks.getSearch(), page: 2 },
    });
    await screen.findByRole("checkbox", {
      name: "Select transaction: Next page row",
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Edit selected transactions" }),
      ).toBeNull(),
    );
    expect(transactionRegion.hasAttribute("inert")).toBe(true);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Select all visible transactions",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);

    pendingApply.resolve({ selectedCount: 1, updatedCount: 1 });
    await waitFor(() =>
      expect(transactionRegion.hasAttribute("inert")).toBe(false),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("checkbox", {
            name: "Select transaction: Next page row",
          }) as HTMLInputElement
        ).disabled,
      ).toBe(false),
    );
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Select all visible transactions",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(false);
  });

  it("clears the selection and preview when the page changes", async () => {
    const user = userEvent.setup();
    const firstPageRow = transaction({
      id: "33333333-3333-4333-8333-333333333333",
    });
    const secondPageRow = transaction({
      id: "44444444-4444-4444-8444-444444444444",
      reference: "INV-2",
      description: "Second page hosting",
    });
    operationMocks.listTransactionPage.mockImplementation(
      async ({ data }: { data: { page: number } }) => ({
        rows: [data.page === 1 ? firstPageRow : secondPageRow],
        total: 51,
        page: data.page,
        pageSize: 50,
      }),
    );

    await renderTransactionsPage();
    await user.click(screen.getByRole("button", { name: "Select this page" }));
    expect(screen.getByText("1 selected on this page")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Next" }));
    const nextPageCheckbox = await screen.findByRole("checkbox", {
      name: "Select transaction: Second page hosting",
    });
    await waitFor(() =>
      expect(screen.getByText("0 selected on this page")).toBeTruthy(),
    );
    expect((nextPageCheckbox as HTMLInputElement).checked).toBe(false);
    expect(
      screen.queryByRole("heading", { name: "Edit selected transactions" }),
    ).toBeNull();
  });

  it("does not expose transaction selection to a viewer", async () => {
    routerMocks.setRole("viewer");
    operationMocks.listTransactionPage.mockResolvedValue({
      rows: [transaction()],
      total: 1,
      page: 1,
      pageSize: 50,
    });

    await renderTransactionsPage();

    expect(
      screen.queryByRole("button", { name: "Select this page" }),
    ).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("selects and clears every eligible visible row from the mixed header checkbox", async () => {
    const user = userEvent.setup();
    const first = transaction({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      description: "First header row",
    });
    const second = transaction({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      description: "Second header row",
    });
    const voided = transaction({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      status: "void",
      description: "Void header row",
    });
    operationMocks.listTransactionPage.mockResolvedValue({
      rows: [first, second, voided],
      total: 3,
      page: 1,
      pageSize: 50,
    });

    await renderTransactionsPage();

    const headerCheckbox = screen.getByRole("checkbox", {
      name: "Select all visible transactions",
    }) as HTMLInputElement;
    expect(headerCheckbox.checked).toBe(false);
    expect(headerCheckbox.indeterminate).toBe(false);

    await user.click(
      screen.getByRole("checkbox", {
        name: "Select transaction: First header row",
      }),
    );

    expect(headerCheckbox.checked).toBe(false);
    expect(headerCheckbox.indeterminate).toBe(true);
    expect(headerCheckbox.getAttribute("aria-checked")).toBe("mixed");

    await user.click(headerCheckbox);

    expect(
      (
        screen.getByRole("checkbox", {
          name: "Select transaction: First header row",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Select transaction: Second header row",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Select transaction: Void header row",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(headerCheckbox.checked).toBe(true);
    expect(headerCheckbox.indeterminate).toBe(false);

    await user.click(headerCheckbox);
    expect(headerCheckbox.checked).toBe(false);
    expect(headerCheckbox.indeterminate).toBe(false);
    expect(screen.getByText("0 selected on this page")).toBeTruthy();
  });

  it("disables the header checkbox while loading and when there are no eligible rows", async () => {
    const pendingPage = deferred<{
      rows: TransactionRecord[];
      total: number;
      page: number;
      pageSize: number;
    }>();
    operationMocks.listTransactionPage.mockReturnValueOnce(pendingPage.promise);
    const Page = (Route as unknown as { component: ComponentType }).component;
    render(createElement(Page));

    const headerCheckbox = await screen.findByRole("checkbox", {
      name: "Select all visible transactions",
    });
    expect((headerCheckbox as HTMLInputElement).disabled).toBe(true);

    const voided = transaction({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      status: "void",
      description: "Only void row",
    });
    pendingPage.resolve({ rows: [voided], total: 1, page: 1, pageSize: 50 });

    await waitFor(() => {
      expect((headerCheckbox as HTMLInputElement).disabled).toBe(true);
    });
    expect(
      (headerCheckbox as HTMLInputElement).getAttribute("aria-checked"),
    ).toBe("false");
  });
});

describe("manual entry submitter controls", () => {
  it("uses the clicked recorded submitter when editing a draft", () => {
    expect(
      transactionStatusFromSubmitter(
        { name: "saveStatus", value: "recorded" },
        "draft",
      ),
    ).toBe("recorded");
  });

  it("uses the clicked draft submitter for a new record", () => {
    expect(
      transactionStatusFromSubmitter(
        { name: "saveStatus", value: "draft" },
        "recorded",
      ),
    ).toBe("draft");
  });

  it("keeps the existing status when no save submitter is present", () => {
    expect(transactionStatusFromSubmitter(null, "recorded")).toBe("recorded");
  });

  it("falls back to the owner email when the display name is blank", () => {
    expect(
      displayUserName({ displayName: "  ", email: "owner@example.test" }),
    ).toBe("owner@example.test");
  });
});

describe("manual entry select values", () => {
  it("preserves raw custom text while displaying an in-progress value", () => {
    expect(displaySelectCustomValue("__folio_other__", "Director ")).toBe(
      "Director ",
    );
    expect(resolveSelectCustomValue("__folio_other__", "Director ")).toBe(
      "Director",
    );
  });

  it("displays known choices without using the custom value", () => {
    expect(displaySelectCustomValue("Acme", "Director ")).toBe("Acme");
  });

  it("serializes an existing value through the visible option", () => {
    const selection = selectCustomValueFor("Software and subscriptions", [
      "Software and subscriptions",
      "Travel and accommodation",
    ]);

    expect(
      resolveSelectCustomValue(selection.choice, selection.customValue),
    ).toBe("Software and subscriptions");
    expect(selection.customValue).toBe("");
  });

  it("serializes an arbitrary value through the custom input", () => {
    const selection = selectCustomValueFor("Acme Building-Supplies", ["Acme"]);

    expect(selection.choice).toBe("__folio_other__");
    expect(
      resolveSelectCustomValue(selection.choice, selection.customValue),
    ).toBe("Acme Building-Supplies");
  });

  it("treats blank optional values as absent", () => {
    expect(resolveSelectCustomValue("__folio_other__", "  ")).toBeNull();
  });
});

describe("manual save failure guidance", () => {
  it("requires checking the transaction list when the database outcome is uncertain", () => {
    const detail = manualSaveFailureDetail(
      "The result is uncertain. Code DB_OUTCOME_UNKNOWN. Reference ref-123.",
      "artifact-123",
    );

    expect(detail).toContain("Code DB_OUTCOME_UNKNOWN. Reference ref-123.");
    expect(detail).toContain("transaction outcome is uncertain");
    expect(detail).toContain("Inspect or reload the transaction list");
    expect(detail).not.toContain("Transaction was not saved");
    expect(detail).not.toContain("Retry save");
  });

  it("preserves confirmed evidence and retry guidance for a definitive save failure", () => {
    const detail = manualSaveFailureDetail(
      "The operation failed. Code DATABASE_UNAVAILABLE. Reference ref-456.",
      "artifact-456",
    );

    expect(detail).toContain("Code DATABASE_UNAVAILABLE. Reference ref-456.");
    expect(detail).toContain("Transaction was not saved");
    expect(detail).toContain("artifact artifact-456");
    expect(detail).toContain("retry save to link it without re-uploading");
  });
});

describe("transaction review presentation", () => {
  it("validates URL search state and drops incomplete server filters", () => {
    const search = parseTransactionSearch({
      search: "  Acme  ",
      filters: [{ field: "status", operator: "is", value: "recorded" }],
      sort: { key: "amount", direction: "asc" },
      page: "3",
    });

    expect(search).toEqual({
      search: "Acme",
      filters: [{ field: "status", operator: "is", value: "recorded" }],
      sort: { key: "amount", direction: "asc" },
      sortClauses: [],
      page: 3,
    });
    expect(
      transactionFiltersForPage([
        { id: 1, field: "status", operator: "is", value: "recorded" },
        { id: 2, field: "amount", operator: "equals", value: "" },
      ]),
    ).toEqual([{ field: "status", operator: "is", value: "recorded" }]);
    expect(transactionPageQueryForSearch(search)).toEqual({
      search: "Acme",
      filters: [{ field: "status", operator: "is", value: "recorded" }],
      sort: { key: "amount", direction: "asc" },
      page: 3,
    });
  });

  it("round-trips bounded enum membership filters beside legacy enum filters", () => {
    const search = parseTransactionSearch({
      filters: [
        {
          field: "status",
          operator: "contains_any",
          value: ["draft", "recorded"],
        },
        { field: "source", operator: "contains_none", value: [] },
        { field: "evidence", operator: "is_not", value: "missing" },
      ],
    });

    expect(search.filters).toEqual([
      {
        field: "status",
        operator: "contains_any",
        value: ["draft", "recorded"],
      },
      { field: "source", operator: "contains_none", value: [] },
      { field: "evidence", operator: "is_not", value: "missing" },
    ]);
    expect(transactionPageQueryForSearch(search).filters).toEqual(
      search.filters,
    );
    expect(
      transactionFiltersForPage([
        {
          id: 1,
          field: "status",
          operator: "contains_any",
          value: ["recorded", "invalid"],
        },
      ]),
    ).toEqual([]);
  });

  it("immediately applies bookmarked enum membership values to the page query", async () => {
    routerMocks.resetSearch(
      parseTransactionSearch({
        filters: [
          { field: "status", operator: "contains_any", value: ["recorded"] },
        ],
      }),
    );

    await renderTransactionsPage();
    expect(
      screen.getByRole("button", {
        name: "Edit Filter Status contains any of Recorded",
      }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(operationMocks.listTransactionPage).toHaveBeenCalledWith({
        data: expect.objectContaining({
          filters: [
            { field: "status", operator: "contains_any", value: ["recorded"] },
          ],
        }),
      }),
    );
    expect(routerMocks.getSearch().filters).toEqual([
      { field: "status", operator: "contains_any", value: ["recorded"] },
    ]);
  });

  it("applies ordered transaction sort clauses and preserves their URL state", async () => {
    routerMocks.resetSearch(
      parseTransactionSearch({
        sortClauses: [
          { key: "state", direction: "asc" },
          { key: "amount", direction: "desc" },
        ],
      }),
    );

    await renderTransactionsPage();

    expect(operationMocks.listTransactionPage).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sortClauses: [
          { key: "state", direction: "asc" },
          { key: "amount", direction: "desc" },
        ],
      }),
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Move Sort Amount Descending up",
      }),
    );
    await waitFor(() =>
      expect(routerMocks.getSearch().sortClauses).toEqual([
        { key: "amount", direction: "desc" },
        { key: "state", direction: "asc" },
      ]),
    );
    await waitFor(() =>
      expect(operationMocks.listTransactionPage).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
          sortClauses: [
            { key: "amount", direction: "desc" },
            { key: "state", direction: "asc" },
          ],
        }),
      }),
    );
  });

  it("applies mixed clauses in chip order and preserves sort shortcuts", async () => {
    routerMocks.resetSearch(parseTransactionSearch({ page: "3" }));
    operationMocks.listTransactionPage.mockImplementation(
      async ({ data }: { data: { page: number } }) => ({
        ...emptyTransactionPage,
        page: data.page,
      }),
    );

    await renderTransactionsPage();
    const builderLabel = "Transaction filter and sort builder";
    const builder = screen.getByRole("region", { name: builderLabel });
    expect(builder).toBeTruthy();
    await waitFor(() =>
      expect(operationMocks.listTransactionPage).toHaveBeenCalledTimes(1),
    );
    expect(routerMocks.getSearch().page).toBe(3);

    const addClause = () =>
      screen.getByRole("combobox", {
        name: `${builderLabel} add filter or sort`,
      });
    await selectQueryChipOption(addClause(), "Filter · Status", true);
    await selectQueryChipOption(
      screen.getByRole("combobox", { name: "Status contains any of values" }),
      "Recorded",
      true,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply filter clause" }),
    );

    await selectQueryChipOption(addClause(), "Sort · Amount", true);
    await selectQueryChipOption(
      screen.getByRole("combobox", {
        name: `${builderLabel} sort direction`,
      }),
      "Descending",
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply sort clause" }));

    await selectQueryChipOption(addClause(), "Filter · Description", true);
    fireEvent.change(screen.getByLabelText("Description contains value"), {
      target: { value: "Hosting" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply filter clause" }),
    );

    const statusFilter = {
      kind: "filter",
      clause: {
        field: "status",
        operator: "contains_any",
        value: ["recorded"],
      },
    };
    const descriptionFilter = {
      kind: "filter",
      clause: {
        field: "description",
        operator: "contains",
        value: "Hosting",
      },
    };
    const dateSort = {
      kind: "sort",
      clause: { key: "date", direction: "desc" },
    };
    const amountSort = {
      kind: "sort",
      clause: { key: "amount", direction: "desc" },
    };
    const initialOrder = [
      dateSort,
      statusFilter,
      amountSort,
      descriptionFilter,
    ];
    const finalQuery = {
      data: {
        search: "",
        filters: [statusFilter.clause, descriptionFilter.clause],
        sort: dateSort.clause,
        sortClauses: [dateSort.clause, amountSort.clause],
        page: 1,
      },
    };

    await waitFor(() => {
      expect(routerMocks.getSearch().page).toBe(1);
      expect(routerMocks.getSearch().clauses).toEqual(initialOrder);
      expect(routerMocks.getSearch().filters).toEqual([
        statusFilter.clause,
        descriptionFilter.clause,
      ]);
      expect(routerMocks.getSearch().sortClauses).toEqual([
        dateSort.clause,
        amountSort.clause,
      ]);
      expect(operationMocks.listTransactionPage).toHaveBeenLastCalledWith(
        finalQuery,
      );
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Move Filter Description contains Hosting up",
      }),
    );
    const reorderedClauses = [
      dateSort,
      statusFilter,
      descriptionFilter,
      amountSort,
    ];
    await waitFor(() =>
      expect(routerMocks.getSearch().clauses).toEqual(reorderedClauses),
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear sorts" }));
    const resetSortOrder = [statusFilter, descriptionFilter, dateSort];
    await waitFor(() => {
      expect(routerMocks.getSearch().clauses).toEqual(resetSortOrder);
      expect(routerMocks.getSearch().sort).toEqual(dateSort.clause);
      expect(routerMocks.getSearch().sortClauses).toEqual([]);
    });
    await waitFor(() =>
      expect(operationMocks.listTransactionPage).toHaveBeenLastCalledWith({
        data: {
          search: "",
          filters: [statusFilter.clause, descriptionFilter.clause],
          sort: dateSort.clause,
          page: 1,
        },
      }),
    );

    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Sort by" }),
      "Amount",
    );
    await waitFor(() =>
      expect(routerMocks.getSearch().sort).toEqual({
        key: "amount",
        direction: "asc",
      }),
    );
    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Direction" }),
      "Descending",
    );
    await waitFor(() => {
      expect(routerMocks.getSearch().sort).toEqual(amountSort.clause);
      expect(routerMocks.getSearch().clauses).toEqual([
        statusFilter,
        descriptionFilter,
        { kind: "sort", clause: amountSort.clause },
      ]);
    });
  }, 15_000);

  it("loads the exact server page represented by a direct URL", async () => {
    routerMocks.resetSearch(
      parseTransactionSearch({
        search: " Acme ",
        filters: [{ field: "status", operator: "is", value: "recorded" }],
        sort: { key: "amount", direction: "asc" },
        page: "2",
      }),
    );
    operationMocks.listTransactionPage.mockImplementation(
      async ({ data }: { data: { page: number } }) => ({
        rows: [transaction({ id: "server-page-row" })],
        total: 51,
        page: data.page,
        pageSize: 50,
      }),
    );

    await renderTransactionsPage();

    expect(operationMocks.listTransactionFormOptions).not.toHaveBeenCalled();
    expect(operationMocks.listWorkspace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Search")).toHaveProperty("value", "Acme");
    expect(
      screen.getByRole("button", { name: "Edit Filter Status is Recorded" }),
    ).toBeTruthy();
    expect(operationMocks.listTransactionPage).toHaveBeenCalledWith({
      data: {
        search: "Acme",
        filters: [{ field: "status", operator: "is", value: "recorded" }],
        sort: { key: "amount", direction: "asc" },
        page: 2,
      },
    });
    expect(await screen.findByText("Acme")).toBeTruthy();
    expect(screen.getByText("Showing 51–51 of 51; page 2 of 2.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      expect(routerMocks.getSearch().filters).toEqual([]);
      expect(routerMocks.getSearch().page).toBe(1);
    });
    await waitFor(() =>
      expect(operationMocks.listTransactionPage).toHaveBeenCalledTimes(2),
    );
    expect(operationMocks.listTransactionPage).toHaveBeenLastCalledWith({
      data: {
        search: "Acme",
        filters: [],
        sort: { key: "amount", direction: "asc" },
        page: 1,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Counterparty" }));
    await waitFor(() =>
      expect(operationMocks.listTransactionPage).toHaveBeenCalledTimes(3),
    );
    expect(
      await screen.findByText("Showing 1–50 of 51; page 1 of 2."),
    ).toBeTruthy();
    expect(routerMocks.getSearch()).toMatchObject({
      sort: { key: "counterparty", direction: "asc" },
      page: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(routerMocks.getSearch().page).toBe(2));
    await waitFor(() =>
      expect(operationMocks.listTransactionPage).toHaveBeenCalledTimes(4),
    );
    expect(operationMocks.listTransactionPage).toHaveBeenLastCalledWith({
      data: {
        search: "Acme",
        filters: [],
        sort: { key: "counterparty", direction: "asc" },
        page: 2,
      },
    });
  });

  it("replaces an out-of-range URL page with the server-clamped page", async () => {
    routerMocks.resetSearch(parseTransactionSearch({ page: "9" }));
    operationMocks.listTransactionPage.mockImplementation(
      async ({ data }: { data: { page: number } }) => ({
        rows: [transaction({ id: "clamped-page-row" })],
        total: 51,
        page: Math.min(data.page, 2),
        pageSize: 50,
      }),
    );

    await renderTransactionsPage();

    await waitFor(() => expect(routerMocks.getSearch().page).toBe(2));
    await waitFor(() =>
      expect(operationMocks.listTransactionPage).toHaveBeenCalledTimes(2),
    );
    expect(routerMocks.getHistory()).toHaveLength(1);
    expect(
      operationMocks.listTransactionPage.mock.calls.map(
        ([input]) => (input as { data: { page: number } }).data.page,
      ),
    ).toEqual([9, 2]);
    expect(screen.getByText("Showing 51–51 of 51; page 2 of 2.")).toBeTruthy();
  });

  it("restores search and page data through browser back and forward", async () => {
    await renderTransactionsPage();
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "Acme" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Search" }).closest("form")!,
    );

    await waitFor(() => expect(routerMocks.getSearch().search).toBe("Acme"));
    await waitFor(() =>
      expect(operationMocks.listTransactionPage).toHaveBeenCalledTimes(2),
    );
    routerMocks.back();
    await waitFor(() =>
      expect(screen.getByLabelText("Search")).toHaveProperty("value", ""),
    );
    await waitFor(() =>
      expect(operationMocks.listTransactionPage).toHaveBeenCalledTimes(3),
    );

    routerMocks.forward();
    await waitFor(() =>
      expect(screen.getByLabelText("Search")).toHaveProperty("value", "Acme"),
    );
    await waitFor(() =>
      expect(operationMocks.listTransactionPage).toHaveBeenCalledTimes(4),
    );
    expect(routerMocks.getSearch().search).toBe("Acme");
  });

  it("uses readable fallbacks and AUD-primary amount formatting", () => {
    const stripe = transaction({
      id: "stripe-1",
      sourceSystem: "stripe",
      kind: "sale",
      counterparty: null,
      description: null,
      invoiceDate: null,
      occurredAt: "2026-07-16T00:00:00Z",
      settledAt: null,
      documentCurrency: null,
      documentAmount: null,
      settlementCurrency: null,
      settlementAmount: null,
      sourceCurrency: "USD",
      sourceGross: "130.0000",
      sourceFee: "1.0000",
      sourceNet: "129.0000",
    });

    expect(transactionCounterparty(stripe)).toBe("Stripe");
    expect(transactionDescription(stripe)).toBe("Sale");
    expect(formatAudAmount("129.0000")).toBe("+$129.00");
    expect(transactionAmountDisplay(stripe)).toMatchObject({
      aud: null,
      source: "+USD 129.00",
      detail: "Gross +USD 130.00 · Fee -USD 1.00",
      tone: "positive",
    });
  });

  it("uses the configured reporting timezone at a period boundary", () => {
    const stripe = transaction({
      sourceSystem: "stripe",
      invoiceDate: null,
      occurredAt: "2026-06-30T15:00:00Z",
    });

    expect(defaultReportingTimezone).toBe("Australia/Brisbane");
    expect(transactionPeriod(stripe, "Australia/Brisbane")).toBe("2026-07");
    expect(formatTransactionDate(stripe, "Australia/Brisbane")).toBe(
      "01 July 2026",
    );
    expect(transactionPeriod(stripe, "UTC")).toBe("2026-06");

    expect(
      formatTransactionDate(
        transaction({ invoiceDate: "2026-05-16" }),
        "Pacific/Honolulu",
      ),
    ).toBe("16 May 2026");
  });

  it("filters invoice status independently of generic evidence and financial status", () => {
    const rows = [
      transaction({
        id: "missing-invoice",
        kind: "supplier_expense",
        sourceArtifactId: null,
      }),
      transaction({
        id: "draft-missing",
        kind: "supplier_expense",
        status: "draft",
        sourceArtifactId: null,
      }),
      transaction({
        id: "missing-credit",
        kind: "supplier_credit",
        sourceArtifactId: null,
      }),
      transaction({ id: "loan", kind: "owner_loan", sourceArtifactId: null }),
      transaction({
        id: "stripe-csv",
        kind: "processing_fee",
        sourceSystem: "stripe",
        sourceArtifactId: "csv",
      }),
      transaction({
        id: "invoice",
        kind: "supplier_expense",
        sourceArtifactId: "pdf",
        sourceArtifacts: [
          {
            id: "pdf",
            artifactProfile: "manual_invoice_pdf_v1",
            filename: "synthetic-invoice.pdf",
            state: "available",
            metadata: null,
          },
        ],
      }),
    ];
    expect(
      filterTransactions(rows, [
        { id: 1, field: "status", operator: "is", value: "recorded" },
        {
          id: 2,
          field: "invoice",
          operator: "contains_any",
          value: ["missing"],
        },
      ]).map((row) => row.id),
    ).toEqual(["missing-invoice", "missing-credit"]);
    expect(
      filterTransactions(rows, [
        { id: 1, field: "invoice", operator: "is", value: "not_expected" },
      ]).map((row) => row.id),
    ).toEqual(["loan", "stripe-csv"]);
    expect(
      parseTransactionSearch({
        filters: [
          {
            field: "invoice",
            operator: "contains_any",
            value: ["missing", "not_expected"],
          },
        ],
      }).filters,
    ).toEqual([
      {
        field: "invoice",
        operator: "contains_any",
        value: ["missing", "not_expected"],
      },
    ]);
  });

  it("filters, sorts deterministically, and paginates at fifty rows", () => {
    const rows = Array.from({ length: 52 }, (_, index) =>
      transaction({
        id: `transaction-${String(index).padStart(2, "0")}`,
        sourceSystem: index % 2 === 0 ? "manual" : "stripe",
        invoiceDate: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
        sourceArtifactId: index % 2 === 0 ? "artifact-pdf" : null,
      }),
    );
    const filtered = filterTransactions(rows, [
      { id: 1, field: "source", operator: "is", value: "manual" },
      { id: 2, field: "evidence", operator: "is", value: "attached" },
    ]);
    const sorted = sortTransactions(rows, {
      key: "date",
      direction: "asc",
    });
    const page = paginateTransactions(sorted, 2);

    expect(filtered).toHaveLength(26);
    expect(page.items).toHaveLength(2);
    expect(page.page).toBe(2);
    expect(page.pageCount).toBe(2);
  });

  it("composes positive and negative filter clauses with AND", () => {
    const rows = [
      transaction({ id: "manual-recorded" }),
      transaction({ id: "manual-draft", status: "draft" }),
      transaction({ id: "stripe-recorded", sourceSystem: "stripe" }),
    ];

    expect(
      filterTransactions(rows, [
        { id: 1, field: "source", operator: "is", value: "manual" },
        { id: 2, field: "status", operator: "is_not", value: "draft" },
      ]).map((row) => row.id),
    ).toEqual(["manual-recorded"]);
  });

  it("uses exact enum membership within selections and leaves empty selections inactive", () => {
    const rows = [
      transaction({ id: "sale", kind: "sale" }),
      transaction({ id: "refund", kind: "sale_refund" }),
      transaction({ id: "expense", kind: "supplier_expense" }),
      transaction({ id: "void", kind: "sale", status: "void" }),
    ];

    expect(
      filterTransactions(rows, [
        {
          id: 1,
          field: "status",
          operator: "contains_any",
          value: ["recorded", "draft"],
        },
        {
          id: 2,
          field: "kind",
          operator: "contains_none",
          value: ["supplier_expense"],
        },
        { id: 3, field: "source", operator: "contains_any", value: [] },
      ]).map((row) => row.id),
    ).toEqual(["sale", "refund"]);
  });

  it("matches text contains case-insensitively", () => {
    const rows = [
      transaction({ id: "acme", counterparty: "ACME Hosting" }),
      transaction({ id: "other", counterparty: "Other supplier" }),
    ];

    expect(
      filterTransactions(rows, [
        {
          id: 1,
          field: "counterparty",
          operator: "contains",
          value: "acme",
        },
      ]).map((row) => row.id),
    ).toEqual(["acme"]);
  });

  it("includes date comparison boundaries in the reporting timezone", () => {
    const rows = [
      transaction({ id: "before", invoiceDate: "2026-07-14" }),
      transaction({ id: "boundary", invoiceDate: "2026-07-15" }),
      transaction({ id: "after", invoiceDate: "2026-07-16" }),
    ];

    expect(
      filterTransactions(rows, [
        {
          id: 1,
          field: "date",
          operator: "greater_than_or_equal",
          value: "2026-07-15",
        },
      ]).map((row) => row.id),
    ).toEqual(["boundary", "after"]);
  });

  it("compares signed amounts rather than stored manual magnitudes", () => {
    const rows = [
      transaction({ id: "expense", documentAmount: "129.0000" }),
      transaction({ id: "sale", kind: "sale", documentAmount: "250.0000" }),
    ];

    expect(
      filterTransactions(rows, [
        { id: 1, field: "amount", operator: "less_than", value: "0" },
      ]).map((row) => row.id),
    ).toEqual(["expense"]);
  });

  it("treats incomplete or invalid clauses as inert", () => {
    const rows = [transaction({ id: "one" }), transaction({ id: "two" })];

    expect(
      filterTransactions(rows, [
        { id: 1, field: "amount", operator: "equals", value: "" },
        { id: 2, field: "amount", operator: "equals", value: "not-a-number" },
        { id: 3, field: "date", operator: "equals", value: "2026-99-99" },
        {
          id: 4,
          field: "amount",
          operator: "contains",
          value: "12",
        },
      ]),
    ).toEqual(rows);
  });

  it("resets the operator and value when the field changes", () => {
    expect(
      resetTransactionFilterField(
        {
          id: 1,
          field: "counterparty",
          operator: "contains",
          value: "Acme",
        },
        "amount",
      ),
    ).toEqual({ id: 1, field: "amount", operator: "equals", value: "" });
    expect(
      resetTransactionFilterField(
        { id: 3, field: "status", operator: "is", value: "recorded" },
        "description",
      ),
    ).toEqual({
      id: 3,
      field: "description",
      operator: "contains",
      value: "",
    });
    expect(
      resetTransactionFilterField(
        { id: 4, field: "description", operator: "contains", value: "Acme" },
        "date",
      ),
    ).toEqual({ id: 4, field: "date", operator: "equals", value: "" });
    expect(
      resetTransactionFilterField(
        { id: 2, field: "counterparty", operator: "contains", value: "Acme" },
        "status",
      ),
    ).toEqual({
      id: 2,
      field: "status",
      operator: "contains_any",
      value: [],
    });
    expect(
      parseTransactionSearch({
        filters: [{ field: "description", operator: "equals", value: "Acme" }],
      }).filters,
    ).toEqual([{ field: "description", operator: "equals", value: "Acme" }]);
    expect(
      transactionFilterValueForOperator("status", "contains_any", "draft"),
    ).toEqual(["draft"]);
    expect(
      transactionFilterValueForOperator("status", "is", ["draft", "recorded"]),
    ).toBe("draft");
  });

  it("toggles an active header sort and starts new columns ascending", () => {
    expect(
      nextTransactionSort({ key: "date", direction: "desc" }, "date"),
    ).toEqual({ key: "date", direction: "asc" });
    expect(
      nextTransactionSort({ key: "date", direction: "desc" }, "amount"),
    ).toEqual({ key: "amount", direction: "asc" });
  });

  it("uses transaction semantics for signed amounts", () => {
    expect(transactionAmountDisplay(transaction()).aud).toBe("-129");
    expect(
      transactionAmountDisplay(
        transaction({
          kind: "processing_fee",
          documentAmount: "8.5000",
          settlementAmount: "8.5000",
        }),
      ),
    ).toMatchObject({ aud: "-8.5", tone: "negative" });
    expect(
      transactionAmountDisplay(
        transaction({
          kind: "owner_loan_repayment",
          documentAmount: "125.0000",
          settlementAmount: "125.0000",
        }),
      ),
    ).toMatchObject({ aud: "-125", tone: "negative" });
    expect(
      transactionAmountDisplay(
        transaction({
          kind: "sale",
          documentAmount: "250.0000",
          settlementAmount: "250.0000",
        }),
      ),
    ).toMatchObject({ aud: "250", tone: "positive" });
  });

  it("preserves imported Stripe net signs across movement kinds", () => {
    const stripeAmount = (kind: TransactionRecord["kind"], sourceNet: string) =>
      transactionAmountDisplay(
        transaction({
          sourceSystem: "stripe",
          kind,
          sourceCurrency: "AUD",
          sourceNet,
          documentAmount: null,
        }),
      ).aud;

    expect(stripeAmount("sale", "96.8000")).toBe("96.8");
    expect(stripeAmount("sale_refund", "-10.3200")).toBe("-10.32");
    expect(stripeAmount("processing_fee", "-3.2000")).toBe("-3.2");
    expect(stripeAmount("transfer", "-100.0000")).toBe("-100");
  });

  it("keeps missing dates and amounts last in either sort direction", () => {
    const missing = transaction({
      id: "missing",
      invoiceDate: null,
      occurredAt: null,
      availableAt: null,
      settledAt: null,
      createdAt: null as unknown as string,
      documentCurrency: null,
      documentAmount: null,
      settlementCurrency: null,
      settlementAmount: null,
    });
    const present = transaction({ id: "present" });

    for (const key of ["date", "amount"] as const) {
      expect(
        sortTransactions([missing, present], { key, direction: "asc" })[1],
      ).toBe(missing);
      expect(
        sortTransactions([missing, present], { key, direction: "desc" })[1],
      ).toBe(missing);
    }
  });

  it("deduplicates repeated Stripe attachments while retaining every context", () => {
    const rows = [
      transaction({
        id: "stripe-1",
        sourceSystem: "stripe",
        sourceArtifactId: "artifact-csv",
        sourceArtifactFilename: "stripe-july.csv",
        description: "Charge one",
      }),
      transaction({
        id: "stripe-2",
        sourceSystem: "stripe",
        sourceArtifactId: "artifact-csv",
        sourceArtifactFilename: "stripe-july.csv",
        description: "Charge two",
      }),
      transaction({
        id: "stripe-3",
        sourceSystem: "stripe",
        sourceArtifactId: "artifact-csv",
        sourceArtifactFilename: "stripe-july.csv",
        description: "Charge three",
      }),
      transaction({
        id: "stripe-4",
        sourceSystem: "stripe",
        sourceArtifactId: "artifact-csv",
        sourceArtifactFilename: "stripe-july.csv",
        description: "Charge four",
      }),
    ];

    expect(deriveArtifactRows(rows)).toEqual([
      expect.objectContaining({
        id: "artifact-csv",
        filename: "stripe-july.csv",
        kind: "stripe_csv",
        transactionCount: 4,
        context: [
          "Acme · Charge one",
          "Acme · Charge two",
          "Acme · Charge three",
          "Acme · Charge four",
        ],
      }),
    ]);
    expect(artifactDownloadLabel("stripe-july.csv")).toBe(
      "Download stripe-july.csv",
    );
  });

  it("maps balance-series values exactly into the chart series", () => {
    expect(
      buildActivityChartSeries({
        basis: "cash",
        basisLabel: "Recorded balance movement view",
        periodType: "month",
        includedCountLabel: "included balance-movement rows",
        warnings: [],
        lines: [
          {
            period: "2026-07",
            inflowAud: "129.0000",
            outflowAud: "10.0000",
            netMovementAud: "119.0000",
            includedCount: 2,
          },
        ],
      }),
    ).toEqual([
      {
        period: "2026-07",
        inflow: "129.0000",
        outflow: "10.0000",
        net: "119.0000",
        includedCount: 2,
      },
    ]);
  });

  it("shows balance warnings without repeating report warnings", () => {
    expect(
      mergeReportWarnings(
        ["row-1: excluded void", "row-2: missing activity value"],
        ["row-1: excluded void", "row-3: review Stripe reporting category"],
      ),
    ).toEqual([
      "row-1: excluded void",
      "row-2: missing activity value",
      "row-3: review Stripe reporting category",
    ]);
  });

  it("keeps a large negative net point within the chart domain", () => {
    const geometry = activityChartGeometry([
      {
        period: "2026-07",
        inflow: "0.0000",
        outflow: "1000000.0000",
        net: "-1000000.0000",
        includedCount: 1,
      },
    ]);
    const negativeY = geometry.baseline + 1_000_000 * geometry.scale;
    const positiveY = geometry.baseline - 1_000_000 * geometry.scale;

    expect(negativeY).toBeGreaterThanOrEqual(geometry.top);
    expect(negativeY).toBeLessThanOrEqual(geometry.bottom);
    expect(positiveY).toBeGreaterThanOrEqual(geometry.top);
    expect(positiveY).toBeLessThanOrEqual(geometry.bottom);
  });

  it("renders positive outflow magnitudes below the chart baseline", () => {
    const geometry = activityChartGeometry([
      {
        period: "2026-07",
        inflow: "20.0000",
        outflow: "10.0000",
        net: "10.0000",
        includedCount: 1,
      },
    ]);
    const bar = activityChartBar(geometry, 10, "outflow");

    expect(bar.y).toBe(geometry.baseline);
    expect(bar.height).toBeGreaterThan(0);
    expect(bar.y + bar.height).toBeLessThanOrEqual(geometry.bottom);
  });
});

describe("clipboard feedback", () => {
  it("reports success and failure without throwing", async () => {
    await expect(copyText("INV-1", async () => undefined)).resolves.toBe(
      "copied",
    );
    await expect(
      copyText("INV-1", async () => {
        throw new Error("denied");
      }),
    ).resolves.toBe("failed");
    await expect(copyText("INV-1", undefined)).resolves.toBe("failed");
  });
});

describe("transaction workflow destinations", () => {
  it("links to dedicated manual and Stripe workflows", async () => {
    await renderTransactionsPage();
    expect(
      screen
        .getByRole("link", { name: "New transaction" })
        .getAttribute("href"),
    ).toBe("/transactions/new");
    expect(
      screen
        .getByRole("link", { name: "Import Stripe CSV" })
        .getAttribute("href"),
    ).toBe("/imports/stripe");
    expect(screen.queryByLabelText("Stripe itemised CSV")).toBeNull();
  });

  it("provides compact, labelled transaction actions with hover and focus tooltips", async () => {
    operationMocks.listTransactionPage.mockResolvedValue({
      rows: [transaction()],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    await renderTransactionsPage();

    const viewLink = await screen.findByRole("link", {
      name: "View transaction: Hosting",
    });
    const actionGroup = viewLink.parentElement?.parentElement;
    const editLink = screen.getByRole("link", {
      name: "Edit transaction: Hosting",
    });
    const copyButton = screen.getByRole("button", {
      name: "Copy transaction reference: INV-1",
    });

    expect(actionGroup?.classList.contains("transaction-table-actions")).toBe(
      true,
    );
    for (const action of [viewLink, editLink, copyButton]) {
      expect(
        action.classList.contains("transaction-table-action") &&
          action.closest(".transaction-table-actions") === actionGroup,
      ).toBe(true);
      expect(action.classList.contains("table-icon-action")).toBe(true);
      expect(action.getAttribute("aria-label")).toBeTruthy();
      expect(action.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
    }
    expect(viewLink.querySelector(".table-action-label")?.textContent).toBe(
      "View",
    );
    expect(editLink.querySelector(".table-action-label")?.textContent).toBe(
      "Edit",
    );
    expect(copyButton.querySelector(".table-action-label")?.textContent).toBe(
      "Copy reference",
    );

    const actionWrap = viewLink.closest(".table-action-wrap")!;
    fireEvent.mouseEnter(actionWrap);
    const hoverTooltip = screen.getByRole("tooltip");
    expect(hoverTooltip.textContent).toBe("View transaction");
    expect(viewLink.getAttribute("aria-describedby")).toBe(
      hoverTooltip.getAttribute("id"),
    );

    fireEvent.mouseLeave(actionWrap);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(viewLink);
    expect(screen.getByRole("tooltip").textContent).toBe("View transaction");
    fireEvent.blur(viewLink);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("omits read-only import text when an imported row has no Edit action", async () => {
    operationMocks.listTransactionPage.mockResolvedValue({
      rows: [transaction({ sourceSystem: "stripe" })],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    await renderTransactionsPage();

    expect(screen.queryByText("Read-only import")).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Edit transaction: Hosting" }),
    ).toBeNull();
  });

  it("marks standalone transaction and lifetime amounts without marking counts or compound details", async () => {
    operationMocks.listTransactionPage.mockResolvedValue({
      rows: [
        transaction(),
        transaction({
          id: "stripe-row",
          sourceSystem: "stripe",
          sourceCurrency: "USD",
          sourceNet: "125.5000",
          sourceGross: "130.0000",
          sourceFee: "4.5000",
          settlementAmount: "128.0000",
        }),
      ],
      total: 2,
      page: 1,
      pageSize: 50,
    });
    await renderTransactionsPage();

    const table = screen.getByRole("table");
    const amountHeader = screen.getByRole("columnheader", { name: "Amount" });
    expect(amountHeader.classList.contains("money-column")).toBe(true);
    expect(
      amountHeader.querySelector("button")?.classList.contains("money-column"),
    ).toBe(true);

    const manualAmount = screen.getByText("-$129.00");
    expect(manualAmount.getAttribute("data-money-value")).toBe("");
    expect(manualAmount.closest("td")?.classList.contains("money-column")).toBe(
      true,
    );

    const sourceAmount = screen.getByText("+USD 125.50");
    expect(sourceAmount.tagName).toBe("SMALL");
    expect(sourceAmount.getAttribute("data-money-value")).toBe("");

    const compoundAmount = screen.getByText(
      "Gross +USD 130.00 · Fee -USD 4.50",
    );
    expect(compoundAmount.hasAttribute("data-money-value")).toBe(false);
    expect(
      compoundAmount.closest("td")?.classList.contains("money-column"),
    ).toBe(true);
    expect(table.querySelectorAll("[data-money-value]")).toHaveLength(3);

    const lifetimeValues = document.querySelectorAll(
      ".transaction-lifetime-summary__metrics dd",
    );
    expect(lifetimeValues).toHaveLength(4);
    expect(
      lifetimeValues[0]?.querySelector("[data-money-value]")?.textContent,
    ).toBe("$1,200.0001");
    expect(
      lifetimeValues[1]?.querySelector("[data-money-value]")?.textContent,
    ).toBe("$55.0000");
    expect(
      lifetimeValues[2]?.querySelector("[data-money-value]")?.textContent,
    ).toBe("+$1,145.0001");
    expect(lifetimeValues[3]?.querySelector("[data-money-value]")).toBeNull();
  });
});

describe("transaction lifetime summary", () => {
  it("sums every report period exactly and stays independent of table search", async () => {
    await renderTransactionsPage();

    expect(await screen.findByText("$1,200.0001")).toBeTruthy();
    expect(screen.getByText("$55.0000")).toBeTruthy();
    expect(screen.getByText("+$1,145.0001")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("2025-07 to 2026-08")).toBeTruthy();
    expect(screen.getByText("2 report warnings or exclusions")).toBeTruthy();
    expect(screen.getByText("No transactions recorded yet.")).toBeTruthy();
    expect(operationMocks.getReport).toHaveBeenCalledWith({
      data: { basis: "cash", periodType: "month", format: "json" },
    });

    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "not-in-table" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Search" }).closest("form")!,
    );

    expect(
      await screen.findByText("Filtered transactions for “not-in-table”."),
    ).toBeTruthy();
    expect(screen.getByText("$1,200.0001")).toBeTruthy();
    expect(screen.getByText("+$1,145.0001")).toBeTruthy();
    expect(operationMocks.getReport).toHaveBeenCalledOnce();
  });

  it("shows exact zero totals and an explicit empty period range", async () => {
    operationMocks.getReport.mockResolvedValue({
      balance: { ...lifetimeBalance, lines: [], warnings: [] },
    });
    await renderTransactionsPage();

    expect(await screen.findAllByText("$0.0000")).toHaveLength(2);
    expect(screen.getByText("none", { exact: true })).toBeTruthy();
    expect(
      screen.getByText("No report warnings or excluded rows."),
    ).toBeTruthy();
  });

  it("keeps report loading and error states visible and retryable", async () => {
    const reportRequest = deferred<{ balance: typeof lifetimeBalance }>();
    operationMocks.getReport
      .mockReturnValueOnce(reportRequest.promise)
      .mockResolvedValue({ balance: lifetimeBalance });
    await renderTransactionsPage();

    expect(screen.getByText("Loading lifetime cash movement…")).toBeTruthy();
    reportRequest.reject(new Error("report unavailable"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "report unavailable",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Retry lifetime summary" }),
    );
    expect(await screen.findByText("$1,200.0001")).toBeTruthy();
    expect(operationMocks.getReport).toHaveBeenCalledTimes(2);
  });
});
