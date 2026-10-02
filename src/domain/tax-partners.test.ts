import { describe, expect, it } from "vitest";

import { parseDecimal, sumDecimals } from "./money";
import {
  allocateTaxComponents,
  allocateTaxResult,
  taxPartnersSchema,
  taxPartnerSelectionsSchema,
} from "./tax-partners";

describe("tax partner allocations", () => {
  it("splits reviewed income and deductions while preserving each net share", () => {
    expect(
      allocateTaxComponents("708.00", "719.90", [
        { label: "Partner 1", percentage: "50" },
        { label: "Partner 2", percentage: "50" },
      ]),
    ).toEqual([
      {
        label: "Partner 1",
        percentage: "50.0000",
        incomeAud: "354.0000",
        expenseAud: "359.9500",
        amountAud: "-5.9500",
      },
      {
        label: "Partner 2",
        percentage: "50.0000",
        incomeAud: "354.0000",
        expenseAud: "359.9500",
        amountAud: "-5.9500",
      },
    ]);
  });

  it("reconciles components and saved net allocations across fractional remainders", () => {
    const partners = [
      { label: "Partner A", percentage: "45" },
      { label: "Partner B", percentage: "10" },
      { label: "Partner C", percentage: "45" },
    ];
    for (const [income, expense] of [
      ["0.0012", "0.0001"],
      ["0.0001", "0.0012"],
      ["125.12", "75.01"],
      ["0.0001", "0.0001"],
    ]) {
      const allocations = allocateTaxComponents(income!, expense!, partners);
      const net = parseDecimal(income!) - parseDecimal(expense!);
      expect(sumDecimals(allocations.map((partner) => partner.incomeAud))).toBe(
        sumDecimals([income!]),
      );
      expect(
        sumDecimals(allocations.map((partner) => partner.expenseAud)),
      ).toBe(sumDecimals([expense!]));
      expect(
        allocations.map(({ label, percentage, amountAud }) => ({
          label,
          percentage,
          amountAud,
        })),
      ).toEqual(
        allocateTaxResult(sumDecimals([income!, `-${expense}`]), partners)
          .allocations,
      );
      expect(
        allocations.reduce(
          (total, partner) => total + parseDecimal(partner.amountAud),
          0n,
        ),
      ).toBe(net);
      for (const partner of allocations) {
        expect(parseDecimal(partner.incomeAud)).toBeGreaterThanOrEqual(0n);
        expect(parseDecimal(partner.expenseAud)).toBeGreaterThanOrEqual(0n);
        expect(
          parseDecimal(partner.incomeAud) - parseDecimal(partner.expenseAud),
        ).toBe(parseDecimal(partner.amountAud));
      }
    }
  });
  it("allocates exact decimal shares and returns labels in deterministic order", () => {
    const result = allocateTaxResult("125.12", [
      { label: "Partner B", percentage: "40" },
      { label: "Partner A", percentage: "60" },
    ]);

    expect(result).toEqual({
      netResultAud: "125.1200",
      allocations: [
        {
          label: "Partner A",
          percentage: "60.0000",
          amountAud: "75.0720",
        },
        {
          label: "Partner B",
          percentage: "40.0000",
          amountAud: "50.0480",
        },
      ],
    });
  });

  it("allocates rounding remainder in sorted label order for positive and negative results", () => {
    const partners = [
      { label: "Partner B", percentage: "50" },
      { label: "Partner A", percentage: "50" },
    ];

    expect(allocateTaxResult("0.0001", partners).allocations).toEqual([
      {
        label: "Partner A",
        percentage: "50.0000",
        amountAud: "0.0001",
      },
      {
        label: "Partner B",
        percentage: "50.0000",
        amountAud: "0.0000",
      },
    ]);
    expect(allocateTaxResult("-0.0001", partners).allocations).toEqual([
      {
        label: "Partner A",
        percentage: "50.0000",
        amountAud: "-0.0001",
      },
      {
        label: "Partner B",
        percentage: "50.0000",
        amountAud: "0.0000",
      },
    ]);
  });

  it("requires unique generic labels and exact percentages totaling 100", () => {
    for (const partners of [
      [],
      [
        { label: "Partner A", percentage: "60" },
        { label: "Partner B", percentage: "39.9999" },
      ],
      [
        { label: "Partner A", percentage: "50" },
        { label: "Partner A", percentage: "50" },
      ],
      [{ label: "Partner A", percentage: "100.0001" }],
      [{ label: "operator@example.test", percentage: "100" }],
      [{ label: "Partner A", percentage: "99.99999" }],
      [{ label: "Partner A", percentage: "100", extra: "account-id" }],
    ]) {
      expect(taxPartnersSchema.safeParse(partners).success).toBe(false);
    }
  });

  it("requires unique selected user IDs and exact percentages totaling 100", () => {
    const userA = "11111111-1111-4111-8111-111111111111";
    const userB = "22222222-2222-4222-8222-222222222222";
    for (const partners of [
      [],
      [
        { userId: userA, percentage: "60" },
        { userId: userB, percentage: "39.9999" },
      ],
      [
        { userId: userA, percentage: "50" },
        { userId: userA, percentage: "50" },
      ],
      [{ userId: userA, percentage: "100.0001" }],
      [{ userId: "not-a-user-id", percentage: "100" }],
      [{ userId: userA, percentage: "100", label: "client label" }],
    ]) {
      expect(taxPartnerSelectionsSchema.safeParse(partners).success).toBe(
        false,
      );
    }
  });

  it("does not assign a rounding remainder to a zero-percent partner", () => {
    expect(
      allocateTaxResult("0.0001", [
        { label: "Partner A", percentage: "0" },
        { label: "Partner B", percentage: "100" },
      ]).allocations,
    ).toEqual([
      { label: "Partner A", percentage: "0.0000", amountAud: "0.0000" },
      { label: "Partner B", percentage: "100.0000", amountAud: "0.0001" },
    ]);
  });

  it("rejects invalid signed AUD money", () => {
    for (const netResultAud of ["1.00001", "AUD 1.00", ""]) {
      expect(() =>
        allocateTaxResult(netResultAud, [
          { label: "Partner A", percentage: "100" },
        ]),
      ).toThrow();
    }
  });
});
