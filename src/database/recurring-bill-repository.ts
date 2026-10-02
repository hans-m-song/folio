import type { Pool, PoolClient, QueryResultRow } from "pg";
import { z } from "zod";

import {
  assertExpectedRevision,
  revisionConflictError,
} from "../domain/revisions";
import {
  buildRecurringBillViews,
  detectRecurringBillSuggestions,
  isRecurringBillTransactionEligible,
  previewRecurringBillMatches,
  recurringBillScheduleInputSchema,
  type RecurringBillLink,
  type RecurringBillMatchPreviewResult,
  type RecurringBillSchedule,
  type RecurringBillScheduleInput,
  type RecurringBillSuggestion,
  type RecurringBillTransaction,
  type RecurringBillView,
} from "../domain/recurring-bills";
import { FolioDiagnosticError } from "../domain/diagnostics";

type Queryable = Pick<Pool | PoolClient, "query">;

const timestampValueProjection = (column: string): string =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const timestampProjection = (column: string, alias: string): string =>
  `${timestampValueProjection(column)} AS ${alias}`;

const nullableTimestampProjection = (column: string, alias: string): string =>
  `CASE WHEN ${column} IS NULL THEN NULL ELSE ${timestampValueProjection(column)} END AS ${alias}`;

const scheduleProjection = [
  "id",
  "label",
  "counterparty",
  "description_match_text",
  "description_match_mode",
  "document_currency",
  "expected_amount",
  "frequency",
  "anchor_date::text AS anchor_date",
  "days_early",
  "days_late",
  "responsible_user_id",
  "active",
  "created_by_id",
  "updated_by_id",
  timestampProjection("created_at", "created_at_token"),
  timestampProjection("updated_at", "updated_at_token"),
].join(", ");

const linkProjection = [
  "schedule_id",
  "expected_date::text AS expected_date",
  "transaction_id",
  "created_by_id",
  timestampProjection("created_at", "created_at_token"),
].join(", ");

const transactionProjection = [
  "id",
  "kind",
  "status",
  "counterparty",
  "description",
  "document_currency",
  "document_amount",
  "invoice_date::text AS invoice_date",
  nullableTimestampProjection("occurred_at", "occurred_at"),
  nullableTimestampProjection("settled_at", "settled_at"),
].join(", ");

const actorNotFound = (): FolioDiagnosticError =>
  new FolioDiagnosticError({
    category: "actor",
    code: "ACTOR_NOT_FOUND",
    retryable: false,
  });

const scheduleNotFound = (): FolioDiagnosticError =>
  new FolioDiagnosticError({
    category: "validation",
    code: "RECURRING_BILL_NOT_FOUND",
    httpStatus: 404,
    retryable: false,
  });

const associationNotFound = (): FolioDiagnosticError =>
  new FolioDiagnosticError({
    category: "validation",
    code: "RECURRING_BILL_ASSOCIATION_NOT_FOUND",
    httpStatus: 404,
    retryable: false,
  });

const associationConflict = (): FolioDiagnosticError =>
  new FolioDiagnosticError({
    category: "validation",
    code: "RECURRING_BILL_ASSOCIATION_CONFLICT",
    httpStatus: 409,
    retryable: false,
  });

const linkIneligible = (): FolioDiagnosticError =>
  new FolioDiagnosticError({
    category: "validation",
    code: "RECURRING_BILL_LINK_INELIGIBLE",
    httpStatus: 422,
    retryable: false,
  });

const schedulePaused = (): FolioDiagnosticError =>
  new FolioDiagnosticError({
    category: "validation",
    code: "RECURRING_BILL_SCHEDULE_PAUSED",
    httpStatus: 409,
    retryable: false,
  });

const responsibleUserInactive = (): FolioDiagnosticError =>
  new FolioDiagnosticError({
    category: "validation",
    code: "RECURRING_BILL_RESPONSIBLE_USER_INVALID",
    httpStatus: 422,
    retryable: false,
  });

const saveRevisionMissing = (): FolioDiagnosticError =>
  new FolioDiagnosticError({
    category: "validation",
    code: "RECURRING_BILL_REVISION_REQUIRED",
    httpStatus: 409,
    retryable: false,
  });

const stringValue = (value: unknown): string => String(value);

const nullableStringValue = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

const mapScheduleRecord = (row: QueryResultRow): RecurringBillSchedule => {
  const input = recurringBillScheduleInputSchema.parse({
    label: row.label,
    counterparty: row.counterparty,
    descriptionMatchText: row.description_match_text,
    descriptionMatchMode: row.description_match_mode,
    documentCurrency: row.document_currency,
    expectedAmount:
      row.expected_amount === null || row.expected_amount === undefined
        ? null
        : String(row.expected_amount),
    frequency: row.frequency,
    anchorDate: row.anchor_date,
    daysEarly: row.days_early,
    daysLate: row.days_late,
    responsibleUserId: row.responsible_user_id,
  });

  return {
    ...input,
    id: stringValue(row.id),
    active: Boolean(row.active),
    createdById: stringValue(row.created_by_id),
    updatedById: stringValue(row.updated_by_id),
    createdAt: stringValue(row.created_at_token),
    updatedAt: stringValue(row.updated_at_token),
  };
};

