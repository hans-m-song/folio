import { describe, expect, it } from "vitest";

import {
  bankImportsBuilderForSearchRows,
  bankImportsBuilderRowsForSearch,
  bankImportsFiltersForSearch,
  bankImportsQueryPartsForBuilder,
  bankImportsQueryForPage,
  defaultBankImportsSort,
  moveBankImportsBuilderRow,
  moveBankImportsSortClause,
  nextBankImportsSort,
  parseBankImportsSearch,
  resetBankImportsFilterField,
  visibleBankImportsPage,
} from "./banking.imports";

describe("bank import filter defaults", () => {
  it("defaults text to contains without changing other value-kind defaults", () => {
    expect(
      resetBankImportsFilterField(
        { id: 1, field: "state", operator: "is", value: "available" },
        "filename",
      ),
    ).toEqual({
      id: 1,
      field: "filename",
      operator: "contains",
      value: "",
    });
    expect(
      resetBankImportsFilterField(
        {
          id: 2,
          field: "filename",
          operator: "contains",
          value: "statement",
        },
        "earliestDate",
      ),
    ).toEqual({ id: 2, field: "earliestDate", operator: "equals", value: "" });
    expect(
      resetBankImportsFilterField(
        {
          id: 3,
          field: "filename",
          operator: "contains",
          value: "statement",
        },
        "rowCount",
      ),
    ).toEqual({ id: 3, field: "rowCount", operator: "equals", value: "" });
    expect(
      resetBankImportsFilterField(
        {
          id: 4,
          field: "filename",
          operator: "contains",
          value: "statement",
        },
        "state",
      ),
    ).toEqual({
      id: 4,
      field: "state",
      operator: "contains_any",
      value: [],
    });
    expect(
      parseBankImportsSearch({
        builder: [
          {
            type: "filter",
            clause: {
              field: "filename",
              operator: "equals",
              value: "statement",
            },
          },
        ],
      }).builder,
    ).toEqual([
      {
        type: "filter",
        clause: {
          field: "filename",
          operator: "equals",
          value: "statement",
        },
      },
    ]);
  });
});

