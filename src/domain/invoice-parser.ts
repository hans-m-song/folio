import { formatDecimal, parseDecimal } from "./money";
import {
  invoiceSuggestionVersion,
  normalizedInvoiceDocumentVersion,
  type InvoiceCurrency,
  type InvoiceFeeFact,
  type InvoiceFeeKind,
  type InvoiceMoneyConflict,
  type InvoiceMoneyFact,
  type InvoiceMoneyField,
  type InvoiceParseResult,
  type InvoiceParserId,
  type InvoiceProvenance,
  type InvoiceSuggestionFields,
  type InvoiceSuggestionProvenance,
  type InvoiceWarningCode,
  type NormalizedInvoiceDocumentV1,
  type NormalizedInvoicePageV1,
} from "./invoice-types";

interface TextRow {
  pageNumber: number;
  y: number;
  text: string;
}

interface ParsedMoney {
  amount: string;
  explicitCurrency: InvoiceCurrency | null;
  hasAmbiguousDollar: boolean;
}

interface LabeledRow {
  kind: InvoiceMoneyField | "fee" | "issueDate" | "reference" | null;
  label: string;
  valueText: string;
  feeKind?: InvoiceFeeKind;
}

const emptyFields = (): InvoiceSuggestionFields => ({
  supplier: null,
  reference: null,
  issueDate: null,
  currency: null,
  invoiceTotal: null,
  amountPaid: null,
  amountDue: null,
  subtotal: null,
  tax: null,
  fees: [],
});

const emptyProvenance = (): InvoiceSuggestionProvenance => ({
  supplier: [],
  reference: [],
  issueDate: [],
  currency: [],
});

const createResult = (
  status: InvoiceParseResult["status"],
  parserId: InvoiceParserId,
  fields = emptyFields(),
  warnings: readonly InvoiceWarningCode[] = [],
  conflicts: readonly InvoiceMoneyConflict[] = [],
  provenance = emptyProvenance(),
): InvoiceParseResult => ({
  schemaVersion: invoiceSuggestionVersion,
  status,
  parser: { id: parserId, version: 1 },
  fields,
  provenance,
  conflicts,
  warnings: [...new Set(warnings)].sort(),
});

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isNormalizedDocument = (
  value: unknown,
): value is NormalizedInvoiceDocumentV1 => {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<NormalizedInvoiceDocumentV1>;
  if (
    document.schemaVersion !== normalizedInvoiceDocumentVersion ||
    !Array.isArray(document.pages) ||
    document.pages.length === 0 ||
    document.pages.length > 10
  )
    return false;

  const pageNumbers = new Set<number>();
  let characters = 0;
  for (const candidate of document.pages) {
    if (!candidate || typeof candidate !== "object") return false;
    const page = candidate as NormalizedInvoicePageV1;
    if (
      !Number.isSafeInteger(page.pageNumber) ||
      page.pageNumber < 1 ||
      pageNumbers.has(page.pageNumber) ||
      !isFiniteNumber(page.width) ||
      page.width <= 0 ||
      !isFiniteNumber(page.height) ||
      page.height <= 0 ||
      !Array.isArray(page.items)
    )
      return false;
    pageNumbers.add(page.pageNumber);

    for (const item of page.items) {
      if (
        !item ||
        typeof item.text !== "string" ||
        !isFiniteNumber(item.x) ||
        !isFiniteNumber(item.y) ||
        !isFiniteNumber(item.width) ||
        !isFiniteNumber(item.height) ||
        item.width < 0 ||
        item.height < 0
      )
        return false;
      characters += item.text.length;
      if (characters > 250_000) return false;
    }
  }
  return true;
};

