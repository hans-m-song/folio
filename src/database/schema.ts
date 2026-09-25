import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
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
        sql`${table.state} in ('pending', 'available', 'rejected', 'superseded', 'abandoned', 'deleting')`,
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
        sql`(${table.state} in ('pending', 'abandoned') and ${table.versionId} is null and ${table.confirmedAt} is null) or (${table.state} in ('available', 'rejected', 'superseded') and ${table.versionId} is not null and ${table.confirmedAt} is not null) or (${table.state} = 'deleting' and ((${table.versionId} is null and ${table.confirmedAt} is null) or (${table.versionId} is not null and ${table.confirmedAt} is not null)))`,
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
        sql`${table.kind} in ('sale', 'supplier_expense', 'processing_fee', 'sale_refund', 'supplier_credit', 'dispute', 'transfer', 'owner_contribution', 'owner_loan', 'adjustment')`,
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
        "transactions_owner_gst_check",
        sql`${table.kind} not in ('owner_contribution', 'owner_loan') or (${table.gstCreditStatus} in ('not_claimable', 'not_registered') and coalesce(${table.claimableGstAud}, 0) = 0)`,
      ),
      check(
        "transactions_owner_tax_check",
        sql`${table.kind} not in ('owner_contribution', 'owner_loan') or (${table.taxTreatment} = 'no_tax' and coalesce(${table.documentTaxAmount}, 0) = 0)`,
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
  };
}
