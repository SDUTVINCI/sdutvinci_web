#!/usr/bin/env bash

set -Eeuo pipefail

action="${1:-status}"
container_name="vinci-v2-phase5-manual-test-db"
database_name="vinci_v2_phase5_manual_test"
database_user="phase5_manual_test"
database_password="phase5_manual_test_only"
database_port="55446"
application_port="34160"
state_root="/tmp/vinci-v2-phase5-manual-test"
resource_label="com.sdutvinci.scope=v2-phase5-manual-test"
database_url="postgresql://${database_user}:${database_password}@127.0.0.1:${database_port}/${database_name}"
repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

is_owned_container() {
  [[ "$(docker inspect -f '{{ index .Config.Labels "com.sdutvinci.scope" }}' "${container_name}" 2>/dev/null || true)" == "v2-phase5-manual-test" ]]
}

require_owned_state() {
  [[ -f "${state_root}/.vinci-v2-phase5-manual-test" ]] || {
    echo "找不到阶段 5 人工验收归属标记，拒绝操作 ${state_root}。" >&2
    return 1
  }
}

stop_application() {
  [[ -f "${state_root}/application.pid" ]] || return 0
  local pid
  pid="$(<"${state_root}/application.pid")"
  if [[ "${pid}" =~ ^[0-9]+$ ]] && kill -0 "${pid}" 2>/dev/null; then
    local command_line
    command_line="$(tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null || true)"
    if [[ "${command_line}" == *".output/server/index.mjs"* ]]; then
      kill "${pid}"
      for _ in $(seq 1 20); do
        kill -0 "${pid}" 2>/dev/null || break
        sleep 0.25
      done
    fi
  fi
  rm -f -- "${state_root}/application.pid"
}

stop_resources() {
  if [[ -e "${state_root}" ]]; then
    require_owned_state
    stop_application
  fi
  if docker inspect "${container_name}" >/dev/null 2>&1; then
    if ! is_owned_container; then
      echo "拒绝删除同名但不属于阶段 5 人工验收的容器：${container_name}" >&2
      return 1
    fi
    docker rm -f "${container_name}" >/dev/null
  fi
  if [[ -d "${state_root}" ]]; then
    require_owned_state
    rm -rf -- "${state_root}"
  fi
  echo "阶段 5 人工验收资源已精确清理。"
}

wait_for_database() {
  for _ in $(seq 1 30); do
    if docker exec "${container_name}" \
      pg_isready -U "${database_user}" -d "${database_name}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "阶段 5 人工验收数据库未就绪。" >&2
  return 1
}

wait_for_http() {
  for _ in $(seq 1 60); do
    if curl --fail --silent --output /dev/null \
      "http://127.0.0.1:${application_port}/"; then
      return 0
    fi
    sleep 1
  done
  echo "阶段 5 本地 HTTP 未就绪；请保存 ${state_root}/application.log。" >&2
  return 1
}

start_application() {
  local mode="$1"
  require_owned_state
  stop_application
  local publish_mode="database"
  local candidate_environment="production"
  local news_source="database"
  local wiki_source="database"
  local git_remote_url="ssh://invalid.phase5.test/no-write-access"
  local git_worktree="${state_root}/git-must-not-exist"
  if [[ "${mode}" == "legacy" ]]; then
    publish_mode="legacy_git"
    candidate_environment="disabled"
    news_source="legacy_git"
    wiki_source="legacy_git"
    git_remote_url="${state_root}/rollback-remote.git"
    git_worktree="${state_root}/rollback-worktree"
    if [[ ! -d "${git_remote_url}" ]]; then
      git clone --bare "${repository_root}" "${git_remote_url}" >/dev/null
    fi
  fi

  env -i \
    PATH="${PATH}" \
    NODE_ENV=production \
    DATABASE_URL="${database_url}" \
    NITRO_HOST=127.0.0.1 \
    NITRO_PORT="${application_port}" \
    NUXT_PUBLIC_SITE_URL="http://127.0.0.1:${application_port}" \
    CMS_AUTH_SECRET="phase5-manual-test-secret-32-bytes-minimum" \
    CMS_SECURE_COOKIES=false \
    CMS_CONTENT_ROOT="${repository_root}/content" \
    CMS_GIT_WORKTREE="${git_worktree}" \
    CMS_GIT_REMOTE_URL="${git_remote_url}" \
    CMS_GIT_REMOTE=origin \
    CMS_GIT_BRANCH=main \
    CMS_GIT_AUTHOR_NAME="Vinci Phase5 Test" \
    CMS_GIT_AUTHOR_EMAIL="phase5@example.test" \
    CONTENT_PUBLISH_MODE="${publish_mode}" \
    CONTENT_SOURCE_NEWS="${news_source}" \
    CONTENT_SOURCE_WIKI="${wiki_source}" \
    CONTENT_SOURCE_MEMBERS=legacy_git \
    CONTENT_CANDIDATE_ENV="${candidate_environment}" \
    S3_ENDPOINT="http://127.0.0.1:1" \
    S3_REGION=phase5-test \
    S3_BUCKET=phase5-test \
    S3_ACCESS_KEY_ID=phase5-test \
    S3_SECRET_ACCESS_KEY=phase5-test \
    S3_PUBLIC_BASE_URL="http://127.0.0.1:1/phase5-test" \
    node "${repository_root}/.output/server/index.mjs" \
      >"${state_root}/application.log" 2>&1 &
  echo "$!" >"${state_root}/application.pid"
  printf '%s\n' "${mode}" >"${state_root}/mode"
  wait_for_http
  echo "阶段 5 ${mode} 应用：http://127.0.0.1:${application_port}"
}

