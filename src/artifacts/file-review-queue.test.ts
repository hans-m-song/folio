import { describe, expect, it } from "vitest";

import { loadFileReviewQueue } from "./file-review-queue";
import { validateArtifactSearch } from "./library-query";

describe("file review queue", () => {
  it("loads ordered rows across pages with the applied filters and sort", async () => {
    const query = validateArtifactSearch({
      filters: [
        { field: "filename", operator: "contains", value: "statement" },
      ],
      sort: [{ field: "uploaded", direction: "asc" }],
    });
    const allRows = Array.from({ length: 205 }, (_, index) => ({
      id: index === 102 ? "approved-anchor" : `artifact-${index}`,
      state: index === 102 ? "available" : "awaiting_review",
    }));
    const requests: {
      filters: typeof query.filters;
      sort: typeof query.sort;
      limit: number;
      offset: number;
    }[] = [];

    const queue = await loadFileReviewQueue(query, async (input) => {
      requests.push(input);
      return {
        rows: allRows.slice(input.offset, input.offset + input.limit),
        total: allRows.length,
      };
    });

    expect(requests.map(({ offset }) => offset)).toEqual([0, 100, 200]);
    expect(requests.map(({ filters }) => filters)).toEqual([
      query.filters,
      query.filters,
      query.filters,
    ]);
    expect(requests.map(({ sort }) => sort)).toEqual([
      query.sort,
      query.sort,
      query.sort,
    ]);
    expect(requests.every(({ limit }) => limit === 100)).toBe(true);
    expect(queue).toEqual(allRows);
    expect(queue[102]).toEqual({ id: "approved-anchor", state: "available" });
  });

  it("throws when the result extends past the maximum addressable offset", async () => {
    const query = validateArtifactSearch({});
    const offsets: number[] = [];

    await expect(
      loadFileReviewQueue(query, async ({ offset }) => {
        offsets.push(offset);
        return {
          rows: Array.from({ length: 100 }, (_, index) => ({
            id: `artifact-${offset + index}`,
            state: "awaiting_review",
          })),
          total: 100_101,
        };
      }),
    ).rejects.toThrow(RangeError);

    expect(offsets).toEqual([0]);
  });

  it("throws when a page cannot satisfy its reported total", async () => {
    const query = validateArtifactSearch({});

    await expect(
      loadFileReviewQueue(query, async () => ({ rows: [], total: 2 })),
    ).rejects.toThrow("File review queue returned an incomplete page.");
  });

  it("throws when pagination returns a duplicate row", async () => {
    const query = validateArtifactSearch({});

    await expect(
      loadFileReviewQueue(query, async ({ offset }) => ({
        rows:
          offset === 0
            ? Array.from({ length: 100 }, (_, index) => ({
                id: index === 0 ? "duplicate" : `artifact-${index}`,
                state: "awaiting_review",
              }))
            : [{ id: "duplicate", state: "awaiting_review" }],
        total: 101,
      })),
    ).rejects.toThrow("File review queue returned duplicate rows.");
  });
});
