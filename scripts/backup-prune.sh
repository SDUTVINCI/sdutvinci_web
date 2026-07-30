#!/usr/bin/env bash

set -Eeuo pipefail
# shellcheck source=scripts/ops-common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/ops-common.sh"

[ "$EUID" -ne 0 ] || ops_die "不要使用 sudo 直接运行备份清理"
ops_require_command docker
ops_require_command node
ops_require_command realpath
ops_acquire_lock

backup_root_requested="${BACKUP_ROOT:-$(ops_compose_env BACKUP_ROOT)}"
backup_root="$(ops_require_external_absolute_path BACKUP_ROOT "$backup_root_requested")"
ops_assert_owned_directory BACKUP_ROOT "$backup_root"
project="$(ops_project_name)"

export BACKUP_RETENTION_DAILY_DAYS="$(
  ops_config_value BACKUP_RETENTION_DAILY_DAYS 7
)"
export BACKUP_RETENTION_WEEKLY_WEEKS="$(
  ops_config_value BACKUP_RETENTION_WEEKLY_WEEKS 4
)"
export BACKUP_RETENTION_MONTHLY_MONTHS="$(
  ops_config_value BACKUP_RETENTION_MONTHLY_MONTHS 12
)"

node "$OPS_REPOSITORY_ROOT/scripts/backup-prune.mjs" \
  "$backup_root" "$project" "$@"
