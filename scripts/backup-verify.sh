#!/usr/bin/env bash

set -Eeuo pipefail
# shellcheck source=scripts/ops-common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/ops-common.sh"

ops_require_command sha256sum
ops_require_command docker
ops_require_command realpath

backup_requested="${1:-}"
[ -n "$backup_requested" ] || ops_die "用法：./scripts/backup-verify.sh /绝对路径/备份目录"
backup_directory="$(ops_require_external_absolute_path 备份目录 "$backup_requested")"
[ -d "$backup_directory" ] && [ ! -L "$backup_directory" ] \
  || ops_die "备份目录不安全"
ops_assert_owned_directory "备份目录" "$backup_directory"

(
  cd -- "$backup_directory"
  sha256sum --check --strict SHA256SUMS
)
docker compose exec -T postgres pg_restore --list \
  < "${backup_directory}/postgresql.dump" >/dev/null
printf 'vinci-backup-integrity-verified-v1\n%s\n' "$(date -u +%FT%TZ)" \
  > "${backup_directory}/.vinci-integrity-verified"
chmod 0600 "${backup_directory}/.vinci-integrity-verified"
ops_info "备份完整性验证通过；这不等同于隔离可恢复性演练：${backup_directory}"
