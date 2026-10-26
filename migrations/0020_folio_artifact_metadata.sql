ALTER TABLE "__FOLIO_SCHEMA__"."source_artifacts"
  ADD COLUMN "period_start" date,
  ADD COLUMN "period_end" date,
  ADD COLUMN "document_date" date,
  ADD COLUMN "reference" text,
  ADD COLUMN "notes" text,
  ADD CONSTRAINT "source_artifacts_period_order_check" CHECK (
    "period_start" IS NULL
    OR "period_end" IS NULL
    OR "period_start" <= "period_end"
  ),
  ADD CONSTRAINT "source_artifacts_reference_length_check" CHECK (
    "reference" IS NULL OR char_length("reference") <= 200
  ),
  ADD CONSTRAINT "source_artifacts_notes_length_check" CHECK (
    "notes" IS NULL OR char_length("notes") <= 2000
  );
