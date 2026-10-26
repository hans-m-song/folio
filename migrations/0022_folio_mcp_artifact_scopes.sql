ALTER TABLE "__FOLIO_SCHEMA__"."mcp_credentials"
  DROP CONSTRAINT "mcp_credentials_scopes_check";

ALTER TABLE "__FOLIO_SCHEMA__"."mcp_credentials"
  ADD CONSTRAINT "mcp_credentials_scopes_check" CHECK (
    cardinality("scopes") BETWEEN 1 AND 10
    AND "scopes" <@ ARRAY[
      'bank_rows:read',
      'transactions:search',
      'transactions:draft',
      'transactions:categorize',
      'bank_matches:suggest',
      'artifacts:read',
      'artifacts:upload',
      'submissions:read',
      'artifacts:edit',
      'artifacts:extract'
    ]::text[]
  );
