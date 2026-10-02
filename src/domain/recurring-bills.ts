import { z } from "zod";

import { formatDecimal, nonNegativeDecimalSchema, parseDecimal } from "./money";
import { currencySchema } from "./types";
import {
  recurringBillDescriptionMatchModeSchema,
  recurringBillDescriptionMatcherFor,
} from "./recurring-description";

const maximumRecurringOccurrences = 1_200;
const maximumUnresolvedOffset = 120_000;
const defaultViewOccurrenceLimit = 24;
const maximumDescriptionMatchLength = 2_000;
const maximumMatchingWindowDays = 365;
const defaultMatchingWindowDays = 3;
const calendarDayMilliseconds = 86_400_000;

const daysInMonth = (year: number, month: number): number => {
  if (month === 2)
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const parseCalendarDate = (
  value: string,
): { year: number; month: number; day: number } | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  )
    return null;

  return { year, month, day };
};

const isCalendarDate = (value: string): boolean =>
  parseCalendarDate(value) !== null;

const recurringBillAmountSchema = nonNegativeDecimalSchema.refine(
  (value) => value.split(".")[0]!.length <= 15,
  "Expected an amount supported by numeric(19,4)",
);

export const recurringBillFrequencySchema = z.enum(["monthly", "annual"]);

export const recurringBillScheduleInputSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    counterparty: z.string().trim().min(1).max(300),
    descriptionMatchText: z.string().nullable().default(null),
    descriptionMatchMode:
      recurringBillDescriptionMatchModeSchema.default("contains"),
    daysEarly: z
      .number()
      .int()
      .min(0)
      .max(maximumMatchingWindowDays)
      .default(defaultMatchingWindowDays),
    daysLate: z
      .number()
      .int()
      .min(0)
      .max(maximumMatchingWindowDays)
      .default(defaultMatchingWindowDays),
    documentCurrency: currencySchema,
    expectedAmount: recurringBillAmountSchema.nullable().default(null),
    frequency: recurringBillFrequencySchema,
    anchorDate: z.string().date().refine(isCalendarDate),
    responsibleUserId: z.string().uuid().nullable().default(null),
  })
  .strict()
  .transform((schedule) => {
    const descriptionMatchText =
      schedule.descriptionMatchMode === "contains"
        ? schedule.descriptionMatchText?.trim() || null
        : schedule.descriptionMatchText?.trim()
          ? schedule.descriptionMatchText
          : null;

    return { ...schedule, descriptionMatchText };
  })
  .superRefine((schedule, context) => {
    if (schedule.descriptionMatchText === null) return;
    if (schedule.descriptionMatchText.length > maximumDescriptionMatchLength) {
      context.addIssue({
        code: "custom",
        path: ["descriptionMatchText"],
        message: "Description match text must not exceed 2,000 characters",
      });
      return;
    }

    if (schedule.descriptionMatchMode !== "regex") return;
    try {
      recurringBillDescriptionMatcherFor(schedule);
    } catch {
      context.addIssue({
        code: "custom",
        path: ["descriptionMatchText"],
        message:
          "Description match regular expression is invalid or unsupported",
      });
    }
  });

export type RecurringBillScheduleInput = z.infer<
  typeof recurringBillScheduleInputSchema
>;

