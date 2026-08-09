#!/usr/bin/env bash

set -Eeuo pipefail
# shellcheck source=scripts/ops-common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/ops-common.sh"

ops_require_command docker
ops_require_command git
ops_require_command realpath
ops_acquire_lock

cd -- "$OPS_REPOSITORY_ROOT"

target_commit="${DEPLOY_COMMIT:-}"
requested_mode="${DEPLOY_MODE:-application}"
[[ "$target_commit" =~ ^[0-9a-f]{40}$ ]] \
  || ops_die "DEPLOY_COMMIT 必须是完整的 40 位小写 Git commit"
[ "$requested_mode" = "application" ] \
  || ops_die "V2 阶段 10 后 DEPLOY_MODE 只能是 application"

cache_cleanup_enabled="$(ops_compose_env DEPLOY_CACHE_CLEANUP_ENABLED)"
cache_cleanup_enabled="${cache_cleanup_enabled:-true}"
case "$cache_cleanup_enabled" in
  true|false) ;;
  *) ops_die "DEPLOY_CACHE_CLEANUP_ENABLED 只能是 true 或 false" ;;
esac

configured_remote="$(ops_required_compose_env DEPLOY_GIT_REMOTE_URL)"
actual_remote="$(git remote get-url origin 2>/dev/null || true)"
[ "$actual_remote" = "$configured_remote" ] \
  || ops_die "origin 与 DEPLOY_GIT_REMOTE_URL 不一致，拒绝部署"

if [ -n "$(git status --porcelain=v1 --untracked-files=no)" ]; then
  ops_die "部署仓库存在已跟踪文件改动，拒绝覆盖"
fi

if [ "$cache_cleanup_enabled" = "true" ]; then
  ops_info "拉取代码和候选镜像前清理可重建缓存及未使用的旧部署镜像..."
  "$OPS_REPOSITORY_ROOT/scripts/cleanup-deploy-cache.sh" --apply --lock-held
fi

branch="$(ops_compose_env CMS_GIT_BRANCH)"
branch="${branch:-main}"
[[ "$branch" =~ ^[A-Za-z0-9._/-]+$ ]] || ops_die "CMS_GIT_BRANCH 格式不安全"

ops_info "读取远端 ${branch}..."
git fetch --prune origin "$branch"
git cat-file -e "${target_commit}^{commit}" 2>/dev/null \
  || ops_die "目标 commit 不存在：${target_commit}"
git merge-base --is-ancestor "$target_commit" "origin/${branch}" \
  || ops_die "目标 commit 不属于 origin/${branch}，拒绝部署"

state_file="$OPS_REPOSITORY_ROOT/.deploy/current"
previous_commit=""
previous_slot=""
previous_image=""
if [ -f "$state_file" ]; then
  [ ! -L "$state_file" ] || ops_die "部署状态文件不得是符号链接"
  previous_commit="$(awk -F= '$1 == "commit" { print $2; exit }' "$state_file")"
  previous_slot="$(awk -F= '$1 == "slot" { print $2; exit }' "$state_file")"
  previous_image="$(awk -F= '$1 == "image" { print $2; exit }' "$state_file")"
fi

if [ -n "$previous_commit" ]; then
  [[ "$previous_commit" =~ ^[0-9a-f]{40}$ ]] \
    || ops_die "部署状态中的 previous commit 无效"
  git cat-file -e "${previous_commit}^{commit}" 2>/dev/null \
    || ops_die "部署状态中的 previous commit 不存在"
  git merge-base --is-ancestor "$previous_commit" "$target_commit" \
    || ops_die "目标 commit 不是当前线上 commit 的后继，拒绝倒序或分叉部署"
fi
case "$previous_slot" in
  ""|blue|green) ;;
  *) ops_die "部署状态中的 slot 无效" ;;
esac

project="$(ops_project_name)"
worker_was_running=false
worker_replaced=false
previous_worker_image=""
mapfile -t content_export_workers < <(
  docker ps -q \
    --filter "label=com.docker.compose.project=${project}" \
    --filter "label=com.docker.compose.service=content-export-worker"
)
[ "${#content_export_workers[@]}" -le 1 ] \
  || ops_die "发现多个常驻内容导出 Worker，拒绝自动选择"
if [ "${#content_export_workers[@]}" -eq 1 ]; then
  worker_was_running=true
  previous_worker_image="$(docker inspect --format '{{.Config.Image}}' "${content_export_workers[0]}")"
  [[ "$previous_worker_image" =~ ^[A-Za-z0-9._/:@-]+:[0-9a-f]{40}$ ]] \
    || ops_die "当前内容导出 Worker 镜像不可追踪，拒绝自动替换"