const mapTransactionRecord = (
  row: QueryResultRow,
): RecurringBillTransaction => ({
  id: stringValue(row.id),
  kind: stringValue(row.kind),
  status: stringValue(row.status),
  counterparty: nullableStringValue(row.counterparty),
  description: nullableStringValue(row.description),
  documentCurrency: nullableStringValue(row.document_currency),
  documentAmount: nullableStringValue(row.document_amount),
  invoiceDate: nullableStringValue(row.invoice_date),
  occurredAt: nullableStringValue(row.occurred_at),
  settledAt: nullableStringValue(row.settled_at),
});

const mapLinkRecord = (row: QueryResultRow): RecurringBillLink => ({
  scheduleId: stringValue(row.schedule_id),
  expectedDate: stringValue(row.expected_date),
  transactionId: stringValue(row.transaction_id),
  createdById: stringValue(row.created_by_id),
  createdAt: stringValue(row.created_at_token),
});

const postgresErrorCode = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
};

export interface ListRecurringBillsInput {
  timeZone: string;
  asOfDate: string;
  unresolvedOffset?: number;
}

export interface SaveRecurringBillInput {
  id?: string;
  expectedUpdatedAt?: string;
  schedule: RecurringBillScheduleInput;
}

export interface PreviewRecurringBillMatchesInput {
  schedule: RecurringBillScheduleInput;
  timeZone: string;
  asOfDate?: string;
}

export interface SetRecurringBillActiveInput {
  id: string;
  active: boolean;
  expectedUpdatedAt: string;
}

export interface LinkRecurringBillOccurrenceInput {
  scheduleId: string;
  expectedDate: string;
  transactionId: string;
  expectedUpdatedAt: string;
  timeZone: string;
}

export interface UnlinkRecurringBillOccurrenceInput {
  scheduleId: string;
  expectedDate: string;
  expectedUpdatedAt: string;
}

export class RecurringBillRepository {
  private readonly schedulesTable: string;
  private readonly linksTable: string;
  private readonly transactionsTable: string;
  private readonly usersTable: string;

