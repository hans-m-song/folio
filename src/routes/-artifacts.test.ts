import { describe, expect, it, vi } from "vitest";

import {
  artifactListInput,
  artifactPageSize,
  artifactPagination,
  artifactSortsForPage,
  artifactFiltersForPage,
  resetArtifactFilterField,
  copyArtifactId,
  defaultArtifactQueryClauses,
  defaultArtifactSort,
  isArtifactDeletable,
  isArtifactDownloadable,
  validateArtifactSearch,
} from "./imports.library";

describe("artifact library query state", () => {
  it("defaults text to contains without changing other value-kind defaults", () => {
    expect(
      resetArtifactFilterField(
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
      resetArtifactFilterField(
        { id: 2, field: "filename", operator: "contains", value: "invoice" },
        "uploaded",
      ),
    ).toEqual({ id: 2, field: "uploaded", operator: "equals", value: "" });
    expect(
      resetArtifactFilterField(
        { id: 3, field: "filename", operator: "contains", value: "invoice" },
        "transactions",
      ),
    ).toEqual({ id: 3, field: "transactions", operator: "equals", value: "" });
    expect(
      resetArtifactFilterField(
        { id: 4, field: "filename", operator: "contains", value: "invoice" },
        "state",
      ),
    ).toEqual({
      id: 4,
      field: "state",
      operator: "contains_any",
      value: [],
    });
    expect(
      validateArtifactSearch({
        filters: [{ field: "filename", operator: "equals", value: "invoice" }],
      }).filters,
    ).toEqual([{ field: "filename", operator: "equals", value: "invoice" }]);
  });

  it("defaults enum clauses to exact membership and round-trips multiple choices", () => {
    const clause = resetArtifactFilterField(
      { id: 1, field: "filename", operator: "contains", value: "invoice" },
      "state",
    );
    expect(clause).toMatchObject({ operator: "contains_any", value: [] });
    expect(artifactFiltersForPage([clause])).toEqual([]);
    const filters = artifactFiltersForPage([
      { ...clause, value: ["available", "rejected"] },
      { id: 2, field: "linkage", operator: "contains_none", value: ["linked"] },
    ]);
    expect(validateArtifactSearch({ filters }).filters).toEqual(filters);
    expect(filters).toEqual([
      {
        field: "state",
        operator: "contains_any",
        value: ["available", "rejected"],
      },
      { field: "linkage", operator: "contains_none", value: ["linked"] },
    ]);
    expect(artifactFiltersForPage([{ ...clause, value: ["unknown"] }])).toEqual(
      [],
    );
  });

  it("migrates legacy scalar URL filters into composable clauses", () => {
    const search = validateArtifactSearch({
      filename: "  statement  ",
      profile: "commbank_statement_pdf_v1",
      from: "2026-09-01",
      to: "2026-09-23",
      state: "available",
      linkage: "unlinked",
      page: "3",
    });

    expect(search).toEqual({
      clauses: [
        {
          kind: "filter",
          clause: {
            field: "filename",
            operator: "contains",
            value: "statement",
          },
        },
        {
          kind: "filter",
          clause: {
            field: "profile",
            operator: "is",
            value: "commbank_statement_pdf_v1",
          },
        },
        {
          kind: "filter",
          clause: {
            field: "uploaded",
            operator: "greater_than_or_equal",
            value: "2026-09-01",
          },
        },
        {
          kind: "filter",
          clause: {
            field: "uploaded",
            operator: "less_than_or_equal",
            value: "2026-09-23",
          },
        },
        {
          kind: "filter",
          clause: { field: "state", operator: "is", value: "available" },
        },
        {
          kind: "filter",
          clause: { field: "linkage", operator: "is", value: "unlinked" },
        },
        ...defaultArtifactQueryClauses,
      ],
      filters: [
        { field: "filename", operator: "contains", value: "statement" },
        {
          field: "profile",
          operator: "is",
          value: "commbank_statement_pdf_v1",
        },
        {
          field: "uploaded",
          operator: "greater_than_or_equal",
          value: "2026-09-01",
        },
        {
          field: "uploaded",
          operator: "less_than_or_equal",
          value: "2026-09-23",
        },
        { field: "state", operator: "is", value: "available" },
        { field: "linkage", operator: "is", value: "unlinked" },
      ],
      sort: defaultArtifactSort,
      page: 3,
    });
  });

  it("accepts the deleting state so reserved artifacts can be retried", () => {
    expect(
      validateArtifactSearch({ state: "deleting" }).filters,
    ).toContainEqual({ field: "state", operator: "is", value: "deleting" });
  });

  it("uses safe defaults for invalid search values and dates", () => {
    expect(
      validateArtifactSearch({
        filename: "x".repeat(201),
        profile: "unsupported",
        from: "2026-02-30",
        to: "tomorrow",
        state: "removed",
        linkage: "maybe",
        page: "not-a-number",
      }),
    ).toEqual({
      clauses: defaultArtifactQueryClauses,
      filters: [],
      sort: defaultArtifactSort,
      page: 1,
    });
  });

  it("keeps multiple field-appropriate filters and ordered sort clauses in URL state", () => {
    const search = validateArtifactSearch({
      filters: [
        { field: "filename", operator: "not_contains", value: "draft" },
        { field: "transactions", operator: "greater_than", value: "2" },
        {
          field: "uploaded",
          operator: "less_than_or_equal",
          value: "2026-09-23",
        },
      ],
      sort: [
        { field: "state", direction: "asc" },
        { field: "uploaded", direction: "desc" },
      ],
      page: "4",
    });

    expect(search.filters).toHaveLength(3);
    expect(search.sort).toEqual([
      { field: "state", direction: "asc" },
      { field: "uploaded", direction: "desc" },
    ]);
    expect(search.page).toBe(4);
  });

  it("drops filter clauses with mismatched operators or values", () => {
    expect(
      validateArtifactSearch({
        filters: [{ field: "state", operator: "contains", value: "available" }],
      }).filters,
    ).toEqual([]);
    expect(
      validateArtifactSearch({
        filters: [{ field: "transactions", operator: "equals", value: "two" }],
      }).filters,
    ).toEqual([]);
  });

  it("maps the applied query to the bounded database request", () => {
    const search = validateArtifactSearch({
      filters: [
        { field: "filename", operator: "contains", value: "receipt" },
        { field: "profile", operator: "is", value: "manual_invoice_pdf_v1" },
        {
          field: "uploaded",
          operator: "greater_than_or_equal",
          value: "2026-09-01",
        },
        {
          field: "uploaded",
          operator: "less_than_or_equal",
          value: "2026-09-23",
        },
        { field: "state", operator: "is", value: "pending" },
        { field: "linkage", operator: "is", value: "linked" },
      ],
      sort: [
        { field: "transactions", direction: "desc" },
        { field: "uploaded", direction: "asc" },
      ],
      page: 4,
    });

    expect(artifactPageSize).toBe(25);
    expect(artifactListInput(search)).toEqual({
      filters: search.filters,
      sort: search.sort,
      limit: 25,
      offset: 75,
    });
  });

  it("keeps the query sort clause order when building database input", () => {
    const search = validateArtifactSearch({
      sort: artifactSortsForPage([
        { id: 1, field: "state", direction: "asc" },
        { id: 2, field: "filename", direction: "desc" },
      ]),
    });

    expect(artifactListInput(search).sort).toEqual([
      { field: "state", direction: "asc" },
      { field: "filename", direction: "desc" },
    ]);
  });

  it("keeps pagination in range for empty results and stale page URLs", () => {
    expect(artifactPagination(0, 1)).toEqual({
      page: 1,
      pageCount: 1,
      start: 0,
      end: 0,
    });
    expect(artifactPagination(26, 8)).toEqual({
      page: 2,
      pageCount: 2,
      start: 26,
      end: 26,
    });
  });
});

describe("artifact actions", () => {
  it("allows download only for available artifacts", () => {
    expect(isArtifactDownloadable("available")).toBe(true);
    expect(isArtifactDownloadable("pending")).toBe(false);
    expect(isArtifactDownloadable("superseded")).toBe(false);
    expect(isArtifactDownloadable("abandoned")).toBe(false);
    expect(isArtifactDownloadable("rejected")).toBe(false);
  });

  it("offers deletion only when both artifact link counts are zero", () => {
    const unlinked = {
      transactionCount: 0,
      bankRowCount: 0,
    };
    expect(isArtifactDeletable(unlinked)).toBe(true);
    expect(isArtifactDeletable({ ...unlinked, transactionCount: 1 })).toBe(
      false,
    );
    expect(isArtifactDeletable({ ...unlinked, bankRowCount: 1 })).toBe(false);
  });

  it("copies an artifact ID and reports clipboard failure", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(copyArtifactId("artifact-id", writeText)).resolves.toBe(
      "copied",
    );
    expect(writeText).toHaveBeenCalledWith("artifact-id");
    await expect(copyArtifactId("artifact-id", undefined)).resolves.toBe(
      "failed",
    );
  });
});
