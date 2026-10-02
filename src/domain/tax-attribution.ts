import { formatDecimal, parseDecimal } from "./money";
import type { FinancialYearCashLedgerRow } from "./reports";
import {
  taxPartnerSelectionsSchema,
  type TaxPartnerOption,
  type TaxPartnerSelection,
} from "./tax-partners";
import type { TaxAdjustment } from "./tax-adjustments";

export interface ResolvedTaxPartner extends TaxPartnerSelection {
  label: string;
}

export interface TaxPartnerAttribution {
  userId: string;
  label: string;
  percentage: string;
  directIncomeAud: string;
  directExpenseAud: string;
  businessIncomeAud: string;
  businessExpenseAud: string;
  finalIncomeAud: string;
  finalExpenseAud: string;
  netAud: string;
}

export interface TaxSourceAttribution {
  transactionId: string;
  ownerId: string | null;
  classification: "direct" | "business";
  partnerUserId: string | null;
  incomeEffectAud: string | null;
  expenseEffectAud: string | null;
  directIncomeAud: string;
  directExpenseAud: string;
  businessIncomeAud: string;
  businessExpenseAud: string;
}

export interface TaxAdjustmentAttribution {
  id: string;
  transactionId: string | null;
  classification: "direct" | "business";
  partnerUserId: string | null;
  direction: TaxAdjustment["direction"];
  amountAud: string;
  incomeEffectAud: string;
  expenseEffectAud: string;
}

export interface TaxAttributionResult {
  partners: TaxPartnerAttribution[];
  businessPool: {
    incomeAud: string;
    expenseAud: string;
    netAud: string;
  };
  sources: TaxSourceAttribution[];
  adjustments: TaxAdjustmentAttribution[];
}

const compareUserIds = (left: { userId: string }, right: { userId: string }) =>
  left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0;

export const resolveTaxPartners = (
  selections: readonly TaxPartnerSelection[],
  options: readonly TaxPartnerOption[],
): ResolvedTaxPartner[] => {
  const validated = taxPartnerSelectionsSchema.parse(selections);
  const optionLabels = new Map(options.map(({ id, label }) => [id, label]));
  const resolved = validated.map((partner) => {
    const label = optionLabels.get(partner.userId);
    if (!label)
      throw new Error("Every selected partner must be an active Folio user");
    return { ...partner, label };
  });
  return resolved.sort(compareUserIds);
};

export const allocateTaxSharedAmount = (
  amountAud: string,
  partners: readonly ResolvedTaxPartner[],
): Map<string, string> => {
  const amount = parseDecimal(amountAud);
  const sortedPartners = [...partners].sort(compareUserIds);
  const absoluteAmount = amount < 0n ? -amount : amount;
  const sign = amount < 0n ? -1n : 1n;
  const allocations = sortedPartners.map((partner) => ({
    partner,
    amount: (absoluteAmount * parseDecimal(partner.percentage)) / 1_000_000n,
  }));
  const allocatedAmount = allocations.reduce(
    (total, allocation) => total + allocation.amount,
    0n,
  );
  let remainder = absoluteAmount - allocatedAmount;

  return new Map(
    allocations.map(({ partner, amount: share }) => {
      const receivesRemainder =
        parseDecimal(partner.percentage) > 0n && remainder > 0n;
      if (receivesRemainder) remainder -= 1n;
      return [
        partner.userId,
        formatDecimal(sign * (share + (receivesRemainder ? 1n : 0n))),
      ];
    }),
  );
};

const adjustmentEffects = (adjustment: TaxAdjustment) => {
  const amount = parseDecimal(adjustment.amountAud);
  switch (adjustment.direction) {
    case "increase_income":
      return { income: amount, expense: 0n };
    case "decrease_income":
      return { income: -amount, expense: 0n };
    case "increase_deductible_expense":
      return { income: 0n, expense: amount };
    case "decrease_deductible_expense":
      return { income: 0n, expense: -amount };
  }
};

