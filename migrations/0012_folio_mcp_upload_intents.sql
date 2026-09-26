CREATE TABLE "__FOLIO_SCHEMA__"."mcp_upload_intents" (
  "credential_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."mcp_credentials"("id") ON DELETE RESTRICT,
  "request_key" varchar(200) NOT NULL CHECK ("request_key" ~ '^[A-Za-z0-9._:-]+$'),
  "payload_sha256" varchar(64) NOT NULL CHECK ("payload_sha256" ~ '^[a-f0-9]{64}$'),
  "artifact_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mcp_upload_intents_pkey" PRIMARY KEY ("credential_id", "request_key")
);

CREATE UNIQUE INDEX "mcp_upload_intents_artifact_id_uidx"
  ON "__FOLIO_SCHEMA__"."mcp_upload_intents" ("artifact_id");
