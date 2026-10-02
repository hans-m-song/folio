CREATE TABLE "__FOLIO_SCHEMA__"."tax_review_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "financial_year_start_year" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "source_fingerprint" text NOT NULL,
  "reviewer_user_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."users" ("id") ON DELETE RESTRICT,
  "reviewed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tax_review_snapshots_financial_year_check"
    CHECK ("financial_year_start_year" BETWEEN 1 AND 9999),
  CONSTRAINT "tax_review_snapshots_snapshot_check"
    CHECK (
      jsonb_typeof("snapshot") = 'object'
      AND "snapshot" ?& ARRAY[
        'cashLedger',
        'humanAdjustments',
        'partnerShares',
        'totals',
        'reviewerAttestation'
      ]::text[]
      AND jsonb_typeof("snapshot"->'reviewerAttestation') = 'string'
      AND btrim("snapshot"->>'reviewerAttestation') <> ''
    ),
  CONSTRAINT "tax_review_snapshots_fingerprint_check"
    CHECK (btrim("source_fingerprint") <> '')
);

CREATE INDEX "tax_review_snapshots_fy_reviewed_idx"
  ON "__FOLIO_SCHEMA__"."tax_review_snapshots" ("financial_year_start_year", "reviewed_at", "id");

CREATE INDEX "tax_review_snapshots_reviewer_user_id_idx"
  ON "__FOLIO_SCHEMA__"."tax_review_snapshots" ("reviewer_user_id");

CREATE FUNCTION "__FOLIO_SCHEMA__"."reject_tax_review_snapshot_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Reviewed tax snapshots are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "tax_review_snapshots_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "__FOLIO_SCHEMA__"."tax_review_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."reject_tax_review_snapshot_mutation"();
