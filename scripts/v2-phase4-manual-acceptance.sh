#!/usr/bin/env bash

set -Eeuo pipefail

action="${1:-status}"
container_name="vinci-v2-phase4-manual-test-db"
database_name="vinci_v2_phase4_manual_test"
database_user="phase4_manual_test"
database_password="phase4_manual_test_only"
database_port="55445"
legacy_port="34150"
database_candidate_port="34151"
state_root="/tmp/vinci-v2-phase4-manual-test"
resource_label="com.sdutvinci.scope=v2-phase4-manual-test"
database_url="postgresql://${database_user}:${database_password}@127.0.0.1:${database_port}/${database_name}"

is_owned_container() {
  [[ "$(docker inspect -f '{{ index .Config.Labels "com.sdutvinci.scope" }}' "${container_name}" 2>/dev/null || true)" == "v2-phase4-manual-test" ]]
}

stop_pid() {
  local pid_file="$1"
  [[ -f "${pid_file}" ]] || return 0
  local pid
  pid="$(<"${pid_file}")"
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
}

stop_resources() {
  stop_pid "${state_root}/legacy.pid"
  stop_pid "${state_root}/database.pid"
  if docker inspect "${container_name}" >/dev/null 2>&1; then
    if ! is_owned_container; then
      echo "拒绝删除同名但不属于阶段 4 人工验收的容器：${container_name}" >&2
      return 1
    fi
    docker rm -f "${container_name}" >/dev/null
  fi
  if [[ -d "${state_root}" ]]; then
    find "${state_root}" -maxdepth 1 -type f \
      \( -name '*.pid' -o -name '*.log' \) -delete
    rmdir "${state_root}" 2>/dev/null || true
  fi
  echo "阶段 4 人工验收资源已精确清理。"
}

wait_for_database() {
  for _ in $(seq 1 30); do
    if docker exec "${container_name}" \
      pg_isready -U "${database_user}" -d "${database_name}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "阶段 4 人工验收数据库未就绪。" >&2
  return 1
}

wait_for_http() {
  local port="$1"
  for _ in $(seq 1 60); do
    if curl --fail --silent --output /dev/null "http://127.0.0.1:${port}/"; then
      return 0
    fi
    sleep 1
  done
  echo "本地 HTTP ${port} 未就绪。" >&2
  return 1
}

start_resources() {
  if docker inspect "${container_name}" >/dev/null 2>&1 || [[ -e "${state_root}" ]]; then
    echo "阶段 4 人工验收资源已存在；先运行 $0 stop，确认归属后再重试。" >&2
    return 1
  fi
  mkdir -m 700 "${state_root}"
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

  env -u TEST_DATABASE_URL DATABASE_URL="${database_url}" npm run db:migrate
  env -u TEST_DATABASE_URL DATABASE_URL="${database_url}" node --import tsx -e "
    const main = async () => {
      const { synchronizeCmsMembers } = await import('./server/services/cms-members.ts')
      const { synchronizeCmsArticles } = await import('./server/services/cms-articles.ts')
      const { closeDatabase } = await import('./server/db/client.ts')
      try {
        await synchronizeCmsMembers(false)
        await synchronizeCmsArticles()
      } finally {
        await closeDatabase()
      }
    }
    await main()
  "
  env -u TEST_DATABASE_URL DATABASE_URL="${database_url}" \
    npm run v2:revisions:backfill -- \
      --apply --confirm=BACKFILL_ARTICLE_REVISIONS >/dev/null
  NUXT_PUBLIC_SITE_URL="http://127.0.0.1:${database_candidate_port}" npm run build

  env -i \
    PATH="${PATH}" \
    DATABASE_URL="${database_url}" \
    NITRO_HOST=127.0.0.1 \
    NITRO_PORT="${legacy_port}" \
    NUXT_PUBLIC_SITE_URL="http://127.0.0.1:${legacy_port}" \
    CONTENT_CANDIDATE_ENV=disabled \
    CONTENT_SOURCE_NEWS=legacy_git \
    CONTENT_SOURCE_WIKI=legacy_git \
    CONTENT_SOURCE_MEMBERS=legacy_git \
    node .output/server/index.mjs >"${state_root}/legacy.log" 2>&1 &
  echo "$!" >"${state_root}/legacy.pid"

  env -i \
    PATH="${PATH}" \
    DATABASE_URL="${database_url}" \
    NITRO_HOST=127.0.0.1 \
    NITRO_PORT="${database_candidate_port}" \
    NUXT_PUBLIC_SITE_URL="http://127.0.0.1:${database_candidate_port}" \
    CONTENT_CANDIDATE_ENV=staging \
    CONTENT_SOURCE_NEWS=database \
    CONTENT_SOURCE_WIKI=database \
    CONTENT_SOURCE_MEMBERS=database \
    node .output/server/index.mjs >"${state_root}/database.log" 2>&1 &
  echo "$!" >"${state_root}/database.pid"

  wait_for_http "${legacy_port}"
  wait_for_http "${database_candidate_port}"
  trap - ERR INT TERM
  echo "旧前台：http://127.0.0.1:${legacy_port}"
  echo "数据库候选：http://127.0.0.1:${database_candidate_port}"
  echo "验收完成后运行：$0 stop"
}

show_status() {
  if is_owned_container; then
    echo "阶段 4 人工验收数据库：存在"
  else
    echo "阶段 4 人工验收数据库：未运行"
  fi
  for name in legacy database; do
    if [[ -f "${state_root}/${name}.pid" ]] \
      && kill -0 "$(<"${state_root}/${name}.pid")" 2>/dev/null; then
      echo "${name} HTTP：运行中"
    else
      echo "${name} HTTP：未运行"
    fi
  done
}

case "${action}" in
  start) start_resources ;;
  stop) stop_resources ;;
  status) show_status ;;
  *)
    echo "用法：$0 {start|status|stop}" >&2
    exit 2
    ;;
esac
