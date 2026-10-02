import { randomUUID } from "node:crypto";

import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  parseProposalSubmission,
  proposalCredentialInputSchema,
  proposalDraftNotes,
  proposalPayloadHash,
  type ProposalCredentialInput,
  type ProposalCredentialScope,
  type ProposalSubmission,
  type ValidatedCommBankArtifactRowLocator,
} from "../domain/proposals";
import type { TransactionInput } from "../domain/types";
import { transactionInputSchema } from "../domain/types";
import { assertTransactionRules } from "../domain/workflow";

export class ProposalIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used with a different payload");
    this.name = "ProposalIdempotencyConflictError";
  }
}

export class ProposalAuthorizationError extends Error {
  constructor() {
    super("Proposal credential is not authorized");
    this.name = "ProposalAuthorizationError";
  }
}

export class ProposalDraftNotEditableError extends Error {
  constructor() {
    super("Draft is no longer editable by this credential");
    this.name = "ProposalDraftNotEditableError";
  }
}

export class ProposalTransactionConflictError extends Error {
  constructor() {
    super("Transaction changed after it was read");
    this.name = "ProposalTransactionConflictError";
  }
}

export class ProposalTransactionNotFoundError extends Error {
  constructor() {
    super("Transaction was not found");
    this.name = "ProposalTransactionNotFoundError";
  }
}

export type CredentialParticipant = "administrator" | "actor" | "owner";
export type CredentialEligibilityReason =
  | "not_found"
  | "inactive"
  | "wrong_role"
  | "not_distinct";

export class ProposalCredentialEligibilityError extends ProposalAuthorizationError {
  constructor(
    readonly participant: CredentialParticipant,
    readonly reason: CredentialEligibilityReason,
  ) {
    super();
    this.name = "ProposalCredentialEligibilityError";
  }
}

