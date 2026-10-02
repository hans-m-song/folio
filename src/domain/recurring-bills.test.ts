import { describe, expect, it } from "vitest";

import {
  buildRecurringBillViews,
  detectRecurringBillSuggestions,
  generateOccurrenceDates,
  isRecurringBillTransactionEligible,
  previewRecurringBillMatches,
  recurringBillScheduleInputSchema,
  recurringBillTransactionDate,
  reportingDateForInstant,
  type RecurringBillLink,
  type RecurringBillSchedule,
  type RecurringBillScheduleInput,
  type RecurringBillTransaction,
} from "./recurring-bills";

const schedule = (
  overrides: Partial<RecurringBillSchedule> = {},
): RecurringBillSchedule => ({
  id: "schedule-1",
  label: "Service Co",
  counterparty: "Service Co",
  descriptionMatchText: "cloud subscription",
  descriptionMatchMode: "contains",
  daysEarly: 3,
  daysLate: 3,
  documentCurrency: "USD",
  expectedAmount: "10.0000",
  frequency: "monthly",
  anchorDate: "2026-01-31",
  responsibleUserId: null,
  active: true,
  createdById: "user-1",
  updatedById: "user-1",
  createdAt: "2026-01-01T00:00:00.000000Z",
  updatedAt: "2026-01-01T00:00:00.000000Z",
  ...overrides,
});

const transaction = (
  overrides: Partial<RecurringBillTransaction> = {},
): RecurringBillTransaction => ({
  id: "transaction-1",
  kind: "supplier_expense",
  status: "recorded",
  counterparty: "Service Co",
  description: "Cloud subscription invoice",
  documentCurrency: "USD",
  documentAmount: "10.0000",
  invoiceDate: "2026-01-31",
  occurredAt: "2026-01-31T12:00:00.000Z",
  settledAt: null,
  ...overrides,
});

const scheduleInput = (
  overrides: Partial<RecurringBillScheduleInput> = {},
) => ({
  label: "Service Co",
  counterparty: "Service Co",
  documentCurrency: "USD",
  frequency: "monthly" as const,
  anchorDate: "2026-01-31",
  ...overrides,
});

const link = (
  overrides: Partial<RecurringBillLink> = {},
): RecurringBillLink => ({
  scheduleId: "schedule-1",
  expectedDate: "2026-01-31",
  transactionId: "transaction-1",
  createdById: "user-1",
  createdAt: "2026-02-01T00:00:00.000000Z",
  ...overrides,
});

describe("recurring bill calendar", () => {
  it("clamps monthly month ends from the original anchor", () => {
    expect(
      generateOccurrenceDates(
        schedule({ anchorDate: "2024-01-31" }),
        "2024-04-30",
        4,
      ),
    ).toEqual(["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"]);
  });

  it("restores the original leap day when the calendar reaches another leap year", () => {
    expect(
      generateOccurrenceDates(
        schedule({ frequency: "annual", anchorDate: "2024-02-29" }),
        "2028-02-29",
        5,
      ),
    ).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
  });

  it("rejects unbounded occurrence requests", () => {
    expect(() =>
      generateOccurrenceDates(schedule(), "2026-04-30", 1_201),
    ).toThrow(RangeError);
  });
});

