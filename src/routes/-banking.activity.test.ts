import { describe, expect, it } from "vitest";

import {
  bankActivityAmountDisplay,
  bankActivityDateDisplay,
  bankActivityQueryForPage,
  parseBankActivitySearch,
  visibleBankActivityPage,
} from "./banking.activity";

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
    expect(parseBankActivitySearch({ page: "2" })).toEqual({ page: 2 });
    expect(parseBankActivitySearch({ page: "0" })).toEqual({ page: 1 });
    expect(bankActivityQueryForPage(2)).toEqual({ limit: 51, offset: 50 });
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