export interface ProposalCredentialRecord {
  id: string;
  label: string;
  actorUserId: string;
  defaultOwnerId: string;
  scopes: readonly ProposalCredentialScope[];
  createdById: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface ProposalSubmissionResult {
  submissionId: string;
  kind: ProposalSubmission["kind"];
  linkedId: string;
  replayed: boolean;
}

export interface BankProposalSuggestion {
  submissionId: string;
  kind: ProposalSubmission["kind"];
  note: string | null;
  observedBankRevision: string | null;
  createdAt: string;
  actionability: "actionable" | "stale" | "resolved" | "void";
  transaction: {
    id: string;
    status: "draft" | "recorded" | "void";
    kind: string;
    counterparty: string | null;
    reference: string | null;
    documentCurrency: string | null;
    documentAmount: string | null;
    settlementCurrency: string | null;
    settlementAmount: string | null;
  };
}

export interface ProposedDraftEvidence {
  submissionId: string;
  transactionId: string;
  artifactId: string;
  filename: string;
  state: string;
  note: string | null;
  discardedAt: string | null;
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : String(value);

const updatedAtTokenProjection = (column: string): string =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_token`;

const mapCredential = (row: QueryResultRow): ProposalCredentialRecord => ({
  id: String(row.id),
  label: String(row.label),
  actorUserId: String(row.actor_user_id),
  defaultOwnerId: String(row.default_owner_id),
  scopes: row.scopes as ProposalCredentialScope[],
  createdById: String(row.created_by_id),
  revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
  createdAt: iso(row.created_at),
});

export class ProposalRepository {
  private readonly usersTable: string;
  private readonly credentialsTable: string;
  private readonly submissionsTable: string;
  private readonly transactionsTable: string;
  private readonly bankTransactionsTable: string;
  private readonly artifactsTable: string;
  private readonly transactionArtifactsTable: string;
  private readonly bankArtifactsTable: string;

  constructor(
    private readonly pool: Pool,
    schema: string,
    private readonly gstRegistered: boolean,
  ) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
      throw new Error("Invalid Folio database schema");
    this.usersTable = `"${schema}"."users"`;
    this.credentialsTable = `"${schema}"."mcp_credentials"`;
    this.submissionsTable = `"${schema}"."mcp_submissions"`;
    this.transactionsTable = `"${schema}"."transactions"`;
    this.bankTransactionsTable = `"${schema}"."bank_transactions"`;
    this.artifactsTable = `"${schema}"."source_artifacts"`;
    this.transactionArtifactsTable = `"${schema}"."transaction_artifacts"`;
    this.bankArtifactsTable = `"${schema}"."bank_transaction_artifacts"`;
  }

  async createCredential(
    administratorId: string,
    input: ProposalCredentialInput,
  ): Promise<ProposalCredentialRecord> {
    const credential = proposalCredentialInputSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const users = await client.query(
        `SELECT id, role, active FROM ${this.usersTable} WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE`,
        [[administratorId, credential.actorUserId, credential.defaultOwnerId]],
      );
      const byId = new Map(
        users.rows.map((row) => [String(row.id), row] as const),
      );
      const administrator = byId.get(administratorId);
      const actor = byId.get(credential.actorUserId);
      const owner = byId.get(credential.defaultOwnerId);
      if (!administrator)
        throw new ProposalCredentialEligibilityError(
          "administrator",
          "not_found",
        );
      if (!administrator.active)
        throw new ProposalCredentialEligibilityError(
          "administrator",
          "inactive",
        );
      if (administrator.role !== "administrator")
        throw new ProposalCredentialEligibilityError(
          "administrator",
          "wrong_role",
        );
      if (credential.actorUserId === administratorId)
        throw new ProposalCredentialEligibilityError("actor", "not_distinct");
      if (!actor)
        throw new ProposalCredentialEligibilityError("actor", "not_found");
      if (!actor.active)
        throw new ProposalCredentialEligibilityError("actor", "inactive");
      if (!["administrator", "member"].includes(String(actor.role)))
        throw new ProposalCredentialEligibilityError("actor", "wrong_role");
      if (!owner)
        throw new ProposalCredentialEligibilityError("owner", "not_found");
      if (!owner.active)
        throw new ProposalCredentialEligibilityError("owner", "inactive");
      const result = await client.query(
        `INSERT INTO ${this.credentialsTable} (label, token_hash, actor_user_id, default_owner_id, scopes, created_by_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          credential.label,
          credential.tokenHash,
          credential.actorUserId,
          credential.defaultOwnerId,
          credential.scopes,
          administratorId,
        ],
      );
      await client.query("COMMIT");
      return mapCredential(result.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listCredentials(
    administratorId: string,
  ): Promise<ProposalCredentialRecord[]> {
    const authorization = await this.pool.query(
      `SELECT EXISTS (SELECT 1 FROM ${this.usersTable} administrator WHERE administrator.id=$1 AND administrator.active=true AND administrator.role='administrator') AS authorized`,
      [administratorId],
    );
    if (!authorization.rows[0]?.authorized)
      throw new ProposalAuthorizationError();
    const result = await this.pool.query(
      `SELECT credential.id, credential.label, credential.actor_user_id, credential.default_owner_id, credential.scopes, credential.created_by_id, credential.revoked_at, credential.created_at FROM ${this.credentialsTable} credential ORDER BY credential.created_at DESC, credential.id DESC`,
    );
    return result.rows.map(mapCredential);
  }

  async credentialForTokenHash(
    tokenHash: string,
    requiredScope?: ProposalCredentialScope,
  ): Promise<ProposalCredentialRecord | null> {
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) return null;
    const result = await this.pool.query(
      `SELECT credential.* FROM ${this.credentialsTable} credential
       JOIN ${this.usersTable} actor ON actor.id=credential.actor_user_id AND actor.active=true
       JOIN ${this.usersTable} owner ON owner.id=credential.default_owner_id AND owner.active=true
       WHERE credential.token_hash=$1 AND credential.revoked_at IS NULL
         AND ($2::text IS NULL OR $2=ANY(credential.scopes))`,
      [tokenHash, requiredScope ?? null],
    );
    return result.rows[0] ? mapCredential(result.rows[0]) : null;
  }

