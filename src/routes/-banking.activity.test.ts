import { describe, expect, it } from "vitest";

import {
  bankActivityAmountDisplay,
  bankActivityDateDisplay,
  bankActivityBuilderRowsForSearch,
  bankActivityBuilderForSearchRows,
  bankActivityQueryPartsForBuilder,
  bankActivityFiltersForSearch,
  bankActivityQueryForPage,
  defaultBankActivitySort,
  moveBankActivityBuilderRow,
  moveBankActivitySortClause,
  nextBankActivitySort,
  parseBankActivitySearch,
  resetBankActivityFilterField,
  visibleBankActivityPage,
} from "./banking.activity";

describe("bank activity filter defaults", () => {
  it("defaults text to contains without changing other value-kind defaults", () => {
    expect(
      resetBankActivityFilterField(
        { id: 1, field: "reviewState", operator: "is", value: "unresolved" },
        "description",
      ),
    ).toEqual({
      id: 1,
      field: "description",
      operator: "contains",
      value: "",
    });
    expect(
      resetBankActivityFilterField(
        {
          id: 2,
          field: "description",
          operator: "contains",
          value: "coffee",
        },
        "postedDate",
      ),
    ).toEqual({ id: 2, field: "postedDate", operator: "equals", value: "" });
    expect(
      resetBankActivityFilterField(
        {
          id: 3,
          field: "description",
          operator: "contains",
          value: "coffee",
        },
        "amountAud",
      ),
    ).toEqual({ id: 3, field: "amountAud", operator: "equals", value: "" });
    expect(
      resetBankActivityFilterField(
        {
          id: 4,
          field: "description",
          operator: "contains",
          value: "coffee",
        },
        "reviewState",
      ),
    ).toEqual({
      id: 4,
      field: "reviewState",
      operator: "contains_any",
      value: [],
    });
    expect(
      parseBankActivitySearch({
        builder: [
          {
            type: "filter",
            clause: {
              field: "description",
              operator: "equals",
              value: "coffee",
            },
          },
        ],
      }).builder,
    ).toEqual([
      {
        type: "filter",
        clause: {
          field: "description",
          operator: "equals",
          value: "coffee",
        },
      },
    ]);
  });
});

