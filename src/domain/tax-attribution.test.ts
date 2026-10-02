import { describe, expect, it } from "vitest";

import { parseDecimal } from "./money";
import type { FinancialYearCashLedgerRow } from "./reports";
import {
  allocateTaxSharedAmount,
  buildTaxAttribution,
  resolveTaxPartners,
} from "./tax-attribution";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const userC = "33333333-3333-4333-8333-333333333333";
const rowA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const rowB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const rowBusiness = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const row = (
  transactionId: string,
  ownerId: string | null,
  incomeEffectAud: string,
  expenseEffectAud: string,
): FinancialYearCashLedgerRow => ({
  transactionId,
  ownerId,
  updatedAt: "2026-07-01T00:00:00.000Z",
  reference: transactionId,
  counterparty: null,
  description: "Synthetic source row",
  category: null,
  sourceSystem: "manual",
  kind: "sale",
  status: "recorded",
  cashDate: "2026-06-30T00:00:00.000Z",
  period: "FY2025-26",
  disposition: "included",
  reason: "included",
  issues: [],
  incomeEffectAud,
  expenseEffectAud,
  cashEffectAud: incomeEffectAud,
});

const partnerOptions = [
  { id: userA, label: "Synthetic user A" },
  { id: userB, label: "Synthetic user B" },
  { id: userC, label: "Synthetic user C" },
];

