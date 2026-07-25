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
case "$requested_mode" in
  application|content) ;;
  *) ops_die "DEPLOY_MODE 只能是 application 或 content" ;;
esac

configured_remote="$(ops_required_compose_env DEPLOY_GIT_REMOTE_URL)"
actual_remote="$(git remote get-url origin 2>/dev/null || true)"
[ "$actual_remote" = "$configured_remote" ] \
  || ops_die "origin 与 DEPLOY_GIT_REMOTE_URL 不一致，拒绝部署"

if [ -n "$(git status --porcelain=v1 --untracked-files=no)" ]; then
  ops_die "部署仓库存在已跟踪文件改动，拒绝覆盖"
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
if [ -f "$state_file" ]; then
  [ ! -L "$state_file" ] || ops_die "部署状态文件不得是符号链接"
  previous_commit="$(awk -F= '$1 == "commit" { print $2; exit }' "$state_file")"
  previous_slot="$(awk -F= '$1 == "slot" { print $2; exit }' "$state_file")"
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

actual_mode="application"
if [ -n "$previous_commit" ] && [ "$previous_commit" != "$target_commit" ]; then
  mapfile -d '' changed_paths < <(
    git diff --no-renames --name-only --diff-filter=ACDMRTUXB -z "$previous_commit" "$target_commit"
  )
  if [ "${#changed_paths[@]}" -gt 0 ]; then
    actual_mode="content"
    for changed_path in "${changed_paths[@]}"; do
      case "$changed_path" in
        content/*) ;;
        *)
          actual_mode="application"
          break
          ;;
      esac
    done
  fi
fi

if [ "$requested_mode" = "content" ]; then
  [ -n "$previous_commit" ] \
    || ops_die "首次部署不得使用 content 模式"
  [ -n "$previous_slot" ] \
    || ops_die "旧版单容器尚未迁移到双槽位，不得使用 content 模式"
  [ "$actual_mode" = "content" ] \
    || ops_die "目标包含 content/ 之外的改动，拒绝跳过完整应用部署"
fi

target_image="${APP_IMAGE:?APP_IMAGE is required}:${APP_IMAGE_TAG:?APP_IMAGE_TAG is required}"
[[ "$APP_IMAGE" =~ ^[A-Za-z0-9._/:@-]+$ ]] || ops_die "APP_IMAGE 格式不安全"
[[ "$APP_IMAGE_TAG" =~ ^[A-Za-z0-9._-]+$ ]] || ops_die "APP_IMAGE_TAG 格式不安全"
[ "$APP_IMAGE_TAG" = "$target_commit" ] \
  || ops_die "APP_IMAGE_TAG 必须与 DEPLOY_COMMIT 相同，确保镜像不可变且可追踪"

if [ "$requested_mode" = "application" ]; then
  : "${APP_OPS_IMAGE:?APP_OPS_IMAGE is required for application deployment}"
  [[ "$APP_OPS_IMAGE" =~ ^[A-Za-z0-9._/:@-]+$ ]] \
    || ops_die "APP_OPS_IMAGE 格式不安全"
fi

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

if [ "$requested_mode" = "application" ]; then
  ops_info "应用部署：拉取运维镜像并执行仓库内已审核的数据库迁移..."
  docker compose --profile tools pull migrate
  docker compose --profile tools run --rm --no-deps migrate
else
  ops_info "纯 content/ 部署：跳过运维镜像和数据库迁移。"
fi

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

project="$(ops_project_name)"
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
ops_info "部署成功：${target_commit}（${requested_mode}，活动槽位 ${candidate_slot}）"