export interface RecurringBillSchedule extends RecurringBillScheduleInput {
  id: string;
  active: boolean;
  createdById: string;
  updatedById: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringBillTransaction {
  id: string;
  kind: string;
  status: string;
  counterparty: string | null;
  description: string | null;
  documentCurrency: string | null;
  documentAmount: string | null;
  invoiceDate: string | null;
  occurredAt: string | null;
  settledAt: string | null;
}

export interface RecurringBillLink {
  scheduleId: string;
  expectedDate: string;
  transactionId: string;
  createdById: string;
  createdAt: string;
}

export interface RecurringBillCandidate {
  id: string;
  invoiceDate: string | null;
  occurredAt: string | null;
  settledAt: string | null;
  counterparty: string | null;
  description: string | null;
  documentCurrency: string | null;
  documentAmount: string | null;
}

export type RecurringBillOccurrenceStatus = "Upcoming" | "Pending" | "Due";

export interface RecurringBillOccurrenceAssociation {
  transactionId: string;
  linkedAt: string;
  eligible: boolean;
  transaction: RecurringBillCandidate | null;
}

export interface RecurringBillOccurrence {
  expectedDate: string;
  isScheduled: boolean;
  status: RecurringBillOccurrenceStatus | null;
  isComplete: boolean;
  transactionId: string | null;
  candidates: RecurringBillCandidate[];
  association: RecurringBillOccurrenceAssociation | null;
}

export interface RecurringBillAmountEstimate {
  count: number;
  minimum: string;
  maximum: string;
  average: string;
}

export interface RecurringBillView {
  schedule: RecurringBillSchedule;
  status: RecurringBillOccurrenceStatus;
  nextExpectedDate: string | null;
  nextUnresolvedOffset: number | null;
  oldestPendingDate: string | null;
  amountEstimate: RecurringBillAmountEstimate | null;
  pendingCount: number;
  dueCount: number;
  candidateTransactionIds: string[];
  candidateTransactions: RecurringBillCandidate[];
  occurrences: RecurringBillOccurrence[];
}

export interface RecurringBillSuggestion {
  schedule: RecurringBillScheduleInput;
  sourceTransactionIds: string[];
  occurrenceDates: string[];
  supportCount: number;
}

export interface BuildRecurringBillViewsInput {
  schedules: readonly RecurringBillSchedule[];
  transactions: readonly RecurringBillTransaction[];
  links: readonly RecurringBillLink[];
  timeZone: string;
  asOfDate: string;
  maxOccurrences?: number;
  unresolvedOffset?: number;
}

export interface RecurringBillMatchPreviewInput {
  schedule: RecurringBillScheduleInput;
  transactions: readonly RecurringBillTransaction[];
  timeZone: string;
  asOfDate?: string;
}

export interface RecurringBillMatchPreviewRow {
  transactionId: string;
  date: string | null;
  description: string | null;
  descriptionMatches: boolean;
  expectedDate: string | null;
  dayOffset: number | null;
  result:
    | "aligned"
    | "misaligned"
    | "description_mismatch"
    | "missing_date"
    | "ambiguous";
}

export interface RecurringBillMatchPreviewResult {
  descriptionMatchCount: number;
  onCadenceCount: number;
  misalignedCount: number;
  ambiguousCount: number;
  amountEstimate: RecurringBillAmountEstimate | null;
  rows: RecurringBillMatchPreviewRow[];
}

const daysFromCivil = (year: number, month: number, day: number): number => {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const monthPrime = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * monthPrime + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra - 719468;
};

const formatCalendarDate = (parts: {
  year: number;
  month: number;
  day: number;
}): string | null => {
  if (parts.year < 1 || parts.year > 9999) return null;
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
};

const calendarDateFromOrdinal = (ordinal: number): string | null => {
  const date = new Date(ordinal * calendarDayMilliseconds);
  if (!Number.isFinite(date.getTime())) return null;

  const value = formatCalendarDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
  return value && isCalendarDate(value) ? value : null;
};

const calendarDateAtCadenceIndex = (
  schedule: Pick<RecurringBillScheduleInput, "anchorDate" | "frequency">,
  index: number,
): string | null => {
  if (!Number.isSafeInteger(index)) return null;
  const anchor = parseCalendarDate(schedule.anchorDate);
  if (!anchor) throw new Error("Invalid recurring bill anchor date");

  if (schedule.frequency === "monthly") {
    const monthIndex = anchor.year * 12 + anchor.month - 1 + index;
    const year = Math.floor(monthIndex / 12);
    const month = (((monthIndex % 12) + 12) % 12) + 1;
    return formatCalendarDate({
      year,
      month,
      day: Math.min(anchor.day, daysInMonth(year, month)),
    });
  }

  const year = anchor.year + index;
  return formatCalendarDate({
    year,
    month: anchor.month,
    day: Math.min(anchor.day, daysInMonth(year, anchor.month)),
  });
};

const occurrenceDateAt = (
  schedule: Pick<RecurringBillScheduleInput, "anchorDate" | "frequency">,
  index: number,
): string | null =>
  !Number.isSafeInteger(index) || index < 0
    ? null
    : calendarDateAtCadenceIndex(schedule, index);

const previewOccurrenceDateAt = (
  schedule: Pick<RecurringBillScheduleInput, "anchorDate" | "frequency">,
  index: number,
): string | null =>
  !Number.isSafeInteger(index)
    ? null
    : calendarDateAtCadenceIndex(schedule, index);

const occurrenceCountThrough = (
  schedule: Pick<RecurringBillScheduleInput, "anchorDate" | "frequency">,
  throughDate: string,
): number => {
  const through = parseCalendarDate(throughDate);
  const anchor = parseCalendarDate(schedule.anchorDate);
  if (!through || !anchor)
    throw new Error("Invalid recurring bill calendar date");
  if (throughDate < schedule.anchorDate) return 0;

  const index =
    schedule.frequency === "monthly"
      ? (through.year - anchor.year) * 12 + through.month - anchor.month
      : through.year - anchor.year;
  const candidate = occurrenceDateAt(schedule, index);
  return candidate !== null && candidate <= throughDate ? index + 1 : index;
};

const occurrenceIndexForDate = (
  schedule: Pick<RecurringBillScheduleInput, "anchorDate" | "frequency">,
  expectedDate: string,
): number | null => {
  const expected = parseCalendarDate(expectedDate);
  const anchor = parseCalendarDate(schedule.anchorDate);
  if (!expected || !anchor || expectedDate < schedule.anchorDate) return null;

  const index =
    schedule.frequency === "monthly"
      ? (expected.year - anchor.year) * 12 + expected.month - anchor.month
      : expected.year - anchor.year;
  return occurrenceDateAt(schedule, index) === expectedDate ? index : null;
};

const recurrencePeriodIndex = (
  schedule: Pick<RecurringBillScheduleInput, "anchorDate" | "frequency">,
  date: { year: number; month: number },
  anchor: { year: number; month: number },
): number =>
  schedule.frequency === "monthly"
    ? (date.year - anchor.year) * 12 + date.month - anchor.month
    : date.year - anchor.year;

const occurrenceIndexesNearDate = (
  schedule: Pick<
    RecurringBillScheduleInput,
    "anchorDate" | "frequency" | "daysEarly" | "daysLate"
  >,
  transactionDate: string,
  allowHistorical: boolean,
): number[] => {
  const date = parseCalendarDate(transactionDate);
  const anchor = parseCalendarDate(schedule.anchorDate);
  if (!date || !anchor) return [];

  const baseIndex = recurrencePeriodIndex(schedule, date, anchor);
  const maximumWindow = Math.max(schedule.daysEarly, schedule.daysLate);
  const searchRadius =
    schedule.frequency === "monthly"
      ? Math.ceil(maximumWindow / 28) + 1
      : Math.ceil(maximumWindow / 365) + 1;
  const transactionOrdinal = daysFromCivil(date.year, date.month, date.day);
  const matches: number[] = [];

  for (
    let index = allowHistorical
      ? baseIndex - searchRadius
      : Math.max(0, baseIndex - searchRadius);
    index <= baseIndex + searchRadius;
    index += 1
  ) {
    const occurrenceDate = allowHistorical
      ? previewOccurrenceDateAt(schedule, index)
      : occurrenceDateAt(schedule, index);
    const occurrence = occurrenceDate
      ? parseCalendarDate(occurrenceDate)
      : null;
    if (!occurrence) continue;
    const dayOffset =
      transactionOrdinal -
      daysFromCivil(occurrence.year, occurrence.month, occurrence.day);
    if (dayOffset >= -schedule.daysEarly && dayOffset <= schedule.daysLate) {
      matches.push(index);
    }
  }
  return matches;
};

const nearbyOccurrenceIndexes = (
  schedule: Pick<
    RecurringBillScheduleInput,
    "anchorDate" | "frequency" | "daysEarly" | "daysLate"
  >,
  transactionDate: string,
): number[] => occurrenceIndexesNearDate(schedule, transactionDate, false);

const nearbyPreviewOccurrenceIndexes = (
  schedule: Pick<
    RecurringBillScheduleInput,
    "anchorDate" | "frequency" | "daysEarly" | "daysLate"
  >,
  transactionDate: string,
): number[] => occurrenceIndexesNearDate(schedule, transactionDate, true);

const nearestPreviewOccurrenceForDate = (
  schedule: Pick<RecurringBillScheduleInput, "anchorDate" | "frequency">,
  transactionDate: string,
  candidateDates?: readonly string[],
): { expectedDate: string; dayOffset: number } | null => {
  const date = parseCalendarDate(transactionDate);
  const anchor = parseCalendarDate(schedule.anchorDate);
  if (!date || !anchor) return null;

  const baseIndex = recurrencePeriodIndex(schedule, date, anchor);
  const transactionOrdinal = daysFromCivil(date.year, date.month, date.day);
  let nearest: { expectedDate: string; dayOffset: number } | null = null;
  const nearestDates =
    candidateDates ??
    Array.from({ length: 3 }, (_, offset) =>
      previewOccurrenceDateAt(schedule, baseIndex - 1 + offset),
    ).filter((value): value is string => value !== null);
  for (const expectedDate of nearestDates) {
    const expected = expectedDate ? parseCalendarDate(expectedDate) : null;
    if (!expectedDate || !expected) continue;

    const dayOffset =
      transactionOrdinal -
      daysFromCivil(expected.year, expected.month, expected.day);
    if (
      nearest === null ||
      Math.abs(dayOffset) < Math.abs(nearest.dayOffset) ||
      (Math.abs(dayOffset) === Math.abs(nearest.dayOffset) &&
        expectedDate < nearest.expectedDate)
    ) {
      nearest = { expectedDate, dayOffset };
    }
  }
  return nearest;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatter.formatToParts(new Date(0));
    formatterCache.set(timeZone, formatter);
    return formatter;
  } catch {
    throw new Error("Invalid recurring bill reporting timezone");
  }
};

