#!/usr/bin/env bash

set -Eeuo pipefail
# shellcheck source=scripts/ops-common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/ops-common.sh"

[ "$EUID" -ne 0 ] || ops_die "不要使用 sudo 直接运行维护清理"
ops_require_command docker
ops_require_command node
ops_require_command realpath
ops_acquire_lock

reconciliation_root_requested="$(
  ops_config_value CONTENT_RECONCILIATION_ROOT \
    /var/lib/vinci-cms/content-reconciliation
)"
reconciliation_root="$(
  ops_require_external_absolute_path \
    CONTENT_RECONCILIATION_ROOT \
    "$reconciliation_root_requested"
)"
ops_assert_owned_directory CONTENT_RECONCILIATION_ROOT "$reconciliation_root"

export CONTENT_SNAPSHOT_RETENTION_DAYS="$(
  ops_config_value CONTENT_SNAPSHOT_RETENTION_DAYS 30
)"
export RECONCILIATION_REPORT_RETENTION_DAYS="$(
  ops_config_value RECONCILIATION_REPORT_RETENTION_DAYS 90
)"
export RECONCILIATION_TEMP_RETENTION_DAYS="$(
  ops_config_value RECONCILIATION_TEMP_RETENTION_DAYS 1
)"

node "$OPS_REPOSITORY_ROOT/scripts/v2-maintenance-cleanup.mjs" \
  "$reconciliation_root" "$@"
