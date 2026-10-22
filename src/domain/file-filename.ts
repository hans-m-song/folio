import { isValidIsoDate, parsePdfFilename } from "./pdf-filename";

export interface FileFilenameSuggestions {
  supplier: string | null;
  documentDate: string | null;
  reference: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface FileMetadataValues {
  supplier: string;
  documentDate: string;
  reference: string;
  periodStart: string;
  periodEnd: string;
}

export interface FileFilenameSuggestionApplication {
  values: FileMetadataValues;
  filled: readonly (keyof FileMetadataValues)[];
  conflicts: readonly ("periodStart" | "periodEnd")[];
}

export interface CsvFilenameMetadata {
  provider: "Stripe" | "CommBank";
  profile:
    | "stripe_balance_itemised_csv_v1"
    | "commbank_transaction_history_csv_v1";
  periodStart: string;
  periodEnd: string;
}

export const parseFilenameCoveragePeriod = (
  filename: string,
): { start: string; end: string } | null => {
  const dateTokens = Array.from(
    filename.matchAll(/(?:^|[^\d])(\d{4}-\d{2}-\d{2})(?!\d)/g),
    (match) => match[1]!,
  );
  if (dateTokens.length !== 2) return null;

  const range =
    /(?:^|[^\d])(\d{4}-\d{2}-\d{2})(?:\s+to\s+|_+to_+|_+|\/|-)(\d{4}-\d{2}-\d{2})(?!\d)/i.exec(
      filename,
    );
  if (!range) return null;

  const start = range[1]!;
  const end = range[2]!;
  if (!isValidIsoDate(start) || !isValidIsoDate(end) || start > end)
    return null;

  return { start, end };
};

export const parseCsvFilename = (
  filename: string,
): CsvFilenameMetadata | null => {
  const basename = filename.replace(/^.*[\\/]/, "");
  const match =
    /^(stripe|commbank|combank)-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})\.csv$/i.exec(
      basename,
    );
  if (!match) return null;

  const period = parseFilenameCoveragePeriod(basename);
  if (!period) return null;

  const isStripe = match[1]!.toLowerCase() === "stripe";
  return {
    provider: isStripe ? "Stripe" : "CommBank",
    profile: isStripe
      ? "stripe_balance_itemised_csv_v1"
      : "commbank_transaction_history_csv_v1",
    periodStart: period.start,
    periodEnd: period.end,
  };
};

export const parseFileFilename = (
  filename: string,
): FileFilenameSuggestions | null => {
  const period = parseFilenameCoveragePeriod(filename);
  const invoice = period ? null : parsePdfFilename(filename);
  const suggestions: FileFilenameSuggestions = {
    supplier: invoice?.supplier ?? null,
    documentDate: invoice?.invoiceDate ?? null,
    reference: invoice?.reference ?? null,
    periodStart: period?.start ?? null,
    periodEnd: period?.end ?? null,
  };

  return Object.values(suggestions).some(Boolean) ? suggestions : null;
};

export const applyFileFilenameSuggestions = (
  current: FileMetadataValues,
  suggestions: FileFilenameSuggestions,
  targetField?: keyof FileMetadataValues,
): FileFilenameSuggestionApplication => {
  const values = { ...current };
  const filled: (keyof FileMetadataValues)[] = [];
  const conflicts: ("periodStart" | "periodEnd")[] = [];

  if (
    (!targetField || targetField === "supplier") &&
    !values.supplier.trim() &&
    suggestions.supplier
  ) {
    values.supplier = suggestions.supplier;
    filled.push("supplier");
  }
  if (
    (!targetField || targetField === "documentDate") &&
    !values.documentDate.trim() &&
    suggestions.documentDate
  ) {
    values.documentDate = suggestions.documentDate;
    filled.push("documentDate");
  }
  if (
    (!targetField || targetField === "reference") &&
    !values.reference.trim() &&
    suggestions.reference
  ) {
    values.reference = suggestions.reference;
    filled.push("reference");
  }
  const needsPeriodStart =
    (!targetField || targetField === "periodStart") &&
    !values.periodStart.trim() &&
    suggestions.periodStart;
  const needsPeriodEnd =
    (!targetField || targetField === "periodEnd") &&
    !values.periodEnd.trim() &&
    suggestions.periodEnd;
  const resultingStart = values.periodStart.trim()
    ? values.periodStart
    : (suggestions.periodStart ?? "");
  const resultingEnd = values.periodEnd.trim()
    ? values.periodEnd
    : (suggestions.periodEnd ?? "");

  if (resultingStart && resultingEnd && resultingStart > resultingEnd) {
    if (needsPeriodStart) conflicts.push("periodStart");
    if (needsPeriodEnd) conflicts.push("periodEnd");
  } else {
    if (needsPeriodStart) {
      values.periodStart = suggestions.periodStart!;
      filled.push("periodStart");
    }
    if (needsPeriodEnd) {
      values.periodEnd = suggestions.periodEnd!;
      filled.push("periodEnd");
    }
  }

  return { values, filled, conflicts };
};