export const reportingDateForInstant = (
  instant: string | null,
  timeZone: string,
): string | null => {
  const formatter = formatterFor(timeZone);
  if (!instant) return null;

  const timestamp = new Date(instant);
  if (!Number.isFinite(timestamp.getTime())) return null;
  const parts = formatter.formatToParts(timestamp);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const date = formatCalendarDate({ year, month, day });
  return date && isCalendarDate(date) ? date : null;
};

export const recurringBillTransactionDate = (
  transaction: Pick<
    RecurringBillTransaction,
    "invoiceDate" | "occurredAt" | "settledAt"
  >,
  timeZone: string,
): string | null => {
  if (transaction.invoiceDate !== null)
    return isCalendarDate(transaction.invoiceDate)
      ? transaction.invoiceDate
      : null;
  if (transaction.occurredAt)
    return reportingDateForInstant(transaction.occurredAt, timeZone);
  return reportingDateForInstant(transaction.settledAt, timeZone);
};

const normalizeText = (value: string | null | undefined): string =>
  value?.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase() ?? "";

const normalizeCurrency = (value: string | null | undefined): string =>
  value?.normalize("NFKC").trim().toUpperCase() ?? "";

export const isRecurringBillTransactionEligible = (
  schedule: Pick<
    RecurringBillScheduleInput,
    | "anchorDate"
    | "frequency"
    | "counterparty"
    | "descriptionMatchText"
    | "descriptionMatchMode"
    | "daysEarly"
    | "daysLate"
    | "documentCurrency"
  >,
  expectedDate: string,
  transaction: RecurringBillTransaction,
  timeZone: string,
): boolean => {
  if (
    transaction.kind !== "supplier_expense" ||
    transaction.status !== "recorded" ||
    occurrenceIndexForDate(schedule, expectedDate) === null
  ) {
    return false;
  }

  if (
    !normalizeText(schedule.counterparty) ||
    normalizeText(schedule.counterparty) !==
      normalizeText(transaction.counterparty) ||
    normalizeCurrency(schedule.documentCurrency) !==
      normalizeCurrency(transaction.documentCurrency)
  ) {
    return false;
  }

  if (!recurringBillDescriptionMatcherFor(schedule)(transaction.description))
    return false;

  const transactionDate = recurringBillTransactionDate(transaction, timeZone);
  const parsedTransactionDate = transactionDate
    ? parseCalendarDate(transactionDate)
    : null;
  const parsedExpectedDate = parseCalendarDate(expectedDate);
  if (!parsedTransactionDate || !parsedExpectedDate) return false;

  const dayOffset =
    daysFromCivil(
      parsedTransactionDate.year,
      parsedTransactionDate.month,
      parsedTransactionDate.day,
    ) -
    daysFromCivil(
      parsedExpectedDate.year,
      parsedExpectedDate.month,
      parsedExpectedDate.day,
    );
  return dayOffset >= -schedule.daysEarly && dayOffset <= schedule.daysLate;
};

