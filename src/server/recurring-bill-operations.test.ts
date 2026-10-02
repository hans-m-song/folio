import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({
  authConfig: { sessionCookieName: "folio_session" },
  config: { reportingTimezone: "Australia/Brisbane" },
  auth: { session: vi.fn() },
  repository: {
    getTransaction: vi.fn(),
    listEntrySuggestions: vi.fn(),
  },
  recurringBillRepository: {
    list: vi.fn(),
    suggest: vi.fn(),
    listResponsibleUserOptions: vi.fn(),
    preview: vi.fn(),
    save: vi.fn(),
    setActive: vi.fn(),
    linkOccurrence: vi.fn(),
    unlinkOccurrence: vi.fn(),
  },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: vi.fn().mockReturnValue("synthetic-session"),
  setResponseStatus: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: { parse(value: unknown): unknown } | undefined;
    const builder = {
      validator(schema: { parse(value: unknown): unknown }) {
        validator = schema;
        return builder;
      },
      handler(callback: (input: { data: unknown }) => Promise<unknown>) {
        return (input: { data?: unknown } = {}) =>
          callback({ data: validator?.parse(input.data) });
      },
    };
    return builder;
  },
}));

vi.mock("./runtime", () => ({ runtime: () => current }));

import {
  getRecurringBillAttention,
  getRecurringBillsWorkspace,
  previewRecurringBill,
  linkRecurringBillTransaction,
  saveRecurringBill,
  setRecurringBillActive,
  unlinkRecurringBillTransaction,
} from "./recurring-bill-operations";

const actorId = "11111111-1111-4111-8111-111111111111";
const scheduleId = "22222222-2222-4222-8222-222222222222";
const transactionId = "33333333-3333-4333-8333-333333333333";
const revision = "2026-10-01T00:00:00.123456Z";
const schedule = {
  label: "Synthetic hosting",
  counterparty: "Synthetic provider",
  descriptionMatchText: null,
  descriptionMatchMode: "contains" as const,
  daysEarly: 3,
  daysLate: 3,
  documentCurrency: "USD",
  expectedAmount: null,
  frequency: "monthly" as const,
  anchorDate: "2026-09-01",
  responsibleUserId: null,
};
const association = {
  scheduleId,
  expectedDate: "2026-10-01",
  expectedUpdatedAt: revision,
};

