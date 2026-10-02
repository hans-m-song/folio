import { describe, expect, it } from "vitest";

import {
  calculateTaxAdjustments,
  taxAdjustmentSchema,
} from "./tax-adjustments";

const adjustment = (
  id: string,
  direction:
    | "increase_income"
    | "decrease_income"
    | "increase_deductible_expense"
    | "decrease_deductible_expense",
  amountAud: string,
  reason = "Reviewed source correction",
) => ({ id, direction, amountAud, reason });

const adjustmentIds = {
  incomeIncrease: "a0000000-0000-4000-8000-000000000001",
  incomeDecrease: "a0000000-0000-4000-8000-000000000002",
  expenseIncrease: "a0000000-0000-4000-8000-000000000003",
  expenseDecrease: "a0000000-0000-4000-8000-000000000004",
};

describe("reviewed tax adjustments", () => {
  it("applies the four explicit directions using exact AUD arithmetic", () => {
    const result = calculateTaxAdjustments({
      baseIncomeAud: "100.0001",
      baseDeductibleExpenseAud: "80.0002",
      adjustments: [
        adjustment(adjustmentIds.incomeIncrease, "increase_income", "0.0003"),
        adjustment(adjustmentIds.incomeDecrease, "decrease_income", "0.0001"),
        adjustment(
          adjustmentIds.expenseIncrease,
          "increase_deductible_expense",
          "0.0004",
        ),
        adjustment(
          adjustmentIds.expenseDecrease,
          "decrease_deductible_expense",
          "0.0002",
        ),
      ],
    });

    expect(result).toMatchObject({
      baseIncomeAud: "100.0001",
      baseDeductibleExpenseAud: "80.0002",
      adjustedIncomeAud: "100.0003",
      adjustedDeductibleExpenseAud: "80.0004",
      netResultAud: "19.9999",
    });
  });

  it("handles income refunds and expense credits across multiple adjustments", () => {
    const result = calculateTaxAdjustments({
      baseIncomeAud: "100.00",
      baseDeductibleExpenseAud: "60.00",
      adjustments: [
        adjustment(
          adjustmentIds.expenseDecrease,
          "decrease_deductible_expense",
          "3.00",
          "Supplier credit",
        ),
        adjustment(
          adjustmentIds.incomeDecrease,
          "decrease_income",
          "2.50",
          "Customer refund",
        ),
        adjustment(
          adjustmentIds.expenseIncrease,
          "increase_deductible_expense",
          "5.00",
        ),
        adjustment(adjustmentIds.incomeIncrease, "increase_income", "10.00"),
      ],
    });

    expect(result.adjustments.map(({ id }) => id)).toEqual(
      Object.values(adjustmentIds),
    );
    expect(result).toMatchObject({
      adjustedIncomeAud: "107.5000",
      adjustedDeductibleExpenseAud: "62.0000",
      netResultAud: "45.5000",
    });
  });

  it("allows an optional transaction ID and trims a nonblank reason", () => {
    expect(
      taxAdjustmentSchema.parse({
        ...adjustment(adjustmentIds.incomeIncrease, "increase_income", "1"),
        transactionId: "b0000000-0000-4000-8000-000000000001",
        reason: "  Reconciled statement  ",
      }),
    ).toMatchObject({ reason: "Reconciled statement" });
    expect(
      taxAdjustmentSchema.parse(
        adjustment(adjustmentIds.incomeIncrease, "increase_income", "1"),
      ).transactionId,
    ).toBeUndefined();
  });

  it("rejects invalid identifiers, directions, reasons, and nonpositive money", () => {
    const valid = adjustment(
      adjustmentIds.incomeIncrease,
      "increase_income",
      "1.00",
    );
    for (const candidate of [
      { ...valid, id: "not-a-uuid" },
      { ...valid, transactionId: "not-a-uuid" },
      { ...valid, direction: "decide_taxability" },
      { ...valid, reason: "   " },
      { ...valid, amountAud: "0.0000" },
      { ...valid, amountAud: "-1.00" },
      { ...valid, amountAud: "1.00001" },
      { ...valid, extra: true },
    ]) {
      expect(taxAdjustmentSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("accepts signed source bases when explicit adjustments restore reviewed components", () => {
    expect(
      calculateTaxAdjustments({
        baseIncomeAud: "-20.0000",
        baseDeductibleExpenseAud: "-10.0000",
        adjustments: [
          adjustment(
            adjustmentIds.incomeIncrease,
            "increase_income",
            "20.0000",
          ),
          adjustment(
            adjustmentIds.expenseIncrease,
            "increase_deductible_expense",
            "10.0000",
          ),
        ],
      }),
    ).toMatchObject({
      baseIncomeAud: "-20.0000",
      baseDeductibleExpenseAud: "-10.0000",
      adjustedIncomeAud: "0.0000",
      adjustedDeductibleExpenseAud: "0.0000",
      netResultAud: "0.0000",
    });
  });

  it("rejects duplicate IDs and reviewed components below zero", () => {
    const validAdjustment = adjustment(
      adjustmentIds.incomeDecrease,
      "decrease_income",
      "10.00",
    );
    const base = {
      baseIncomeAud: "5.00",
      baseDeductibleExpenseAud: "8.00",
      adjustments: [validAdjustment],
    };

    expect(() =>
      calculateTaxAdjustments({ ...base, baseIncomeAud: "-1.00" }),
    ).toThrow();
    expect(() =>
      calculateTaxAdjustments({
        ...base,
        adjustments: [validAdjustment, validAdjustment],
      }),
    ).toThrow("Adjustment IDs must be unique");
    expect(() => calculateTaxAdjustments(base)).toThrow();
    expect(() =>
      calculateTaxAdjustments({
        ...base,
        adjustments: [
          adjustment(
            adjustmentIds.expenseDecrease,
            "decrease_deductible_expense",
            "9.00",
          ),
        ],
      }),
    ).toThrow();
  });

  it("permits negative net results without making a tax decision", () => {
    expect(
      calculateTaxAdjustments({
        baseIncomeAud: "1.00",
        baseDeductibleExpenseAud: "2.00",
        adjustments: [],
      }).netResultAud,
    ).toBe("-1.0000");
  });
});