export const generateOccurrenceDates = (
  schedule: Pick<RecurringBillScheduleInput, "anchorDate" | "frequency">,
  throughDate: string,
  maxOccurrences: number,
): string[] => {
  if (
    !Number.isSafeInteger(maxOccurrences) ||
    maxOccurrences < 0 ||
    maxOccurrences > maximumRecurringOccurrences
  ) {
    throw new RangeError("Invalid recurring bill occurrence limit");
  }

  const total = occurrenceCountThrough(schedule, throughDate);
  const firstIndex = Math.max(0, total - maxOccurrences);
  const dates: string[] = [];
  for (let index = firstIndex; index < total; index += 1) {
    const date = occurrenceDateAt(schedule, index);
    if (date) dates.push(date);
  }
  return dates;
};

const candidateFor = (
  transaction: RecurringBillTransaction,
): RecurringBillCandidate => ({
  id: transaction.id,
  invoiceDate: transaction.invoiceDate,
  occurredAt: transaction.occurredAt,
  settledAt: transaction.settledAt,
  counterparty: transaction.counterparty,
  description: transaction.description,
  documentCurrency: transaction.documentCurrency,
  documentAmount: transaction.documentAmount,
});

const occurrenceKey = (scheduleId: string, expectedDate: string): string =>
  `${scheduleId}:${expectedDate}`;

interface CandidateEdge {
  expectedDate: string;
  transaction: RecurringBillTransaction;
}

const selectedMissingOccurrencePage = (
  completedIndexes: readonly number[],
  throughCount: number,
  unresolvedOffset: number,
  limit: number,
): { indexes: Set<number>; nextOffset: number | null } => {
  const indexes = new Set<number>();

  let remainingOffset = unresolvedOffset;
  let remainingLimit = limit;
  let nextIndex = 0;
  const selectMissingGap = (startIndex: number, endIndex: number) => {
    if (remainingLimit === 0 || startIndex >= endIndex) return;

    const gapSize = endIndex - startIndex;
    if (remainingOffset >= gapSize) {
      remainingOffset -= gapSize;
      return;
    }

    const pageStart = startIndex + remainingOffset;
    remainingOffset = 0;
    const selectedCount = Math.min(remainingLimit, endIndex - pageStart);
    for (let index = pageStart; index < pageStart + selectedCount; index += 1)
      indexes.add(index);
    remainingLimit -= selectedCount;
  };

  for (const completedIndex of completedIndexes) {
    if (completedIndex >= throughCount || remainingLimit === 0) break;
    if (completedIndex < nextIndex) continue;
    selectMissingGap(nextIndex, completedIndex);
    nextIndex = completedIndex + 1;
  }

  if (remainingLimit > 0) selectMissingGap(nextIndex, throughCount);

  const missingCount = throughCount - completedIndexes.length;
  const pageEndOffset = unresolvedOffset + indexes.size;
  return {
    indexes,
    nextOffset: pageEndOffset < missingCount ? pageEndOffset : null,
  };
};

const completedRecoveryIndexes = (
  completedIndexes: readonly number[],
  throughCount: number,
  limit: number,
): Set<number> => {
  const firstRecentIndex = Math.max(0, throughCount - Math.min(6, limit));
  return new Set(
    completedIndexes.filter(
      (index) => index >= firstRecentIndex && index < throughCount,
    ),
  );
};

const firstMissingIndex = (
  completedIndexes: readonly number[],
  throughCount: number,
): number | null => {
  let nextExpectedIndex = 0;
  for (const index of completedIndexes) {
    if (index < nextExpectedIndex) continue;
    if (index > nextExpectedIndex) break;
    nextExpectedIndex += 1;
  }
  return nextExpectedIndex < throughCount ? nextExpectedIndex : null;
};

const firstFutureIncompleteIndex = (
  completedIndexes: readonly number[],
  firstFutureIndex: number,
): number => {
  let nextExpectedIndex = firstFutureIndex;
  for (const index of completedIndexes) {
    if (index < nextExpectedIndex) continue;
    if (index > nextExpectedIndex) break;
    nextExpectedIndex += 1;
  }
  return nextExpectedIndex;
};

