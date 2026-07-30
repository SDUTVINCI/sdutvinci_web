#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
test_root="$(mktemp -d /tmp/vinci-v2-phase7-operations-test.XXXXXX)"
backup_root="${test_root}/backups"
maintenance_root="${test_root}/maintenance"
project="vinci-v2-phase7-test"
owner_mismatch_root="${test_root}/wrong-owner"

cleanup() {
  [ -d "$test_root" ] || return 0
  [ -f "${test_root}/.vinci-phase7-test-owner" ] || return 0
  if [ -d "$owner_mismatch_root" ]; then
    docker run --rm \
      --label vinci.test.owner=v2-phase7 \
      --label vinci.test.scope=automatic \
      --volume "${owner_mismatch_root}:/fixture" \
      postgres:16-alpine \
      chown -R "${EUID}:$(id -g)" /fixture >/dev/null 2>&1 || true
  fi
  rm -rf -- "$test_root"
}
trap cleanup EXIT

printf 'vinci-v2-phase7-operations-test\n' > "${test_root}/.vinci-phase7-test-owner"
mkdir -m 0700 -p \
  "${backup_root}/.vinci-state" \
  "${maintenance_root}/snapshots" \
  "${maintenance_root}/reports" \
  "${maintenance_root}/tmp"
printf 'vinci-backup-state-v2\n%s\n' "$project" \
  > "${backup_root}/.vinci-state/owner"
printf 'vinci-content-reconciliation-root-v1\n' \
  > "${maintenance_root}/.vinci-phase7-owner"

create_backup() {
  local timestamp="$1"
  local directory="${backup_root}/${project}-${timestamp}"
  mkdir -m 0700 "$directory"
  printf 'vinci-backup-v2\n%s\n' "$project" > "${directory}/.vinci-backup-owner"
  printf 'test\n' > "${directory}/postgresql.dump"
}

create_backup 20240101T000000Z
create_backup 20240102T000000Z
create_backup 20260701T000000Z
create_backup 20260720T000000Z
create_backup 20260729T000000Z
create_backup 20260730T000000Z
printf 'locked\n' > "${backup_root}/${project}-20240101T000000Z/.vinci-locked"
printf 'verified\n' > "${backup_root}/${project}-20260720T000000Z/.vinci-verified"
printf '{"status":"succeeded","path":"%s-20260730T000000Z"}\n' "$project" \
  > "${backup_root}/.vinci-state/latest-success.json"

if node "${repository_root}/scripts/backup-prune.mjs" \
  / "$project" --dry-run > "${test_root}/backup-broad-path.log" 2>&1; then
  printf '备份清理错误地接受了根目录\n' >&2
  exit 1
fi
grep -q 'BACKUP_PRUNE_ROOT_TOO_BROAD' "${test_root}/backup-broad-path.log"

BACKUP_PRUNE_NOW=2026-07-30T12:00:00Z \
  node "${repository_root}/scripts/backup-prune.mjs" \
  "$backup_root" "$project" --dry-run > "${test_root}/backup-dry-run.json"
grep -q "\"dryRun\": true" "${test_root}/backup-dry-run.json"
grep -q "${project}-20260730T000000Z" "${test_root}/backup-dry-run.json"
grep -q "${project}-20260720T000000Z" "${test_root}/backup-dry-run.json"
grep -q "${project}-20240101T000000Z" "${test_root}/backup-dry-run.json"
test -d "${backup_root}/${project}-20240102T000000Z"

BACKUP_PRUNE_NOW=2026-07-30T12:00:00Z \
  node "${repository_root}/scripts/backup-prune.mjs" \
  "$backup_root" "$project" > "${test_root}/backup-prune.json"
test ! -e "${backup_root}/${project}-20240102T000000Z"
test -d "${backup_root}/${project}-20260701T000000Z"
test -d "${backup_root}/${project}-20260730T000000Z"
test -d "${backup_root}/${project}-20260720T000000Z"
test -d "${backup_root}/${project}-20240101T000000Z"

