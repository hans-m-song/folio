import {
  decimalSchema,
  equalsAtCurrencyPrecision,
  formatDecimal,
  parseDecimal,
} from "./money";
import { FolioDiagnosticError } from "./diagnostics";
import type { StripeTransactionKind } from "./stripe-semantics";

export { FolioDiagnosticError } from "./diagnostics";
export {
  classifyStripeReportingCategory,
  stripeBalanceMovement,
  stripeDisplayDescription,
  stripeDisplaySource,
  stripeDisplaySourceLabel,
  stripeNetBalanceMovement,
  stripeReportingCategoryKinds,
  transactionDisplaySource,
  type StripeBalanceMovement,
  type StripeCategoryClassification,
  type StripeTransactionKind,
} from "./stripe-semantics";

export interface StripeImportRow {
  reference: string;
  occurredAt: string;
  availableAt: string | null;
  sourceCurrency: string;
  sourceGross: string;
  sourceFee: string;
  sourceNet: string;
  reportingCategory: string;
  description: string | null;
}

export type StripeImportPreviewStatus =
  | "will_import"
  | "already_imported"
  | "conflict";

export interface StripeImportPreviewRow {
  reference: string;
  occurredAt: string;
  availableAt: string | null;
  sourceCurrency: string;
  sourceGross: string;
  sourceFee: string;
  sourceNet: string;
  reportingCategory: string;
  kind: StripeTransactionKind;
  mappingWarning: string | null;
  importStatus: StripeImportPreviewStatus;
}

export interface StripeImportPreview {
  artifactId: string;
  totalCount: number;
  willImportCount: number;
  alreadyImportedCount: number;
  conflictCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  displayedCount: number;
  rows: StripeImportPreviewRow[];
}

export const stripeBalanceCsvHeaders = [
  "balance_transaction_id",
  "created",
  "available_on",
  "currency",
  "gross",
  "fee",
  "net",
  "reporting_category",
  "description",
] as const;

const timestampAliases = {
  created: "created_utc",
  available_on: "available_on_utc",
} as const;

export type StripeCsvValidationReason =
  | "empty_csv"
  | "invalid_headers"
  | "unsupported_all_activity_export"
  | "missing_headers"
  | "malformed_csv"
  | "wrong_column_count"
  | "duplicate_reference"
  | "invalid_currency"
  | "invalid_amount"
  | "net_mismatch"
  | "invalid_timestamp";

export interface StripeCsvValidationDetail {
  reason: StripeCsvValidationReason;
  rowNumber?: number;
  missingHeaders?: readonly string[];
}

export class StripeCsvValidationError extends FolioDiagnosticError {
  readonly code = "STRIPE_CSV_INVALID" as const;
  readonly detail: StripeCsvValidationDetail;

  constructor(
    detail: StripeCsvValidationDetail,
    message = "Stripe CSV validation failed",
  ) {
    super(
      {
        category: "validation",
        code: "STRIPE_CSV_INVALID",
        retryable: false,
        detail,
      },
      message,
    );
    this.detail = detail;
    this.name = "StripeCsvValidationError";
  }
}

export interface StripeCsvParseOptions {
  reportingTimezone?: string;
}

const validationError = (
  detail: StripeCsvValidationDetail,
  message: string,
): StripeCsvValidationError => new StripeCsvValidationError(detail, message);

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const datePartsPattern = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

const timestampPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

const epochForDateParts = (parts: DateParts): number => {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.valueOf();
};

const validCalendarParts = (parts: DateParts): boolean => {
  const epoch = epochForDateParts(parts);
  if (Number.isNaN(epoch)) return false;
  const date = new Date(epoch);
  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day &&
    date.getUTCHours() === parts.hour &&
    date.getUTCMinutes() === parts.minute &&
    date.getUTCSeconds() === parts.second
  );
};

const datePartsFromMatch = (match: RegExpExecArray, offset = 1): DateParts => ({
  year: Number(match[offset]),
  month: Number(match[offset + 1]),
  day: Number(match[offset + 2]),
  hour: Number(match[offset + 3]),
  minute: Number(match[offset + 4]),
  second: Number(match[offset + 5]),
});

const datePartsEqual = (left: DateParts, right: DateParts): boolean =>
  left.year === right.year &&
  left.month === right.month &&
  left.day === right.day &&
  left.hour === right.hour &&
  left.minute === right.minute &&
  left.second === right.second;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timezone: string): Intl.DateTimeFormat => {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new Error("Invalid Stripe reporting timezone");
  }
  formatterCache.set(timezone, formatter);
  return formatter;
};

