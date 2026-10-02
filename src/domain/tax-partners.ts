import { z } from "zod";

import {
  decimalSchema,
  formatDecimal,
  nonNegativeDecimalSchema,
  parseDecimal,
} from "./money";

const genericPartnerLabelSchema = z
  .string()
  .trim()
  .regex(/^Partner (?:[A-Z]+|[1-9]\d*)$/);

const partnerPercentageSchema = nonNegativeDecimalSchema.refine(
  (value) =>
    decimalSchema.safeParse(value).success && parseDecimal(value) <= 1_000_000n,
  "Expected a partner percentage from 0 to 100",
);

export const taxPartnerSchema = z
  .object({
    label: genericPartnerLabelSchema,
    percentage: partnerPercentageSchema,
  })
  .strict();

export type TaxPartner = z.infer<typeof taxPartnerSchema>;

export const taxPartnersSchema = z
  .array(taxPartnerSchema)
  .min(1)
  .superRefine((partners, context) => {
    const seenLabels = new Set<string>();
    let validPercentages = true;
    const percentageTotal = partners.reduce((total, partner, index) => {
      if (seenLabels.has(partner.label)) {
        context.addIssue({
          code: "custom",
          path: [index, "label"],
          message: "Partner labels must be unique",
        });
      }
      seenLabels.add(partner.label);
      if (!partnerPercentageSchema.safeParse(partner.percentage).success) {
        validPercentages = false;
        return total;
      }
      return total + parseDecimal(partner.percentage);
    }, 0n);

    if (validPercentages && percentageTotal !== 1_000_000n) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "Partner percentages must sum exactly to 100",
      });
    }
  });

export const taxPartnerSelectionSchema = z
  .object({
    userId: z.string().uuid(),
    percentage: partnerPercentageSchema,
  })
  .strict();

export type TaxPartnerSelection = z.infer<typeof taxPartnerSelectionSchema>;

export interface TaxPartnerOption {
  id: string;
  label: string;
}

export const taxPartnerSelectionsSchema = z
  .array(taxPartnerSelectionSchema)
  .min(1)
  .superRefine((partners, context) => {
    const seenUserIds = new Set<string>();
    let validPercentages = true;
    const percentageTotal = partners.reduce((total, partner, index) => {
      if (seenUserIds.has(partner.userId)) {
        context.addIssue({
          code: "custom",
          path: [index, "userId"],
          message: "Partner users must be unique",
        });
      }
      seenUserIds.add(partner.userId);
      if (!partnerPercentageSchema.safeParse(partner.percentage).success) {
        validPercentages = false;
        return total;
      }
      return total + parseDecimal(partner.percentage);
    }, 0n);

    if (validPercentages && percentageTotal !== 1_000_000n) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "Partner percentages must sum exactly to 100",
      });
    }
  });

export interface TaxPartnerAllocation {
  label: string;
  percentage: string;
  amountAud: string;
}

export interface TaxPartnerAllocationResult {
  netResultAud: string;
  allocations: TaxPartnerAllocation[];
}

const comparePartnerLabels = (left: TaxPartner, right: TaxPartner) =>
  left.label < right.label ? -1 : left.label > right.label ? 1 : 0;

export const allocateTaxResult = (
  netResultAud: string,
  partners: readonly TaxPartner[],
): TaxPartnerAllocationResult => {
  const netMinorUnits = parseDecimal(decimalSchema.parse(netResultAud));
  const validatedPartners = taxPartnersSchema.parse(partners);
  const absoluteNetMinorUnits =
    netMinorUnits < 0n ? -netMinorUnits : netMinorUnits;
  const sign = netMinorUnits < 0n ? -1n : 1n;
  const sortedPartners = [...validatedPartners].sort(comparePartnerLabels);
  const proportionalMinorUnits = sortedPartners.map((partner) => ({
    partner,
    amount:
      (absoluteNetMinorUnits * parseDecimal(partner.percentage)) / 1_000_000n,
  }));
  const truncatedTotal = proportionalMinorUnits.reduce(
    (total, allocation) => total + allocation.amount,
    0n,
  );
  const remainder = absoluteNetMinorUnits - truncatedTotal;
  let remainderUnits = remainder;

  return {
    netResultAud: formatDecimal(netMinorUnits),
    allocations: proportionalMinorUnits.map(({ partner, amount }) => {
      const percentage = parseDecimal(partner.percentage);
      const receivesRemainder = percentage > 0n && remainderUnits > 0n;
      if (receivesRemainder) remainderUnits -= 1n;

      return {
        label: partner.label,
        percentage: formatDecimal(percentage),
        amountAud: formatDecimal(
          sign * (amount + (receivesRemainder ? 1n : 0n)),
        ),
      };
    }),
  };
};

export const allocateTaxComponents = (
  incomeAud: string,
  expenseAud: string,
  partners: readonly TaxPartner[],
) => {
  const income = parseDecimal(nonNegativeDecimalSchema.parse(incomeAud));
  const expense = parseDecimal(nonNegativeDecimalSchema.parse(expenseAud));
  const net = allocateTaxResult(formatDecimal(income - expense), partners);
  const common = allocateTaxResult(
    formatDecimal(income < expense ? income : expense),
    partners,
  );
  const commonAmounts = new Map(
    common.allocations.map((partner) => [
      partner.label,
      parseDecimal(partner.amountAud),
    ]),
  );
  return net.allocations.map((partner) => {
    const sharedAmount = commonAmounts.get(partner.label)!;
    const netAmount = parseDecimal(partner.amountAud);
    return {
      ...partner,
      incomeAud: formatDecimal(
        sharedAmount + (netAmount > 0n ? netAmount : 0n),
      ),
      expenseAud: formatDecimal(
        sharedAmount + (netAmount < 0n ? -netAmount : 0n),
      ),
    };
  });
};
