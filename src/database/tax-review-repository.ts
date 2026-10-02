import type { Pool, QueryResultRow } from "pg";

export interface ReviewedPartnershipTaxSnapshot {
  readonly cashLedger: unknown;
  readonly humanAdjustments: unknown;
  readonly partnerShares: unknown;
  readonly totals: unknown;
  readonly reviewerAttestation: string;
}

export interface CreateReviewedTaxSnapshotInput<
  Snapshot extends ReviewedPartnershipTaxSnapshot =
    ReviewedPartnershipTaxSnapshot,
> {
  financialYearStartYear: number;
  snapshot: Snapshot;
  sourceFingerprint: string;
}

export interface ReviewedTaxSnapshotRecord<
  Snapshot extends ReviewedPartnershipTaxSnapshot =
    ReviewedPartnershipTaxSnapshot,
> {
  id: string;
  financialYearStartYear: number;
  snapshot: Snapshot;
  sourceFingerprint: string;
  reviewerUserId: string;
  reviewedAt: string;
}

export class TaxReviewActorError extends Error {
  constructor() {
    super("Tax review requires an active Folio user");
    this.name = "TaxReviewActorError";
  }
}

export class TaxReviewSnapshotInputError extends Error {
  constructor() {
    super("Invalid reviewed tax snapshot");
    this.name = "TaxReviewSnapshotInputError";
  }
}

const snapshotFields = [
  "cashLedger",
  "humanAdjustments",
  "partnerShares",
  "totals",
  "reviewerAttestation",
] as const;

const isJsonValue = (
  value: unknown,
  ancestors = new WeakSet<object>(),
): boolean => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    return false;
  }

  ancestors.add(value);
  const serializable = Array.isArray(value)
    ? Array.from(value).every((child) => isJsonValue(child, ancestors))
    : Object.getOwnPropertySymbols(value).length === 0 &&
      Object.values(value).every((child) => isJsonValue(child, ancestors));
  ancestors.delete(value);
  return serializable;
};

const serializeSnapshot = (
  snapshot: ReviewedPartnershipTaxSnapshot,
): string => {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot) ||
    !isJsonValue(snapshot)
  )
    throw new TaxReviewSnapshotInputError();

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(snapshot);
  } catch {
    throw new TaxReviewSnapshotInputError();
  }
  if (typeof serialized !== "string") throw new TaxReviewSnapshotInputError();

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TaxReviewSnapshotInputError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new TaxReviewSnapshotInputError();

  const value = parsed as Record<string, unknown>;
  if (
    snapshotFields.some((field) => !Object.hasOwn(value, field)) ||
    typeof value.reviewerAttestation !== "string" ||
    value.reviewerAttestation.trim().length === 0
  ) {
    throw new TaxReviewSnapshotInputError();
  }
  return serialized;
};

const mapSnapshotRecord = <
  Snapshot extends ReviewedPartnershipTaxSnapshot =
    ReviewedPartnershipTaxSnapshot,
>(
  row: QueryResultRow,
): ReviewedTaxSnapshotRecord<Snapshot> => {
  const snapshot =
    typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    throw new Error("Persisted tax review snapshot is invalid");

  const reviewedAt =
    row.reviewed_at instanceof Date
      ? row.reviewed_at.toISOString()
      : new Date(String(row.reviewed_at)).toISOString();

  return {
    id: String(row.id),
    financialYearStartYear: Number(row.financial_year_start_year),
    snapshot: snapshot as Snapshot,
    sourceFingerprint: String(row.source_fingerprint),
    reviewerUserId: String(row.reviewer_user_id),
    reviewedAt,
  };
};

export class TaxReviewRepository {
  private readonly usersTable: string;
  private readonly snapshotsTable: string;

  constructor(
    private readonly pool: Pick<Pool, "query">,
    schema: string,
  ) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
      throw new Error("Invalid Folio database schema");
    this.usersTable = `"${schema}"."users"`;
    this.snapshotsTable = `"${schema}"."tax_review_snapshots"`;
  }

  private async requireActiveActor(actorId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT id FROM ${this.usersTable} WHERE id=$1 AND active=true`,
      [actorId],
    );
    if (result.rows.length === 0) throw new TaxReviewActorError();
  }

  async listReviewedSnapshots<
    Snapshot extends ReviewedPartnershipTaxSnapshot =
      ReviewedPartnershipTaxSnapshot,
  >(actorId: string): Promise<ReviewedTaxSnapshotRecord<Snapshot>[]> {
    await this.requireActiveActor(actorId);
    const result = await this.pool.query(
      `SELECT id, financial_year_start_year, snapshot, source_fingerprint, reviewer_user_id, reviewed_at FROM ${this.snapshotsTable} ORDER BY reviewed_at DESC, id DESC`,
    );
    return result.rows.map(mapSnapshotRecord<Snapshot>);
  }

  async getReviewedSnapshot<
    Snapshot extends ReviewedPartnershipTaxSnapshot =
      ReviewedPartnershipTaxSnapshot,
  >(
    actorId: string,
    snapshotId: string,
  ): Promise<ReviewedTaxSnapshotRecord<Snapshot> | null> {
    await this.requireActiveActor(actorId);
    const result = await this.pool.query(
      `SELECT id, financial_year_start_year, snapshot, source_fingerprint, reviewer_user_id, reviewed_at FROM ${this.snapshotsTable} WHERE id=$1`,
      [snapshotId],
    );
    const row = result.rows[0];
    return row ? mapSnapshotRecord<Snapshot>(row) : null;
  }

  async createReviewedSnapshot<Snapshot extends ReviewedPartnershipTaxSnapshot>(
    actorId: string,
    input: CreateReviewedTaxSnapshotInput<Snapshot>,
  ): Promise<ReviewedTaxSnapshotRecord<Snapshot>> {
    await this.requireActiveActor(actorId);
    if (
      !Number.isInteger(input.financialYearStartYear) ||
      input.financialYearStartYear < 1 ||
      input.financialYearStartYear > 9999 ||
      typeof input.sourceFingerprint !== "string" ||
      input.sourceFingerprint.trim().length === 0
    ) {
      throw new TaxReviewSnapshotInputError();
    }

    const snapshot = serializeSnapshot(input.snapshot);
    const result = await this.pool.query(
      `INSERT INTO ${this.snapshotsTable} (financial_year_start_year, snapshot, source_fingerprint, reviewer_user_id) VALUES ($1, $2::jsonb, $3, $4) RETURNING id, financial_year_start_year, snapshot, source_fingerprint, reviewer_user_id, reviewed_at`,
      [
        input.financialYearStartYear,
        snapshot,
        input.sourceFingerprint,
        actorId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Tax review snapshot insert returned no row");
    return mapSnapshotRecord<Snapshot>(row);
  }
}
