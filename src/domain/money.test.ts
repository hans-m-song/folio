import { describe, expect, it } from "vitest";

import {
  equalsAtCurrencyPrecision,
  formatAudDecimal,
  formatDecimal,
  parseDecimal,
  sumDecimals,
} from "./money";

describe("fixed precision money", () => {
  it("parses and formats without Number arithmetic", () => {
    expect(formatDecimal(parseDecimal("9007199254740993.1234"))).toBe(
      "9007199254740993.1234",
    );
    expect(sumDecimals(["0.1000", "0.2000", "-0.0500"])).toBe("0.2500");
  });

  it("compares values at currency precision", () => {
    expect(equalsAtCurrencyPrecision("10.0050", "10.0049", 2)).toBe(false);
    expect(equalsAtCurrencyPrecision("10.0040", "10.0039", 2)).toBe(true);
  });

  it("formats exact signed AUD without floating-point conversion", () => {
    expect(formatAudDecimal("999999999999999.1234")).toBe(
      "+$999,999,999,999,999.1234",
    );
    expect(formatAudDecimal("-100000000000000.5000")).toBe(
      "-$100,000,000,000,000.5000",
    );
    expect(formatAudDecimal("1.00")).toBe("+$1.00");
  });
});