export const buildRecurringBillViews = ({
  schedules,
  transactions,
  links,
  timeZone,
  asOfDate,
  maxOccurrences = defaultViewOccurrenceLimit,
  unresolvedOffset = 0,
}: BuildRecurringBillViewsInput): RecurringBillView[] => {
  formatterFor(timeZone);
  if (!isCalendarDate(asOfDate))
    throw new Error("Invalid recurring bill as-of date");
  const parsedAsOfDate = parseCalendarDate(asOfDate)!;
  const asOfOrdinal = daysFromCivil(
    parsedAsOfDate.year,
    parsedAsOfDate.month,
    parsedAsOfDate.day,
  );
  if (
    !Number.isSafeInteger(maxOccurrences) ||
    maxOccurrences < 1 ||
    maxOccurrences > maximumRecurringOccurrences
  ) {
    throw new RangeError("Invalid recurring bill occurrence limit");
  }
  if (
    !Number.isSafeInteger(unresolvedOffset) ||
    unresolvedOffset < 0 ||
    unresolvedOffset > maximumUnresolvedOffset
  ) {
    throw new RangeError("Invalid recurring bill unresolved offset");
  }

  const schedulesById = new Map(
    schedules.map((schedule) => [schedule.id, schedule]),
  );
  const transactionsById = new Map(
    transactions.map((transaction) => [transaction.id, transaction]),
  );
  const linksByOccurrence = new Map<string, RecurringBillLink[]>();
  const linksBySchedule = new Map<string, RecurringBillLink[]>();
  const reservedTransactionIds = new Set<string>();

  for (const link of links) {
    const key = occurrenceKey(link.scheduleId, link.expectedDate);
    const occurrenceLinks = linksByOccurrence.get(key) ?? [];
    occurrenceLinks.push(link);
    linksByOccurrence.set(key, occurrenceLinks);
    const scheduleLinks = linksBySchedule.get(link.scheduleId) ?? [];
    scheduleLinks.push(link);
    linksBySchedule.set(link.scheduleId, scheduleLinks);
    reservedTransactionIds.add(link.transactionId);
  }

  const candidateEdges = new Map<string, CandidateEdge[]>();
  for (const schedule of schedules) {
    if (!schedule.active) continue;

    const normalizedCounterparty = normalizeText(schedule.counterparty);
    const normalizedCurrency = normalizeCurrency(schedule.documentCurrency);
    const matchesDescription = recurringBillDescriptionMatcherFor(schedule);

    for (const transaction of transactions) {
      if (
        transaction.kind !== "supplier_expense" ||
        transaction.status !== "recorded" ||
        normalizeText(transaction.counterparty) !== normalizedCounterparty ||
        normalizeCurrency(transaction.documentCurrency) !==
          normalizedCurrency ||
        !matchesDescription(transaction.description)
      ) {
        continue;
      }

      const transactionDate = recurringBillTransactionDate(
        transaction,
        timeZone,
      );
      if (!transactionDate) continue;
      for (const index of nearbyOccurrenceIndexes(schedule, transactionDate)) {
        const expectedDate = occurrenceDateAt(schedule, index);
        if (
          !expectedDate ||
          !isRecurringBillTransactionEligible(
            schedule,
            expectedDate,
            transaction,
            timeZone,
          )
        ) {
          continue;
        }
        const key = occurrenceKey(schedule.id, expectedDate);
        const edges = candidateEdges.get(key) ?? [];
        edges.push({ expectedDate, transaction });
        candidateEdges.set(key, edges);
      }
    }
  }

  const completedByOccurrence = new Map<
    string,
    { expectedDate: string; transactionId: string }
  >();

  for (const [key, occurrenceLinks] of linksByOccurrence) {
    const link = occurrenceLinks[0];
    const schedule = link ? schedulesById.get(link.scheduleId) : undefined;
    const transaction = link
      ? transactionsById.get(link.transactionId)
      : undefined;
    if (
      occurrenceLinks.length === 1 &&
      link &&
      schedule &&
      transaction &&
      isRecurringBillTransactionEligible(
        schedule,
        link.expectedDate,
        transaction,
        timeZone,
      )
    ) {
      completedByOccurrence.set(key, {
        expectedDate: link.expectedDate,
        transactionId: transaction.id,
      });
    }
  }

  const automaticEdgesByTransaction = new Map<string, Set<string>>();
  for (const [key, edges] of candidateEdges) {
    if (linksByOccurrence.has(key)) continue;
    for (const { transaction } of edges) {
      if (reservedTransactionIds.has(transaction.id)) continue;
      const occurrenceKeys =
        automaticEdgesByTransaction.get(transaction.id) ?? new Set();
      occurrenceKeys.add(key);
      automaticEdgesByTransaction.set(transaction.id, occurrenceKeys);
    }
  }

  for (const [key, edges] of candidateEdges) {
    if (linksByOccurrence.has(key)) continue;
    const eligibleEdges = edges.filter(
      ({ transaction }) => !reservedTransactionIds.has(transaction.id),
    );
    if (eligibleEdges.length !== 1) continue;
    const transaction = eligibleEdges[0]!.transaction;
    if (automaticEdgesByTransaction.get(transaction.id)?.size !== 1) continue;
    const [scheduleId, expectedDate] = key.split(":");
    if (!scheduleId || !expectedDate) continue;
    completedByOccurrence.set(key, {
      expectedDate,
      transactionId: transaction.id,
    });
  }

  return schedules.map((schedule) => {
    const totalPastOccurrences = occurrenceCountThrough(schedule, asOfDate);
    const allCompletedIndexes = [
      ...new Set(
        [...completedByOccurrence.entries()]
          .filter(([key]) => {
            const [scheduleId] = key.split(":");
            return scheduleId === schedule.id;
          })
          .map(([, completion]) =>
            occurrenceIndexForDate(schedule, completion.expectedDate),
          )
          .filter((index): index is number => index !== null),
      ),
    ].sort((left, right) => left - right);
    const completedIndexes = allCompletedIndexes.filter(
      (index) => index < totalPastOccurrences,
    );
    const oldestPendingIndex = firstMissingIndex(
      completedIndexes,
      totalPastOccurrences,
    );
    const oldestPendingDate =
      oldestPendingIndex === null
        ? null
        : occurrenceDateAt(schedule, oldestPendingIndex);
    const latestDueDate = calendarDateFromOrdinal(
      asOfOrdinal - schedule.daysLate - 1,
    );
    const dueOccurrenceCount =
      latestDueDate && latestDueDate >= schedule.anchorDate
        ? occurrenceCountThrough(schedule, latestDueDate)
        : 0;
    const completedDueCount = completedIndexes.filter(
      (index) => index < dueOccurrenceCount,
    ).length;
    const completedPendingCount = completedIndexes.length - completedDueCount;
    const dueCount = dueOccurrenceCount - completedDueCount;
    const pendingCount =
      totalPastOccurrences - dueOccurrenceCount - completedPendingCount;
    const nextIndex =
      oldestPendingIndex ??
      firstFutureIncompleteIndex(allCompletedIndexes, totalPastOccurrences);
    const nextExpectedDate = occurrenceDateAt(schedule, nextIndex);

    const missingPage = selectedMissingOccurrencePage(
      completedIndexes,
      totalPastOccurrences,
      unresolvedOffset,
      maxOccurrences,
    );
    const visibleIndexes = new Set([
      ...completedRecoveryIndexes(
        completedIndexes,
        totalPastOccurrences,
        maxOccurrences,
      ),
      ...missingPage.indexes,
    ]);
    const firstFutureIncomplete = firstFutureIncompleteIndex(
      allCompletedIndexes,
      totalPastOccurrences,
    );
    if (allCompletedIndexes.includes(totalPastOccurrences))
      visibleIndexes.add(totalPastOccurrences);
    visibleIndexes.add(firstFutureIncomplete);
    const visibleDates = new Set(
      [...visibleIndexes]
        .map((index) => occurrenceDateAt(schedule, index))
        .filter((date): date is string => date !== null),
    );
    const scheduleLinks = linksBySchedule.get(schedule.id) ?? [];
    for (const link of scheduleLinks) {
      if (link.expectedDate >= schedule.anchorDate)
        visibleDates.add(link.expectedDate);
    }

    const occurrences = [...visibleDates]
      .sort()
      .map((expectedDate): RecurringBillOccurrence => {
        const key = occurrenceKey(schedule.id, expectedDate);
        const matchingEdges = candidateEdges.get(key) ?? [];
        const completion = completedByOccurrence.get(key);
        const candidates = (
          completion
            ? []
            : matchingEdges
                .filter(
                  ({ transaction }) =>
                    !reservedTransactionIds.has(transaction.id),
                )
                .map(({ transaction }) => candidateFor(transaction))
        ).sort((left, right) => left.id.localeCompare(right.id));
        const associationLinks = linksByOccurrence.get(key) ?? [];
        const associationLink = associationLinks[0];
        const associatedTransaction = associationLink
          ? transactionsById.get(associationLink.transactionId)
          : undefined;
        const associationEligible =
          associationLinks.length === 1 &&
          Boolean(
            associationLink &&
            associatedTransaction &&
            isRecurringBillTransactionEligible(
              schedule,
              expectedDate,
              associatedTransaction,
              timeZone,
            ),
          );
        const association = associationLink
          ? {
              transactionId: associationLink.transactionId,
              linkedAt: associationLink.createdAt,
              eligible: associationEligible,
              transaction: associatedTransaction
                ? candidateFor(associatedTransaction)
                : null,
            }
          : null;

        const expected = parseCalendarDate(expectedDate)!;
        const daysSinceExpected =
          asOfOrdinal -
          daysFromCivil(expected.year, expected.month, expected.day);

        return {
          expectedDate,
          isScheduled: occurrenceIndexForDate(schedule, expectedDate) !== null,
          status: completion
            ? null
            : daysSinceExpected < 0
              ? "Upcoming"
              : daysSinceExpected <= schedule.daysLate
                ? "Pending"
                : "Due",
          isComplete: completion !== undefined,
          transactionId: completion?.transactionId ?? null,
          candidates,
          association,
        };
      });

    const candidateTransactions = new Map<string, RecurringBillCandidate>();
    for (const occurrence of occurrences) {
      for (const candidate of occurrence.candidates)
        candidateTransactions.set(candidate.id, candidate);
    }
    const candidateTransactionIds = [...candidateTransactions.keys()].sort();

    const amountEstimate = previewRecurringBillMatches({
      schedule,
      transactions,
      timeZone,
      asOfDate,
    }).amountEstimate;

    return {
      schedule,
      status: dueCount > 0 ? "Due" : pendingCount > 0 ? "Pending" : "Upcoming",
      nextExpectedDate,
      nextUnresolvedOffset: missingPage.nextOffset,
      oldestPendingDate,
      amountEstimate,
      pendingCount,
      dueCount,
      candidateTransactionIds,
      candidateTransactions: candidateTransactionIds.map(
        (id) => candidateTransactions.get(id)!,
      ),
      occurrences,
    };
  });
};

