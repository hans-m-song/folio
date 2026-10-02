import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  classifyStripeReportingCategory,
  formatStripeImportFilename,
  type StripeImportRow,
  type StripeImportPreviewStatus,
} from "../domain/stripe-csv";
import {
  assertExpectedRevision,
  revisionConflictError,
} from "../domain/revisions";
import {
  bulkTransactionRequestSchema,
  type BulkTransactionChange,
  type BulkTransactionPreview,
  type BulkTransactionPreviewRow,
  type BulkTransactionRequest,
  type BulkTransactionResult,
} from "../domain/bulk-transactions";
import type {
  EntrySuggestions,
  TransactionArtifactRecord,
  TransactionInput,
  TransactionRecord,
  User,
} from "../domain/types";
import {
  isInvoiceEvidenceProfile,
  legacyArtifactKind,
  legacyArtifactProfile,
  type ArtifactProfile,
} from "../artifacts/profiles";
import {
  assertStatusTransition,
  assertTransactionRules,
} from "../domain/workflow";
import type { ManualTransactionAction } from "../domain/manual-transaction";
import {
  artifactProfileOf,
  ArtifactUploadIdempotencyConflictError,
  type ArtifactRecord,
  type ArtifactRepository,
} from "../documents/service";
import { FolioDiagnosticError } from "../domain/diagnostics";
import { manualCashEffectAudMinor } from "../domain/cash-effect";
import { parseDecimal } from "../domain/money";
import { invoiceExpectedKinds } from "../domain/invoice-status";
import type {
  CsvDuplicateIdentitySet,
  CsvDuplicateProfile,
  CsvDuplicateRowIdentity,
} from "../domain/csv-duplicates";
import { requiredMigrationIds } from "./migrations";

type Queryable = Pick<Pool | PoolClient, "query">;

const bankMatchEditConflict = () =>
  new FolioDiagnosticError({
    category: "validation",
    code: "BANK_MATCH_EDIT_CONFLICT",
    httpStatus: 409,
    retryable: false,
  });

const bulkTransactionConflict = () =>
  new FolioDiagnosticError({
    category: "validation",
    code: "BULK_TRANSACTION_CONFLICT",
    httpStatus: 409,
    retryable: false,
  });

const bulkTransactionIneligible = () =>
  new FolioDiagnosticError({
    category: "validation",
    code: "BULK_TRANSACTION_INELIGIBLE",
    httpStatus: 422,
    retryable: false,
  });

const bulkOwnerInactive = () =>
  new FolioDiagnosticError({
    category: "validation",
    code: "BULK_OWNER_INACTIVE",
    httpStatus: 422,
    retryable: false,
  });

type BulkTransactionRow = QueryResultRow & {
  id: string;
  owner_id: string | null;
  counterparty: string | null;
  category: string | null;
  reference: string | null;
  description: string | null;
  kind: TransactionRecord["kind"];
  status: TransactionRecord["status"];
  source_system: TransactionRecord["sourceSystem"];
  updated_at_token: string;
};

const bulkTransactionValue = (
  row: BulkTransactionRow,
  field: BulkTransactionChange["field"],
): string | null => {
  if (field === "ownerId") return row.owner_id;
  return row[field];
};

const bulkTransactionPreviewRow = (
  row: BulkTransactionRow,
  change: BulkTransactionChange,
): BulkTransactionPreviewRow => {
  const beforeValue = bulkTransactionValue(row, change.field);
  const changed =
    change.field === "ownerId"
      ? beforeValue?.toLowerCase() !== change.value.toLowerCase()
      : beforeValue !== change.value;

  return {
    id: row.id,
    updatedAt: row.updated_at_token,
    counterparty: row.counterparty,
    category: row.category,
    ownerId: row.owner_id,
    reference: row.reference,
    description: row.description,
    kind: row.kind,
    status: row.status,
    sourceSystem: row.source_system,
    beforeValue,
    afterValue: change.value,
    changed,
  };
};

const assertBulkTransactionSelection = (
  rows: BulkTransactionRow[],
  request: BulkTransactionRequest,
): Map<string, BulkTransactionRow> => {
  const rowsById = new Map(
    rows.map((row) => [String(row.id).toLowerCase(), row]),
  );
  if (
    rowsById.size !== request.transactions.length ||
    request.transactions.some(({ id }) => !rowsById.has(id.toLowerCase()))
  )
    throw bulkTransactionIneligible();

  if (
    rows.some(
      (row) =>
        (row.status !== "draft" && row.status !== "recorded") ||
        (row.source_system !== "manual" && row.source_system !== "stripe"),
    )
  )
    throw bulkTransactionIneligible();

  for (const selected of request.transactions) {
    const row = rowsById.get(selected.id.toLowerCase())!;
    try {
      assertExpectedRevision(row.updated_at_token, selected.updatedAt);
    } catch (error) {
      if (
        error instanceof FolioDiagnosticError &&
        error.code === "REVISION_CONFLICT"
      )
        throw bulkTransactionConflict();
      throw error;
    }
  }

  return rowsById;
};

export type TransactionQueryFilter =
  | {
      field: "counterparty" | "description";
      operator: "equals" | "not_equals" | "contains" | "not_contains";
      value: string;
    }
  | {
      field: "date" | "amount";
      operator:
        | "equals"
        | "not_equals"
        | "greater_than"
        | "greater_than_or_equal"
        | "less_than"
        | "less_than_or_equal";
      value: string;
    }
  | {
      field:
        | "kind"
        | "status"
        | "source"
        | "settlement"
        | "evidence"
        | "invoice";
      operator: "is" | "is_not" | "contains_any" | "contains_none";
      value: string | string[];
    };

export interface TransactionPageQuery {
  search: string;
  filters: readonly TransactionQueryFilter[];
  sort: {
    key: "date" | "counterparty" | "amount" | "state";
    direction: "asc" | "desc";
  };
  sortClauses?: readonly {
    key: "date" | "counterparty" | "amount" | "state";
    direction: "asc" | "desc";
  }[];
  page: number;
  reportingTimezone: string;
}

export type CsvDuplicateWarningReason =
  | "same_checksum"
  | "same_filename"
  | "overlapping_rows";

export interface CsvDuplicateWarningGroup {
  reason: CsvDuplicateWarningReason;
  totalArtifactCount: number;
  truncated: boolean;
  matches: {
    artifactId: string;
    filename: string;
    matchingRowCount: number | null;
  }[];
}

export interface CsvDuplicateWarningReport {
  artifactId: string;
  profile: CsvDuplicateProfile;
  rowCount: number;
  rowIdentityLimitReached: boolean;
  warnings: CsvDuplicateWarningGroup[];
}

export interface TransactionPage {
  rows: TransactionRecord[];
  total: number;
  page: number;
  pageSize: 50;
}

export interface TransactionOverviewSummary {
  missingInvoiceOrCreditNoteCount: number;
  pendingImportUploads: number;
  abandonedImportUploads: number;
  recentTransactions: {
    id: string;
    kind: TransactionRecord["kind"];
    status: TransactionRecord["status"];
    sourceSystem: TransactionRecord["sourceSystem"];
    updatedAt: string;
  }[];
}