describe("bank activity amount presentation", () => {
  it("preserves exact large values and source scale", () => {
    expect(bankActivityAmountDisplay("999999999999999.1234")).toEqual({
      text: "+$999,999,999,999,999.1234",
      className: "amount-positive",
    });
    expect(bankActivityAmountDisplay("-123456789012345.5000")).toEqual({
      text: "-$123,456,789,012,345.5000",
      className: "amount-negative",
    });
  });

  it("uses URL-backed pages and requests one extra row to detect a next page", () => {
    expect(parseBankActivitySearch({ page: "2" })).toEqual({
      page: 2,
      builder: defaultBankActivitySort.map((clause) => ({
        type: "sort",
        clause,
      })),
    });
    expect(parseBankActivitySearch({ page: "0" })).toEqual({
      page: 1,
      builder: defaultBankActivitySort.map((clause) => ({
        type: "sort",
        clause,
      })),
    });
    expect(bankActivityQueryForPage(2)).toEqual({
      limit: 51,
      offset: 50,
      filters: [],
      sort: defaultBankActivitySort,
    });
  });

  it("normalizes legacy filters and sorts into the mixed builder", () => {
    expect(
      parseBankActivitySearch({
        filters: [
          { field: "description", operator: "contains", value: " coffee " },
          { field: "amountAud", operator: "is", value: "10" },
        ],
        sort: [
          { key: "amountAud", direction: "asc" },
          { key: "postedDate", direction: "desc" },
        ],
      }),
    ).toEqual({
      page: 1,
      builder: [
        {
          type: "filter",
          clause: {
            field: "description",
            operator: "contains",
            value: "coffee",
          },
        },
        {
          type: "sort",
          clause: { key: "amountAud", direction: "asc" },
        },
        {
          type: "sort",
          clause: { key: "postedDate", direction: "desc" },
        },
      ],
    });
    expect(
      parseBankActivitySearch({
        sort: [
          { key: "amountAud", direction: "asc" },
          { key: "amountAud", direction: "desc" },
        ],
      }).builder,
    ).toEqual(
      defaultBankActivitySort.map((clause) => ({ type: "sort", clause })),
    );
    expect(
      bankActivityFiltersForSearch([
        {
          id: 1,
          field: "postedDate",
          operator: "greater_than_or_equal",
          value: "2026-09-01",
        },
        {
          id: 2,
          field: "description",
          operator: "contains",
          value: "  coffee  ",
        },
        {
          id: 3,
          field: "amountAud",
          operator: "greater_than",
          value: "",
        },
      ]),
    ).toEqual([
      {
        field: "postedDate",
        operator: "greater_than_or_equal",
        value: "2026-09-01",
      },
      { field: "description", operator: "contains", value: "coffee" },
    ]);
  });

  it("keeps legacy enum bookmarks and applies bounded exact membership filters", () => {
    const builder = [
      {
        type: "filter",
        clause: {
          field: "reviewState",
          operator: "is_not",
          value: "private",
        },
      },
      {
        type: "filter",
        clause: {
          field: "reviewState",
          operator: "contains_any",
          value: ["unresolved", "matched"],
        },
      },
      {
        type: "filter",
        clause: {
          field: "matchStatus",
          operator: "contains_none",
          value: ["matched"],
        },
      },
      {
        type: "filter",
        clause: {
          field: "matchStatus",
          operator: "contains_any",
          value: [],
        },
      },
    ] as const;
    const search = parseBankActivitySearch({ builder });

    expect(search.builder).toEqual(builder);
    expect(bankActivityQueryPartsForBuilder(search.builder)).toEqual({
      filters: [
        { field: "reviewState", operator: "is_not", value: "private" },
        {
          field: "reviewState",
          operator: "contains_any",
          value: ["unresolved", "matched"],
        },
        {
          field: "matchStatus",
          operator: "contains_none",
          value: ["matched"],
        },
      ],
      sort: [],
    });
    expect(
      parseBankActivitySearch({
        builder: [
          {
            type: "filter",
            clause: {
              field: "reviewState",
              operator: "contains_any",
              value: [
                "unresolved",
                "matched",
                "private",
                "transfer",
                "duplicate",
                "unresolved",
              ],
            },
          },
          {
            type: "filter",
            clause: {
              field: "matchStatus",
              operator: "contains_none",
              value: ["available"],
            },
          },
        ],
      }).builder,
    ).toEqual([]);
  });

  it("preserves mixed row order while deriving AND filters and ordered sorts", () => {
    const builder = [
      {
        type: "sort" as const,
        clause: { key: "amountAud" as const, direction: "asc" as const },
      },
      {
        type: "filter" as const,
        clause: {
          field: "description" as const,
          operator: "contains" as const,
          value: "coffee",
        },
      },
      {
        type: "sort" as const,
        clause: { key: "postedDate" as const, direction: "desc" as const },
      },
      {
        type: "filter" as const,
        clause: {
          field: "reviewState" as const,
          operator: "is" as const,
          value: "unresolved" as const,
        },
      },
    ];
    const search = parseBankActivitySearch({ builder });

    expect(search.builder).toEqual(builder);
    expect(bankActivityQueryPartsForBuilder(search.builder)).toEqual({
      filters: [
        { field: "description", operator: "contains", value: "coffee" },
        { field: "reviewState", operator: "is", value: "unresolved" },
      ],
      sort: [
        { key: "amountAud", direction: "asc" },
        { key: "postedDate", direction: "desc" },
      ],
    });

    const rows = bankActivityBuilderRowsForSearch(builder);
    const reordered = moveBankActivityBuilderRow(rows, 1, -1);
    expect(bankActivityBuilderForSearchRows(reordered)).toEqual([
      builder[1],
      builder[0],
      builder[2],
      builder[3],
    ]);
  });

  it("toggles a primary header sort and moves ordered clauses", () => {
    const primary = [{ key: "postedDate", direction: "desc" }] as const;
    expect(nextBankActivitySort(primary, "postedDate")).toEqual([
      { key: "postedDate", direction: "asc" },
    ]);
    expect(nextBankActivitySort(primary, "amountAud")).toEqual([
      { key: "amountAud", direction: "asc" },
      { key: "postedDate", direction: "desc" },
    ]);
    expect(
      moveBankActivitySortClause(
        [
          { id: 1, key: "postedDate", direction: "desc" },
          { id: 2, key: "amountAud", direction: "asc" },
        ],
        1,
        -1,
      ),
    ).toEqual([
      { id: 2, key: "amountAud", direction: "asc" },
      { id: 1, key: "postedDate", direction: "desc" },
    ]);
  });

  it("shows at most 50 rows and derives next-page state from the extra row", () => {
    const fullPage = Array.from({ length: 50 }, (_, index) => index);
    const followingPage = [...fullPage, 50];

    expect(visibleBankActivityPage(fullPage)).toEqual({
      rows: fullPage,
      hasNextPage: false,
    });
    expect(visibleBankActivityPage(followingPage)).toEqual({
      rows: fullPage,
      hasNextPage: true,
    });
  });
});

describe("bank activity date presentation", () => {
  it("formats posted dates with the en-AU short month without shifting the day", () => {
    expect(bankActivityDateDisplay("2026-05-16")).toBe("16 May 2026");
  });
});
