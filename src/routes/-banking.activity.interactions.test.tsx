// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  navigate: vi.fn(),
  invalidate: vi.fn(),
  listBankTransactions: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (configuration: Record<string, unknown>) => ({
    ...configuration,
    useLoaderData: () => mocks.rows,
    useSearch: () => ({ page: 1 }),
  }),
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ invalidate: mocks.invalidate }),
}));

vi.mock("../server/bank-operations", () => ({
  listBankTransactions: mocks.listBankTransactions,
}));

import { Route } from "./banking.activity";

const BankActivityPage = (Route as unknown as { component: ComponentType })
  .component;

beforeEach(() => {
  mocks.rows = [
    {
      id: "bank-row-1",
      postedDate: "2026-09-24",
      description: "Payment to Example Supplier",
      amountAud: "-35.1200",
      reviewState: "unresolved",
      matchedTransactionId: null,
    },
  ];
});

afterEach(() => {
  cleanup();
});

describe("bank activity row action", () => {
  it("exposes a labelled Review row icon with hover and focus tooltips", () => {
    render(createElement(BankActivityPage));

    const reviewLink = screen.getByRole("link", {
      name: "Review bank row posted 2026-09-24",
    });
    expect(reviewLink.getAttribute("href")).toBe(
      "/banking/reconcile?bank=bank-row-1&window=14",
    );
    expect(reviewLink.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(reviewLink.querySelector(".table-action-label")?.textContent).toBe(
      "Review row",
    );

    const actionWrap = reviewLink.closest(".table-action-wrap")!;
    fireEvent.mouseEnter(actionWrap);
    const hoverTooltip = screen.getByRole("tooltip");
    expect(hoverTooltip.textContent).toBe("Review row");
    expect(reviewLink.getAttribute("aria-describedby")).toBe(
      hoverTooltip.getAttribute("id"),
    );

    fireEvent.mouseLeave(actionWrap);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(reviewLink);
    expect(screen.getByRole("tooltip").textContent).toBe("Review row");
    fireEvent.blur(reviewLink);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
