import { describe, expect, it } from "vitest";

import {
  bankImportsQueryForPage,
  parseBankImportsSearch,
  visibleBankImportsPage,
} from "./banking.imports";

describe("bank import history pagination", () => {
  it("uses URL-backed pages and requests one extra record to detect Next", () => {
    expect(parseBankImportsSearch({ page: "2" })).toEqual({ page: 2 });
    expect(parseBankImportsSearch({ page: "202" })).toEqual({ page: 1 });
    expect(bankImportsQueryForPage(2)).toEqual({ limit: 51, offset: 50 });
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
