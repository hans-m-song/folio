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
import { createElement, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { selectAutocompleteOption } from "../components/autocomplete-test-helpers";
import type {
  RecurringBillMatchPreviewResult,
  RecurringBillOccurrence,
  RecurringBillOccurrenceStatus,
  RecurringBillView,
} from "../domain/recurring-bills";

const routeState = vi.hoisted(() => ({
  workspace: null as unknown,
  invalidate: vi.fn(),
  navigate: vi.fn(),
  getWorkspace: vi.fn(),
  preview: vi.fn(),
  save: vi.fn(),
  setActive: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    (routeId: string) => (configuration: Record<string, unknown>) => ({
      ...configuration,
      routeId,
      useLoaderData: () => routeState.workspace,
    }),
  useRouter: () => ({ invalidate: routeState.invalidate }),
  useNavigate: () => routeState.navigate,
}));

vi.mock("../server/recurring-bill-operations", () => ({
  getRecurringBillsWorkspace: routeState.getWorkspace,
  getRecurringBillAttention: vi.fn(),
  previewRecurringBill: routeState.preview,
  saveRecurringBill: routeState.save,
  setRecurringBillActive: routeState.setActive,
  linkRecurringBillTransaction: routeState.link,
  unlinkRecurringBillTransaction: routeState.unlink,
}));

import { Route } from "./transactions_.recurring";

const recurringRoute = Route as unknown as {
  component: ComponentType;
  loaderDeps: (args: { search: { sourceTransactionId?: string } }) => {
    sourceTransactionId?: string;
  };
  loader: (args: {
    deps: { sourceTransactionId?: string };
  }) => Promise<unknown>;
  routeId: string;
};

const candidate = {
  id: "transaction-pending-candidate",
  invoiceDate: null,
  occurredAt: "2026-09-30T16:30:00.000Z",
  settledAt: null,
  counterparty: "Example Cloud",
  description: "Monthly infrastructure plan",
  documentCurrency: "AUD",
  documentAmount: "25.0000",
};
const operatorId = "11111111-1111-4111-8111-111111111111";

const schedule = {
  id: "schedule-monthly-cloud",
  label: "Cloud hosting",
  counterparty: "Example Cloud",
  descriptionMatchText: "infrastructure plan",
  descriptionMatchMode: "contains" as const,
  daysEarly: 3,
  daysLate: 3,
  documentCurrency: "AUD",
  expectedAmount: "25.0000",
  frequency: "monthly" as const,
  anchorDate: "2026-09-01",
  responsibleUserId: null,
  active: true,
  createdById: operatorId,
  updatedById: operatorId,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
};

const recurringView = (
  overrides: Partial<RecurringBillView> = {},
): RecurringBillView => ({
  schedule,
  status: "Due" as const,
  nextExpectedDate: "2026-07-01",
  nextUnresolvedOffset: 24,
  oldestPendingDate: "2026-07-01",
  amountEstimate: {
    count: 2,
    minimum: "24.0050",
    maximum: "25.0050",
    average: "24.5050",
  },
  pendingCount: 1,
  dueCount: 1,
  candidateTransactionIds: [candidate.id, "transaction-other-candidate"],
  candidateTransactions: [candidate],
  occurrences: [
    {
      expectedDate: "2026-09-01",
      isScheduled: true,
      status: null,
      isComplete: true,
      transactionId: "transaction-automatic-match",
      association: null,
      candidates: [],
    },
    {
      expectedDate: "2026-10-01",
      isScheduled: true,
      status: "Pending" as const,
      isComplete: false,
      transactionId: null,
      association: null,
      candidates: [
        candidate,
        { ...candidate, id: "transaction-other-candidate" },
      ],
    },
    {
      expectedDate: "2026-11-01",
      isScheduled: true,
      status: "Upcoming" as const,
      isComplete: false,
      transactionId: null,
      association: null,
      candidates: [],
    },
    {
      expectedDate: "2026-07-01",
      isScheduled: true,
      status: "Due" as const,
      isComplete: false,
      transactionId: null,
      association: null,
      candidates: [
        candidate,
        { ...candidate, id: "transaction-other-candidate" },
      ],
    },
  ],
  ...overrides,
});

const workspace = () => ({
  schedules: [
    recurringView({
      occurrences: [
        ...recurringView().occurrences,
        {
          expectedDate: "2026-08-01",
          isScheduled: true,
          status: null,
          isComplete: true,
          transactionId: "transaction-linked",
          association: {
            transactionId: "transaction-linked",
            linkedAt: "2026-09-25T00:00:00.000Z",
            eligible: true,
            transaction: {
              ...candidate,
              id: "transaction-linked",
              invoiceDate: "2026-08-01",
              documentAmount: "24.0000",
            },
          },
          candidates: [],
        },
        {
          expectedDate: "2026-09-15",
          isScheduled: false,
          status: "Due" as const,
          isComplete: false,
          transactionId: null,
          association: {
            transactionId: "transaction-off-cadence-link",
            linkedAt: "2026-09-20T00:00:00.000Z",
            eligible: false,
            transaction: {
              ...candidate,
              id: "transaction-off-cadence-link",
              invoiceDate: "2026-09-15",
            },
          },
          candidates: [],
        },
        {
          expectedDate: "2026-12-01",
          isScheduled: true,
          status: "Upcoming" as const,
          isComplete: false,
          transactionId: null,
          association: null,
          candidates: [],
        },
      ],
    }),
    recurringView({
      schedule: { ...schedule, id: "schedule-paused", active: false },
      status: "Upcoming",
      nextExpectedDate: "2026-12-01",
      nextUnresolvedOffset: null,
      oldestPendingDate: null,
      amountEstimate: null,
      pendingCount: 0,
      candidateTransactionIds: [],
      candidateTransactions: [],
      occurrences: [
        {
          expectedDate: "2026-12-01",
          isScheduled: true,
          status: "Upcoming" as const,
          isComplete: false,
          transactionId: null,
          association: null,
          candidates: [],
        },
      ],
      dueCount: 0,
    }),
  ],
  suggestions: [
    {
      schedule: {
        label: "Cloud hosting",
        counterparty: "Example Cloud",
        descriptionMatchText: "infrastructure plan",
        descriptionMatchMode: "contains" as const,
        daysEarly: 3,
        daysLate: 3,
        documentCurrency: "AUD",
        expectedAmount: "25.0000",
        frequency: "monthly" as const,
        anchorDate: "2026-09-01",
        responsibleUserId: null,
      },
      sourceTransactionIds: ["transaction-source-1", "transaction-source-2"],
      occurrenceDates: ["2026-07-01", "2026-08-01", "2026-09-01"],
      supportCount: 3,
    },
  ],
  responsibleUserOptions: [{ id: operatorId, label: "Synthetic operator" }],
  counterparties: ["Example Cloud", "Saved Supplier"],
  attention: { count: 2, pendingCount: 1, dueCount: 1 },
  currentActorId: operatorId,
  reportingTimezone: "Australia/Brisbane",
  initialSchedule: null,
  sourceTransactionId: null,
});

const renderRecurringBills = () =>
  render(createElement(recurringRoute.component));

const previewResult = (
  overrides: Partial<RecurringBillMatchPreviewResult> = {},
): RecurringBillMatchPreviewResult => ({
  descriptionMatchCount: 0,
  onCadenceCount: 0,
  misalignedCount: 0,
  ambiguousCount: 0,
  amountEstimate: null,
  rows: [],
  ...overrides,
});

const previewRow = (
  overrides: Partial<RecurringBillMatchPreviewResult["rows"][number]> = {},
): RecurringBillMatchPreviewResult["rows"][number] => ({
  transactionId: "transaction-preview-match",
  date: "2026-09-30",
  description: "Monthly infrastructure plan",
  descriptionMatches: true,
  expectedDate: "2026-10-01",
  dayOffset: -1,
  result: "aligned",
  ...overrides,
});

const recurringOccurrence = (
  expectedDate: string,
  status: RecurringBillOccurrenceStatus,
  overrides: Partial<RecurringBillOccurrence> = {},
): RecurringBillOccurrence => ({
  expectedDate,
  isScheduled: true,
  status,
  isComplete: false,
  transactionId: null,
  association: null,
  candidates: [],
  ...overrides,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  routeState.workspace = workspace();
  routeState.getWorkspace.mockResolvedValue(workspace());
  routeState.preview.mockResolvedValue(previewResult());
  routeState.invalidate.mockResolvedValue(undefined);
  routeState.navigate.mockResolvedValue(undefined);
  routeState.save.mockResolvedValue(undefined);
  routeState.setActive.mockResolvedValue(undefined);
  routeState.link.mockResolvedValue(undefined);
  routeState.unlink.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("Recurring bills workspace", () => {
  it("uses the standalone transactions route and seeds a schedule from an explicit source", async () => {
    const sourceTransactionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const initialSchedule = {
      label: "Example Cloud",
      counterparty: "Example Cloud",
      descriptionMatchText: null,
      descriptionMatchMode: "contains" as const,
      daysEarly: 3,
      daysLate: 3,
      documentCurrency: "AUD",
      expectedAmount: "25.0000",
      frequency: "monthly" as const,
      anchorDate: "2026-10-01",
      responsibleUserId: null,
    };
    routeState.getWorkspace.mockResolvedValueOnce({
      ...workspace(),
      initialSchedule,
    });

    const deps = recurringRoute.loaderDeps({
      search: { sourceTransactionId },
    });
    const loaded = await recurringRoute.loader({
      deps,
    });
    expect(recurringRoute.routeId).toBe("/transactions_/recurring");
    expect(routeState.getWorkspace).toHaveBeenCalledWith({
      data: { sourceTransactionId },
    });
    expect(loaded).toMatchObject({ sourceTransactionId, initialSchedule });

    routeState.workspace = {
      ...workspace(),
      sourceTransactionId,
      initialSchedule,
    };
    renderRecurringBills();
    expect(
      screen.getByRole("heading", { name: "Review schedule from transaction" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", {
        name: `Source transaction ${sourceTransactionId}`,
      }),
    ).toBeTruthy();
    expect(routeState.save).not.toHaveBeenCalled();

    const sourceForm = screen
      .getByRole("button", { name: "Confirm and save schedule" })
      .closest("form")!;
    expect(
      Array.from(sourceForm.querySelectorAll(":invalid")).map((field) => ({
        tag: field.tagName,
        name: field.getAttribute("name"),
        label: field.getAttribute("aria-label"),
        value: (field as HTMLInputElement).value,
      })),
    ).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and save schedule" }),
    );
    await waitFor(() => expect(routeState.save).toHaveBeenCalledTimes(1));
    expect(routeState.navigate).toHaveBeenCalledWith({
      to: "/transactions/recurring",
      replace: true,
    });
  });

  it("loads the workspace without source-prefill data when no source is selected", async () => {
    const deps = recurringRoute.loaderDeps({ search: {} });
    await recurringRoute.loader({ deps });

    expect(routeState.getWorkspace).toHaveBeenCalledTimes(1);
    expect(routeState.getWorkspace).toHaveBeenCalledWith();
  });

  it("explains when a selected source transaction cannot prefill a schedule", () => {
    routeState.workspace = {
      ...workspace(),
      sourceTransactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      initialSchedule: null,
    };
    renderRecurringBills();

    expect(screen.getByRole("alert").textContent).toContain(
      "This transaction cannot prefill a recurring bill schedule.",
    );
    expect(
      screen.queryByRole("heading", {
        name: "Review schedule from transaction",
      }),
    ).toBeNull();
    expect(routeState.save).not.toHaveBeenCalled();
  });

  it("shows unresolved occurrences plus one scheduled upcoming date and keeps linked history in details", () => {
    const { container } = renderRecurringBills();

    const scheduleStates = Array.from(
      container.querySelectorAll(".recurring-bill-card__header p"),
    ).map((paragraph) => paragraph.textContent?.replace(/\s+/g, " ").trim());
    expect(scheduleStates).toContain("Schedule active · Occurrence: Due");
    expect(scheduleStates).toContain("Schedule paused · Occurrence: Upcoming");
    const cards = container.querySelectorAll<HTMLElement>(
      ".recurring-bill-card",
    );
    const activeCard = cards[0]!;
    const activeRows = activeCard.querySelectorAll(
      ":scope > .recurring-bill-occurrences > .recurring-bill-occurrence",
    );
    expect(
      Array.from(activeRows).map(
        (row) => row.querySelector(".recurring-bill-status")?.textContent,
      ),
    ).toEqual(["Due", "Pending", "Upcoming"]);
    expect(
      Array.from(activeRows).map(
        (row) => row.querySelector("time")?.textContent,
      ),
    ).toEqual(["01 Jul 2026", "01 Oct 2026", "01 Nov 2026"]);
    expect(
      activeCard.querySelector('time[datetime="2026-10-01"]')?.textContent,
    ).toBe("01 Oct 2026");
    expect(
      activeCard.querySelectorAll(".recurring-bill-occurrence"),
    ).toHaveLength(5);
    expect(
      within(activeCard).getByText("Linked occurrence details (2)"),
    ).toBeTruthy();
    expect(
      cards[1]!.querySelector(
        ":scope > .recurring-bill-occurrences > .recurring-bill-occurrence time",
      )?.textContent,
    ).toBe("01 Dec 2026");
    expect(
      container.querySelectorAll(".recurring-bill-card--due"),
    ).toHaveLength(1);
    expect(screen.getByText("Oldest unresolved date")).toBeTruthy();
    expect(screen.getAllByText("01 Oct 2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pending occurrences")).toHaveLength(2);
    expect(screen.getAllByText("Due occurrences")).toHaveLength(2);
    expect(
      container
        .querySelector(".recurring-bills-section-heading strong")
        ?.textContent?.replace(/\s+/g, " ")
        .trim(),
    ).toBe("1 Pending · 1 Due");
    expect(
      screen.getByText(
        "Upcoming is before the expected date. Pending covers the expected date through the late window; Due starts after that window.",
      ),
    ).toBeTruthy();

    const linkedDetails =
      activeCard.querySelector<HTMLDetailsElement>("details")!;
    expect(linkedDetails).not.toHaveProperty("open", true);
    fireEvent.click(
      within(activeCard).getByText("Linked occurrence details (2)"),
    );
    expect(linkedDetails).toHaveProperty("open", true);
    expect(
      within(linkedDetails).getAllByRole("button", {
        name: "Unlink transaction",
      }),
    ).toHaveLength(2);
  });

  it("shows rounded historical estimate values and removes the estimate input", () => {
    const { container } = renderRecurringBills();
    const activeCard = container.querySelector(".recurring-bill-card")!;

    expect(
      Array.from(
        activeCard.querySelectorAll(
          ".recurring-bill-amount-estimate .money-text",
        ),
      ).map((value) => value.textContent),
    ).toEqual(["AUD 24.01", "AUD 25.01", "AUD 24.51"]);
    expect(screen.getByText("No estimate")).toBeTruthy();
    expect(screen.queryByLabelText(/Amount estimate/)).toBeNull();
  });

  it("shows one historical amount once", () => {
    const loadedWorkspace = workspace();
    loadedWorkspace.schedules[0]!.amountEstimate = {
      count: 1,
      minimum: "18.7549",
      maximum: "18.7549",
      average: "18.75",
    };
    routeState.workspace = loadedWorkspace;
    const { container } = renderRecurringBills();

    expect(
      Array.from(
        container.querySelectorAll(
          ".recurring-bill-card .recurring-bill-amount-estimate .money-text",
        ),
      ).map((value) => value.textContent),
    ).toEqual(["AUD 18.75"]);
  });

  it("loads more unresolved dates, deduplicates the page and stops at a null offset", async () => {
    const pageWorkspace = workspace();
    pageWorkspace.schedules[0]!.occurrences = [
      recurringOccurrence("2026-06-01", "Due"),
      recurringOccurrence("2026-07-01", "Due"),
      recurringOccurrence("2026-10-01", "Pending"),
      recurringOccurrence("2026-11-01", "Upcoming"),
      recurringOccurrence("2026-12-01", "Upcoming"),
    ];
    pageWorkspace.schedules[0]!.nextUnresolvedOffset = null;
    routeState.getWorkspace.mockResolvedValueOnce(pageWorkspace);
    const { container } = renderRecurringBills();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show more missing occurrences for Cloud hosting",
      }),
    );

    await screen.findByText("01 Jun 2026");
    expect(routeState.getWorkspace).toHaveBeenCalledWith({
      data: { unresolvedOffset: 24 },
    });
    const activeCard = container.querySelector(".recurring-bill-card")!;
    const activeRows = activeCard.querySelectorAll(
      ":scope > .recurring-bill-occurrences > .recurring-bill-occurrence",
    );
    expect(
      Array.from(activeRows).map(
        (row) => row.querySelector("time")?.textContent,
      ),
    ).toEqual(["01 Jun 2026", "01 Jul 2026", "01 Oct 2026", "01 Nov 2026"]);
    expect(
      screen.queryByRole("button", {
        name: "Show more missing occurrences for Cloud hosting",
      }),
    ).toBeNull();
  });

  it("retries page failures and reports schedule-version staleness", async () => {
    const failedPage = deferred<ReturnType<typeof workspace>>();
    routeState.getWorkspace.mockReturnValueOnce(failedPage.promise);
    renderRecurringBills();
    const loadMoreButton = screen.getByRole("button", {
      name: "Show more missing occurrences for Cloud hosting",
    });
    fireEvent.click(loadMoreButton);
    expect(screen.getByText("Loading more occurrences…")).toBeTruthy();
    expect(loadMoreButton).toHaveProperty("disabled", true);
    await act(async () => {
      failedPage.reject(new Error("Synthetic connection failure"));
      await failedPage.promise.catch(() => undefined);
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "More unresolved occurrences could not be loaded.",
    );

    const changedWorkspace = workspace();
    changedWorkspace.schedules[0]!.schedule = {
      ...schedule,
      updatedAt: "2026-09-26T00:00:00.000Z",
    };
    changedWorkspace.schedules[0]!.occurrences = [
      recurringOccurrence("2026-06-01", "Due"),
    ];
    routeState.getWorkspace.mockResolvedValueOnce(changedWorkspace);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Retry loading missing occurrences",
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The schedule changed while more occurrences were loading.",
    );
    expect(screen.queryByText("01 Jun 2026")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh schedule" }));
    await waitFor(() => expect(routeState.invalidate).toHaveBeenCalledTimes(1));
  });

  it("drops cached pages when the base workspace refreshes at the same schedule revision", async () => {
    const pageWorkspace = workspace();
    pageWorkspace.schedules[0]!.occurrences = [
      recurringOccurrence("2026-06-01", "Due", {
        association: {
          transactionId: "transaction-stale-page-link",
          linkedAt: "2026-09-20T00:00:00.000Z",
          eligible: false,
          transaction: {
            ...candidate,
            id: "transaction-stale-page-link",
            invoiceDate: "2026-06-01",
            counterparty: "Stale page link",
          },
        },
      }),
      recurringOccurrence("2026-07-01", "Due"),
    ];
    pageWorkspace.schedules[0]!.nextUnresolvedOffset = 48;
    routeState.getWorkspace.mockResolvedValueOnce(pageWorkspace);
    const rendered = renderRecurringBills();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show more missing occurrences for Cloud hosting",
      }),
    );
    expect(
      await screen.findByRole("link", { name: /Stale page link/ }),
    ).toBeTruthy();

    const refreshedWorkspace = workspace();
    const freshCandidate = {
      ...candidate,
      id: "transaction-fresh-page-candidate",
      invoiceDate: "2026-06-01",
      counterparty: "Fresh page candidate",
    };
    const refreshedView = recurringView({
      occurrences: [
        recurringOccurrence("2026-06-01", "Due", {
          candidates: [freshCandidate],
        }),
        recurringOccurrence("2026-07-01", "Due"),
        recurringOccurrence("2026-10-01", "Pending", {
          candidates: [candidate],
        }),
        recurringOccurrence("2026-11-01", "Upcoming"),
      ],
    });
    routeState.workspace = {
      ...refreshedWorkspace,
      schedules: [refreshedView, ...refreshedWorkspace.schedules.slice(1)],
    };
    rendered.rerender(createElement(recurringRoute.component));

    expect(screen.queryByRole("link", { name: /Stale page link/ })).toBeNull();
    const refreshedOccurrence = screen.getByText("01 Jun 2026").closest("li")!;
    const candidateSelect = within(refreshedOccurrence).getByRole("combobox", {
      name: "Candidate transaction for schedule-monthly-cloud 01 Jun 2026",
    });
    await selectAutocompleteOption(
      candidateSelect,
      "01 Jun 2026 · Fresh page candidate · AUD 25.00 · ID transaction-fresh-page-candidate",
    );
  });

  it("opens saved counterparties on focus and lets the operator select one", async () => {
    renderRecurringBills();
    fireEvent.click(screen.getByRole("button", { name: "Add schedule" }));

    const counterparty = screen.getByRole("combobox", {
      name: "Supplier or counterparty",
    });
    expect((counterparty as HTMLInputElement).maxLength).toBe(300);
    act(() => (counterparty as HTMLInputElement).focus());
    await waitFor(() =>
      expect(counterparty.getAttribute("aria-expanded")).toBe("true"),
    );
    expect(
      await screen.findByRole("option", { name: "Example Cloud" }),
    ).toBeTruthy();

    await selectAutocompleteOption(counterparty, "Saved Supplier");
    expect((counterparty as HTMLInputElement).value).toBe("Saved Supplier");
  });

  it("requires review and confirmation before saving a prefilled suggestion", async () => {
    renderRecurringBills();

    fireEvent.click(screen.getByRole("button", { name: "Review suggestion" }));
    expect(
      (screen.getByLabelText("Schedule name") as HTMLInputElement).value,
    ).toBe("Cloud hosting");
    expect(
      (screen.getByLabelText("Schedule name") as HTMLInputElement).maxLength,
    ).toBe(200);
    expect(
      (screen.getByLabelText("Supplier or counterparty") as HTMLInputElement)
        .value,
    ).toBe("Example Cloud");
    expect(
      (screen.getByLabelText("Supplier or counterparty") as HTMLInputElement)
        .maxLength,
    ).toBe(300);
    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Frequency" }),
      "Annual",
    );
    expect(screen.queryByRole("combobox", { name: "Frequency" })).toBeTruthy();
    expect(
      (
        screen.getByLabelText(
          "Match window before expected date (days)",
        ) as HTMLInputElement
      ).value,
    ).toBe("3");
    expect(
      (
        screen.getByLabelText(
          "Grace period after expected date (days)",
        ) as HTMLInputElement
      ).value,
    ).toBe("3");
    expect(
      screen.getAllByText(
        (_, element) =>
          element?.textContent ===
          "Supporting dates: 01 Jul 2026, 01 Aug 2026, 01 Sep 2026",
      ),
    ).toHaveLength(2);
    for (const link of screen.getAllByRole("link", {
      name: "Source transaction transaction-source-1",
    }))
      expect(link).toHaveProperty(
        "pathname",
        "/transactions/transaction-source-1",
      );
    expect(routeState.save).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Supplier or counterparty"), {
      target: { value: "Example Cloud Pty" },
    });
    fireEvent.change(
      screen.getByLabelText("Match window before expected date (days)"),
      { target: { value: "0" } },
    );
    fireEvent.change(
      screen.getByLabelText("Grace period after expected date (days)"),
      { target: { value: "4" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and save schedule" }),
    );

    await waitFor(() => expect(routeState.save).toHaveBeenCalledTimes(1));
    expect(routeState.save).toHaveBeenCalledWith({
      data: {
        schedule: {
          label: "Cloud hosting",
          counterparty: "Example Cloud Pty",
          descriptionMatchText: "infrastructure plan",
          descriptionMatchMode: "contains",
          daysEarly: 0,
          daysLate: 4,
          documentCurrency: "AUD",
          expectedAmount: "25.0000",
          frequency: "annual",
          anchorDate: "2026-09-01",
          responsibleUserId: operatorId,
        },
      },
    });
  });

  it("previews a valid regex rule before unrelated fields are complete", async () => {
    renderRecurringBills();
    fireEvent.click(screen.getByRole("button", { name: "Add schedule" }));
    fireEvent.change(screen.getByLabelText("Supplier or counterparty"), {
      target: { value: "Example Cloud" },
    });
    fireEvent.change(
      screen.getByLabelText("First expected bill date (calendar anchor)"),
      { target: { value: "2026-10-01" } },
    );
    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Description match mode" }),
      "Regex",
    );
    fireEvent.change(screen.getByLabelText("Description pattern"), {
      target: { value: "^Monthly.*plan$" },
    });

    await screen.findByText("No recorded transaction candidates were found.");
    expect(routeState.preview).toHaveBeenLastCalledWith({
      data: {
        schedule: {
          label: "Preview",
          counterparty: "Example Cloud",
          descriptionMatchText: "^Monthly.*plan$",
          descriptionMatchMode: "regex",
          documentCurrency: "AUD",
          expectedAmount: null,
          frequency: "monthly",
          anchorDate: "2026-10-01",
          responsibleUserId: null,
          daysEarly: 3,
          daysLate: 3,
        },
      },
    });
    expect(
      (screen.getByLabelText("Schedule name") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.queryByText(/regular expression is invalid/i)).toBeNull();
    expect(routeState.save).not.toHaveBeenCalled();
    expect(routeState.setActive).not.toHaveBeenCalled();
    expect(routeState.link).not.toHaveBeenCalled();
    expect(routeState.unlink).not.toHaveBeenCalled();
  });

  it("shows regex matches separately from cadence matches and keeps mismatched descriptions visible", async () => {
    routeState.preview.mockResolvedValue(
      previewResult({
        descriptionMatchCount: 3,
        onCadenceCount: 2,
        misalignedCount: 1,
        ambiguousCount: 1,
        amountEstimate: {
          count: 2,
          minimum: "12.3450",
          maximum: "13.0050",
          average: "12.6750",
        },
        rows: [
          previewRow({
            transactionId: "transaction-regex-match",
            description: "monthly infrastructure plan",
          }),
          previewRow({
            transactionId: "transaction-regex-mismatch",
            description: "Payment processing fee",
            descriptionMatches: false,
            result: "description_mismatch",
          }),
          previewRow({
            transactionId: "transaction-regex-ambiguous",
            description: "Monthly plan renewal",
            result: "ambiguous",
          }),
          previewRow({
            transactionId: "transaction-regex-misaligned",
            date: "2026-11-01",
            description: "Monthly plan renewal",
            expectedDate: "2026-10-01",
            dayOffset: 31,
            result: "misaligned",
          }),
        ],
      }),
    );
    renderRecurringBills();
    fireEvent.click(screen.getByRole("button", { name: "Review suggestion" }));
    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Description match mode" }),
      "Regex",
    );
    fireEvent.change(screen.getByLabelText("Description pattern"), {
      target: { value: "^Monthly.*plan$" },
    });

    await screen.findByText("Payment processing fee");
    expect(screen.getByText("monthly infrastructure plan")).toBeTruthy();
    expect(screen.getByText("Description does not match")).toBeTruthy();
    expect(screen.getByText("Description mismatch")).toBeTruthy();
    expect(screen.getByText("Outside cadence window")).toBeTruthy();
    expect(
      screen
        .getByRole("region", { name: "Matching preview" })
        .querySelector(".recurring-bill-preview__header p")?.textContent,
    ).toContain("On-cadence counts include ambiguous candidates.");
    const counts = screen
      .getByRole("region", { name: "Matching preview" })
      .querySelectorAll(".recurring-bill-preview-counts > div");
    expect(
      Array.from(counts).map((item) => [
        item.querySelector("dt")?.textContent,
        item.querySelector("dd")?.textContent,
      ]),
    ).toEqual([
      ["Description matches", "3"],
      ["On cadence", "2"],
      ["Misaligned", "1"],
      ["Ambiguous", "1"],
      ["Amount estimate", "AUD 12.35 – AUD 13.01 · avg AUD 12.68"],
    ]);
    expect(
      Array.from(
        screen
          .getByRole("region", { name: "Matching preview" })
          .querySelectorAll(".recurring-bill-preview__estimate .money-text"),
      ).map((value) => value.textContent),
    ).toEqual(["AUD 12.35", "AUD 13.01", "AUD 12.68"]);
    expect(routeState.preview).toHaveBeenLastCalledWith({
      data: {
        schedule: expect.objectContaining({
          label: "Preview",
          descriptionMatchText: "^Monthly.*plan$",
          descriptionMatchMode: "regex",
        }),
      },
    });
    expect(routeState.save).not.toHaveBeenCalled();
    expect(routeState.setActive).not.toHaveBeenCalled();
    expect(routeState.link).not.toHaveBeenCalled();
    expect(routeState.unlink).not.toHaveBeenCalled();
  });

  it("shows an inline invalid-regex error and sends or saves no invalid rule", async () => {
    renderRecurringBills();
    fireEvent.click(screen.getByRole("button", { name: "Review suggestion" }));
    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Description match mode" }),
      "Regex",
    );
    fireEvent.change(screen.getByLabelText("Description pattern"), {
      target: { value: "[" },
    });

    expect(
      await screen.findByText(
        "Description match regular expression is invalid or unsupported",
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Description pattern").getAttribute("aria-invalid"),
    ).toBe("true");
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(routeState.preview).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and save schedule" }),
    );
    expect(routeState.save).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Correct the highlighted schedule fields before saving.",
      ),
    ).toBeTruthy();
  });

  it("shows loading, retryable error, and zero-candidate preview states", async () => {
    routeState.preview.mockRejectedValueOnce(new Error("Synthetic outage"));
    renderRecurringBills();
    fireEvent.click(screen.getByRole("button", { name: "Review suggestion" }));
    expect(screen.getByText("Checking recorded transactions…")).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The preview could not be loaded. Check your connection and retry.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Check matches" }));
    expect(
      await screen.findByText("No recorded transaction candidates were found."),
    ).toBeTruthy();
    expect(routeState.preview).toHaveBeenCalledTimes(2);
    expect(routeState.save).not.toHaveBeenCalled();
    expect(routeState.setActive).not.toHaveBeenCalled();
    expect(routeState.link).not.toHaveBeenCalled();
    expect(routeState.unlink).not.toHaveBeenCalled();
  });

  it("saves a valid schedule unchanged when preview finds no candidates", async () => {
    renderRecurringBills();
    fireEvent.click(screen.getByRole("button", { name: "Review suggestion" }));
    expect(
      await screen.findByText("No recorded transaction candidates were found."),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and save schedule" }),
    );
    await waitFor(() => expect(routeState.save).toHaveBeenCalledTimes(1));
    expect(routeState.save).toHaveBeenCalledWith({
      data: {
        schedule: {
          label: "Cloud hosting",
          counterparty: "Example Cloud",
          descriptionMatchText: "infrastructure plan",
          descriptionMatchMode: "contains",
          daysEarly: 3,
          daysLate: 3,
          documentCurrency: "AUD",
          expectedAmount: "25.0000",
          frequency: "monthly",
          anchorDate: "2026-09-01",
          responsibleUserId: operatorId,
        },
      },
    });
  });

  it("ignores stale preview responses and saves the latest rule despite misalignment", async () => {
    const oldRequest = deferred<RecurringBillMatchPreviewResult>();
    const latestRequest = deferred<RecurringBillMatchPreviewResult>();
    routeState.preview
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => latestRequest.promise);
    renderRecurringBills();
    fireEvent.click(screen.getByRole("button", { name: "Review suggestion" }));
    await waitFor(() => expect(routeState.preview).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Description match text"), {
      target: { value: "latest pattern" },
    });
    await waitFor(() => expect(routeState.preview).toHaveBeenCalledTimes(2));
    await act(async () => {
      latestRequest.resolve(
        previewResult({
          descriptionMatchCount: 1,
          onCadenceCount: 0,
          misalignedCount: 1,
          rows: [
            previewRow({
              transactionId: "transaction-latest-rule",
              description: "Latest rule candidate",
              expectedDate: "2026-10-01",
              dayOffset: 31,
              result: "misaligned",
            }),
          ],
        }),
      );
      await latestRequest.promise;
    });
    expect(await screen.findByText("Latest rule candidate")).toBeTruthy();
    expect(screen.getByText("Outside cadence window")).toBeTruthy();

    await act(async () => {
      oldRequest.resolve(
        previewResult({
          descriptionMatchCount: 1,
          rows: [
            previewRow({
              transactionId: "transaction-old-rule",
              description: "Stale rule candidate",
            }),
          ],
        }),
      );
      await oldRequest.promise;
    });
    expect(screen.getByText("Latest rule candidate")).toBeTruthy();
    expect(screen.queryByText("Stale rule candidate")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and save schedule" }),
    );
    await waitFor(() => expect(routeState.save).toHaveBeenCalledTimes(1));
    expect(routeState.save).toHaveBeenCalledWith({
      data: {
        schedule: expect.objectContaining({
          descriptionMatchText: "latest pattern",
        }),
      },
    });
  });

  it("requires an explicit candidate selection before linking an occurrence", async () => {
    renderRecurringBills();

    const pendingOccurrence = screen
      .getByRole("combobox", {
        name: "Candidate transaction for schedule-monthly-cloud 01 Oct 2026",
      })
      .closest("li")!;
    expect(
      within(pendingOccurrence).getByRole("button", {
        name: "Link selected transaction",
      }),
    ).toHaveProperty("disabled", true);
    expect(routeState.link).not.toHaveBeenCalled();

    await selectAutocompleteOption(
      screen.getByRole("combobox", {
        name: "Candidate transaction for schedule-monthly-cloud 01 Oct 2026",
      }),
      "01 Oct 2026 · Example Cloud · AUD 25.00 · ID transaction-pending-candidate",
    );
    fireEvent.click(
      within(pendingOccurrence).getByRole("button", {
        name: "Link selected transaction",
      }),
    );

    await waitFor(() => expect(routeState.link).toHaveBeenCalledTimes(1));
    expect(routeState.link).toHaveBeenCalledWith({
      data: {
        scheduleId: "schedule-monthly-cloud",
        expectedDate: "2026-10-01",
        transactionId: candidate.id,
        expectedUpdatedAt: schedule.updatedAt,
      },
    });
  });

  it("offers candidate linking for Due occurrences", async () => {
    renderRecurringBills();

    const dueOccurrence = screen
      .getByRole("combobox", {
        name: "Candidate transaction for schedule-monthly-cloud 01 Jul 2026",
      })
      .closest("li")!;
    await selectAutocompleteOption(
      within(dueOccurrence).getByRole("combobox", {
        name: "Candidate transaction for schedule-monthly-cloud 01 Jul 2026",
      }),
      "01 Oct 2026 · Example Cloud · AUD 25.00 · ID transaction-pending-candidate",
    );
    fireEvent.click(
      within(dueOccurrence).getByRole("button", {
        name: "Link selected transaction",
      }),
    );

    await waitFor(() => expect(routeState.link).toHaveBeenCalledTimes(1));
    expect(routeState.link).toHaveBeenCalledWith({
      data: {
        scheduleId: "schedule-monthly-cloud",
        expectedDate: "2026-07-01",
        transactionId: candidate.id,
        expectedUpdatedAt: schedule.updatedAt,
      },
    });
  });

  it("unlinks stored associations but leaves automatic matches unlinked", async () => {
    renderRecurringBills();

    fireEvent.click(screen.getByText("Linked occurrence details (2)"));

    const unlinkButton = screen.getAllByRole("button", {
      name: "Unlink transaction",
    })[0]!;
    fireEvent.click(unlinkButton);

    await waitFor(() => expect(routeState.unlink).toHaveBeenCalledTimes(1));
    expect(routeState.unlink).toHaveBeenCalledWith({
      data: {
        scheduleId: "schedule-monthly-cloud",
        expectedDate: "2026-08-01",
        expectedUpdatedAt: schedule.updatedAt,
      },
    });
  });

  it("explains revision conflicts as a refresh action", async () => {
    routeState.setActive.mockRejectedValueOnce(
      new Error("The schedule changed. Code REVISION_CONFLICT."),
    );
    renderRecurringBills();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Pause schedule" })[0]!,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This schedule changed after it was loaded. Refresh the page before trying again.",
    );
  });
});
