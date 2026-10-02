import { describe, expect, it } from "vitest";

import {
  equalsAtCurrencyPrecision,
  formatAudDecimal,
  formatDecimal,
  formatMoneyAmount,
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

  it("displays cents without hiding meaningful sub-cent precision", () => {
    expect(formatMoneyAmount("719.9000")).toBe("719.90");
    expect(formatMoneyAmount("-11.9000")).toBe("-11.90");
    expect(formatMoneyAmount("0.0000")).toBe("0.00");
    expect(formatMoneyAmount("9007199254740993.1234")).toBe(
      "9,007,199,254,740,993.1234",
    );
    expect(formatMoneyAmount("1.0010")).toBe("1.001");
  });
});
