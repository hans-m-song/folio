import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export function createFolioSchema(schemaName: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName))
    throw new Error("Invalid Folio database schema");
  const namespace = pgSchema(schemaName);
  const users = namespace.table(
    "users",
    {
      id: uuid().primaryKey().defaultRandom(),
      email: text().notNull(),
      displayName: text("display_name"),
      googleSubject: text("google_subject"),
      role: text().notNull().default("member"),
      active: boolean().notNull().default(true),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("users_email_lower_uidx").on(sql`lower(${table.email})`),
      uniqueIndex("users_google_subject_uidx").on(table.googleSubject),
      check(
        "users_role_check",
        sql`${table.role} in ('administrator', 'member', 'viewer')`,
      ),
    ],
  );
  const sourceArtifacts = namespace.table(
    "source_artifacts",
    {
      id: uuid().primaryKey().defaultRandom(),
      ownerId: uuid("owner_id").references(() => users.id),
      createdById: uuid("created_by_id")
        .notNull()
        .references(() => users.id),
      artifactProfile: text("artifact_profile").notNull(),
      objectKey: text("object_key").notNull().unique(),
      versionId: text("version_id"),
      filename: text().notNull(),
      mediaType: text("media_type").notNull(),
      byteSize: bigint("byte_size", { mode: "bigint" }).notNull(),
      checksumSha256: text("checksum_sha256").notNull(),
      state: text().notNull().default("pending"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
      confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    },
    (table) => [
      check(
        "source_artifacts_profile_check",
        sql`${table.artifactProfile} in ('manual_invoice_pdf_v1', 'stripe_balance_itemised_csv_v1', 'commbank_transaction_history_csv_v1', 'commbank_statement_pdf_v1', 'nab_transaction_history_csv_v1')`,
      ),
      check(
        "source_artifacts_state_check",
        sql`${table.state} in ('pending', 'awaiting_review', 'available', 'rejected', 'superseded', 'abandoned', 'deleting')`,
      ),
      check("source_artifacts_byte_size_check", sql`${table.byteSize} > 0`),
      index("source_artifacts_owner_id_idx").on(table.ownerId),
      index("source_artifacts_created_by_id_idx").on(table.createdById),
      check(
        "source_artifacts_media_type_check",
        sql`(${table.artifactProfile} in ('manual_invoice_pdf_v1', 'commbank_statement_pdf_v1') and ${table.mediaType} = 'application/pdf') or (${table.artifactProfile} in ('stripe_balance_itemised_csv_v1', 'commbank_transaction_history_csv_v1', 'nab_transaction_history_csv_v1') and ${table.mediaType} = 'text/csv')`,
      ),
      check(
        "source_artifacts_confirmation_check",
        sql`(${table.state} in ('pending', 'abandoned') and ${table.versionId} is null and ${table.confirmedAt} is null) or (${table.state} in ('awaiting_review', 'available', 'rejected', 'superseded') and ${table.versionId} is not null and ${table.confirmedAt} is not null) or (${table.state} = 'deleting' and ((${table.versionId} is null and ${table.confirmedAt} is null) or (${table.versionId} is not null and ${table.confirmedAt} is not null)))`,
      ),
      check(
        "source_artifacts_checksum_check",
        sql`${table.checksumSha256} ~ '^[A-Za-z0-9+/]{43}=$'`,
      ),
    ],
  );
  const transactions = namespace.table(
    "transactions",
    {
      id: uuid().primaryKey().defaultRandom(),
      ownerId: uuid("owner_id").references(() => users.id),
      createdById: uuid("created_by_id")
        .notNull()
        .references(() => users.id),
      updatedById: uuid("updated_by_id")
        .notNull()
        .references(() => users.id),
      sourceSystem: text("source_system").notNull(),
      kind: text().notNull(),
      reference: text(),
      counterparty: text(),
      description: text(),
      status: text().notNull().default("draft"),
      category: text(),
      notes: text(),
      metadata: jsonb().notNull().default({}),
      occurredAt: timestamp("occurred_at", { withTimezone: true }),
      availableAt: timestamp("available_at", { withTimezone: true }),
      invoiceDate: date("invoice_date"),
      settledAt: timestamp("settled_at", { withTimezone: true }),
      documentCurrency: varchar("document_currency", { length: 3 }),
      documentAmount: numeric("document_amount", { precision: 19, scale: 4 }),
      documentTaxAmount: numeric("document_tax_amount", {
        precision: 19,
        scale: 4,
      }),
      taxTreatment: text("tax_treatment").notNull().default("unknown_mixed"),
      settlementCurrency: varchar("settlement_currency", { length: 3 }),
      settlementAmount: numeric("settlement_amount", {
        precision: 19,
        scale: 4,
      }),
      gstCreditStatus: text("gst_credit_status")
        .notNull()
        .default("not_registered"),
      claimableGstAud: numeric("claimable_gst_aud", {
        precision: 19,
        scale: 4,
      }).default("0.0000"),
      sourceCurrency: varchar("source_currency", { length: 3 }),
      sourceGross: numeric("source_gross", { precision: 19, scale: 4 }),
      sourceFee: numeric("source_fee", { precision: 19, scale: 4 }),
      sourceNet: numeric("source_net", { precision: 19, scale: 4 }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("transactions_stripe_reference_uidx")
        .on(table.reference)
        .where(sql`${table.sourceSystem} = 'stripe'`),
      index("transactions_owner_id_idx").on(table.ownerId),
      index("transactions_created_by_id_idx").on(table.createdById),
      index("transactions_updated_by_id_idx").on(table.updatedById),
      index("transactions_occurred_at_idx").on(table.occurredAt),
      index("transactions_invoice_date_idx").on(table.invoiceDate),
      check(
        "transactions_source_system_check",
        sql`${table.sourceSystem} in ('manual', 'stripe')`,
      ),
      check(
        "transactions_status_check",
        sql`${table.status} in ('draft', 'recorded', 'void')`,
      ),
      check(
        "transactions_kind_check",
        sql`${table.kind} in ('sale', 'supplier_expense', 'processing_fee', 'sale_refund', 'supplier_credit', 'dispute', 'transfer', 'owner_contribution', 'owner_loan', 'owner_loan_repayment', 'adjustment')`,
      ),
      check(
        "transactions_tax_treatment_check",
        sql`${table.taxTreatment} in ('gst_included', 'gst_separately_shown', 'foreign_tax_included', 'no_tax', 'unknown_mixed')`,
      ),
      check(
        "transactions_gst_status_check",
        sql`${table.gstCreditStatus} in ('not_registered', 'unknown', 'not_claimable', 'claimable')`,
      ),
      check(
        "transactions_nonnegative_amounts_check",
        sql`coalesce(${table.documentAmount}, 0) >= 0 and coalesce(${table.documentTaxAmount}, 0) >= 0 and coalesce(${table.settlementAmount}, 0) >= 0 and coalesce(${table.claimableGstAud}, 0) >= 0`,
      ),
      check(
        "transactions_owner_amount_check",
        sql`${table.kind} not in ('owner_contribution', 'owner_loan') or ${table.documentAmount} > 0`,
      ),
      check(
        "transactions_owner_loan_repayment_owner_check",
        sql`${table.kind} <> 'owner_loan_repayment' or ${table.ownerId} is not null`,
      ),
      check(
        "transactions_owner_loan_repayment_amount_check",
        sql`${table.kind} <> 'owner_loan_repayment' or (${table.documentAmount} is not null and ${table.documentAmount} > 0)`,
      ),
      check(
        "transactions_owner_loan_repayment_settlement_check",
        sql`${table.kind} <> 'owner_loan_repayment' or ${table.settlementAmount} is null or ${table.settlementAmount} > 0`,
      ),
      check(
        "transactions_owner_gst_check",
        sql`${table.kind} not in ('owner_contribution', 'owner_loan', 'owner_loan_repayment') or (${table.gstCreditStatus} in ('not_claimable', 'not_registered') and coalesce(${table.claimableGstAud}, 0) = 0)`,
      ),
      check(
        "transactions_owner_tax_check",
        sql`${table.kind} not in ('owner_contribution', 'owner_loan', 'owner_loan_repayment') or (${table.taxTreatment} = 'no_tax' and coalesce(${table.documentTaxAmount}, 0) = 0)`,
      ),
      check(
        "transactions_currency_check",
        sql`(${table.documentCurrency} is null or ${table.documentCurrency} ~ '^[A-Z]{3}$') and (${table.settlementCurrency} is null or ${table.settlementCurrency} ~ '^[A-Z]{3}$') and (${table.sourceCurrency} is null or ${table.sourceCurrency} ~ '^[A-Z]{3}$')`,
      ),
      check(
        "transactions_source_values_check",
        sql`(${table.sourceSystem} = 'manual' and ${table.sourceCurrency} is null and ${table.sourceGross} is null and ${table.sourceFee} is null and ${table.sourceNet} is null) or (${table.sourceSystem} = 'stripe' and ${table.occurredAt} is not null and ${table.sourceCurrency} is not null and ${table.sourceGross} is not null and ${table.sourceFee} is not null and ${table.sourceNet} is not null and round(${table.sourceGross} - ${table.sourceFee}, 2) = round(${table.sourceNet}, 2))`,
      ),
      check(
        "transactions_amount_currency_pair_check",
        sql`(${table.documentAmount} is null) = (${table.documentCurrency} is null) and (${table.settlementAmount} is null) = (${table.settlementCurrency} is null)`,
      ),
      check(
        "transactions_updated_at_check",
        sql`${table.updatedAt} >= ${table.createdAt}`,
      ),
    ],
  );
  const transactionArtifacts = namespace.table(
    "transaction_artifacts",
    {
      transactionId: uuid("transaction_id")
        .notNull()
        .references(() => transactions.id, { onDelete: "cascade" }),
      sourceArtifactId: uuid("source_artifact_id")
        .notNull()
        .references(() => sourceArtifacts.id, { onDelete: "restrict" }),
      metadata: jsonb(),
    },
    (table) => [
      primaryKey({
        name: "transaction_artifacts_pkey",
        columns: [table.transactionId, table.sourceArtifactId],
      }),
      check(
        "transaction_artifacts_metadata_check",
        sql`${table.metadata} is null or jsonb_typeof(${table.metadata}) = 'object'`,
      ),
      index("transaction_artifacts_source_artifact_id_idx").on(
        table.sourceArtifactId,
      ),
    ],
  );
  const bankTransactions = namespace.table(
    "bank_transactions",
    {
      id: uuid().primaryKey().defaultRandom(),
      postedDate: date("posted_date").notNull(),
      amountAud: numeric("amount_aud", { precision: 19, scale: 4 }).notNull(),
      description: text().notNull(),
      metadata: jsonb().notNull().default({}),
      matchedTransactionId: uuid("matched_transaction_id").references(
        () => transactions.id,
        { onDelete: "restrict" },
      ),
      classification: text(),
      revision: bigint({ mode: "bigint" }).notNull().default(1n),
      createdById: uuid("created_by_id")
        .notNull()
        .references(() => users.id),
      updatedById: uuid("updated_by_id")
        .notNull()
        .references(() => users.id),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      check("bank_transactions_amount_check", sql`${table.amountAud} <> 0`),
      check(
        "bank_transactions_metadata_check",
        sql`jsonb_typeof(${table.metadata}) = 'object'`,
      ),
      check(
        "bank_transactions_classification_check",
        sql`${table.classification} is null or ${table.classification} in ('private', 'transfer', 'duplicate')`,
      ),
      check(
        "bank_transactions_resolution_check",
        sql`not (${table.matchedTransactionId} is not null and ${table.classification} is not null)`,
      ),
      check("bank_transactions_revision_check", sql`${table.revision} > 0`),
      uniqueIndex("bank_transactions_matched_transaction_uidx")
        .on(table.matchedTransactionId)
        .where(sql`${table.matchedTransactionId} is not null`),
      index("bank_transactions_posted_date_idx").on(table.postedDate, table.id),
      index("bank_transactions_created_by_id_idx").on(table.createdById),
    ],
  );
  const bankTransactionArtifacts = namespace.table(
    "bank_transaction_artifacts",
    {
      bankTransactionId: uuid("bank_transaction_id")
        .notNull()
        .references(() => bankTransactions.id, { onDelete: "cascade" }),
      sourceArtifactId: uuid("source_artifact_id")
        .notNull()
        .references(() => sourceArtifacts.id, { onDelete: "restrict" }),
      metadata: jsonb(),
    },
    (table) => [
      primaryKey({
        name: "bank_transaction_artifacts_pkey",
        columns: [table.bankTransactionId, table.sourceArtifactId],
      }),
      check(
        "bank_transaction_artifacts_metadata_check",
        sql`${table.metadata} is null or jsonb_typeof(${table.metadata}) = 'object'`,
      ),
      index("bank_transaction_artifacts_source_artifact_id_idx").on(
        table.sourceArtifactId,
      ),
    ],
  );
  const authAttempts = namespace.table(
    "auth_attempts",
    {
      stateHash: varchar("state_hash", { length: 64 }).primaryKey(),
      nonce: text().notNull(),
      codeVerifier: text("code_verifier").notNull(),
      returnPath: text("return_path").notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      check(
        "auth_attempts_state_hash_check",
        sql`${table.stateHash} ~ '^[a-f0-9]{64}$'`,
      ),
      index("auth_attempts_expires_at_idx").on(table.expiresAt),
    ],
  );
  const authSessions = namespace.table(
    "auth_sessions",
    {
      tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      revokedAt: timestamp("revoked_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      check(
        "auth_sessions_token_hash_check",
        sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`,
      ),
      index("auth_sessions_user_id_idx").on(table.userId),
      index("auth_sessions_expires_at_idx").on(table.expiresAt),
    ],
  );
  const mcpCredentials = namespace.table(
    "mcp_credentials",
    {
      id: uuid().primaryKey().defaultRandom(),
      label: text().notNull(),
      tokenHash: varchar("token_hash", { length: 64 }).notNull(),
      actorUserId: uuid("actor_user_id")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
      defaultOwnerId: uuid("default_owner_id")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
      scopes: text().array().notNull(),
      createdById: uuid("created_by_id")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
      revokedAt: timestamp("revoked_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("mcp_credentials_token_hash_uidx").on(table.tokenHash),
      check(
        "mcp_credentials_token_hash_check",
        sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`,
      ),
      check(
        "mcp_credentials_actor_owner_check",
        sql`${table.actorUserId} <> ${table.defaultOwnerId}`,
      ),
      check(
        "mcp_credentials_dedicated_actor_check",
        sql`${table.actorUserId} <> ${table.createdById}`,
      ),
      check(
        "mcp_credentials_scopes_check",
        sql`cardinality(${table.scopes}) between 1 and 8 and ${table.scopes} <@ array['bank_rows:read', 'transactions:search', 'transactions:draft', 'transactions:categorize', 'bank_matches:suggest', 'artifacts:read', 'artifacts:upload', 'submissions:read']::text[]`,
      ),
      index("mcp_credentials_actor_user_id_idx").on(table.actorUserId),
      index("mcp_credentials_default_owner_id_idx").on(table.defaultOwnerId),
    ],
  );
  const mcpSubmissions = namespace.table(
    "mcp_submissions",
    {
      id: uuid().primaryKey().defaultRandom(),
      credentialId: uuid("credential_id")
        .notNull()
        .references(() => mcpCredentials.id, { onDelete: "restrict" }),
      requestKey: varchar("request_key", { length: 200 }).notNull(),
      payloadSha256: varchar("payload_sha256", { length: 64 }).notNull(),
      kind: text().notNull(),
      draftTransactionId: uuid("draft_transaction_id").references(
        () => transactions.id,
        { onDelete: "restrict" },
      ),
      proposedTransactionId: uuid("proposed_transaction_id").references(
        () => transactions.id,
        { onDelete: "restrict" },
      ),
      bankTransactionId: uuid("bank_transaction_id").references(
        () => bankTransactions.id,
        { onDelete: "restrict" },
      ),
      observedBankRevision: bigint("observed_bank_revision", {
        mode: "bigint",
      }),
      sourceArtifactId: uuid("source_artifact_id").references(
        () => sourceArtifacts.id,
        { onDelete: "restrict" },
      ),
      sourceRow: integer("source_row"),
      proposedEvidenceArtifactId: uuid(
        "proposed_evidence_artifact_id",
      ).references(() => sourceArtifacts.id, { onDelete: "restrict" }),
      evidenceDiscardedAt: timestamp("evidence_discarded_at", {
        withTimezone: true,
      }),
      evidenceDiscardedById: uuid("evidence_discarded_by_id").references(
        () => users.id,
        { onDelete: "restrict" },
      ),
      note: text(),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("mcp_submissions_idempotency_uidx").on(
        table.credentialId,
        table.requestKey,
      ),
      check(
        "mcp_submissions_payload_sha256_check",
        sql`${table.payloadSha256} ~ '^[a-f0-9]{64}$'`,
      ),
      check(
        "mcp_submissions_kind_check",
        sql`${table.kind} in ('draft_transaction', 'existing_match')`,
      ),
      check(
        "mcp_submissions_request_key_check",
        sql`${table.requestKey} ~ '^[A-Za-z0-9._:-]+$'`,
      ),
      check(
        "mcp_submissions_result_check",
        sql`(${table.kind} = 'draft_transaction' and ${table.draftTransactionId} is not null and ${table.proposedTransactionId} is null) or (${table.kind} = 'existing_match' and ${table.draftTransactionId} is null and ${table.proposedTransactionId} is not null)`,
      ),
      check(
        "mcp_submissions_direct_target_check",
        sql`(${table.bankTransactionId} is null) = (${table.observedBankRevision} is null) and (${table.observedBankRevision} is null or ${table.observedBankRevision} > 0)`,
      ),
      check(
        "mcp_submissions_locator_check",
        sql`(${table.sourceArtifactId} is null) = (${table.sourceRow} is null) and (${table.sourceRow} is null or ${table.sourceRow} > 0) and not (${table.bankTransactionId} is not null and ${table.sourceArtifactId} is not null)`,
      ),
      check(
        "mcp_submissions_match_target_check",
        sql`${table.kind} <> 'existing_match' or (${table.bankTransactionId} is not null and ${table.sourceArtifactId} is null and ${table.proposedEvidenceArtifactId} is null)`,
      ),
      check(
        "mcp_submissions_draft_evidence_check",
        sql`${table.proposedEvidenceArtifactId} is null or ${table.kind} = 'draft_transaction'`,
      ),
      check(
        "mcp_submissions_evidence_discard_check",
        sql`(${table.evidenceDiscardedAt} is null) = (${table.evidenceDiscardedById} is null) and (${table.evidenceDiscardedAt} is null or ${table.proposedEvidenceArtifactId} is not null)`,
      ),
      uniqueIndex("mcp_submissions_draft_transaction_uidx")
        .on(table.draftTransactionId)
        .where(sql`${table.draftTransactionId} is not null`),
      index("mcp_submissions_bank_transaction_id_idx").on(
        table.bankTransactionId,
        table.createdAt,
        table.id,
      ),
      index("mcp_submissions_locator_idx").on(
        table.sourceArtifactId,
        table.sourceRow,
        table.createdAt,
        table.id,
      ),
    ],
  );
  const mcpUploadIntents = namespace.table(
    "mcp_upload_intents",
    {
      credentialId: uuid("credential_id")
        .notNull()
        .references(() => mcpCredentials.id, { onDelete: "restrict" }),
      requestKey: varchar("request_key", { length: 200 }).notNull(),
      payloadSha256: varchar("payload_sha256", { length: 64 }).notNull(),
      artifactId: uuid("artifact_id").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      primaryKey({
        name: "mcp_upload_intents_pkey",
        columns: [table.credentialId, table.requestKey],
      }),
      uniqueIndex("mcp_upload_intents_artifact_id_uidx").on(table.artifactId),
      check(
        "mcp_upload_intents_request_key_check",
        sql`${table.requestKey} ~ '^[A-Za-z0-9._:-]+$'`,
      ),
      check(
        "mcp_upload_intents_payload_sha256_check",
        sql`${table.payloadSha256} ~ '^[a-f0-9]{64}$'`,
      ),
    ],
  );
  const taxReviewSnapshots = namespace.table(
    "tax_review_snapshots",
    {
      id: uuid().primaryKey().defaultRandom(),
      financialYearStartYear: integer("financial_year_start_year").notNull(),
      snapshot: jsonb().notNull(),
      sourceFingerprint: text("source_fingerprint").notNull(),
      reviewerUserId: uuid("reviewer_user_id")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
      reviewedAt: timestamp("reviewed_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      check(
        "tax_review_snapshots_financial_year_check",
        sql`${table.financialYearStartYear} between 1 and 9999`,
      ),
      check(
        "tax_review_snapshots_snapshot_check",
        sql`jsonb_typeof(${table.snapshot}) = 'object' and ${table.snapshot} ?& array['cashLedger', 'humanAdjustments', 'partnerShares', 'totals', 'reviewerAttestation']::text[] and jsonb_typeof(${table.snapshot}->'reviewerAttestation') = 'string' and btrim(${table.snapshot}->>'reviewerAttestation') <> ''`,
      ),
      check(
        "tax_review_snapshots_fingerprint_check",
        sql`btrim(${table.sourceFingerprint}) <> ''`,
      ),
      index("tax_review_snapshots_fy_reviewed_idx").on(
        table.financialYearStartYear,
        table.reviewedAt,
        table.id,
      ),
      index("tax_review_snapshots_reviewer_user_id_idx").on(
        table.reviewerUserId,
      ),
    ],
  );
  const recurringBillSchedules = namespace.table(
    "recurring_bill_schedules",
    {
      id: uuid().primaryKey().defaultRandom(),
      label: text().notNull(),
      counterparty: text().notNull(),
      descriptionMatchText: text("description_match_text"),
      descriptionMatchMode: text("description_match_mode")
        .notNull()
        .default("contains"),
      documentCurrency: varchar("document_currency", { length: 3 }).notNull(),
      expectedAmount: numeric("expected_amount", {
        precision: 19,
        scale: 4,
      }),
      frequency: text().notNull(),
      anchorDate: date("anchor_date").notNull(),
      daysEarly: integer("days_early").notNull().default(3),
      daysLate: integer("days_late").notNull().default(3),
      responsibleUserId: uuid("responsible_user_id").references(
        () => users.id,
        { onDelete: "restrict" },
      ),
      active: boolean().notNull().default(true),
      createdById: uuid("created_by_id")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
      updatedById: uuid("updated_by_id")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      check(
        "recurring_bill_schedules_label_check",
        sql`btrim(${table.label}) <> '' and char_length(${table.label}) <= 200`,
      ),
      check(
        "recurring_bill_schedules_counterparty_check",
        sql`btrim(${table.counterparty}) <> '' and char_length(${table.counterparty}) <= 300`,
      ),
      check(
        "recurring_bill_schedules_description_check",
        sql`${table.descriptionMatchText} is null or (btrim(${table.descriptionMatchText}) <> '' and char_length(${table.descriptionMatchText}) <= 2000)`,
      ),
      check(
        "recurring_bill_schedules_description_match_mode_check",
        sql`${table.descriptionMatchMode} in ('contains', 'regex')`,
      ),
      check(
        "recurring_bill_schedules_currency_check",
        sql`${table.documentCurrency} ~ '^[A-Z]{3}$'`,
      ),
      check(
        "recurring_bill_schedules_amount_check",
        sql`${table.expectedAmount} is null or ${table.expectedAmount} >= 0`,
      ),
      check(
        "recurring_bill_schedules_frequency_check",
        sql`${table.frequency} in ('monthly', 'annual')`,
      ),
      check(
        "recurring_bill_schedules_days_early_check",
        sql`${table.daysEarly} between 0 and 365`,
      ),
      check(
        "recurring_bill_schedules_days_late_check",
        sql`${table.daysLate} between 0 and 365`,
      ),
      check(
        "recurring_bill_schedules_updated_at_check",
        sql`${table.updatedAt} >= ${table.createdAt}`,
      ),
      index("recurring_bill_schedules_active_anchor_idx").on(
        table.active,
        table.anchorDate,
      ),
      index("recurring_bill_schedules_responsible_user_id_idx").on(
        table.responsibleUserId,
      ),
    ],
  );
  const recurringBillLinks = namespace.table(
    "recurring_bill_links",
    {
      scheduleId: uuid("schedule_id")
        .notNull()
        .references(() => recurringBillSchedules.id, { onDelete: "restrict" }),
      expectedDate: date("expected_date").notNull(),
      transactionId: uuid("transaction_id")
        .notNull()
        .references(() => transactions.id, { onDelete: "restrict" }),
      createdById: uuid("created_by_id")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      primaryKey({
        name: "recurring_bill_links_pkey",
        columns: [table.scheduleId, table.expectedDate],
      }),
      uniqueIndex("recurring_bill_links_transaction_uidx").on(
        table.transactionId,
      ),
      index("recurring_bill_links_created_by_id_idx").on(table.createdById),
    ],
  );
  return {
    namespace,
    users,
    sourceArtifacts,
    transactions,
    transactionArtifacts,
    bankTransactions,
    bankTransactionArtifacts,
    authAttempts,
    authSessions,
    mcpCredentials,
    mcpSubmissions,
    mcpUploadIntents,
    taxReviewSnapshots,
    recurringBillSchedules,
    recurringBillLinks,
  };
}