describe("recurring bill transaction dates and eligibility", () => {
  it("converts instants in the reporting timezone", () => {
    expect(
      reportingDateForInstant("2026-03-31T14:30:00.000Z", "Australia/Brisbane"),
    ).toBe("2026-04-01");
  });

  it("prefers invoice date, then occurred date, then settlement date", () => {
    expect(
      recurringBillTransactionDate(
        transaction({
          invoiceDate: "2026-01-30",
          occurredAt: "2026-02-01T14:30:00.000Z",
          settledAt: "2026-02-02T14:30:00.000Z",
        }),
        "Australia/Brisbane",
      ),
    ).toBe("2026-01-30");
    expect(
      recurringBillTransactionDate(
        transaction({ invoiceDate: null }),
        "Australia/Brisbane",
      ),
    ).toBe("2026-01-31");
    expect(
      recurringBillTransactionDate(
        transaction({
          invoiceDate: null,
          occurredAt: null,
          settledAt: "2026-01-31T12:00:00.000Z",
        }),
        "Australia/Brisbane",
      ),
    ).toBe("2026-01-31");
  });

  it("uses conservative supplier, currency, description and three-day matching", () => {
    expect(
      isRecurringBillTransactionEligible(
        schedule(),
        "2026-01-31",
        transaction({
          counterparty: "  SERVICE   CO ",
          invoiceDate: "2026-02-03",
          description: "Cloud subscription annual plan",
        }),
        "Australia/Brisbane",
      ),
    ).toBe(true);
    expect(
      isRecurringBillTransactionEligible(
        schedule(),
        "2026-01-31",
        transaction({ invoiceDate: "2026-02-04" }),
        "Australia/Brisbane",
      ),
    ).toBe(false);
    expect(
      isRecurringBillTransactionEligible(
        schedule(),
        "2026-01-31",
        transaction({ kind: "sale" }),
        "Australia/Brisbane",
      ),
    ).toBe(false);
    expect(
      isRecurringBillTransactionEligible(
        schedule(),
        "2026-01-31",
        transaction({ status: "draft" }),
        "Australia/Brisbane",
      ),
    ).toBe(false);
    expect(
      isRecurringBillTransactionEligible(
        schedule(),
        "2026-01-31",
        transaction({ documentCurrency: "AUD" }),
        "Australia/Brisbane",
      ),
    ).toBe(false);
    expect(
      isRecurringBillTransactionEligible(
        schedule(),
        "2026-01-31",
        transaction({ description: "Unrelated service" }),
        "Australia/Brisbane",
      ),
    ).toBe(false);
  });

  it("applies independent inclusive early and late date windows", () => {
    const configuredSchedule = schedule({ daysEarly: 5, daysLate: 8 });

    expect(
      isRecurringBillTransactionEligible(
        configuredSchedule,
        "2026-01-31",
        transaction({ invoiceDate: "2026-01-26" }),
        "Australia/Brisbane",
      ),
    ).toBe(true);
    expect(
      isRecurringBillTransactionEligible(
        configuredSchedule,
        "2026-01-31",
        transaction({ invoiceDate: "2026-01-25" }),
        "Australia/Brisbane",
      ),
    ).toBe(false);
    expect(
      isRecurringBillTransactionEligible(
        configuredSchedule,
        "2026-01-31",
        transaction({ invoiceDate: "2026-02-08" }),
        "Australia/Brisbane",
      ),
    ).toBe(true);
    expect(
      isRecurringBillTransactionEligible(
        configuredSchedule,
        "2026-01-31",
        transaction({ invoiceDate: "2026-02-09" }),
        "Australia/Brisbane",
      ),
    ).toBe(false);
  });

  it("supports exact-date matching and monthly windows up to one year", () => {
    const exactDateSchedule = schedule({ daysEarly: 0, daysLate: 0 });
    expect(
      isRecurringBillTransactionEligible(
        exactDateSchedule,
        "2026-01-31",
        transaction({ invoiceDate: "2026-01-31" }),
        "Australia/Brisbane",
      ),
    ).toBe(true);
    expect(
      isRecurringBillTransactionEligible(
        exactDateSchedule,
        "2026-01-31",
        transaction({ invoiceDate: "2026-02-01" }),
        "Australia/Brisbane",
      ),
    ).toBe(false);

    const yearWindowSchedule = schedule({
      daysEarly: 365,
      daysLate: 365,
    });
    expect(
      isRecurringBillTransactionEligible(
        yearWindowSchedule,
        "2027-01-31",
        transaction({ invoiceDate: "2026-01-31" }),
        "Australia/Brisbane",
      ),
    ).toBe(true);
  });

  it("rejects a pre-anchor expected date as a linked occurrence", () => {
    expect(
      isRecurringBillTransactionEligible(
        schedule({
          anchorDate: "2026-08-13",
          daysEarly: 365,
          daysLate: 365,
        }),
        "2026-07-13",
        transaction({ invoiceDate: "2026-07-13" }),
        "Australia/Brisbane",
      ),
    ).toBe(false);
  });

  it("validates safe regex patterns and preserves literal contains behavior", () => {
    const regexSchedule = schedule({
      descriptionMatchMode: "regex",
      descriptionMatchText: "^  cloud\\s+subscription$",
    });
    expect(
      isRecurringBillTransactionEligible(
        regexSchedule,
        "2026-01-31",
        transaction({ description: "  CLOUD   subscription" }),
        "Australia/Brisbane",
      ),
    ).toBe(true);
    expect(
      isRecurringBillTransactionEligible(
        regexSchedule,
        "2026-01-31",
        transaction({ description: "cloud subscription" }),
        "Australia/Brisbane",
      ),
    ).toBe(false);

    const literalSchedule = schedule({
      descriptionMatchText: "cloud.*",
      descriptionMatchMode: "contains",
    });
    expect(
      isRecurringBillTransactionEligible(
        literalSchedule,
        "2026-01-31",
        transaction({ description: "Cloud.* invoice" }),
        "Australia/Brisbane",
      ),
    ).toBe(true);
    expect(
      isRecurringBillTransactionEligible(
        literalSchedule,
        "2026-01-31",
        transaction({ description: "Cloud subscription" }),
        "Australia/Brisbane",
      ),
    ).toBe(false);
  });

  it("invalidates a cached description matcher when a schedule rule changes", () => {
    const editableSchedule = schedule();
    expect(
      isRecurringBillTransactionEligible(
        editableSchedule,
        "2026-01-31",
        transaction(),
        "Australia/Brisbane",
      ),
    ).toBe(true);

    editableSchedule.descriptionMatchText = "^secure";
    editableSchedule.descriptionMatchMode = "regex";
    expect(
      isRecurringBillTransactionEligible(
        editableSchedule,
        "2026-01-31",
        transaction({ description: "Secure cloud plan" }),
        "Australia/Brisbane",
      ),
    ).toBe(true);
    expect(
      isRecurringBillTransactionEligible(
        editableSchedule,
        "2026-01-31",
        transaction(),
        "Australia/Brisbane",
      ),
    ).toBe(false);
  });
});

