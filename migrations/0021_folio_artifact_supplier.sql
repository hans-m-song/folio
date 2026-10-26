ALTER TABLE "__FOLIO_SCHEMA__"."source_artifacts"
  ADD COLUMN "supplier" text,
  ADD CONSTRAINT "source_artifacts_supplier_length_check" CHECK (
    "supplier" IS NULL OR char_length("supplier") <= 200
  );
