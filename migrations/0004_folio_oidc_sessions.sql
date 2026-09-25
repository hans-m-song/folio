CREATE TABLE "__FOLIO_SCHEMA__"."auth_attempts" (
  "state_hash" varchar(64) PRIMARY KEY CHECK ("state_hash" ~ '^[a-f0-9]{64}$'),
  "nonce" text NOT NULL,
  "code_verifier" text NOT NULL,
  "return_path" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "auth_attempts_expires_at_idx" ON "__FOLIO_SCHEMA__"."auth_attempts" ("expires_at");

CREATE TABLE "__FOLIO_SCHEMA__"."auth_sessions" (
  "token_hash" varchar(64) PRIMARY KEY CHECK ("token_hash" ~ '^[a-f0-9]{64}$'),
  "user_id" uuid NOT NULL REFERENCES "__FOLIO_SCHEMA__"."users"("id"),
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "auth_sessions_user_id_idx" ON "__FOLIO_SCHEMA__"."auth_sessions" ("user_id");
CREATE INDEX "auth_sessions_expires_at_idx" ON "__FOLIO_SCHEMA__"."auth_sessions" ("expires_at");