const updatedAtTokenProjection = (column: string): string =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_token`;

const timestampValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? String(value) : parsed.toISOString();
};

const textValue = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

const dateTextValue = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) return null;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

const invoiceDateTextProjection = (column: string): string =>
  `${column}::text AS invoice_date_text`;

const linkedArtifactJoin = (
  transactionArtifactsTable: string,
  artifactsTable: string,
): string =>
  `LEFT JOIN LATERAL (SELECT (array_agg(linked_artifact.id ORDER BY linked_artifact.id))[1] AS source_artifact_id, (array_agg(linked_artifact.filename ORDER BY linked_artifact.id))[1] AS filename, coalesce(jsonb_agg(jsonb_build_object('id', linked_artifact.id, 'artifact_profile', linked_artifact.artifact_profile, 'filename', linked_artifact.filename, 'state', linked_artifact.state, 'metadata', links.metadata) ORDER BY linked_artifact.id), '[]'::jsonb) AS source_artifacts FROM ${transactionArtifactsTable} links JOIN ${artifactsTable} linked_artifact ON linked_artifact.id = links.source_artifact_id WHERE links.transaction_id = transactions.id) artifacts ON true`;

const invoiceStatusSql = (
  transactionArtifactsTable: string,
  artifactsTable: string,
): string =>
  `CASE WHEN transactions.kind NOT IN (${invoiceExpectedKinds.map((kind) => `'${kind}'`).join(", ")}) THEN 'not_expected' WHEN EXISTS (SELECT 1 FROM ${transactionArtifactsTable} invoice_link JOIN ${artifactsTable} invoice_artifact ON invoice_artifact.id=invoice_link.source_artifact_id WHERE invoice_link.transaction_id=transactions.id AND invoice_artifact.artifact_profile='manual_invoice_pdf_v1' AND invoice_artifact.state='available') THEN 'attached' ELSE 'missing' END`;

const sameStripeImport = (
  existing: QueryResultRow,
  row: StripeImportRow,
  kind: TransactionRecord["kind"],
): boolean => {
  const metadata =
    existing.metadata && typeof existing.metadata === "object"
      ? (existing.metadata as Record<string, unknown>)
      : {};
  return (
    existing.kind === kind &&
    textValue(existing.description) === row.description &&
    timestampValue(existing.occurred_at) === row.occurredAt &&
    timestampValue(existing.available_at) === row.availableAt &&
    textValue(existing.source_currency) === row.sourceCurrency &&
    textValue(existing.source_gross) === row.sourceGross &&
    textValue(existing.source_fee) === row.sourceFee &&
    textValue(existing.source_net) === row.sourceNet &&
    metadata.reportingCategory === row.reportingCategory
  );
};

function mapTransaction(row: QueryResultRow): TransactionRecord {
  const sourceArtifacts: TransactionArtifactRecord[] = Array.isArray(
    row.source_artifacts,
  )
    ? row.source_artifacts.map((artifact: Record<string, unknown>) => ({
        id: String(artifact.id),
        artifactProfile: artifact.artifact_profile as ArtifactProfile,
        filename: String(artifact.filename),
        state: artifact.state as TransactionArtifactRecord["state"],
        metadata:
          artifact.metadata && typeof artifact.metadata === "object"
            ? (artifact.metadata as Record<
                string,
                string | number | boolean | null
              >)
            : null,
      }))
    : [];
  return {
    id: row.id,
    ownerId: row.owner_id,
    sourceArtifactId: row.source_artifact_id,
    sourceArtifactFilename: row.source_artifact_filename ?? null,
    sourceArtifacts,
    createdById: row.created_by_id,
    updatedById: row.updated_by_id,
    sourceSystem: row.source_system,
    kind: row.kind,
    reference: row.reference,
    counterparty: row.counterparty,
    description: row.description,
    status: row.status,
    category: row.category,
    notes: row.notes,
    occurredAt: row.occurred_at?.toISOString() ?? null,
    availableAt: row.available_at?.toISOString() ?? null,
    invoiceDate: dateTextValue(row.invoice_date_text ?? row.invoice_date),
    settledAt: row.settled_at?.toISOString() ?? null,
    documentCurrency: row.document_currency,
    documentAmount: row.document_amount,
    documentTaxAmount: row.document_tax_amount,
    taxTreatment: row.tax_treatment ?? "unknown_mixed",
    settlementCurrency: row.settlement_currency,
    settlementAmount: row.settlement_amount,
    gstCreditStatus: row.gst_credit_status,
    claimableGstAud: row.claimable_gst_aud,
    sourceCurrency: row.source_currency,
    sourceGross: row.source_gross,
    sourceFee: row.source_fee,
    sourceNet: row.source_net,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at_token,
  };
}

function mapArtifact(row: QueryResultRow): ArtifactRecord {
  const artifactProfile =
    row.artifact_profile ??
    (row.kind ? legacyArtifactProfile(row.kind as "pdf" | "stripe_csv") : null);
  return {
    id: row.id,
    artifactProfile: artifactProfile ?? undefined,
    kind: artifactProfile
      ? legacyArtifactKind(artifactProfile as ArtifactProfile)
      : row.kind,
    objectKey: row.object_key,
    versionId: row.version_id,
    mediaType: row.media_type,
    filename: row.filename,
    originalFilename: row.original_filename ?? undefined,
    byteSize: String(row.byte_size),
    checksumSha256: row.checksum_sha256,
    state: row.state,
  };
}

export class FolioRepository implements ArtifactRepository {
  private readonly usersTable: string;
  private readonly transactionsTable: string;
  private readonly artifactsTable: string;
  private readonly transactionArtifactsTable: string;
  private readonly bankTransactionArtifactsTable: string;
  private readonly bankTransactionsTable: string;
  private readonly migrationsTable: string;
  private readonly mcpCredentialsTable: string;
  private readonly mcpSubmissionsTable: string;
  private readonly mcpUploadIntentsTable: string;
  private readonly schema: string;

  constructor(
    private readonly pool: Pool,
    schema: string,
    private readonly gstRegistered: boolean,
  ) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
      throw new Error("Invalid Folio database schema");
    this.schema = schema;
    this.usersTable = `"${schema}"."users"`;
    this.transactionsTable = `"${schema}"."transactions"`;
    this.artifactsTable = `"${schema}"."source_artifacts"`;
    this.transactionArtifactsTable = `"${schema}"."transaction_artifacts"`;
    this.bankTransactionArtifactsTable = `"${schema}"."bank_transaction_artifacts"`;
    this.bankTransactionsTable = `"${schema}"."bank_transactions"`;
    this.migrationsTable = `"${schema}"."_migrations"`;
    this.mcpCredentialsTable = `"${schema}"."mcp_credentials"`;
    this.mcpSubmissionsTable = `"${schema}"."mcp_submissions"`;
    this.mcpUploadIntentsTable = `"${schema}"."mcp_upload_intents"`;
  }

  private async actor(queryable: Queryable, email: string): Promise<User> {
    const result = await queryable.query(
      `SELECT id, email, display_name, role, active FROM ${this.usersTable} WHERE lower(email) = lower($1) AND active = true`,
      [email],
    );
    const row = result.rows[0];
    if (!row)
      throw new FolioDiagnosticError({
        category: "actor",
        code: "ACTOR_NOT_FOUND",
        retryable: false,
      });
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      active: row.active,
    };
  }

  async requireActiveActor(email: string): Promise<void> {
    await this.actor(this.pool, email);
  }

  private async actorById(queryable: Queryable, id: string): Promise<User> {
    const result = await queryable.query(
      `SELECT id, email, display_name, role, active FROM ${this.usersTable} WHERE id = $1 AND active = true`,
      [id],
    );
    const row = result.rows[0];
    if (!row)
      throw new FolioDiagnosticError({
        category: "actor",
        code: "ACTOR_NOT_FOUND",
        retryable: false,
      });
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      active: row.active,
    };
  }

  private async requireBulkActor(
    queryable: Queryable,
    id: string,
  ): Promise<string> {
    const result = await queryable.query(
      `SELECT id FROM ${this.usersTable} WHERE id = $1 AND active = true`,
      [id],
    );
    const actorId = result.rows[0]?.id;
    if (!actorId)
      throw new FolioDiagnosticError({
        category: "actor",
        code: "ACTOR_NOT_FOUND",
        retryable: false,
      });
    return String(actorId);
  }

  private async requireBulkOwner(
    queryable: Queryable,
    id: string,
    lock: boolean,
  ): Promise<void> {
    const result = await queryable.query(
      `SELECT id FROM ${this.usersTable} WHERE id = $1 AND active = true${lock ? " FOR SHARE" : ""}`,
      [id],
    );
    if (!result.rows[0]) throw bulkOwnerInactive();
  }

  private async bulkTransactionRows(
    queryable: Queryable,
    request: BulkTransactionRequest,
    lock: boolean,
  ): Promise<BulkTransactionRow[]> {
    const result = await queryable.query(
      `SELECT id, owner_id, counterparty, category, reference, description, kind, status, source_system, ${updatedAtTokenProjection("updated_at")} FROM ${this.transactionsTable} WHERE id = ANY($1::uuid[]) ORDER BY id${lock ? " FOR UPDATE" : ""}`,
      [request.transactions.map(({ id }) => id)],
    );
    return result.rows as BulkTransactionRow[];
  }

  async requireActiveActorId(id: string): Promise<void> {
    await this.actorById(this.pool, id);
  }

  async health(): Promise<void> {
    const tables = await this.pool.query(
      "SELECT to_regclass($1) AS users, to_regclass($2) AS transactions, to_regclass($3) AS source_artifacts, to_regclass($4) AS transaction_artifacts, to_regclass($5) AS migrations, to_regclass($6) AS auth_attempts, to_regclass($7) AS auth_sessions, to_regclass($8) AS bank_transactions, to_regclass($9) AS bank_transaction_artifacts, to_regclass($10) AS recurring_bill_schedules, to_regclass($11) AS recurring_bill_links",
      [
        `${this.schema}.users`,
        `${this.schema}.transactions`,
        `${this.schema}.source_artifacts`,
        `${this.schema}.transaction_artifacts`,
        `${this.schema}._migrations`,
        `${this.schema}.auth_attempts`,
        `${this.schema}.auth_sessions`,
        `${this.schema}.bank_transactions`,
        `${this.schema}.bank_transaction_artifacts`,
        `${this.schema}.recurring_bill_schedules`,
        `${this.schema}.recurring_bill_links`,
      ],
    );
    const row = tables.rows[0];
    if (!row || Object.values(row).some((value) => value === null))
      throw new Error("Folio database schema is incomplete");
    const migration = await this.pool.query(
      `SELECT id FROM ${this.migrationsTable} WHERE id = ANY($1::text[])`,
      [[...requiredMigrationIds]],
    );
    if (migration.rowCount !== requiredMigrationIds.length)
      throw new Error("Required Folio migrations are not applied");
  }

  async listUsers(actorId: string): Promise<User[]> {
    await this.actorById(this.pool, actorId);
    const result = await this.pool.query(
      `SELECT id, email, display_name, role, active FROM ${this.usersTable} ORDER BY lower(email), id`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      active: row.active,
    }));
  }

  async listTaxPartnerOptions(
    actorId: string,
  ): Promise<Array<{ id: string; label: string }>> {
    await this.actorById(this.pool, actorId);
    const result = await this.pool.query(
      `SELECT id, display_name FROM ${this.usersTable} WHERE active=true ORDER BY lower(display_name) NULLS LAST, id`,
    );
    const options = result.rows.map((row) => ({
      id: String(row.id),
      label: String(row.display_name ?? "").trim(),
    }));
    const labelCounts = new Map<string, number>();
    for (const option of options) {
      const key = option.label.toLocaleLowerCase("en-AU");
      labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
    }
    return options.map(({ id, label }) => ({
      id,
      label:
        !label || (labelCounts.get(label.toLocaleLowerCase("en-AU")) ?? 0) > 1
          ? `${label || "User"} (${id})`
          : label,
    }));
  }

  async invoiceDuplicateHints(
    actorId: string,
    artifactId: string,
    reference: string | null,
    checksumSha256: string,
  ): Promise<{
    linkedTransactions: number;
    matchingReferenceTransactions: number;
    matchingChecksumArtifacts: number;
  }> {
    await this.actorById(this.pool, actorId);
    const result = await this.pool.query(
      `SELECT
        (SELECT count(*)::integer FROM ${this.transactionArtifactsTable} link JOIN ${this.transactionsTable} transaction ON transaction.id=link.transaction_id WHERE link.source_artifact_id=$1 AND transaction.status<>'void') AS linked_transactions,
        (SELECT count(*)::integer FROM ${this.transactionsTable} transaction WHERE $2::text IS NOT NULL AND btrim(transaction.reference)=btrim($2) AND transaction.status<>'void') AS matching_reference_transactions,
        (SELECT count(*)::integer FROM ${this.artifactsTable} artifact WHERE artifact.id<>$1 AND artifact.artifact_profile='manual_invoice_pdf_v1' AND artifact.state IN ('awaiting_review','available') AND artifact.checksum_sha256=$3) AS matching_checksum_artifacts`,
      [artifactId, reference, checksumSha256],
    );
    const row = result.rows[0];
    return {
      linkedTransactions: Number(row?.linked_transactions ?? 0),
      matchingReferenceTransactions: Number(
        row?.matching_reference_transactions ?? 0,
      ),
      matchingChecksumArtifacts: Number(row?.matching_checksum_artifacts ?? 0),
    };
  }

  async listEntrySuggestions(actorId: string): Promise<EntrySuggestions> {
    await this.actorById(this.pool, actorId);
    const [counterparties, categories, supplierCategories] = await Promise.all([
      this.pool.query(
        `SELECT value FROM (SELECT DISTINCT btrim(counterparty) AS value FROM ${this.transactionsTable} WHERE status <> 'void' AND counterparty IS NOT NULL AND btrim(counterparty) <> '') values ORDER BY lower(value), value LIMIT 200`,
      ),
      this.pool.query(
        `SELECT value FROM (SELECT DISTINCT btrim(category) AS value FROM ${this.transactionsTable} WHERE status <> 'void' AND category IS NOT NULL AND btrim(category) <> '') values ORDER BY lower(value), value LIMIT 200`,
      ),
      this.pool.query(
        `SELECT counterparty, category FROM (SELECT DISTINCT ON (btrim(counterparty), btrim(category)) btrim(counterparty) AS counterparty, btrim(category) AS category, updated_at, id FROM ${this.transactionsTable} WHERE source_system='manual' AND status <> 'void' AND kind IN ('supplier_expense', 'supplier_credit') AND counterparty IS NOT NULL AND btrim(counterparty) <> '' AND category IS NOT NULL AND btrim(category) <> '' ORDER BY btrim(counterparty), btrim(category), updated_at DESC, id DESC) pairs ORDER BY updated_at DESC, id DESC LIMIT 200`,
      ),
    ]);
    return {
      counterparties: counterparties.rows.map((row) => row.value),
      categories: categories.rows.map((row) => row.value),
      supplierCategories: supplierCategories.rows.map((row) => ({
        counterparty: row.counterparty,
        category: row.category,
      })),
    };
  }

  async createUser(
    actorId: string,
    input: { email: string; displayName: string | null; role: User["role"] },
  ): Promise<User> {
    await this.actorById(this.pool, actorId);
    const result = await this.pool.query(
      `INSERT INTO ${this.usersTable} (email, display_name, role) VALUES ($1, $2, $3) RETURNING id, email, display_name, role, active`,
      [input.email, input.displayName, input.role],
    );
    const row = result.rows[0]!;
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      active: row.active,
    };
  }

  async updateUser(
    actorId: string,
    id: string,
    input: { role: User["role"]; active: boolean },
  ): Promise<void> {
    await this.actorById(this.pool, actorId);
    const result = await this.pool.query(
      `UPDATE ${this.usersTable} SET role = $2, active = $3 WHERE id = $1`,
      [id, input.role, input.active],
    );
    if (result.rowCount !== 1) throw new Error("User not found");
  }

  async listTransactions(
    actorId: string,
    search = "",
  ): Promise<TransactionRecord[]> {
    await this.actorById(this.pool, actorId);
    const needle = search.trim();
    const result = await this.pool.query(
      `SELECT transactions.*, ${invoiceDateTextProjection("transactions.invoice_date")}, artifacts.source_artifact_id, artifacts.filename AS source_artifact_filename, artifacts.source_artifacts, ${updatedAtTokenProjection("transactions.updated_at")} FROM ${this.transactionsTable} transactions ${linkedArtifactJoin(this.transactionArtifactsTable, this.artifactsTable)} WHERE $1 = '' OR transactions.reference ILIKE '%' || $1 || '%' OR transactions.counterparty ILIKE '%' || $1 || '%' OR transactions.description ILIKE '%' || $1 || '%' ORDER BY coalesce(transactions.invoice_date, transactions.occurred_at::date) DESC NULLS LAST, transactions.id`,
      [needle],
    );
    return result.rows.map(mapTransaction);
  }

  async previewBulkTransactionEdit(
    actorId: string,
    request: BulkTransactionRequest,
  ): Promise<BulkTransactionPreview> {
    const parsedRequest = bulkTransactionRequestSchema.parse(request);
    await this.requireBulkActor(this.pool, actorId);
    const rows = await this.bulkTransactionRows(
      this.pool,
      parsedRequest,
      false,
    );
    const rowsById = assertBulkTransactionSelection(rows, parsedRequest);

    if (parsedRequest.change.field === "ownerId")
      await this.requireBulkOwner(this.pool, parsedRequest.change.value, false);

    const previewRows = parsedRequest.transactions.map(({ id }) =>
      bulkTransactionPreviewRow(
        rowsById.get(id.toLowerCase())!,
        parsedRequest.change,
      ),
    );
    return {
      change: parsedRequest.change,
      rows: previewRows,
      changedCount: previewRows.filter(({ changed }) => changed).length,
    };
  }

  async applyBulkTransactionEdit(
    actorId: string,
    request: BulkTransactionRequest,
  ): Promise<BulkTransactionResult> {
    const parsedRequest = bulkTransactionRequestSchema.parse(request);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const activeActorId = await this.requireBulkActor(client, actorId);
      const rows = await this.bulkTransactionRows(client, parsedRequest, true);
      const rowsById = assertBulkTransactionSelection(rows, parsedRequest);

      if (parsedRequest.change.field === "ownerId")
        await this.requireBulkOwner(client, parsedRequest.change.value, true);

      const changedIds = parsedRequest.transactions
        .map(({ id }) => rowsById.get(id.toLowerCase())!)
        .filter(
          (row) => bulkTransactionPreviewRow(row, parsedRequest.change).changed,
        )
        .map(({ id }) => id);

      if (changedIds.length > 0) {
        const column =
          parsedRequest.change.field === "ownerId"
            ? "owner_id"
            : parsedRequest.change.field;
        const valueType =
          parsedRequest.change.field === "ownerId" ? "uuid" : "text";
        const update = await client.query(
          `UPDATE ${this.transactionsTable} SET ${column}=$2::${valueType}, updated_by_id=$3::uuid, updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 microsecond') WHERE id = ANY($1::uuid[])`,
          [changedIds, parsedRequest.change.value, activeActorId],
        );
        if (update.rowCount !== changedIds.length)
          throw bulkTransactionConflict();
      }

      await client.query("COMMIT");
      return {
        selectedCount: parsedRequest.transactions.length,
        updatedCount: changedIds.length,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listTransactionPage(
    actorId: string,
    input: TransactionPageQuery,
  ): Promise<TransactionPage> {
    await this.actorById(this.pool, actorId);
    const parameters: unknown[] = [
      input.search.trim(),
      input.reportingTimezone,
    ];
    const parameter = (value: unknown): string => {
      parameters.push(value);
      return `$${parameters.length}`;
    };
    const effectiveDate = `CASE WHEN transactions.source_system='stripe'
      THEN (coalesce(transactions.occurred_at, transactions.available_at, transactions.settled_at, transactions.created_at) AT TIME ZONE $2)::date
      ELSE coalesce(transactions.invoice_date, (transactions.occurred_at AT TIME ZONE $2)::date, (transactions.settled_at AT TIME ZONE $2)::date, (transactions.created_at AT TIME ZONE $2)::date) END`;
    const effectiveTimestamp = `CASE WHEN transactions.source_system='stripe'
      THEN coalesce(transactions.occurred_at, transactions.available_at, transactions.settled_at, transactions.created_at)
      ELSE coalesce(transactions.invoice_date::timestamp AT TIME ZONE $2, transactions.occurred_at, transactions.settled_at, transactions.created_at) END`;
    const signedAmount = `CASE
      WHEN transactions.source_system='stripe' AND transactions.source_currency='AUD'
        THEN coalesce(transactions.source_net, transactions.source_gross)
      WHEN transactions.source_system='stripe' THEN
        coalesce(
          CASE
            WHEN transactions.settlement_currency='AUD' THEN CASE
              WHEN transactions.kind IN ('supplier_expense', 'processing_fee', 'sale_refund', 'dispute', 'owner_loan_repayment') THEN -transactions.settlement_amount
              ELSE transactions.settlement_amount
            END
            WHEN transactions.document_currency='AUD' THEN CASE
              WHEN transactions.kind IN ('supplier_expense', 'processing_fee', 'sale_refund', 'dispute', 'owner_loan_repayment') THEN -transactions.document_amount
              ELSE transactions.document_amount
            END
          END,
          coalesce(transactions.source_net, transactions.source_gross)
        )
      ELSE coalesce(
        CASE
          WHEN transactions.status='recorded' AND transactions.settled_at IS NOT NULL AND transactions.settlement_currency='AUD' THEN CASE
            WHEN transactions.kind IN ('sale', 'supplier_credit', 'owner_contribution', 'owner_loan') THEN transactions.settlement_amount
            WHEN transactions.kind IN ('supplier_expense', 'processing_fee', 'sale_refund', 'owner_loan_repayment') THEN -transactions.settlement_amount
          END
        END,
        CASE
          WHEN transactions.document_currency='AUD' THEN CASE
            WHEN transactions.kind IN ('supplier_expense', 'processing_fee', 'sale_refund', 'dispute', 'owner_loan_repayment') THEN -transactions.document_amount
            ELSE transactions.document_amount
          END
          WHEN transactions.settlement_currency='AUD' THEN CASE
            WHEN transactions.kind IN ('supplier_expense', 'processing_fee', 'sale_refund', 'dispute', 'owner_loan_repayment') THEN -transactions.settlement_amount
            ELSE transactions.settlement_amount
          END
        END
      )
    END`;
    const counterparty = `coalesce(nullif(btrim(transactions.counterparty), ''), CASE WHEN transactions.source_system='stripe' THEN 'Stripe' ELSE '—' END)`;
    const kindLabel = `CASE transactions.kind
      WHEN 'sale' THEN 'Sale'
      WHEN 'supplier_expense' THEN 'Supplier expense'
      WHEN 'processing_fee' THEN 'Processing fee'
      WHEN 'sale_refund' THEN 'Sale refund'
      WHEN 'supplier_credit' THEN 'Supplier credit'
      WHEN 'dispute' THEN 'Dispute'
      WHEN 'transfer' THEN 'Transfer'
      WHEN 'owner_contribution' THEN 'Owner contribution'
      WHEN 'owner_loan' THEN 'Owner loan to business'
      WHEN 'owner_loan_repayment' THEN 'Owner loan repayment'
      ELSE 'Adjustment' END`;
    const description = `coalesce(nullif(btrim(transactions.description), ''), ${kindLabel})`;
    const settlement = `CASE
      WHEN transactions.source_system='manual' AND transactions.status='recorded' AND transactions.settled_at IS NOT NULL AND transactions.settlement_amount IS NOT NULL AND transactions.settlement_currency IS NOT NULL THEN 'settled'
      WHEN transactions.source_system='manual' AND transactions.status='recorded' THEN 'pending'
      ELSE 'not_applicable' END`;
    const evidence = `CASE WHEN EXISTS (SELECT 1 FROM ${this.transactionArtifactsTable} evidence_link WHERE evidence_link.transaction_id=transactions.id) THEN 'attached' ELSE 'missing' END`;
    const invoice = invoiceStatusSql(
      this.transactionArtifactsTable,
      this.artifactsTable,
    );
    const state = `initcap(transactions.status) || CASE ${settlement} WHEN 'settled' THEN ' · Settled' WHEN 'pending' THEN ' · Pending settlement' ELSE '' END`;
    const conditions = [
      `($1::text = '' OR transactions.reference ILIKE '%' || $1 || '%' OR transactions.counterparty ILIKE '%' || $1 || '%' OR transactions.description ILIKE '%' || $1 || '%')`,
      "$2::text IS NOT NULL",
    ];

    for (const filter of input.filters) {
      if (filter.field === "counterparty" || filter.field === "description") {
        const placeholder = parameter(filter.value);
        const expression =
          filter.field === "counterparty" ? counterparty : description;
        const operators = {
          equals: `lower(${expression}) = lower(${placeholder})`,
          not_equals: `lower(${expression}) <> lower(${placeholder})`,
          contains: `${expression} ILIKE '%' || ${placeholder} || '%'`,
          not_contains: `${expression} NOT ILIKE '%' || ${placeholder} || '%'`,
        } as const;
        conditions.push(operators[filter.operator]);
        continue;
      }
      if (filter.field === "date" || filter.field === "amount") {
        const placeholder = parameter(filter.value);
        const expression =
          filter.field === "date" ? effectiveDate : signedAmount;
        const cast = filter.field === "date" ? "date" : "numeric";
        const operators = {
          equals: "=",
          not_equals: "<>",
          greater_than: ">",
          greater_than_or_equal: ">=",
          less_than: "<",
          less_than_or_equal: "<=",
        } as const;
        conditions.push(
          `${expression} ${operators[filter.operator]} ${placeholder}::${cast}`,
        );
        continue;
      }
      const expressions = {
        kind: "transactions.kind",
        status: "transactions.status",
        source: "transactions.source_system",
        settlement,
        evidence,
        invoice,
      } as const;
      if (
        filter.operator === "contains_any" ||
        filter.operator === "contains_none"
      ) {
        if (!Array.isArray(filter.value) || filter.value.length === 0) continue;
        const placeholder = parameter(filter.value);
        conditions.push(
          filter.operator === "contains_any"
            ? `${expressions[filter.field]} = ANY(${placeholder}::text[])`
            : `${expressions[filter.field]} <> ALL(${placeholder}::text[])`,
        );
        continue;
      }
      if (Array.isArray(filter.value)) continue;
      const placeholder = parameter(filter.value);
      conditions.push(
        `${expressions[filter.field]} ${filter.operator === "is" ? "=" : "<>"} ${placeholder}`,
      );
    }

    const sortExpressions = {
      date: effectiveTimestamp,
      counterparty: `lower(${counterparty})`,
      amount: signedAmount,
      state: `lower(${state})`,
    } as const;
    const usedSortKeys = new Set<TransactionPageQuery["sort"]["key"]>();
    const sortClauses = (
      input.sortClauses?.length ? input.sortClauses : [input.sort]
    ).filter((clause) => {
      if (usedSortKeys.has(clause.key)) return false;
      usedSortKeys.add(clause.key);
      return true;
    });
    const sortOrder = sortClauses
      .map(
        (clause) =>
          `${sortExpressions[clause.key]} ${clause.direction === "asc" ? "ASC" : "DESC"} NULLS LAST`,
      )
      .join(", ");
    const tieDirection = sortClauses[0]?.direction === "asc" ? "ASC" : "DESC";
    const where = `WHERE ${conditions.join(" AND ")}`;
    const count = await this.pool.query(
      `SELECT count(*)::integer AS total FROM ${this.transactionsTable} transactions ${where}`,
      parameters,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    const pageCount = Math.max(1, Math.ceil(total / 50));
    const page = Math.min(input.page, pageCount);
    const pageParameters = [...parameters, (page - 1) * 50];
    const result = await this.pool.query(
      `SELECT transactions.*, ${invoiceDateTextProjection("transactions.invoice_date")}, artifacts.source_artifact_id, artifacts.filename AS source_artifact_filename, artifacts.source_artifacts, ${updatedAtTokenProjection("transactions.updated_at")} FROM ${this.transactionsTable} transactions ${linkedArtifactJoin(this.transactionArtifactsTable, this.artifactsTable)} ${where} ORDER BY ${sortOrder}, transactions.id ${tieDirection} LIMIT 50 OFFSET $${pageParameters.length}`,
      pageParameters,
    );
    return {
      rows: result.rows.map(mapTransaction),
      total,
      page,
      pageSize: 50,
    };
  }

  async transactionOverviewSummary(
    actorId: string,
  ): Promise<TransactionOverviewSummary> {
    await this.actorById(this.pool, actorId);
    const [count, recent] = await Promise.all([
      this.pool.query(
        `SELECT
          count(*) FILTER (WHERE transactions.status='recorded' AND (${invoiceStatusSql(this.transactionArtifactsTable, this.artifactsTable)})='missing')::integer AS missing_invoice_or_credit_note_count,
          (SELECT count(*)::integer FROM ${this.artifactsTable} artifact WHERE artifact.artifact_profile IN ('stripe_balance_itemised_csv_v1', 'commbank_transaction_history_csv_v1') AND artifact.state IN ('pending', 'awaiting_review')) AS pending_import_uploads,
          (SELECT count(*)::integer FROM ${this.artifactsTable} artifact WHERE artifact.artifact_profile IN ('stripe_balance_itemised_csv_v1', 'commbank_transaction_history_csv_v1') AND artifact.state='abandoned') AS abandoned_import_uploads
         FROM ${this.transactionsTable} transactions`,
      ),
      this.pool.query(
        `SELECT id, kind, status, source_system, ${updatedAtTokenProjection("updated_at")} FROM ${this.transactionsTable} ORDER BY updated_at DESC, id DESC LIMIT 5`,
      ),
    ]);
    return {
      missingInvoiceOrCreditNoteCount: Number(
        count.rows[0]?.missing_invoice_or_credit_note_count ?? 0,
      ),
      pendingImportUploads: Number(count.rows[0]?.pending_import_uploads ?? 0),
      abandonedImportUploads: Number(
        count.rows[0]?.abandoned_import_uploads ?? 0,
      ),
      recentTransactions: recent.rows.map((row) => ({
        id: String(row.id),
        kind: row.kind as TransactionRecord["kind"],
        status: row.status as TransactionRecord["status"],
        sourceSystem: row.source_system as TransactionRecord["sourceSystem"],
        updatedAt: String(row.updated_at_token),
      })),
    };
  }

  async getTransaction(
    actorId: string,
    id: string,
  ): Promise<TransactionRecord | null> {
    await this.actorById(this.pool, actorId);
    const result = await this.pool.query(
      `SELECT transactions.*, ${invoiceDateTextProjection("transactions.invoice_date")}, artifacts.source_artifact_id, artifacts.filename AS source_artifact_filename, artifacts.source_artifacts, ${updatedAtTokenProjection("transactions.updated_at")} FROM ${this.transactionsTable} transactions ${linkedArtifactJoin(this.transactionArtifactsTable, this.artifactsTable)} WHERE transactions.id = $1`,
      [id],
    );
    return result.rows[0] ? mapTransaction(result.rows[0]) : null;
  }

  async listAvailableInvoiceArtifacts(
    actorId: string,
  ): Promise<ArtifactRecord[]> {
    await this.actorById(this.pool, actorId);
    const result = await this.pool.query(
      `SELECT * FROM ${this.artifactsTable} WHERE artifact_profile='manual_invoice_pdf_v1' AND state='available' ORDER BY created_at DESC, id DESC`,
    );
    return result.rows.map(mapArtifact);
  }

  async listArtifacts(
    actorId: string,
    input:
      | {
          filters: readonly (
            | {
                field: "filename";
                operator: "equals" | "not_equals" | "contains" | "not_contains";
                value: string;
              }
            | {
                field: "uploaded" | "transactions" | "bank_activity";
                operator:
                  | "equals"
                  | "not_equals"
                  | "greater_than"
                  | "greater_than_or_equal"
                  | "less_than"
                  | "less_than_or_equal";
                value: string;
              }
            | {
                field: "profile" | "type" | "state" | "linkage";
                operator: "is" | "is_not" | "contains_any" | "contains_none";
                value: string | string[];
              }
          )[];
          sort: readonly {
            field:
              | "filename"
              | "profile"
              | "type"
              | "uploaded"
              | "state"
              | "transactions"
              | "bank_activity";
            direction: "asc" | "desc";
          }[];
          limit: number;
          offset: number;
        }
      | {
          search: string;
          profile: string | null;
          state: string | null;
          from: string | null;
          to: string | null;
          linkage: "all" | "linked" | "unlinked";
          limit: number;
          offset: number;
        },
  ): Promise<{
    total: number;
    rows: {
      id: string;
      filename: string;
      artifactProfile: string;
      mediaType: string;
      state: string;
      byteSize: string;
      checksumSha256: string;
      createdAt: string;
      transactionCount: number;
      bankRowCount: number;
    }[];
  }> {
    await this.actorById(this.pool, actorId);
    const filters = "filters" in input ? [...input.filters] : [];
    const sort =
      "sort" in input
        ? input.sort
        : [{ field: "uploaded" as const, direction: "desc" as const }];

    if (!("filters" in input)) {
      const search = input.search.trim();
      if (search)
        filters.push({
          field: "filename",
          operator: "contains",
          value: search,
        });
      if (input.profile)
        filters.push({
          field: "profile",
          operator: "is",
          value: input.profile,
        });
      if (input.state)
        filters.push({ field: "state", operator: "is", value: input.state });
      if (input.from)
        filters.push({
          field: "uploaded",
          operator: "greater_than_or_equal",
          value: input.from,
        });
      if (input.to)
        filters.push({
          field: "uploaded",
          operator: "less_than_or_equal",
          value: input.to,
        });
      if (input.linkage !== "all")
        filters.push({
          field: "linkage",
          operator: "is",
          value: input.linkage,
        });
    }

    const parameters: (string | string[])[] = [];
    const bind = (value: string | string[]): string => {
      parameters.push(value);
      return `$${parameters.length}`;
    };
    const comparisonOperators = {
      equals: "=",
      not_equals: "<>",
      greater_than: ">",
      greater_than_or_equal: ">=",
      less_than: "<",
      less_than_or_equal: "<=",
    } as const;
    const transactionCount = `(SELECT count(*)::integer FROM ${this.transactionArtifactsTable} t WHERE t.source_artifact_id=artifact.id)`;
    const bankRowCount = `(SELECT count(*)::integer FROM ${this.bankTransactionArtifactsTable} b WHERE b.source_artifact_id=artifact.id)`;
    const linkedArtifact = `(EXISTS (SELECT 1 FROM ${this.transactionArtifactsTable} t WHERE t.source_artifact_id=artifact.id) OR EXISTS (SELECT 1 FROM ${this.bankTransactionArtifactsTable} b WHERE b.source_artifact_id=artifact.id))`;
    const conditions = filters.map((filter) => {
      if (filter.field === "filename") {
        const value = bind(filter.value);
        if (filter.operator === "contains")
          return `position(lower(${value}) in lower(artifact.filename)) > 0`;
        if (filter.operator === "not_contains")
          return `position(lower(${value}) in lower(artifact.filename)) = 0`;
        return `lower(artifact.filename) ${comparisonOperators[filter.operator]} lower(${value})`;
      }

      if (filter.field === "uploaded") {
        const value = bind(filter.value);
        return `(artifact.created_at AT TIME ZONE 'UTC')::date ${comparisonOperators[filter.operator]} ${value}::date`;
      }

      if (filter.field === "transactions" || filter.field === "bank_activity") {
        const count =
          filter.field === "transactions" ? transactionCount : bankRowCount;
        const value = bind(filter.value);
        return `${count} ${comparisonOperators[filter.operator]} ${value}::integer`;
      }

      if (filter.field === "linkage") {
        if (
          filter.operator === "contains_any" ||
          filter.operator === "contains_none"
        ) {
          const values = Array.isArray(filter.value)
            ? filter.value
            : [filter.value];
          if (!values.length) return "true";
          const expression = `(CASE WHEN ${linkedArtifact} THEN 'linked' ELSE 'unlinked' END)`;
          return `${expression} ${filter.operator === "contains_any" ? "= ANY" : "<> ALL"}(${bind(values)}::text[])`;
        }
        const shouldBeLinked =
          (filter.value === "linked") === (filter.operator === "is");
        return shouldBeLinked ? linkedArtifact : `NOT ${linkedArtifact}`;
      }

      const columns = {
        profile: "artifact.artifact_profile",
        type: "artifact.media_type",
        state: "artifact.state",
      };
      if (
        filter.operator === "contains_any" ||
        filter.operator === "contains_none"
      ) {
        const values = Array.isArray(filter.value)
          ? filter.value
          : [filter.value];
        if (!values.length) return "true";
        return `${columns[filter.field]} ${filter.operator === "contains_any" ? "= ANY" : "<> ALL"}(${bind(values)}::text[])`;
      }
      const value = bind(filter.value);
      return `${columns[filter.field]} ${filter.operator === "is" ? "=" : "<>"} ${value}`;
    });
    const conditionsSql = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "WHERE true";
    const sortColumns = {
      filename: "artifact.filename",
      profile: "artifact.artifact_profile",
      type: "artifact.media_type",
      uploaded: "artifact.created_at",
      state: "artifact.state",
      transactions: transactionCount,
      bank_activity: bankRowCount,
    };
    const orderBy = sort.map(
      ({ field, direction }) =>
        `${sortColumns[field]} ${direction.toUpperCase()}`,
    );
    orderBy.push("artifact.id DESC");
    const pageParameters = [...parameters, input.limit, input.offset];
    const limitPlaceholder = `$${parameters.length + 1}`;
    const offsetPlaceholder = `$${parameters.length + 2}`;
    const [count, result] = await Promise.all([
      this.pool.query(
        `SELECT count(*)::integer AS total FROM ${this.artifactsTable} artifact ${conditionsSql}`,
        parameters,
      ),
      this.pool.query(
        `SELECT artifact.id, artifact.filename, artifact.artifact_profile, artifact.media_type, artifact.state, artifact.byte_size, artifact.checksum_sha256, artifact.created_at,
          ${transactionCount} AS transaction_count,
          ${bankRowCount} AS bank_row_count
         FROM ${this.artifactsTable} artifact ${conditionsSql}
         ORDER BY ${orderBy.join(", ")} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
        pageParameters,
      ),
    ]);
    return {
      total: Number(count.rows[0]?.total ?? 0),
      rows: result.rows.map((row) => ({
        id: String(row.id),
        filename: String(row.filename),
        artifactProfile: String(row.artifact_profile),
        mediaType: String(row.media_type),
        state: String(row.state),
        byteSize: String(row.byte_size),
        checksumSha256: String(row.checksum_sha256),
        createdAt: row.created_at.toISOString(),
        transactionCount: Number(row.transaction_count),
        bankRowCount: Number(row.bank_row_count),
      })),
    };
  }

  async findArtifactFilenameMatches(
    actorId: string,
    profile: ArtifactProfile,
    filenames: readonly string[],
  ): Promise<number[]> {
    await this.actorById(this.pool, actorId);
    if (filenames.length === 0) return [];

    const result = await this.pool.query(
      `SELECT requested.filename, count(artifact.id)::integer AS match_count
       FROM unnest($2::text[]) WITH ORDINALITY AS requested(filename, ordinal)
       LEFT JOIN ${this.artifactsTable} artifact
         ON artifact.artifact_profile=$1
         AND lower(coalesce(nullif(artifact.original_filename, ''), artifact.filename))=lower(requested.filename)
       GROUP BY requested.filename, requested.ordinal
       ORDER BY requested.ordinal`,
      [profile, filenames],
    );
    return result.rows.map((row) => Number(row.match_count));
  }

  async getArtifactCreatorId(id: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT created_by_id FROM ${this.artifactsTable} WHERE id=$1`,
      [id],
    );
    return result.rows[0]?.created_by_id
      ? String(result.rows[0].created_by_id)
      : null;
  }

  async findCsvDuplicateWarnings(
    actorId: string,
    artifactId: string,
    profile: CsvDuplicateProfile,
    identitySet: CsvDuplicateIdentitySet,
  ): Promise<CsvDuplicateWarningReport> {
    await this.actorById(this.pool, actorId);
    const artifactResult = await this.pool.query(
      `SELECT id, filename, original_filename, checksum_sha256
       FROM ${this.artifactsTable}
       WHERE id=$1 AND artifact_profile=$2 AND state IN ('awaiting_review','available')`,
      [artifactId, profile],
    );
    const artifact = artifactResult.rows[0];
    if (!artifact) throw new Error("Reviewable CSV artifact not found");
    const invalidIdentity = identitySet.identities.some((identity) =>
      profile === "stripe_balance_itemised_csv_v1"
        ? identity.kind !== "stripe_reference"
        : identity.kind !== "commbank_row",
    );
    if (invalidIdentity) throw new Error("CSV duplicate identity mismatch");

    const filename = String(artifact.original_filename || artifact.filename);
    const metadataMatches = await this.pool.query(
      `WITH signals AS (
         SELECT candidate.id, candidate.filename, reason.value AS reason,
           count(*) OVER (PARTITION BY reason.value)::integer AS total_artifact_count,
           row_number() OVER (PARTITION BY reason.value ORDER BY candidate.created_at DESC, candidate.id DESC) AS rank
         FROM ${this.artifactsTable} candidate
         CROSS JOIN LATERAL (VALUES
           ('same_checksum', candidate.checksum_sha256=$3),
           ('same_filename', lower(coalesce(nullif(candidate.original_filename, ''), candidate.filename))=lower($4))
         ) reason(value, matched)
         WHERE candidate.id<>$1 AND candidate.artifact_profile=$2
           AND candidate.state IN ('awaiting_review','available','superseded')
           AND reason.matched
       )
       SELECT id, filename, reason, total_artifact_count
       FROM signals WHERE rank<=25 ORDER BY reason, rank`,
      [artifactId, profile, artifact.checksum_sha256, filename],
    );

    const rowMatches =
      profile === "stripe_balance_itemised_csv_v1"
        ? await this.stripeDuplicateRowMatches(
            artifactId,
            identitySet.identities,
          )
        : await this.commBankDuplicateRowMatches(
            artifactId,
            identitySet.identities,
          );
    const groups = new Map<
      CsvDuplicateWarningReason,
      CsvDuplicateWarningGroup
    >();
    for (const row of metadataMatches.rows) {
      const reason = row.reason as CsvDuplicateWarningReason;
      const group = groups.get(reason) ?? {
        reason,
        totalArtifactCount: Number(row.total_artifact_count),
        truncated: Number(row.total_artifact_count) > 25,
        matches: [],
      };
      group.matches.push({
        artifactId: String(row.id),
        filename: String(row.filename),
        matchingRowCount: null,
      });
      groups.set(reason, group);
    }
    for (const row of rowMatches.rows) {
      const reason = "overlapping_rows" as const;
      const group = groups.get(reason) ?? {
        reason,
        totalArtifactCount: Number(row.total_artifact_count),
        truncated: Number(row.total_artifact_count) > 25,
        matches: [],
      };
      group.matches.push({
        artifactId: String(row.id),
        filename: String(row.filename),
        matchingRowCount: Number(row.matching_row_count),
      });
      groups.set(reason, group);
    }
    return {
      artifactId,
      profile,
      rowCount: identitySet.rowCount,
      rowIdentityLimitReached: identitySet.rowIdentityLimitReached,
      warnings: ["same_checksum", "same_filename", "overlapping_rows"]
        .map((reason) => groups.get(reason as CsvDuplicateWarningReason))
        .filter((group): group is CsvDuplicateWarningGroup => Boolean(group)),
    };
  }

  private stripeDuplicateRowMatches(
    artifactId: string,
    identities: readonly CsvDuplicateRowIdentity[],
  ) {
    const references = identities
      .filter(
        (
          identity,
        ): identity is Extract<
          CsvDuplicateRowIdentity,
          { kind: "stripe_reference" }
        > => identity.kind === "stripe_reference",
      )
      .map((identity) => identity.reference);
    return this.pool.query(
      `WITH matches AS (
         SELECT artifact.id, artifact.filename, count(DISTINCT transaction.reference)::integer AS matching_row_count
         FROM ${this.artifactsTable} artifact
         JOIN ${this.transactionArtifactsTable} link ON link.source_artifact_id=artifact.id
         JOIN ${this.transactionsTable} transaction ON transaction.id=link.transaction_id
         WHERE artifact.id<>$1 AND artifact.artifact_profile='stripe_balance_itemised_csv_v1'
           AND artifact.state IN ('available','superseded')
           AND transaction.source_system='stripe' AND transaction.reference=ANY($2::text[])
         GROUP BY artifact.id, artifact.filename
       ), ranked AS (
         SELECT matches.*, count(*) OVER ()::integer AS total_artifact_count,
           row_number() OVER (ORDER BY matching_row_count DESC, id) AS rank
         FROM matches
       )
       SELECT * FROM ranked WHERE rank<=25 ORDER BY rank`,
      [artifactId, references],
    );
  }

  private commBankDuplicateRowMatches(
    artifactId: string,
    identities: readonly CsvDuplicateRowIdentity[],
  ) {
    const rows = identities
      .filter(
        (
          identity,
        ): identity is Extract<
          CsvDuplicateRowIdentity,
          { kind: "commbank_row" }
        > => identity.kind === "commbank_row",
      )
      .map((identity) => ({
        rowIndex: identity.rowIndex,
        postedDate: identity.postedDate,
        amountAud: identity.amountAud,
        description: identity.description,
        runningBalance: identity.runningBalance,
      }));
    return this.pool.query(
      `WITH requested AS (
         SELECT * FROM jsonb_to_recordset($2::jsonb) AS row(
           "rowIndex" integer, "postedDate" date, "amountAud" numeric,
           description text, "runningBalance" numeric
         )
       ), matches AS (
         SELECT artifact.id, artifact.filename, count(DISTINCT requested."rowIndex")::integer AS matching_row_count
         FROM requested
         JOIN ${this.bankTransactionsTable} bank
           ON bank.posted_date=requested."postedDate"
           AND bank.amount_aud=requested."amountAud"
           AND bank.description=requested.description
           AND bank.metadata->>'runningBalance' ~ '^[+-]?[0-9]+(?:\\.[0-9]+)?$'
           AND (bank.metadata->>'runningBalance')::numeric=requested."runningBalance"
         JOIN ${this.bankTransactionArtifactsTable} link ON link.bank_transaction_id=bank.id
         JOIN ${this.artifactsTable} artifact ON artifact.id=link.source_artifact_id
         WHERE artifact.id<>$1 AND artifact.artifact_profile='commbank_transaction_history_csv_v1'
           AND artifact.state IN ('available','superseded')
         GROUP BY artifact.id, artifact.filename
       ), ranked AS (
         SELECT matches.*, count(*) OVER ()::integer AS total_artifact_count,
           row_number() OVER (ORDER BY matching_row_count DESC, id) AS rank
         FROM matches
       )
       SELECT * FROM ranked WHERE rank<=25 ORDER BY rank`,
      [artifactId, JSON.stringify(rows)],
    );
  }

  async linkTransactionArtifact(
    actorId: string,
    transactionId: string,
    sourceArtifactId: string,
  ): Promise<void> {
    await this.actorById(this.pool, actorId);
    const transaction = await this.pool.query(
      `SELECT source_system FROM ${this.transactionsTable} WHERE id=$1`,
      [transactionId],
    );
    if (transaction.rows[0]?.source_system !== "manual")
      throw new Error("Only manual transactions can link invoice artifacts");
    await this.assertManualArtifacts(this.pool, [sourceArtifactId]);
    await this.linkTransactionArtifactInternal(
      this.pool,
      transactionId,
      sourceArtifactId,
    );
  }

  async unlinkTransactionArtifact(
    actorId: string,
    transactionId: string,
    sourceArtifactId: string,
  ): Promise<void> {
    await this.actorById(this.pool, actorId);
    const transaction = await this.pool.query(
      `SELECT source_system FROM ${this.transactionsTable} WHERE id=$1`,
      [transactionId],
    );
    if (transaction.rows[0]?.source_system !== "manual")
      throw new Error("Only manual transactions can unlink invoice artifacts");
    await this.unlinkTransactionArtifactInternal(
      this.pool,
      transactionId,
      sourceArtifactId,
    );
  }

  private async linkTransactionArtifactInternal(
    queryable: Queryable,
    transactionId: string,
    sourceArtifactId: string,
    metadata: Record<string, unknown> | null = null,
  ): Promise<void> {
    await queryable.query(
      `INSERT INTO ${this.transactionArtifactsTable} (transaction_id, source_artifact_id, metadata) VALUES ($1,$2,$3) ON CONFLICT (transaction_id, source_artifact_id) DO NOTHING`,
      [transactionId, sourceArtifactId, metadata],
    );
  }

  private async unlinkTransactionArtifactInternal(
    queryable: Queryable,
    transactionId: string,
    sourceArtifactId: string,
  ): Promise<void> {
    await queryable.query(
      `DELETE FROM ${this.transactionArtifactsTable} WHERE transaction_id=$1 AND source_artifact_id=$2`,
      [transactionId, sourceArtifactId],
    );
  }

  private artifactIdsForInput(
    input: TransactionInput,
    sourceArtifactIds: readonly string[] | undefined,
  ): string[] {
    if (sourceArtifactIds !== undefined) return [...new Set(sourceArtifactIds)];
    return input.sourceArtifactId ? [input.sourceArtifactId] : [];
  }

  private async assertManualArtifacts(
    queryable: Queryable,
    artifactIds: readonly string[],
  ): Promise<void> {
    for (const artifactId of artifactIds) {
      const evidence = await this.getEvidence(queryable, artifactId);
      if (
        !evidence ||
        evidence.state !== "available" ||
        !isInvoiceEvidenceProfile(evidence.artifactProfile)
      )
        throw new Error("Manual transactions require available invoice PDFs");
    }
  }

  async createManual(
    actorId: string,
    input: TransactionInput,
    sourceArtifactIds?: readonly string[],
  ): Promise<TransactionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const actor = await this.actorById(client, actorId);
      const artifactIds = this.artifactIdsForInput(input, sourceArtifactIds);
      await this.assertManualArtifacts(client, artifactIds);
      const primaryArtifactId = artifactIds[0] ?? null;
      const evidence = primaryArtifactId
        ? await this.getEvidence(client, primaryArtifactId)
        : null;
      assertTransactionRules(
        { ...input, sourceArtifactId: primaryArtifactId },
        this.gstRegistered,
        evidence,
      );
      const result = await client.query(
        `INSERT INTO ${this.transactionsTable} (owner_id, created_by_id, updated_by_id, source_system, kind, reference, counterparty, description, status, category, notes, occurred_at, available_at, invoice_date, settled_at, document_currency, document_amount, document_tax_amount, tax_treatment, settlement_currency, settlement_amount, gst_credit_status, claimable_gst_aud) VALUES ($1,$2,$2,'manual',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *, ${invoiceDateTextProjection("invoice_date")}, ${updatedAtTokenProjection("updated_at")}`,
        [
          input.ownerId,
          actor.id,
          input.kind,
          input.reference,
          input.counterparty,
          input.description,
          input.status,
          input.category,
          input.notes,
          input.occurredAt,
          input.availableAt,
          input.invoiceDate,
          input.settledAt,
          input.documentCurrency,
          input.documentAmount,
          input.documentTaxAmount,
          input.taxTreatment,
          input.settlementCurrency,
          input.settlementAmount,
          input.gstCreditStatus,
          input.claimableGstAud,
        ],
      );
      for (const artifactId of artifactIds)
        await this.linkTransactionArtifactInternal(
          client,
          result.rows[0]!.id,
          artifactId,
        );
      await client.query("COMMIT");
      return mapTransaction({
        ...result.rows[0],
        source_artifact_id: artifactIds[0] ?? null,
        source_artifacts: [],
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateManual(
    actorId: string,
    id: string,
    input: TransactionInput,
    expectedUpdatedAt: string,
    action: ManualTransactionAction = input.status === "recorded"
      ? "save_recorded"
      : "save_draft",
    sourceArtifactIds?: readonly string[],
  ): Promise<TransactionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const actor = await this.actorById(client, actorId);
      const matches = await client.query(
        `SELECT id, amount_aud FROM ${this.bankTransactionsTable} WHERE matched_transaction_id=$1 ORDER BY id FOR UPDATE`,
        [id],
      );
      const existing = await client.query(
        `SELECT transactions.*, (SELECT links.source_artifact_id FROM ${this.transactionArtifactsTable} links WHERE links.transaction_id = transactions.id ORDER BY links.source_artifact_id LIMIT 1) AS source_artifact_id, (SELECT coalesce(array_agg(links.source_artifact_id ORDER BY links.source_artifact_id), '{}') FROM ${this.transactionArtifactsTable} links WHERE links.transaction_id = transactions.id) AS source_artifact_ids, ${updatedAtTokenProjection("transactions.updated_at")} FROM ${this.transactionsTable} transactions WHERE transactions.id = $1 FOR UPDATE`,
        [id],
      );
      if (!existing.rows[0] || existing.rows[0].source_system !== "manual")
        throw new Error("Manual transaction not found");
      assertExpectedRevision(
        existing.rows[0].updated_at_token,
        expectedUpdatedAt,
      );
      assertStatusTransition(existing.rows[0].status, input.status, action);
      if (matches.rows.length) {
        const cashEffect = manualCashEffectAudMinor({
          ...input,
          sourceSystem: "manual",
        });
        if (
          cashEffect === null ||
          matches.rows.some(
            (match) => parseDecimal(match.amount_aud) !== cashEffect,
          )
        )
          throw bankMatchEditConflict();
      }
      const artifactIds = this.artifactIdsForInput(input, sourceArtifactIds);
      await this.assertManualArtifacts(client, artifactIds);
      const primaryArtifactId = artifactIds[0] ?? null;
      const evidence = primaryArtifactId
        ? await this.getEvidence(client, primaryArtifactId)
        : null;
      assertTransactionRules(
        { ...input, sourceArtifactId: primaryArtifactId },
        this.gstRegistered,
        evidence,
      );
      const result = await client.query(
        `UPDATE ${this.transactionsTable} SET owner_id=$2, updated_by_id=$3, kind=$4, reference=$5, counterparty=$6, description=$7, status=$8, category=$9, notes=$10, occurred_at=$11, available_at=$12, invoice_date=$13, settled_at=$14, document_currency=$15, document_amount=$16, document_tax_amount=$17, tax_treatment=$18, settlement_currency=$19, settlement_amount=$20, gst_credit_status=$21, claimable_gst_aud=$22, updated_at=now() WHERE id=$1 AND updated_at = $23::timestamptz RETURNING *, ${invoiceDateTextProjection("invoice_date")}, ${updatedAtTokenProjection("updated_at")}`,
        [
          id,
          input.ownerId,
          actor.id,
          input.kind,
          input.reference,
          input.counterparty,
          input.description,
          input.status,
          input.category,
          input.notes,
          input.occurredAt,
          input.availableAt,
          input.invoiceDate,
          input.settledAt,
          input.documentCurrency,
          input.documentAmount,
          input.documentTaxAmount,
          input.taxTreatment,
          input.settlementCurrency,
          input.settlementAmount,
          input.gstCreditStatus,
          input.claimableGstAud,
          expectedUpdatedAt,
        ],
      );
      if (!result.rows[0]) throw revisionConflictError();
      const existingArtifactIds = Array.isArray(
        existing.rows[0].source_artifact_ids,
      )
        ? (existing.rows[0].source_artifact_ids as string[])
        : existing.rows[0].source_artifact_id
          ? [String(existing.rows[0].source_artifact_id)]
          : [];
      for (const artifactId of artifactIds)
        if (!existingArtifactIds.includes(artifactId))
          await this.linkTransactionArtifactInternal(client, id, artifactId);
      for (const artifactId of existingArtifactIds)
        if (!artifactIds.includes(artifactId))
          await this.unlinkTransactionArtifactInternal(client, id, artifactId);
      await client.query("COMMIT");
      return mapTransaction({
        ...result.rows[0],
        source_artifact_id: artifactIds[0] ?? null,
        source_artifacts: [],
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async voidTransaction(
    actorId: string,
    id: string,
    expectedUpdatedAt: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const actor = await this.actorById(client, actorId);
      const matches = await client.query(
        `SELECT id FROM ${this.bankTransactionsTable} WHERE matched_transaction_id=$1 ORDER BY id FOR UPDATE`,
        [id],
      );
      if (matches.rows.length) throw bankMatchEditConflict();
      const result = await client.query(
        `UPDATE ${this.transactionsTable} SET status='void', updated_by_id=$2, updated_at=now() WHERE id=$1 AND status <> 'void' AND updated_at = $3::timestamptz`,
        [id, actor.id, expectedUpdatedAt],
      );
      if (result.rowCount !== 1) throw revisionConflictError();
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteDraftTransaction(
    actorId: string,
    id: string,
    expectedUpdatedAt: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.actorById(client, actorId);
      const draft = await client.query(
        `SELECT id FROM ${this.transactionsTable} WHERE id=$1 AND source_system='manual' AND status='draft' AND updated_at=$2::timestamptz FOR UPDATE`,
        [id, expectedUpdatedAt],
      );
      if (!draft.rows[0]) throw revisionConflictError();
      await client.query(
        `DELETE FROM ${this.mcpSubmissionsTable} WHERE draft_transaction_id=$1`,
        [id],
      );
      const deleted = await client.query(
        `DELETE FROM ${this.transactionsTable} WHERE id=$1 AND source_system='manual' AND status='draft' AND updated_at=$2::timestamptz`,
        [id, expectedUpdatedAt],
      );
      if (deleted.rowCount !== 1) throw revisionConflictError();
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async importStripe(
    actorId: string,
    artifactId: string,
    rows: readonly StripeImportRow[],
    reportingTimezone: string,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const actor = await this.actorById(client, actorId);
      const artifactResult = await client.query(
        `SELECT * FROM ${this.artifactsTable} WHERE id=$1 FOR UPDATE`,
        [artifactId],
      );
      const artifact = artifactResult.rows[0]
        ? mapArtifact(artifactResult.rows[0])
        : null;
      if (
        !artifact ||
        artifactProfileOf(artifact) !== "stripe_balance_itemised_csv_v1" ||
        !artifact.versionId ||
        (artifact.state !== "awaiting_review" && artifact.state !== "available")
      )
        throw new Error("Reviewable Stripe CSV artifact not found");
      if (artifact.state === "awaiting_review") {
        const available = await client.query(
          `UPDATE ${this.artifactsTable} SET state='available' WHERE id=$1 AND state='awaiting_review' AND version_id=$2`,
          [artifactId, artifact.versionId],
        );
        if (available.rowCount !== 1)
          throw new Error("Reviewable Stripe CSV artifact not found");
      }
      let imported = 0;
      for (const row of rows) {
        const classification = classifyStripeReportingCategory(
          row.reportingCategory,
        );
        const inserted = await client.query(
          `WITH inserted AS (INSERT INTO ${this.transactionsTable} (created_by_id, updated_by_id, source_system, kind, reference, description, status, occurred_at, available_at, source_currency, source_gross, source_fee, source_net, metadata) VALUES ($1,$1,'stripe',$3,$4,$5,'recorded',$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING RETURNING id) INSERT INTO ${this.transactionArtifactsTable} (transaction_id, source_artifact_id) SELECT inserted.id, $2 FROM inserted RETURNING transaction_id AS id`,
          [
            actor.id,
            artifactId,
            classification.kind,
            row.reference,
            row.description,
            row.occurredAt,
            row.availableAt,
            row.sourceCurrency,
            row.sourceGross,
            row.sourceFee,
            row.sourceNet,
            { reportingCategory: row.reportingCategory },
          ],
        );
        if (inserted.rowCount === 1) {
          imported += 1;
          continue;
        }

        const existing = await client.query(
          `SELECT id, kind, description, occurred_at, available_at, source_currency, source_gross, source_fee, source_net, metadata FROM ${this.transactionsTable} WHERE source_system='stripe' AND reference=$1`,
          [row.reference],
        );
        const existingRow = existing.rows[0];
        if (
          !existingRow ||
          !sameStripeImport(existingRow, row, classification.kind)
        )
          throw new FolioDiagnosticError(
            {
              category: "validation",
              code: "STRIPE_IMPORT_CONFLICT",
              retryable: false,
            },
            "Stripe balance transaction conflicts with an existing import",
          );
        if (existingRow.id)
          await this.linkTransactionArtifactInternal(
            client,
            existingRow.id,
            artifactId,
          );
      }
      const filename = formatStripeImportFilename(rows, reportingTimezone);
      if (filename) {
        const renamed = await client.query(
          `UPDATE ${this.artifactsTable} SET filename=$2 WHERE id=$1 AND artifact_profile='stripe_balance_itemised_csv_v1' AND state='available'`,
          [artifactId, filename],
        );
        if (renamed.rowCount !== 1)
          throw new Error("Available Stripe CSV artifact not found");
      }
      await client.query("COMMIT");
      return imported;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async previewStripeImport(
    actorId: string,
    artifactId: string,
    rows: readonly StripeImportRow[],
  ): Promise<StripeImportPreviewStatus[]> {
    await this.actorById(this.pool, actorId);
    const artifact = await this.getArtifactWith(this.pool, artifactId);
    if (
      !artifact ||
      artifactProfileOf(artifact) !== "stripe_balance_itemised_csv_v1" ||
      (artifact.state !== "awaiting_review" && artifact.state !== "available")
    )
      throw new Error("Reviewable Stripe CSV artifact not found");
    if (rows.length === 0) return [];

    const existing = await this.pool.query(
      `SELECT id, kind, reference, description, occurred_at, available_at, source_currency, source_gross, source_fee, source_net, metadata FROM ${this.transactionsTable} WHERE source_system='stripe' AND reference = ANY($1::text[])`,
      [rows.map((row) => row.reference)],
    );
    const existingByReference = new Map<string, QueryResultRow>(
      existing.rows.map((row) => [String(row.reference), row]),
    );
    return rows.map((row) => {
      const current = existingByReference.get(row.reference);
      if (!current) return "will_import";
      const kind = classifyStripeReportingCategory(row.reportingCategory).kind;
      return sameStripeImport(current, row, kind)
        ? "already_imported"
        : "conflict";
    });
  }

  private async getEvidence(queryable: Queryable, id: string) {
    const result = await queryable.query(
      `SELECT artifact_profile, state FROM ${this.artifactsTable} WHERE id=$1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    const profile = row.artifact_profile
      ? (row.artifact_profile as ArtifactProfile)
      : row.kind
        ? legacyArtifactProfile(row.kind as "pdf" | "stripe_csv")
        : null;
    return profile ? { artifactProfile: profile, state: row.state } : null;
  }

  private async getArtifactWith(
    queryable: Queryable,
    id: string,
  ): Promise<ArtifactRecord | null> {
    const result = await queryable.query(
      `SELECT * FROM ${this.artifactsTable} WHERE id=$1`,
      [id],
    );
    return result.rows[0] ? mapArtifact(result.rows[0]) : null;
  }

  async createPending(
    input: Parameters<ArtifactRepository["createPending"]>[0],
  ): Promise<ArtifactRecord> {
    const actor = await this.actorById(this.pool, input.actorId);
    const artifactProfile =
      input.artifactProfile ??
      (input.kind ? legacyArtifactProfile(input.kind) : undefined);
    if (!artifactProfile) throw new Error("Artifact profile is required");
    const id = input.id ?? randomUUID();
    const result = await this.pool.query(
      `INSERT INTO ${this.artifactsTable} (id, owner_id, created_by_id, artifact_profile, object_key, filename, original_filename, media_type, byte_size, checksum_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        id,
        input.ownerId,
        actor.id,
        artifactProfile,
        input.objectKey,
        input.filename,
        input.filename,
        input.mediaType,
        input.byteSize,
        input.checksumSha256,
      ],
    );
    return mapArtifact(result.rows[0]!);
  }

  async createPendingUploadIntent(
    input: Parameters<ArtifactRepository["createPendingUploadIntent"]>[0],
  ): ReturnType<ArtifactRepository["createPendingUploadIntent"]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const credentialResult = await client.query(
        `SELECT credential.actor_user_id, credential.default_owner_id
         FROM ${this.mcpCredentialsTable} credential
         JOIN ${this.usersTable} actor ON actor.id=credential.actor_user_id AND actor.active=true
         JOIN ${this.usersTable} owner ON owner.id=credential.default_owner_id AND owner.active=true
         WHERE credential.id=$1 AND credential.revoked_at IS NULL
           AND 'artifacts:upload'=ANY(credential.scopes)
         FOR SHARE OF credential, actor, owner`,
        [input.credentialId],
      );
      const credential = credentialResult.rows[0];
      if (
        !credential ||
        String(credential.actor_user_id) !== input.actorId ||
        String(credential.default_owner_id) !== input.ownerId
      )
        throw new Error("Upload credential is not authorized");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${input.credentialId}:${input.requestKey}`],
      );
      const existingResult = await client.query(
        `SELECT intent.payload_sha256 AS intent_payload_sha256,
           intent.artifact_id AS intent_artifact_id, artifact.*
         FROM ${this.mcpUploadIntentsTable} intent
         LEFT JOIN ${this.artifactsTable} artifact ON artifact.id=intent.artifact_id
         WHERE intent.credential_id=$1 AND intent.request_key=$2`,
        [input.credentialId, input.requestKey],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        if (String(existing.intent_payload_sha256) !== input.payloadSha256)
          throw new ArtifactUploadIdempotencyConflictError();
        await client.query("COMMIT");
        if (!existing.id || existing.state !== "pending")
          return {
            status: "not_uploadable",
            artifactId: String(existing.intent_artifact_id),
            artifactState: existing.state
              ? (String(existing.state) as ArtifactRecord["state"])
              : "deleted",
          };
        return { status: "replayed", artifact: mapArtifact(existing) };
      }
      const artifactResult = await client.query(
        `INSERT INTO ${this.artifactsTable} (id, owner_id, created_by_id, artifact_profile, object_key, filename, original_filename, media_type, byte_size, checksum_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9) RETURNING *`,
        [
          input.id,
          input.ownerId,
          input.actorId,
          input.artifactProfile,
          input.objectKey,
          input.filename,
          input.mediaType,
          input.byteSize,
          input.checksumSha256,
        ],
      );
      await client.query(
        `INSERT INTO ${this.mcpUploadIntentsTable} (credential_id, request_key, payload_sha256, artifact_id)
         VALUES ($1,$2,$3,$4)`,
        [input.credentialId, input.requestKey, input.payloadSha256, input.id],
      );
      await client.query("COMMIT");
      return {
        status: "created",
        artifact: mapArtifact(artifactResult.rows[0]!),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getArtifact(id: string): Promise<ArtifactRecord | null> {
    return this.getArtifactWith(this.pool, id);
  }

  async abandonPendingArtifact(id: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.artifactsTable} SET state='abandoned' WHERE id=$1 AND state='pending'`,
      [id],
    );
    if (result.rowCount !== 1) throw new Error("Pending artifact not found");
  }

  async confirmAwaitingReview(id: string, versionId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.artifactsTable} SET state='awaiting_review', version_id=$2, confirmed_at=now() WHERE id=$1 AND state='pending'`,
      [id, versionId],
    );
    if (result.rowCount !== 1) throw new Error("Pending artifact not found");
  }

  async approveArtifact(
    id: string,
    versionId: string,
  ): Promise<ArtifactRecord> {
    const result = await this.pool.query(
      `UPDATE ${this.artifactsTable} artifact SET state='available'
       WHERE artifact.id=$1 AND artifact.state='awaiting_review' AND artifact.version_id=$2 AND artifact.artifact_profile='manual_invoice_pdf_v1'
       RETURNING artifact.*`,
      [id, versionId],
    );
    if (!result.rows[0]) throw new Error("Reviewable PDF artifact not found");
    return mapArtifact(result.rows[0]);
  }

  async rejectArtifact(id: string, versionId: string): Promise<ArtifactRecord> {
    const result = await this.pool.query(
      `UPDATE ${this.artifactsTable} artifact SET state='rejected', version_id=coalesce(artifact.version_id, $2), confirmed_at=coalesce(artifact.confirmed_at, now())
       WHERE artifact.id=$1
         AND (
           (artifact.state='awaiting_review' AND artifact.version_id=$2 AND artifact.media_type IN ('application/pdf', 'text/csv'))
           OR (artifact.state IN ('available', 'rejected') AND artifact.version_id=$2 AND artifact.media_type='text/csv')
         )
         AND NOT EXISTS (SELECT 1 FROM ${this.transactionArtifactsTable} link WHERE link.source_artifact_id=artifact.id)
         AND NOT EXISTS (SELECT 1 FROM ${this.bankTransactionArtifactsTable} link WHERE link.source_artifact_id=artifact.id)
       RETURNING artifact.*`,
      [id, versionId],
    );
    if (!result.rows[0]) throw new Error("Unlinked review artifact not found");
    return mapArtifact(result.rows[0]);
  }

  async claimArtifactDeletion(id: string): Promise<ArtifactRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const artifactResult = await client.query(
        `SELECT * FROM ${this.artifactsTable} WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!artifactResult.rows[0]) {
        await client.query("COMMIT");
        return null;
      }
      const links = await client.query(
        `SELECT EXISTS (SELECT 1 FROM ${this.transactionArtifactsTable} WHERE source_artifact_id=$1)
             OR EXISTS (SELECT 1 FROM ${this.bankTransactionArtifactsTable} WHERE source_artifact_id=$1) AS linked`,
        [id],
      );
      if (links.rows[0]?.linked)
        throw new Error(
          "Cannot delete an artifact referenced by a transaction or bank row",
        );
      const claimed = await client.query(
        `UPDATE ${this.artifactsTable} SET state='deleting' WHERE id=$1 RETURNING *`,
        [id],
      );
      await client.query("COMMIT");
      return mapArtifact(claimed.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteClaimedArtifact(id: string, objectKey: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM ${this.artifactsTable} artifact
       WHERE artifact.id=$1 AND artifact.object_key=$2 AND artifact.state='deleting'
         AND NOT EXISTS (SELECT 1 FROM ${this.transactionArtifactsTable} link WHERE link.source_artifact_id=artifact.id)
         AND NOT EXISTS (SELECT 1 FROM ${this.bankTransactionArtifactsTable} link WHERE link.source_artifact_id=artifact.id)`,
      [id, objectKey],
    );
    if (result.rowCount === 1) return;
    const existing = await this.pool.query(
      `SELECT 1 FROM ${this.artifactsTable} WHERE id=$1`,
      [id],
    );
    if (existing.rowCount) throw new Error("Claimed artifact not found");
  }

  async supersede(previousId: string, replacementId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const artifacts = await client.query(
        `SELECT id, state, artifact_profile FROM ${this.artifactsTable} WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`,
        [previousId, replacementId],
      );
      const previous = artifacts.rows.find(
        (row) => String(row.id) === previousId,
      );
      const replacement = artifacts.rows.find(
        (row) => String(row.id) === replacementId,
      );
      if (
        previousId === replacementId ||
        !previous ||
        !replacement ||
        previous.state !== "available" ||
        replacement.state !== "available"
      )
        throw new Error("Available replacement pair not found");
      if (previous.artifact_profile !== replacement.artifact_profile)
        throw new Error(
          "Replacement artifact profile must match superseded artifact profile",
        );

      const links = await client.query(
        `SELECT 1 FROM ${this.transactionArtifactsTable} WHERE source_artifact_id=$1 UNION ALL SELECT 1 FROM ${this.bankTransactionArtifactsTable} WHERE source_artifact_id=$1 LIMIT 1`,
        [previousId],
      );
      if (links.rowCount)
        throw new Error(
          "Cannot supersede an artifact referenced by a transaction",
        );

      const result = await client.query(
        `UPDATE ${this.artifactsTable} SET state='superseded' WHERE id=$1 AND state='available'`,
        [previousId],
      );
      if (result.rowCount !== 1)
        throw new Error("Available replacement pair not found");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