  async revokeCredential(
    administratorId: string,
    credentialId: string,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.credentialsTable} credential SET revoked_at=now()
       WHERE credential.id=$1 AND credential.revoked_at IS NULL
       AND EXISTS (SELECT 1 FROM ${this.usersTable} administrator WHERE administrator.id=$2 AND administrator.active=true AND administrator.role='administrator')`,
      [credentialId, administratorId],
    );
    if (result.rowCount !== 1) throw new ProposalAuthorizationError();
  }

  private async requireCredential(
    client: PoolClient,
    credentialId: string,
    scope: ProposalCredentialScope,
  ): Promise<QueryResultRow> {
    const result = await client.query(
      `SELECT credential.* FROM ${this.credentialsTable} credential
       JOIN ${this.usersTable} actor ON actor.id=credential.actor_user_id AND actor.active=true
       JOIN ${this.usersTable} owner ON owner.id=credential.default_owner_id AND owner.active=true
       WHERE credential.id=$1 AND credential.revoked_at IS NULL AND $2=ANY(credential.scopes) FOR SHARE OF credential, actor, owner`,
      [credentialId, scope],
    );
    if (!result.rows[0]) throw new ProposalAuthorizationError();
    return result.rows[0];
  }

  private async validateDirectBankTarget(
    client: PoolClient,
    bankTransactionId: string,
    expectedRevision: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT revision, matched_transaction_id, classification FROM ${this.bankTransactionsTable} WHERE id=$1 FOR SHARE`,
      [bankTransactionId],
    );
    const bank = result.rows[0];
    if (
      !bank ||
      String(bank.revision) !== expectedRevision ||
      bank.matched_transaction_id !== null ||
      bank.classification !== null
    )
      throw new Error("Intended bank row is stale or already resolved");
  }

  private async validateLocator(
    client: PoolClient,
    artifactId: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT artifact_profile, state, version_id FROM ${this.artifactsTable} WHERE id=$1 FOR SHARE`,
      [artifactId],
    );
    const artifact = result.rows[0];
    if (
      !artifact ||
      artifact.artifact_profile !== "commbank_transaction_history_csv_v1" ||
      !["awaiting_review", "available"].includes(String(artifact.state)) ||
      !artifact.version_id
    )
      throw new Error("Pinned CommBank locator artifact not found");
  }

  private async validateProposedEvidence(
    client: PoolClient,
    artifactId: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT artifact_profile, state, version_id FROM ${this.artifactsTable} WHERE id=$1 FOR SHARE`,
      [artifactId],
    );
    const artifact = result.rows[0];
    if (
      !artifact ||
      artifact.artifact_profile !== "manual_invoice_pdf_v1" ||
      !["awaiting_review", "available"].includes(String(artifact.state)) ||
      !artifact.version_id
    )
      throw new Error("Proposed invoice evidence not found");
  }

  private async validateExistingMatch(
    client: PoolClient,
    transactionId: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT source_system, status FROM ${this.transactionsTable} WHERE id=$1 FOR SHARE`,
      [transactionId],
    );
    const transaction = result.rows[0];
    if (
      !transaction ||
      transaction.source_system !== "manual" ||
      transaction.status !== "recorded"
    )
      throw new Error("Proposed match transaction is not recorded and manual");
  }

  private async createDraft(
    client: PoolClient,
    credential: QueryResultRow,
    transaction: TransactionInput,
    submissionNote: string | null,
  ): Promise<string> {
    const forcedTransaction: TransactionInput = {
      ...transaction,
      ownerId: String(credential.default_owner_id),
      sourceArtifactId: null,
      status: "draft",
      notes: proposalDraftNotes(transaction.notes, submissionNote),
    };
    assertTransactionRules(forcedTransaction, this.gstRegistered, null);
    const result = await client.query(
      `INSERT INTO ${this.transactionsTable} (owner_id, created_by_id, updated_by_id, source_system, kind, reference, counterparty, description, status, category, notes, occurred_at, available_at, invoice_date, settled_at, document_currency, document_amount, document_tax_amount, tax_treatment, settlement_currency, settlement_amount, gst_credit_status, claimable_gst_aud)
       VALUES ($1,$2,$2,'manual',$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
      [
        forcedTransaction.ownerId,
        credential.actor_user_id,
        forcedTransaction.kind,
        forcedTransaction.reference,
        forcedTransaction.counterparty,
        forcedTransaction.description,
        forcedTransaction.category,
        forcedTransaction.notes,
        forcedTransaction.occurredAt,
        forcedTransaction.availableAt,
        forcedTransaction.invoiceDate,
        forcedTransaction.settledAt,
        forcedTransaction.documentCurrency,
        forcedTransaction.documentAmount,
        forcedTransaction.documentTaxAmount,
        forcedTransaction.taxTreatment,
        forcedTransaction.settlementCurrency,
        forcedTransaction.settlementAmount,
        forcedTransaction.gstCreditStatus,
        forcedTransaction.claimableGstAud,
      ],
    );
    return String(result.rows[0]!.id);
  }

  async updateDraft(
    credentialId: string,
    transactionId: string,
    expectedUpdatedAt: string,
    changes: Partial<TransactionInput>,
  ): Promise<{ transactionId: string; updatedAt: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const credential = await this.requireCredential(
        client,
        credentialId,
        "transactions:draft",
      );
      const result = await client.query(
        `SELECT transaction.*, transaction.invoice_date::text AS invoice_date_text, ${updatedAtTokenProjection("transaction.updated_at")} FROM ${this.transactionsTable} transaction
         JOIN ${this.submissionsTable} submission ON submission.draft_transaction_id=transaction.id
         WHERE transaction.id=$1 AND submission.credential_id=$2 AND submission.kind='draft_transaction'
         FOR UPDATE OF transaction`,
        [transactionId, credentialId],
      );
      const row = result.rows[0];
      if (!row) throw new ProposalAuthorizationError();
      if (row.status !== "draft" || row.source_system !== "manual")
        throw new ProposalDraftNotEditableError();
      if (String(row.updated_at_token) !== expectedUpdatedAt)
        throw new ProposalTransactionConflictError();

      const linkedEvidence = await client.query(
        `SELECT artifact.id, artifact.artifact_profile, artifact.state
         FROM ${this.transactionArtifactsTable} link
         JOIN ${this.artifactsTable} artifact ON artifact.id=link.source_artifact_id
         WHERE link.transaction_id=$1 ORDER BY artifact.id LIMIT 1`,
        [transactionId],
      );
      const evidence = linkedEvidence.rows[0] ?? null;

      const current = transactionInputSchema.parse({
        ownerId: row.owner_id,
        sourceArtifactId: evidence ? String(evidence.id) : null,
        kind: row.kind,
        reference: row.reference,
        counterparty: row.counterparty,
        description: row.description,
        status: "draft",
        category: row.category,
        notes: row.notes,
        occurredAt: row.occurred_at ? iso(row.occurred_at) : null,
        availableAt: row.available_at ? iso(row.available_at) : null,
        invoiceDate: row.invoice_date_text ?? null,
        settledAt: row.settled_at ? iso(row.settled_at) : null,
        documentCurrency: row.document_currency,
        documentAmount: row.document_amount,
        documentTaxAmount: row.document_tax_amount,
        taxTreatment: row.tax_treatment,
        settlementCurrency: row.settlement_currency,
        settlementAmount: row.settlement_amount,
        gstCreditStatus: row.gst_credit_status,
        claimableGstAud: row.claimable_gst_aud,
      });
      const next = transactionInputSchema.parse({
        ...current,
        ...changes,
        ownerId: current.ownerId,
        sourceArtifactId: current.sourceArtifactId,
        status: "draft",
      });
      assertTransactionRules(
        next,
        this.gstRegistered,
        evidence
          ? {
              artifactProfile: evidence.artifact_profile,
              state: evidence.state,
            }
          : null,
      );
      const updated = await client.query(
        `UPDATE ${this.transactionsTable} SET owner_id=$2, updated_by_id=$3, kind=$4, reference=$5, counterparty=$6, description=$7, category=$8, notes=$9, occurred_at=$10, available_at=$11, invoice_date=$12, settled_at=$13, document_currency=$14, document_amount=$15, document_tax_amount=$16, tax_treatment=$17, settlement_currency=$18, settlement_amount=$19, gst_credit_status=$20, claimable_gst_aud=$21, updated_at=greatest(clock_timestamp(), updated_at + interval '1 microsecond')
         WHERE id=$1 AND status='draft' AND updated_at=$22::timestamptz RETURNING ${updatedAtTokenProjection("updated_at")}`,
        [
          transactionId,
          next.ownerId,
          credential.actor_user_id,
          next.kind,
          next.reference,
          next.counterparty,
          next.description,
          next.category,
          next.notes,
          next.occurredAt,
          next.availableAt,
          next.invoiceDate,
          next.settledAt,
          next.documentCurrency,
          next.documentAmount,
          next.documentTaxAmount,
          next.taxTreatment,
          next.settlementCurrency,
          next.settlementAmount,
          next.gstCreditStatus,
          next.claimableGstAud,
          expectedUpdatedAt,
        ],
      );
      if (!updated.rows[0]) throw new ProposalTransactionConflictError();
      await client.query("COMMIT");
      return {
        transactionId,
        updatedAt: String(updated.rows[0].updated_at_token),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async categorizeTransaction(
    credentialId: string,
    transactionId: string,
    expectedUpdatedAt: string,
    category: string | null,
  ): Promise<{ transactionId: string; updatedAt: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const credential = await this.requireCredential(
        client,
        credentialId,
        "transactions:categorize",
      );
      const current = await client.query(
        `SELECT ${updatedAtTokenProjection("updated_at")} FROM ${this.transactionsTable} WHERE id=$1 FOR UPDATE`,
        [transactionId],
      );
      if (!current.rows[0]) throw new ProposalTransactionNotFoundError();
      if (String(current.rows[0].updated_at_token) !== expectedUpdatedAt)
        throw new ProposalTransactionConflictError();
      const updated = await client.query(
        `UPDATE ${this.transactionsTable} SET category=$2, updated_by_id=$3, updated_at=greatest(clock_timestamp(), updated_at + interval '1 microsecond') WHERE id=$1 AND updated_at=$4::timestamptz RETURNING ${updatedAtTokenProjection("updated_at")}`,
        [transactionId, category, credential.actor_user_id, expectedUpdatedAt],
      );
      if (!updated.rows[0]) throw new ProposalTransactionConflictError();
      await client.query("COMMIT");
      return {
        transactionId,
        updatedAt: String(updated.rows[0].updated_at_token),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async submit(
    credentialId: string,
    input: ProposalSubmission,
    validation: {
      commBankLocator?: ValidatedCommBankArtifactRowLocator;
    } = {},
  ): Promise<ProposalSubmissionResult> {
    const submission = parseProposalSubmission(input);
    if (submission.bankTarget?.kind === "commbank_artifact_row") {
      const validated = validation.commBankLocator;
      if (
        !validated ||
        validated.artifactId !== submission.bankTarget.artifactId ||
        validated.sourceRow !== submission.bankTarget.sourceRow
      )
        throw new Error(
          "CommBank locator requires pinned application-layer row validation",
        );
    }
    const payloadHash = proposalPayloadHash(submission);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const credential = await this.requireCredential(
        client,
        credentialId,
        submission.kind === "draft_transaction"
          ? "transactions:draft"
          : "bank_matches:suggest",
      );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${credentialId}:${submission.idempotencyKey}`],
      );
      const existing = await client.query(
        `SELECT * FROM ${this.submissionsTable} WHERE credential_id=$1 AND request_key=$2`,
        [credentialId, submission.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].payload_sha256 !== payloadHash)
          throw new ProposalIdempotencyConflictError();
        await client.query("COMMIT");
        return {
          submissionId: String(existing.rows[0].id),
          kind: existing.rows[0].kind,
          linkedId: String(
            existing.rows[0].draft_transaction_id ??
              existing.rows[0].proposed_transaction_id,
          ),
          replayed: true,
        };
      }

      let bankTransactionId: string | null = null;
      let observedBankRevision: string | null = null;
      let sourceArtifactId: string | null = null;
      let sourceRow: number | null = null;
      if (submission.bankTarget?.kind === "bank_transaction") {
        bankTransactionId = submission.bankTarget.bankTransactionId;
        observedBankRevision = submission.bankTarget.expectedRevision;
        await this.validateDirectBankTarget(
          client,
          bankTransactionId,
          observedBankRevision,
        );
      } else if (submission.bankTarget?.kind === "commbank_artifact_row") {
        sourceArtifactId = submission.bankTarget.artifactId;
        sourceRow = submission.bankTarget.sourceRow;
        await this.validateLocator(client, sourceArtifactId);
      }

      let draftTransactionId: string | null = null;
      let proposedTransactionId: string | null = null;
      let proposedEvidenceArtifactId: string | null = null;
      if (submission.kind === "draft_transaction") {
        if (submission.proposedEvidenceArtifactId) {
          proposedEvidenceArtifactId = submission.proposedEvidenceArtifactId;
          await this.validateProposedEvidence(
            client,
            proposedEvidenceArtifactId,
          );
        }
        draftTransactionId = await this.createDraft(
          client,
          credential,
          submission.transaction,
          submission.note,
        );
      } else {
        proposedTransactionId = submission.existingTransactionId;
        await this.validateExistingMatch(client, proposedTransactionId);
      }

      const submissionId = randomUUID();
      await client.query(
        `INSERT INTO ${this.submissionsTable} (id, credential_id, request_key, payload_sha256, kind, draft_transaction_id, proposed_transaction_id, bank_transaction_id, observed_bank_revision, source_artifact_id, source_row, proposed_evidence_artifact_id, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          submissionId,
          credentialId,
          submission.idempotencyKey,
          payloadHash,
          submission.kind,
          draftTransactionId,
          proposedTransactionId,
          bankTransactionId,
          observedBankRevision,
          sourceArtifactId,
          sourceRow,
          proposedEvidenceArtifactId,
          submission.note,
        ],
      );
      await client.query("COMMIT");
      return {
        submissionId,
        kind: submission.kind,
        linkedId: draftTransactionId ?? proposedTransactionId!,
        replayed: false,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listSuggestionsForBankRow(
    bankTransactionId: string,
  ): Promise<BankProposalSuggestion[]> {
    const result = await this.pool.query(
      `SELECT submission.id AS submission_id, submission.kind, submission.note, submission.observed_bank_revision, submission.created_at,
        transaction.id AS transaction_id, transaction.status, transaction.kind AS transaction_kind,
        transaction.counterparty, transaction.reference, transaction.document_currency, transaction.document_amount,
        transaction.settlement_currency, transaction.settlement_amount,
        selected_bank.revision AS current_bank_revision, selected_bank.matched_transaction_id, selected_bank.classification
       FROM ${this.submissionsTable} submission
       JOIN ${this.transactionsTable} transaction ON transaction.id=coalesce(submission.draft_transaction_id, submission.proposed_transaction_id)
       JOIN ${this.bankTransactionsTable} selected_bank ON selected_bank.id=$1
       WHERE submission.bank_transaction_id=$1
          OR (submission.source_artifact_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM ${this.bankArtifactsTable} link
            WHERE link.bank_transaction_id=$1
              AND link.source_artifact_id=submission.source_artifact_id
              AND link.metadata->>'row'=submission.source_row::text
          ))
       ORDER BY submission.created_at, submission.id LIMIT 100`,
      [bankTransactionId],
    );
    return result.rows.map((row) => ({
      submissionId: String(row.submission_id),
      kind: row.kind,
      note: row.note ?? null,
      observedBankRevision: row.observed_bank_revision
        ? String(row.observed_bank_revision)
        : null,
      createdAt: iso(row.created_at),
      actionability:
        row.status === "void"
          ? "void"
          : row.matched_transaction_id !== null || row.classification !== null
            ? "resolved"
            : row.observed_bank_revision !== null &&
                String(row.observed_bank_revision) !==
                  String(row.current_bank_revision)
              ? "stale"
              : "actionable",
      transaction: {
        id: String(row.transaction_id),
        status: row.status,
        kind: String(row.transaction_kind),
        counterparty: row.counterparty ?? null,
        reference: row.reference ?? null,
        documentCurrency: row.document_currency ?? null,
        documentAmount: row.document_amount ?? null,
        settlementCurrency: row.settlement_currency ?? null,
        settlementAmount: row.settlement_amount ?? null,
      },
    }));
  }

  async getProposedEvidenceForDraft(
    actorId: string,
    transactionId: string,
  ): Promise<ProposedDraftEvidence | null> {
    const result = await this.pool.query(
      `SELECT submission.id AS submission_id, submission.draft_transaction_id,
        submission.proposed_evidence_artifact_id, submission.note,
        submission.evidence_discarded_at, artifact.filename, artifact.state
       FROM ${this.submissionsTable} submission
       JOIN ${this.artifactsTable} artifact ON artifact.id=submission.proposed_evidence_artifact_id
       JOIN ${this.transactionsTable} transaction ON transaction.id=submission.draft_transaction_id
       WHERE submission.draft_transaction_id=$2
         AND transaction.source_system='manual'
         AND EXISTS (
           SELECT 1 FROM ${this.usersTable} actor
           WHERE actor.id=$1 AND actor.active=true AND actor.role IN ('administrator','member')
         )`,
      [actorId, transactionId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      submissionId: String(row.submission_id),
      transactionId: String(row.draft_transaction_id),
      artifactId: String(row.proposed_evidence_artifact_id),
      filename: String(row.filename),
      state: String(row.state),
      note: row.note ?? null,
      discardedAt: row.evidence_discarded_at
        ? iso(row.evidence_discarded_at)
        : null,
    };
  }

  async discardProposedEvidenceForDraft(
    actorId: string,
    transactionId: string,
  ): Promise<ProposedDraftEvidence | null> {
    const result = await this.pool.query(
      `UPDATE ${this.submissionsTable} submission
       SET evidence_discarded_at=coalesce(submission.evidence_discarded_at, now()),
           evidence_discarded_by_id=coalesce(submission.evidence_discarded_by_id, $1)
       FROM ${this.artifactsTable} artifact
       WHERE submission.draft_transaction_id=$2
         AND submission.proposed_evidence_artifact_id=artifact.id
         AND EXISTS (
           SELECT 1 FROM ${this.usersTable} actor
           WHERE actor.id=$1 AND actor.active=true AND actor.role IN ('administrator','member')
         )
       RETURNING submission.id AS submission_id, submission.draft_transaction_id,
         submission.proposed_evidence_artifact_id, submission.note,
         submission.evidence_discarded_at, artifact.filename, artifact.state`,
      [actorId, transactionId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      submissionId: String(row.submission_id),
      transactionId: String(row.draft_transaction_id),
      artifactId: String(row.proposed_evidence_artifact_id),
      filename: String(row.filename),
      state: String(row.state),
      note: row.note ?? null,
      discardedAt: iso(row.evidence_discarded_at),
    };
  }
}
