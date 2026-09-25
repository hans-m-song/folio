-- CREATE SCHEMA IF NOT EXISTS "__FOLIO_SCHEMA__";

CREATE TABLE "__FOLIO_SCHEMA__"."users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL,
  "display_name" text,
  "google_subject" text,
  "role" text NOT NULL DEFAULT 'member' CHECK ("role" IN ('administrator', 'member', 'viewer')),
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "users_email_lower_uidx" ON "__FOLIO_SCHEMA__"."users" (lower("email"));
CREATE UNIQUE INDEX "users_google_subject_uidx" ON "__FOLIO_SCHEMA__"."users" ("google_subject") WHERE "google_subject" IS NOT NULL;

CREATE TABLE "__FOLIO_SCHEMA__"."source_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" uuid REFERENCES "__FOLIO_SCHEMA__"."users"("id"),
  "created_by_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."users"("id"),
  "kind" text NOT NULL CHECK ("kind" IN ('pdf', 'stripe_csv')),
  "object_key" text NOT NULL UNIQUE,
  "version_id" text,
  "filename" text NOT NULL,
  "media_type" text NOT NULL,
  "byte_size" bigint NOT NULL CHECK ("byte_size" > 0),
  "checksum_sha256" text NOT NULL CHECK ("checksum_sha256" ~ '^[A-Za-z0-9+/]{43}=$'),
  "state" text NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending', 'available', 'superseded', 'abandoned')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "confirmed_at" timestamptz,
  CONSTRAINT "source_artifacts_media_type_check" CHECK (("kind" = 'pdf' AND "media_type" = 'application/pdf') OR ("kind" = 'stripe_csv' AND "media_type" = 'text/csv')),
  CONSTRAINT "source_artifacts_confirmation_check" CHECK (("state" IN ('pending', 'abandoned') AND "version_id" IS NULL AND "confirmed_at" IS NULL) OR ("state" IN ('available', 'superseded') AND "version_id" IS NOT NULL AND "confirmed_at" IS NOT NULL))
);
CREATE INDEX "source_artifacts_owner_id_idx" ON "__FOLIO_SCHEMA__"."source_artifacts" ("owner_id");
CREATE INDEX "source_artifacts_created_by_id_idx" ON "__FOLIO_SCHEMA__"."source_artifacts" ("created_by_id");

CREATE TABLE "__FOLIO_SCHEMA__"."transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" uuid REFERENCES "__FOLIO_SCHEMA__"."users"("id"),
  "created_by_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."users"("id"),
  "updated_by_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."users"("id"),
  "source_artifact_id" uuid REFERENCES "__FOLIO_SCHEMA__"."source_artifacts"("id"),
  "source_system" text NOT NULL CHECK ("source_system" IN ('manual', 'stripe')),
  "kind" text NOT NULL CHECK ("kind" IN ('sale', 'supplier_expense', 'processing_fee', 'sale_refund', 'supplier_credit', 'dispute', 'transfer', 'adjustment')),
  "reference" text,
  "counterparty" text,
  "description" text,
  "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'recorded', 'void')),
  "category" text,
  "notes" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamptz,
  "available_at" timestamptz,
  "invoice_date" date,
  "settled_at" timestamptz,
  "document_currency" varchar(3),
  "document_amount" numeric(19,4),
  "document_tax_amount" numeric(19,4),
  "settlement_currency" varchar(3),
  "settlement_amount" numeric(19,4),
  "gst_credit_status" text NOT NULL DEFAULT 'not_registered' CHECK ("gst_credit_status" IN ('not_registered', 'unknown', 'not_claimable', 'claimable')),
  "claimable_gst_aud" numeric(19,4) DEFAULT 0,
  "source_currency" varchar(3),
  "source_gross" numeric(19,4),
  "source_fee" numeric(19,4),
  "source_net" numeric(19,4),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "transactions_nonnegative_amounts_check" CHECK (coalesce("document_amount", 0) >= 0 AND coalesce("document_tax_amount", 0) >= 0 AND coalesce("settlement_amount", 0) >= 0 AND coalesce("claimable_gst_aud", 0) >= 0),
  CONSTRAINT "transactions_currency_check" CHECK (("document_currency" IS NULL OR "document_currency" ~ '^[A-Z]{3}$') AND ("settlement_currency" IS NULL OR "settlement_currency" ~ '^[A-Z]{3}$') AND ("source_currency" IS NULL OR "source_currency" ~ '^[A-Z]{3}$')),
  CONSTRAINT "transactions_source_values_check" CHECK (("source_system" = 'manual' AND "source_currency" IS NULL AND "source_gross" IS NULL AND "source_fee" IS NULL AND "source_net" IS NULL) OR ("source_system" = 'stripe' AND "source_artifact_id" IS NOT NULL AND "occurred_at" IS NOT NULL AND "source_currency" IS NOT NULL AND "source_gross" IS NOT NULL AND "source_fee" IS NOT NULL AND "source_net" IS NOT NULL AND round("source_gross" - "source_fee", 2) = round("source_net", 2))),
  CONSTRAINT "transactions_amount_currency_pair_check" CHECK (("document_amount" IS NULL) = ("document_currency" IS NULL) AND ("settlement_amount" IS NULL) = ("settlement_currency" IS NULL)),
  CONSTRAINT "transactions_updated_at_check" CHECK ("updated_at" >= "created_at")
);
CREATE UNIQUE INDEX "transactions_stripe_reference_uidx" ON "__FOLIO_SCHEMA__"."transactions" ("reference") WHERE "source_system" = 'stripe';
CREATE UNIQUE INDEX "transactions_manual_artifact_uidx" ON "__FOLIO_SCHEMA__"."transactions" ("source_artifact_id") WHERE "source_system" = 'manual' AND "source_artifact_id" IS NOT NULL;
CREATE INDEX "transactions_owner_id_idx" ON "__FOLIO_SCHEMA__"."transactions" ("owner_id");
CREATE INDEX "transactions_created_by_id_idx" ON "__FOLIO_SCHEMA__"."transactions" ("created_by_id");
CREATE INDEX "transactions_updated_by_id_idx" ON "__FOLIO_SCHEMA__"."transactions" ("updated_by_id");
CREATE INDEX "transactions_source_artifact_id_idx" ON "__FOLIO_SCHEMA__"."transactions" ("source_artifact_id");
CREATE INDEX "transactions_occurred_at_idx" ON "__FOLIO_SCHEMA__"."transactions" ("occurred_at");
CREATE INDEX "transactions_invoice_date_idx" ON "__FOLIO_SCHEMA__"."transactions" ("invoice_date");

