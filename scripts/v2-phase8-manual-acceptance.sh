#!/usr/bin/env bash

set -Eeuo pipefail

action="${1:-status}"
container_name="vinci-v2-phase8-manual-test-db"
application_container_name="vinci-v2-phase8-manual-test-app"
mock_container_name="vinci-v2-phase8-manual-test-mock"
database_name="vinci_v2_phase8_manual_test"
database_user="phase8_manual_test"
database_password="phase8_manual_test_only"
database_port="55452"
application_port="34162"
mock_port="34163"
state_root="/tmp/vinci-v2-phase8-manual-test"
resource_label="com.sdutvinci.scope=v2-phase8-manual-test"
database_url="postgresql://${database_user}:${database_password}@127.0.0.1:${database_port}/${database_name}"
repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

is_owned_container() {
  local target_name="${1:-${container_name}}"
  [[ "$(docker inspect -f '{{ index .Config.Labels "com.sdutvinci.scope" }}' \
    "${target_name}" 2>/dev/null || true)" == "v2-phase8-manual-test" ]]
}

require_owned_state() {
  [[ -f "${state_root}/.vinci-v2-phase8-manual-test" ]] || {
    echo "找不到阶段 8 人工验收归属标记，拒绝操作 ${state_root}。" >&2
    return 1
  }
}

stop_resources() {
  if [[ -e "${state_root}" ]]; then
    require_owned_state
  fi
  for target_name in "${application_container_name}" "${mock_container_name}" "${container_name}"; do
    if docker inspect "${target_name}" >/dev/null 2>&1; then
      is_owned_container "${target_name}" || {
        echo "拒绝删除同名但不属于阶段 8 人工验收的容器 ${target_name}。" >&2
        return 1
      }
      docker rm -f "${target_name}" >/dev/null
    fi
  done
  if [[ -d "${state_root}" ]]; then
    require_owned_state
    rm -rf -- "${state_root}"
  fi
  echo "阶段 8 人工验收数据库、本地裸 Git 远端、PR fixture、mock、日志和进程已精确清理。"
}

wait_for_database() {
  for _ in $(seq 1 30); do
    docker exec "${container_name}" pg_isready -U "${database_user}" -d "${database_name}" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "阶段 8 隔离数据库未就绪。" >&2
  return 1
}

wait_for_url() {
  local url="$1"
  local label="$2"
  for _ in $(seq 1 60); do
    curl --fail --silent --output /dev/null "${url}" && return 0
    sleep 1
  done
  echo "${label} 未就绪；请保留 ${state_root} 中的日志。" >&2
  return 1
}

