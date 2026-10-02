// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { selectAutocompleteOption } from "../components/autocomplete-test-helpers";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  search: {
    page: 1,
    builder: [
      {
        type: "sort",
        clause: { key: "postedDate", direction: "desc" },
      },
    ] as unknown[],
  },
  navigate: vi.fn(),
  invalidate: vi.fn(),
  listBankTransactions: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (configuration: Record<string, unknown>) => ({
    ...configuration,
    useLoaderData: () => mocks.rows,
    useSearch: () => mocks.search,
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

type SearchState = { page: number; builder: unknown[] };

const expectAppliedSearch = async (
  previous: SearchState,
  expected: SearchState,
) => {
  await waitFor(() => {
    const found = mocks.navigate.mock.calls.some(([options]) => {
      const search = (options as { search?: unknown }).search;
      return (
        typeof search === "function" &&
        JSON.stringify(
          (search as (current: SearchState) => SearchState)(previous),
        ) === JSON.stringify(expected)
      );
    });
    expect(found).toBe(true);
  });
};

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.search = {
    page: 1,
    builder: [
      {
        type: "sort",
        clause: { key: "postedDate", direction: "desc" },
      },
    ],
  };
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

describe("bank activity query controls", () => {
  it("right-aligns movement headers and preserves the formatted amount", () => {
    render(createElement(BankActivityPage));

    const table = screen.getByRole("table");
    const movementHeader = screen.getByRole("columnheader", {
      name: "Movement",
    });
    expect(movementHeader.classList.contains("money-column")).toBe(true);
    expect(
      movementHeader
        .querySelector("button")
        ?.classList.contains("money-column"),
    ).toBe(true);

    const movementCell = table.querySelector('td[data-label="Movement"]');
    expect(movementCell?.classList.contains("money-column")).toBe(true);
    expect(movementCell?.querySelector("[data-money-value]")?.textContent).toBe(
      "-$35.1200",
    );
  });

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

  it("applies mixed filters and sorts to URL state and resets the page", async () => {
    const previousSearch = {
      page: 4,
      builder: [
        {
          type: "sort",
          clause: { key: "postedDate", direction: "desc" },
        },
      ],
    };
    const expectedSearch = {
      page: 1,
      builder: [
        {
          type: "sort",
          clause: { key: "postedDate", direction: "desc" },
        },
        {
          type: "filter",
          clause: {
            field: "reviewState",
            operator: "contains_any",
            value: ["unresolved"],
          },
        },
        {
          type: "sort",
          clause: { key: "description", direction: "asc" },
        },
      ],
    };
    mocks.search = previousSearch;
    render(createElement(BankActivityPage));

    const builder = screen.getByLabelText("Bank activity query");
    await selectAutocompleteOption(
      screen.getByRole("combobox", {
        name: "Bank activity query add filter or sort",
      }),
      "Filter · Review state",
    );
    expect(
      (
        screen.getByRole("combobox", {
          name: "Review state filter operator",
        }) as HTMLInputElement
      ).value,
    ).toBe("contains any of");
    await selectAutocompleteOption(
      screen.getByRole("combobox", {
        name: "Review state contains any of values",
      }),
      "Unresolved",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply filter clause" }),
    );
    expect(builder.querySelector(".query-chip-builder__bar")).not.toBeNull();

    await selectAutocompleteOption(
      screen.getByRole("combobox", {
        name: "Bank activity query add filter or sort",
      }),
      "Sort · Description",
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply sort clause" }));

    await expectAppliedSearch(previousSearch, expectedSearch);
  });

  it("reorders mixed rows and applies sort priority by sort-row occurrence", async () => {
    const previousSearch = {
      page: 6,
      builder: [
        {
          type: "sort",
          clause: { key: "postedDate", direction: "desc" },
        },
      ],
    };
    mocks.search = previousSearch;
    render(createElement(BankActivityPage));

    await selectAutocompleteOption(
      screen.getByRole("combobox", {
        name: "Bank activity query add filter or sort",
      }),
      "Sort · Description",
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply sort clause" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Move Sort Description Ascending up",
      }),
    );
    await expectAppliedSearch(previousSearch, {
      page: 1,
      builder: [
        {
          type: "sort",
          clause: { key: "description", direction: "asc" },
        },
        {
          type: "sort",
          clause: { key: "postedDate", direction: "desc" },
        },
      ],
    });
  });

  it("rehydrates mixed row order when browser history changes the URL", () => {
    const savedSearch = {
      page: 2,
      builder: [
        {
          type: "sort",
          clause: { key: "amountAud", direction: "asc" },
        },
        {
          type: "filter",
          clause: {
            field: "description",
            operator: "contains",
            value: "coffee",
          },
        },
      ],
    };
    const { rerender } = render(createElement(BankActivityPage));

    mocks.search = savedSearch;
    rerender(createElement(BankActivityPage));

    const builder = screen.getByLabelText("Bank activity query");
    const chips = builder.querySelectorAll(".query-chip-builder__chip");
    expect(chips).toHaveLength(2);
    expect(
      chips[0]?.querySelector(
        'button[aria-label="Edit Sort Movement Ascending"]',
      ),
    ).not.toBeNull();
    expect(
      chips[1]?.querySelector(
        'button[aria-label="Edit Filter Description contains coffee"]',
      ),
    ).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit Filter Description contains coffee",
      }),
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Description contains value",
        }) as HTMLInputElement
      ).value,
    ).toBe("coffee");
  });

  it("clears filters and sorts independently and restores the default sort", async () => {
    const builder = [
      {
        type: "filter",
        clause: {
          field: "description",
          operator: "contains",
          value: "coffee",
        },
      },
      { type: "sort", clause: { key: "amountAud", direction: "desc" } },
    ];
    mocks.search = { page: 6, builder };
    const { rerender } = render(createElement(BankActivityPage));

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    const afterFilterReset = {
      page: 1,
      builder: [builder[1]],
    };
    await expectAppliedSearch({ page: 6, builder }, afterFilterReset);

    mocks.search = afterFilterReset;
    mocks.navigate.mockClear();
    rerender(createElement(BankActivityPage));
    fireEvent.click(screen.getByRole("button", { name: "Clear sorts" }));
    await expectAppliedSearch(afterFilterReset, {
      page: 1,
      builder: [
        {
          type: "sort",
          clause: { key: "postedDate", direction: "desc" },
        },
      ],
    });
  });

  it("applies header sort shortcuts without changing filters", () => {
    const builder = [
      {
        type: "filter",
        clause: {
          field: "description",
          operator: "contains",
          value: "coffee",
        },
      },
      { type: "sort", clause: { key: "amountAud", direction: "desc" } },
    ];
    mocks.search = { page: 6, builder };
    render(createElement(BankActivityPage));
    fireEvent.click(screen.getByRole("button", { name: /^Posted/ }));
    const headerNavigation = mocks.navigate.mock.calls.at(-1)?.[0] as {
      search: (previous: SearchState) => SearchState;
    };
    expect(headerNavigation.search({ page: 6, builder })).toEqual({
      page: 1,
      builder: [
        builder[0],
        {
          type: "sort",
          clause: { key: "postedDate", direction: "asc" },
        },
        builder[1],
      ],
    });
  });
});
