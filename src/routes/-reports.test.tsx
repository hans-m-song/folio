// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createElement, type ComponentType } from "react";

const routerMock = vi.hoisted(() => ({ invalidate: vi.fn() }));
const routeState = vi.hoisted(() => ({
  result: null as unknown,
  search: { basis: "activity", period: "month" },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (configuration: Record<string, unknown>) => ({
    ...configuration,
    useLoaderData: () => routeState.result,
    useSearch: () => routeState.search,
  }),
  useRouter: () => routerMock,
}));

vi.mock("../server/operations", () => ({ getReport: vi.fn() }));

import { Route } from "./reports";

const reportRoute = Route as unknown as {
  errorComponent: ComponentType;
  component: ComponentType;
};

afterEach(() => cleanup());

describe("Reports route error state", () => {
  it("offers an accessible retry that invalidates the route loader", () => {
    render(createElement(reportRoute.errorComponent));

    expect(screen.getByRole("alert").textContent).toContain("Retry the page");
    fireEvent.click(screen.getByRole("button", { name: "Retry reports" }));
    expect(routerMock.invalidate).toHaveBeenCalledTimes(1);
  });

  it.each([
    { period: "bas_quarter", label: "BAS quarter (informational)" },
    { period: "financial_year", label: "Australian financial year" },
  ])(
    "keeps the selected $label in the scoped period filter",
    ({ period, label }) => {
      routeState.result = {
        report: {
          basisLabel: "Activity-basis preparation view",
          warnings: [],
          lines: [],
          categoryLines: [],
        },
        balance: { lines: [] },
      };
      routeState.search = { basis: "activity", period };
      const { container } = render(createElement(reportRoute.component));

      const periodFilter = container.querySelector<HTMLElement>(
        ".report-filter--period",
      );
      expect(periodFilter).not.toBeNull();
      const periodInput = within(periodFilter as HTMLElement).getByRole(
        "combobox",
        { name: "Period" },
      ) as HTMLInputElement;
      expect(periodInput.value).toBe(label);

      const applyButton = screen.getByRole("button", { name: "Apply" });
      const form = applyButton.closest("form");
      expect(form?.method).toBe("get");
      expect(
        form?.querySelector<HTMLInputElement>(
          'input[type="hidden"][name="period"]',
        )?.value,
      ).toBe(period);
      expect(applyButton).toBeTruthy();
    },
  );

  it("labels the category table as preparation effects rather than deductions", () => {
    routeState.result = {
      report: {
        basisLabel: "Activity-basis preparation view",
        warnings: [],
        lines: [],
        categoryLines: [
          {
            period: "2026-06",
            category: "Software and subscriptions",
            incomeEffectAud: "0.0000",
            expenseEffectAud: "100.0000",
            includedCount: 1,
          },
        ],
      },
      balance: { lines: [] },
    };
    render(createElement(reportRoute.component));

    expect(
      screen.getByRole("heading", { name: "Category breakdown" }),
    ).toBeTruthy();
    expect(screen.getByText("Software and subscriptions")).toBeTruthy();
    expect(screen.getByText(/not deductible amounts/)).toBeTruthy();
    expect(
      screen.queryByRole("link", {
        name: "Open FY2025–26 partnership tax worksheet →",
      }),
    ).toBeNull();
  });

  it("wraps displayed report amounts and right-aligns monetary table columns", () => {
    routeState.result = {
      report: {
        basisLabel: "Cash-basis preparation view",
        warnings: [],
        lines: [
          {
            period: "2026-06",
            incomeEffectAud: "10.0000",
            expenseEffectAud: "2.0000",
            cashEffectAud: "8.0000",
            includedCount: 3,
          },
        ],
        categoryLines: [
          {
            period: "2026-06",
            category: "Software",
            incomeEffectAud: "3.0000",
            expenseEffectAud: "4.0000",
            includedCount: 2,
          },
        ],
      },
      balance: {
        lines: [
          {
            period: "2026-06",
            inflowAud: "100.0000",
            outflowAud: "20.0000",
            netMovementAud: "80.0000",
            includedCount: 5,
          },
        ],
      },
    };
    const { container } = render(createElement(reportRoute.component));

    expect(
      Array.from(
        container.querySelectorAll("[data-money-value]"),
        (element) => element.textContent,
      ),
    ).toEqual([
      "10.00",
      "2.00",
      "8.00",
      "3.00",
      "4.00",
      "100.00",
      "20.00",
      "80.00",
    ]);
    expect(container.querySelectorAll("th.money-column")).toHaveLength(8);
    expect(container.querySelectorAll("td.money-column")).toHaveLength(8);
  });

  it("renders compact warnings with a transaction link", () => {
    routeState.result = {
      report: {
        basisLabel: "Activity-basis preparation view",
        warnings: [
          {
            transactionId: "tx-1",
            reference: "INV-1",
            description: "Annual software subscription",
            reason: "missing activity date or explicit AUD value",
          },
          {
            transactionId: "tx-2",
            reference: null,
            description: null,
            reason: "pending settlement",
          },
        ],
        lines: [],
        categoryLines: [],
      },
      balance: { lines: [] },
    };
    render(createElement(reportRoute.component));

    fireEvent.click(screen.getByText("2 source warnings"));

    const describedWarning = screen
      .getByText(/Annual software subscription/)
      .closest("li") as HTMLElement;
    const undescribedWarning = screen
      .getByRole("link", { name: "View transaction tx-2" })
      .closest("li") as HTMLElement;

    expect(
      within(describedWarning).getByText(
        "missing activity date or explicit AUD value",
      ),
    ).toBeTruthy();
    expect(
      within(describedWarning).getByText(/Annual software subscription/),
    ).toBeTruthy();
    expect(
      within(describedWarning).getByRole("link", {
        name: "View transaction INV-1",
      }).textContent,
    ).toBe("INV-1");
    expect(
      within(describedWarning).getByRole("link", {
        name: "View transaction INV-1",
      }),
    ).toHaveProperty("pathname", "/transactions/tx-1");
    expect(
      within(undescribedWarning).getByRole("link", {
        name: "View transaction tx-2",
      }),
    ).toHaveProperty("pathname", "/transactions/tx-2");
    expect(within(undescribedWarning).queryByText("No description")).toBeNull();
    expect(
      within(undescribedWarning).getByText("pending settlement"),
    ).toBeTruthy();
  });
});
