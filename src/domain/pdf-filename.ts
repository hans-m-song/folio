export interface PdfFilenameSuggestions {
  supplier: string;
  invoiceDate: string;
  reference: string | null;
}

export interface PdfTransactionFieldValues {
  counterparty: string;
  invoiceDate: string;
  reference: string;
}

export interface PdfSuggestionApplication {
  values: PdfTransactionFieldValues;
  filled: readonly (keyof PdfTransactionFieldValues)[];
}

const pdfFilenamePattern =
  /^(.+?)\s*-+\s*(\d{4}-\d{2}-\d{2})(?:\s*-+\s*(.+))?\.pdf$/i;

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1]!;
}

export function parsePdfFilename(
  filename: string,
): PdfFilenameSuggestions | null {
  const basename = filename.trim().replace(/^.*[\\/]/, "");
  const match = pdfFilenamePattern.exec(basename);
  if (!match || !isValidIsoDate(match[2]!)) return null;
  const supplier = match[1]!.trim();
  const reference = match[3]?.trim() || null;
  if (!supplier) return null;
  return {
    supplier,
    invoiceDate: match[2]!,
    reference,
  };
}

export function applyPdfFilenameSuggestions(
  current: PdfTransactionFieldValues,
  suggestions: PdfFilenameSuggestions,
): PdfSuggestionApplication {
  const values = { ...current };
  const filled: (keyof PdfTransactionFieldValues)[] = [];
  if (!values.counterparty.trim()) {
    values.counterparty = suggestions.supplier;
    filled.push("counterparty");
  }
  if (!values.invoiceDate.trim()) {
    values.invoiceDate = suggestions.invoiceDate;
    filled.push("invoiceDate");
  }
  if (!values.reference.trim() && suggestions.reference) {
    values.reference = suggestions.reference;
    filled.push("reference");
  }
  return { values, filled };
}

export const mergePdfFilenameSuggestions = applyPdfFilenameSuggestions;