const amountEstimateFromPreviewRows = (
  rows: readonly RecurringBillMatchPreviewRow[],
  transactions: readonly RecurringBillTransaction[],
  documentCurrency: string,
  asOfDate?: string,
): RecurringBillAmountEstimate | null => {
  const transactionsById = new Map(
    transactions.map((transaction) => [transaction.id, transaction]),
  );
  const amounts: bigint[] = [];

  for (const row of rows) {
    if (
      row.result !== "aligned" ||
      row.date === null ||
      (asOfDate !== undefined && row.date > asOfDate)
    ) {
      continue;
    }

    const transaction = transactionsById.get(row.transactionId);
    if (
      !transaction ||
      normalizeCurrency(transaction.documentCurrency) !==
        normalizeCurrency(documentCurrency)
    ) {
      continue;
    }

    const parsedAmount = recurringBillAmountSchema.safeParse(
      transaction.documentAmount,
    );
    if (!parsedAmount.success) continue;
    amounts.push(parseDecimal(parsedAmount.data));
  }

  if (!amounts.length) return null;

  const sum = amounts.reduce((total, amount) => total + amount, 0n);
  const minimum = amounts.reduce((smallest, amount) =>
    amount < smallest ? amount : smallest,
  );
  const maximum = amounts.reduce((largest, amount) =>
    amount > largest ? amount : largest,
  );
  const averageDenominator = BigInt(amounts.length) * 100n;
  const averageRemainder = sum % averageDenominator;
  const averageCents =
    sum / averageDenominator +
    (averageRemainder * 2n >= averageDenominator ? 1n : 0n);

  return {
    count: amounts.length,
    minimum: formatDecimal(minimum),
    maximum: formatDecimal(maximum),
    average: formatDecimal(averageCents * 100n),
  };
};

