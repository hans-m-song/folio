CREATE TABLE "__FOLIO_SCHEMA__"."mcp_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "label" text NOT NULL CHECK (char_length("label") BETWEEN 1 AND 200),
  "token_hash" varchar(64) NOT NULL UNIQUE CHECK ("token_hash" ~ '^[a-f0-9]{64}$'),
  "actor_user_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."users"("id") ON DELETE RESTRICT,
  "default_owner_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."users"("id") ON DELETE RESTRICT,
  "scopes" text[] NOT NULL,
  "created_by_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."users"("id") ON DELETE RESTRICT,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mcp_credentials_actor_owner_check" CHECK ("actor_user_id" <> "default_owner_id"),
  CONSTRAINT "mcp_credentials_dedicated_actor_check" CHECK ("actor_user_id" <> "created_by_id"),
  CONSTRAINT "mcp_credentials_scopes_check" CHECK (
    cardinality("scopes") BETWEEN 1 AND 6
    AND "scopes" <@ ARRAY['bank_rows:read', 'transactions:search', 'artifacts:read', 'artifacts:upload', 'proposals:submit', 'submissions:read']::text[]
  )
);

CREATE INDEX "mcp_credentials_actor_user_id_idx"
  ON "__FOLIO_SCHEMA__"."mcp_credentials" ("actor_user_id");
CREATE INDEX "mcp_credentials_default_owner_id_idx"
  ON "__FOLIO_SCHEMA__"."mcp_credentials" ("default_owner_id");

