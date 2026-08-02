#!/usr/bin/env bash

set -Eeuo pipefail
repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
test_root="$(mktemp -d /tmp/vinci-phase11-operations-test.XXXXXX)"
trap 'rm -rf -- "$test_root"' EXIT
printf 'vinci-phase11-operations-test\n' > "$test_root/.vinci-phase11-test-owner"

doctor_fake_bin="$test_root/doctor-empty-compose-test-bin"
mkdir -p "$doctor_fake_bin"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [ "$*" = "compose ps --quiet --status running postgres" ]; then' \
  '  [ -z "${PHASE11_FAKE_POSTGRES_ID:-}" ] || printf "%s\\n" "$PHASE11_FAKE_POSTGRES_ID"' \
  '  exit 0' \
  'fi' \
  'exit 64' > "$doctor_fake_bin/docker"
chmod 0755 "$doctor_fake_bin/docker"
if (
  PATH="$doctor_fake_bin:/usr/bin:/bin"
  # shellcheck source=scripts/ops-common.sh
  source "$repository_root/scripts/ops-common.sh"
  ops_compose_service_is_running postgres
); then
  printf 'operations doctor accepted empty compose ps output as a running service\n' >&2
  exit 1
fi
(
  PATH="$doctor_fake_bin:/usr/bin:/bin"
  PHASE11_FAKE_POSTGRES_ID=phase11-postgres-container-test
  export PHASE11_FAKE_POSTGRES_ID
  # shellcheck source=scripts/ops-common.sh
  source "$repository_root/scripts/ops-common.sh"
  ops_compose_service_is_running postgres
) || { printf 'operations doctor rejected a non-empty running service id\n' >&2; exit 1; }

fallback_bin="$test_root/phase11-standard-sbin-test/logrotate"
mkdir -p "$(dirname -- "$fallback_bin")"
printf '#!/usr/bin/env bash\nexit 0\n' > "$fallback_bin"
chmod 0755 "$fallback_bin"
resolved_fallback="$(
  PATH=/usr/bin:/bin
  # shellcheck source=scripts/ops-common.sh
  source "$repository_root/scripts/ops-common.sh"
  ops_resolve_command phase11-logrotate-not-in-path "$fallback_bin"
)"
[ "$resolved_fallback" = "$fallback_bin" ] \
  || { printf 'operations command resolver ignored an absolute executable fallback\n' >&2; exit 1; }

help_output="$($repository_root/vinci --help)"
for command in install update status doctor backup backup-prune restore \
  export-instance import-instance migrate-legacy-user reconcile maintenance; do
  printf '%s\n' "$help_output" | grep -F "$command" >/dev/null
  "$repository_root/vinci" "$command" --help > "$test_root/help-${command}.log"
  grep -Fq 'Vinci V2.0 统一运维入口' "$test_root/help-${command}.log" \
    || grep -Fq '用法：./vinci' "$test_root/help-${command}.log"
done
if "$repository_root/vinci" unknown-phase11-test-command \
  > "$test_root/unknown.log" 2>&1; then
  printf 'unknown vinci subcommand unexpectedly succeeded\n' >&2
  exit 1
fi

if grep -R -nE 'User=vinci-deploy|Group=vinci-deploy|/home/vinci-deploy|/opt/vinci-cms|sudo -u vinci-deploy|sudo -iu vinci-deploy' \
  "$repository_root/vinci" "$repository_root/scripts" "$repository_root/systemd"; then
  printf 'effective operations code retained a legacy deployment identity\n' >&2
  exit 1
fi
if grep -R -nE 'force[ -]?push|push --force|git push -f' \
  "$repository_root/vinci" "$repository_root/scripts" "$repository_root/systemd"; then
  printf 'operations code contains a Force Push path\n' >&2
  exit 1
fi
grep -Fq 'User=@VINCI_USER@' "$repository_root/systemd/vinci-cms-auto-deploy.service"
grep -Fq 'ExecStart=@VINCI_ROOT@/vinci backup --scheduled' \
  "$repository_root/systemd/vinci-cms-backup.service"
grep -Fq 'ExecStart=@VINCI_ROOT@/vinci doctor --scheduled' \
  "$repository_root/systemd/vinci-cms-health.service"
grep -Fq 'rotate 30' "$repository_root/systemd/vinci-cms.logrotate"
grep -Fq 'maxsize 100M' "$repository_root/systemd/vinci-cms.logrotate"
grep -Fq 'fetch-depth: 0' "$repository_root/.github/workflows/deploy.yml"
grep -Fq 'vinci-phase11-cms-snapshot-test/content' \
  "$repository_root/.github/workflows/deploy.yml"