export const previewRecurringBillMatches = ({
  schedule,
  transactions,
  timeZone,
  asOfDate,
}: RecurringBillMatchPreviewInput): RecurringBillMatchPreviewResult => {
  formatterFor(timeZone);
  if (asOfDate !== undefined && !isCalendarDate(asOfDate))
    throw new Error("Invalid recurring bill preview as-of date");
  const normalizedCounterparty = normalizeText(schedule.counterparty);
  const normalizedCurrency = normalizeCurrency(schedule.documentCurrency);
  const matchesDescription = recurringBillDescriptionMatcherFor(schedule);
  const candidates = transactions
    .filter(
      (transaction) =>
        transaction.kind === "supplier_expense" &&
        transaction.status === "recorded" &&
        normalizeText(transaction.counterparty) === normalizedCounterparty &&
        normalizeCurrency(transaction.documentCurrency) === normalizedCurrency,
    )
    .map((transaction) => {
      const date = recurringBillTransactionDate(transaction, timeZone);
      const matchingExpectedDates = date
        ? nearbyPreviewOccurrenceIndexes(schedule, date).flatMap((index) => {
            const expectedDate = previewOccurrenceDateAt(schedule, index);
            return expectedDate ? [expectedDate] : [];
          })
        : [];

      return {
        transaction,
        date,
        descriptionMatches: matchesDescription(transaction.description),
        matchingExpectedDates,
        nearest: date
          ? nearestPreviewOccurrenceForDate(
              schedule,
              date,
              matchingExpectedDates.length ? matchingExpectedDates : undefined,
            )
          : null,
      };
    });

  const candidateCountByOccurrence = new Map<string, number>();
  for (const candidate of candidates) {
    if (!candidate.descriptionMatches) continue;
    for (const expectedDate of candidate.matchingExpectedDates) {
      candidateCountByOccurrence.set(
        expectedDate,
        (candidateCountByOccurrence.get(expectedDate) ?? 0) + 1,
      );
    }
  }

  const rows = candidates.map(
    ({
      transaction,
      date,
      descriptionMatches,
      matchingExpectedDates,
      nearest,
    }): RecurringBillMatchPreviewRow => {
      const result =
        date === null
          ? "missing_date"
          : !descriptionMatches
            ? "description_mismatch"
            : matchingExpectedDates.length === 0
              ? "misaligned"
              : matchingExpectedDates.length > 1 ||
                  matchingExpectedDates.some(
                    (expectedDate) =>
                      (candidateCountByOccurrence.get(expectedDate) ?? 0) > 1,
                  )
                ? "ambiguous"
                : "aligned";

      return {
        transactionId: transaction.id,
        date,
        description: transaction.description,
        descriptionMatches,
        expectedDate: nearest?.expectedDate ?? null,
        dayOffset: nearest?.dayOffset ?? null,
        result,
      };
    },
  );

  const descriptionMatchCount = candidates.filter(
    ({ descriptionMatches }) => descriptionMatches,
  ).length;
  const onCadenceCount = candidates.filter(
    ({ descriptionMatches, matchingExpectedDates }) =>
      descriptionMatches && matchingExpectedDates.length > 0,
  ).length;
  const misalignedCount = descriptionMatchCount - onCadenceCount;
  const ambiguousCount = rows.filter(
    ({ result }) => result === "ambiguous",
  ).length;

  return {
    descriptionMatchCount,
    onCadenceCount,
    misalignedCount,
    ambiguousCount,
    amountEstimate: amountEstimateFromPreviewRows(
      rows,
      transactions,
      schedule.documentCurrency,
      asOfDate,
    ),
    rows: rows.sort(
      (left, right) =>
        (left.date ?? "\uffff").localeCompare(right.date ?? "\uffff") ||
        left.transactionId.localeCompare(right.transactionId),
    ),
  };
};

const detectionGroups = (
  transactions: readonly RecurringBillTransaction[],
  timeZone: string,
): Map<
  string,
  Array<{ transaction: RecurringBillTransaction; date: string }>
> => {
  const groups = new Map<
    string,
    Array<{ transaction: RecurringBillTransaction; date: string }>
  >();

  for (const transaction of transactions) {
    if (
      transaction.kind !== "supplier_expense" ||
      transaction.status !== "recorded" ||
      !normalizeText(transaction.counterparty) ||
      !normalizeCurrency(transaction.documentCurrency)
    ) {
      continue;
    }

    const date = recurringBillTransactionDate(transaction, timeZone);
    if (!date) continue;
    const key = [
      normalizeText(transaction.counterparty),
      normalizeCurrency(transaction.documentCurrency),
      normalizeText(transaction.description),
    ].join("\u0000");
    const group = groups.get(key) ?? [];
    group.push({ transaction, date });
    groups.set(key, group);
  }
  return groups;
};

