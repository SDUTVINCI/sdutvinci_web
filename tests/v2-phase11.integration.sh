#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
compose_fixture="$repository_root/tests/fixtures/v2-phase11-postgres.compose.yaml"
for required_command in awk docker find getent git grep node sed systemd-analyze tar; do
  command -v "$required_command" >/dev/null 2>&1 \
    || { printf 'phase 11 test prerequisite missing: %s\n' "$required_command" >&2; exit 1; }
done
if grep -R -nE --include='*.sh' '(^|[^[:alnum:]_])r[g]([^[:alnum:]_]|$)' \
  "$repository_root/tests"; then
  printf 'phase 11 shell tests must not depend on optional ripgrep\n' >&2
  exit 1
fi
suffix="$$"
export PHASE11_TEST_PROJECT="vinci-phase11-doctor-test-${suffix}"
export PHASE11_TEST_POSTGRES_PORT="$((46000 + suffix % 1000))"
export TEST_DATABASE_URL="postgresql://vinci_phase11_test:phase11-test-only-password@127.0.0.1:${PHASE11_TEST_POSTGRES_PORT}/vinci_phase11_doctor_test"
unset DATABASE_URL

cleanup() {
  docker compose -f "$compose_fixture" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose --env-file "$repository_root/.env.example" --profile '*' \
  -f "$repository_root/compose.yaml" config --format json \
  | node "$repository_root/tests/v2-phase11-compose-network.test.mjs"
docker compose -f "$compose_fixture" config --quiet
docker compose -f "$compose_fixture" up --detach --wait postgres-test

cd -- "$repository_root"
./node_modules/.bin/vitest run \
  tests/v2-phase11-operations-doctor.integration.test.ts \
  tests/cms-security.test.ts \
  tests/v2-phase10-content-removal.test.ts
./tests/v2-phase11-markdown-security.integration.sh
./tests/v2-phase11-operations.integration.sh
./tests/v2-phase11-systemd.integration.sh
./tests/install-auto-deploy.integration.sh
./tests/auto-deploy.integration.sh
./tests/deploy-cache-cleanup.integration.sh
./tests/v2-phase7-operations.integration.sh

printf 'V2 phase 11 isolated operations and security suite passed\n'
