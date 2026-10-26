LOCK TABLE "__FOLIO_SCHEMA__"."source_artifacts" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "__FOLIO_SCHEMA__"."source_artifacts"
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'Reset the Folio database schema and unversioned storage bucket before applying 0019_folio_unversioned_artifacts.sql; source_artifacts must be empty';
  END IF;
END
$$;

ALTER TABLE "__FOLIO_SCHEMA__"."source_artifacts"
  DROP CONSTRAINT "source_artifacts_confirmation_check",
  DROP COLUMN "version_id",
  ADD COLUMN "upload_expires_at" timestamptz,
  ADD CONSTRAINT "source_artifacts_confirmation_check" CHECK (
    ("state" IN ('pending', 'abandoned') AND "confirmed_at" IS NULL)
    OR ("state" IN ('awaiting_review', 'available', 'rejected', 'superseded') AND "confirmed_at" IS NOT NULL)
    OR "state" = 'deleting'
  );
