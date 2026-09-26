import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  BankClassification,
  BankReconciliationCommand,
  BankReviewState,
  ParsedBankTransaction,
} from "../domain/bank-transactions";
import { rankBankMatchCandidate } from "../domain/bank-transactions";
import { manualCashEffectAudMinor } from "../domain/cash-effect";
import { parseDecimal } from "../domain/money";
import type { TransactionInput } from "../domain/types";
import { assertTransactionRules } from "../domain/workflow";
import { revisionConflictError } from "../domain/revisions";
import { FolioDiagnosticError } from "../domain/diagnostics";

type Queryable = Pick<Pool | PoolClient, "query">;

const profile = "commbank_transaction_history_csv_v1" as const;

const bankConflict = (code: string, message: string) =>
  new FolioDiagnosticError(
    { category: "validation", code, retryable: false },
    message,
  );

export interface BankOverlap {
  artifactId: string;
  filename: string;
  overlapStart: string;
  overlapEnd: string;
}

export type ConfirmBankImportResult =
  | { status: "imported"; artifactId: string; rowCount: number }
  | { status: "already_imported"; artifactId: string; rowCount: number }
  | {
      status: "overlap_acknowledgement_required";
      overlapFingerprint: string;
      overlaps: BankOverlap[];
    };

const bankOverlapFingerprint = (overlaps: readonly BankOverlap[]): string => {
  const canonicalOverlaps = [...overlaps]
    .sort((left, right) =>
      left.artifactId < right.artifactId
        ? -1
        : left.artifactId > right.artifactId
          ? 1
          : 0,
    )
    .map(({ artifactId, filename, overlapStart, overlapEnd }) => [
      artifactId,
      filename,
      overlapStart,
      overlapEnd,
    ]);

  return createHash("sha256")
    .update(`bank-overlap-v1\0${JSON.stringify(canonicalOverlaps)}`)
    .digest("hex");
};

export interface BankImportRecord {
  artifactId: string;
  filename: string;
  state:
    | "pending"
    | "awaiting_review"
    | "available"
    | "rejected"
    | "abandoned"
    | "superseded";
  createdAt: string;
  confirmedAt: string | null;
  rowCount: number;
  unresolvedCount: number;
  earliestDate: string | null;
  latestDate: string | null;
}

export interface BankTransactionRecord {
  id: string;
  postedDate: string;
  amountAud: string;
  description: string;
  metadata: Record<string, string | number | boolean | null>;
  matchedTransactionId: string | null;
  classification: BankClassification | null;
  reviewState: BankReviewState;
  revision: string;
  artifactId: string;
  artifactIds: string[];
  createdAt: string;
  updatedAt: string;
  updatedById: string;
}

export interface BankMatchCandidate {
  id: string;
  settledAt: string;
  kind: string;
  counterparty: string | null;
  reference: string | null;
  description: string | null;
  amountAud: string;
  dateDistanceDays: number;
  textScore: number;
}

export interface BankReconciliationDetail {
  bankTransaction: BankTransactionRecord;
  source: {
    artifactId: string;
    profile: string;
    filename: string;
    sourceRow: number | null;
    earliestDate: string | null;
    latestDate: string | null;
  };
  candidates: BankMatchCandidate[];
}

export interface BankReconciliationCounts {
  total: number;
  reviewed: number;
  unresolved: number;
  matched: number;
  private: number;
  transfer: number;
  duplicate: number;
}

export interface BankOverviewSummary {
  unresolvedBankRows: number;
  importsWithUnresolvedRows: number;
  recentBankRows: {
    id: string;
    postedDate: string;
    amountAud: string;
    reviewState: BankReviewState;
    updatedAt: string;
  }[];
}

export type ReconcileResult =
  | { status: "applied"; revision: string }
  | { status: "already_applied"; revision: string };

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);

const date = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
};

const reviewState = (row: QueryResultRow): BankReviewState =>
  row.matched_transaction_id
    ? "matched"
    : ((row.classification as BankClassification | null) ?? "unresolved");

export class BankRepository {
  private readonly usersTable: string;
  private readonly artifactsTable: string;
  private readonly bankTransactionsTable: string;
  private readonly bankArtifactsTable: string;
  private readonly transactionsTable: string;
  private readonly transactionArtifactsTable: string;

