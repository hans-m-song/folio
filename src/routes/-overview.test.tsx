// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ComponentType } from "react";

const routeMock = vi.hoisted(() => ({
  data: null as unknown,
  invalidate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (configuration: Record<string, unknown>) => ({
    ...configuration,
    useLoaderData: () => routeMock.data,
  }),
  useRouter: () => ({ invalidate: routeMock.invalidate }),
}));

vi.mock("../auth/session-server", () => ({ getCurrentSession: vi.fn() }));
vi.mock("../server/operations", () => ({
  getOverviewSummary: vi.fn(),
  getReport: vi.fn(),
}));
vi.mock("../server/recurring-bill-operations", () => ({
  getRecurringBillAttention: vi.fn(),
}));

import { Route } from "./index";

const overviewRoute = Route as unknown as {
  component: ComponentType;
  errorComponent: ComponentType;
  pendingComponent: ComponentType;
};

const pageData = (overrides: Record<string, unknown> = {}) => ({
  session: { authenticated: true },
  balance: {
    basis: "cash",
    basisLabel: "Recorded cash movement",
    periodType: "month",
    includedCountLabel: "included balance-movement rows",
    warnings: [],
    lines: [
      {
        period: "2026-09",
        inflowAud: "250.0000",
        outflowAud: "25.4000",
        netMovementAud: "224.6000",
        includedCount: 2,
      },
    ],
  },
  summary: {
    attention: {
      unresolvedBankRows: 7,
      importsWithUnresolvedRows: 2,
      missingInvoiceOrCreditNoteCount: 4,
      pendingImportUploads: 5,
      abandonedImportUploads: 3,
    },
    recent: {
      transactions: [
        {
          id: "transaction-123",
          kind: "sale",
          status: "recorded",
          sourceSystem: "stripe",
          updatedAt: "2026-09-21T10:00:00.000Z",
        },
      ],
      bankRows: [
        {
          id: "bank-row-123",
          postedDate: "2026-09-20",
          amountAud: "-25.4000",
          reviewState: "unresolved",
          updatedAt: "2026-09-21T08:00:00.000Z",
        },
      ],
    },
  },
  recurringAttention: { count: 3, pendingCount: 2, dueCount: 1 },
  ...overrides,
});

const renderOverview = () => render(createElement(overviewRoute.component));

beforeEach(() => {
  routeMock.data = pageData();
  routeMock.invalidate.mockClear();
});

afterEach(() => cleanup());

describe("Overview page", () => {
  it("shows exact attention counts as links to their relevant workspace pages", () => {
    renderOverview();

    expect(
      screen
        .getByRole("link", { name: "7 Unresolved imported bank rows" })
        .getAttribute("href"),
    ).toBe("/banking/reconcile");
    expect(
      screen
        .getByRole("link", { name: "2 Imports with unresolved rows" })
        .getAttribute("href"),
    ).toBe("/banking/imports");
    expect(
      screen
        .getByRole("link", { name: "4 Missing invoices or credit notes" })
        .getAttribute("href"),
    ).toBe(
      `/transactions?filters=${encodeURIComponent(
        JSON.stringify([
          { field: "status", operator: "is", value: "recorded" },
          { field: "invoice", operator: "is", value: "missing" },
        ]),
      )}`,
    );
    expect(
      screen
        .getByRole("link", {
          name: "2 Pending · 1 Due Recurring bills needing attention",
        })
        .getAttribute("href"),
    ).toBe("/transactions/recurring");
    expect(
      screen
        .getByRole("link", { name: "5 Pending CSV import uploads" })
        .getAttribute("href"),
    ).toBe("/imports/library?state=pending");
    expect(
      screen
        .getByRole("link", { name: "3 Abandoned CSV import uploads" })
        .getAttribute("href"),
    ).toBe("/imports/library?state=abandoned");
    expect(
      screen.getByText(
        "Counts cover Stripe and CommBank CSV uploads. Abandoned uploads may be cancelled or duplicates.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.queryByText(/failed/i)).toBeNull();
  });

  it("links recent snapshots to their detail pages and shows dates and states", () => {
    renderOverview();

    expect(
      screen
        .getByRole("link", {
          name: /Sale Stripe import recorded Updated 2026-09-21/i,
        })
        .getAttribute("href"),
    ).toBe("/transactions/transaction-123");
    expect(
      screen
        .getByRole("link", {
          name: /\$25\.40 Posted 2026-09-20 unresolved Updated 2026-09-21/i,
        })
        .getAttribute("href"),
    ).toBe("/banking/reconcile?bank=bank-row-123");
    expect(
      screen.getByText("Latest record snapshots, not a full event history."),
    ).toBeTruthy();
  });

  it("shows zero counts and empty states when no activity is available", () => {
    routeMock.data = pageData({
      balance: {
        basis: "cash",
        basisLabel: "Recorded cash movement",
        periodType: "month",
        includedCountLabel: "included balance-movement rows",
        warnings: [],
        lines: [],
      },
      summary: {
        attention: {
          unresolvedBankRows: 0,
          importsWithUnresolvedRows: 0,
          missingInvoiceOrCreditNoteCount: 0,
          pendingImportUploads: 0,
          abandonedImportUploads: 0,
        },
        recent: { transactions: [], bankRows: [] },
      },
      recurringAttention: { count: 0, pendingCount: 0, dueCount: 0 },
    });
    renderOverview();

    expect(
      screen.getByRole("link", { name: "0 Unresolved imported bank rows" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", {
        name: "0 Pending · 0 Due Recurring bills needing attention",
      }),
    ).toBeTruthy();
    expect(screen.getByText("No recent Folio transactions.")).toBeTruthy();
    expect(screen.getByText("No imported bank rows yet.")).toBeTruthy();
    expect(screen.getByText(/No recorded cash movement yet/)).toBeTruthy();
  });

  it("provides loading and error states", () => {
    const Pending = overviewRoute.pendingComponent;
    const Error = overviewRoute.errorComponent;

    const pending = render(createElement(Pending));
    expect(screen.getByRole("status").textContent).toContain(
      "Loading overview",
    );
    pending.unmount();

    render(createElement(Error));
    expect(screen.getByRole("alert").textContent).toContain("Retry the page");
    fireEvent.click(screen.getByRole("button", { name: "Retry overview" }));
    expect(routeMock.invalidate).toHaveBeenCalledTimes(1);
  });

  it("keeps the chart labeled as cash movement rather than an account balance", () => {
    const { container } = renderOverview();

    expect(screen.getByText("Monthly cash movement")).toBeTruthy();
    expect(
      screen.getByText("Recorded transactions · Not a bank balance"),
    ).toBeTruthy();
    expect(screen.getByText("Exact monthly values (AUD)")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "$250.00" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "$25.40" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "$224.60" })).toBeTruthy();
    expect(container.querySelectorAll("[data-money-value]")).toHaveLength(7);
    expect(container.querySelectorAll("strong[data-money-value]")).toHaveLength(
      4,
    );
    expect(container.querySelectorAll("th.money-column")).toHaveLength(3);
    expect(container.querySelectorAll("td.money-column")).toHaveLength(3);
  });
});
