#!/usr/bin/env bash

set -Eeuo pipefail
# shellcheck source=scripts/ops-common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/ops-common.sh"

ops_require_command node
ops_require_command realpath
ops_acquire_lock
instance_root_requested="$(ops_config_value INSTANCE_EXPORT_ROOT /var/backups/vinci-cms-instances)"
instance_root="$(ops_require_external_absolute_path INSTANCE_EXPORT_ROOT "$instance_root_requested")"
if [ ! -d "$instance_root" ]; then
  ops_info "迁移包根不存在，无需清理：${instance_root}"
  exit 0
fi
ops_assert_owned_directory INSTANCE_EXPORT_ROOT "$instance_root"
export INSTANCE_RETENTION_DAYS="$(ops_config_value INSTANCE_RETENTION_DAYS 30)"
node "$OPS_REPOSITORY_ROOT/scripts/instance-prune.mjs" \
  "$instance_root" "$(ops_project_name)" "$@"
