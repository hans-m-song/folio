ALTER TABLE "__FOLIO_SCHEMA__"."source_artifacts"
  RENAME COLUMN "kind" TO "artifact_profile";

ALTER TABLE "__FOLIO_SCHEMA__"."source_artifacts"
  DROP CONSTRAINT "source_artifacts_kind_check",
  DROP CONSTRAINT "source_artifacts_media_type_check";

UPDATE "__FOLIO_SCHEMA__"."source_artifacts"
SET "artifact_profile" = CASE "artifact_profile"
  WHEN 'pdf' THEN 'manual_invoice_pdf_v1'
  WHEN 'stripe_csv' THEN 'stripe_balance_itemised_csv_v1'
  ELSE "artifact_profile"
END;

ALTER TABLE "__FOLIO_SCHEMA__"."source_artifacts"
  ADD CONSTRAINT "source_artifacts_profile_check"
    CHECK ("artifact_profile" IN (
      'manual_invoice_pdf_v1',
      'stripe_balance_itemised_csv_v1',
      'commbank_transaction_history_csv_v1',
      'commbank_statement_pdf_v1',
      'nab_transaction_history_csv_v1'
    )),
  ADD CONSTRAINT "source_artifacts_media_type_check"
    CHECK (
      ("artifact_profile" IN ('manual_invoice_pdf_v1', 'commbank_statement_pdf_v1') AND "media_type" = 'application/pdf') OR
      ("artifact_profile" IN ('stripe_balance_itemised_csv_v1', 'commbank_transaction_history_csv_v1', 'nab_transaction_history_csv_v1') AND "media_type" = 'text/csv')
    );

DROP INDEX IF EXISTS "__FOLIO_SCHEMA__"."transactions_manual_artifact_uidx";
DROP INDEX IF EXISTS "__FOLIO_SCHEMA__"."transactions_source_artifact_id_idx";
DROP TRIGGER IF EXISTS "transactions_artifact_trigger"
  ON "__FOLIO_SCHEMA__"."transactions";
DROP TRIGGER IF EXISTS "source_artifacts_preserve_claimable_trigger"
  ON "__FOLIO_SCHEMA__"."source_artifacts";

CREATE TABLE "__FOLIO_SCHEMA__"."transaction_artifacts" (
  "transaction_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."transactions"("id") ON DELETE CASCADE,
  "source_artifact_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."source_artifacts"("id") ON DELETE RESTRICT,
  "metadata" jsonb,
  CONSTRAINT "transaction_artifacts_pkey" PRIMARY KEY ("transaction_id", "source_artifact_id"),
  CONSTRAINT "transaction_artifacts_metadata_check" CHECK ("metadata" IS NULL OR jsonb_typeof("metadata") = 'object')
);
CREATE INDEX "transaction_artifacts_source_artifact_id_idx"
  ON "__FOLIO_SCHEMA__"."transaction_artifacts" ("source_artifact_id");

INSERT INTO "__FOLIO_SCHEMA__"."transaction_artifacts" (
  "transaction_id",
  "source_artifact_id"
)
SELECT "id", "source_artifact_id"
FROM "__FOLIO_SCHEMA__"."transactions"
WHERE "source_artifact_id" IS NOT NULL;

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  DROP CONSTRAINT "transactions_source_values_check",
  DROP COLUMN "source_artifact_id";

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  ADD CONSTRAINT "transactions_source_values_check"
  CHECK (
    ("source_system" = 'manual' AND "source_currency" IS NULL AND "source_gross" IS NULL AND "source_fee" IS NULL AND "source_net" IS NULL) OR
    ("source_system" = 'stripe' AND "occurred_at" IS NOT NULL AND "source_currency" IS NOT NULL AND "source_gross" IS NOT NULL AND "source_fee" IS NOT NULL AND "source_net" IS NOT NULL AND round("source_gross" - "source_fee", 2) = round("source_net", 2))
  );

DROP FUNCTION IF EXISTS "__FOLIO_SCHEMA__"."enforce_transaction_artifact"();

CREATE OR REPLACE FUNCTION "__FOLIO_SCHEMA__"."enforce_transaction_artifact_link"() RETURNS trigger LANGUAGE plpgsql AS $folio$
DECLARE
  transaction_source text;
  transaction_gst_status text;
  artifact_profile text;
  artifact_state text;
BEGIN
  SELECT "source_system", "gst_credit_status"
  INTO transaction_source, transaction_gst_status
  FROM "__FOLIO_SCHEMA__"."transactions"
  WHERE "id" = NEW."transaction_id";

  SELECT artifact."artifact_profile", artifact."state"
  INTO artifact_profile, artifact_state
  FROM "__FOLIO_SCHEMA__"."source_artifacts" artifact
  WHERE artifact."id" = NEW."source_artifact_id";

  IF artifact_state <> 'available' THEN
    RAISE EXCEPTION 'Transaction artifacts must reference an available artifact';
  END IF;
  IF transaction_source = 'manual' AND artifact_profile <> 'manual_invoice_pdf_v1' THEN
    RAISE EXCEPTION 'Manual transactions require invoice evidence profiles';
  END IF;
  IF transaction_source = 'stripe' AND artifact_profile <> 'stripe_balance_itemised_csv_v1' THEN
    RAISE EXCEPTION 'Stripe transactions require Stripe balance CSV profiles';
  END IF;
  IF transaction_gst_status = 'claimable' AND artifact_profile <> 'manual_invoice_pdf_v1' THEN
    RAISE EXCEPTION 'Claimable GST requires an invoice evidence profile';
  END IF;
  RETURN NEW;
END
$folio$;
CREATE TRIGGER "transaction_artifacts_profile_trigger"
  BEFORE INSERT OR UPDATE ON "__FOLIO_SCHEMA__"."transaction_artifacts"
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."enforce_transaction_artifact_link"();