describe("recurring bill views", () => {
  it("preserves the oldest missing occurrence after later matches", () => {
    const view = buildRecurringBillViews({
      schedules: [schedule()],
      transactions: [transaction({ invoiceDate: "2026-02-28" })],
      links: [],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-04-30",
    })[0]!;

    expect(view.status).toBe("Due");
    expect(view.oldestPendingDate).toBe("2026-01-31");
    expect(view.pendingCount).toBe(1);
    expect(view.dueCount).toBe(2);
    expect(
      view.occurrences.find(
        ({ expectedDate }) => expectedDate === "2026-02-28",
      ),
    ).toMatchObject({
      isComplete: true,
      transactionId: "transaction-1",
      status: null,
    });
  });

  it("advances to the next anchored occurrence when a recorded bill arrives early", () => {
    const view = buildRecurringBillViews({
      schedules: [schedule()],
      transactions: [transaction({ invoiceDate: "2026-01-29" })],
      links: [],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-01-28",
    })[0]!;

    expect(view).toMatchObject({
      status: "Upcoming",
      nextExpectedDate: "2026-02-28",
      oldestPendingDate: null,
      pendingCount: 0,
    });
    expect(view.occurrences[0]).toMatchObject({
      expectedDate: "2026-01-31",
      isComplete: true,
      status: null,
    });
  });

  it("excludes historical transactions from active reminder occurrences", () => {
    const anchoredSchedule = schedule({ anchorDate: "2026-08-13" });
    const historicalTransactions = [
      "2026-01-13",
      "2026-02-13",
      "2026-03-13",
      "2026-04-13",
      "2026-05-13",
      "2026-06-13",
      "2026-07-13",
    ].map((invoiceDate) => transaction({ id: invoiceDate, invoiceDate }));
    const view = buildRecurringBillViews({
      schedules: [anchoredSchedule],
      transactions: historicalTransactions,
      links: [],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-08-13",
    })[0]!;

    expect(generateOccurrenceDates(anchoredSchedule, "2026-07-31", 24)).toEqual(
      [],
    );
    expect(view).toMatchObject({
      status: "Pending",
      nextExpectedDate: "2026-08-13",
      oldestPendingDate: "2026-08-13",
      pendingCount: 1,
      dueCount: 0,
      candidateTransactionIds: [],
    });
    const visibleDates = view.occurrences.map(
      ({ expectedDate }) => expectedDate,
    );
    expect(visibleDates[0]).toBe("2026-08-13");
    expect(visibleDates.every((date) => date >= "2026-08-13")).toBe(true);
  });

  it("hides pre-anchor linked occurrences and retains off-cadence links", () => {
    const anchoredSchedule = schedule({ anchorDate: "2026-08-13" });
    const view = buildRecurringBillViews({
      schedules: [anchoredSchedule],
      transactions: [
        transaction({ id: "historical", invoiceDate: "2026-07-13" }),
      ],
      links: [
        link({
          expectedDate: "2026-07-13",
          transactionId: "historical",
        }),
        link({
          expectedDate: "2026-09-14",
          transactionId: "off-cadence",
        }),
      ],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-08-13",
    })[0]!;

    expect(view).toMatchObject({
      status: "Pending",
      oldestPendingDate: "2026-08-13",
      pendingCount: 1,
      dueCount: 0,
    });
    expect(
      view.occurrences.map(({ expectedDate }) => expectedDate),
    ).not.toContain("2026-07-13");
    expect(
      view.occurrences.find(
        ({ expectedDate }) => expectedDate === "2026-09-14",
      ),
    ).toMatchObject({
      expectedDate: "2026-09-14",
      isScheduled: false,
      isComplete: false,
      association: {
        transactionId: "off-cadence",
        eligible: false,
        transaction: null,
      },
    });
    expect(
      view.occurrences.find(({ expectedDate }) => expectedDate === "2026-08-13")
        ?.isScheduled,
    ).toBe(true);
  });

  it("leaves multiple candidates unresolved until an explicit association", () => {
    const view = buildRecurringBillViews({
      schedules: [schedule()],
      transactions: [
        transaction({ id: "transaction-1" }),
        transaction({ id: "transaction-2" }),
      ],
      links: [],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-01-31",
    })[0]!;

    expect(view.status).toBe("Pending");
    expect(view.candidateTransactionIds).toEqual([
      "transaction-1",
      "transaction-2",
    ]);
    expect(view.occurrences[0]).toMatchObject({
      isComplete: false,
      status: "Pending",
    });
  });

  it("does not let a paused duplicate schedule make an active match ambiguous", () => {
    const active = schedule({ id: "active" });
    const paused = schedule({ id: "paused", active: false });
    const views = buildRecurringBillViews({
      schedules: [active, paused],
      transactions: [transaction()],
      links: [],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-01-31",
    });

    expect(
      views.find(({ schedule: item }) => item.id === "active")?.occurrences[0],
    ).toMatchObject({ isComplete: true, transactionId: "transaction-1" });
    expect(
      views.find(({ schedule: item }) => item.id === "paused")?.occurrences[0],
    ).toMatchObject({ isComplete: false, status: "Pending" });
  });

  it("keeps a transaction ambiguous across duplicate active schedules until explicitly linked", () => {
    const schedules = [
      schedule({ id: "schedule-1" }),
      schedule({ id: "schedule-2" }),
    ];
    const automaticViews = buildRecurringBillViews({
      schedules,
      transactions: [transaction()],
      links: [],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-01-31",
    });

    expect(automaticViews).toHaveLength(2);
    for (const view of automaticViews) {
      expect(view.occurrences[0]).toMatchObject({
        isComplete: false,
        status: "Pending",
        candidates: [{ id: "transaction-1" }],
      });
    }

    const linkedViews = buildRecurringBillViews({
      schedules,
      transactions: [transaction()],
      links: [link({ scheduleId: "schedule-1" })],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-01-31",
    });

    expect(linkedViews[0]?.occurrences[0]).toMatchObject({
      isComplete: true,
      transactionId: "transaction-1",
      association: { transactionId: "transaction-1", eligible: true },
    });
    expect(linkedViews[1]?.occurrences[0]).toMatchObject({
      isComplete: false,
      status: "Pending",
      candidates: [],
      association: null,
    });
  });

  it("reopens an ineligible stored association and keeps it unlinkable", () => {
    const view = buildRecurringBillViews({
      schedules: [schedule()],
      transactions: [transaction({ status: "void" })],
      links: [link()],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-01-31",
    })[0]!;

    expect(view.occurrences[0]).toMatchObject({
      isComplete: false,
      transactionId: null,
      association: {
        transactionId: "transaction-1",
        eligible: false,
        transaction: { id: "transaction-1" },
      },
    });
  });

  it("does not automatically reuse an explicitly reserved transaction", () => {
    const active = schedule({ id: "active" });
    const paused = schedule({ id: "paused", active: false });
    const views = buildRecurringBillViews({
      schedules: [active, paused],
      transactions: [transaction()],
      links: [link({ scheduleId: "paused" })],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-01-31",
    });

    expect(
      views.find(({ schedule: item }) => item.id === "active")?.occurrences[0],
    ).toMatchObject({ isComplete: false, status: "Pending" });
  });

  it("keeps expected occurrences in the grace window pending through its last day", () => {
    const pendingView = buildRecurringBillViews({
      schedules: [schedule({ daysLate: 3 })],
      transactions: [],
      links: [],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-02-03",
    })[0]!;
    expect(pendingView).toMatchObject({
      status: "Pending",
      oldestPendingDate: "2026-01-31",
      pendingCount: 1,
      dueCount: 0,
    });

    const dueView = buildRecurringBillViews({
      schedules: [schedule({ daysLate: 3 })],
      transactions: [],
      links: [],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-02-04",
    })[0]!;
    expect(dueView).toMatchObject({
      status: "Due",
      oldestPendingDate: "2026-01-31",
      pendingCount: 0,
      dueCount: 1,
    });
    expect(dueView.occurrences[0]?.status).toBe("Due");
  });

  it("treats zero late days as pending on the expected date and due the next day", () => {
    const atExpectedDate = buildRecurringBillViews({
      schedules: [schedule({ daysLate: 0 })],
      transactions: [],
      links: [],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-01-31",
    })[0]!;
    expect(atExpectedDate).toMatchObject({
      status: "Pending",
      pendingCount: 1,
      dueCount: 0,
    });

    const followingDay = buildRecurringBillViews({
      schedules: [schedule({ daysLate: 0 })],
      transactions: [],
      links: [],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-02-01",
    })[0]!;
    expect(followingDay).toMatchObject({
      status: "Due",
      pendingCount: 0,
      dueCount: 1,
    });
  });

  it("recomputes outstanding history after an anchor and cadence edit", () => {
    const originalView = buildRecurringBillViews({
      schedules: [schedule()],
      transactions: [],
      links: [],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-04-30",
    })[0]!;
    const editedView = buildRecurringBillViews({
      schedules: [schedule({ anchorDate: "2026-02-15", frequency: "annual" })],
      transactions: [],
      links: [],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-04-30",
    })[0]!;

    expect(originalView).toMatchObject({ pendingCount: 1, dueCount: 3 });
    expect(editedView).toMatchObject({
      oldestPendingDate: "2026-02-15",
      pendingCount: 0,
      dueCount: 1,
    });
  });

  it("counts due occurrences across the full anchored history outside the visible window", () => {
    const view = buildRecurringBillViews({
      schedules: [schedule({ anchorDate: "0001-01-01" })],
      transactions: [],
      links: [],
      timeZone: "Australia/Brisbane",
      asOfDate: "9999-12-31",
      maxOccurrences: 24,
    })[0]!;

    expect(view).toMatchObject({
      status: "Due",
      oldestPendingDate: "0001-01-01",
      pendingCount: 0,
      dueCount: 119_988,
    });
    expect(view.occurrences).toHaveLength(24);
    expect(view.nextUnresolvedOffset).toBe(24);
  });

  it("pages oldest missing occurrences without skipping leap-month dates", () => {
    const page = (unresolvedOffset: number) =>
      buildRecurringBillViews({
        schedules: [schedule({ anchorDate: "2024-01-31" })],
        transactions: [],
        links: [],
        timeZone: "Australia/Brisbane",
        asOfDate: "2024-04-30",
        maxOccurrences: 2,
        unresolvedOffset,
      })[0]!;

    const firstPage = page(0);
    expect(
      firstPage.occurrences.map(({ expectedDate }) => expectedDate),
    ).toEqual(["2024-01-31", "2024-02-29", "2024-05-31"]);
    expect(firstPage.nextUnresolvedOffset).toBe(2);

    const secondPage = page(2);
    expect(
      secondPage.occurrences.map(({ expectedDate }) => expectedDate),
    ).toEqual(["2024-03-31", "2024-04-30", "2024-05-31"]);
    expect(secondPage.nextUnresolvedOffset).toBeNull();
  });

  it("pages unresolved occurrences across completed-index gaps", () => {
    const page = (unresolvedOffset: number) =>
      buildRecurringBillViews({
        schedules: [schedule({ anchorDate: "2024-01-31" })],
        transactions: [
          transaction({ id: "jan", invoiceDate: "2024-01-31" }),
          transaction({ id: "mar", invoiceDate: "2024-03-31" }),
        ],
        links: [],
        timeZone: "Australia/Brisbane",
        asOfDate: "2024-05-31",
        maxOccurrences: 2,
        unresolvedOffset,
      })[0]!;

    const firstPage = page(0);
    expect(
      firstPage.occurrences
        .filter(({ status }) => status === "Due" || status === "Pending")
        .map(({ expectedDate }) => expectedDate),
    ).toEqual(["2024-02-29", "2024-04-30"]);
    expect(firstPage.nextUnresolvedOffset).toBe(2);

    const secondPage = page(2);
    expect(
      secondPage.occurrences
        .filter(({ status }) => status === "Due" || status === "Pending")
        .map(({ expectedDate }) => expectedDate),
    ).toEqual(["2024-05-31"]);
    expect(secondPage.nextUnresolvedOffset).toBeNull();
  });

  it("rejects invalid unresolved offsets even when there are no schedules", () => {
    expect(() =>
      buildRecurringBillViews({
        schedules: [],
        transactions: [],
        links: [],
        timeZone: "Australia/Brisbane",
        asOfDate: "2026-01-01",
        unresolvedOffset: 120_001,
      }),
    ).toThrow(RangeError);
  });
});