const rowsForPage = (page: NormalizedInvoicePageV1): TextRow[] => {
  const items = [...page.items].sort((left, right) => left.y - right.y);
  const grouped: { y: number; items: typeof items }[] = [];

  for (const item of items) {
    const current = grouped.at(-1);
    if (!current || Math.abs(item.y - current.y) > 2) {
      grouped.push({ y: item.y, items: [item] });
      continue;
    }
    current.items.push(item);
    current.y =
      (current.y * (current.items.length - 1) + item.y) / current.items.length;
  }

  return grouped.map((row) => ({
    pageNumber: page.pageNumber,
    y: row.y,
    text: row.items
      .sort((left, right) => left.x - right.x)
      .map((item) => item.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  }));
};

const rowsForDocument = (document: NormalizedInvoiceDocumentV1): TextRow[] =>
  [...document.pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .flatMap(rowsForPage);

const explicitCurrencies = (text: string): Set<InvoiceCurrency> => {
  const currencies = new Set<InvoiceCurrency>();
  if (/\bAUD\b|\bA\s*\$/i.test(text)) currencies.add("AUD");
  if (/\bUSD\b|\bUS\s*\$/i.test(text)) currencies.add("USD");
  return currencies;
};

const provenanceForCurrencies = (
  rows: readonly TextRow[],
): InvoiceProvenance[] =>
  rows.flatMap((row) => {
    const markers =
      row.text.match(/\bAUD\b|\bA\s*\$|\bUSD\b|\bUS\s*\$/gi) ?? [];
    return markers.map((label) => ({
      pageNumber: row.pageNumber,
      label: label.trim(),
    }));
  });

const uniqueProvenance = (
  provenance: readonly InvoiceProvenance[],
): InvoiceProvenance[] => {
  const seen = new Set<string>();
  return provenance.filter(({ pageNumber, label }) => {
    const key = `${pageNumber}\u0000${label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const moneyCurrencyPattern = String.raw`(?:US\s*\$|A\s*\$|USD\b|AUD\b|\$)`;
const moneyAmountPattern = String.raw`(?:\d{1,3}(?:[\s,]\d{3})+|\d+)(?:\s*\.\s*\d+)?`;
const moneyPattern = new RegExp(
  String.raw`\(\s*-?\s*(?:${moneyCurrencyPattern}\s*)?${moneyAmountPattern}\s*\)|-?\s*${moneyCurrencyPattern}\s*${moneyAmountPattern}|-?${moneyAmountPattern}`,
  "gi",
);

const parseMoneyToken = (token: string): ParsedMoney | null => {
  const hasOpen = token.includes("(");
  const hasNegative = /^\s*-/.test(token) || /\(\s*-/.test(token);
  const marker = token.match(/US\s*\$|A\s*\$|USD\b|AUD\b|\$/i)?.[0];
  const currency =
    marker && /^(?:AUD|A\s*\$)$/i.test(marker)
      ? "AUD"
      : marker && /^(?:USD|US\s*\$)$/i.test(marker)
        ? "USD"
        : null;
  const numberMatch = token.match(
    /\d{1,3}(?:[\s,]\d{3})*(?:\.\s*\d+)?|\d+(?:\.\s*\d+)?/,
  );
  if (!numberMatch) return null;

  const normalizedNumber = numberMatch[0].replace(/[\s,]/g, "");
  const normalized = normalizedNumber.replace(/^0+(?=\d)/, "");
  if (!/^(?:\d+)(?:\.\d+)?$/.test(normalized)) return null;
  const decimals = normalized.split(".")[1]?.length ?? 0;
  if (decimals > 4) return null;

  const signed = `${hasOpen || hasNegative ? "-" : ""}${normalized}`;
  try {
    return {
      amount: formatDecimal(parseDecimal(signed)),
      explicitCurrency: currency,
      hasAmbiguousDollar: Boolean(marker?.includes("$") && !currency),
    };
  } catch {
    return null;
  }
};

const moneyTokens = (text: string): string[] => {
  const tokens: string[] = [];
  for (const match of text.matchAll(moneyPattern)) {
    const token = match[0];
    const suffix = text.slice((match.index ?? 0) + token.length);
    if (/^\s*\)?\s*%/.test(suffix)) continue;
    tokens.push(token);
  }
  return tokens;
};

const parseMoneyFromText = (text: string): ParsedMoney | null => {
  const tokens = moneyTokens(text);
  if (tokens.length !== 1) return null;
  return parseMoneyToken(tokens[0]!);
};

const classifyLabel = (text: string): LabeledRow => {
  if (
    /^(?:due\s+date|paid\s+(?:on|date)|payment\s+date|date\s+paid)\b/i.test(
      text,
    )
  )
    return { kind: null, label: "", valueText: "" };
  const patterns: readonly {
    kind: LabeledRow["kind"];
    pattern: RegExp;
    feeKind?: InvoiceFeeKind;
  }[] = [
    {
      kind: "issueDate",
      pattern:
        /^(?:invoice\s+date|issue\s+date|date\s+of\s+issue|issued\s+on)\b/i,
    },
    {
      kind: "reference",
      pattern:
        /^(?:invoice\s+(?:number|no\.?|#|id)|reference)(?:\b|(?=\s|:|#))\s*:?/i,
    },
    {
      kind: "amountPaid",
      pattern: /^(?:amount\s+paid|paid(?:\s+to\s+date)?|payment\s+received)\b/i,
    },
    {
      kind: "amountDue",
      pattern:
        /^(?:amount\s+due|balance\s+due|remaining\s+due|due\s+now|due)(?!\s+date)\b/i,
    },
    {
      kind: "fee",
      pattern: /^(?:total\s+)?(?:card\s+)?processing\s+fees?\b/i,
      feeKind: "processing",
    },
    {
      kind: "fee",
      pattern:
        /^(?:(?:total\s+)?fees?\s+deducted|deducted\s+fees?|total\s+deducted\s+fees?)\b/i,
      feeKind: "deducted",
    },
    {
      kind: "fee",
      pattern: /^total\s+billing\s+(?:usage|fees?)\b/i,
      feeKind: "billing_usage",
    },
    {
      kind: "invoiceTotal",
      pattern:
        /^(?:(?:invoice|grand)\s+total|total\s+invoice\s+amount|total(?:\s+(?:including|incl\.?|inc\.?)\s+(?:GST|tax))?)(?!\s+(?:due|paid|payment|subtotal|discount|credits?|fees?|processing|billing|subscription|usage|deducted))\b/i,
    },
    { kind: "subtotal", pattern: /^(?:sub\s*total)\b/i },
    { kind: "tax", pattern: /^(?:GST|tax|VAT)(?:\s+amount)?\b/i },
    {
      kind: "fee",
      pattern: /^(?:card\s+)?processing\s+fees?\b/i,
      feeKind: "processing",
    },
    {
      kind: "fee",
      pattern: /^(?:billing\s+(?:usage|fees?)|(?:billing|usage)\s+fees?)\b/i,
      feeKind: "billing_usage",
    },
    {
      kind: "fee",
      pattern: /^(?:subscription\s+fees?)\b/i,
      feeKind: "subscription",
    },
    {
      kind: "fee",
      pattern: /^(?:usage\s+credits?|credits?)\b/i,
      feeKind: "credit",
    },
    { kind: "fee", pattern: /^(?:usage\s+fees?)\b/i, feeKind: "billing_usage" },
  ];

  for (const candidate of patterns) {
    const match = candidate.pattern.exec(text);
    if (!match) continue;
    const label = match[0].replace(/[\s:]+$/, "").trim();
    return {
      kind: candidate.kind,
      label,
      valueText: text
        .slice(match[0].length)
        .replace(/^\s*:\s*/, "")
        .replace(/^\s*-\s+(?=(?:US\s*\$|A\s*\$|USD\b|AUD\b|\$|\d))/i, ""),
      feeKind: candidate.feeKind,
    };
  }
  return { kind: null, label: "", valueText: "" };
};

const isStandaloneValueRow = (row: TextRow): boolean =>
  classifyLabel(row.text).kind === null &&
  !/\b(?:invoice|subtotal|tax|GST|paid|due|date|credit)\b/i.test(row.text);

const adjacentValueText = (
  labeled: TextRow,
  following: TextRow | undefined,
  valueText: string,
): string => {
  if (valueText.trim() || !following) return valueText;
  if (
    following.pageNumber !== labeled.pageNumber ||
    following.y - labeled.y > 28 ||
    !isStandaloneValueRow(following)
  )
    return valueText;
  return following.text;
};

const parseIssueDate = (text: string): string | null => {
  const iso = text.match(/\b(\d{4})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})\b/);
  if (iso)
    return validIsoDate(
      `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`,
    );

  const monthNames: Record<string, string> = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12",
  };
  const monthFirst = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/);
  const dayFirst = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/);
  const textual = monthFirst
    ? {
        year: monthFirst[3]!,
        month: monthNames[monthFirst[1]!.toLowerCase()],
        day: monthFirst[2]!,
      }
    : dayFirst
      ? {
          year: dayFirst[3]!,
          month: monthNames[dayFirst[2]!.toLowerCase()],
          day: dayFirst[1]!,
        }
      : null;
  if (!textual?.month) return null;
  return validIsoDate(
    `${textual.year}-${textual.month}-${textual.day.padStart(2, "0")}`,
  );
};

const validIsoDate = (value: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null;
};

const parseReference = (text: string): string | null => {
  const match = text.match(/([A-Z0-9][A-Z0-9./_-]{1,99})/i);
  return match?.[1] ?? null;
};

const fact = (
  money: ParsedMoney,
  currency: InvoiceCurrency | null,
  provenance: InvoiceProvenance,
): InvoiceMoneyFact => ({
  amount: money.amount,
  currency: money.explicitCurrency ?? currency,
  provenance: [provenance],
});

const mergeFacts = (
  field: InvoiceMoneyField,
  occurrences: readonly InvoiceMoneyFact[],
): { fact: InvoiceMoneyFact | null; conflict: InvoiceMoneyConflict | null } => {
  if (occurrences.length === 0) return { fact: null, conflict: null };

  const explicitCurrencies = new Set(
    occurrences.map((occurrence) => occurrence.currency).filter(Boolean),
  );
  const amounts = new Set(occurrences.map((occurrence) => occurrence.amount));
  if (amounts.size > 1 || explicitCurrencies.size > 1) {
    return { fact: null, conflict: { field, occurrences } };
  }

  const first = occurrences[0]!;
  return {
    fact: {
      amount: first.amount,
      currency: [...explicitCurrencies][0] ?? null,
      provenance: occurrences.flatMap((occurrence) => occurrence.provenance),
    },
    conflict: null,
  };
};

const supplierFor = (
  text: string,
): { supplier: string; parser: InvoiceParserId } | null => {
  const matches = [
    {
      pattern: /\bgoogle\s+workspace\b/i,
      supplier: "Google Workspace",
      parser: "google-workspace" as const,
    },
    {
      pattern: /\bsupabase\b/i,
      supplier: "Supabase",
      parser: "supabase" as const,
    },
    { pattern: /\bstripe\b/i, supplier: "Stripe", parser: "stripe" as const },
  ].filter((candidate) => candidate.pattern.test(text));
  return matches.length === 1 ? matches[0]! : null;
};

const requiresReview = (warnings: readonly InvoiceWarningCode[]): boolean =>
  warnings.some((warning) => warning !== "stripe_duplicate_risk");

export const parseSupplierInvoice = (document: unknown): InvoiceParseResult => {
  if (!isNormalizedDocument(document))
    return createResult("unsupported", "invoice-router", emptyFields(), [
      "malformed_input",
    ]);

  const rows = rowsForDocument(document);
  const body = rows.map((row) => row.text).join("\n");
  const supplierMatch = supplierFor(body);
  if (!supplierMatch) {
    return createResult("unsupported", "invoice-router", emptyFields(), [
      /\binvoice\b/i.test(body)
        ? "unsupported_supplier"
        : "missing_invoice_anchor",
    ]);
  }

  const fields = emptyFields();
  fields.supplier = supplierMatch.supplier;
  const supplierPattern =
    supplierMatch.parser === "google-workspace"
      ? /\bgoogle\s+workspace\b/i
      : new RegExp(`\\b${supplierMatch.supplier.toLowerCase()}\\b`, "i");
  const supplierAnchor = rows.find((row) => supplierPattern.test(row.text));
  const provenance = emptyProvenance();
  provenance.supplier = supplierAnchor
    ? [{ pageNumber: supplierAnchor.pageNumber, label: supplierMatch.supplier }]
    : [];
  const warnings: InvoiceWarningCode[] = [];
  const conflicts: InvoiceMoneyConflict[] = [];
  const currencyMarkers = explicitCurrencies(body);
  const documentCurrency =
    currencyMarkers.size === 1 ? [...currencyMarkers][0]! : null;
  provenance.currency = uniqueProvenance(provenanceForCurrencies(rows));
  if (currencyMarkers.size > 1) warnings.push("conflicting_currency");

  if (!/\binvoice\b/i.test(body)) {
    return createResult("unsupported", supplierMatch.parser, fields, [
      "missing_invoice_anchor",
    ]);
  }

  const occurrences = new Map<InvoiceMoneyField, InvoiceMoneyFact[]>([
    ["invoiceTotal", []],
    ["amountPaid", []],
    ["amountDue", []],
    ["subtotal", []],
    ["tax", []],
  ]);
  const references: { value: string; provenance: InvoiceProvenance }[] = [];
  const issueDates: { value: string; provenance: InvoiceProvenance }[] = [];
  const fees: InvoiceFeeFact[] = [];
  let hasLabeledContent = false;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const labeled = classifyLabel(row.text);
    if (!labeled.kind) continue;
    hasLabeledContent = true;
    const provenance = { pageNumber: row.pageNumber, label: labeled.label };

    if (labeled.kind === "issueDate") {
      const value = adjacentValueText(row, rows[index + 1], labeled.valueText);
      const date = parseIssueDate(value);
      if (date) issueDates.push({ value: date, provenance });
      continue;
    }

    if (labeled.kind === "reference") {
      const value = adjacentValueText(row, rows[index + 1], labeled.valueText);
      const reference = parseReference(value);
      if (reference) references.push({ value: reference, provenance });
      else warnings.push("unreadable_reference");
      continue;
    }

    const fieldText = adjacentValueText(
      row,
      rows[index + 1],
      labeled.valueText,
    );
    const parsed = parseMoneyFromText(fieldText);
    if (!parsed) {
      if (fieldText.trim()) warnings.push("unreadable_money_field");
      continue;
    }
    if (parsed.hasAmbiguousDollar && documentCurrency === null)
      warnings.push("ambiguous_currency");
    if (labeled.kind === "fee") {
      fees.push({
        ...fact(parsed, documentCurrency, provenance),
        kind: labeled.feeKind ?? "other",
      });
      continue;
    }
    occurrences
      .get(labeled.kind)!
      .push(fact(parsed, documentCurrency, provenance));
  }

  if (!hasLabeledContent) {
    return createResult("unsupported", supplierMatch.parser, fields, [
      "layout_unrecognized",
    ]);
  }

  for (const field of [
    "invoiceTotal",
    "amountPaid",
    "amountDue",
    "subtotal",
    "tax",
  ] as const) {
    const merged = mergeFacts(field, occurrences.get(field)!);
    fields[field] = merged.fact;
    if (merged.conflict) {
      conflicts.push(merged.conflict);
      warnings.push(
        field === "invoiceTotal"
          ? "conflicting_total"
          : "conflicting_money_fact",
      );
    }
  }

  const distinctDates = new Set(issueDates.map(({ value }) => value));
  if (distinctDates.size > 1) warnings.push("conflicting_date");
  else {
    fields.issueDate = issueDates[0]?.value ?? null;
    provenance.issueDate = uniqueProvenance(
      issueDates.map(({ provenance: source }) => source),
    );
  }

  const distinctReferences = new Set(references.map(({ value }) => value));
  if (distinctReferences.size > 1) warnings.push("conflicting_reference");
  else {
    fields.reference = references[0]?.value ?? null;
    provenance.reference = uniqueProvenance(
      references.map(({ provenance: source }) => source),
    );
  }

  fields.currency = documentCurrency;
  if (
    currencyMarkers.size === 0 &&
    (fields.invoiceTotal ||
      fields.amountPaid ||
      fields.amountDue ||
      fields.subtotal ||
      fields.tax ||
      fees.length)
  )
    warnings.push("currency_unconfirmed");
  fields.fees = fees;

  if (/\bcredit\s+(?:note|memo)\b/i.test(body))
    warnings.push("unknown_credit_note_layout");

  if (
    fields.invoiceTotal &&
    fields.subtotal &&
    fields.tax &&
    currencyMarkers.size < 2
  ) {
    const total = parseDecimal(fields.invoiceTotal.amount);
    const subtotalAndTax =
      parseDecimal(fields.subtotal.amount) + parseDecimal(fields.tax.amount);
    if (total !== subtotalAndTax) warnings.push("totals_do_not_reconcile");
  }
  if (
    fields.invoiceTotal &&
    fields.amountPaid &&
    fields.amountDue &&
    fields.invoiceTotal.currency === fields.amountPaid.currency &&
    fields.invoiceTotal.currency === fields.amountDue.currency
  ) {
    const total = parseDecimal(fields.invoiceTotal.amount);
    const paidAndDue =
      parseDecimal(fields.amountPaid.amount) +
      parseDecimal(fields.amountDue.amount);
    if (total !== paidAndDue) warnings.push("totals_do_not_reconcile");
  }

  if (!fields.invoiceTotal) warnings.push("invoice_total_missing");
  if (supplierMatch.parser === "stripe") warnings.push("stripe_duplicate_risk");

  if (
    !fields.invoiceTotal &&
    !fields.subtotal &&
    !fields.amountPaid &&
    !fields.amountDue &&
    fees.length === 0 &&
    conflicts.length === 0
  ) {
    return createResult("unsupported", supplierMatch.parser, fields, [
      "layout_unrecognized",
    ]);
  }

  const status = requiresReview(warnings) ? "needs_review" : "recognized";
  if (
    status === "recognized" &&
    fields.currency === null &&
    fields.invoiceTotal
  )
    fields.currency = fields.invoiceTotal.currency;

  fields.fees = fees;

  return createResult(
    status,
    supplierMatch.parser,
    fields,
    warnings,
    conflicts,
    provenance,
  );
};
