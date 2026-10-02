import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { requiredMigrationIds } from "./migrations";
import {
  TaxReviewActorError,
  TaxReviewRepository,
  TaxReviewSnapshotInputError,
  type ReviewedPartnershipTaxSnapshot,
} from "./tax-review-repository";

const actorId = "11111111-1111-4111-8111-111111111111";
const snapshotId = "22222222-2222-4222-8222-222222222222";
interface SyntheticCashLedger {
  totalAud: string;
}
const cashLedger: SyntheticCashLedger = { totalAud: "125.00" };
const snapshot: ReviewedPartnershipTaxSnapshot = {
  cashLedger,
  humanAdjustments: [{ reason: "synthetic adjustment", amountAud: "-5.00" }],
  partnerShares: [{ partner: "partner-a", share: "50.00" }],
  totals: { assessableIncomeAud: "120.00" },
  reviewerAttestation: "Reviewed against synthetic source records.",
};

const row = {
  id: snapshotId,
  financial_year_start_year: 2025,
  snapshot,
  source_fingerprint: "synthetic-fingerprint-v1",
  reviewer_user_id: actorId,
  reviewed_at: new Date("2026-09-29T00:00:00.000Z"),
};

describe("tax review snapshot repository", () => {
  it("creates immutable review records for an active reviewer", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: actorId }] })
      .mockResolvedValueOnce({ rows: [row] });
    const repository = new TaxReviewRepository({ query } as never, "folio");

    await expect(
      repository.createReviewedSnapshot(actorId, {
        financialYearStartYear: 2025,
        snapshot,
        sourceFingerprint: "synthetic-fingerprint-v1",
      }),
    ).resolves.toEqual({
      id: snapshotId,
      financialYearStartYear: 2025,
      snapshot,
      sourceFingerprint: "synthetic-fingerprint-v1",
      reviewerUserId: actorId,
      reviewedAt: "2026-09-29T00:00:00.000Z",
    });

    expect(query.mock.calls[0]).toEqual([
      'SELECT id FROM "folio"."users" WHERE id=$1 AND active=true',
      [actorId],
    ]);
    expect(query.mock.calls[1]?.[0]).toContain(
      'INSERT INTO "folio"."tax_review_snapshots"',
    );
    expect(query.mock.calls[1]?.[0]).toContain("RETURNING id");
    expect(query.mock.calls[1]?.[1]).toEqual([
      2025,
      JSON.stringify(snapshot),
      "synthetic-fingerprint-v1",
      actorId,
    ]);
  });

  it("lists and gets reviewed snapshots only after validating the active actor", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: actorId }] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ id: actorId }] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ id: actorId }] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new TaxReviewRepository({ query } as never, "folio");

    await expect(repository.listReviewedSnapshots(actorId)).resolves.toEqual([
      {
        id: snapshotId,
        financialYearStartYear: 2025,
        snapshot,
        sourceFingerprint: "synthetic-fingerprint-v1",
        reviewerUserId: actorId,
        reviewedAt: "2026-09-29T00:00:00.000Z",
      },
    ]);
    await expect(
      repository.getReviewedSnapshot(actorId, snapshotId),
    ).resolves.toMatchObject({ id: snapshotId, reviewerUserId: actorId });
    await expect(
      repository.getReviewedSnapshot(actorId, snapshotId),
    ).resolves.toBeNull();

    expect(query.mock.calls[1]?.[0]).toContain(
      'FROM "folio"."tax_review_snapshots" ORDER BY reviewed_at DESC, id DESC',
    );
    expect(query.mock.calls[3]).toEqual([
      'SELECT id, financial_year_start_year, snapshot, source_fingerprint, reviewer_user_id, reviewed_at FROM "folio"."tax_review_snapshots" WHERE id=$1',
      [snapshotId],
    ]);
    expect(query).toHaveBeenCalledTimes(6);
  });

  it("rejects inactive actors and malformed snapshot inputs before insertion", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: actorId }] })
      .mockResolvedValueOnce({ rows: [{ id: actorId }] });
    const repository = new TaxReviewRepository({ query } as never, "folio");

    await expect(repository.listReviewedSnapshots(actorId)).rejects.toThrow(
      TaxReviewActorError,
    );
    await expect(
      repository.createReviewedSnapshot(actorId, {
        financialYearStartYear: 2025,
        snapshot: { ...snapshot, reviewerAttestation: " " },
        sourceFingerprint: "synthetic-fingerprint-v1",
      }),
    ).rejects.toThrow(TaxReviewSnapshotInputError);
    await expect(
      repository.createReviewedSnapshot(actorId, {
        financialYearStartYear: 2025,
        snapshot: { ...snapshot, cashLedger: new Date() },
        sourceFingerprint: "synthetic-fingerprint-v1",
      }),
    ).rejects.toThrow(TaxReviewSnapshotInputError);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("rejects unsafe schema names", () => {
    expect(
      () => new TaxReviewRepository({ query: vi.fn() } as never, "folio;drop"),
    ).toThrow("Invalid Folio database schema");
  });
});

describe("tax review snapshot migration", () => {
  it("stores append-only reviewed snapshots and grants the app role read and insert", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../../migrations/0014_folio_tax_review_snapshots.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const migrator = await readFile(
      fileURLToPath(new URL("./migrate.ts", import.meta.url)),
      "utf8",
    );

    expect(requiredMigrationIds).toContain("0014_folio_tax_review_snapshots");
    expect(migration).toContain(
      '"id" uuid PRIMARY KEY DEFAULT gen_random_uuid()',
    );
    expect(migration).toContain('"financial_year_start_year" integer NOT NULL');
    expect(migration).toContain('"snapshot" jsonb NOT NULL');
    expect(migration).toContain('"source_fingerprint" text NOT NULL');
    expect(migration).toContain('"reviewer_user_id" uuid NOT NULL');
    expect(migration).toContain(
      '"reviewed_at" timestamptz NOT NULL DEFAULT now()',
    );
    expect(migration).toContain("'humanAdjustments'");
    expect(migration).toContain("'partnerShares'");
    expect(migration).toContain("'reviewerAttestation'");
    expect(migration).toContain("tax_review_snapshots_append_only_trigger");
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migrator).toContain(
      'GRANT SELECT, INSERT ON TABLE "${config.databaseSchema}"."tax_review_snapshots"',
    );
  });
});