fi

target_image="${APP_IMAGE:?APP_IMAGE is required}:${APP_IMAGE_TAG:?APP_IMAGE_TAG is required}"
[[ "$APP_IMAGE" =~ ^[A-Za-z0-9._/:@-]+$ ]] || ops_die "APP_IMAGE 格式不安全"
[[ "$APP_IMAGE_TAG" =~ ^[A-Za-z0-9._-]+$ ]] || ops_die "APP_IMAGE_TAG 格式不安全"
[ "$APP_IMAGE_TAG" = "$target_commit" ] \
  || ops_die "APP_IMAGE_TAG 必须与 DEPLOY_COMMIT 相同，确保镜像不可变且可追踪"

: "${APP_OPS_IMAGE:?APP_OPS_IMAGE is required for application deployment}"
[[ "$APP_OPS_IMAGE" =~ ^[A-Za-z0-9._/:@-]+$ ]] \
  || ops_die "APP_OPS_IMAGE 格式不安全"

git switch --detach "$target_commit"

if [ "$previous_slot" = "blue" ]; then
  candidate_slot="green"
else
  candidate_slot="blue"
fi
candidate_service="app-${candidate_slot}"
previous_service=""
[ -z "$previous_slot" ] || previous_service="app-${previous_slot}"

gateway_switched=false
legacy_stopped=false
legacy_container=""

switch_gateway() {
  local slot="$1"
  case "$slot" in
    blue|green) ;;
    *) ops_die "拒绝把网关切换到无效槽位：${slot}" ;;
  esac

  docker compose exec -T gateway sh -eu -c '
    slot="$1"
    config=/config/Caddyfile
    next=/config/Caddyfile.next
    previous=/config/Caddyfile.previous

    case "$slot" in
      blue|green) ;;
      *) exit 64 ;;
    esac
    [ -f "$config" ]
    [ ! -L "$config" ]

    {
      printf "{\n"
      printf "\tauto_https off\n"
      printf "\tadmin localhost:2019\n"
      printf "}\n\n"
      printf ":8080 {\n"
      printf "\trequest_body {\n"
      printf "\t\tmax_size 55MB\n"
      printf "\t}\n"
      printf "\treverse_proxy app-%s:3000\n" "$slot"
      printf "}\n"
    } > "$next"

    caddy validate --config "$next" --adapter caddyfile
    cp "$config" "$previous"
    mv "$next" "$config"
    if ! caddy reload --config "$config" --adapter caddyfile; then
      mv "$previous" "$config"
      caddy reload --config "$config" --adapter caddyfile || true
      exit 1
    fi
    rm -f "$previous"
  ' sh "$slot"
}

rollback() {
  local failed_status=$?
  trap - ERR

  if [ "$gateway_switched" = true ] && [ -n "$previous_slot" ]; then
    ops_info "新版本未通过网关检查，切回 ${previous_slot} 槽位..."
    switch_gateway "$previous_slot" || true
  fi

  if [ "$legacy_stopped" = true ] && [ -n "$legacy_container" ]; then
    ops_info "恢复旧版单应用容器..."
    docker compose stop gateway >/dev/null 2>&1 || true
    docker start "$legacy_container" >/dev/null 2>&1 || true
  fi

  if [ "$worker_replaced" = true ] && [ "$worker_was_running" = true ]; then
    local previous_worker_repository previous_worker_tag
    previous_worker_repository="${previous_worker_image%:*}"
    previous_worker_tag="${previous_worker_image##*:}"
    ops_info "恢复原内容导出 Worker 镜像..."
    APP_OPS_IMAGE="$previous_worker_repository" APP_IMAGE_TAG="$previous_worker_tag" \
      docker compose -f compose.yaml -f compose.content-export.yaml \
      --profile content-export up -d --no-deps --force-recreate content-export-worker \
      >/dev/null 2>&1 || true
  fi

  if [[ "$previous_commit" =~ ^[0-9a-f]{40}$ ]]; then
    git switch --detach "$previous_commit" >/dev/null 2>&1 || true
  fi

  ops_info "失败候选容器 ${candidate_service} 已保留供排查；原活动槽位未删除。"
  exit "$failed_status"
}
trap rollback ERR

ops_info "拉取 ${candidate_service} 的目标应用镜像..."
docker compose pull gateway "$candidate_service"
docker compose up -d --wait postgres

ops_info "应用部署：拉取运维镜像并执行仓库内已审核的数据库迁移..."
docker compose --profile tools pull migrate
docker compose --profile tools run --rm --no-deps migrate

