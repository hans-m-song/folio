// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { selectAutocompleteOption } from "../components/autocomplete-test-helpers";

const routeState = vi.hoisted(() => ({ result: null as unknown }));
const routerMock = vi.hoisted(() => ({ invalidate: vi.fn() }));
const reviewMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const partnerUserId = "11111111-1111-4111-8111-111111111111";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    (routeId: string) => (configuration: Record<string, unknown>) => ({
      ...configuration,
      routeId,
      useLoaderData: () => routeState.result,
    }),
  useRouter: () => routerMock,
}));

vi.mock("../server/tax-operations", () => ({
  getTaxWorksheet: vi.fn(),
  reviewTaxWorksheet: reviewMock,
  getTaxPartnerOptions: vi.fn(),
  exportTaxSource: vi.fn(),
  exportTaxWorksheet: vi.fn(),
}));

import { Route } from "./reports_.tax";

const page = Route as unknown as { component: ComponentType; routeId: string };

const result = (readyForReview: boolean) => ({
  source: {
    financialYearStartYear: 2025,
    financialYear: "FY2025-26",
    timezone: "Australia/Brisbane",
    fingerprint: "a".repeat(64),
    readyForReview,
    actionRequiredCount: 0,
    unresolvedBankCount: readyForReview ? 0 : 1,
    draftCount: 0,
    bankRows: readyForReview ? [] : [{ id: "synthetic-bank-id" }],
    cashLedger: {
      totals: {
        incomeEffectAud: "100.0000",
        expenseEffectAud: "20.0000",
        cashEffectAud: "80.0000",
        includedCount: 1,
      },
      rows: [] as Array<Record<string, unknown>>,
    },
  },
  latest: null,
  latestIsCurrent: false,
  reviewedVersionCount: 0,
  partnerOptions: [{ id: partnerUserId, label: "Synthetic partner" }],
});

const fundingSummary = (
  owners: Array<Record<string, unknown>>,
  issues: Array<Record<string, unknown>>,
  rows: Array<Record<string, unknown>>,
) => ({
  financialYear: "FY2025-26",
  financialYearStartYear: 2025,
  timezone: "Australia/Brisbane",
  owners,
  issues,
  rows,
});

afterEach(() => {
  cleanup();
  reviewMock.mockClear();
  routerMock.invalidate.mockClear();
});