  constructor(
    private readonly pool: Pool,
    schema: string,
    private readonly gstRegistered = false,
  ) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
      throw new Error("Invalid Folio database schema");
    this.usersTable = `"${schema}"."users"`;
    this.artifactsTable = `"${schema}"."source_artifacts"`;
    this.bankTransactionsTable = `"${schema}"."bank_transactions"`;
    this.bankArtifactsTable = `"${schema}"."bank_transaction_artifacts"`;
    this.transactionsTable = `"${schema}"."transactions"`;
    this.transactionArtifactsTable = `"${schema}"."transaction_artifacts"`;
  }

  private async requireActor(client: Queryable, actorId: string) {
    const result = await client.query(
      `SELECT 1 FROM ${this.usersTable} WHERE id=$1 AND active=true`,
      [actorId],
    );
    if (result.rowCount !== 1) throw new Error("Active actor not found");
  }

  private async countRows(client: PoolClient, artifactId: string) {
    const result = await client.query(
      `SELECT count(*)::integer AS count FROM ${this.bankArtifactsTable} WHERE source_artifact_id=$1`,
      [artifactId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async overlaps(
    client: PoolClient,
    artifactId: string,
    earliestDate: string,
    latestDate: string,
  ): Promise<BankOverlap[]> {
    const result = await client.query(
      `SELECT artifact.id, artifact.filename, greatest(min(bank.posted_date), $2::date)::text AS overlap_start, least(max(bank.posted_date), $3::date)::text AS overlap_end
       FROM ${this.artifactsTable} artifact
       JOIN ${this.bankArtifactsTable} link ON link.source_artifact_id=artifact.id
       JOIN ${this.bankTransactionsTable} bank ON bank.id=link.bank_transaction_id
       WHERE artifact.id<>$1 AND artifact.artifact_profile=$4 AND artifact.state='available'
       GROUP BY artifact.id, artifact.filename
       HAVING daterange(min(bank.posted_date), max(bank.posted_date), '[]') && daterange($2::date, $3::date, '[]')
       ORDER BY overlap_start, artifact.id`,
      [artifactId, earliestDate, latestDate, profile],
    );
    return result.rows.map((row) => ({
      artifactId: String(row.id),
      filename: String(row.filename),
      overlapStart: String(row.overlap_start),
      overlapEnd: String(row.overlap_end),
    }));
  }

  async confirmImport(input: {
    actorId: string;
    artifactId: string;
    versionId: string;
    rows: readonly ParsedBankTransaction[];
    earliestDate: string;
    latestDate: string;
    acknowledgedOverlapFingerprint: string | null;
  }): Promise<ConfirmBankImportResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.requireActor(client, input.actorId);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${profile}:imports`],
      );
      const artifactResult = await client.query(
        `SELECT * FROM ${this.artifactsTable} WHERE id=$1 FOR UPDATE`,
        [input.artifactId],
      );
      const artifact = artifactResult.rows[0];
      if (!artifact || artifact.artifact_profile !== profile)
        throw new Error("CommBank import artifact not found");
      if (artifact.state === "available") {
        const rowCount = await this.countRows(client, input.artifactId);
        await client.query("COMMIT");
        return {
          status: "already_imported",
          artifactId: input.artifactId,
          rowCount,
        };
      }
      if (
        artifact.state !== "awaiting_review" ||
        artifact.version_id !== input.versionId
      )
        throw new Error("Reviewable CommBank import artifact not found");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${profile}:${String(artifact.checksum_sha256)}`],
      );
      const duplicate = await client.query(
        `SELECT id FROM ${this.artifactsTable} WHERE id<>$1 AND artifact_profile=$2 AND checksum_sha256=$3 AND state='available' ORDER BY confirmed_at LIMIT 1 FOR UPDATE`,
        [input.artifactId, profile, artifact.checksum_sha256],
      );
      if (duplicate.rows[0]) {
        await client.query(
          `UPDATE ${this.artifactsTable} SET state='rejected' WHERE id=$1 AND state='awaiting_review'`,
          [input.artifactId],
        );
        const existingId = String(duplicate.rows[0].id);
        const rowCount = await this.countRows(client, existingId);
        await client.query("COMMIT");
        return {
          status: "already_imported",
          artifactId: existingId,
          rowCount,
        };
      }
      const overlaps = await this.overlaps(
        client,
        input.artifactId,
        input.earliestDate,
        input.latestDate,
      );
      const overlapFingerprint = bankOverlapFingerprint(overlaps);
      if (
        overlaps.length &&
        input.acknowledgedOverlapFingerprint !== overlapFingerprint
      ) {
        await client.query("COMMIT");
        return {
          status: "overlap_acknowledgement_required",
          overlapFingerprint,
          overlaps,
        };
      }
      const available = await client.query(
        `UPDATE ${this.artifactsTable} SET state='available' WHERE id=$1 AND state='awaiting_review' AND version_id=$2`,
        [input.artifactId, input.versionId],
      );
      if (available.rowCount !== 1)
        throw new Error("Reviewable CommBank import artifact not found");
      for (const row of input.rows) {
        const inserted = await client.query(
          `INSERT INTO ${this.bankTransactionsTable} (posted_date, amount_aud, description, metadata, created_by_id, updated_by_id) VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
          [
            row.postedDate,
            row.amountAud,
            row.description,
            row.metadata,
            input.actorId,
          ],
        );
        await client.query(
          `INSERT INTO ${this.bankArtifactsTable} (bank_transaction_id, source_artifact_id, metadata) VALUES ($1,$2,$3)`,
          [inserted.rows[0]!.id, input.artifactId, { row: row.sourceRow }],
        );
      }
      await client.query("COMMIT");
      return {
        status: "imported",
        artifactId: input.artifactId,
        rowCount: input.rows.length,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async abandonPending(actorId: string, artifactId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.artifactsTable} artifact SET state='abandoned'
       WHERE artifact.id=$1 AND artifact.created_by_id=$2 AND artifact.artifact_profile=$3 AND artifact.state='pending'
       AND EXISTS (SELECT 1 FROM ${this.usersTable} actor WHERE actor.id=$2 AND actor.active=true)`,
      [artifactId, actorId, profile],
    );
    if (result.rowCount !== 1)
      throw new Error("Pending CommBank import artifact not found");
  }

  async listImports(
    actorId: string,
    input: { limit: number; offset: number },
  ): Promise<BankImportRecord[]> {
    const result = await this.pool.query(
      `SELECT artifact.id, artifact.filename, artifact.state, artifact.created_at, artifact.confirmed_at,
        count(bank.id)::integer AS row_count,
        count(bank.id) FILTER (WHERE bank.matched_transaction_id IS NULL AND bank.classification IS NULL)::integer AS unresolved_count,
        min(bank.posted_date)::text AS earliest_date, max(bank.posted_date)::text AS latest_date
       FROM ${this.artifactsTable} artifact
       LEFT JOIN ${this.bankArtifactsTable} link ON link.source_artifact_id=artifact.id
       LEFT JOIN ${this.bankTransactionsTable} bank ON bank.id=link.bank_transaction_id
       WHERE artifact.artifact_profile=$1
       AND EXISTS (SELECT 1 FROM ${this.usersTable} actor WHERE actor.id=$2 AND actor.active=true)
       GROUP BY artifact.id
       ORDER BY artifact.created_at DESC, artifact.id DESC LIMIT $3 OFFSET $4`,
      [profile, actorId, input.limit, input.offset],
    );
    return result.rows.map((row) => ({
      artifactId: String(row.id),
      filename: String(row.filename),
      state: row.state,
      createdAt: iso(row.created_at),
      confirmedAt: row.confirmed_at ? iso(row.confirmed_at) : null,
      rowCount: Number(row.row_count),
      unresolvedCount: Number(row.unresolved_count),
      earliestDate: date(row.earliest_date),
      latestDate: date(row.latest_date),
    }));
  }

  async listTransactions(
    actorId: string,
    input: {
      limit: number;
      offset: number;
      artifactId?: string;
      state?: BankReviewState;
    },
  ): Promise<BankTransactionRecord[]> {
    const result = await this.pool.query(
      `SELECT bank.*, bank.posted_date::text AS posted_date_text, artifacts.source_artifact_ids
       FROM ${this.bankTransactionsTable} bank
       JOIN LATERAL (
         SELECT array_agg(link.source_artifact_id ORDER BY link.source_artifact_id) AS source_artifact_ids
         FROM ${this.bankArtifactsTable} link
         WHERE link.bank_transaction_id=bank.id
       ) artifacts ON true
       WHERE EXISTS (SELECT 1 FROM ${this.usersTable} actor WHERE actor.id=$1 AND actor.active=true)
       AND ($2::uuid IS NULL OR EXISTS (
         SELECT 1 FROM ${this.bankArtifactsTable} selected_link
         WHERE selected_link.bank_transaction_id=bank.id AND selected_link.source_artifact_id=$2
       ))
       AND ($3::text IS NULL OR CASE WHEN bank.matched_transaction_id IS NOT NULL THEN 'matched' WHEN bank.classification IS NOT NULL THEN bank.classification ELSE 'unresolved' END=$3)
       ORDER BY bank.posted_date DESC, bank.id DESC LIMIT $4 OFFSET $5`,
      [
        actorId,
        input.artifactId ?? null,
        input.state ?? null,
        input.limit,
        input.offset,
      ],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      postedDate: date(row.posted_date_text ?? row.posted_date)!,
      amountAud: String(row.amount_aud),
      description: String(row.description),
      metadata: row.metadata as Record<
        string,
        string | number | boolean | null
      >,
      matchedTransactionId: row.matched_transaction_id
        ? String(row.matched_transaction_id)
        : null,
      classification: row.classification as BankClassification | null,
      reviewState: reviewState(row),
      revision: String(row.revision),
      artifactId: String(row.source_artifact_ids[0]),
      artifactIds: (row.source_artifact_ids as unknown[]).map(String),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      updatedById: String(row.updated_by_id),
    }));
  }

  async reconciliationCounts(
    actorId: string,
    artifactId?: string,
  ): Promise<BankReconciliationCounts> {
    const result = await this.pool.query(
      `SELECT count(*)::integer AS total,
        count(*) FILTER (WHERE bank.matched_transaction_id IS NOT NULL OR bank.classification IS NOT NULL)::integer AS reviewed,
        count(*) FILTER (WHERE bank.matched_transaction_id IS NULL AND bank.classification IS NULL)::integer AS unresolved,
        count(*) FILTER (WHERE bank.matched_transaction_id IS NOT NULL)::integer AS matched,
        count(*) FILTER (WHERE bank.classification='private')::integer AS private,
        count(*) FILTER (WHERE bank.classification='transfer')::integer AS transfer,
        count(*) FILTER (WHERE bank.classification='duplicate')::integer AS duplicate
       FROM ${this.bankTransactionsTable} bank
       WHERE EXISTS (SELECT 1 FROM ${this.usersTable} actor WHERE actor.id=$1 AND actor.active=true)
       AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM ${this.bankArtifactsTable} link WHERE link.bank_transaction_id=bank.id AND link.source_artifact_id=$2))`,
      [actorId, artifactId ?? null],
    );
    const row = result.rows[0]!;
    return {
      total: Number(row.total),
      reviewed: Number(row.reviewed),
      unresolved: Number(row.unresolved),
      matched: Number(row.matched),
      private: Number(row.private),
      transfer: Number(row.transfer),
      duplicate: Number(row.duplicate),
    };
  }

  async overviewSummary(actorId: string): Promise<BankOverviewSummary> {
    await this.requireActor(this.pool, actorId);
    const [counts, recent] = await Promise.all([
      this.pool.query(
        `SELECT
          count(*) FILTER (WHERE bank.matched_transaction_id IS NULL AND bank.classification IS NULL)::integer AS unresolved_bank_rows,
          (SELECT count(DISTINCT link.source_artifact_id)::integer
           FROM ${this.bankArtifactsTable} link
           JOIN ${this.artifactsTable} artifact ON artifact.id=link.source_artifact_id
           JOIN ${this.bankTransactionsTable} linked_bank ON linked_bank.id=link.bank_transaction_id
           WHERE artifact.artifact_profile=$1 AND artifact.state='available'
           AND linked_bank.matched_transaction_id IS NULL AND linked_bank.classification IS NULL) AS imports_with_unresolved_rows
         FROM ${this.bankTransactionsTable} bank`,
        [profile],
      ),
      this.pool.query(
        `SELECT id, posted_date::text AS posted_date_text, amount_aud, matched_transaction_id, classification, updated_at
         FROM ${this.bankTransactionsTable}
         ORDER BY updated_at DESC, id DESC LIMIT 5`,
      ),
    ]);
    const row = counts.rows[0];
    return {
      unresolvedBankRows: Number(row?.unresolved_bank_rows ?? 0),
      importsWithUnresolvedRows: Number(row?.imports_with_unresolved_rows ?? 0),
      recentBankRows: recent.rows.map((recentRow) => ({
        id: String(recentRow.id),
        postedDate: date(recentRow.posted_date_text)!,
        amountAud: String(recentRow.amount_aud),
        reviewState: reviewState(recentRow),
        updatedAt: iso(recentRow.updated_at),
      })),
    };
  }

  async reconciliationDetail(
    actorId: string,
    bankTransactionId: string,
    windowDays: 14 | 31 | null,
    artifactId?: string,
  ): Promise<BankReconciliationDetail | null> {
    await this.requireActor(this.pool, actorId);
    const selected = await this.pool.query(
      `SELECT bank.*, bank.posted_date::text AS posted_date_text, artifact.id AS artifact_id, artifact.artifact_profile, artifact.filename,
        link.metadata->>'row' AS source_row,
        range.earliest_date, range.latest_date,
        ARRAY(SELECT sibling.source_artifact_id FROM ${this.bankArtifactsTable} sibling WHERE sibling.bank_transaction_id=bank.id ORDER BY sibling.source_artifact_id) AS source_artifact_ids
       FROM ${this.bankTransactionsTable} bank
       JOIN ${this.bankArtifactsTable} link ON link.bank_transaction_id=bank.id
       JOIN ${this.artifactsTable} artifact ON artifact.id=link.source_artifact_id
       JOIN LATERAL (SELECT min(period_bank.posted_date)::text AS earliest_date, max(period_bank.posted_date)::text AS latest_date FROM ${this.bankArtifactsTable} period_link JOIN ${this.bankTransactionsTable} period_bank ON period_bank.id=period_link.bank_transaction_id WHERE period_link.source_artifact_id=artifact.id) range ON true
       WHERE bank.id=$1
       AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM ${this.bankArtifactsTable} context_link WHERE context_link.bank_transaction_id=bank.id AND context_link.source_artifact_id=$2))
       ORDER BY (artifact.id=$2::uuid) DESC, artifact.id LIMIT 1`,
      [bankTransactionId, artifactId ?? null],
    );
    const row = selected.rows[0];
    if (!row) return null;
    const bankTransaction = this.mapBankTransaction(row);
    const valueDate = row.metadata?.valueDate;
    const bankMatchDate =
      typeof valueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valueDate)
        ? valueDate
        : bankTransaction.postedDate;
    const candidateResult = await this.pool.query(
      `SELECT candidate.id, candidate.settled_at, candidate.kind, candidate.counterparty, candidate.reference, candidate.description, candidate.settlement_amount,
        CASE WHEN candidate.kind IN ('sale','supplier_credit','owner_contribution','owner_loan') THEN candidate.settlement_amount ELSE -candidate.settlement_amount END AS amount_aud
       FROM ${this.transactionsTable} candidate
       WHERE candidate.source_system='manual' AND candidate.status='recorded'
       AND candidate.settled_at IS NOT NULL AND candidate.settlement_currency='AUD' AND candidate.settlement_amount IS NOT NULL
       AND candidate.kind IN ('sale','supplier_expense','processing_fee','sale_refund','supplier_credit','owner_contribution','owner_loan')
       AND CASE WHEN candidate.kind IN ('sale','supplier_credit','owner_contribution','owner_loan') THEN candidate.settlement_amount ELSE -candidate.settlement_amount END=$1::numeric
       AND ($3::integer IS NULL OR abs(candidate.settled_at::date - $2::date) <= $3)
       AND NOT EXISTS (SELECT 1 FROM ${this.bankTransactionsTable} matched WHERE matched.matched_transaction_id=candidate.id AND matched.id<>$4)`,
      [row.amount_aud, bankMatchDate, windowDays, bankTransactionId],
    );
    const candidates = candidateResult.rows
      .map((candidate): BankMatchCandidate => {
        const rank = rankBankMatchCandidate({
          bankPostedDate: bankMatchDate,
          bankDescription: bankTransaction.description,
          bankCounterparty: null,
          settledAt: iso(candidate.settled_at),
          counterparty: candidate.counterparty,
          reference: candidate.reference,
          description: candidate.description,
        });
        return {
          id: String(candidate.id),
          settledAt: iso(candidate.settled_at),
          kind: String(candidate.kind),
          counterparty: candidate.counterparty,
          reference: candidate.reference,
          description: candidate.description,
          amountAud: String(candidate.amount_aud),
          ...rank,
        };
      })
      .sort(
        (left, right) =>
          left.dateDistanceDays - right.dateDistanceDays ||
          right.textScore - left.textScore ||
          left.settledAt.localeCompare(right.settledAt) ||
          left.id.localeCompare(right.id),
      );
    return {
      bankTransaction,
      source: {
        artifactId: String(row.artifact_id),
        profile: String(row.artifact_profile),
        filename: String(row.filename),
        sourceRow: row.source_row ? Number(row.source_row) : null,
        earliestDate: date(row.earliest_date),
        latestDate: date(row.latest_date),
      },
      candidates,
    };
  }

  private mapBankTransaction(row: QueryResultRow): BankTransactionRecord {
    const artifactIds = Array.isArray(row.source_artifact_ids)
      ? (row.source_artifact_ids as unknown[]).map(String)
      : [];
    return {
      id: String(row.id),
      postedDate: date(row.posted_date_text ?? row.posted_date)!,
      amountAud: String(row.amount_aud),
      description: String(row.description),
      metadata: row.metadata as Record<
        string,
        string | number | boolean | null
      >,
      matchedTransactionId: row.matched_transaction_id
        ? String(row.matched_transaction_id)
        : null,
      classification: row.classification as BankClassification | null,
      reviewState: reviewState(row),
      revision: String(row.revision),
      artifactId: String(row.artifact_id ?? artifactIds[0]),
      artifactIds,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      updatedById: String(row.updated_by_id),
    };
  }

  async reconcile(input: {
    actorId: string;
    bankTransactionId: string;
    expectedRevision: string;
    command: BankReconciliationCommand;
  }): Promise<ReconcileResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.requireActor(client, input.actorId);
      const selected = await client.query(
        `SELECT * FROM ${this.bankTransactionsTable} WHERE id=$1 FOR UPDATE`,
        [input.bankTransactionId],
      );
      const bank = selected.rows[0];
      if (!bank) throw new Error("Bank transaction not found");
      const alreadyApplied =
        input.command.type === "match"
          ? String(bank.matched_transaction_id ?? "") ===
              input.command.transactionId && bank.classification === null
          : input.command.type === "classify"
            ? bank.matched_transaction_id === null &&
              bank.classification === input.command.classification
            : bank.matched_transaction_id === null &&
              bank.classification === null;
      if (alreadyApplied) {
        await client.query("COMMIT");
        return { status: "already_applied", revision: String(bank.revision) };
      }
      if (String(bank.revision) !== input.expectedRevision)
        throw revisionConflictError();
      if (
        (bank.matched_transaction_id !== null ||
          bank.classification !== null) &&
        input.command.type !== "reset"
      )
        throw bankConflict(
          "BANK_STATE_CONFLICT",
          "Reset this bank transaction before applying a different resolution",
        );

      if (input.command.type === "reset" && bank.matched_transaction_id)
        await client.query(
          `SELECT id FROM ${this.transactionsTable} WHERE id=$1 FOR UPDATE`,
          [bank.matched_transaction_id],
        );

      if (input.command.type === "match") {
        const target = await client.query(
          `SELECT * FROM ${this.transactionsTable} WHERE id=$1 FOR UPDATE`,
          [input.command.transactionId],
        );
        const transaction = target.rows[0];
        if (!transaction) throw new Error("Transaction not found");
        const effect = manualCashEffectAudMinor({
          sourceSystem: transaction.source_system,
          status: transaction.status,
          kind: transaction.kind,
          settledAt: transaction.settled_at
            ? iso(transaction.settled_at)
            : null,
          settlementCurrency: transaction.settlement_currency,
          settlementAmount: transaction.settlement_amount,
        });
        if (effect === null || effect !== parseDecimal(String(bank.amount_aud)))
          throw bankConflict(
            "BANK_MATCH_INVALID",
            "Transaction is not an exact eligible AUD match",
          );
      }

      const values =
        input.command.type === "match"
          ? [input.command.transactionId, null]
          : input.command.type === "classify"
            ? [null, input.command.classification]
            : [null, null];
      const updated = await client.query(
        `UPDATE ${this.bankTransactionsTable} SET matched_transaction_id=$2, classification=$3, revision=revision+1, updated_by_id=$4, updated_at=now() WHERE id=$1 RETURNING revision`,
        [input.bankTransactionId, ...values, input.actorId],
      );
      await client.query("COMMIT");
      return { status: "applied", revision: String(updated.rows[0]!.revision) };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: unknown })?.code === "23505")
        throw bankConflict(
          "BANK_MATCH_CONFLICT",
          "Transaction is already matched to another bank row",
        );
      throw error;
    } finally {
      client.release();
    }
  }

  async createAndMatch(input: {
    actorId: string;
    bankTransactionId: string;
    expectedRevision: string;
    transactionId: string;
    transaction: TransactionInput;
    artifactIds: readonly string[];
  }): Promise<ReconcileResult & { transactionId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.requireActor(client, input.actorId);
      const selected = await client.query(
        `SELECT * FROM ${this.bankTransactionsTable} WHERE id=$1 FOR UPDATE`,
        [input.bankTransactionId],
      );
      const bank = selected.rows[0];
      if (!bank) throw new Error("Bank transaction not found");
      if (String(bank.matched_transaction_id ?? "") === input.transactionId) {
        await client.query("COMMIT");
        return {
          status: "already_applied",
          revision: String(bank.revision),
          transactionId: input.transactionId,
        };
      }
      if (String(bank.revision) !== input.expectedRevision)
        throw revisionConflictError();
      if (bank.matched_transaction_id || bank.classification)
        throw bankConflict(
          "BANK_STATE_CONFLICT",
          "Reset this bank transaction before creating a match",
        );

      const artifactIds = [...new Set(input.artifactIds)].sort();
      const evidence = artifactIds.length
        ? await client.query(
            `SELECT id, artifact_profile, state FROM ${this.artifactsTable} WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
            [artifactIds],
          )
        : { rows: [] };
      if (
        evidence.rows.length !== artifactIds.length ||
        evidence.rows.some(
          (artifact) =>
            artifact.artifact_profile !== "manual_invoice_pdf_v1" ||
            artifact.state !== "available",
        )
      )
        throw new Error("Manual transactions require available invoice PDFs");
      const primaryArtifactId = artifactIds[0] ?? null;
      assertTransactionRules(
        { ...input.transaction, sourceArtifactId: primaryArtifactId },
        this.gstRegistered,
        primaryArtifactId
          ? { artifactProfile: "manual_invoice_pdf_v1", state: "available" }
          : null,
      );
      const effect = manualCashEffectAudMinor({
        ...input.transaction,
        sourceSystem: "manual",
      });
      if (effect === null || effect !== parseDecimal(String(bank.amount_aud)))
        throw bankConflict(
          "BANK_MATCH_INVALID",
          "Created transaction must exactly match the bank movement",
        );

      await client.query(
        `INSERT INTO ${this.transactionsTable} (id, owner_id, created_by_id, updated_by_id, source_system, kind, reference, counterparty, description, status, category, notes, occurred_at, available_at, invoice_date, settled_at, document_currency, document_amount, document_tax_amount, tax_treatment, settlement_currency, settlement_amount, gst_credit_status, claimable_gst_aud) VALUES ($1,$2,$3,$3,'manual',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          input.transactionId,
          input.transaction.ownerId,
          input.actorId,
          input.transaction.kind,
          input.transaction.reference,
          input.transaction.counterparty,
          input.transaction.description,
          input.transaction.status,
          input.transaction.category,
          input.transaction.notes,
          input.transaction.occurredAt,
          input.transaction.availableAt,
          input.transaction.invoiceDate,
          input.transaction.settledAt,
          input.transaction.documentCurrency,
          input.transaction.documentAmount,
          input.transaction.documentTaxAmount,
          input.transaction.taxTreatment,
          input.transaction.settlementCurrency,
          input.transaction.settlementAmount,
          input.transaction.gstCreditStatus,
          input.transaction.claimableGstAud,
        ],
      );
      for (const artifactId of artifactIds)
        await client.query(
          `INSERT INTO ${this.transactionArtifactsTable} (transaction_id, source_artifact_id) VALUES ($1,$2)`,
          [input.transactionId, artifactId],
        );
      const updated = await client.query(
        `UPDATE ${this.bankTransactionsTable} SET matched_transaction_id=$2, revision=revision+1, updated_by_id=$3, updated_at=now() WHERE id=$1 RETURNING revision`,
        [input.bankTransactionId, input.transactionId, input.actorId],
      );
      await client.query("COMMIT");
      return {
        status: "applied",
        revision: String(updated.rows[0]!.revision),
        transactionId: input.transactionId,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: unknown })?.code === "23505")
        throw bankConflict(
          "BANK_MATCH_CONFLICT",
          "Transaction or bank match already exists",
        );
      throw error;
    } finally {
      client.release();
    }
  }
}
