ALTER TABLE "__FOLIO_SCHEMA__"."source_artifacts"
  ADD COLUMN "original_filename" text;

ALTER TABLE "__FOLIO_SCHEMA__"."source_artifacts"
  DROP CONSTRAINT "source_artifacts_state_check",
  DROP CONSTRAINT "source_artifacts_confirmation_check";

ALTER TABLE "__FOLIO_SCHEMA__"."source_artifacts"
  ADD CONSTRAINT "source_artifacts_state_check"
    CHECK ("state" IN ('pending', 'available', 'rejected', 'superseded', 'abandoned')),
  ADD CONSTRAINT "source_artifacts_confirmation_check"
    CHECK (
      ("state" IN ('pending', 'abandoned') AND "version_id" IS NULL AND "confirmed_at" IS NULL)
      OR
      ("state" IN ('available', 'rejected', 'superseded') AND "version_id" IS NOT NULL AND "confirmed_at" IS NOT NULL)
    ),
  ADD CONSTRAINT "source_artifacts_rejected_csv_check"
    CHECK ("state" <> 'rejected' OR "media_type" = 'text/csv');

CREATE FUNCTION "__FOLIO_SCHEMA__"."protect_rejected_artifact"() RETURNS trigger LANGUAGE plpgsql AS $folio$
BEGIN
  IF NEW."state" = 'rejected' AND OLD."state" <> 'rejected' THEN
    PERFORM 1 FROM "__FOLIO_SCHEMA__"."source_artifacts"
    WHERE "id" = NEW."id" FOR UPDATE;
  END IF;
  IF NEW."state" = 'rejected' AND OLD."state" <> 'rejected' AND (
    EXISTS (
      SELECT 1 FROM "__FOLIO_SCHEMA__"."transaction_artifacts" link
      WHERE link."source_artifact_id" = NEW."id"
    ) OR EXISTS (
      SELECT 1 FROM "__FOLIO_SCHEMA__"."bank_transaction_artifacts" link
      WHERE link."source_artifact_id" = NEW."id"
    )
  ) THEN
    RAISE EXCEPTION 'Cannot reject an artifact referenced by a transaction or bank row';
  END IF;
  RETURN NEW;
END
$folio$;

CREATE TRIGGER "source_artifacts_rejected_unlinked_trigger"
  BEFORE UPDATE OF "state" ON "__FOLIO_SCHEMA__"."source_artifacts"
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."protect_rejected_artifact"();

CREATE FUNCTION "__FOLIO_SCHEMA__"."lock_source_artifact_for_link"() RETURNS trigger LANGUAGE plpgsql AS $folio$
DECLARE
  artifact_state text;
BEGIN
  SELECT "state" INTO artifact_state
  FROM "__FOLIO_SCHEMA__"."source_artifacts"
  WHERE "id" = NEW."source_artifact_id" FOR SHARE;
  IF NOT FOUND OR artifact_state IS DISTINCT FROM 'available' THEN
    RAISE EXCEPTION 'Artifact links must reference an available artifact';
  END IF;
  RETURN NEW;
END
$folio$;

CREATE TRIGGER "transaction_artifacts_artifact_lock_trigger"
  BEFORE INSERT OR UPDATE ON "__FOLIO_SCHEMA__"."transaction_artifacts"
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."lock_source_artifact_for_link"();

CREATE TRIGGER "bank_transaction_artifacts_artifact_lock_trigger"
  BEFORE INSERT OR UPDATE ON "__FOLIO_SCHEMA__"."bank_transaction_artifacts"
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."lock_source_artifact_for_link"();