const partsInTimezone = (
  instant: Date,
  timezone: string,
): DateParts | undefined => {
  const parts = formatterFor(timezone).formatToParts(instant);
  const values = new Map(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const result = {
    year: values.get("year"),
    month: values.get("month"),
    day: values.get("day"),
    hour: values.get("hour"),
    minute: values.get("minute"),
    second: values.get("second"),
  };
  return Object.values(result).every((value) => value !== undefined)
    ? (result as DateParts)
    : undefined;
};

const calendarDateInTimezone = (value: string, timezone: string): string => {
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf()))
    throw new Error("Invalid Stripe occurred timestamp");
  const parts = partsInTimezone(instant, timezone);
  if (!parts) throw new Error("Invalid Stripe occurred timestamp");
  return [parts.year, parts.month, parts.day]
    .map((part, index) => part.toString().padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
};

export const formatStripeImportFilename = (
  rows: readonly Pick<StripeImportRow, "occurredAt">[],
  reportingTimezone: string,
): string | null => {
  if (rows.length === 0) return null;
  const dates = rows.map((row) =>
    calendarDateInTimezone(row.occurredAt, reportingTimezone),
  );
  const from = dates.reduce((earliest, date) =>
    date < earliest ? date : earliest,
  );
  const to = dates.reduce((latest, date) => (date > latest ? date : latest));
  return `Stripe-${from}-${to}.csv`;
};

const timezoneOffsetCandidates = (
  localEpoch: number,
  timezone: string,
): number[] => {
  const offsets = new Set<number>();
  const day = 24 * 60 * 60 * 1_000;
  for (const delta of [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3]) {
    const instant = new Date(localEpoch + delta * day);
    const local = partsInTimezone(instant, timezone);
    if (!local) continue;
    offsets.add(epochForDateParts(local) - instant.valueOf());
  }
  return [...offsets];
};

const parseFloatingTimestamp = (
  value: string,
  rowNumber: number,
  timezone: string | undefined,
): string => {
  if (!timezone)
    throw validationError(
      { reason: "invalid_timestamp", rowNumber },
      `Invalid Stripe timestamp at row ${rowNumber}: reporting timezone is required`,
    );

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = formatterFor(timezone);
  } catch {
    throw validationError(
      { reason: "invalid_timestamp", rowNumber },
      `Invalid Stripe timestamp at row ${rowNumber}: reporting timezone is invalid`,
    );
  }
  void formatter;

  const match = datePartsPattern.exec(value);
  if (!match)
    throw validationError(
      { reason: "invalid_timestamp", rowNumber },
      `Invalid Stripe timestamp at row ${rowNumber}`,
    );
  const localParts = datePartsFromMatch(match);
  if (!validCalendarParts(localParts))
    throw validationError(
      { reason: "invalid_timestamp", rowNumber },
      `Invalid Stripe timestamp at row ${rowNumber}`,
    );
  const localEpoch = epochForDateParts(localParts);
  const candidates = timezoneOffsetCandidates(localEpoch, timezone)
    .map((offset) => new Date(localEpoch - offset))
    .filter((instant) => {
      const roundTrip = partsInTimezone(instant, timezone);
      return roundTrip !== undefined && datePartsEqual(roundTrip, localParts);
    });
  if (candidates.length !== 1)
    throw validationError(
      { reason: "invalid_timestamp", rowNumber },
      `Invalid Stripe timestamp at row ${rowNumber}: local time is not unique in reporting timezone`,
    );
  return candidates[0]!.toISOString();
};

function parseTimestamp(
  value: string,
  rowNumber: number,
  timezone: string | undefined,
  utcAlias = false,
): string {
  const match = timestampPattern.exec(value);
  if (!match) {
    const floating = datePartsPattern.test(value);
    if (floating)
      return parseFloatingTimestamp(
        value,
        rowNumber,
        utcAlias ? "UTC" : timezone,
      );
    throw validationError(
      { reason: "invalid_timestamp", rowNumber },
      `Invalid Stripe timestamp at row ${rowNumber}`,
    );
  }
  const parts = datePartsFromMatch(match);
  const offset = match[7] ?? "";
  const offsetMatch = /^[+-](\d{2}):(\d{2})$/.exec(offset);
  if (
    !validCalendarParts(parts) ||
    (offsetMatch &&
      (Number(offsetMatch[1]) > 23 || Number(offsetMatch[2]) > 59))
  )
    throw validationError(
      { reason: "invalid_timestamp", rowNumber },
      `Invalid Stripe timestamp at row ${rowNumber}`,
    );
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()))
    throw validationError(
      { reason: "invalid_timestamp", rowNumber },
      `Invalid Stripe timestamp at row ${rowNumber}`,
    );
  return parsed.toISOString();
}

