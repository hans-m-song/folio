\set ON_ERROR_STOP on
\set ECHO none
\set VERBOSITY terse
\set SHOW_CONTEXT never
\getenv folio_setup_schema FOLIO_DATABASE_SCHEMA
\getenv folio_setup_app_role FOLIO_DATABASE_APP_ROLE
\getenv folio_setup_migration_role FOLIO_DATABASE_MIGRATION_ROLE
\getenv folio_setup_app_password FOLIO_DATABASE_APP_PASSWORD
\getenv folio_setup_migration_password FOLIO_DATABASE_MIGRATION_PASSWORD
\getenv folio_setup_transfer_ownership FOLIO_DATABASE_TRANSFER_OWNERSHIP

BEGIN;

SET LOCAL search_path = pg_catalog;

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('folio-migrations:' || :'folio_setup_schema')
);

CREATE TEMPORARY TABLE folio_admin_setup_config (
  schema_name text NOT NULL,
  app_role_name text NOT NULL,
  migration_role_name text NOT NULL,
  app_password text NOT NULL,
  migration_password text NOT NULL,
  transfer_ownership text NOT NULL
) ON COMMIT DROP;

INSERT INTO pg_temp.folio_admin_setup_config VALUES (
  :'folio_setup_schema',
  :'folio_setup_app_role',
  :'folio_setup_migration_role',
  :'folio_setup_app_password',
  :'folio_setup_migration_password',
  :'folio_setup_transfer_ownership'
);

DO $folio_admin_setup$
DECLARE
  setup_config record;
  app_role_oid oid;
  migration_role_oid oid;
  schema_owner_oid oid;
  schema_exists boolean;
  object_record record;
  statement_verb text;