# A failed new backup has no latest-success state update, so pruning refuses to
# use it as a deletion gate and all existing protected backups remain.
cp "${backup_root}/.vinci-state/latest-success.json" \
  "${test_root}/latest-success.saved"
printf '{"status":"failed","path":"new-failed"}\n' \
  > "${backup_root}/.vinci-state/latest-success.json"
if node "${repository_root}/scripts/backup-prune.mjs" \
  "$backup_root" "$project" --dry-run > "${test_root}/failed-gate.log" 2>&1; then
  printf '失败备份错误地允许清理\n' >&2
  exit 1
fi
grep -q 'BACKUP_PRUNE_NO_SUCCESSFUL_BACKUP' "${test_root}/failed-gate.log"
test -d "${backup_root}/${project}-20260730T000000Z"
mv "${test_root}/latest-success.saved" \
  "${backup_root}/.vinci-state/latest-success.json"

ln -s /tmp "${backup_root}/unsafe-link"
if node "${repository_root}/scripts/backup-prune.mjs" \
  "$backup_root" "$project" --dry-run > "${test_root}/backup-symlink.log" 2>&1; then
  printf '备份清理错误地接受了符号链接\n' >&2
  exit 1
fi
grep -q 'BACKUP_PRUNE_UNEXPECTED_ENTRY' "${test_root}/backup-symlink.log"
rm "${backup_root}/unsafe-link"

mkdir -m 0700 "$owner_mismatch_root"
docker run --rm \
  --label vinci.test.owner=v2-phase7 \
  --label vinci.test.scope=automatic \
  --volume "${owner_mismatch_root}:/fixture" \
  postgres:16-alpine chown 65534:65534 /fixture
if node "${repository_root}/scripts/backup-prune.mjs" \
  "$owner_mismatch_root" "$project" --dry-run \
  > "${test_root}/backup-owner.log" 2>&1; then
  printf '备份清理错误地接受了错误属主\n' >&2
  exit 1
fi
grep -q 'BACKUP_PRUNE_ROOT_OWNER_MISMATCH' "${test_root}/backup-owner.log"
docker run --rm \
  --label vinci.test.owner=v2-phase7 \
  --label vinci.test.scope=automatic \
  --volume "${owner_mismatch_root}:/fixture" \
  postgres:16-alpine chown -R "${EUID}:$(id -g)" /fixture
rmdir "$owner_mismatch_root"

run_id="123e4567-e89b-42d3-a456-426614174000"
mkdir -m 0700 "${maintenance_root}/snapshots/${run_id}"
printf '%s\n' "$run_id" \
  > "${maintenance_root}/snapshots/${run_id}/.vinci-owner"
printf '{}\n' > "${maintenance_root}/reports/${run_id}.json"
mkdir -m 0700 "${maintenance_root}/tmp/${run_id}.snapshot"
printf '%s\n' "$run_id" \
  > "${maintenance_root}/tmp/${run_id}.snapshot/.vinci-owner"
touch -d '2020-01-01T00:00:00Z' \
  "${maintenance_root}/snapshots/${run_id}" \
  "${maintenance_root}/reports/${run_id}.json" \
  "${maintenance_root}/tmp/${run_id}.snapshot"

if node "${repository_root}/scripts/v2-maintenance-cleanup.mjs" \
  / --dry-run > "${test_root}/maintenance-broad-path.log" 2>&1; then
  printf '维护清理错误地接受了根目录\n' >&2
  exit 1
fi
grep -q 'MAINTENANCE_CLEANUP_ROOT_TOO_BROAD' \
  "${test_root}/maintenance-broad-path.log"

MAINTENANCE_CLEANUP_NOW=2026-07-30T12:00:00Z \
  node "${repository_root}/scripts/v2-maintenance-cleanup.mjs" \
  "$maintenance_root" --dry-run > "${test_root}/maintenance-dry-run.json"