CREATE OR REPLACE FUNCTION "__FOLIO_SCHEMA__"."enforce_transaction_evidence_links"() RETURNS trigger LANGUAGE plpgsql AS $folio$
DECLARE
  has_source_artifact boolean;
  has_invoice_evidence boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM "__FOLIO_SCHEMA__"."transaction_artifacts" link
    JOIN "__FOLIO_SCHEMA__"."source_artifacts" artifact
      ON artifact."id" = link."source_artifact_id"
    WHERE link."transaction_id" = NEW."id"
      AND artifact."state" = 'available'
      AND artifact."artifact_profile" = 'stripe_balance_itemised_csv_v1'
  ) INTO has_source_artifact;
  IF NEW."source_system" = 'stripe' AND NOT has_source_artifact THEN
    RAISE EXCEPTION 'Stripe transactions require an available Stripe balance CSV artifact';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM "__FOLIO_SCHEMA__"."transaction_artifacts" link
    JOIN "__FOLIO_SCHEMA__"."source_artifacts" artifact
      ON artifact."id" = link."source_artifact_id"
    WHERE link."transaction_id" = NEW."id"
      AND artifact."state" = 'available'
      AND artifact."artifact_profile" = 'manual_invoice_pdf_v1'
  ) INTO has_invoice_evidence;
  IF NEW."gst_credit_status" = 'claimable' AND NOT has_invoice_evidence THEN
    RAISE EXCEPTION 'claimable GST requires an available invoice evidence artifact';
  END IF;
  RETURN NEW;
END
$folio$;
CREATE CONSTRAINT TRIGGER "transactions_evidence_links_trigger"
  AFTER INSERT OR UPDATE ON "__FOLIO_SCHEMA__"."transactions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."enforce_transaction_evidence_links"();

CREATE OR REPLACE FUNCTION "__FOLIO_SCHEMA__"."preserve_claimable_evidence"() RETURNS trigger LANGUAGE plpgsql AS $folio$
BEGIN
  IF OLD."state" = 'available' AND NEW."state" <> 'available' AND EXISTS (
    SELECT 1
    FROM "__FOLIO_SCHEMA__"."transaction_artifacts" link
    JOIN "__FOLIO_SCHEMA__"."transactions" candidate
      ON candidate."id" = link."transaction_id"
    WHERE link."source_artifact_id" = OLD."id"
      AND candidate."gst_credit_status" = 'claimable'
  ) THEN
    RAISE EXCEPTION 'cannot make claimable transaction evidence unavailable';
  END IF;
  RETURN NEW;
END
$folio$;
CREATE TRIGGER "source_artifacts_preserve_claimable_trigger"
  BEFORE UPDATE OF "state" ON "__FOLIO_SCHEMA__"."source_artifacts"
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."preserve_claimable_evidence"();

CREATE OR REPLACE FUNCTION "__FOLIO_SCHEMA__"."prevent_artifact_profile_change"() RETURNS trigger LANGUAGE plpgsql AS $folio$
BEGIN
  IF OLD."artifact_profile" IS DISTINCT FROM NEW."artifact_profile" THEN
    RAISE EXCEPTION 'Artifact profile is immutable after insert';
  END IF;
  RETURN NEW;
END
$folio$;
CREATE TRIGGER "source_artifacts_profile_immutable_trigger"
  BEFORE UPDATE OF "artifact_profile" ON "__FOLIO_SCHEMA__"."source_artifacts"
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."prevent_artifact_profile_change"();

CREATE OR REPLACE FUNCTION "__FOLIO_SCHEMA__"."protect_claimable_evidence_link"() RETURNS trigger LANGUAGE plpgsql AS $folio$
DECLARE
  transaction_gst_status text;
  replacement_is_eligible boolean := false;
  remaining_eligible boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    OLD."transaction_id" IS DISTINCT FROM NEW."transaction_id"
    OR OLD."source_artifact_id" IS DISTINCT FROM NEW."source_artifact_id"
  ) THEN
    RAISE EXCEPTION 'Transaction artifact relationship identity is immutable';
  END IF;

  SELECT candidate."gst_credit_status"
  INTO transaction_gst_status
  FROM "__FOLIO_SCHEMA__"."transactions" candidate
  WHERE candidate."id" = OLD."transaction_id"
  FOR UPDATE;

  IF transaction_gst_status IS DISTINCT FROM 'claimable' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT artifact."state" = 'available'
      AND artifact."artifact_profile" = 'manual_invoice_pdf_v1'
    INTO replacement_is_eligible
    FROM "__FOLIO_SCHEMA__"."source_artifacts" artifact
    WHERE artifact."id" = NEW."source_artifact_id";
    IF replacement_is_eligible THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM "__FOLIO_SCHEMA__"."transaction_artifacts" link
    JOIN "__FOLIO_SCHEMA__"."source_artifacts" artifact
      ON artifact."id" = link."source_artifact_id"
    WHERE link."transaction_id" = OLD."transaction_id"
      AND link."source_artifact_id" <> OLD."source_artifact_id"
      AND artifact."state" = 'available'
      AND artifact."artifact_profile" = 'manual_invoice_pdf_v1'
  ) INTO remaining_eligible;
  IF NOT remaining_eligible THEN
    RAISE EXCEPTION 'Cannot remove the sole eligible artifact from a claimable GST transaction';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$folio$;
CREATE TRIGGER "transaction_artifacts_protect_claimable_trigger"
  BEFORE DELETE OR UPDATE OF "transaction_id", "source_artifact_id" ON "__FOLIO_SCHEMA__"."transaction_artifacts"
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."protect_claimable_evidence_link"();
