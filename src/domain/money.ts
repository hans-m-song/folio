import { z } from "zod";

export const decimalSchema = z
  .string()
  .regex(
    /^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/,
    "Expected a decimal with at most four places",
  );

export const nonNegativeDecimalSchema = decimalSchema.refine(
  (value) => !value.startsWith("-"),
  "Expected a non-negative decimal",
);

export type MinorTenThousandths = bigint & { readonly __money: unique symbol };

export function parseDecimal(value: string): MinorTenThousandths {
  const parsed = decimalSchema.parse(value);
  const negative = parsed.startsWith("-");
  const unsigned = negative ? parsed.slice(1) : parsed;
  const [whole, fraction = ""] = unsigned.split(".");
  const magnitude = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0"));
  return (negative ? -magnitude : magnitude) as MinorTenThousandths;
}

export function formatDecimal(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / 10_000n;
  const fraction = (magnitude % 10_000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function formatAudDecimal(value: string): string {
  const parsed = decimalSchema.parse(value);
  const negative = parsed.startsWith("-");
  const unsigned = negative ? parsed.slice(1) : parsed;
  const [whole, fraction] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : "+"}$${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

export function sumDecimals(values: readonly string[]): string {
  return formatDecimal(
    values.reduce((sum, value) => sum + parseDecimal(value), 0n),
  );
}

export function equalsAtCurrencyPrecision(
  left: string,
  right: string,
  precision: number,
): boolean {
  const divisor = 10n ** BigInt(4 - precision);
  const round = (value: bigint) => {
    const half = divisor / 2n;
    return value >= 0n ? (value + half) / divisor : (value - half) / divisor;
  };
  return round(parseDecimal(left)) === round(parseDecimal(right));
}
