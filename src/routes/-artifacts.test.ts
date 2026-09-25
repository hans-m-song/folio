import { describe, expect, it, vi } from "vitest";

import {
  artifactListInput,
  artifactPageSize,
  artifactPagination,
  copyArtifactId,
  isArtifactDeletable,
  isArtifactDownloadable,
  validateArtifactSearch,
} from "./imports.library";

describe("artifact library query state", () => {
  it("parses filename, profile, date, state, linkage, and page from URL search", () => {
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
      filename: "statement",
      profile: "commbank_statement_pdf_v1",
      from: "2026-09-01",
      to: "2026-09-23",
      state: "available",
      linkage: "unlinked",
      page: 3,
    });
  });

  it("accepts the deleting state so reserved artifacts can be retried", () => {
    expect(validateArtifactSearch({ state: "deleting" }).state).toBe(
      "deleting",
    );
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
      filename: "",
      profile: "all",
      from: "",
      to: "",
      state: "all",
      linkage: "all",
      page: 1,
    });
  });

  it("maps filters to the bounded independent artifact query", () => {
    const search = validateArtifactSearch({
      filename: "receipt",
      profile: "manual_invoice_pdf_v1",
      from: "2026-09-01",
      to: "2026-09-23",
      state: "pending",
      linkage: "linked",
      page: 4,
    });

    expect(artifactPageSize).toBe(25);
    expect(artifactListInput(search)).toEqual({
      search: "receipt",
      profile: "manual_invoice_pdf_v1",
      from: "2026-09-01",
      to: "2026-09-23",
      state: "pending",
      linkage: "linked",
      limit: 25,
      offset: 75,
    });
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