describe("in-app recurring bill operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current.repository.getTransaction.mockResolvedValue(null);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T14:30:00.000Z"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    current.auth.session.mockResolvedValue({ id: actorId, role: "member" });
    current.repository.listEntrySuggestions.mockResolvedValue({
      counterparties: [],
      categories: [],
      supplierCategories: [],
    });
    current.recurringBillRepository.list.mockResolvedValue([]);
    current.recurringBillRepository.suggest.mockResolvedValue([]);
    current.recurringBillRepository.listResponsibleUserOptions.mockResolvedValue(
      [],
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses the configured local date and counts active missing occurrences by grace state", async () => {
    const views = [
      {
        schedule: { active: true },
        status: "Due",
        pendingCount: 3,
        dueCount: 4,
      },
      {
        schedule: { active: true },
        status: "Upcoming",
        pendingCount: 0,
        dueCount: 0,
      },
      {
        schedule: { active: false },
        status: "Pending",
        pendingCount: 2,
        dueCount: 5,
      },
    ];
    current.recurringBillRepository.list.mockResolvedValue(views);
    await expect(getRecurringBillAttention()).resolves.toEqual({
      count: 7,
      pendingCount: 3,
      dueCount: 4,
    });
    expect(current.recurringBillRepository.list).toHaveBeenCalledWith(actorId, {
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-10-02",
    });
    expect(current.recurringBillRepository.suggest).not.toHaveBeenCalled();
    expect(current.recurringBillRepository.save).not.toHaveBeenCalled();
    expect(
      current.recurringBillRepository.linkOccurrence,
    ).not.toHaveBeenCalled();
  });

  it("loads schedules, suggestions and actor-scoped workspace options", async () => {
    const options = [{ id: actorId, label: "Synthetic operator" }];
    const counterparties = ["Synthetic provider", "Saved supplier"];
    current.recurringBillRepository.listResponsibleUserOptions.mockResolvedValue(
      options,
    );
    current.repository.listEntrySuggestions.mockResolvedValue({
      counterparties,
      categories: ["Unused category"],
      supplierCategories: [],
    });
    await expect(getRecurringBillsWorkspace()).resolves.toEqual({
      schedules: [],
      suggestions: [],
      responsibleUserOptions: options,
      counterparties,
      attention: { count: 0, pendingCount: 0, dueCount: 0 },
      currentActorId: actorId,
      reportingTimezone: "Australia/Brisbane",
      initialSchedule: null,
    });
    expect(current.recurringBillRepository.suggest).toHaveBeenCalledWith(
      actorId,
      {
        timeZone: "Australia/Brisbane",
      },
    );
    expect(current.repository.listEntrySuggestions).toHaveBeenCalledWith(
      actorId,
    );
  });

  it("passes validated missing-history offsets without accepting caller context", async () => {
    await getRecurringBillsWorkspace({ data: { unresolvedOffset: 24 } });
    expect(current.recurringBillRepository.list).toHaveBeenCalledWith(actorId, {
      timeZone: "Australia/Brisbane",
      asOfDate: "2026-10-02",
      unresolvedOffset: 24,
    });
    for (const unresolvedOffset of [-1, 0.5, 120_001]) {
      expect(() =>
        getRecurringBillsWorkspace({ data: { unresolvedOffset } }),
      ).toThrow();
    }
    expect(() =>
      getRecurringBillsWorkspace({
        data: { unresolvedOffset: 24, asOfDate: "2026-01-01" },
      } as never),
    ).toThrow();
    expect(current.recurringBillRepository.save).not.toHaveBeenCalled();
  });

  it("prefills an editable schedule from an authorised recorded expense without activating it", async () => {
    current.repository.getTransaction.mockResolvedValue({
      id: transactionId,
      kind: "supplier_expense",
      status: "recorded",
      counterparty: "Synthetic provider",
      description: "Synthetic hosting",
      documentCurrency: "USD",
      documentAmount: "35.0000",
      invoiceDate: "2026-08-31",
      occurredAt: "2026-09-02T00:00:00.000Z",
      settledAt: "2026-09-03T00:00:00.000Z",
    });
    const workspace = await getRecurringBillsWorkspace({
      data: { sourceTransactionId: transactionId },
    });
    expect(current.repository.getTransaction).toHaveBeenCalledWith(
      actorId,
      transactionId,
    );
    expect(workspace.initialSchedule).toEqual({
      label: "Synthetic provider",
      counterparty: "Synthetic provider",
      descriptionMatchText: "Synthetic hosting",
      descriptionMatchMode: "contains",
      daysEarly: 3,
      daysLate: 3,
      documentCurrency: "USD",
      expectedAmount: "35.0000",
      frequency: "monthly",
      anchorDate: "2026-08-31",
      responsibleUserId: actorId,
    });
    expect(current.recurringBillRepository.save).not.toHaveBeenCalled();
    expect(
      current.recurringBillRepository.linkOccurrence,
    ).not.toHaveBeenCalled();
  });

  it.each(["draft", "void"])(
    "does not seed from a %s expense",
    async (status) => {
      current.repository.getTransaction.mockResolvedValue({
        kind: "supplier_expense",
        status,
      });
      const workspace = await getRecurringBillsWorkspace({
        data: { sourceTransactionId: transactionId },
      });
      expect(workspace.initialSchedule).toBeNull();
      expect(current.recurringBillRepository.save).not.toHaveBeenCalled();
    },
  );

  it("previews rules read-only using the session actor and configured timezone", async () => {
    const preview = {
      descriptionMatchCount: 2,
      onCadenceCount: 1,
      misalignedCount: 1,
      ambiguousCount: 0,
      rows: [],
    };
    current.recurringBillRepository.preview.mockResolvedValue(preview);
    await expect(previewRecurringBill({ data: { schedule } })).resolves.toEqual(
      preview,
    );
    expect(current.recurringBillRepository.preview).toHaveBeenCalledWith(
      actorId,
      {
        schedule,
        timeZone: "Australia/Brisbane",
        asOfDate: "2026-10-02",
      },
    );
    expect(current.recurringBillRepository.save).not.toHaveBeenCalled();
    expect(
      current.recurringBillRepository.linkOccurrence,
    ).not.toHaveBeenCalled();
  });

  it("rejects injected preview context and invalid regex without repository access", () => {
    expect(() =>
      previewRecurringBill({ data: { schedule, timeZone: "UTC" } } as never),
    ).toThrow();
    expect(() =>
      previewRecurringBill({
        data: {
          schedule: {
            ...schedule,
            descriptionMatchMode: "regex",
            descriptionMatchText: "[",
          },
        },
      }),
    ).toThrow();
    expect(current.recurringBillRepository.preview).not.toHaveBeenCalled();
  });

  it("uses the trusted session actor for confirmed creation and revision-bearing edits", async () => {
    await saveRecurringBill({ data: { schedule } });
    expect(current.recurringBillRepository.save).toHaveBeenCalledWith(actorId, {
      schedule,
    });
    await saveRecurringBill({
      data: { id: scheduleId, expectedUpdatedAt: revision, schedule },
    });
    expect(current.recurringBillRepository.save).toHaveBeenLastCalledWith(
      actorId,
      {
        id: scheduleId,
        expectedUpdatedAt: revision,
        schedule,
      },
    );
    await setRecurringBillActive({
      data: { id: scheduleId, active: false, expectedUpdatedAt: revision },
    });
    expect(current.recurringBillRepository.setActive).toHaveBeenCalledWith(
      actorId,
      {
        id: scheduleId,
        active: false,
        expectedUpdatedAt: revision,
      },
    );
  });

  it("passes only configured timezone to association eligibility checks", async () => {
    await linkRecurringBillTransaction({
      data: { ...association, transactionId },
    });
    expect(current.recurringBillRepository.linkOccurrence).toHaveBeenCalledWith(
      actorId,
      {
        ...association,
        transactionId,
        timeZone: "Australia/Brisbane",
      },
    );
    await expect(
      unlinkRecurringBillTransaction({ data: association }),
    ).resolves.toEqual({ unlinked: true });
    expect(
      current.recurringBillRepository.unlinkOccurrence,
    ).toHaveBeenCalledWith(actorId, association);
  });

  it("rejects spoofed actors/timezones and updates without paired revisions", () => {
    expect(() =>
      saveRecurringBill({ data: { schedule, actorId } } as never),
    ).toThrow();
    expect(() =>
      saveRecurringBill({ data: { schedule, id: scheduleId } } as never),
    ).toThrow();
    expect(() =>
      saveRecurringBill({
        data: { schedule, expectedUpdatedAt: revision },
      } as never),
    ).toThrow();
    expect(() =>
      linkRecurringBillTransaction({
        data: {
          ...association,
          transactionId,
          timeZone: "UTC",
        },
      } as never),
    ).toThrow();
    expect(current.recurringBillRepository.save).not.toHaveBeenCalled();
    expect(
      current.recurringBillRepository.linkOccurrence,
    ).not.toHaveBeenCalled();
  });

  it.each(["unauthenticated", "viewer"])(
    "denies every operation before repository access for %s",
    async (mode) => {
      current.auth.session.mockResolvedValue(
        mode === "viewer" ? { id: actorId, role: "viewer" } : null,
      );
      const calls = [
        () => getRecurringBillsWorkspace(),
        () => getRecurringBillAttention(),
        () => previewRecurringBill({ data: { schedule } }),
        () => saveRecurringBill({ data: { schedule } }),
        () =>
          setRecurringBillActive({
            data: { id: scheduleId, active: true, expectedUpdatedAt: revision },
          }),
        () =>
          linkRecurringBillTransaction({
            data: { ...association, transactionId },
          }),
        () => unlinkRecurringBillTransaction({ data: association }),
      ];
      for (const call of calls)
        await expect(call()).rejects.toThrow(
          mode === "viewer" ? "Code PERMISSION_DENIED" : "Code UNAUTHENTICATED",
        );
      for (const method of Object.values(current.recurringBillRepository))
        expect(method).not.toHaveBeenCalled();
      expect(current.repository.getTransaction).not.toHaveBeenCalled();
    },
  );
});