start_resources() {
  if docker inspect "${container_name}" >/dev/null 2>&1 || [[ -e "${state_root}" ]]; then
    echo "阶段 5 人工验收资源已存在；先确认归属并运行 $0 stop。" >&2
    return 1
  fi
  mkdir -m 700 "${state_root}"
  : >"${state_root}/.vinci-v2-phase5-manual-test"
  trap 'stop_resources' ERR INT TERM
  docker run -d \
    --name "${container_name}" \
    --label "${resource_label}" \
    -e "POSTGRES_DB=${database_name}" \
    -e "POSTGRES_USER=${database_user}" \
    -e "POSTGRES_PASSWORD=${database_password}" \
    -p "127.0.0.1:${database_port}:5432" \
    postgres:17-alpine >/dev/null
  wait_for_database

  cd -- "${repository_root}"
  env -u TEST_DATABASE_URL \
    DATABASE_URL="${database_url}" \
    CONTENT_PUBLISH_MODE=legacy_git \
    CMS_CONTENT_ROOT="${repository_root}/content" \
    npm run cms:content:sync
  env -u TEST_DATABASE_URL \
    DATABASE_URL="${database_url}" \
    CMS_CONTENT_ROOT="${repository_root}/content" \
    npm run v2:revisions:backfill -- \
      --apply --confirm=BACKFILL_ARTICLE_REVISIONS >/dev/null
  NUXT_PUBLIC_SITE_URL="http://127.0.0.1:${application_port}" npm run build
  start_application database
  trap - ERR INT TERM
  echo "先运行“$0 admin”创建隔离管理员，再从浏览器登录。"
  echo "验收完成后运行：$0 stop"
}

create_admin() {
  is_owned_container && require_owned_state || {
    echo "阶段 5 人工验收数据库未运行。" >&2
    return 1
  }
  cd -- "${repository_root}"
  env -u TEST_DATABASE_URL \
    DATABASE_URL="${database_url}" \
    CMS_AUTH_SECRET="phase5-manual-test-secret-32-bytes-minimum" \
    npm run cms:admin
}

run_consistency() {
  is_owned_container && require_owned_state || {
    echo "阶段 5 人工验收数据库未运行。" >&2
    return 1
  }
  cd -- "${repository_root}"
  env -u TEST_DATABASE_URL \
    DATABASE_URL="${database_url}" \
    npm run v2:phase5:consistency
}

show_status() {
  if is_owned_container; then
    echo "阶段 5 人工验收数据库：存在且归属正确"
  else
    echo "阶段 5 人工验收数据库：未运行"
  fi
  if [[ -f "${state_root}/application.pid" ]] \
    && kill -0 "$(<"${state_root}/application.pid")" 2>/dev/null; then
    echo "HTTP：运行中，模式 $(<"${state_root}/mode")"
  else
    echo "HTTP：未运行"
  fi
}

case "${action}" in
  start) start_resources ;;
  admin) create_admin ;;
  database) start_application database ;;
  legacy) start_application legacy ;;
  consistency) run_consistency ;;
  stop) stop_resources ;;
  status) show_status ;;
  *)
    echo "用法：$0 {start|admin|database|legacy|consistency|status|stop}" >&2
    exit 2
    ;;
esac
