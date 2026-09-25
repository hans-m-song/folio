CREATE OR REPLACE FUNCTION "__FOLIO_SCHEMA__"."enforce_transaction_artifact"() RETURNS trigger LANGUAGE plpgsql AS $folio$
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
