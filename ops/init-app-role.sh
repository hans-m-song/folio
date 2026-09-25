#!/bin/sh
set -eu

: "${FOLIO_DATABASE_APP_PASSWORD:?FOLIO_DATABASE_APP_PASSWORD is required}"

psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=app_password="$FOLIO_DATABASE_APP_PASSWORD" --file=/opt/folio/init-app-role.sql
