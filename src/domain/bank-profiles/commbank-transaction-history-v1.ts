import type {
  BankCsvIssue,
  BankCsvPreview,
  ParsedBankTransaction,
} from "../bank-transactions";

interface CsvRecord {
  row: number;
  fields: string[];
  malformed: boolean;
}

const scanCsv = (source: string): CsvRecord[] => {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let malformed = false;
  let recordRow = 1;
  let line = 1;

  const finishRecord = () => {
    fields.push(field);
    records.push({ row: recordRow, fields, malformed });
    fields = [];
    field = "";
    quoted = false;
    afterQuote = false;
    malformed = false;
    recordRow = line + 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
        if (character === "\n") line += 1;
        if (character === "\r" && text[index + 1] !== "\n") malformed = true;
      }
      continue;
    }
    if (afterQuote) {
      if (character === ",") {
        fields.push(field);
        field = "";
        afterQuote = false;
        continue;
      }
      if (character === "\r" && text[index + 1] === "\n") continue;
      if (character === "\n") {
        finishRecord();
        line += 1;
        continue;
      }
      malformed = true;
      field += character;
      afterQuote = false;
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === '"') {
      malformed = true;
      field += character;
    } else if (character === ",") {
      fields.push(field);
      field = "";
    } else if (character === "\r" && text[index + 1] === "\n") {
      continue;
    } else if (character === "\r") {
      malformed = true;
    } else if (character === "\n") {
      finishRecord();
      line += 1;
    } else {
      field += character;
    }
  }
  if (quoted) malformed = true;
  if (field.length > 0 || fields.length > 0 || afterQuote)
    records.push({ row: recordRow, fields: [...fields, field], malformed });
  return records;
};

const calendarDate = (source: string): string | null => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(source);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
};

const decimal = (source: string, nonZero: boolean): string | null => {
  const match = /^([+-]?)(\d{1,15})(?:\.(\d{1,4}))?$/.exec(source);
  if (!match) return null;
  const fraction = (match[3] ?? "").padEnd(4, "0");
  if (nonZero && /^0+$/.test(match[2] + fraction)) return null;
  const sign = match[1] === "-" ? "-" : "";
  return `${sign}${BigInt(match[2]).toString()}.${fraction}`;
};

const sourceHints = (description: string) => {
  const valueDateMatch =
    /(?:VALUE DATE|VAL DATE)\s+(\d{2}\/\d{2}\/\d{4})/i.exec(description);
  const valueDate = valueDateMatch ? calendarDate(valueDateMatch[1]!) : null;
  const possibleForeignMatch =
    /\b([A-Z]{3})\s+([0-9]+(?:\.[0-9]{1,4})?)\b/.exec(description);
  const foreignMatch =
    possibleForeignMatch?.[1] === "AUD" ? null : possibleForeignMatch;
  const cardMatch = /\b(?:CARD|CRD)[^0-9]*(?:X{2,}|\*{2,})([0-9]{4})\b/i.exec(
    description,
  );
  return {
    ...(valueDate ? { valueDate } : {}),
    ...(foreignMatch
      ? {
          foreignCurrency: foreignMatch[1],
          foreignAmount: foreignMatch[2],
        }
      : {}),
    ...(cardMatch ? { cardSuffix: cardMatch[1] } : {}),
  };
};

const issue = (
  row: number,
  field: BankCsvIssue["field"],
  code: BankCsvIssue["code"],
  message: string,
): BankCsvIssue => ({ row, field, code, message });

export const parseCommBankTransactionHistoryCsv = (
  source: string,
): BankCsvPreview => {
  const rows: ParsedBankTransaction[] = [];
  const errors: BankCsvIssue[] = [];
  const records = scanCsv(source);
  if (records.length === 0)
    errors.push(issue(1, "row", "empty_csv", "CSV contains no rows"));
  for (const record of records) {
    if (record.malformed) {
      errors.push(
        issue(record.row, "row", "malformed_csv", "Malformed CSV quoting"),
      );
      continue;
    }
    if (record.fields.length !== 4) {
      errors.push(
        issue(
          record.row,
          "row",
          "wrong_column_count",
          "Expected exactly four columns",
        ),
      );
      continue;
    }
    const [sourceDate, sourceAmount, description, runningBalance] =
      record.fields as [string, string, string, string];
    const postedDate = calendarDate(sourceDate);
    const amountAud = decimal(sourceAmount, true);
    const balance = decimal(runningBalance, false);
    if (!postedDate)
      errors.push(
        issue(record.row, "postedDate", "invalid_date", "Expected dd/MM/yyyy"),
      );
    if (!amountAud)
      errors.push(
        issue(
          record.row,
          "amountAud",
          "invalid_amount",
          "Expected a non-zero signed decimal",
        ),
      );
    if (!balance)
      errors.push(
        issue(
          record.row,
          "runningBalance",
          "invalid_amount",
          "Expected a decimal balance",
        ),
      );
    if (!postedDate || !amountAud || !balance) continue;
    rows.push({
      sourceRow: record.row,
      postedDate,
      amountAud,
      description,
      metadata: {
        sourceRow: record.row,
        postedDate: sourceDate,
        amountAud: sourceAmount,
        description,
        runningBalance,
        ...sourceHints(description),
      },
    });
  }
  const dates = rows.map((row) => row.postedDate);
  return {
    rows,
    errors,
    earliestDate: dates.length
      ? dates.reduce((left, right) => (left < right ? left : right))
      : null,
    latestDate: dates.length
      ? dates.reduce((left, right) => (left > right ? left : right))
      : null,
  };
};