function parseCsvRecords(source: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else field += char;
      continue;
    }
    if (closedQuote && char !== "," && char !== "\n" && char !== "\r") {
      throw validationError(
        { reason: "malformed_csv" },
        "Unexpected character after quoted CSV field",
      );
    }
    if (char === '"') {
      if (field.length > 0 || closedQuote)
        throw validationError(
          { reason: "malformed_csv" },
          "Unexpected quote in unquoted CSV field",
        );
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
      closedQuote = false;
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      closedQuote = false;
    } else if (char === "\r") {
      if (source[index + 1] !== "\n")
        throw validationError(
          { reason: "malformed_csv" },
          "Bare carriage return in CSV input",
        );
    } else field += char;
  }
  if (quoted)
    throw validationError(
      { reason: "malformed_csv" },
      "Unterminated quoted CSV field",
    );
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

const optionsFor = (
  options: StripeCsvParseOptions | string | undefined,
): StripeCsvParseOptions =>
  typeof options === "string"
    ? { reportingTimezone: options }
    : (options ?? {});

export function parseStripeBalanceCsv(
  source: string,
  options?: StripeCsvParseOptions | string,
): StripeImportRow[] {
  const { reportingTimezone } = optionsFor(options);
  const records = parseCsvRecords(source.replace(/^\uFEFF/, ""));
  const [headers, ...rows] = records;
  if (!headers) throw validationError({ reason: "empty_csv" }, "CSV is empty");
  const normalisedHeaders = headers.map((header) => header.trim());
  if (
    normalisedHeaders.some((header) => !header) ||
    new Set(normalisedHeaders).size !== normalisedHeaders.length
  ) {
    throw validationError(
      { reason: "invalid_headers" },
      "CSV headers must be non-empty and unique",
    );
  }
  const positions = new Map(
    normalisedHeaders.map((header, index) => [header, index]),
  );
  if (
    ["ID", "Type", "Source", "Amount", "Created (UTC)"].every((header) =>
      positions.has(header),
    )
  )
    throw validationError(
      { reason: "unsupported_all_activity_export" },
      "Stripe All activity export is not a Balance Summary itemised CSV",
    );
  const missing = stripeBalanceCsvHeaders.filter((header) => {
    const alias = timestampAliases[header as keyof typeof timestampAliases];
    return !positions.has(header) && (!alias || !positions.has(alias));
  });
  if (missing.length > 0)
    throw validationError(
      { reason: "missing_headers", missingHeaders: missing },
      `Missing Stripe columns: ${missing.join(", ")}`,
    );
  const references = new Set<string>();
  return rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((value) => value.trim() !== ""))
    .map(({ row, rowNumber }) => {
      if (row.length !== headers.length)
        throw validationError(
          { reason: "wrong_column_count", rowNumber },
          `Row ${rowNumber} has the wrong column count`,
        );
      const read = (header: (typeof stripeBalanceCsvHeaders)[number]) =>
        row[positions.get(header)!]!.trim();
      const reference = read("balance_transaction_id");
      if (!reference || references.has(reference))
        throw validationError(
          { reason: "duplicate_reference", rowNumber },
          `Duplicate or empty Stripe reference at row ${rowNumber}`,
        );
      references.add(reference);
      const currency = read("currency").toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency))
        throw validationError(
          { reason: "invalid_currency", rowNumber },
          `Invalid currency at row ${rowNumber}`,
        );
      let gross: string;
      let fee: string;
      let net: string;
      try {
        gross = formatDecimal(parseDecimal(decimalSchema.parse(read("gross"))));
        fee = formatDecimal(parseDecimal(decimalSchema.parse(read("fee"))));
        net = formatDecimal(parseDecimal(decimalSchema.parse(read("net"))));
      } catch {
        throw validationError(
          { reason: "invalid_amount", rowNumber },
          `Invalid amount at row ${rowNumber}`,
        );
      }
      const calculatedNet = formatDecimal(
        parseDecimal(gross) - parseDecimal(fee),
      );
      if (!equalsAtCurrencyPrecision(calculatedNet, net, 2)) {
        throw validationError(
          { reason: "net_mismatch", rowNumber },
          `Gross minus fee does not equal net at row ${rowNumber}`,
        );
      }
      const createdHeader = positions.has("created")
        ? "created"
        : "created_utc";
      const availableHeader = positions.has("available_on")
        ? "available_on"
        : "available_on_utc";
      const occurredAt = parseTimestamp(
        row[positions.get(createdHeader)!]!.trim(),
        rowNumber,
        reportingTimezone,
        createdHeader === "created_utc",
      );
      const available = row[positions.get(availableHeader)!]!.trim();
      const availableAt = available
        ? parseTimestamp(
            available,
            rowNumber,
            reportingTimezone,
            availableHeader === "available_on_utc",
          )
        : null;
      return {
        reference,
        occurredAt,
        availableAt,
        sourceCurrency: currency,
        sourceGross: gross,
        sourceFee: fee,
        sourceNet: net,
        reportingCategory: read("reporting_category"),
        description: read("description") || null,
      };
    });
}
