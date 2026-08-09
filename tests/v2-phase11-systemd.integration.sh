#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
test_root="$(mktemp -d /tmp/vinci-phase11-systemd-test.XXXXXX)"
trap 'rm -rf -- "$test_root"' EXIT
rendered="$test_root/rendered-test"
logs="$test_root/logs-test"
mkdir -p "$rendered" "$logs"
run_user="$(id -un)"
run_group="$(id -gn)"

for source in "$repository_root"/systemd/vinci-cms-*; do
  [ -f "$source" ] || continue
  sed \
    -e "s|@VINCI_USER@|$run_user|g" \
    -e "s|@VINCI_GROUP@|$run_group|g" \
    -e "s|@VINCI_ROOT@|$repository_root|g" \
    -e "s|@VINCI_LOG_ROOT@|$logs|g" \
    "$source" > "$rendered/$(basename -- "$source")"
done
sed \
  -e "s|@VINCI_USER@|$run_user|g" \
  -e "s|@VINCI_GROUP@|$run_group|g" \
  -e "s|@VINCI_LOG_ROOT@|$logs|g" \
  "$repository_root/systemd/vinci-cms.logrotate" > "$rendered/vinci-cms.logrotate"

systemd-analyze verify "$rendered"/*.service "$rendered"/*.timer
if command -v logrotate >/dev/null 2>&1; then
  logrotate --debug --state "$test_root/logrotate-state-test" \
    "$rendered/vinci-cms.logrotate" >/dev/null
  printf 'phase11-logrotate-owner-test\n' > "$logs/health.log"
  chmod 0600 "$logs/health.log"
  logrotate --force --state "$test_root/logrotate-state-force-test" \
    "$rendered/vinci-cms.logrotate"
  test -f "$logs/health.log.1"
  grep -Fqx 'phase11-logrotate-owner-test' "$logs/health.log.1"
  test ! -s "$logs/health.log"
fi
if grep -R -nF '@VINCI_' "$rendered"; then
  printf 'systemd test retained unresolved template placeholders\n' >&2
  exit 1
fi

printf 'phase 11 real systemd/logrotate validation passed for current test identity\n'
