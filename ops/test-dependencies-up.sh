#!/bin/sh
set -eu

compose_file="docker-compose.test.yml"
project_name="folio-test-dependencies"

docker compose \
  --file "$compose_file" \
  --project-name "$project_name" \
  up \
  --detach \
  --wait \
  postgres s3

docker compose \
  --file "$compose_file" \
  --project-name "$project_name" \
  run \
  --rm \
  s3-init