describe("version 2 tax attribution", () => {
  it("allocates direct effects once and shares the remaining Business pool", () => {
    const result = buildTaxAttribution({
      rows: [
        row(rowA, userA, "100.0000", "10.0000"),
        row(rowB, userB, "50.0000", "20.0000"),
        row(rowBusiness, null, "200.0000", "100.0000"),
      ],
      adjustments: [],
      partners: [
        { userId: userA, percentage: "60" },
        { userId: userB, percentage: "40" },
      ],
      partnerOptions,
    });

    expect(result.partners).toEqual([
      {
        userId: userA,
        label: "Synthetic user A",
        percentage: "60.0000",
        directIncomeAud: "100.0000",
        directExpenseAud: "10.0000",
        businessIncomeAud: "120.0000",
        businessExpenseAud: "60.0000",
        finalIncomeAud: "220.0000",
        finalExpenseAud: "70.0000",
        netAud: "150.0000",
      },
      {
        userId: userB,
        label: "Synthetic user B",
        percentage: "40.0000",
        directIncomeAud: "50.0000",
        directExpenseAud: "20.0000",
        businessIncomeAud: "80.0000",
        businessExpenseAud: "40.0000",
        finalIncomeAud: "130.0000",
        finalExpenseAud: "60.0000",
        netAud: "70.0000",
      },
    ]);
    expect(result.businessPool).toEqual({
      incomeAud: "200.0000",
      expenseAud: "100.0000",
      netAud: "100.0000",
    });
    expect(result.sources.map(({ classification }) => classification)).toEqual([
      "direct",
      "direct",
      "business",
    ]);
  });

  it("preserves signed direct refunds and expense credits while reconciling Business shares", () => {
    const result = buildTaxAttribution({
      rows: [
        row(rowA, userA, "-100.0000", "-25.0000"),
        row(rowBusiness, null, "-50.0000", "-20.0000"),
      ],
      adjustments: [],
      partners: [
        { userId: userA, percentage: "60" },
        { userId: userB, percentage: "40" },
      ],
      partnerOptions,
    });

    expect(result.businessPool).toEqual({
      incomeAud: "-50.0000",
      expenseAud: "-20.0000",
      netAud: "-30.0000",
    });
    expect(result.sources[0]).toMatchObject({
      classification: "direct",
      directIncomeAud: "-100.0000",
      directExpenseAud: "-25.0000",
    });
    expect(result.sources[1]).toMatchObject({
      classification: "business",
      businessIncomeAud: "-50.0000",
      businessExpenseAud: "-20.0000",
    });
    expect(result.partners).toMatchObject([
      {
        userId: userA,
        directIncomeAud: "-100.0000",
        directExpenseAud: "-25.0000",
        businessIncomeAud: "-30.0000",
        businessExpenseAud: "-12.0000",
        finalIncomeAud: "-130.0000",
        finalExpenseAud: "-37.0000",
        netAud: "-93.0000",
      },
      {
        userId: userB,
        directIncomeAud: "0.0000",
        directExpenseAud: "0.0000",
        businessIncomeAud: "-20.0000",
        businessExpenseAud: "-8.0000",
        finalIncomeAud: "-20.0000",
        finalExpenseAud: "-8.0000",
        netAud: "-12.0000",
      },
    ]);

    const totalAud = (amounts: string[]) =>
      amounts.reduce((total, amount) => total + parseDecimal(amount), 0n);
    expect(
      totalAud(
        result.partners.map(({ businessIncomeAud }) => businessIncomeAud),
      ),
    ).toBe(parseDecimal(result.businessPool.incomeAud));
    expect(
      totalAud(
        result.partners.map(({ businessExpenseAud }) => businessExpenseAud),
      ),
    ).toBe(parseDecimal(result.businessPool.expenseAud));
    expect(
      totalAud(result.partners.map(({ finalIncomeAud }) => finalIncomeAud)),
    ).toBe(parseDecimal("-150.0000"));
    expect(
      totalAud(result.partners.map(({ finalExpenseAud }) => finalExpenseAud)),
    ).toBe(parseDecimal("-45.0000"));
  });

  it("follows a linked adjustment's owner and sends unlinked adjustments to Business", () => {
    const result = buildTaxAttribution({
      rows: [
        row(rowA, userA, "100.0000", "10.0000"),
        row(rowB, userB, "50.0000", "20.0000"),
        row(rowBusiness, null, "200.0000", "100.0000"),
      ],
      adjustments: [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          transactionId: rowA,
          direction: "increase_income",
          amountAud: "5.0000",
          reason: "Synthetic linked adjustment",
        },
        {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          transactionId: rowBusiness,
          direction: "increase_deductible_expense",
          amountAud: "4.0000",
          reason: "Synthetic Business adjustment",
        },
        {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          direction: "increase_income",
          amountAud: "3.0000",
          reason: "Synthetic unlinked adjustment",
        },
      ],
      partners: [
        { userId: userA, percentage: "60" },
        { userId: userB, percentage: "40" },
      ],
      partnerOptions,
    });

    expect(result.partners[0]).toMatchObject({
      directIncomeAud: "105.0000",
      businessIncomeAud: "121.8000",
      businessExpenseAud: "62.4000",
      finalIncomeAud: "226.8000",
      finalExpenseAud: "72.4000",
      netAud: "154.4000",
    });
    expect(result.businessPool).toEqual({
      incomeAud: "203.0000",
      expenseAud: "104.0000",
      netAud: "99.0000",
    });
    expect(
      result.adjustments.map(({ classification }) => classification),
    ).toEqual(["direct", "business", "business"]);
  });

  it("assigns signed remainder units by stable user ID and excludes zero shares", () => {
    const partners = resolveTaxPartners(
      [
        { userId: userC, percentage: "0" },
        { userId: userB, percentage: "50" },
        { userId: userA, percentage: "50" },
      ],
      partnerOptions,
    );

    expect(allocateTaxSharedAmount("-0.0001", partners)).toEqual(
      new Map([
        [userA, "-0.0001"],
        [userB, "0.0000"],
        [userC, "0.0000"],
      ]),
    );
    expect(
      allocateTaxSharedAmount(
        "-0.0001",
        resolveTaxPartners(
          [
            { userId: userA, percentage: "50" },
            { userId: userB, percentage: "50" },
            { userId: userC, percentage: "0" },
          ],
          partnerOptions,
        ),
      ),
    ).toEqual(
      new Map([
        [userA, "-0.0001"],
        [userB, "0.0000"],
        [userC, "0.0000"],
      ]),
    );
  });

  it("keeps direct effects for a zero-percent partner and ignores owner funding and exclusions", () => {
    const ownerFunding = {
      ...row("dddddddd-dddd-4ddd-8ddd-dddddddddddd", userA, "0.0000", "0.0000"),
      kind: "owner_contribution" as const,
      cashEffectAud: "500.0000",
    };
    const excluded = {
      ...row("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", userB, "0.0000", "0.0000"),
      disposition: "expected_exclusion" as const,
      reason: "excluded_transfer" as const,
    };
    const result = buildTaxAttribution({
      rows: [
        row("ffffffff-ffff-4fff-8fff-ffffffffffff", userC, "7.0000", "2.0000"),
        ownerFunding,
        excluded,
      ],
      adjustments: [],
      partners: [
        { userId: userA, percentage: "60" },
        { userId: userB, percentage: "40" },
        { userId: userC, percentage: "0" },
      ],
      partnerOptions,
    });

    expect(
      result.partners.find(({ userId }) => userId === userC),
    ).toMatchObject({
      directIncomeAud: "7.0000",
      directExpenseAud: "2.0000",
      businessIncomeAud: "0.0000",
      businessExpenseAud: "0.0000",
      finalIncomeAud: "7.0000",
      finalExpenseAud: "2.0000",
      netAud: "5.0000",
    });
    expect(
      result.partners.find(({ userId }) => userId === userA),
    ).toMatchObject({
      directIncomeAud: "0.0000",
      directExpenseAud: "0.0000",
    });
    expect(
      result.sources.find(
        ({ transactionId }) => transactionId === ownerFunding.transactionId,
      ),
    ).toMatchObject({
      classification: "direct",
      directIncomeAud: "0.0000",
      directExpenseAud: "0.0000",
    });
    expect(
      result.sources.find(
        ({ transactionId }) => transactionId === excluded.transactionId,
      ),
    ).toMatchObject({
      classification: "direct",
      directIncomeAud: "0.0000",
      directExpenseAud: "0.0000",
    });
  });

  it("rejects selections that are no longer active", () => {
    expect(() =>
      resolveTaxPartners(
        [{ userId: userA, percentage: "100" }],
        partnerOptions.filter(({ id }) => id !== userA),
      ),
    ).toThrow(/active Folio user/);
  });
});