describe("recurring bill match previews", () => {
  it("reports description and date results separately in deterministic date order", () => {
    const preview = previewRecurringBillMatches({
      schedule: recurringBillScheduleInputSchema.parse(
        scheduleInput({
          descriptionMatchMode: "regex",
          descriptionMatchText: "^cloud\\s+subscription$",
        }),
      ),
      transactions: [
        transaction({
          id: "missing-date",
          description: "Cloud subscription",
          invoiceDate: null,
          occurredAt: null,
          settledAt: null,
        }),
        transaction({
          id: "misaligned",
          description: "Cloud subscription",
          invoiceDate: "2026-02-15",
        }),
        transaction({
          id: "mismatch",
          description: "Storage",
          invoiceDate: "2026-01-31",
        }),
        transaction({
          id: "aligned",
          description: "CLOUD subscription",
          invoiceDate: "2026-01-31",
        }),
        transaction({ id: "other-supplier", counterparty: "Other Co" }),
        transaction({ id: "draft", status: "draft" }),
        transaction({ id: "sale", kind: "sale" }),
      ],
      timeZone: "Australia/Brisbane",
    });

    expect(preview).toMatchObject({
      descriptionMatchCount: 3,
      onCadenceCount: 1,
      misalignedCount: 2,
      ambiguousCount: 0,
      rows: [
        {
          transactionId: "aligned",
          date: "2026-01-31",
          descriptionMatches: true,
          expectedDate: "2026-01-31",
          dayOffset: 0,
          result: "aligned",
        },
        {
          transactionId: "mismatch",
          descriptionMatches: false,
          result: "description_mismatch",
        },
        {
          transactionId: "misaligned",
          date: "2026-02-15",
          descriptionMatches: true,
          expectedDate: "2026-02-28",
          dayOffset: -13,
          result: "misaligned",
        },
        {
          transactionId: "missing-date",
          date: null,
          descriptionMatches: true,
          expectedDate: null,
          dayOffset: null,
          result: "missing_date",
        },
      ],
    });
  });

  it("reports ambiguity across multiple candidate occurrences and transactions", () => {
    const preview = previewRecurringBillMatches({
      schedule: schedule({ daysEarly: 365, daysLate: 365 }),
      transactions: [
        transaction({ id: "second" }),
        transaction({ id: "first" }),
      ],
      timeZone: "Australia/Brisbane",
    });

    expect(preview).toMatchObject({
      descriptionMatchCount: 2,
      onCadenceCount: 2,
      misalignedCount: 0,
      ambiguousCount: 2,
      rows: [
        {
          transactionId: "first",
          expectedDate: "2026-01-31",
          dayOffset: 0,
          result: "ambiguous",
        },
        { transactionId: "second", result: "ambiguous" },
      ],
    });
  });

  it("shows the nearest occurrence among directional-window matches", () => {
    const preview = previewRecurringBillMatches({
      schedule: schedule({
        anchorDate: "2026-03-01",
        daysEarly: 0,
        daysLate: 30,
      }),
      transactions: [transaction({ invoiceDate: "2026-03-25" })],
      timeZone: "Australia/Brisbane",
    });

    expect(preview.rows[0]).toMatchObject({
      expectedDate: "2026-03-01",
      dayOffset: 24,
      result: "aligned",
    });
  });

  it("previews monthly historical dates before an August anchor", () => {
    const dates = [
      "2026-01-13",
      "2026-02-13",
      "2026-03-13",
      "2026-04-13",
      "2026-05-13",
      "2026-06-13",
      "2026-07-13",
      "2026-08-13",
    ];
    const preview = previewRecurringBillMatches({
      schedule: schedule({ anchorDate: "2026-08-13" }),
      transactions: dates.map((invoiceDate) =>
        transaction({ id: invoiceDate, invoiceDate }),
      ),
      timeZone: "Australia/Brisbane",
    });

    expect(preview).toMatchObject({
      descriptionMatchCount: 8,
      onCadenceCount: 8,
      misalignedCount: 0,
      ambiguousCount: 0,
    });
    expect(
      preview.rows.map(({ date, expectedDate, result }) => [
        date,
        expectedDate,
        result,
      ]),
    ).toEqual(dates.map((date) => [date, date, "aligned"]));
  });

  it("previews historical annual dates with leap-day clamping", () => {
    const dates = [
      "2020-02-29",
      "2021-02-28",
      "2022-02-28",
      "2023-02-28",
      "2024-02-29",
    ];
    const preview = previewRecurringBillMatches({
      schedule: schedule({
        anchorDate: "2024-02-29",
        frequency: "annual",
      }),
      transactions: dates.map((invoiceDate) =>
        transaction({ id: invoiceDate, invoiceDate }),
      ),
      timeZone: "Australia/Brisbane",
    });

    expect(preview.onCadenceCount).toBe(5);
    expect(
      preview.rows.map(({ expectedDate, result }) => [expectedDate, result]),
    ).toEqual(dates.map((date) => [date, "aligned"]));
  });

  it("previews historical monthly dates with original month-end clamping", () => {
    const dates = [
      "2024-01-31",
      "2024-02-29",
      "2024-03-31",
      "2024-04-30",
      "2024-05-31",
    ];
    const preview = previewRecurringBillMatches({
      schedule: schedule({ anchorDate: "2024-05-31" }),
      transactions: dates.map((invoiceDate) =>
        transaction({ id: invoiceDate, invoiceDate }),
      ),
      timeZone: "Australia/Brisbane",
    });

    expect(preview.onCadenceCount).toBe(5);
    expect(
      preview.rows.map(({ expectedDate, result }) => [expectedDate, result]),
    ).toEqual(dates.map((date) => [date, "aligned"]));
  });

  it("applies directional windows to a historical expected date", () => {
    const preview = previewRecurringBillMatches({
      schedule: schedule({
        anchorDate: "2026-08-13",
        daysEarly: 1,
        daysLate: 0,
      }),
      transactions: [transaction({ invoiceDate: "2026-07-12" })],
      timeZone: "Australia/Brisbane",
    });

    expect(preview.rows[0]).toMatchObject({
      date: "2026-07-12",
      expectedDate: "2026-07-13",
      dayOffset: -1,
      result: "aligned",
    });
  });

  it("does not generate historical preview dates before year 0001", () => {
    const preview = previewRecurringBillMatches({
      schedule: schedule({ anchorDate: "0001-01-01" }),
      transactions: [transaction({ invoiceDate: "0001-01-01" })],
      timeZone: "Australia/Brisbane",
    });

    expect(preview.rows[0]).toMatchObject({
      date: "0001-01-01",
      expectedDate: "0001-01-01",
      dayOffset: 0,
      result: "aligned",
    });
  });

  it("estimates amounts from unique valid aligned history with direct cent rounding", () => {
    const anchoredSchedule = schedule({ anchorDate: "2026-01-31" });
    const transactions = [
      transaction({
        id: "jan",
        invoiceDate: "2026-01-31",
        documentAmount: "1.0049",
      }),
      transaction({
        id: "feb",
        invoiceDate: "2026-02-28",
        documentAmount: "1.0049",
      }),
      transaction({
        id: "mar",
        invoiceDate: "2026-03-31",
        documentAmount: "1.0050",
      }),
      transaction({
        id: "apr",
        invoiceDate: "2026-04-30",
        documentAmount: "1.0050",
      }),
      transaction({
        id: "may",
        invoiceDate: "2026-05-31",
        documentAmount: "1.0050",
      }),
      transaction({
        id: "negative",
        invoiceDate: "2026-06-30",
        documentAmount: "-1.0000",
      }),
      transaction({
        id: "too-many-decimals",
        invoiceDate: "2026-07-31",
        documentAmount: "1.12345",
      }),
      transaction({
        id: "too-many-integer-digits",
        invoiceDate: "2026-08-31",
        documentAmount: "1000000000000000.0000",
      }),
      transaction({
        id: "missing-amount",
        invoiceDate: "2026-09-30",
        documentAmount: null,
      }),
      transaction({
        id: "future",
        invoiceDate: "2026-10-31",
        documentAmount: "100.0000",
      }),
      transaction({
        id: "ambiguous-one",
        invoiceDate: "2026-11-30",
        documentAmount: "50.0000",
      }),
      transaction({
        id: "ambiguous-two",
        invoiceDate: "2026-11-30",
        documentAmount: "60.0000",
      }),
      transaction({
        id: "missing-date",
        invoiceDate: null,
        occurredAt: null,
        settledAt: null,
        documentAmount: "70.0000",
      }),
      transaction({
        id: "invalid-date",
        invoiceDate: "2026-02-30",
        documentAmount: "80.0000",
      }),
      transaction({
        id: "different-currency",
        invoiceDate: "2026-10-31",
        documentCurrency: "AUD",
        documentAmount: "90.0000",
      }),
    ];

    const preview = previewRecurringBillMatches({
      schedule: anchoredSchedule,
      transactions,
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-09-30",
    });
    expect(preview.amountEstimate).toEqual({
      count: 5,
      minimum: "1.0049",
      maximum: "1.0050",
      average: "1.0000",
    });
    expect(preview.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transactionId: "future",
          result: "aligned",
        }),
        expect.objectContaining({
          transactionId: "ambiguous-one",
          result: "ambiguous",
        }),
        expect.objectContaining({
          transactionId: "ambiguous-two",
          result: "ambiguous",
        }),
        expect.objectContaining({
          transactionId: "missing-date",
          result: "missing_date",
        }),
        expect.objectContaining({
          transactionId: "invalid-date",
          date: null,
          result: "missing_date",
        }),
      ]),
    );

    const unrestrictedPreview = previewRecurringBillMatches({
      schedule: anchoredSchedule,
      transactions,
      timeZone: "Australia/Brisbane",
    });
    expect(unrestrictedPreview.amountEstimate?.count).toBe(6);

    const view = buildRecurringBillViews({
      schedules: [anchoredSchedule],
      transactions,
      links: [],
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-09-30",
    })[0]!;
    expect(view.amountEstimate).toEqual(preview.amountEstimate);

    const halfCentPreview = previewRecurringBillMatches({
      schedule: anchoredSchedule,
      transactions: [
        transaction({
          id: "one-dollar",
          invoiceDate: "2026-01-31",
          documentAmount: "1.0000",
        }),
        transaction({
          id: "one-dollar-one-cent",
          invoiceDate: "2026-02-28",
          documentAmount: "1.0100",
        }),
      ],
      timeZone: "Australia/Brisbane",
    });
    expect(halfCentPreview.amountEstimate?.average).toBe("1.0100");
  });

  it("returns no amount estimate without valid unique aligned amounts", () => {
    const preview = previewRecurringBillMatches({
      schedule: schedule(),
      transactions: [
        transaction({ documentAmount: null }),
        transaction({ id: "ambiguous", documentAmount: "1.0000" }),
      ],
      timeZone: "Australia/Brisbane",
    });

    expect(preview.amountEstimate).toBeNull();
  });

  it("rejects an invalid preview as-of date", () => {
    expect(() =>
      previewRecurringBillMatches({
        schedule: schedule(),
        transactions: [],
        timeZone: "Australia/Brisbane",
        asOfDate: "2026-02-30",
      }),
    ).toThrow("Invalid recurring bill preview as-of date");
  });
});

