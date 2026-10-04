#!/bin/sh
set -eu

folio_usage() {
  printf '%s\n' 'Usage: setup-database.sh [--username PostgreSQL-admin-role]' >&2
  exit 2
}

folio_admin_username=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --username)
      [ "$#" -ge 2 ] || folio_usage
      folio_admin_username=$2
      shift 2
      ;;
    --username=*)
      folio_admin_username=${1#--username=}
      shift
      ;;
    *)
      folio_usage
      ;;
  esac
done

if [ -z "${FOLIO_DATABASE_APP_PASSWORD:-}" ]; then
  printf '%s\n' 'FOLIO_DATABASE_APP_PASSWORD is required.' >&2
  exit 1
fi

if [ -z "${FOLIO_DATABASE_MIGRATION_PASSWORD:-}" ]; then
  printf '%s\n' 'FOLIO_DATABASE_MIGRATION_PASSWORD is required.' >&2
  exit 1
fi

if [ "${FOLIO_DATABASE_SCHEMA+x}" != x ]; then
  FOLIO_DATABASE_SCHEMA=folio
fi

if [ "${FOLIO_DATABASE_APP_ROLE+x}" != x ]; then
  FOLIO_DATABASE_APP_ROLE=folio_app
fi

if [ "${FOLIO_DATABASE_MIGRATION_ROLE+x}" != x ]; then
  FOLIO_DATABASE_MIGRATION_ROLE=folio_migrate
fi

if [ "${FOLIO_DATABASE_TRANSFER_OWNERSHIP+x}" != x ]; then
  FOLIO_DATABASE_TRANSFER_OWNERSHIP=false
fi

export FOLIO_DATABASE_SCHEMA
export FOLIO_DATABASE_APP_ROLE
export FOLIO_DATABASE_MIGRATION_ROLE
export FOLIO_DATABASE_APP_PASSWORD
export FOLIO_DATABASE_MIGRATION_PASSWORD
export FOLIO_DATABASE_TRANSFER_OWNERSHIP

case "$0" in
  */*) folio_script_directory=${0%/*} ;;
  *) folio_script_directory=. ;;
esac

if [ -z "$folio_script_directory" ]; then
  folio_script_directory=/
fi

folio_script_directory=$(CDPATH= cd "$folio_script_directory" && pwd)

if [ -f "$folio_script_directory/setup-database.sql" ]; then
  folio_sql_file=$folio_script_directory/setup-database.sql
elif [ -f /opt/folio/setup-database.sql ]; then
  folio_sql_file=/opt/folio/setup-database.sql
else
  printf '%s\n' 'Could not locate setup-database.sql beside the wrapper or at /opt/folio/setup-database.sql.' >&2
  exit 1
fi

if [ -z "$folio_admin_username" ]; then
  folio_admin_username=${PGUSER:-${POSTGRES_USER:-}}
fi

folio_database_name=${PGDATABASE:-${POSTGRES_DB:-}}

set -- --no-psqlrc --set=ON_ERROR_STOP=1

if [ -n "$folio_admin_username" ]; then
  set -- "$@" --username "$folio_admin_username"
fi

if [ -n "$folio_database_name" ]; then
  set -- "$@" --dbname "$folio_database_name"
fi

exec psql "$@" --file "$folio_sql_file"
