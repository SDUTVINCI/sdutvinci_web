#!/usr/bin/env bash

set -Eeuo pipefail
# shellcheck source=scripts/ops-common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/ops-common.sh"

ops_require_command docker
ops_require_command git

cd -- "$OPS_REPOSITORY_ROOT"

enabled="$(ops_compose_env AUTO_DEPLOY_ENABLED)"
if [ "$enabled" != "true" ]; then
  ops_info "自动部署未启用；在首次人工部署验收后设置 AUTO_DEPLOY_ENABLED=true。"
  exit 0
fi

state_file="$OPS_REPOSITORY_ROOT/.deploy/current"
failure_file="$OPS_REPOSITORY_ROOT/.deploy/auto-deploy-failed"

[ -f "$state_file" ] || ops_die "缺少 .deploy/current；必须先完成人工首次部署"
[ ! -L "$state_file" ] || ops_die "部署状态文件不得是符号链接"

if [ -d "$OPS_REPOSITORY_ROOT/.deploy/operation.lock" ]; then
  ops_info "已有部署、备份或恢复操作正在执行；本轮自动检查跳过。"
  exit 0
fi

configured_remote="$(ops_required_compose_env DEPLOY_GIT_REMOTE_URL)"
actual_remote="$(git remote get-url origin 2>/dev/null || true)"
[ "$actual_remote" = "$configured_remote" ] \
  || ops_die "origin 与 DEPLOY_GIT_REMOTE_URL 不一致，拒绝自动部署"

if [ -n "$(git status --porcelain=v1 --untracked-files=no)" ]; then
  ops_die "部署仓库存在已跟踪文件改动，拒绝自动覆盖"
fi

branch="$(ops_compose_env CMS_GIT_BRANCH)"
branch="${branch:-main}"
[[ "$branch" =~ ^[A-Za-z0-9._/-]+$ ]] || ops_die "CMS_GIT_BRANCH 格式不安全"

ops_info "自动部署检查 origin/${branch}..."
git fetch --prune origin "$branch"

target_commit="$(git rev-parse --verify "origin/${branch}^{commit}")"
[[ "$target_commit" =~ ^[0-9a-f]{40}$ ]] \
  || ops_die "远端目标不是完整的 40 位小写 Git commit"

current_commit="$(awk -F= '$1 == "commit" { print $2; exit }' "$state_file")"
[[ "$current_commit" =~ ^[0-9a-f]{40}$ ]] \
  || ops_die ".deploy/current 中的 commit 无效"
git cat-file -e "${current_commit}^{commit}" 2>/dev/null \
  || ops_die "当前线上 commit 不存在于部署仓库"

clear_matching_failure() {
  [ -e "$failure_file" ] || [ -L "$failure_file" ] || return 0
  [ -f "$failure_file" ] && [ ! -L "$failure_file" ] \
    || ops_die "自动部署失败标记必须是普通文件"

  local failed_commit
  failed_commit="$(awk -F= '$1 == "commit" { print $2; exit }' "$failure_file")"
  if [ "$failed_commit" = "$current_commit" ]; then
    rm -- "$failure_file"
  fi
}

if [ "$target_commit" = "$current_commit" ]; then
  clear_matching_failure
  ops_info "当前已经运行 origin/${branch} 最新 commit：${target_commit}"
  exit 0
fi

git merge-base --is-ancestor "$current_commit" "$target_commit" \
  || ops_die "origin/${branch} 不是当前线上 commit 的后继；拒绝倒序或分叉自动部署"

if [ -e "$failure_file" ] || [ -L "$failure_file" ]; then
  [ -f "$failure_file" ] && [ ! -L "$failure_file" ] \
    || ops_die "自动部署失败标记必须是普通文件"
  failed_commit="$(awk -F= '$1 == "commit" { print $2; exit }' "$failure_file")"
  if [ "$failed_commit" = "$target_commit" ]; then
    ops_info "目标 ${target_commit} 曾部署失败；为避免循环破坏，本轮不重试。"
    ops_info "排查后执行：rm -- '$failure_file'，或推送新的修复 commit。"
    exit 0
  fi
fi

deploy_mode="$("$OPS_REPOSITORY_ROOT/scripts/classify-deployment.sh" "$current_commit" "$target_commit")"
case "$deploy_mode" in
  content|application) ;;
  *) ops_die "无法识别自动部署模式：${deploy_mode:-空}" ;;
esac

runtime_image="$(ops_required_compose_env APP_IMAGE)"
operations_image="$(ops_required_compose_env APP_OPS_IMAGE)"
runtime_reference="${runtime_image}:${target_commit}"
operations_reference="${operations_image}:${target_commit}"

if ! docker manifest inspect "$runtime_reference" >/dev/null 2>&1; then
  ops_info "runtime 镜像尚未发布，等待下一轮：${runtime_reference}"
  exit 0
fi

if [ "$deploy_mode" = "application" ] \
  && ! docker manifest inspect "$operations_reference" >/dev/null 2>&1; then
  ops_info "operations 镜像尚未发布，等待下一轮：${operations_reference}"
  exit 0
fi

if [ -d "$OPS_REPOSITORY_ROOT/.deploy/operation.lock" ]; then
  ops_info "镜像检查期间出现了其他运维操作；本轮自动部署跳过。"
  exit 0
fi

ops_info "检测到可部署 commit：${target_commit}（${deploy_mode}）"
if ! DEPLOY_COMMIT="$target_commit" \
  DEPLOY_MODE="$deploy_mode" \
  APP_IMAGE="$runtime_image" \
  APP_OPS_IMAGE="$operations_image" \
  APP_IMAGE_TAG="$target_commit" \
  "$OPS_REPOSITORY_ROOT/scripts/deploy.sh"; then
  umask 077
  failure_temporary="$(mktemp "$OPS_REPOSITORY_ROOT/.deploy/auto-deploy-failed.XXXXXX")"
  {
    printf 'commit=%s\n' "$target_commit"
    printf 'mode=%s\n' "$deploy_mode"
    printf 'failed_at=%s\n' "$(date -u +%FT%TZ)"
  } > "$failure_temporary"
  mv -- "$failure_temporary" "$failure_file"
  ops_die "自动部署失败，已记录目标 commit 并停止循环重试"
fi

if [ -e "$failure_file" ] || [ -L "$failure_file" ]; then
  [ -f "$failure_file" ] && [ ! -L "$failure_file" ] \
    || ops_die "自动部署失败标记必须是普通文件"
  rm -- "$failure_file"
fi

ops_info "自动部署完成：${target_commit}（${deploy_mode}）"
