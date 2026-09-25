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
  transactionPageQueryForSearch,
  transactionStatusFromSubmitter,
  Route,
} from "./transactions";
import type { TransactionRecord } from "../domain/types";

const operationMocks = vi.hoisted(() => ({
  confirmArtifactUpload: vi.fn(),
  downloadArtifact: vi.fn(),
  getFolioUiConfig: vi.fn(),
  getReport: vi.fn(),
  importStripeCsv: vi.fn(),
  listAvailableInvoiceArtifacts: vi.fn(),
  listTransactionFormOptions: vi.fn(),
  listTransactionPage: vi.fn(),
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
    page: 1,
  });
  let currentSearch: Record<string, unknown> = defaultSearch();
  let history = [currentSearch];
  let position = 0;
  const subscribers = new Set<() => void>();
  const publish = () => subscribers.forEach((subscriber) => subscriber());

  return {
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
  routerMocks.resetSearch();
  operationMocks.listTransactionFormOptions.mockResolvedValue(formOptions);
  operationMocks.listTransactionPage.mockResolvedValue(emptyTransactionPage);
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
    expect(screen.getByLabelText("Status filter value")).toHaveProperty(
      "value",
      "recorded",
    );
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

    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
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