export const buildTaxAttribution = (input: {
  rows: readonly FinancialYearCashLedgerRow[];
  adjustments: readonly TaxAdjustment[];
  partners: readonly TaxPartnerSelection[];
  partnerOptions: readonly TaxPartnerOption[];
}): TaxAttributionResult => {
  const partners = resolveTaxPartners(input.partners, input.partnerOptions);
  const selectedById = new Map(
    partners.map((partner) => [partner.userId, partner]),
  );
  const direct = new Map(
    partners.map((partner) => [partner.userId, { income: 0n, expense: 0n }]),
  );
  let businessIncome = 0n;
  let businessExpense = 0n;
  const rowsById = new Map(input.rows.map((row) => [row.transactionId, row]));
  const sources = [...input.rows]
    .sort((left, right) =>
      left.transactionId.localeCompare(right.transactionId),
    )
    .map((row): TaxSourceAttribution => {
      const ownerId = row.ownerId ?? null;
      const partner = ownerId === null ? undefined : selectedById.get(ownerId);
      const included = row.disposition === "included";
      const income = included ? parseDecimal(row.incomeEffectAud!) : 0n;
      const expense = included ? parseDecimal(row.expenseEffectAud!) : 0n;
      const isDirect = partner !== undefined;

      if (isDirect) {
        const current = direct.get(partner.userId)!;
        current.income += income;
        current.expense += expense;
      } else {
        businessIncome += income;
        businessExpense += expense;
      }

      return {
        transactionId: row.transactionId,
        ownerId,
        classification: isDirect ? "direct" : "business",
        partnerUserId: partner?.userId ?? null,
        incomeEffectAud: row.incomeEffectAud,
        expenseEffectAud: row.expenseEffectAud,
        directIncomeAud: formatDecimal(isDirect ? income : 0n),
        directExpenseAud: formatDecimal(isDirect ? expense : 0n),
        businessIncomeAud: formatDecimal(isDirect ? 0n : income),
        businessExpenseAud: formatDecimal(isDirect ? 0n : expense),
      };
    });

  const adjustments = [...input.adjustments]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((adjustment): TaxAdjustmentAttribution => {
      const linkedRow = adjustment.transactionId
        ? rowsById.get(adjustment.transactionId)
        : undefined;
      if (adjustment.transactionId && !linkedRow)
        throw new Error(
          "Linked adjustment transaction must be in the selected financial year source ledger",
        );
      const ownerId = linkedRow?.ownerId ?? null;
      const partner = ownerId === null ? undefined : selectedById.get(ownerId);
      const effects = adjustmentEffects(adjustment);

      if (partner) {
        const current = direct.get(partner.userId)!;
        current.income += effects.income;
        current.expense += effects.expense;
      } else {
        businessIncome += effects.income;
        businessExpense += effects.expense;
      }

      return {
        id: adjustment.id,
        transactionId: adjustment.transactionId ?? null,
        classification: partner ? "direct" : "business",
        partnerUserId: partner?.userId ?? null,
        direction: adjustment.direction,
        amountAud: adjustment.amountAud,
        incomeEffectAud: formatDecimal(effects.income),
        expenseEffectAud: formatDecimal(effects.expense),
      };
    });

  const sharedIncome = allocateTaxSharedAmount(
    formatDecimal(businessIncome),
    partners,
  );
  const sharedExpense = allocateTaxSharedAmount(
    formatDecimal(businessExpense),
    partners,
  );
  const allocatedPartners = partners.map((partner): TaxPartnerAttribution => {
    const directAmounts = direct.get(partner.userId)!;
    const businessIncomeShare = parseDecimal(sharedIncome.get(partner.userId)!);
    const businessExpenseShare = parseDecimal(
      sharedExpense.get(partner.userId)!,
    );
    const finalIncome = directAmounts.income + businessIncomeShare;
    const finalExpense = directAmounts.expense + businessExpenseShare;
    return {
      userId: partner.userId,
      label: partner.label,
      percentage: formatDecimal(parseDecimal(partner.percentage)),
      directIncomeAud: formatDecimal(directAmounts.income),
      directExpenseAud: formatDecimal(directAmounts.expense),
      businessIncomeAud: formatDecimal(businessIncomeShare),
      businessExpenseAud: formatDecimal(businessExpenseShare),
      finalIncomeAud: formatDecimal(finalIncome),
      finalExpenseAud: formatDecimal(finalExpense),
      netAud: formatDecimal(finalIncome - finalExpense),
    };
  });

  return {
    partners: allocatedPartners,
    businessPool: {
      incomeAud: formatDecimal(businessIncome),
      expenseAud: formatDecimal(businessExpense),
      netAud: formatDecimal(businessIncome - businessExpense),
    },
    sources,
    adjustments,
  };
};
