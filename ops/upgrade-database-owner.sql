\set ON_ERROR_STOP on
\set ECHO none
\set VERBOSITY terse
\set SHOW_CONTEXT never
\getenv folio_upgrade_password FOLIO_DATABASE_ADMIN_PASSWORD

BEGIN;
SET LOCAL search_path = pg_catalog;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('folio-migrations:folio'));

CREATE TEMP TABLE folio_upgrade_input (
  password_present boolean NOT NULL CHECK (password_present)
) ON COMMIT DROP;
INSERT INTO pg_temp.folio_upgrade_input VALUES (length(:'folio_upgrade_password') > 0);

DO $folio_upgrade_guard$
DECLARE
  app_role_oid oid := pg_catalog.to_regrole('folio_app')::oid;
  migration_role_oid oid := pg_catalog.to_regrole('folio_migrate')::oid;
BEGIN
  IF app_role_oid IS NULL THEN RAISE EXCEPTION 'folio_app must exist before upgrade'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'folio') THEN
    RAISE EXCEPTION 'folio schema must exist before upgrade';
  END IF;
  IF pg_catalog.to_regrole('folio_admin') IS NOT NULL THEN
    RAISE EXCEPTION 'folio_admin already exists; refusing one-time upgrade';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname IN ('folio_app', 'folio_migrate')
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN RAISE EXCEPTION 'folio_app or folio_migrate has privileged attributes'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid IN (app_role_oid, migration_role_oid)
       OR member IN (app_role_oid, migration_role_oid)
  ) THEN RAISE EXCEPTION 'folio_app or folio_migrate has role memberships'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_database
    WHERE datname = pg_catalog.current_database() AND datdba = app_role_oid
  ) THEN RAISE EXCEPTION 'folio_app owns the current database'; END IF;
END
$folio_upgrade_guard$;

ALTER ROLE folio_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'folio_migrate')
  THEN 'true' ELSE 'false' END AS folio_has_migrate \gset
\if :folio_has_migrate
ALTER ROLE folio_migrate RENAME TO folio_admin;
ALTER ROLE folio_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD :'folio_upgrade_password';
\else
CREATE ROLE folio_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD :'folio_upgrade_password';
\endif
ALTER SCHEMA folio OWNER TO folio_admin;

SELECT pg_catalog.format('REVOKE CREATE ON DATABASE %I FROM folio_app', pg_catalog.current_database()) \gexec
SELECT pg_catalog.format('ALTER TABLE %I.%I OWNER TO folio_admin', n.nspname, c.relname)
FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'folio' AND c.relkind IN ('r', 'p')
  AND c.relowner <> pg_catalog.to_regrole('folio_admin')::oid \gexec
SELECT pg_catalog.format('ALTER SEQUENCE %I.%I OWNER TO folio_admin', n.nspname, c.relname)
FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'folio' AND c.relkind = 'S'
  AND c.relowner <> pg_catalog.to_regrole('folio_admin')::oid \gexec
SELECT pg_catalog.format('ALTER FUNCTION %I.%I(%s) OWNER TO folio_admin', n.nspname, p.proname,
  pg_catalog.pg_get_function_identity_arguments(p.oid))
FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'folio' AND p.prokind = 'f'
  AND p.proowner <> pg_catalog.to_regrole('folio_admin')::oid \gexec

REVOKE CREATE ON SCHEMA folio FROM PUBLIC;
REVOKE CREATE ON SCHEMA folio FROM folio_app;
GRANT USAGE ON SCHEMA folio TO folio_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA folio FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE folio_admin REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE folio_admin IN SCHEMA folio REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE folio_admin REVOKE ALL ON TABLES FROM folio_app;
ALTER DEFAULT PRIVILEGES FOR ROLE folio_admin IN SCHEMA folio REVOKE ALL ON TABLES FROM folio_app;
ALTER DEFAULT PRIVILEGES FOR ROLE folio_admin REVOKE ALL ON SEQUENCES FROM folio_app;
ALTER DEFAULT PRIVILEGES FOR ROLE folio_admin IN SCHEMA folio REVOKE ALL ON SEQUENCES FROM folio_app;
ALTER DEFAULT PRIVILEGES FOR ROLE folio_admin REVOKE EXECUTE ON FUNCTIONS FROM folio_app;
ALTER DEFAULT PRIVILEGES FOR ROLE folio_admin IN SCHEMA folio REVOKE EXECUTE ON FUNCTIONS FROM folio_app;
ALTER DEFAULT PRIVILEGES FOR ROLE folio_admin IN SCHEMA folio GRANT SELECT ON TABLES TO folio_app;
ALTER DEFAULT PRIVILEGES FOR ROLE folio_admin IN SCHEMA folio GRANT USAGE, SELECT ON SEQUENCES TO folio_app;
ALTER DEFAULT PRIVILEGES FOR ROLE folio_admin IN SCHEMA folio GRANT EXECUTE ON FUNCTIONS TO folio_app;

COMMIT;
