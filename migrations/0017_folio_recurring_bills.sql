CREATE TABLE "__FOLIO_SCHEMA__"."recurring_bill_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "label" text NOT NULL,
  "counterparty" text NOT NULL,
  "description_match_text" text,
  "document_currency" varchar(3) NOT NULL,
  "expected_amount" numeric(19,4),
  "frequency" text NOT NULL,
  "anchor_date" date NOT NULL,
  "responsible_user_id" uuid REFERENCES "__FOLIO_SCHEMA__"."users"("id") ON DELETE RESTRICT,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."users"("id") ON DELETE RESTRICT,
  "updated_by_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "recurring_bill_schedules_label_check"
    CHECK (btrim("label") <> '' AND char_length("label") <= 200),
  CONSTRAINT "recurring_bill_schedules_counterparty_check"
    CHECK (btrim("counterparty") <> '' AND char_length("counterparty") <= 300),
  CONSTRAINT "recurring_bill_schedules_description_check"
    CHECK ("description_match_text" IS NULL OR (btrim("description_match_text") <> '' AND char_length("description_match_text") <= 2000)),
  CONSTRAINT "recurring_bill_schedules_currency_check"
    CHECK ("document_currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "recurring_bill_schedules_amount_check"
    CHECK ("expected_amount" IS NULL OR "expected_amount" >= 0),
  CONSTRAINT "recurring_bill_schedules_frequency_check"
    CHECK ("frequency" IN ('monthly', 'annual')),
  CONSTRAINT "recurring_bill_schedules_updated_at_check"
    CHECK ("updated_at" >= "created_at")
);

CREATE INDEX "recurring_bill_schedules_active_anchor_idx"
  ON "__FOLIO_SCHEMA__"."recurring_bill_schedules" ("active", "anchor_date");

CREATE INDEX "recurring_bill_schedules_responsible_user_id_idx"
  ON "__FOLIO_SCHEMA__"."recurring_bill_schedules" ("responsible_user_id");

CREATE TABLE "__FOLIO_SCHEMA__"."recurring_bill_links" (
  "schedule_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."recurring_bill_schedules"("id") ON DELETE RESTRICT,
  "expected_date" date NOT NULL,
  "transaction_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."transactions"("id") ON DELETE RESTRICT,
  "created_by_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "recurring_bill_links_pkey"
    PRIMARY KEY ("schedule_id", "expected_date")
);

CREATE UNIQUE INDEX "recurring_bill_links_transaction_uidx"
  ON "__FOLIO_SCHEMA__"."recurring_bill_links" ("transaction_id");

CREATE INDEX "recurring_bill_links_created_by_id_idx"
  ON "__FOLIO_SCHEMA__"."recurring_bill_links" ("created_by_id");
