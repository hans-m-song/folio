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
    builder: [] as unknown[],
  },
  navigate: vi.fn(),
  invalidate: vi.fn(),
  listBankImports: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (configuration: Record<string, unknown>) => ({
    ...configuration,
    useLoaderData: () => mocks.rows,
    useSearch: () => mocks.search,
  }),
  Outlet: () => null,
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ invalidate: mocks.invalidate }),
  useRouterState: () => "/banking/imports",
}));

vi.mock("../server/bank-operations", () => ({
  listBankImports: mocks.listBankImports,
}));

import { Route } from "./banking.imports";

const BankImportsPage = (Route as unknown as { component: ComponentType })
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
  mocks.search = { page: 1, builder: [] };
  mocks.rows = Array.from({ length: 51 }, (_, index) => ({
    artifactId: `artifact-${index}`,
    filename: `bank-${index}.csv`,
    state: "available",
    createdAt: "2026-09-27T00:00:00.000Z",
    confirmedAt: null,
    rowCount: 12,
    unresolvedCount: 2,
    earliestDate: "2026-09-01",
    latestDate: "2026-09-12",
  }));
  mocks.navigate.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("bank import history query controls", () => {
  it("applies mixed filter and sort rows and resets the page", async () => {
    const previousSearch = {
      page: 3,
      builder: [{ type: "sort", clause: { key: "state", direction: "asc" } }],
    };
    const expectedSearch = {
      page: 1,
      builder: [
        { type: "sort", clause: { key: "state", direction: "asc" } },
        {
          type: "filter",
          clause: { field: "filename", operator: "contains", value: "sept" },
        },
        { type: "sort", clause: { key: "filename", direction: "asc" } },
      ],
    };
    mocks.search = previousSearch;
    render(createElement(BankImportsPage));

    await selectAutocompleteOption(
      screen.getByRole("combobox", {
        name: "Import history query add filter or sort",
      }),
      "Filter · Source file",
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Source file contains value" }),
      { target: { value: " sept " } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply filter clause" }),
    );
    await selectAutocompleteOption(
      screen.getByRole("combobox", {
        name: "Import history query add filter or sort",
      }),
      "Sort · Source file",
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply sort clause" }));

    await expectAppliedSearch(previousSearch, expectedSearch);
  });

  it("reorders sort priorities before applying them", async () => {
    render(createElement(BankImportsPage));

    await selectAutocompleteOption(
      screen.getByRole("combobox", {
        name: "Import history query add filter or sort",
      }),
      "Sort · Source file",
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply sort clause" }));
    await selectAutocompleteOption(
      screen.getByRole("combobox", {
        name: "Import history query add filter or sort",
      }),
      "Sort · Period start",
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply sort clause" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Move Sort Period start Ascending up",
      }),
    );
    await expectAppliedSearch(
      { page: 5, builder: [] },
      {
        page: 1,
        builder: [
          { type: "sort", clause: { key: "earliestDate", direction: "asc" } },
          { type: "sort", clause: { key: "filename", direction: "asc" } },
        ],
      },
    );
  });

  it("applies selected import states with contains_any by default", async () => {
    const previousSearch = { page: 7, builder: [] };
    mocks.search = previousSearch;
    render(createElement(BankImportsPage));

    await selectAutocompleteOption(
      screen.getByRole("combobox", {
        name: "Import history query add filter or sort",
      }),
      "Filter · Import state",
    );
    expect(
      (
        screen.getByRole("combobox", {
          name: "Import state filter operator",
        }) as HTMLInputElement
      ).value,
    ).toBe("contains any of");

    await selectAutocompleteOption(
      screen.getByRole("combobox", {
        name: "Import state contains any of values",
      }),
      "Available",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply filter clause" }),
    );

    await expectAppliedSearch(previousSearch, {
      page: 1,
      builder: [
        {
          type: "filter",
          clause: {
            field: "state",
            operator: "contains_any",
            value: ["available"],
          },
        },
      ],
    });
  });

  it("preserves URL filters and sorting when changing pages", () => {
    const builder = [
      {
        type: "filter",
        clause: { field: "state", operator: "is", value: "available" },
      },
      { type: "sort", clause: { key: "rowCount", direction: "desc" } },
    ];
    mocks.search = { page: 2, builder };
    render(createElement(BankImportsPage));

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const navigation = mocks.navigate.mock.calls.at(-1)?.[0] as {
      search: (previous: typeof mocks.search) => typeof mocks.search;
    };
    expect(navigation.search({ page: 2, builder })).toEqual({
      page: 3,
      builder,
    });
  });

  it("rehydrates mixed rows after a browser history navigation", () => {
    const savedSearch = {
      page: 2,
      builder: [
        {
          type: "sort",
          clause: { key: "rowCount", direction: "desc" },
        },
        {
          type: "filter",
          clause: {
            field: "filename",
            operator: "contains",
            value: "september",
          },
        },
      ],
    };
    const { rerender } = render(createElement(BankImportsPage));

    mocks.search = savedSearch;
    rerender(createElement(BankImportsPage));

    const builder = screen.getByLabelText("Import history query");
    const chips = builder.querySelectorAll(".query-chip-builder__chip");
    expect(chips).toHaveLength(2);
    expect(
      chips[0]?.querySelector('button[aria-label="Edit Sort Rows Descending"]'),
    ).not.toBeNull();
    expect(
      chips[1]?.querySelector(
        'button[aria-label="Edit Filter Source file contains september"]',
      ),
    ).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit Filter Source file contains september",
      }),
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Source file contains value",
        }) as HTMLInputElement
      ).value,
    ).toBe("september");
  });

  it("clears filters and sorts independently and applies header sort shortcuts", async () => {
    const builder = [
      {
        type: "filter",
        clause: { field: "filename", operator: "contains", value: "sept" },
      },
      { type: "sort", clause: { key: "rowCount", direction: "desc" } },
    ];
    mocks.search = { page: 6, builder };
    const { rerender } = render(createElement(BankImportsPage));

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    const afterFilterReset = {
      page: 1,
      builder: [builder[1]],
    };
    await expectAppliedSearch({ page: 6, builder }, afterFilterReset);

    mocks.search = afterFilterReset;
    mocks.navigate.mockClear();
    rerender(createElement(BankImportsPage));
    fireEvent.click(screen.getByRole("button", { name: "Clear sorts" }));
    await expectAppliedSearch(afterFilterReset, {
      page: 1,
      builder: [],
    });
  });

  it("applies header sort shortcuts without changing filters", () => {
    const builder = [
      {
        type: "filter",
        clause: { field: "filename", operator: "contains", value: "sept" },
      },
      { type: "sort", clause: { key: "rowCount", direction: "desc" } },
    ];
    mocks.search = { page: 6, builder };
    render(createElement(BankImportsPage));
    fireEvent.click(screen.getByRole("button", { name: /^Source file/ }));
    const headerNavigation = mocks.navigate.mock.calls.at(-1)?.[0] as {
      search: (previous: SearchState) => SearchState;
    };
    expect(headerNavigation.search({ page: 6, builder })).toEqual({
      page: 1,
      builder: [
        builder[0],
        {
          type: "sort",
          clause: { key: "filename", direction: "asc" },
        },
        builder[1],
      ],
    });
  });
});