  constructor(
    private readonly pool: Pool,
    schema: string,
  ) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
      throw new Error("Invalid Folio database schema");
    this.schedulesTable = `"${schema}"."recurring_bill_schedules"`;
    this.linksTable = `"${schema}"."recurring_bill_links"`;
    this.transactionsTable = `"${schema}"."transactions"`;
    this.usersTable = `"${schema}"."users"`;
  }

  private async requireActiveActor(
    queryable: Queryable,
    actorId: string,
    lock = false,
  ): Promise<string> {
    const result = await queryable.query(
      `SELECT id FROM ${this.usersTable} WHERE id=$1 AND active=true${lock ? " FOR SHARE" : ""}`,
      [actorId],
    );
    const actor = result.rows[0];
    if (!actor) throw actorNotFound();
    return stringValue(actor.id);
  }

  private async requireActiveResponsibleUser(
    queryable: Queryable,
    userId: string | null,
  ): Promise<void> {
    if (userId === null) return;
    const result = await queryable.query(
      `SELECT id FROM ${this.usersTable} WHERE id=$1 AND active=true FOR SHARE`,
      [userId],
    );
    if (!result.rows[0]) throw responsibleUserInactive();
  }

  private async withWriteTransaction<Result>(
    actorId: string,
    operation: (client: PoolClient, activeActorId: string) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const activeActorId = await this.requireActiveActor(
        client,
        actorId,
        true,
      );
      const result = await operation(client, activeActorId);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the operation failure if PostgreSQL has already aborted the transaction.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockSchedule(
    client: PoolClient,
    scheduleId: string,
    expectedUpdatedAt: string,
  ): Promise<RecurringBillSchedule> {
    const result = await client.query(
      `SELECT ${scheduleProjection} FROM ${this.schedulesTable} WHERE id=$1 FOR UPDATE`,
      [scheduleId],
    );
    const row = result.rows[0];
    if (!row) throw scheduleNotFound();
    const schedule = mapScheduleRecord(row);
    assertExpectedRevision(schedule.updatedAt, expectedUpdatedAt);
    return schedule;
  }

  private async updateScheduleRevision(
    client: PoolClient,
    scheduleId: string,
    actorId: string,
    expectedUpdatedAt: string,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE ${this.schedulesTable} SET updated_by_id=$2, updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 microsecond') WHERE id=$1 AND updated_at=$3::timestamptz`,
      [scheduleId, actorId, expectedUpdatedAt],
    );
    if (result.rowCount !== 1) throw revisionConflictError();
  }

  async list(
    actorId: string,
    input: ListRecurringBillsInput,
  ): Promise<RecurringBillView[]> {
    await this.requireActiveActor(this.pool, actorId);
    const asOfDate = z.string().date().parse(input.asOfDate);
    const [scheduleResult, linkResult] = await Promise.all([
      this.pool.query(
        `SELECT ${scheduleProjection} FROM ${this.schedulesTable} ORDER BY active DESC, anchor_date, id`,
      ),
      this.pool.query(
        `SELECT ${linkProjection} FROM ${this.linksTable} ORDER BY schedule_id, expected_date, transaction_id`,
      ),
    ]);
    const schedules = scheduleResult.rows.map(mapScheduleRecord);
    if (schedules.length === 0) return [];

    const transactionResult = await this.pool.query(
      `SELECT ${transactionProjection} FROM ${this.transactionsTable} WHERE (kind='supplier_expense' AND status='recorded' AND counterparty IS NOT NULL AND document_currency IS NOT NULL AND (invoice_date IS NOT NULL OR occurred_at IS NOT NULL OR settled_at IS NOT NULL)) OR id IN (SELECT transaction_id FROM ${this.linksTable}) ORDER BY id`,
    );
    return buildRecurringBillViews({
      schedules,
      links: linkResult.rows.map(mapLinkRecord),
      transactions: transactionResult.rows.map(mapTransactionRecord),
      timeZone: input.timeZone,
      asOfDate,
      unresolvedOffset: input.unresolvedOffset,
    });
  }

  async suggest(
    actorId: string,
    input: { timeZone: string },
  ): Promise<RecurringBillSuggestion[]> {
    await this.requireActiveActor(this.pool, actorId);
    const result = await this.pool.query(
      `SELECT ${transactionProjection} FROM ${this.transactionsTable} WHERE kind='supplier_expense' AND status='recorded' AND counterparty IS NOT NULL AND document_currency IS NOT NULL AND (invoice_date IS NOT NULL OR occurred_at IS NOT NULL OR settled_at IS NOT NULL) ORDER BY id`,
    );
    return detectRecurringBillSuggestions(
      result.rows.map(mapTransactionRecord),
      input.timeZone,
    );
  }

  async preview(
    actorId: string,
    input: PreviewRecurringBillMatchesInput,
  ): Promise<RecurringBillMatchPreviewResult> {
    const schedule = recurringBillScheduleInputSchema.parse(input.schedule);
    await this.requireActiveActor(this.pool, actorId);
    const result = await this.pool.query(
      `SELECT ${transactionProjection} FROM ${this.transactionsTable} WHERE kind='supplier_expense' AND status='recorded' AND counterparty IS NOT NULL AND document_currency IS NOT NULL ORDER BY id`,
    );
    return previewRecurringBillMatches({
      schedule,
      transactions: result.rows.map(mapTransactionRecord),
      timeZone: input.timeZone,
      asOfDate: input.asOfDate,
    });
  }

  async listResponsibleUserOptions(
    actorId: string,
  ): Promise<Array<{ id: string; label: string }>> {
    await this.requireActiveActor(this.pool, actorId);
    const result = await this.pool.query(
      `SELECT id, display_name FROM ${this.usersTable} WHERE active=true ORDER BY lower(display_name) NULLS LAST, id`,
    );
    return result.rows.map((row) => {
      const id = stringValue(row.id);
      const displayName = nullableStringValue(row.display_name)?.trim();
      return { id, label: displayName || id };
    });
  }

  async save(
    actorId: string,
    input: SaveRecurringBillInput,
  ): Promise<RecurringBillSchedule> {
    const scheduleInput = recurringBillScheduleInputSchema.parse(
      input.schedule,
    );
    const hasId = input.id !== undefined;
    const hasRevision = input.expectedUpdatedAt !== undefined;
    if (hasId !== hasRevision) throw saveRevisionMissing();

    return this.withWriteTransaction(actorId, async (client, activeActorId) => {
      let existing: RecurringBillSchedule | null = null;
      if (hasId) {
        existing = await this.lockSchedule(
          client,
          input.id!,
          input.expectedUpdatedAt!,
        );
      }
      await this.requireActiveResponsibleUser(
        client,
        scheduleInput.responsibleUserId,
      );

      const values = [
        scheduleInput.label,
        scheduleInput.counterparty,
        scheduleInput.descriptionMatchText,
        scheduleInput.descriptionMatchMode,
        scheduleInput.documentCurrency,
        scheduleInput.expectedAmount,
        scheduleInput.frequency,
        scheduleInput.anchorDate,
        scheduleInput.daysEarly,
        scheduleInput.daysLate,
        scheduleInput.responsibleUserId,
      ];
      const result = existing
        ? await client.query(
            `UPDATE ${this.schedulesTable} SET label=$2, counterparty=$3, description_match_text=$4, description_match_mode=$5, document_currency=$6, expected_amount=$7, frequency=$8, anchor_date=$9::date, days_early=$10, days_late=$11, responsible_user_id=$12, updated_by_id=$13, updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 microsecond') WHERE id=$1 AND updated_at=$14::timestamptz RETURNING ${scheduleProjection}`,
            [existing.id, ...values, activeActorId, input.expectedUpdatedAt],
          )
        : await client.query(
            `INSERT INTO ${this.schedulesTable} (label, counterparty, description_match_text, description_match_mode, document_currency, expected_amount, frequency, anchor_date, days_early, days_late, responsible_user_id, active, created_by_id, updated_by_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,true,$12,$12) RETURNING ${scheduleProjection}`,
            [...values, activeActorId],
          );
      const row = result.rows[0];
      if (!row) throw revisionConflictError();
      if (
        existing &&
        (existing.anchorDate !== scheduleInput.anchorDate ||
          existing.frequency !== scheduleInput.frequency)
      ) {
        await client.query(
          `DELETE FROM ${this.linksTable} WHERE schedule_id=$1`,
          [existing.id],
        );
      }
      return mapScheduleRecord(row);
    });
  }

  async setActive(
    actorId: string,
    input: SetRecurringBillActiveInput,
  ): Promise<RecurringBillSchedule> {
    return this.withWriteTransaction(actorId, async (client, activeActorId) => {
      await this.lockSchedule(client, input.id, input.expectedUpdatedAt);
      const result = await client.query(
        `UPDATE ${this.schedulesTable} SET active=$2, updated_by_id=$3, updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 microsecond') WHERE id=$1 AND updated_at=$4::timestamptz RETURNING ${scheduleProjection}`,
        [input.id, input.active, activeActorId, input.expectedUpdatedAt],
      );
      const row = result.rows[0];
      if (!row) throw revisionConflictError();
      return mapScheduleRecord(row);
    });
  }

  async linkOccurrence(
    actorId: string,
    input: LinkRecurringBillOccurrenceInput,
  ): Promise<RecurringBillLink> {
    try {
      return await this.withWriteTransaction(
        actorId,
        async (client, activeActorId) => {
          const schedule = await this.lockSchedule(
            client,
            input.scheduleId,
            input.expectedUpdatedAt,
          );
          if (!schedule.active) throw schedulePaused();

          const transactionResult = await client.query(
            `SELECT ${transactionProjection} FROM ${this.transactionsTable} WHERE id=$1 FOR UPDATE`,
            [input.transactionId],
          );
          const transactionRow = transactionResult.rows[0];
          if (!transactionRow) throw linkIneligible();
          const transaction = mapTransactionRecord(transactionRow);
          if (
            !isRecurringBillTransactionEligible(
              schedule,
              input.expectedDate,
              transaction,
              input.timeZone,
            )
          ) {
            throw linkIneligible();
          }

          const result = await client.query(
            `INSERT INTO ${this.linksTable} (schedule_id, expected_date, transaction_id, created_by_id) VALUES ($1,$2::date,$3,$4) RETURNING ${linkProjection}`,
            [
              input.scheduleId,
              input.expectedDate,
              input.transactionId,
              activeActorId,
            ],
          );
          const row = result.rows[0];
          if (!row) throw associationConflict();
          await this.updateScheduleRevision(
            client,
            schedule.id,
            activeActorId,
            input.expectedUpdatedAt,
          );
          return mapLinkRecord(row);
        },
      );
    } catch (error) {
      if (postgresErrorCode(error) === "23505") throw associationConflict();
      throw error;
    }
  }

  async unlinkOccurrence(
    actorId: string,
    input: UnlinkRecurringBillOccurrenceInput,
  ): Promise<void> {
    await this.withWriteTransaction(actorId, async (client, activeActorId) => {
      const schedule = await this.lockSchedule(
        client,
        input.scheduleId,
        input.expectedUpdatedAt,
      );
      const existing = await client.query(
        `SELECT schedule_id FROM ${this.linksTable} WHERE schedule_id=$1 AND expected_date=$2::date FOR UPDATE`,
        [input.scheduleId, input.expectedDate],
      );
      if (!existing.rows[0]) throw associationNotFound();

      const removed = await client.query(
        `DELETE FROM ${this.linksTable} WHERE schedule_id=$1 AND expected_date=$2::date`,
        [input.scheduleId, input.expectedDate],
      );
      if (removed.rowCount !== 1) throw associationNotFound();
      await this.updateScheduleRevision(
        client,
        schedule.id,
        activeActorId,
        input.expectedUpdatedAt,
      );
    });
  }
}