BEGIN
  SELECT *
  INTO STRICT setup_config
  FROM pg_temp.folio_admin_setup_config;

  IF setup_config.schema_name !~ '^[a-z][a-z0-9_]{0,62}$'
    OR setup_config.schema_name ~* '^pg_'
    OR setup_config.schema_name IN ('public', 'pg_catalog', 'information_schema') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'FOLIO_DATABASE_SCHEMA must be a non-system PostgreSQL identifier of at most 63 ASCII bytes';
  END IF;

  IF setup_config.app_role_name !~ '^[a-z][a-z0-9_]{0,62}$'
    OR setup_config.app_role_name ~* '^pg_' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'FOLIO_DATABASE_APP_ROLE must be a PostgreSQL identifier of at most 63 ASCII bytes';
  END IF;

  IF setup_config.migration_role_name !~ '^[a-z][a-z0-9_]{0,62}$'
    OR setup_config.migration_role_name ~* '^pg_' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'FOLIO_DATABASE_MIGRATION_ROLE must be a PostgreSQL identifier of at most 63 ASCII bytes';
  END IF;

  IF setup_config.app_role_name = setup_config.migration_role_name THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'FOLIO_DATABASE_APP_ROLE and FOLIO_DATABASE_MIGRATION_ROLE must be distinct';
  END IF;

  IF setup_config.app_password = '' OR setup_config.migration_password = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'FOLIO_DATABASE_APP_PASSWORD and FOLIO_DATABASE_MIGRATION_PASSWORD are required';
  END IF;

  IF setup_config.transfer_ownership NOT IN ('true', 'false') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'FOLIO_DATABASE_TRANSFER_OWNERSHIP must be exactly true or false';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS role_record
    WHERE role_record.rolname = setup_config.app_role_name
      AND (
        role_record.rolsuper
        OR role_record.rolcreatedb
        OR role_record.rolcreaterole
        OR role_record.rolreplication
        OR role_record.rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'existing application role has privileged attributes; refusing setup';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS role_record
    WHERE role_record.rolname = setup_config.migration_role_name
      AND (
        role_record.rolsuper
        OR role_record.rolcreatedb
        OR role_record.rolcreaterole
        OR role_record.rolreplication
        OR role_record.rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'existing migration role has privileged attributes; refusing setup';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS role_record
    WHERE role_record.rolname = setup_config.app_role_name
  ) THEN
    EXECUTE pg_catalog.format(
      'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L',
      setup_config.app_role_name,
      setup_config.app_password
    );
  ELSE
    EXECUTE pg_catalog.format(
      'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L',
      setup_config.app_role_name,
      setup_config.app_password
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS role_record
    WHERE role_record.rolname = setup_config.migration_role_name
  ) THEN
    EXECUTE pg_catalog.format(
      'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L',
      setup_config.migration_role_name,
      setup_config.migration_password
    );
  ELSE
    EXECUTE pg_catalog.format(
      'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L',
      setup_config.migration_role_name,
      setup_config.migration_password
    );
  END IF;

  app_role_oid := pg_catalog.to_regrole(
    pg_catalog.quote_ident(setup_config.app_role_name)
  )::oid;
  migration_role_oid := pg_catalog.to_regrole(
    pg_catalog.quote_ident(setup_config.migration_role_name)
  )::oid;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership_record
    WHERE membership_record.roleid IN (app_role_oid, migration_role_oid)
      OR membership_record.member IN (app_role_oid, migration_role_oid)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'application or migration role has role memberships; refusing setup';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_database AS database_record
    WHERE database_record.datname = pg_catalog.current_database()
      AND database_record.datdba = app_role_oid
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'application role owns the current database; refusing setup';
  END IF;

  EXECUTE pg_catalog.format(
    'REVOKE CREATE ON DATABASE %I FROM %I',
    pg_catalog.current_database(),
    setup_config.app_role_name
  );

  SELECT namespace_record.nspowner
  INTO schema_owner_oid
  FROM pg_catalog.pg_namespace AS namespace_record
  WHERE namespace_record.nspname = setup_config.schema_name;
  schema_exists := FOUND;

  IF schema_exists AND setup_config.transfer_ownership = 'false' THEN
    IF schema_owner_oid <> migration_role_oid THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'existing schema has a different owner; set FOLIO_DATABASE_TRANSFER_OWNERSHIP=true to transfer ownership';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation_record
      JOIN pg_catalog.pg_namespace AS namespace_record
        ON namespace_record.oid = relation_record.relnamespace
      WHERE namespace_record.nspname = setup_config.schema_name
        AND relation_record.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        AND relation_record.relowner <> migration_role_oid
    ) OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine_record
      JOIN pg_catalog.pg_namespace AS namespace_record
        ON namespace_record.oid = routine_record.pronamespace
      WHERE namespace_record.nspname = setup_config.schema_name
        AND routine_record.prokind IN ('f', 'p', 'a', 'w')
        AND routine_record.proowner <> migration_role_oid
    ) OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_type AS type_record
      JOIN pg_catalog.pg_namespace AS namespace_record
        ON namespace_record.oid = type_record.typnamespace
      WHERE namespace_record.nspname = setup_config.schema_name
        AND type_record.typtype IN ('e', 'd')
        AND type_record.typisdefined
        AND type_record.typowner <> migration_role_oid
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'existing schema objects have different owners; set FOLIO_DATABASE_TRANSFER_OWNERSHIP=true to transfer ownership';
    END IF;
  END IF;

  IF NOT schema_exists THEN
    EXECUTE pg_catalog.format(
      'CREATE SCHEMA %I AUTHORIZATION %I',
      setup_config.schema_name,
      setup_config.migration_role_name
    );
  ELSIF schema_owner_oid <> migration_role_oid THEN
    EXECUTE pg_catalog.format(
      'ALTER SCHEMA %I OWNER TO %I',
      setup_config.schema_name,
      setup_config.migration_role_name
    );
  END IF;

  FOR object_record IN
    SELECT
      type_record.typname,
      type_record.typowner
    FROM pg_catalog.pg_type AS type_record
    JOIN pg_catalog.pg_namespace AS namespace_record
      ON namespace_record.oid = type_record.typnamespace
    WHERE namespace_record.nspname = setup_config.schema_name
      AND type_record.typtype IN ('e', 'd')
      AND type_record.typisdefined
    ORDER BY type_record.typname
  LOOP
    IF object_record.typowner <> migration_role_oid THEN
      EXECUTE pg_catalog.format(
        'ALTER TYPE %I.%I OWNER TO %I',
        setup_config.schema_name,
        object_record.typname,
        setup_config.migration_role_name
      );
    END IF;
  END LOOP;

  FOR object_record IN
    SELECT
      routine_record.proname,
      routine_record.prokind,
      routine_record.proowner,
      pg_catalog.pg_get_function_identity_arguments(routine_record.oid) AS identity_arguments
    FROM pg_catalog.pg_proc AS routine_record
    JOIN pg_catalog.pg_namespace AS namespace_record
      ON namespace_record.oid = routine_record.pronamespace
    WHERE namespace_record.nspname = setup_config.schema_name
      AND routine_record.prokind IN ('f', 'p', 'a', 'w')
    ORDER BY routine_record.proname, identity_arguments
  LOOP
    IF object_record.proowner <> migration_role_oid THEN
      statement_verb := CASE object_record.prokind
        WHEN 'a' THEN 'ALTER AGGREGATE'
        WHEN 'p' THEN 'ALTER PROCEDURE'
        ELSE 'ALTER FUNCTION'
      END;

      EXECUTE pg_catalog.format(
        '%s %I.%I(%s) OWNER TO %I',
        statement_verb,
        setup_config.schema_name,
        object_record.proname,
        object_record.identity_arguments,
        setup_config.migration_role_name
      );
    END IF;
  END LOOP;

  FOR object_record IN
    SELECT
      relation_record.relname,
      relation_record.relkind,
      relation_record.relowner
    FROM pg_catalog.pg_class AS relation_record
    JOIN pg_catalog.pg_namespace AS namespace_record
      ON namespace_record.oid = relation_record.relnamespace
    WHERE namespace_record.nspname = setup_config.schema_name
      AND relation_record.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
    ORDER BY
      CASE relation_record.relkind
        WHEN 'r' THEN 1
        WHEN 'p' THEN 1
        WHEN 'f' THEN 1
        WHEN 'S' THEN 2
        WHEN 'v' THEN 3
        WHEN 'm' THEN 4
        ELSE 5
      END,
      relation_record.relname
  LOOP
    IF object_record.relowner <> migration_role_oid THEN
      statement_verb := CASE object_record.relkind
        WHEN 'S' THEN 'ALTER SEQUENCE'
        WHEN 'v' THEN 'ALTER VIEW'
        WHEN 'm' THEN 'ALTER MATERIALIZED VIEW'
        WHEN 'f' THEN 'ALTER FOREIGN TABLE'
        ELSE 'ALTER TABLE'
      END;

      EXECUTE pg_catalog.format(
        '%s %I.%I OWNER TO %I',
        statement_verb,
        setup_config.schema_name,
        object_record.relname,
        setup_config.migration_role_name
      );
    END IF;
  END LOOP;

  EXECUTE pg_catalog.format(
    'REVOKE CREATE ON SCHEMA %I FROM PUBLIC',
    setup_config.schema_name
  );
  EXECUTE pg_catalog.format(
    'REVOKE CREATE ON SCHEMA %I FROM %I',
    setup_config.schema_name,
    setup_config.app_role_name
  );
  EXECUTE pg_catalog.format(
    'GRANT USAGE ON SCHEMA %I TO %I',
    setup_config.schema_name,
    setup_config.app_role_name
  );

  EXECUTE pg_catalog.format(
    'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC',
    setup_config.schema_name
  );
  EXECUTE pg_catalog.format(
    'GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I',
    setup_config.schema_name,
    setup_config.app_role_name
  );
  EXECUTE pg_catalog.format(
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I',
    setup_config.schema_name,
    setup_config.app_role_name
  );
  EXECUTE pg_catalog.format(
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO %I',
    setup_config.schema_name,
    setup_config.app_role_name
  );

  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
    setup_config.migration_role_name
  );
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
    setup_config.migration_role_name,
    setup_config.schema_name
  );
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TABLES FROM %I',
    setup_config.migration_role_name,
    setup_config.app_role_name
  );
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM %I',
    setup_config.migration_role_name,
    setup_config.schema_name,
    setup_config.app_role_name
  );
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SEQUENCES FROM %I',
    setup_config.migration_role_name,
    setup_config.app_role_name
  );
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I',
    setup_config.migration_role_name,
    setup_config.schema_name,
    setup_config.app_role_name
  );
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM %I',
    setup_config.migration_role_name,
    setup_config.app_role_name
  );
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM %I',
    setup_config.migration_role_name,
    setup_config.schema_name,
    setup_config.app_role_name
  );
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO %I',
    setup_config.migration_role_name,
    setup_config.schema_name,
    setup_config.app_role_name
  );
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I',
    setup_config.migration_role_name,
    setup_config.schema_name,
    setup_config.app_role_name
  );
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO %I',
    setup_config.migration_role_name,
    setup_config.schema_name,
    setup_config.app_role_name
  );
END
$folio_admin_setup$;

COMMIT;
