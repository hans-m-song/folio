#!/bin/sh
set -eu

output=${1:?Provide an explicit backup output path}
: "${FOLIO_DATABASE_URL:?FOLIO_DATABASE_URL is required}"
: "${FOLIO_DATABASE_SCHEMA:?FOLIO_DATABASE_SCHEMA is required}"

case "$FOLIO_DATABASE_SCHEMA" in
  ""|[!a-z]*|*[!a-z0-9_]*) printf '%s\n' "Invalid Folio schema" >&2; exit 2 ;;
  *) ;;
esac

if test -e "$output"; then
  printf '%s\n' "Refusing to overwrite an existing backup" >&2
  exit 2
fi

pg_dump --dbname="$FOLIO_DATABASE_URL" --schema="$FOLIO_DATABASE_SCHEMA" --format=custom --no-owner --no-privileges --file="$output"
