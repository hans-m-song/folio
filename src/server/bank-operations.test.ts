import { beforeEach, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({
  authConfig: { sessionCookieName: "folio_session" },
  auth: { session: vi.fn() },
  repository: {
    getArtifact: vi.fn(),
    findCsvDuplicateWarnings: vi.fn(),
    listUsers: vi.fn(),
    listEntrySuggestions: vi.fn(),
    listAvailableInvoiceArtifacts: vi.fn(),
  },
  bankRepository: {
    listImports: vi.fn(),
    listTransactions: vi.fn(),
    reconciliationCounts: vi.fn(),
    nextReconciliationTarget: vi.fn(),
  },
  proposalRepository: { listSuggestionsForBankRow: vi.fn() },
  documents: { readReviewText: vi.fn() },
  config: { reportingTimezone: "Australia/Brisbane" },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: vi.fn().mockReturnValue("opaque-session"),
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
  getCsvDuplicateWarnings,
  getBankReconciliation,
  getNextBankReconciliation,
  listBankImports,
  listBankTransactions,
} from "./bank-operations";

const actor = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "synthetic@example.test",
  displayName: null,
  role: "member" as const,
};
const artifactId = "22222222-2222-4222-8222-222222222222";

describe("CSV duplicate warning operation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current.auth.session.mockResolvedValue(actor);
    current.repository.findCsvDuplicateWarnings.mockResolvedValue({
      artifactId,
      warnings: [],
    });
    current.bankRepository.listImports.mockResolvedValue([]);
    current.bankRepository.listTransactions.mockResolvedValue([]);
    current.bankRepository.reconciliationCounts.mockResolvedValue({
      total: 0,
      unresolved: 0,
    });
    current.bankRepository.nextReconciliationTarget.mockResolvedValue({
      status: "none",
    });
    current.repository.listUsers.mockResolvedValue([]);
    current.repository.listEntrySuggestions.mockResolvedValue({});
    current.repository.listAvailableInvoiceArtifacts.mockResolvedValue([]);
  });

  it("loads unresolved reconciliation rows with server-side filtering", async () => {
    await getBankReconciliation({
      data: { unresolvedOnly: true, offset: 100, windowDays: 31 },
    });

    expect(current.bankRepository.listTransactions).toHaveBeenCalledWith(
      actor.id,
      {
        limit: 100,
        offset: 100,
        artifactId: undefined,
        state: "unresolved",
      },
    );
  });

  it("selects the next row through the authorized read-only queue operation", async () => {
    current.bankRepository.nextReconciliationTarget.mockResolvedValue({
      status: "target",
      bankId: "33333333-3333-4333-8333-333333333333",
      page: 2,
    });

    await expect(
      getNextBankReconciliation({
        data: {
          bankTransactionId: "44444444-4444-4444-8444-444444444444",
          artifactId,
          unresolvedOnly: true,
        },
      }),
    ).resolves.toEqual({
      status: "target",
      bankId: "33333333-3333-4333-8333-333333333333",
      page: 2,
    });

    expect(
      current.bankRepository.nextReconciliationTarget,
    ).toHaveBeenCalledWith(
      actor.id,
      "44444444-4444-4444-8444-444444444444",
      artifactId,
      true,
    );
    await expect(
      Promise.resolve().then(() =>
        getNextBankReconciliation({
          data: {
            bankTransactionId: "not-a-uuid",
            unresolvedOnly: false,
          } as never,
        }),
      ),
    ).rejects.toThrow();
    expect(
      current.bankRepository.nextReconciliationTarget,
    ).toHaveBeenCalledTimes(1);
  });

  it("rejects actors without the bank reconciliation read permission", async () => {
    current.auth.session.mockResolvedValue({ ...actor, role: "viewer" });

    await expect(
      getNextBankReconciliation({
        data: {
          bankTransactionId: "44444444-4444-4444-8444-444444444444",
          unresolvedOnly: false,
        },
      }),
    ).rejects.toThrow();
    expect(
      current.bankRepository.nextReconciliationTarget,
    ).not.toHaveBeenCalled();
  });

  it("validates field-specific bank query clauses before repository access", async () => {
    const filters = [
      {
        field: "postedDate" as const,
        operator: "greater_than" as const,
        value: "2026-09-01",
      },
      {
        field: "reviewState" as const,
        operator: "is" as const,
        value: "unresolved" as const,
      },
    ];
    const sort = [
      { key: "amountAud" as const, direction: "asc" as const },
      { key: "postedDate" as const, direction: "desc" as const },
    ];

    await listBankTransactions({
      data: { limit: 51, offset: 50, filters, sort },
    });

    expect(current.bankRepository.listTransactions).toHaveBeenCalledWith(
      actor.id,
      { limit: 51, offset: 50, filters, sort },
    );
    await expect(
      Promise.resolve().then(() =>
        listBankImports({
          data: {
            filters: [
              { field: "filename", operator: "is", value: "bank.csv" },
            ] as never,
          },
        }),
      ),
    ).rejects.toThrow();
    expect(current.bankRepository.listImports).not.toHaveBeenCalled();
  });

  it("validates bounded enum membership arrays and accepts empty inactive arrays", async () => {
    const activityFilters = [
      {
        field: "reviewState" as const,
        operator: "is_not" as const,
        value: "private" as const,
      },
      {
        field: "reviewState" as const,
        operator: "contains_any" as const,
        value: ["unresolved" as const, "matched" as const],
      },
      {
        field: "matchStatus" as const,
        operator: "contains_none" as const,
        value: [],
      },
    ];
    await listBankTransactions({ data: { filters: activityFilters } });
    expect(current.bankRepository.listTransactions).toHaveBeenCalledWith(
      actor.id,
      expect.objectContaining({ filters: activityFilters }),
    );

    const importFilters = [
      {
        field: "state" as const,
        operator: "is" as const,
        value: "available" as const,
      },
      {
        field: "state" as const,
        operator: "contains_none" as const,
        value: ["rejected" as const, "superseded" as const],
      },
    ];
    await listBankImports({ data: { filters: importFilters } });
    expect(current.bankRepository.listImports).toHaveBeenCalledWith(
      actor.id,
      expect.objectContaining({ filters: importFilters }),
    );

    await expect(
      Promise.resolve().then(() =>
        listBankTransactions({
          data: {
            filters: [
              {
                field: "reviewState",
                operator: "contains_any",
                value: ["unresolved", "invalid"],
              },
            ] as never,
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      Promise.resolve().then(() =>
        listBankImports({
          data: {
            filters: [
              {
                field: "state",
                operator: "contains_any",
                value: [
                  "pending",
                  "awaiting_review",
                  "available",
                  "rejected",
                  "abandoned",
                  "superseded",
                  "pending",
                ],
              },
            ] as never,
          },
        }),
      ),
    ).rejects.toThrow();
    expect(current.bankRepository.listImports).toHaveBeenCalledTimes(1);
  });

  it("parses pinned Stripe rows into server-derived identities", async () => {
    current.repository.getArtifact.mockResolvedValue({
      artifactProfile: "stripe_balance_itemised_csv_v1",
    });
    current.documents.readReviewText.mockResolvedValue({
      text: "balance_transaction_id,created,available_on,currency,gross,fee,net,reporting_category,description\ntxn_1,2026-09-01T00:00:00Z,,aud,10,0.3,9.7,charge,Sale",
    });

    await getCsvDuplicateWarnings({ data: { artifactId } });

    expect(current.documents.readReviewText).toHaveBeenCalledWith(
      actor.id,
      artifactId,
      "stripe_balance_itemised_csv_v1",
    );
    expect(current.repository.findCsvDuplicateWarnings).toHaveBeenCalledWith(
      actor.id,
      artifactId,
      "stripe_balance_itemised_csv_v1",
      {
        rowCount: 1,
        rowIdentityLimitReached: false,
        identities: [{ kind: "stripe_reference", reference: "txn_1" }],
      },
    );
  });

  it("parses pinned CommBank rows into movement identities", async () => {
    current.repository.getArtifact.mockResolvedValue({
      artifactProfile: "commbank_transaction_history_csv_v1",
    });
    current.documents.readReviewText.mockResolvedValue({
      text: "01/09/2026,-10.00,Synthetic movement,90.00",
    });

    await getCsvDuplicateWarnings({ data: { artifactId } });

    expect(current.repository.findCsvDuplicateWarnings).toHaveBeenCalledWith(
      actor.id,
      artifactId,
      "commbank_transaction_history_csv_v1",
      {
        rowCount: 1,
        rowIdentityLimitReached: false,
        identities: [
          {
            kind: "commbank_row",
            rowIndex: 0,
            postedDate: "2026-09-01",
            amountAud: "-10.0000",
            description: "Synthetic movement",
            runningBalance: "90.00",
          },
        ],
      },
    );
  });
});
