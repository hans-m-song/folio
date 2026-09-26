ALTER TABLE "__FOLIO_SCHEMA__"."source_artifacts"
  DROP CONSTRAINT "source_artifacts_state_check",
  DROP CONSTRAINT "source_artifacts_confirmation_check",
  DROP CONSTRAINT "source_artifacts_rejected_csv_check";

ALTER TABLE "__FOLIO_SCHEMA__"."source_artifacts"
  ADD CONSTRAINT "source_artifacts_state_check"
    CHECK ("state" IN ('pending', 'awaiting_review', 'available', 'rejected', 'superseded', 'abandoned', 'deleting')),
  ADD CONSTRAINT "source_artifacts_confirmation_check"
    CHECK (
      ("state" IN ('pending', 'abandoned') AND "version_id" IS NULL AND "confirmed_at" IS NULL)
      OR
      ("state" IN ('awaiting_review', 'available', 'rejected', 'superseded') AND "version_id" IS NOT NULL AND "confirmed_at" IS NOT NULL)
      OR (
        "state" = 'deleting'
        AND (("version_id" IS NULL AND "confirmed_at" IS NULL)
          OR ("version_id" IS NOT NULL AND "confirmed_at" IS NOT NULL))
      )
    );
