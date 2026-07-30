#!/usr/bin/env bash

set -Eeuo pipefail
# shellcheck source=scripts/ops-common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/ops-common.sh"

ops_require_command docker
ops_require_command realpath
ops_require_command curl
ops_acquire_lock

action="${1:-}"
source_requested="${2:-}"
actor_label="${3:-}"
[ "$action" = "dry-run" ] || [ "$action" = "apply" ] \
  || ops_die "用法：脚本 dry-run|apply /绝对路径/内容快照 维护者标识"
[ -n "$actor_label" ] || ops_die "必须提供维护者标识"
source_root="$(ops_require_external_absolute_path 内容快照 "$source_requested")"
[ -d "$source_root" ] && [ ! -L "$source_root" ] \
  || ops_die "内容快照目录不存在或不安全"

cd -- "$OPS_REPOSITORY_ROOT"
export CONTENT_RECOVERY_SOURCE_ROOT="$source_root"

docker compose --profile tools run --rm migrate
if [ "$action" = "dry-run" ]; then
  docker compose --profile content-recovery run --rm \
    content-recovery \
    npm run v2:content:recover -- \
    --source=/recovery-source \
    "--actor=${actor_label}" \
    --mode=disaster
  exit 0
fi

[ -n "${CONTENT_RECOVERY_CONFIRM:-}" ] \
  || ops_die "apply 必须设置上一轮 Dry Run 输出的 CONTENT_RECOVERY_CONFIRM 精确令牌"
docker compose --profile content-recovery run --rm \
  content-recovery \
  npm run v2:content:recover -- \
  --source=/recovery-source \
  "--actor=${actor_label}" \
  --mode=disaster \
  --apply \
  "--confirm=${CONTENT_RECOVERY_CONFIRM}"

# Expand-only migrations are deliberately run again after snapshot import.
docker compose --profile tools run --rm migrate
docker compose --profile content-recovery run --rm \
  content-recovery \
  npm exec -- tsx scripts/v2-content-recovery-check.ts

health_url="${RECOVERY_HEALTH_URL:-}"
[ -n "$health_url" ] \
  || ops_die "导入与完整性检查通过；必须设置隔离环境 RECOVERY_HEALTH_URL 完成健康检查"
case "$health_url" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) ops_die "阶段 7 受控恢复只接受明确的本机隔离健康检查 URL" ;;
esac
curl --fail --silent --show-error "$health_url" >/dev/null
ops_info "灾难恢复导入、后置 Migration、完整性检查和健康检查全部通过"
