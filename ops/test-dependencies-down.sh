#!/bin/sh
set -eu

docker compose \
  --file docker-compose.test.yml \
  --project-name folio-test-dependencies \
  down \
  --volumes \
  --remove-orphans