describe("FY partnership tax worksheet", () => {
  it("uses the independent route ID for the existing worksheet URL", () => {
    expect(page.routeId).toBe("/reports_/tax");
  });

  it("blocks saving while imported bank rows are unresolved", () => {
    routeState.result = result(false);
    render(createElement(page.component));
    expect(screen.getByRole("alert").textContent).toContain(
      "1 bank row remains unresolved",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Save reviewed result",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("saves an attested review with an explicitly selected active partner", async () => {
    routeState.result = {
      ...result(true),
      ownerFunding: fundingSummary(
        [],
        [
          {
            transactionId: "historical-funding-issue",
            ownerId: null,
            reason: "missing_settlement_date",
          },
        ],
        [],
      ),
    };
    render(createElement(page.component));
    fireEvent.click(screen.getByRole("button", { name: "Add partner" }));
    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Partner 1 user" }),
      "Synthetic partner",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Percentage" }), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Save reviewed result" }),
    );
    await waitFor(() => expect(reviewMock).toHaveBeenCalledTimes(1));
    expect(reviewMock.mock.calls[0]?.[0]?.data).toMatchObject({
      financialYearStartYear: 2025,
      partners: [{ userId: partnerUserId, percentage: "100" }],
    });
  });

  it("explains negative source components before submitting a review", async () => {
    const data = result(true);
    data.source.cashLedger.totals.incomeEffectAud = "-20.0000";
    routeState.result = data;
    render(createElement(page.component));
    fireEvent.click(screen.getByRole("button", { name: "Add partner" }));
    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Partner 1 user" }),
      "Synthetic partner",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Percentage" }), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Save reviewed result" }),
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Add reasoned adjustments for negative source totals",
    );
    expect(reviewMock).not.toHaveBeenCalled();
  });

  it("shows unassigned and non-selected owner totals in the Business pool before saving", () => {
    const data = result(true);
    data.source.cashLedger.rows = [
      {
        transactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        ownerId: partnerUserId,
        reference: "SYN-OTHER-OWNER",
        kind: "sale",
        sourceSystem: "manual",
        cashDate: "2026-06-30T00:00:00.000Z",
        disposition: "included",
        incomeEffectAud: "10.0000",
        expenseEffectAud: "2.0000",
      },
      {
        transactionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ownerId: null,
        reference: "SYN-UNASSIGNED",
        kind: "sale",
        sourceSystem: "manual",
        cashDate: "2026-06-30T00:00:00.000Z",
        disposition: "included",
        incomeEffectAud: "5.0000",
        expenseEffectAud: "3.0000",
      },
    ];
    routeState.result = data;
    render(createElement(page.component));

    const table = screen.getByRole("table", {
      name: "Business source effects by owner",
    });
    expect(
      within(table).getByRole("rowheader", { name: "Synthetic partner" }),
    ).toBeTruthy();
    expect(
      within(table).getByRole("rowheader", { name: "Unassigned owner" }),
    ).toBeTruthy();
    expect(screen.getByText(/Income AUD 15\.00/)).toBeTruthy();
  });

  it("shows cumulative owner funding, inactive IDs, and linked partial records separately", () => {
    const data = {
      ...result(true),
      ownerFunding: fundingSummary([], [], []),
    };
    data.ownerFunding = fundingSummary(
      [
        {
          ownerId: partnerUserId,
          loansAdvancedAud: "100.0000",
          principalRepaidAud: "40.0000",
          loanBalanceAud: "60.0000",
          otherContributionsAud: "0.0000",
          transactionIds: ["old-loan"],
        },
        {
          ownerId: "inactive-owner-id",
          loansAdvancedAud: "10.0000",
          principalRepaidAud: "0.0000",
          loanBalanceAud: "10.0000",
          otherContributionsAud: "0.0000",
          transactionIds: ["partial-loan"],
        },
        {
          ownerId: null,
          loansAdvancedAud: "0.0000",
          principalRepaidAud: "0.0000",
          loanBalanceAud: "0.0000",
          otherContributionsAud: "15.0000",
          transactionIds: ["unassigned-contribution"],
        },
      ],
      [
        {
          transactionId: "partial-loan",
          ownerId: "inactive-owner-id",
          reason: "missing_settlement_amount",
        },
        {
          transactionId: "over-repayment",
          ownerId: "inactive-owner-id",
          reason: "negative_loan_balance",
        },
      ],
      [
        {
          transactionId: "old-loan",
          ownerId: partnerUserId,
          updatedAt: "2026-07-01T00:00:00.000Z",
          reference: "OLD-LOAN",
          counterparty: "Synthetic partner",
          description: "Prior year loan",
          category: null,
          sourceSystem: "manual",
          kind: "owner_loan",
          status: "recorded",
          cashDate: "2024-07-01T00:00:00.000Z",
          period: "FY2024-25",
          disposition: "out_of_period",
          reason: "outside_selected_financial_year",
          issues: [],
          incomeEffectAud: "0.0000",
          expenseEffectAud: "0.0000",
          cashEffectAud: "100.0000",
        },
        {
          transactionId: "partial-loan",
          ownerId: "inactive-owner-id",
          updatedAt: "2026-07-01T00:00:00.000Z",
          reference: "PARTIAL-LOAN",
          counterparty: "Inactive owner",
          description: "Amount missing",
          category: null,
          sourceSystem: "manual",
          kind: "owner_loan",
          status: "recorded",
          cashDate: "2025-08-01T00:00:00.000Z",
          period: "FY2025-26",
          disposition: "action_required",
          reason: "missing_cash_facts",
          issues: ["missing_settlement_amount"],
          incomeEffectAud: null,
          expenseEffectAud: null,
          cashEffectAud: null,
        },
        {
          transactionId: "unassigned-contribution",
          ownerId: null,
          updatedAt: "2026-07-01T00:00:00.000Z",
          reference: "UNASSIGNED",
          counterparty: "Unknown source",
          description: "Owner contribution",
          category: null,
          sourceSystem: "manual",
          kind: "owner_contribution",
          status: "recorded",
          cashDate: "2025-10-01T00:00:00.000Z",
          period: "FY2025-26",
          disposition: "included",
          reason: "owner_funding_cash_only",
          issues: [],
          incomeEffectAud: "0.0000",
          expenseEffectAud: "0.0000",
          cashEffectAud: "15.0000",
        },
        {
          transactionId: "over-repayment",
          ownerId: "inactive-owner-id",
          updatedAt: "2026-07-01T00:00:00.000Z",
          reference: "REPAY-OVER",
          counterparty: "Inactive owner",
          description: "Principal repayment",
          category: null,
          sourceSystem: "manual",
          kind: "owner_loan_repayment",
          status: "recorded",
          cashDate: "2026-01-01T00:00:00.000Z",
          period: "FY2025-26",
          disposition: "included",
          reason: "owner_funding_cash_only",
          issues: [],
          incomeEffectAud: "0.0000",
          expenseEffectAud: "0.0000",
          cashEffectAud: "-20.0000",
        },
      ],
    );
    routeState.result = data;
    render(createElement(page.component));

    const summaryTable = screen.getByRole("table", {
      name: "Current recorded owner funding through FY end",
    });
    expect(
      within(summaryTable).getByRole("rowheader", {
        name: "Synthetic partner",
      }),
    ).toBeTruthy();
    expect(
      within(summaryTable).getByRole("rowheader", {
        name: "Unavailable owner · inactive-owner-id",
      }),
    ).toBeTruthy();
    expect(
      within(summaryTable).getByRole("rowheader", {
        name: "Unassigned owner",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/This summary is partial: 2 recorded funding/),
    ).toBeTruthy();
    expect(
      screen.getByText(/authoritative debt while issues remain/),
    ).toBeTruthy();
    expect(
      summaryTable.querySelectorAll("td.money-column [data-money-value]"),
    ).toHaveLength(12);

    fireEvent.click(
      screen.getByText(
        /4 recorded funding transactions and supporting details/,
      ),
    );
    const detailsTable = screen.getByRole("table", {
      name: "Recorded owner funding transactions",
    });
    const detailRows = within(detailsTable).getAllByRole("row").slice(1);
    expect(
      detailRows.map((row) => within(row).getAllByRole("cell")[0]!.textContent),
    ).toEqual(["01/07/2024", "01/08/2025", "01/10/2025", "01/01/2026"]);
    expect(
      within(detailsTable).getByRole("link", {
        name: "View transaction PARTIAL-LOAN",
      }),
    ).toBeTruthy();
    expect(
      within(detailsTable).getByRole("link", {
        name: "View transaction REPAY-OVER",
      }),
    ).toBeTruthy();
  });

  it("does not infer a funding balance when the loader has no owner funding summary", () => {
    routeState.result = result(true);
    render(createElement(page.component));

    expect(
      screen.getByText(
        "Owner funding summary unavailable; no balance is inferred.",
      ),
    ).toBeTruthy();
  });

  it("shows the reporting-timezone cash date at the FY boundary", () => {
    const data = result(true);
    data.source.cashLedger.rows = [
      {
        transactionId: "11111111-1111-4111-8111-111111111111",
        reference: "SYN-BOUNDARY",
        counterparty: "Synthetic supplier",
        description: "Annual service",
        category: "Software",
        kind: "supplier_expense",
        sourceSystem: "manual",
        cashDate: "2025-06-30T14:00:00.000Z",
        disposition: "included",
        incomeEffectAud: "10.0000",
        expenseEffectAud: "0.0000",
      },
    ];
    routeState.result = data;
    render(createElement(page.component));
    fireEvent.click(screen.getByText("1 included source rows"));
    expect(screen.getByText("01/07/2025")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "View transaction SYN-BOUNDARY" })
        .textContent,
    ).toBe("Synthetic supplier");
    expect(screen.getByText(/Ref SYN-BOUNDARY · Software/)).toBeTruthy();
    expect(screen.getByText("Expense")).toBeTruthy();
    expect(screen.getByText("Annual service")).toBeTruthy();
  });

  it("uses a human-readable Stripe fallback before the source reference", () => {
    const data = result(true);
    data.source.cashLedger.rows = [
      {
        transactionId: "22222222-2222-4222-8222-222222222222",
        reference: "txn_SYNTHETIC",
        counterparty: null,
        description: null,
        category: null,
        kind: "sale",
        sourceSystem: "stripe",
        cashDate: "2026-01-21T00:00:00.000Z",
        disposition: "included",
        incomeEffectAud: "29.0000",
        expenseEffectAud: "1.3200",
      },
    ];
    routeState.result = data;
    render(createElement(page.component));
    fireEvent.click(screen.getByText("1 included source rows"));
    const link = screen.getByRole("link", {
      name: "View transaction txn_SYNTHETIC",
    });
    expect(link.textContent).toBe("Stripe");
    expect(screen.getByText("Sale")).toBeTruthy();
    expect(screen.getByText(/Ref txn_SYNTHETIC/)).toBeTruthy();
  });

  it("shows source net independently of cash movements such as owner funding", () => {
    const data = result(true);
    data.source.cashLedger.totals.cashEffectAud = "900.0000";
    routeState.result = data;
    render(createElement(page.component));
    const netCard = screen.getByText("Source net result").parentElement!;
    const sourceNet = within(netCard).getByText("AUD 80.00");
    expect(sourceNet.tagName).toBe("STRONG");
    expect(sourceNet.getAttribute("data-money-value")).toBe("");
    expect(screen.queryByText("AUD 900.00")).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Preparation reports/ }),
    ).toBeNull();
  });

  it("orders source rows by date and separates supplier, type, and monetary effects", () => {
    const data = result(true);
    const sourceRow = {
      category: null,
      sourceSystem: "manual",
      disposition: "included",
      incomeEffectAud: "0.0000",
      expenseEffectAud: "1.3000",
      description: "Synthetic bank fee",
      kind: "processing_fee",
    };
    data.source.cashLedger.rows = [
      {
        ...sourceRow,
        transactionId: "later",
        reference: "LATER",
        cashDate: "2026-02-01T00:00:00.000Z",
        counterparty: "CommBank",
      },
      {
        ...sourceRow,
        transactionId: "earlier",
        reference: "EARLIER",
        cashDate: "2026-01-01T00:00:00.000Z",
        counterparty: null,
      },
    ];
    routeState.result = data;
    render(createElement(page.component));
    const table = screen
      .getByRole("columnheader", { name: "Supplier / source" })
      .closest("table")!;
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual([
      "Date",
      "Supplier / source",
      "Type",
      "Income AUD",
      "Expense AUD",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(
      rows.map((row) => within(row).getAllByRole("cell")[0]!.textContent),
    ).toEqual(["01/01/2026", "01/02/2026"]);
    expect(
      within(rows[0]!).getByRole("link", { name: "View transaction EARLIER" })
        .textContent,
    ).toBe("Manual");
    expect(
      within(rows[1]!).getByRole("link", { name: "View transaction LATER" })
        .textContent,
    ).toBe("CommBank");
    expect(
      within(rows[0]!)
        .getAllByRole("cell")
        .slice(2)
        .map((cell) => cell.textContent),
    ).toEqual(["Fee", "0.00", "1.30"]);
    expect(within(table).getAllByRole("columnheader")[3]!.className).toContain(
      "money-column",
    );
    expect(within(table).getAllByRole("columnheader")[4]!.className).toContain(
      "money-column",
    );
    expect(
      table.querySelectorAll("tbody td.money-column [data-money-value]"),
    ).toHaveLength(4);
  });

  it("shows income, deductions, and net for each partner from an existing saved review", () => {
    routeState.result = {
      ...result(true),
      latestIsCurrent: true,
      reviewedVersionCount: 1,
      latest: {
        id: "synthetic-review",
        reviewedAt: "2026-09-29T15:19:43.836Z",
        snapshot: {
          cashLedger: result(true).source.cashLedger,
          bankRows: [],
          humanAdjustments: [],
          totals: {
            reviewedIncomeAud: "708.0000",
            reviewedDeductibleExpenseAud: "719.9000",
            reviewedNetResultAud: "-11.9000",
          },
          partnerShares: [
            { label: "Partner 1", percentage: "50.0000", amountAud: "-5.9500" },
            { label: "Partner 2", percentage: "50.0000", amountAud: "-5.9500" },
          ],
        },
      },
    };
    const { container } = render(createElement(page.component));
    const table = screen.getByRole("table", {
      name: "Partner allocation of reviewed income, deductions, and net result",
    });
    for (const label of ["Partner 1", "Partner 2"]) {
      const row = within(table)
        .getByRole("rowheader", { name: label })
        .closest("tr")!;
      expect(
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ).toEqual(["50%", "354.00", "359.95", "-5.95"]);
    }
    const reviewedNet = screen.getByText("AUD -11.90");
    expect(reviewedNet.tagName).toBe("STRONG");
    expect(reviewedNet.getAttribute("data-money-value")).toBe("");
    expect(table.querySelectorAll("th.money-column")).toHaveLength(3);
    expect(
      table.querySelectorAll("td.money-column [data-money-value]"),
    ).toHaveLength(6);
    expect(container.querySelectorAll("[data-money-value]")).toHaveLength(12);
  });

  it("renders frozen direct and Business allocations for a version 2 review", () => {
    routeState.result = {
      ...result(true),
      latestIsCurrent: true,
      reviewedVersionCount: 1,
      latest: {
        id: "synthetic-review-v2",
        reviewedAt: "2026-09-29T15:19:43.836Z",
        snapshot: {
          modelVersion: 2,
          sourceFingerprintVersion: 2,
          cashLedger: result(true).source.cashLedger,
          bankRows: [],
          humanAdjustments: [],
          totals: {
            reviewedIncomeAud: "100.0000",
            reviewedDeductibleExpenseAud: "10.0000",
            reviewedNetResultAud: "90.0000",
          },
          partnerShares: [
            {
              userId: partnerUserId,
              label: "Synthetic partner",
              percentage: "100.0000",
              directIncomeAud: "10.0000",
              directExpenseAud: "1.0000",
              businessIncomeAud: "90.0000",
              businessExpenseAud: "9.0000",
              finalIncomeAud: "100.0000",
              finalExpenseAud: "10.0000",
              netAud: "90.0000",
            },
          ],
          attribution: {
            businessPool: {
              incomeAud: "90.0000",
              expenseAud: "9.0000",
              netAud: "81.0000",
            },
            sources: [
              {
                transactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                ownerId: partnerUserId,
                classification: "direct",
                partnerUserId,
                incomeEffectAud: "10.0000",
                expenseEffectAud: "1.0000",
                directIncomeAud: "10.0000",
                directExpenseAud: "1.0000",
                businessIncomeAud: "0.0000",
                businessExpenseAud: "0.0000",
              },
              {
                transactionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                ownerId: null,
                classification: "business",
                partnerUserId: null,
                incomeEffectAud: "90.0000",
                expenseEffectAud: "9.0000",
                directIncomeAud: "0.0000",
                directExpenseAud: "0.0000",
                businessIncomeAud: "90.0000",
                businessExpenseAud: "9.0000",
              },
            ],
            adjustments: [],
          },
        },
      },
    };
    render(createElement(page.component));
    fireEvent.click(screen.getByText("Source and adjustment attribution"));

    const sourceAttribution = screen.getByRole("table", {
      name: "Source transaction attribution",
    });
    const humanAdjustmentAttribution = screen.getByRole("table", {
      name: "Human adjustment attribution",
    });
    expect(
      sourceAttribution.classList.contains("tax-source-attribution-table"),
    ).toBe(true);
    expect(
      within(sourceAttribution)
        .getAllByRole("columnheader")
        .map((header) => header.textContent?.trim()),
    ).toEqual([
      "Transaction",
      "Target",
      "Direct income",
      "Direct expense",
      "Business income",
      "Business expense",
    ]);
    expect(
      humanAdjustmentAttribution.classList.contains(
        "tax-source-attribution-table",
      ),
    ).toBe(false);

    const table = screen.getByRole("table", {
      name: "Direct and Business shared allocation from the frozen review",
    });
    const partnerRow = within(table)
      .getByRole("rowheader", {
        name: "Synthetic partner",
      })
      .closest("tr")!;
    expect(
      within(partnerRow)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "100%",
      "10.00",
      "90.00",
      "100.00",
      "1.00",
      "9.00",
      "10.00",
      "90.00",
    ]);
    expect(screen.getByText("Business shared")).toBeTruthy();
    expect(screen.getByText("90.00", { selector: "strong" })).toBeTruthy();
  });
});