grep -Fq "git cat-file -e '08a1c4908c8890dad5284e9682304e1ac0c7550e^{commit}'" \
  "$repository_root/.github/workflows/deploy.yml"
grep -Fq 'V2_CONTENT_SNAPSHOT_SOURCE:' "$repository_root/.github/workflows/deploy.yml"
grep -Fq -- '-eq 260' "$repository_root/.github/workflows/deploy.yml"
grep -Fq 'if: always()' "$repository_root/.github/workflows/deploy.yml"
grep -Fq 'find "$snapshot_root" -xdev -depth -mindepth 1 -delete' \
  "$repository_root/.github/workflows/deploy.yml"

instance_root="$test_root/phase11-instance-packages-test"
project=vinci-phase11-prune-test
mkdir -m 0700 "$instance_root"
printf 'vinci-instance-root-v1\n%s\n' "$project" > "$instance_root/.vinci-instance-root"
create_instance() {
  local stamp="$1"
  local path="$instance_root/${project}-instance-${stamp}"
  mkdir -m 0700 "$path"
  printf 'vinci-instance-v1\n%s\n' "$project" > "$path/.vinci-instance-owner"
  printf 'test\n' > "$path/manifest-test.txt"
}
create_instance 20240101T000000Z
create_instance 20240102T000000Z
create_instance 20260801T000000Z
printf 'locked-test\n' > "$instance_root/${project}-instance-20240101T000000Z/.vinci-locked"
touch -d 2024-01-01T00:00:00Z "$instance_root/${project}-instance-20240101T000000Z"
touch -d 2024-01-02T00:00:00Z "$instance_root/${project}-instance-20240102T000000Z"
INSTANCE_PRUNE_NOW=2026-08-02T00:00:00Z INSTANCE_RETENTION_DAYS=30 \
  node "$repository_root/scripts/instance-prune.mjs" "$instance_root" "$project" --dry-run \
  > "$test_root/instance-prune-dry-run.json"
grep -Fq '20240102T000000Z' "$test_root/instance-prune-dry-run.json"
test -d "$instance_root/${project}-instance-20240102T000000Z"
INSTANCE_PRUNE_NOW=2026-08-02T00:00:00Z INSTANCE_RETENTION_DAYS=30 \
  node "$repository_root/scripts/instance-prune.mjs" "$instance_root" "$project" --apply \
  > "$test_root/instance-prune-apply.json"
test ! -e "$instance_root/${project}-instance-20240102T000000Z"
test -d "$instance_root/${project}-instance-20240101T000000Z"
test -d "$instance_root/${project}-instance-20260801T000000Z"
if node "$repository_root/scripts/instance-prune.mjs" / "$project" --dry-run \
  > "$test_root/broad-path.log" 2>&1; then
  printf 'instance prune accepted root directory\n' >&2
  exit 1
fi
grep -Fq INSTANCE_PRUNE_ROOT_TOO_BROAD "$test_root/broad-path.log"

ln -s /tmp "$instance_root/${project}-instance-20200101T000000Z"
if node "$repository_root/scripts/instance-prune.mjs" "$instance_root" "$project" --dry-run \
  > "$test_root/symlink.log" 2>&1; then
  printf 'instance prune accepted a symlink package\n' >&2
  exit 1
fi
grep -Fq INSTANCE_PRUNE_UNOWNED "$test_root/symlink.log"
rm "$instance_root/${project}-instance-20200101T000000Z"

for token in 'RESTORE:' 'IMPORT:' 'MIGRATE:' 'INITIALIZE:' 'RECOVERABLE:'; do
  grep -R -F "$token" "$repository_root/vinci" "$repository_root/scripts" >/dev/null
done
grep -F '目标数据库不是空库' "$repository_root/scripts/restore.sh" >/dev/null
grep -F 'CONTENT_RECOVERY_DATABASE_NOT_EMPTY' \
  "$repository_root/server/services/content-recovery.ts" >/dev/null

current_home="$(getent passwd "$EUID" | awk -F: 'NR == 1 { print $6 }')"
if (
  # shellcheck source=scripts/ops-common.sh
  source "$repository_root/scripts/ops-common.sh"
  ops_require_external_absolute_path phase11-test-home "$current_home"
) > "$test_root/home-root.log" 2>&1; then
  printf 'operations path validation accepted the account Home root\n' >&2
  exit 1
fi
grep -Fq '不得直接使用当前账号 Home 根' "$test_root/home-root.log"

printf 'phase 11 operations test passed: CLI help, no effective legacy identity/force push, dynamic units, logrotate, instance retention and destructive confirmations\n'