grep -q "\"dryRun\": true" "${test_root}/maintenance-dry-run.json"
test -d "${maintenance_root}/snapshots/${run_id}"

MAINTENANCE_CLEANUP_NOW=2026-07-30T12:00:00Z \
  node "${repository_root}/scripts/v2-maintenance-cleanup.mjs" \
  "$maintenance_root" > "${test_root}/maintenance-cleanup.json"
test ! -e "${maintenance_root}/snapshots/${run_id}"
test ! -e "${maintenance_root}/reports/${run_id}.json"
test ! -e "${maintenance_root}/tmp/${run_id}.snapshot"

ln -s /tmp "${maintenance_root}/reports/123e4567-e89b-42d3-a456-426614174001.json"
if node "${repository_root}/scripts/v2-maintenance-cleanup.mjs" \
  "$maintenance_root" --dry-run > "${test_root}/maintenance-symlink.log" 2>&1; then
  printf '维护清理错误地接受了符号链接\n' >&2
  exit 1
fi
grep -q 'MAINTENANCE_CLEANUP_SYMLINK' "${test_root}/maintenance-symlink.log"
rm "${maintenance_root}/reports/123e4567-e89b-42d3-a456-426614174001.json"

nested_id="123e4567-e89b-42d3-a456-426614174002"
mkdir -m 0700 "${maintenance_root}/snapshots/${nested_id}"
printf '%s\n' "$nested_id" \
  > "${maintenance_root}/snapshots/${nested_id}/.vinci-owner"
ln -s /tmp "${maintenance_root}/snapshots/${nested_id}/unsafe"
if node "${repository_root}/scripts/v2-maintenance-cleanup.mjs" \
  "$maintenance_root" --dry-run > "${test_root}/maintenance-nested-symlink.log" 2>&1; then
  printf '维护清理错误地接受了目录内符号链接\n' >&2
  exit 1
fi
grep -q 'MAINTENANCE_CLEANUP_SYMLINK' \
  "${test_root}/maintenance-nested-symlink.log"
rm "${maintenance_root}/snapshots/${nested_id}/unsafe"
rm -r "${maintenance_root}/snapshots/${nested_id}"

grep -Fqx 'OnCalendar=*-*-* 03:00:00 Asia/Shanghai' \
  "${repository_root}/systemd/vinci-cms-content-reconcile.timer"
grep -Fqx 'OnCalendar=*-*-* 02:00:00 Asia/Shanghai' \
  "${repository_root}/systemd/vinci-cms-backup.timer"
grep -Fqx 'ExecStart=/opt/vinci-cms/scripts/v2-maintenance-cleanup.sh' \
  "${repository_root}/systemd/vinci-cms-maintenance-cleanup.service"
grep -q 'CONTENT_RECOVERY_MODE: disabled' "${repository_root}/compose.yaml"
grep -q 'BACKUP_RETRY_ATTEMPTS' "${repository_root}/scripts/backup.sh"
grep -q 'ops_config_value BACKUP_RETENTION_DAILY_DAYS' \
  "${repository_root}/scripts/backup-prune.sh"
grep -q 'ops_config_value CONTENT_SNAPSHOT_RETENTION_DAYS' \
  "${repository_root}/scripts/v2-maintenance-cleanup.sh"
grep -q 'BACKUP_DISK_CRITICAL' "${repository_root}/scripts/backup.sh"
grep -q 'latest-success.json' "${repository_root}/scripts/backup.sh"
grep -q 'alerts.jsonl' "${repository_root}/scripts/backup.sh"

printf '%s\n' \
  'phase 7 operations test passed: Shanghai schedules, tiered dry-run/prune,' \
  'failed-backup gate, latest/verified/locked protection, snapshot/report/tmp cleanup,' \
  'broad-path and symlink refusal, retry/disk/state/alert/config contracts'