start_resources() {
  if docker inspect "${container_name}" >/dev/null 2>&1 \
    || docker inspect "${application_container_name}" >/dev/null 2>&1 \
    || docker inspect "${mock_container_name}" >/dev/null 2>&1 \
    || [[ -e "${state_root}" ]]; then
    echo "阶段 8 人工验收资源已存在；先核对后运行 $0 stop。" >&2
    return 1
  fi
  if ss -ltn | awk '{print $4}' | grep -Eq ":(${database_port}|${application_port}|${mock_port})$"; then
    echo "阶段 8 验收端口已被占用，拒绝复用。" >&2
    return 1
  fi
  mkdir -m 700 "${state_root}"
  : >"${state_root}/.vinci-v2-phase8-manual-test"
  trap 'stop_resources' ERR INT TERM
  docker run -d \
    --name "${container_name}" \
    --label "${resource_label}" \
    -e "POSTGRES_DB=${database_name}" \
    -e "POSTGRES_USER=${database_user}" \
    -e "POSTGRES_PASSWORD=${database_password}" \
    -p "127.0.0.1:${database_port}:5432" \
    postgres:17-bookworm >/dev/null
  wait_for_database
  cd -- "${repository_root}"
  env -u TEST_DATABASE_URL \
    DATABASE_URL="${database_url}" \
    PHASE8_MANUAL_STATE_ROOT="${state_root}" \
    ./node_modules/.bin/tsx scripts/v2-phase8-manual-fixture.ts
  NUXT_PUBLIC_SITE_URL="http://127.0.0.1:${application_port}" npm run build
  docker run -d \
    --name "${mock_container_name}" \
    --label "${resource_label}" \
    --network host \
    -v "${repository_root}:${repository_root}:ro" \
    -v "${state_root}:${state_root}" \
    -w "${repository_root}" \
    -e NODE_ENV=test \
    -e "PHASE8_MANUAL_STATE_ROOT=${state_root}" \
    -e "PHASE8_MANUAL_MOCK_PORT=${mock_port}" \
    -e CONTENT_PR_IMPORT_GITHUB_TOKEN=phase8-local-mock-token \
    node:24-bookworm-slim \
    ./node_modules/.bin/tsx scripts/v2-phase8-mock-github.ts >/dev/null
  wait_for_url "http://127.0.0.1:${mock_port}/health" "阶段 8 mock GitHub API"
  docker run -d \
    --name "${application_container_name}" \
    --label "${resource_label}" \
    --network host \
    -v "${repository_root}:${repository_root}:ro" \
    -w "${repository_root}" \
    -e NODE_ENV=test \
    -e "DATABASE_URL=${database_url}" \
    -e NITRO_HOST=127.0.0.1 \
    -e "NITRO_PORT=${application_port}" \
    -e "NUXT_PUBLIC_SITE_URL=http://127.0.0.1:${application_port}" \
    -e CMS_AUTH_SECRET=phase8-manual-test-secret-32-bytes-minimum \
    -e CMS_SECURE_COOKIES=false \
    -e "CMS_CONTENT_ROOT=${repository_root}/content" \
    -e "CMS_GIT_WORKTREE=${state_root}/legacy-worktree-do-not-create" \
    -e CMS_GIT_REMOTE_URL=ssh://invalid.phase8.test/no-write-access \
    -e CONTENT_PUBLISH_MODE=database \
    -e CONTENT_SOURCE_NEWS=database \
    -e CONTENT_SOURCE_WIKI=database \
    -e CONTENT_SOURCE_MEMBERS=legacy_git \
    -e CONTENT_EXPORT_MODE=disabled \
    -e CONTENT_PR_IMPORT_MODE=enabled \
    -e CONTENT_PR_IMPORT_REPOSITORY_ID=SDUTVINCI/sdutvinci_content \
    -e "CONTENT_PR_IMPORT_API_URL=http://127.0.0.1:${mock_port}" \
    -e CONTENT_PR_IMPORT_GITHUB_TOKEN=phase8-local-mock-token \
    -e CONTENT_PR_IMPORT_ROLE_CODES=content_importer \
    -e CONTENT_PR_IMPORT_TEST_MODE=true \
    -e S3_ENDPOINT=http://127.0.0.1:1 \
    -e S3_REGION=phase8-test \
    -e S3_BUCKET=phase8-test \
    -e S3_ACCESS_KEY_ID=phase8-test \
    -e S3_SECRET_ACCESS_KEY=phase8-test \
    -e S3_PUBLIC_BASE_URL=http://127.0.0.1:1/phase8-test \
    node:24-bookworm-slim \
    node .output/server/index.mjs >/dev/null
  wait_for_url "http://127.0.0.1:${application_port}/cms/login" "阶段 8 隔离 CMS"
  trap - ERR INT TERM
  echo "阶段 8 隔离 CMS：http://127.0.0.1:${application_port}/cms/login"
  echo "账号：phase8admin"
  echo "密码：Phase8Manual123!"
  echo "测试 PR：SDUTVINCI/sdutvinci_content #8（仅本地裸 Git + mock API）"
}

show_status() {
  is_owned_container "${container_name}" && echo "隔离数据库：运行中且归属正确" || echo "隔离数据库：未运行"
  for entry in "application:${application_container_name}" "mock:${mock_container_name}"; do
    local_label="${entry%%:*}"
    target_name="${entry#*:}"
    if is_owned_container "${target_name}" && [[ "$(docker inspect -f '{{.State.Running}}' "${target_name}")" == "true" ]]; then
      echo "${local_label}：运行中且归属正确"
    else
      echo "${local_label}：未运行"
    fi
  done
  [[ -f "${state_root}/fixture.json" ]] && node -e '
    const value = require(process.argv[1]);
    console.log(`Base=${value.baseCommit}`);
    console.log(`Head=${value.headCommit}`);
  ' "${state_root}/fixture.json"
}

inspect_resources() {
  require_owned_state
  is_owned_container || { echo "隔离数据库未运行。" >&2; return 1; }
  docker exec "${container_name}" psql -U "${database_user}" -d "${database_name}" -Atc \
    "select 'runs='||count(*) from content_pr_import_runs;
     select 'items='||count(*) from content_pr_import_items;
     select 'drafts='||count(*) from drafts;
     select 'formal_revisions='||count(*) from article_revisions;
     select 'external_actions='||count(*) from content_pr_external_actions;"
  echo "Mock 外部动作（仅本地）："
  sed -n '1,20p' "${state_root}/external-actions.jsonl"
}

case "${action}" in
  start) start_resources ;;
  status) show_status ;;
  inspect) inspect_resources ;;
  stop) stop_resources ;;
  *)
    echo "用法：$0 {start|status|inspect|stop}" >&2
    exit 2
    ;;
esac
