#!/bin/sh
set -eu

input=${1:?Provide an explicit backup input path}
: "${FOLIO_RESTORE_DATABASE_URL:?FOLIO_RESTORE_DATABASE_URL is required}"
: "${FOLIO_DATABASE_SCHEMA:?FOLIO_DATABASE_SCHEMA is required}"

case "$FOLIO_DATABASE_SCHEMA" in
  ""|[!a-z]*|*[!a-z0-9_]*) printf '%s\n' "Invalid Folio schema" >&2; exit 2 ;;
  *) ;;
esac

test -f "$input" || { printf '%s\n' "Backup file not found" >&2; exit 2; }
expected="restore:$FOLIO_DATABASE_SCHEMA"
if test "${FOLIO_RESTORE_CONFIRM:-}" != "$expected"; then
  printf '%s\n' "Set FOLIO_RESTORE_CONFIRM=$expected to authorize destructive restore" >&2
  exit 2
fi

pg_restore --dbname="$FOLIO_RESTORE_DATABASE_URL" --schema="$FOLIO_DATABASE_SCHEMA" --clean --if-exists --no-owner --no-privileges "$input"