describe("recurring bill suggestions", () => {
  it("requires three monthly source records and preserves the original month end", () => {
    const suggestions = detectRecurringBillSuggestions(
      [
        transaction({
          id: "jan",
          invoiceDate: "2026-01-31",
          documentAmount: "9.0000",
        }),
        transaction({
          id: "feb",
          invoiceDate: "2026-02-28",
          documentAmount: "10.0000",
        }),
        transaction({
          id: "mar",
          invoiceDate: "2026-03-31",
          documentAmount: "100.0000",
        }),
        transaction({
          id: "draft",
          status: "draft",
          invoiceDate: "2026-04-30",
        }),
      ],
      "Australia/Brisbane",
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      schedule: {
        frequency: "monthly",
        anchorDate: "2026-01-31",
        expectedAmount: "10.0000",
      },
      sourceTransactionIds: ["jan", "feb", "mar"],
      occurrenceDates: ["2026-01-31", "2026-02-28", "2026-03-31"],
      supportCount: 3,
    });
  });

  it("requires two annual source records", () => {
    const suggestions = detectRecurringBillSuggestions(
      [
        transaction({ id: "year-1", invoiceDate: "2024-02-29" }),
        transaction({ id: "year-2", invoiceDate: "2025-02-28" }),
      ],
      "Australia/Brisbane",
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      schedule: { frequency: "annual", anchorDate: "2024-02-29" },
      sourceTransactionIds: ["year-1", "year-2"],
      supportCount: 2,
    });
  });

  it("normalizes optional description text to null", () => {
    expect(
      recurringBillScheduleInputSchema.parse({
        ...scheduleInput(),
        descriptionMatchText: "   ",
      }).descriptionMatchText,
    ).toBeNull();
  });

  it("defaults description mode and date windows while keeping contains text literal", () => {
    const parsed = recurringBillScheduleInputSchema.parse(
      scheduleInput({ descriptionMatchText: "  cloud.*  " }),
    );

    expect(parsed).toMatchObject({
      descriptionMatchText: "cloud.*",
      descriptionMatchMode: "contains",
      daysEarly: 3,
      daysLate: 3,
    });
    expect(
      recurringBillScheduleInputSchema.safeParse(
        scheduleInput({ daysEarly: 366 }),
      ).success,
    ).toBe(false);
    expect(
      recurringBillScheduleInputSchema.safeParse(
        scheduleInput({ daysLate: 1.5 }),
      ).success,
    ).toBe(false);
  });

  it("validates RE2JS syntax and preserves whitespace in nonblank regex patterns", () => {
    expect(
      recurringBillScheduleInputSchema.safeParse(
        scheduleInput({
          descriptionMatchMode: "regex",
          descriptionMatchText: "(?=cloud)",
        }),
      ).success,
    ).toBe(false);
    expect(
      recurringBillScheduleInputSchema.safeParse(
        scheduleInput({
          descriptionMatchMode: "regex",
          descriptionMatchText: "a".repeat(2_001),
        }),
      ).success,
    ).toBe(false);

    expect(
      recurringBillScheduleInputSchema.parse(
        scheduleInput({
          descriptionMatchMode: "regex",
          descriptionMatchText: "^  cloud$",
        }),
      ).descriptionMatchText,
    ).toBe("^  cloud$");
    expect(
      recurringBillScheduleInputSchema.parse(
        scheduleInput({
          descriptionMatchMode: "regex",
          descriptionMatchText: "   ",
        }),
      ).descriptionMatchText,
    ).toBeNull();
  });

  it("treats a whitespace-only regex as no description filter", () => {
    const parsed = recurringBillScheduleInputSchema.parse(
      scheduleInput({
        descriptionMatchMode: "regex",
        descriptionMatchText: " \t \n ",
      }),
    );

    expect(parsed.descriptionMatchText).toBeNull();
    expect(
      isRecurringBillTransactionEligible(
        parsed,
        "2026-01-31",
        transaction({ description: "Any supplier description" }),
        "Australia/Brisbane",
      ),
    ).toBe(true);
  });

  it("accepts 365-day matching windows and rejects 366", () => {
    expect(
      recurringBillScheduleInputSchema.parse(
        scheduleInput({ daysEarly: 365, daysLate: 365 }),
      ),
    ).toMatchObject({ daysEarly: 365, daysLate: 365 });
    expect(
      recurringBillScheduleInputSchema.safeParse(
        scheduleInput({ daysEarly: 366 }),
      ).success,
    ).toBe(false);
    expect(
      recurringBillScheduleInputSchema.safeParse(
        scheduleInput({ daysLate: 366 }),
      ).success,
    ).toBe(false);
  });
});
