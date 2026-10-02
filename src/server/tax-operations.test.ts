import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({
  authConfig: { sessionCookieName: "folio_session" },
  auth: { session: vi.fn() },
  repository: {
    listTransactions: vi.fn(),
    listTaxPartnerOptions: vi.fn(),
  },
  bankRepository: { financialYearReviewRows: vi.fn() },
  taxReviewRepository: {
    listReviewedSnapshots: vi.fn(),
    getReviewedSnapshot: vi.fn(),
    createReviewedSnapshot: vi.fn(),
  },
  config: { reportingTimezone: "Australia/Brisbane" },
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
  exportTaxWorksheet,
  getTaxPartnerOptions,
  getTaxWorksheet,
  reviewTaxWorksheet,
} from "./tax-operations";

const actorId = "11111111-1111-4111-8111-111111111111";
const transactionId = "22222222-2222-4222-8222-222222222222";
const snapshotId = "33333333-3333-4333-8333-333333333333";
const syntheticSale = {
  id: transactionId,
  sourceSystem: "manual",
  kind: "sale",
  status: "recorded",
  settledAt: "2026-06-30T00:00:00.000Z",
  settlementCurrency: "AUD",
  settlementAmount: "100.0000",
  reference: "SYN-1",
  description: "Synthetic sale",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const reviewInput = (sourceFingerprint: string) => ({
  financialYearStartYear: 2025 as const,
  sourceFingerprint,
  adjustments: [],
  partners: [{ userId: actorId, percentage: "100" }],
  reviewerAttestation:
    "I reviewed the source records, deductions, timing, and partner agreement.",
});

describe("partnership tax review operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    current.auth.session.mockResolvedValue({ id: actorId, role: "member" });
    current.repository.listTransactions.mockResolvedValue([syntheticSale]);
    current.repository.listTaxPartnerOptions.mockResolvedValue([
      { id: actorId, label: "Synthetic partner" },
    ]);
    current.bankRepository.financialYearReviewRows.mockResolvedValue([]);
    current.taxReviewRepository.listReviewedSnapshots.mockResolvedValue([]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns only the narrow active partner options", async () => {
    current.repository.listTaxPartnerOptions.mockResolvedValue([
      { id: actorId, label: "Synthetic partner" },
    ]);

    await expect(getTaxPartnerOptions()).resolves.toEqual([
      { id: actorId, label: "Synthetic partner" },
    ]);
    expect(current.repository.listTaxPartnerOptions).toHaveBeenCalledWith(
      actorId,
    );
  });

  it("loads cumulative funding separately from the reviewed financial year", async () => {
    current.repository.listTransactions.mockResolvedValue([
      syntheticSale,
      {
        ...syntheticSale,
        id: "44444444-4444-4444-8444-444444444444",
        ownerId: actorId,
        kind: "owner_loan",
        settledAt: "2024-08-01T00:00:00.000Z",
        settlementAmount: "1000.0000",
      },
      {
        ...syntheticSale,
        id: "55555555-5555-4555-8555-555555555555",
        ownerId: actorId,
        kind: "owner_loan_repayment",
        settlementAmount: "200.0000",
      },
      {
        ...syntheticSale,
        id: "66666666-6666-4666-8666-666666666666",
        ownerId: actorId,
        kind: "owner_loan",
        settledAt: "2026-06-30T14:00:00.000Z",
        settlementAmount: "999.0000",
      },
    ]);

    const loaded = await getTaxWorksheet({
      data: { financialYearStartYear: 2025 },
    });

    expect(loaded.ownerFunding.owners).toEqual([
      expect.objectContaining({
        ownerId: actorId,
        loansAdvancedAud: "1000.0000",
        principalRepaidAud: "200.0000",
        loanBalanceAud: "800.0000",
        otherContributionsAud: "0.0000",
      }),
    ]);
    expect(
      loaded.source.cashLedger.rows.map((row) => row.transactionId),
    ).toEqual([transactionId, "55555555-5555-4555-8555-555555555555"]);
    expect(loaded.source.cashLedger.totals.incomeEffectAud).toBe("100.0000");
    expect(loaded.source.cashLedger.totals.expenseEffectAud).toBe("0.0000");
    expect(current.repository.listTransactions).toHaveBeenCalledTimes(1);
    expect(current.repository.listTransactions).toHaveBeenCalledWith(actorId);
    expect(current.repository.listTaxPartnerOptions).not.toHaveBeenCalled();
  });

  it("rejects funding reads without a valid session before accessing records", async () => {
    current.auth.session.mockResolvedValue(null);

    await expect(
      getTaxWorksheet({ data: { financialYearStartYear: 2025 } }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
    expect(current.repository.listTransactions).not.toHaveBeenCalled();
    expect(
      current.bankRepository.financialYearReviewRows,
    ).not.toHaveBeenCalled();
  });

  it("refreshes prior-year funding without changing the tax source fingerprint", async () => {
    const priorLoan = {
      ...syntheticSale,
      id: "44444444-4444-4444-8444-444444444444",
      ownerId: actorId,
      kind: "owner_loan",
      settledAt: "2024-08-01T00:00:00.000Z",
      settlementAmount: "1000.0000",
    };
    current.repository.listTransactions.mockResolvedValue([
      syntheticSale,
      priorLoan,
    ]);
    const original = await getTaxWorksheet({
      data: { financialYearStartYear: 2025 },
    });
    current.repository.listTransactions.mockResolvedValue([
      syntheticSale,
      {
        ...priorLoan,
        settlementAmount: "1200.0000",
        updatedAt: "2026-10-02T00:00:00.000Z",
      },
    ]);

    const refreshed = await getTaxWorksheet({
      data: { financialYearStartYear: 2025 },
    });

    expect(refreshed.ownerFunding.owners[0].loanBalanceAud).toBe("1200.0000");
    expect(refreshed.source.fingerprint).toBe(original.source.fingerprint);
    expect(refreshed.source.legacyFingerprint).toBe(
      original.source.legacyFingerprint,
    );
  });

  it("rejects a review after a source fingerprint changes", async () => {
    const loaded = await getTaxWorksheet({
      data: { financialYearStartYear: 2025 },
    });
    current.bankRepository.financialYearReviewRows.mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        postedDate: "2026-06-30",
        revision: "2",
        updatedAt: "2026-07-01T01:00:00.000Z",
        reviewState: "matched",
      },
    ]);
    await expect(
      reviewTaxWorksheet({ data: reviewInput(loaded.source.fingerprint) }),
    ).rejects.toThrow(/Code TAX_SOURCE_CHANGED/);
    expect(
      current.taxReviewRepository.createReviewedSnapshot,
    ).not.toHaveBeenCalled();
  });

  it("persists the reviewed calculation only for the current source", async () => {
    const loaded = await getTaxWorksheet({
      data: { financialYearStartYear: 2025 },
    });
    current.taxReviewRepository.createReviewedSnapshot.mockImplementation(
      async (_actorId, input) => input,
    );
    await reviewTaxWorksheet({ data: reviewInput(loaded.source.fingerprint) });
    expect(
      current.taxReviewRepository.createReviewedSnapshot,
    ).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({
        financialYearStartYear: 2025,
        sourceFingerprint: loaded.source.fingerprint,
        snapshot: expect.objectContaining({
          modelVersion: 2,
          sourceFingerprintVersion: 2,
          partnerShares: [
            expect.objectContaining({
              userId: actorId,
              label: "Synthetic partner",
            }),
          ],
          totals: expect.objectContaining({ reviewedNetResultAud: "100.0000" }),
        }),
      }),
    );
  });

  it("rechecks selected partners against the active user list when saving", async () => {
    const loaded = await getTaxWorksheet({
      data: { financialYearStartYear: 2025 },
    });
    current.repository.listTaxPartnerOptions.mockResolvedValue([]);

    await expect(
      reviewTaxWorksheet({ data: reviewInput(loaded.source.fingerprint) }),
    ).rejects.toThrow(/Code TAX_PARTNER_INACTIVE/);
    expect(
      current.taxReviewRepository.createReviewedSnapshot,
    ).not.toHaveBeenCalled();
  });

  it("rejects duplicate selected users before creating a reviewed snapshot", () => {
    expect(() =>
      reviewTaxWorksheet({
        data: {
          ...reviewInput("a".repeat(64)),
          partners: [
            { userId: actorId, percentage: "50" },
            { userId: actorId, percentage: "50" },
          ],
        },
      }),
    ).toThrow(/Partner users must be unique/);
    expect(
      current.taxReviewRepository.createReviewedSnapshot,
    ).not.toHaveBeenCalled();
  });

  it("checks absent-version snapshots against the unchanged legacy fingerprint", async () => {
    const source = await getTaxWorksheet({
      data: { financialYearStartYear: 2025 },
    });
    current.taxReviewRepository.listReviewedSnapshots.mockResolvedValue([
      {
        id: snapshotId,
        financialYearStartYear: 2025,
        sourceFingerprint: source.source.legacyFingerprint,
        snapshot: {
          partnerShares: [],
          humanAdjustments: [],
          totals: {},
        },
        reviewedAt: "2026-09-29T00:00:00.000Z",
      },
    ]);

    const loaded = await getTaxWorksheet({
      data: { financialYearStartYear: 2025 },
    });
    expect(loaded.latestIsCurrent).toBe(true);
  });

  it("refuses to export a reviewed snapshot after source edits", async () => {
    const loaded = await getTaxWorksheet({
      data: { financialYearStartYear: 2025 },
    });
    current.taxReviewRepository.getReviewedSnapshot.mockResolvedValue({
      id: snapshotId,
      financialYearStartYear: 2025,
      sourceFingerprint: loaded.source.legacyFingerprint,
      snapshot: {},
      reviewedAt: "2026-09-29T00:00:00.000Z",
    });
    current.repository.listTransactions.mockResolvedValue([
      {
        ...syntheticSale,
        updatedAt: "2026-09-29T01:00:00.000Z",
      },
    ]);
    await expect(
      exportTaxWorksheet({ data: { snapshotId, format: "csv" } }),
    ).rejects.toThrow(/Code TAX_REVIEW_STALE/);
  });

  it("refuses to export a v2 snapshot after a source owner changes", async () => {
    current.repository.listTransactions.mockResolvedValue([
      { ...syntheticSale, ownerId: null },
    ]);
    const loaded = await getTaxWorksheet({
      data: { financialYearStartYear: 2025 },
    });
    current.taxReviewRepository.getReviewedSnapshot.mockResolvedValue({
      id: snapshotId,
      financialYearStartYear: 2025,
      sourceFingerprint: loaded.source.fingerprint,
      snapshot: { modelVersion: 2, sourceFingerprintVersion: 2 },
      reviewedAt: "2026-09-29T00:00:00.000Z",
    });
    current.repository.listTransactions.mockResolvedValue([
      { ...syntheticSale, ownerId: actorId },
    ]);

    await expect(
      exportTaxWorksheet({ data: { snapshotId, format: "csv" } }),
    ).rejects.toThrow(/Code TAX_REVIEW_STALE/);
  });

  it("exports the absent-version JSON record byte for byte", async () => {
    const loaded = await getTaxWorksheet({
      data: { financialYearStartYear: 2025 },
    });
    const legacyCashLedger = {
      ...loaded.source.cashLedger,
      rows: loaded.source.cashLedger.rows.map((row) => {
        const legacyRow = { ...row };
        delete legacyRow.ownerId;
        return legacyRow;
      }),
    };
    const record = {
      id: snapshotId,
      financialYearStartYear: 2025,
      snapshot: {
        financialYearStartYear: 2025,
        financialYear: loaded.source.financialYear,
        timezone: loaded.source.timezone,
        gstRegistered: false,
        cashLedger: legacyCashLedger,
        bankRows: loaded.source.bankRows,
        humanAdjustments: [],
        partnerShares: [
          { label: "Partner 1", percentage: "100.0000", amountAud: "100.0000" },
        ],
        totals: {
          sourceIncomeAud: "100.0000",
          sourceExpenseAud: "0.0000",
          reviewedIncomeAud: "100.0000",
          reviewedDeductibleExpenseAud: "0.0000",
          reviewedNetResultAud: "100.0000",
        },
        reviewerAttestation: "Reviewed synthetic source rows.",
      },
      sourceFingerprint: loaded.source.legacyFingerprint,
      reviewerUserId: actorId,
      reviewedAt: "2026-09-29T00:00:00.000Z",
    };
    current.taxReviewRepository.getReviewedSnapshot.mockResolvedValue(record);

    const exported = await exportTaxWorksheet({
      data: { snapshotId, format: "json" },
    });
    expect(exported.content).toBe(JSON.stringify(record, null, 2));
  });
});
