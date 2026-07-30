#!/usr/bin/env bash

set -Eeuo pipefail
# shellcheck source=scripts/ops-common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/ops-common.sh"

ops_require_command realpath
ops_require_command sha256sum

backup_requested="${1:-}"
[ -n "$backup_requested" ] \
  || ops_die "用法：RECOVERY_VERIFICATION_CONFIRM='RECOVERABLE:<目录名>' ./scripts/backup-mark-recoverable.sh /绝对路径/备份目录"
backup_directory="$(ops_require_external_absolute_path 备份目录 "$backup_requested")"
[ -d "$backup_directory" ] && [ ! -L "$backup_directory" ] \
  || ops_die "备份目录不安全"
ops_assert_owned_directory "备份目录" "$backup_directory"
[ -f "${backup_directory}/.vinci-backup-owner" ] \
  || ops_die "备份缺少归属标记"
expected="RECOVERABLE:$(basename -- "$backup_directory")"
[ "${RECOVERY_VERIFICATION_CONFIRM:-}" = "$expected" ] \
  || ops_die "只有完成隔离 pg_restore、后置 Migration、完整性和健康检查后，才可设置 RECOVERY_VERIFICATION_CONFIRM='${expected}'"
(
  cd -- "$backup_directory"
  sha256sum --check --strict SHA256SUMS
)
printf 'vinci-backup-recoverable-v1\n%s\n' "$(date -u +%FT%TZ)" \
  > "${backup_directory}/.vinci-verified"
chmod 0600 "${backup_directory}/.vinci-verified"
ops_info "已记录隔离可恢复性演练通过：${backup_directory}"