CREATE FUNCTION "__FOLIO_SCHEMA__"."enforce_transaction_artifact"() RETURNS trigger LANGUAGE plpgsql AS $folio$
BEGIN
  IF NEW."source_system" = 'manual' AND NEW."source_artifact_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "__FOLIO_SCHEMA__"."source_artifacts" artifact
    WHERE artifact."id" = NEW."source_artifact_id" AND artifact."kind" = 'pdf' AND artifact."state" = 'available'
  ) THEN
    RAISE EXCEPTION 'manual transactions require an available PDF invoice artifact';
  END IF;
  IF NEW."source_system" = 'stripe' AND NOT EXISTS (
    SELECT 1 FROM "__FOLIO_SCHEMA__"."source_artifacts" artifact
    WHERE artifact."id" = NEW."source_artifact_id" AND artifact."kind" = 'stripe_csv' AND artifact."state" = 'available'
  ) THEN
    RAISE EXCEPTION 'Stripe transactions require an available Stripe CSV artifact';
  END IF;
  IF NEW."gst_credit_status" = 'claimable' AND NOT EXISTS (
    SELECT 1 FROM "__FOLIO_SCHEMA__"."source_artifacts" artifact
    WHERE artifact."id" = NEW."source_artifact_id" AND artifact."kind" = 'pdf' AND artifact."state" = 'available'
  ) THEN
    RAISE EXCEPTION 'claimable GST requires an available PDF invoice';
  END IF;
  RETURN NEW;
END
$folio$;
CREATE TRIGGER "transactions_artifact_trigger" BEFORE INSERT OR UPDATE ON "__FOLIO_SCHEMA__"."transactions" FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."enforce_transaction_artifact"();

CREATE FUNCTION "__FOLIO_SCHEMA__"."preserve_claimable_evidence"() RETURNS trigger LANGUAGE plpgsql AS $folio$
BEGIN
  IF OLD."state" = 'available' AND NEW."state" <> 'available' AND EXISTS (
    SELECT 1 FROM "__FOLIO_SCHEMA__"."transactions" candidate
    WHERE candidate."source_artifact_id" = OLD."id" AND candidate."gst_credit_status" = 'claimable'
  ) THEN
    RAISE EXCEPTION 'cannot make claimable transaction evidence unavailable';
  END IF;
  RETURN NEW;
END
$folio$;
CREATE TRIGGER "source_artifacts_preserve_claimable_trigger" BEFORE UPDATE OF "state" ON "__FOLIO_SCHEMA__"."source_artifacts" FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."preserve_claimable_evidence"();
