#!/usr/bin/env bash

set -Eeuo pipefail
# shellcheck source=scripts/ops-common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/ops-common.sh"

ops_require_command awk
ops_require_command docker
ops_require_command sort

mode="dry-run"
lock_mode="acquire"
skip_if_locked=false

usage() {
  cat <<'EOF'
用法：
  ./scripts/cleanup-deploy-cache.sh [--dry-run|--apply] [--skip-if-locked]

默认只预览。--apply 才会删除符合保留策略的旧部署镜像，并清理可重建的
Docker 构建缓存和悬空镜像。脚本不会删除容器、volume 或数据库数据。
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      mode="dry-run"
      ;;
    --apply)
      mode="apply"
      ;;
    --skip-if-locked)
      skip_if_locked=true
      ;;
    --lock-held)
      # Internal use by deploy.sh, which already owns the repository operation lock.
      lock_mode="held"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      ops_die "未知参数：$1"
      ;;
  esac
  shift
done

cd -- "$OPS_REPOSITORY_ROOT"

lock_directory="$OPS_REPOSITORY_ROOT/.deploy/operation.lock"
if [ "$lock_mode" = "held" ]; then
  [ -d "$lock_directory" ] \
    || ops_die "--lock-held 只能由已经持有部署操作锁的脚本使用"
else
  mkdir -p -- "$OPS_REPOSITORY_ROOT/.deploy"
  if ! mkdir -- "$lock_directory" 2>/dev/null; then
    if [ "$skip_if_locked" = true ]; then
      ops_info "已有部署、备份或恢复操作正在执行；本轮缓存清理跳过。"
      exit 0
    fi
    ops_die "已有部署、备份或恢复操作正在执行：${lock_directory}"
  fi
  trap 'rmdir -- "$lock_directory" 2>/dev/null || true' EXIT
fi

retention_hours="$(ops_compose_env DEPLOY_CACHE_RETENTION_HOURS)"
retention_hours="${retention_hours:-168}"
keep_images="$(ops_compose_env DEPLOY_CACHE_KEEP_IMAGES)"
keep_images="${keep_images:-3}"

[[ "$retention_hours" =~ ^[1-9][0-9]*$ ]] \
  || ops_die "DEPLOY_CACHE_RETENTION_HOURS 必须是正整数"
[[ "$keep_images" =~ ^[1-9][0-9]*$ ]] \
  || ops_die "DEPLOY_CACHE_KEEP_IMAGES 必须是正整数"
[ "$retention_hours" -le 8760 ] \
  || ops_die "DEPLOY_CACHE_RETENTION_HOURS 不得超过 8760"
[ "$keep_images" -le 100 ] \
  || ops_die "DEPLOY_CACHE_KEEP_IMAGES 不得超过 100"

runtime_repository="$(ops_required_compose_env APP_IMAGE)"
operations_repository="$(ops_required_compose_env APP_OPS_IMAGE)"
for repository in "$runtime_repository" "$operations_repository"; do
  [[ "$repository" =~ ^[A-Za-z0-9._/:@-]+$ ]] \
    || ops_die "部署镜像仓库格式不安全：${repository}"
done

declare -A protected_commits=()
read_protected_commit() {
  local file="$1"
  local label="$2"
  local commit

  [ -e "$file" ] || [ -L "$file" ] || return 0
  [ -f "$file" ] && [ ! -L "$file" ] \
    || ops_die "${label}必须是普通文件且不得是符号链接"

  commit="$(awk -F= '$1 == "commit" { print $2; exit }' "$file")"
  [ -z "$commit" ] || [[ "$commit" =~ ^[0-9a-f]{40}$ ]] \
    || ops_die "${label}中的 commit 无效"
  [ -z "$commit" ] || protected_commits["$commit"]=1
}

read_protected_commit "$OPS_REPOSITORY_ROOT/.deploy/current" "部署状态文件"
read_protected_commit "$OPS_REPOSITORY_ROOT/.deploy/auto-deploy-failed" "自动部署失败标记"

declare -A container_image_ids=()
if ! container_listing="$(docker ps -aq)"; then
  ops_die "无法读取 Docker 容器清单；为避免误删镜像，拒绝继续"
