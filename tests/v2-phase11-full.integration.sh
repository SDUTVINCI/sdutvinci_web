#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
compose_fixture="$repository_root/tests/fixtures/v2-phase11-postgres.compose.yaml"
snapshot_commit="08a1c4908c8890dad5284e9682304e1ac0c7550e"
test_root="$(mktemp -d /tmp/vinci-phase11-full-suite-test.XXXXXX)"
suffix="$$"
export PHASE11_TEST_PROJECT="vinci-phase11-full-suite-test-${suffix}"
export PHASE11_TEST_POSTGRES_PORT="$((47000 + suffix % 1000))"
export TEST_DATABASE_URL="postgresql://vinci_phase11_test:phase11-test-only-password@127.0.0.1:${PHASE11_TEST_POSTGRES_PORT}/vinci_phase11_doctor_test"
export V2_CONTENT_SNAPSHOT_SOURCE="$test_root/content"
export CMS_AUTH_SECRET=phase11-full-suite-test-secret-at-least-32-characters
unset DATABASE_URL

cleanup() {
  docker compose -f "$compose_fixture" down --volumes --remove-orphans >/dev/null 2>&1 || true
  [ -f "$test_root/.vinci-phase11-full-test-owner" ] && rm -rf -- "$test_root"
}
trap cleanup EXIT
printf 'vinci-phase11-full-suite-test\n' > "$test_root/.vinci-phase11-full-test-owner"

git -C "$repository_root" cat-file -e "${snapshot_commit}^{commit}" 2>/dev/null
git -C "$repository_root" archive "$snapshot_commit" content/news content/wiki content/members \
  | tar --extract --file=- --directory "$test_root"

docker compose -f "$compose_fixture" config --quiet
docker compose -f "$compose_fixture" up --detach --wait postgres-test
cd -- "$repository_root"
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
npm test
npm run test:cms
npm run test:v2:phase10

printf 'V2 phase 11 fresh migration and complete isolated test suite passed\n'
