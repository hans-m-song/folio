import { RE2JS } from "re2js";
import { z } from "zod";

export const recurringBillDescriptionMatchModeSchema = z.enum([
  "contains",
  "regex",
]);

export type RecurringBillDescriptionMatchMode = z.infer<
  typeof recurringBillDescriptionMatchModeSchema
>;

export interface RecurringBillDescriptionMatchInput {
  descriptionMatchMode: RecurringBillDescriptionMatchMode;
  descriptionMatchText: string | null;
}

export type RecurringBillDescriptionMatcher = (
  description: string | null | undefined,
) => boolean;

const matcherBySchedule = new WeakMap<
  object,
  {
    descriptionMatchMode: RecurringBillDescriptionMatchMode;
    descriptionMatchText: string | null;
    matcher: RecurringBillDescriptionMatcher;
  }
>();

const normalizeContainsText = (value: string | null | undefined): string =>
  value?.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase() ?? "";

const compileMatcher = ({
  descriptionMatchMode,
  descriptionMatchText,
}: RecurringBillDescriptionMatchInput): RecurringBillDescriptionMatcher => {
  if (!descriptionMatchText) return () => true;

  if (descriptionMatchMode === "contains") {
    const text = normalizeContainsText(descriptionMatchText);
    return (description) => normalizeContainsText(description).includes(text);
  }

  const expression = RE2JS.compile(
    descriptionMatchText,
    RE2JS.CASE_INSENSITIVE,
  );
  return (description) =>
    description !== null &&
    description !== undefined &&
    expression.test(description);
};

export const recurringBillDescriptionMatcherFor = <
  T extends object & RecurringBillDescriptionMatchInput,
>(
  schedule: T,
): RecurringBillDescriptionMatcher => {
  const cached = matcherBySchedule.get(schedule);
  if (
    cached &&
    cached.descriptionMatchMode === schedule.descriptionMatchMode &&
    cached.descriptionMatchText === schedule.descriptionMatchText
  ) {
    return cached.matcher;
  }

  const matcher = compileMatcher(schedule);
  matcherBySchedule.set(schedule, {
    descriptionMatchMode: schedule.descriptionMatchMode,
    descriptionMatchText: schedule.descriptionMatchText,
    matcher,
  });
  return matcher;
};