fi
container_ids=()
if [ -n "$container_listing" ]; then
  mapfile -t container_ids <<< "$container_listing"
fi
if [ "${#container_ids[@]}" -gt 0 ]; then
  if ! container_image_listing="$(
    docker inspect --format '{{.Image}}' "${container_ids[@]}"
  )"; then
    ops_die "无法读取完整的容器镜像引用；为避免误删镜像，拒绝继续"
  fi
  while IFS= read -r image_id; do
    [ -z "$image_id" ] || container_image_ids["$image_id"]=1
  done <<< "$container_image_listing"
fi

removed_count=0
preview_count=0

cleanup_repository() {
  local repository="$1"
  local line
  local created
  local reference
  local image_id
  local image_listing
  local tag
  local retained=0
  local -a references=()
  local -a inventory=()
  local -a sorted_inventory=()

  if ! image_listing="$(
    docker image ls --no-trunc --format '{{.Repository}}{{"\t"}}{{.Tag}}'
  )"; then
    ops_die "无法读取 Docker 镜像清单；为避免不完整清理，拒绝继续"
  fi
  mapfile -t references < <(
    printf '%s\n' "$image_listing" |
      awk -F $'\t' -v repository="$repository" \
        '$1 == repository && $2 ~ /^[0-9a-f]{40}$/ { print $1 ":" $2 }'
  )

  for reference in "${references[@]}"; do
    if ! created="$(docker image inspect --format '{{.Created}}' "$reference" 2>/dev/null)"; then
      ops_info "警告：镜像清单读取后发生变化，跳过：${reference}"
      continue
    fi
    if ! image_id="$(docker image inspect --format '{{.Id}}' "$reference" 2>/dev/null)"; then
      ops_info "警告：无法读取镜像 ID，跳过：${reference}"
      continue
    fi
    inventory+=("${created}"$'\t'"${reference}"$'\t'"${image_id}")
  done

  if [ "${#inventory[@]}" -gt 0 ]; then
    mapfile -t sorted_inventory < <(printf '%s\n' "${inventory[@]}" | LC_ALL=C sort -r)
  fi

  for line in "${sorted_inventory[@]}"; do
    IFS=$'\t' read -r created reference image_id <<< "$line"
    tag="${reference##*:}"

    if [ "$retained" -lt "$keep_images" ]; then
      retained=$((retained + 1))
      ops_info "保留最新镜像：${reference}"
      continue
    fi
    if [ -n "${protected_commits[$tag]+x}" ]; then
      ops_info "保留部署状态引用的镜像：${reference}"
      continue
    fi
    if [ -n "${container_image_ids[$image_id]+x}" ]; then
      ops_info "保留容器仍在引用的镜像：${reference}"
      continue
    fi

    if [ "$mode" = "dry-run" ]; then
      ops_info "将删除旧部署镜像：${reference}（创建于 ${created}）"
      preview_count=$((preview_count + 1))
      continue
    fi

    if docker image rm -- "$reference"; then
      removed_count=$((removed_count + 1))
    else
      ops_info "警告：镜像可能刚被容器引用，未强制删除：${reference}"
    fi
  done
}

ops_info "缓存清理模式：${mode}；每个部署镜像仓库至少保留 ${keep_images} 个最新 SHA 镜像。"
cleanup_repository "$runtime_repository"
if [ "$operations_repository" != "$runtime_repository" ]; then
  cleanup_repository "$operations_repository"
fi

if [ "$mode" = "dry-run" ]; then
  ops_info "将执行：docker image prune --force --filter until=${retention_hours}h（仅悬空镜像）"
  ops_info "将执行：docker builder prune --force --filter until=${retention_hours}h（仅构建缓存）"
  ops_info "预览完成：${preview_count} 个旧部署镜像符合删除条件；未修改 Docker 状态。"
  exit 0
fi

if ! docker image prune --force --filter "until=${retention_hours}h"; then
  ops_info "警告：悬空镜像清理失败；未执行强制删除。"
fi
if ! docker builder prune --force --filter "until=${retention_hours}h"; then
  ops_info "警告：构建缓存清理失败；未执行强制删除。"
fi

ops_info "缓存清理完成：删除 ${removed_count} 个旧部署镜像引用；未删除容器、volume 或数据库数据。"
