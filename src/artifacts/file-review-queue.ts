import type {
  ArtifactSearch,
  ArtifactSearchFilter,
  ArtifactSort,
} from "./library-query";

const pageSize = 100;
const maxOffset = 100_000;
const maxRows = maxOffset + pageSize;

type FileReviewQueueRow = { id: string; state: string };

type FileReviewQueuePage = {
  rows: FileReviewQueueRow[];
  total: number;
};

type ListFileReviewQueuePage = (input: {
  filters: ArtifactSearchFilter[];
  sort: ArtifactSort[];
  limit: number;
  offset: number;
}) => Promise<FileReviewQueuePage>;

export const loadFileReviewQueue = async (
  query: Pick<ArtifactSearch, "filters" | "sort">,
  listPage: ListFileReviewQueuePage,
): Promise<FileReviewQueueRow[]> => {
  const rows: FileReviewQueueRow[] = [];
  const seenIds = new Set<string>();
  let total: number | undefined;

  for (
    let offset = 0;
    total === undefined || offset < total;
    offset += pageSize
  ) {
    if (offset > maxOffset)
      throw new RangeError(
        "File review queue exceeds the maximum list offset.",
      );

    const page = await listPage({
      filters: query.filters,
      sort: query.sort,
      limit: pageSize,
      offset,
    });

    if (!Number.isSafeInteger(page.total) || page.total < 0)
      throw new Error("File review queue returned an invalid total.");

    if (total === undefined) {
      total = page.total;
      if (total > maxRows)
        throw new RangeError(
          "File review queue exceeds the maximum list offset.",
        );
    } else if (page.total !== total) {
      throw new Error("File review queue changed while it was being loaded.");
    }

    const expectedRows = Math.min(pageSize, total - offset);
    if (page.rows.length !== expectedRows)
      throw new Error("File review queue returned an incomplete page.");

    for (const row of page.rows) {
      if (seenIds.has(row.id))
        throw new Error("File review queue returned duplicate rows.");
      seenIds.add(row.id);
      rows.push(row);
    }
  }

  return rows;
};
