import { z } from "zod";

import {
  decimalSchema,
  formatDecimal,
  nonNegativeDecimalSchema,
  parseDecimal,
} from "./money";

export const taxAdjustmentDirectionSchema = z.enum([
  "increase_income",
  "decrease_income",
  "increase_deductible_expense",
  "decrease_deductible_expense",
]);

const positiveAudAmountSchema = decimalSchema.refine(
  (value) => decimalSchema.safeParse(value).success && parseDecimal(value) > 0n,
  "Expected a positive AUD amount",
);

export const taxAdjustmentSchema = z
  .object({
    id: z.string().uuid(),
    transactionId: z.string().uuid().optional(),
    direction: taxAdjustmentDirectionSchema,
    amountAud: positiveAudAmountSchema,
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type TaxAdjustment = z.infer<typeof taxAdjustmentSchema>;

const taxAdjustmentCalculationInputSchema = z
  .object({
    baseIncomeAud: decimalSchema,
    baseDeductibleExpenseAud: decimalSchema,
    adjustments: z.array(taxAdjustmentSchema),
  })
  .strict()
  .superRefine(({ adjustments }, context) => {
    const seenIds = new Set<string>();
    adjustments.forEach(({ id }, index) => {
      if (seenIds.has(id)) {
        context.addIssue({
          code: "custom",
          path: ["adjustments", index, "id"],
          message: "Adjustment IDs must be unique",
        });
      }
      seenIds.add(id);
    });
  });

const taxAdjustmentCalculationOutputSchema = z.object({
  baseIncomeAud: decimalSchema,
  baseDeductibleExpenseAud: decimalSchema,
  adjustments: z.array(taxAdjustmentSchema),
  adjustedIncomeAud: nonNegativeDecimalSchema,
  adjustedDeductibleExpenseAud: nonNegativeDecimalSchema,
  netResultAud: decimalSchema,
});

export type TaxAdjustmentCalculation = z.infer<
  typeof taxAdjustmentCalculationOutputSchema
>;

const compareAdjustmentIds = (left: TaxAdjustment, right: TaxAdjustment) =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

export const calculateTaxAdjustments = (
  input: z.input<typeof taxAdjustmentCalculationInputSchema>,
): TaxAdjustmentCalculation => {
  const validated = taxAdjustmentCalculationInputSchema.parse(input);
  let income: bigint = parseDecimal(validated.baseIncomeAud);
  let deductibleExpense: bigint = parseDecimal(
    validated.baseDeductibleExpenseAud,
  );
  const adjustments = [...validated.adjustments].sort(compareAdjustmentIds);

  for (const adjustment of adjustments) {
    const amount = parseDecimal(adjustment.amountAud);
    switch (adjustment.direction) {
      case "increase_income":
        income += amount;
        break;
      case "decrease_income":
        income -= amount;
        break;
      case "increase_deductible_expense":
        deductibleExpense += amount;
        break;
      case "decrease_deductible_expense":
        deductibleExpense -= amount;
        break;
    }
  }

  return taxAdjustmentCalculationOutputSchema.parse({
    baseIncomeAud: formatDecimal(parseDecimal(validated.baseIncomeAud)),
    baseDeductibleExpenseAud: formatDecimal(
      parseDecimal(validated.baseDeductibleExpenseAud),
    ),
    adjustments,
    adjustedIncomeAud: formatDecimal(income),
    adjustedDeductibleExpenseAud: formatDecimal(deductibleExpense),
    netResultAud: formatDecimal(income - deductibleExpense),
  });
};