describe("bank import history pagination", () => {
  it("uses URL-backed pages and requests one extra record to detect Next", () => {
    expect(parseBankImportsSearch({ page: "2" })).toEqual({
      page: 2,
      builder: [],
    });
    expect(parseBankImportsSearch({ page: "202" })).toEqual({
      page: 1,
      builder: [],
    });
    expect(bankImportsQueryForPage(2)).toEqual({
      limit: 51,
      offset: 50,
      filters: [],
      sort: defaultBankImportsSort,
    });
  });

  it("normalizes legacy filters and sorts into mixed ordered rows", () => {
    expect(
      parseBankImportsSearch({
        filters: [
          { field: "filename", operator: "contains", value: " sept " },
          { field: "rowCount", operator: "greater_than", value: "12" },
          { field: "state", operator: "contains", value: "available" },
        ],
        sort: [
          { key: "rowCount", direction: "desc" },
          { key: "filename", direction: "asc" },
        ],
      }),
    ).toEqual({
      page: 1,
      builder: [
        {
          type: "filter",
          clause: { field: "filename", operator: "contains", value: "sept" },
        },
        {
          type: "filter",
          clause: { field: "rowCount", operator: "greater_than", value: "12" },
        },
        {
          type: "sort",
          clause: { key: "rowCount", direction: "desc" },
        },
        {
          type: "sort",
          clause: { key: "filename", direction: "asc" },
        },
      ],
    });
    expect(
      bankImportsFiltersForSearch([
        {
          id: 1,
          field: "reviewedCount",
          operator: "greater_than_or_equal",
          value: "4",
        },
        {
          id: 2,
          field: "earliestDate",
          operator: "less_than_or_equal",
          value: "2026-09-30",
        },
        {
          id: 3,
          field: "rowCount",
          operator: "equals",
          value: "1.2",
        },
      ]),
    ).toEqual([
      {
        field: "reviewedCount",
        operator: "greater_than_or_equal",
        value: "4",
      },
      {
        field: "earliestDate",
        operator: "less_than_or_equal",
        value: "2026-09-30",
      },
    ]);
  });

  it("keeps legacy import state bookmarks and applies bounded membership filters", () => {
    const builder = [
      {
        type: "filter",
        clause: { field: "state", operator: "is_not", value: "rejected" },
      },
      {
        type: "filter",
        clause: {
          field: "state",
          operator: "contains_any",
          value: ["available", "awaiting_review"],
        },
      },
      {
        type: "filter",
        clause: { field: "state", operator: "contains_none", value: [] },
      },
    ] as const;
    const search = parseBankImportsSearch({ builder });

    expect(search.builder).toEqual(builder);
    expect(bankImportsQueryPartsForBuilder(search.builder)).toEqual({
      filters: [
        { field: "state", operator: "is_not", value: "rejected" },
        {
          field: "state",
          operator: "contains_any",
          value: ["available", "awaiting_review"],
        },
      ],
      sort: [],
    });
    expect(
      parseBankImportsSearch({
        builder: [
          {
            type: "filter",
            clause: {
              field: "state",
              operator: "contains_any",
              value: [
                "pending",
                "awaiting_review",
                "available",
                "rejected",
                "abandoned",
                "superseded",
                "available",
              ],
            },
          },
          {
            type: "filter",
            clause: {
              field: "state",
              operator: "contains_none",
              value: ["unknown"],
            },
          },
        ],
      }).builder,
    ).toEqual([]);
  });

  it("preserves mixed row order while deriving filters and sort priority", () => {
    const builder = [
      {
        type: "sort" as const,
        clause: { key: "rowCount" as const, direction: "desc" as const },
      },
      {
        type: "filter" as const,
        clause: {
          field: "filename" as const,
          operator: "contains" as const,
          value: "september",
        },
      },
      {
        type: "sort" as const,
        clause: { key: "earliestDate" as const, direction: "asc" as const },
      },
      {
        type: "filter" as const,
        clause: {
          field: "state" as const,
          operator: "is" as const,
          value: "available" as const,
        },
      },
    ];
    const search = parseBankImportsSearch({ builder });

    expect(search.builder).toEqual(builder);
    expect(bankImportsQueryPartsForBuilder(search.builder)).toEqual({
      filters: [
        { field: "filename", operator: "contains", value: "september" },
        { field: "state", operator: "is", value: "available" },
      ],
      sort: [
        { key: "rowCount", direction: "desc" },
        { key: "earliestDate", direction: "asc" },
      ],
    });

    const rows = bankImportsBuilderRowsForSearch(builder);
    const reordered = moveBankImportsBuilderRow(rows, 1, -1);
    expect(bankImportsBuilderForSearchRows(reordered)).toEqual([
      builder[1],
      builder[0],
      builder[2],
      builder[3],
    ]);
  });

  it("toggles header sorting and changes explicit clause priority", () => {
    expect(nextBankImportsSort([], "filename")).toEqual([
      { key: "filename", direction: "asc" },
    ]);
    expect(
      nextBankImportsSort(
        [
          { key: "rowCount", direction: "desc" },
          { key: "filename", direction: "asc" },
        ],
        "rowCount",
      ),
    ).toEqual([
      { key: "rowCount", direction: "asc" },
      { key: "filename", direction: "asc" },
    ]);
    expect(
      moveBankImportsSortClause(
        [
          { id: 1, key: "filename", direction: "asc" },
          { id: 2, key: "rowCount", direction: "desc" },
        ],
        0,
        1,
      ),
    ).toEqual([
      { id: 2, key: "rowCount", direction: "desc" },
      { id: 1, key: "filename", direction: "asc" },
    ]);
  });

  it("renders 50 imports and reports whether another page exists", () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => index);

    expect(visibleBankImportsPage(firstPage)).toEqual({
      imports: firstPage,
      hasNextPage: false,
    });
    expect(visibleBankImportsPage([...firstPage, 50])).toEqual({
      imports: firstPage,
      hasNextPage: true,
    });
  });
});