CREATE TABLE "__FOLIO_SCHEMA__"."mcp_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "credential_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."mcp_credentials"("id") ON DELETE RESTRICT,
  "request_key" varchar(200) NOT NULL CHECK ("request_key" ~ '^[A-Za-z0-9._:-]+$'),
  "payload_sha256" varchar(64) NOT NULL CHECK ("payload_sha256" ~ '^[a-f0-9]{64}$'),
  "kind" text NOT NULL CHECK ("kind" IN ('draft_transaction', 'existing_match')),
  "draft_transaction_id" uuid REFERENCES "__FOLIO_SCHEMA__"."transactions"("id") ON DELETE RESTRICT,
  "proposed_transaction_id" uuid REFERENCES "__FOLIO_SCHEMA__"."transactions"("id") ON DELETE RESTRICT,
  "bank_transaction_id" uuid REFERENCES "__FOLIO_SCHEMA__"."bank_transactions"("id") ON DELETE RESTRICT,
  "observed_bank_revision" bigint,
  "source_artifact_id" uuid REFERENCES "__FOLIO_SCHEMA__"."source_artifacts"("id") ON DELETE RESTRICT,
  "source_row" integer,
  "proposed_evidence_artifact_id" uuid REFERENCES "__FOLIO_SCHEMA__"."source_artifacts"("id") ON DELETE RESTRICT,
  "evidence_discarded_at" timestamptz,
  "evidence_discarded_by_id" uuid REFERENCES "__FOLIO_SCHEMA__"."users"("id") ON DELETE RESTRICT,
  "note" text CHECK ("note" IS NULL OR char_length("note") <= 2000),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mcp_submissions_idempotency_uidx" UNIQUE ("credential_id", "request_key"),
  CONSTRAINT "mcp_submissions_result_check" CHECK (
    ("kind" = 'draft_transaction' AND "draft_transaction_id" IS NOT NULL AND "proposed_transaction_id" IS NULL)
    OR
    ("kind" = 'existing_match' AND "draft_transaction_id" IS NULL AND "proposed_transaction_id" IS NOT NULL)
  ),
  CONSTRAINT "mcp_submissions_direct_target_check" CHECK (
    ("bank_transaction_id" IS NULL) = ("observed_bank_revision" IS NULL)
    AND ("observed_bank_revision" IS NULL OR "observed_bank_revision" > 0)
  ),
  CONSTRAINT "mcp_submissions_locator_check" CHECK (
    ("source_artifact_id" IS NULL) = ("source_row" IS NULL)
    AND ("source_row" IS NULL OR "source_row" > 0)
    AND NOT ("bank_transaction_id" IS NOT NULL AND "source_artifact_id" IS NOT NULL)
  ),
  CONSTRAINT "mcp_submissions_match_target_check" CHECK (
    "kind" <> 'existing_match'
    OR ("bank_transaction_id" IS NOT NULL AND "source_artifact_id" IS NULL AND "proposed_evidence_artifact_id" IS NULL)
  ),
  CONSTRAINT "mcp_submissions_draft_evidence_check" CHECK (
    "proposed_evidence_artifact_id" IS NULL OR "kind" = 'draft_transaction'
  ),
  CONSTRAINT "mcp_submissions_evidence_discard_check" CHECK (
    ("evidence_discarded_at" IS NULL) = ("evidence_discarded_by_id" IS NULL)
    AND ("evidence_discarded_at" IS NULL OR "proposed_evidence_artifact_id" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "mcp_submissions_draft_transaction_uidx"
  ON "__FOLIO_SCHEMA__"."mcp_submissions" ("draft_transaction_id")
  WHERE "draft_transaction_id" IS NOT NULL;

CREATE INDEX "mcp_submissions_bank_transaction_id_idx"
  ON "__FOLIO_SCHEMA__"."mcp_submissions" ("bank_transaction_id", "created_at", "id");
CREATE INDEX "mcp_submissions_locator_idx"
  ON "__FOLIO_SCHEMA__"."mcp_submissions" ("source_artifact_id", "source_row", "created_at", "id")
  WHERE "source_artifact_id" IS NOT NULL;

CREATE OR REPLACE FUNCTION "__FOLIO_SCHEMA__"."enforce_retained_proposed_evidence"() RETURNS trigger LANGUAGE plpgsql AS $folio$
DECLARE
  affected_transaction_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'transactions' THEN
    affected_transaction_id := NEW."id";
  ELSIF TG_TABLE_NAME = 'mcp_submissions' THEN
    affected_transaction_id := coalesce(NEW."draft_transaction_id", OLD."draft_transaction_id");
  ELSIF TG_TABLE_NAME = 'transaction_artifacts' THEN
    affected_transaction_id := coalesce(NEW."transaction_id", OLD."transaction_id");
  ELSE
    IF EXISTS (
      SELECT 1
      FROM "__FOLIO_SCHEMA__"."mcp_submissions" submission
      JOIN "__FOLIO_SCHEMA__"."transactions" transaction
        ON transaction."id" = submission."draft_transaction_id"
      WHERE submission."proposed_evidence_artifact_id" = NEW."id"
        AND submission."evidence_discarded_at" IS NULL
        AND transaction."status" = 'recorded'
        AND NOT EXISTS (
          SELECT 1
          FROM "__FOLIO_SCHEMA__"."transaction_artifacts" link
          JOIN "__FOLIO_SCHEMA__"."source_artifacts" artifact
            ON artifact."id" = link."source_artifact_id"
          WHERE link."transaction_id" = transaction."id"
            AND link."source_artifact_id" = submission."proposed_evidence_artifact_id"
            AND artifact."state" = 'available'
        )
    ) THEN
      RAISE EXCEPTION 'Recorded proposal drafts require retained evidence to be available and linked';
    END IF;
    RETURN NEW;
  END IF;

  IF affected_transaction_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM "__FOLIO_SCHEMA__"."mcp_submissions" submission
    JOIN "__FOLIO_SCHEMA__"."transactions" transaction
      ON transaction."id" = submission."draft_transaction_id"
    WHERE submission."draft_transaction_id" = affected_transaction_id
      AND submission."proposed_evidence_artifact_id" IS NOT NULL
      AND submission."evidence_discarded_at" IS NULL
      AND transaction."status" = 'recorded'
      AND NOT EXISTS (
        SELECT 1
        FROM "__FOLIO_SCHEMA__"."transaction_artifacts" link
        JOIN "__FOLIO_SCHEMA__"."source_artifacts" artifact
          ON artifact."id" = link."source_artifact_id"
        WHERE link."transaction_id" = transaction."id"
          AND link."source_artifact_id" = submission."proposed_evidence_artifact_id"
          AND artifact."state" = 'available'
      )
  ) THEN
    RAISE EXCEPTION 'Recorded proposal drafts require retained evidence to be available and linked';
  END IF;
  RETURN coalesce(NEW, OLD);
END
$folio$;

CREATE CONSTRAINT TRIGGER "transactions_retained_proposed_evidence_trigger"
  AFTER INSERT OR UPDATE ON "__FOLIO_SCHEMA__"."transactions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."enforce_retained_proposed_evidence"();
CREATE CONSTRAINT TRIGGER "submissions_retained_proposed_evidence_trigger"
  AFTER INSERT OR UPDATE
  ON "__FOLIO_SCHEMA__"."mcp_submissions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."enforce_retained_proposed_evidence"();
CREATE CONSTRAINT TRIGGER "transaction_artifacts_retained_proposed_evidence_trigger"
  AFTER DELETE OR UPDATE
  ON "__FOLIO_SCHEMA__"."transaction_artifacts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."enforce_retained_proposed_evidence"();
CREATE CONSTRAINT TRIGGER "source_artifacts_retained_proposed_evidence_trigger"
  AFTER UPDATE OF "state" ON "__FOLIO_SCHEMA__"."source_artifacts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."enforce_retained_proposed_evidence"();
