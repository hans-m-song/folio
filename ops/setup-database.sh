#!/bin/sh
set -eu

[ "$#" -eq 0 ] || { printf '%s\n' 'setup-database.sh accepts no arguments.' >&2; exit 2; }
: "${FOLIO_DATABASE_APP_PASSWORD:?FOLIO_DATABASE_APP_PASSWORD is required}"
: "${FOLIO_DATABASE_MIGRATION_PASSWORD:?FOLIO_DATABASE_MIGRATION_PASSWORD is required}"

case "$0" in
  */*) folio_setup_directory=${0%/*} ;;
  *) folio_setup_directory=. ;;
esac
[ -n "$folio_setup_directory" ] || folio_setup_directory=/
folio_setup_sql=$folio_setup_directory/setup-database.sql
[ -f "$folio_setup_sql" ] || folio_setup_sql=/opt/folio/setup-database.sql
[ -f "$folio_setup_sql" ] || { printf '%s\n' 'Could not locate setup-database.sql.' >&2; exit 1; }

set -- --no-psqlrc --set=ON_ERROR_STOP=1
folio_setup_user=${PGUSER:-${POSTGRES_USER:-}}
folio_setup_database=${PGDATABASE:-${POSTGRES_DB:-}}
[ -z "$folio_setup_user" ] || set -- "$@" --username "$folio_setup_user"
[ -z "$folio_setup_database" ] || set -- "$@" --dbname "$folio_setup_database"

exec psql "$@" --file "$folio_setup_sql"