const cadenceRuns = (
  records: Array<{ transaction: RecurringBillTransaction; date: string }>,
  frequency: "monthly" | "annual",
): Array<Array<{ transaction: RecurringBillTransaction; date: string }>> => {
  const byPeriod = new Map<
    number,
    Array<{ transaction: RecurringBillTransaction; date: string }>
  >();
  for (const record of records) {
    const parts = parseCalendarDate(record.date);
    if (!parts) continue;
    const period =
      frequency === "monthly" ? parts.year * 12 + parts.month - 1 : parts.year;
    const entries = byPeriod.get(period) ?? [];
    entries.push(record);
    byPeriod.set(period, entries);
  }

  const uniquePeriods = [...byPeriod.entries()]
    .filter(([, entries]) => entries.length === 1)
    .sort(([left], [right]) => left - right)
    .map(([period, [record]]) => ({ period, record: record! }));
  const runs: Array<
    Array<{ transaction: RecurringBillTransaction; date: string }>
  > = [];
  let run: Array<{ transaction: RecurringBillTransaction; date: string }> = [];
  let anchor: { transaction: RecurringBillTransaction; date: string } | null =
    null;
  let anchorPeriod: number | null = null;
  let previousPeriod: number | null = null;

  for (const item of uniquePeriods) {
    const periodOffset = anchorPeriod === null ? 0 : item.period - anchorPeriod;
    const expectedDate = anchor
      ? occurrenceDateAt(
          {
            anchorDate: anchor.date,
            frequency,
          },
          periodOffset,
        )
      : item.record.date;
    const previousIsAdjacent =
      previousPeriod === null || item.period - previousPeriod === 1;
    const itemParts = parseCalendarDate(item.record.date)!;
    const expectedParts = expectedDate ? parseCalendarDate(expectedDate) : null;
    const dateIsRegular = Boolean(
      anchor &&
      expectedParts &&
      Math.abs(
        daysFromCivil(itemParts.year, itemParts.month, itemParts.day) -
          daysFromCivil(
            expectedParts.year,
            expectedParts.month,
            expectedParts.day,
          ),
      ) <= defaultMatchingWindowDays,
    );

    if (!run.length || (previousIsAdjacent && dateIsRegular)) {
      if (!run.length) {
        run = [item.record];
        anchor = item.record;
        anchorPeriod = item.period;
      } else {
        run.push(item.record);
      }
    } else {
      if (run.length >= (frequency === "monthly" ? 3 : 2)) runs.push(run);
      run = [item.record];
      anchor = item.record;
      anchorPeriod = item.period;
    }
    previousPeriod = item.period;
  }

  if (run.length >= (frequency === "monthly" ? 3 : 2)) runs.push(run);
  return runs;
};

const medianAmount = (
  records: readonly { transaction: RecurringBillTransaction; date: string }[],
): string | null => {
  const amounts = records
    .map(({ transaction }) => transaction.documentAmount)
    .filter((amount): amount is string => amount !== null)
    .sort((left, right) => {
      const [leftWhole, leftFraction = ""] = left.split(".");
      const [rightWhole, rightFraction = ""] = right.split(".");
      const leftValue =
        BigInt(leftWhole!) * 10_000n + BigInt(leftFraction.padEnd(4, "0"));
      const rightValue =
        BigInt(rightWhole!) * 10_000n + BigInt(rightFraction.padEnd(4, "0"));
      return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    });
  if (!amounts.length) return null;
  return amounts[Math.floor((amounts.length - 1) / 2)]!;
};

export const detectRecurringBillSuggestions = (
  transactions: readonly RecurringBillTransaction[],
  timeZone: string,
): RecurringBillSuggestion[] => {
  formatterFor(timeZone);
  const suggestions: RecurringBillSuggestion[] = [];

  for (const records of detectionGroups(transactions, timeZone).values()) {
    records.sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.transaction.id.localeCompare(right.transaction.id),
    );
    for (const frequency of ["monthly", "annual"] as const) {
      for (const run of cadenceRuns(records, frequency)) {
        const first = run[0]!;
        const counterparty = first.transaction.counterparty!.trim();
        const descriptionMatchText =
          first.transaction.description?.trim() || null;
        const schedule = recurringBillScheduleInputSchema.parse({
          label: counterparty.slice(0, 200),
          counterparty,
          descriptionMatchText,
          documentCurrency: normalizeCurrency(
            first.transaction.documentCurrency,
          ),
          expectedAmount: medianAmount(run),
          frequency,
          anchorDate: first.date,
          responsibleUserId: null,
        });
        suggestions.push({
          schedule,
          sourceTransactionIds: run.map(({ transaction }) => transaction.id),
          occurrenceDates: run.map(({ date }) => date),
          supportCount: run.length,
        });
      }
    }
  }

  return suggestions.sort(
    (left, right) =>
      left.schedule.counterparty.localeCompare(right.schedule.counterparty) ||
      left.schedule.documentCurrency.localeCompare(
        right.schedule.documentCurrency,
      ) ||
      left.schedule.frequency.localeCompare(right.schedule.frequency) ||
      left.schedule.anchorDate.localeCompare(right.schedule.anchorDate),
  );
};