if [ -n "$previous_service" ]; then
  previous_container="$(docker compose ps -q "$previous_service")"
  [ -n "$previous_container" ] \
    || ops_die "部署状态指向 ${previous_service}，但对应容器不存在"
  [ "$(docker inspect --format '{{.State.Running}}' "$previous_container")" = "true" ] \
    || ops_die "当前活动槽位 ${previous_service} 未运行"
fi

ops_info "在 ${candidate_slot} 槽位启动候选版本并等待健康检查..."
docker compose up -d --no-deps --wait --wait-timeout 180 "$candidate_service"
docker compose exec -T "$candidate_service" node -e \
  "fetch('http://127.0.0.1:3000/api/health').then(response => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

if [ "$worker_was_running" = true ]; then
  target_worker_image="${APP_OPS_IMAGE}:${APP_IMAGE_TAG}"
  if [ "$previous_worker_image" != "$target_worker_image" ]; then
    ops_info "同步已启用的常驻内容导出 Worker 到目标运维镜像..."
    docker compose -f compose.yaml -f compose.content-export.yaml \
      --profile content-export pull content-export-worker
    worker_replaced=true
    docker compose -f compose.yaml -f compose.content-export.yaml \
      --profile content-export up -d --no-deps --force-recreate content-export-worker
    worker_container="$(docker compose -f compose.yaml -f compose.content-export.yaml \
      --profile content-export ps -q content-export-worker)"
    [ -n "$worker_container" ] \
      || ops_die "内容导出 Worker 重建后容器不存在"
    [ "$(docker inspect --format '{{.State.Running}}' "$worker_container")" = true ] \
      || ops_die "内容导出 Worker 重建后未运行"
    [ "$(docker inspect --format '{{.Config.Image}}' "$worker_container")" = "$target_worker_image" ] \
      || ops_die "内容导出 Worker 重建后镜像与目标 Commit 不一致"
  fi
fi

mapfile -t legacy_containers < <(
  docker ps -aq \
    --filter "label=com.docker.compose.project=${project}" \
    --filter "label=com.docker.compose.service=app"
)
[ "${#legacy_containers[@]}" -le 1 ] \
  || ops_die "发现多个旧版 app 容器，拒绝自动选择"
if [ "${#legacy_containers[@]}" -eq 1 ]; then
  legacy_container="${legacy_containers[0]}"
  if [ "$(docker inspect --format '{{.State.Running}}' "$legacy_container")" = "true" ]; then
    ops_info "停止旧版单应用容器，以便常驻网关接管端口..."
    docker stop "$legacy_container" >/dev/null
    legacy_stopped=true
  fi
fi

docker compose up -d --no-deps --wait --wait-timeout 120 gateway
switch_gateway "$candidate_slot"
gateway_switched=true

docker compose exec -T gateway \
  wget --quiet --spider http://127.0.0.1:8080/api/health

if [ -n "$previous_commit" ]; then
  rollback_file="$OPS_REPOSITORY_ROOT/.deploy/rollback-verified"
  rollback_temporary="$(mktemp "$OPS_REPOSITORY_ROOT/.deploy/rollback-verified.XXXXXX")"
  umask 077
  {
    printf 'commit=%s\n' "$previous_commit"
    printf 'image=%s\n' "$previous_image"
    printf 'slot=%s\n' "$previous_slot"
    printf 'verified_by=previous_healthy_deployment\n'
    printf 'replaced_at=%s\n' "$(date -u +%FT%TZ)"
  } > "$rollback_temporary"
  mv -- "$rollback_temporary" "$rollback_file"
fi

state_temporary="$(mktemp "$OPS_REPOSITORY_ROOT/.deploy/current.XXXXXX")"
umask 077
{
  printf 'commit=%s\n' "$target_commit"
  printf 'image=%s\n' "$target_image"
  printf 'slot=%s\n' "$candidate_slot"
  printf 'mode=%s\n' "$requested_mode"
} > "$state_temporary"
mv -- "$state_temporary" "$state_file"

if [ -n "$legacy_container" ]; then
  legacy_stopped=false
  docker rm "$legacy_container" >/dev/null \
    || ops_info "警告：旧版已停止容器未能自动移除，可在核对后人工清理：${legacy_container}"
fi

trap - ERR
if [ "$cache_cleanup_enabled" = "true" ]; then
  ops_info "部署成功后收尾清理旧部署缓存..."
  if ! "$OPS_REPOSITORY_ROOT/scripts/cleanup-deploy-cache.sh" --apply --lock-held; then
    ops_info "警告：部署已经成功，但部署后缓存清理未完成；可稍后执行预览并重试。"
  fi
fi
ops_info "部署成功：${target_commit}（${requested_mode}，活动槽位 ${candidate_slot}）"
