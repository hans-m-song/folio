CREATE TABLE "__FOLIO_SCHEMA__"."bank_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "posted_date" date NOT NULL,
  "amount_aud" numeric(19,4) NOT NULL,
  "description" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "matched_transaction_id" uuid REFERENCES "__FOLIO_SCHEMA__"."transactions"("id") ON DELETE RESTRICT,
  "classification" text,
  "revision" bigint NOT NULL DEFAULT 1,
  "created_by_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."users"("id"),
  "updated_by_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "bank_transactions_amount_check" CHECK ("amount_aud" <> 0),
  CONSTRAINT "bank_transactions_metadata_check" CHECK (jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "bank_transactions_classification_check" CHECK ("classification" IS NULL OR "classification" IN ('private', 'transfer', 'duplicate')),
  CONSTRAINT "bank_transactions_resolution_check" CHECK (NOT ("matched_transaction_id" IS NOT NULL AND "classification" IS NOT NULL)),
  CONSTRAINT "bank_transactions_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "bank_transactions_updated_at_check" CHECK ("updated_at" >= "created_at")
);

CREATE UNIQUE INDEX "bank_transactions_matched_transaction_uidx"
  ON "__FOLIO_SCHEMA__"."bank_transactions" ("matched_transaction_id")
  WHERE "matched_transaction_id" IS NOT NULL;
CREATE INDEX "bank_transactions_posted_date_idx"
  ON "__FOLIO_SCHEMA__"."bank_transactions" ("posted_date" DESC, "id");
CREATE INDEX "bank_transactions_created_by_id_idx"
  ON "__FOLIO_SCHEMA__"."bank_transactions" ("created_by_id");

CREATE TABLE "__FOLIO_SCHEMA__"."bank_transaction_artifacts" (
  "bank_transaction_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."bank_transactions"("id") ON DELETE CASCADE,
  "source_artifact_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."source_artifacts"("id") ON DELETE RESTRICT,
  "metadata" jsonb,
  CONSTRAINT "bank_transaction_artifacts_pkey" PRIMARY KEY ("bank_transaction_id", "source_artifact_id"),
  CONSTRAINT "bank_transaction_artifacts_metadata_check" CHECK ("metadata" IS NULL OR jsonb_typeof("metadata") = 'object')
);

CREATE INDEX "bank_transaction_artifacts_source_artifact_id_idx"
  ON "__FOLIO_SCHEMA__"."bank_transaction_artifacts" ("source_artifact_id");

CREATE UNIQUE INDEX "source_artifacts_available_bank_checksum_uidx"
  ON "__FOLIO_SCHEMA__"."source_artifacts" ("artifact_profile", "checksum_sha256")
  WHERE "state" = 'available' AND "artifact_profile" = 'commbank_transaction_history_csv_v1';

CREATE OR REPLACE FUNCTION "__FOLIO_SCHEMA__"."protect_bank_source_fields"() RETURNS trigger LANGUAGE plpgsql AS $folio$
BEGIN
  IF OLD."posted_date" IS DISTINCT FROM NEW."posted_date"
    OR OLD."amount_aud" IS DISTINCT FROM NEW."amount_aud"
    OR OLD."description" IS DISTINCT FROM NEW."description"
    OR OLD."metadata" IS DISTINCT FROM NEW."metadata"
    OR OLD."created_by_id" IS DISTINCT FROM NEW."created_by_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Bank source fields are immutable';
  END IF;
  RETURN NEW;
END
$folio$;
CREATE TRIGGER "bank_transactions_source_immutable_trigger"
  BEFORE UPDATE ON "__FOLIO_SCHEMA__"."bank_transactions"
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."protect_bank_source_fields"();

CREATE OR REPLACE FUNCTION "__FOLIO_SCHEMA__"."protect_bank_artifact_link"() RETURNS trigger LANGUAGE plpgsql AS $folio$
DECLARE artifact_profile text;
DECLARE artifact_state text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Bank artifact relationship identity is immutable';
  END IF;
  SELECT artifact."artifact_profile", artifact."state" INTO artifact_profile, artifact_state
  FROM "__FOLIO_SCHEMA__"."source_artifacts" artifact
  WHERE artifact."id" = NEW."source_artifact_id";
  IF artifact_profile NOT IN ('commbank_transaction_history_csv_v1', 'commbank_statement_pdf_v1', 'nab_transaction_history_csv_v1') THEN
    RAISE EXCEPTION 'Bank transactions require a bank activity artifact profile';
  END IF;
  IF artifact_state <> 'available' THEN
    RAISE EXCEPTION 'Bank transaction artifacts must reference an available artifact';
  END IF;
  RETURN NEW;
END
$folio$;
CREATE CONSTRAINT TRIGGER "bank_transaction_artifacts_immutable_trigger"
  AFTER INSERT OR UPDATE ON "__FOLIO_SCHEMA__"."bank_transaction_artifacts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."protect_bank_artifact_link"();
