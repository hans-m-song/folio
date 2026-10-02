ALTER TABLE "__FOLIO_SCHEMA__"."mcp_credentials"
  DROP CONSTRAINT "mcp_credentials_scopes_check";

UPDATE "__FOLIO_SCHEMA__"."mcp_credentials"
SET "scopes" = (
  SELECT array_agg(deduplicated."scope" ORDER BY deduplicated."first_position")
  FROM (
    SELECT expanded."scope", min(expanded."position") AS "first_position"
    FROM unnest(
      array_remove("scopes", 'proposals:submit') ||
      CASE
        WHEN 'proposals:submit' = ANY("scopes")
        THEN ARRAY['transactions:draft', 'bank_matches:suggest']::text[]
        ELSE ARRAY[]::text[]
      END
    ) WITH ORDINALITY AS expanded("scope", "position")
    GROUP BY expanded."scope"
  ) deduplicated
)
WHERE 'proposals:submit' = ANY("scopes");

ALTER TABLE "__FOLIO_SCHEMA__"."mcp_credentials"
  ADD CONSTRAINT "mcp_credentials_scopes_check" CHECK (
    cardinality("scopes") BETWEEN 1 AND 8
    AND "scopes" <@ ARRAY[
      'bank_rows:read',
      'transactions:search',
      'transactions:draft',
      'transactions:categorize',
      'bank_matches:suggest',
      'artifacts:read',
      'artifacts:upload',
      'submissions:read'
    ]::text[]
  );
