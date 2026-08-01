#!/usr/bin/env bash

set -Eeuo pipefail

action="${1:-status}"
container_name="vinci-v2-phase9-manual-test-db"
application_container_name="vinci-v2-phase9-manual-test-app"
rollback_container_name="vinci-v2-phase9-manual-test-rollback-app"
mock_container_name="vinci-v2-phase9-manual-test-mock"
worker_container_name="vinci-v2-phase9-manual-test-export-worker"
database_name="vinci_v2_phase9_manual_test"
database_user="phase9_manual_test"
database_password="phase9_manual_test_only"
database_port="55462"
application_port="34172"
mock_port="34173"
rollback_port="34174"
state_root="/tmp/vinci-v2-phase9-manual-test"
resource_label="com.sdutvinci.scope=v2-phase9-manual-test"
database_url="postgresql://${database_user}:${database_password}@127.0.0.1:${database_port}/${database_name}"
repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

is_owned_container() {
  local target_name="${1:-${container_name}}"
  [[ "$(docker inspect -f '{{ index .Config.Labels "com.sdutvinci.scope" }}' "${target_name}" 2>/dev/null || true)" == "v2-phase9-manual-test" ]]
}

require_owned_state() {
  [[ -f "${state_root}/.vinci-v2-phase9-manual-test" ]] || {
    echo "找不到阶段 9 人工验收归属标记，拒绝操作 ${state_root}。" >&2
    return 1
  }
}

stop_resources() {
  [[ ! -e "${state_root}" ]] || require_owned_state
  for target_name in "${worker_container_name}" "${application_container_name}" "${rollback_container_name}" "${mock_container_name}" "${container_name}"; do
    if docker inspect "${target_name}" >/dev/null 2>&1; then
      is_owned_container "${target_name}" || { echo "拒绝删除不属于阶段 9 的同名容器。" >&2; return 1; }
      docker rm -f "${target_name}" >/dev/null
    fi
  done
  if [[ -d "${state_root}" ]]; then
    require_owned_state
    rm -rf -- "${state_root}"
  fi
  echo "阶段 9 隔离数据库、应用和临时状态已精确清理。"
}

wait_for_database() {
  for _ in $(seq 1 30); do
    docker exec "${container_name}" pg_isready -U "${database_user}" -d "${database_name}" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

wait_for_app() {
  local target_port="${1:-${application_port}}"
  for _ in $(seq 1 60); do
    curl --fail --silent --output /dev/null "http://127.0.0.1:${target_port}/team" && return 0
    sleep 1
  done
  return 1
}

wait_for_legacy_app() {
  for _ in $(seq 1 60); do
    curl --fail --silent "http://127.0.0.1:${rollback_port}/team/wangziming" \
      | grep -q '王子铭' && return 0
    sleep 1
  done
  return 1
}

start_rollback_app() {
  mkdir -p "${state_root}/legacy-runtime-root"
  docker run -d --name "${rollback_container_name}" --label "${resource_label}" --network host \
    -v "${repository_root}:${repository_root}:ro" -v "${state_root}:${state_root}" \
    -w "${state_root}/legacy-runtime-root" \
    -e NODE_ENV=test -e "DATABASE_URL=${database_url}" -e NITRO_HOST=127.0.0.1 -e "NITRO_PORT=${rollback_port}" \
    -e "NITRO_CONTENT_DATABASE_FILENAME=${state_root}/legacy-runtime-root/contents.sqlite" \
    -e "NUXT_PUBLIC_SITE_URL=http://127.0.0.1:${rollback_port}" \
    -e CMS_AUTH_SECRET=phase9-manual-rollback-secret-32-bytes-minimum -e CMS_SECURE_COOKIES=false \
    -e "CMS_CONTENT_ROOT=${repository_root}/content" -e CONTENT_CANDIDATE_ENV=test \
    -e CONTENT_PUBLISH_MODE=database -e CONTENT_SOURCE_NEWS=database -e CONTENT_SOURCE_WIKI=database \
    -e CONTENT_SOURCE_MEMBERS=legacy_git -e CONTENT_EXPORT_MODE=disabled -e CONTENT_PR_IMPORT_MODE=disabled \
    -e S3_ENDPOINT=http://127.0.0.1:1 -e S3_REGION=phase9-test -e S3_BUCKET=phase9-test \
    -e S3_ACCESS_KEY_ID=phase9-test -e S3_SECRET_ACCESS_KEY=phase9-test \
    -e S3_PUBLIC_BASE_URL=http://127.0.0.1:1/phase9-test \
    node:24-bookworm-slim node "${repository_root}/.output/server/index.mjs" >/dev/null
  wait_for_legacy_app
}

restart_rollback_app() {
  require_owned_state
  if docker inspect "${rollback_container_name}" >/dev/null 2>&1; then
    is_owned_container "${rollback_container_name}" || { echo "拒绝删除不属于阶段 9 的回退容器。" >&2; return 1; }
    docker rm -f "${rollback_container_name}" >/dev/null
  fi
  rm -rf -- "${state_root}/legacy-runtime-root"
  start_rollback_app
  echo "legacy Git 回退站点已保留现有验收数据并重启：http://127.0.0.1:${rollback_port}/team"
}

wait_for_exports() {
  local job_counts pending_or_processing failed
  for _ in $(seq 1 60); do
    job_counts="$(docker exec "${container_name}" psql -U "${database_user}" -d "${database_name}" -Atc \
      "select count(*) filter (where status in ('pending', 'processing'))||':'||count(*) filter (where status='failed') from content_export_jobs;")"
    pending_or_processing="${job_counts%%:*}"
    failed="${job_counts##*:}"
    if [[ "${pending_or_processing}" == "0" ]]; then
      [[ "${failed}" == "0" ]] || { echo "成员导出 Worker 产生 ${failed} 个失败任务。" >&2; return 1; }
      return 0
    fi
    sleep 1
  done
  return 1
}

start_resources() {
  if docker inspect "${container_name}" >/dev/null 2>&1 || docker inspect "${application_container_name}" >/dev/null 2>&1 || docker inspect "${rollback_container_name}" >/dev/null 2>&1 || docker inspect "${mock_container_name}" >/dev/null 2>&1 || docker inspect "${worker_container_name}" >/dev/null 2>&1 || [[ -e "${state_root}" ]]; then
    echo "阶段 9 人工验收资源已存在；请先核对并运行 $0 stop。" >&2
    return 1
  fi
  if ss -ltn | awk '{print $4}' | grep -Eq ":(${database_port}|${application_port}|${mock_port}|${rollback_port})$"; then
    echo "阶段 9 验收端口已占用，拒绝复用。" >&2
    return 1
  fi
  mkdir -m 700 "${state_root}"
  : >"${state_root}/.vinci-v2-phase9-manual-test"
  trap 'stop_resources' ERR INT TERM
  docker run -d --name "${container_name}" --label "${resource_label}" \
    -e "POSTGRES_DB=${database_name}" -e "POSTGRES_USER=${database_user}" \
    -e "POSTGRES_PASSWORD=${database_password}" -p "127.0.0.1:${database_port}:5432" \
    postgres:17-bookworm >/dev/null
  wait_for_database
  cd -- "${repository_root}"
  env -u TEST_DATABASE_URL DATABASE_URL="${database_url}" CMS_CONTENT_ROOT="${repository_root}/content" PHASE9_MANUAL_STATE_ROOT="${state_root}" \
    ./node_modules/.bin/tsx scripts/v2-phase9-manual-fixture.ts
  NUXT_PUBLIC_SITE_URL="http://127.0.0.1:${application_port}" npm run build
  docker run -d --name "${mock_container_name}" --label "${resource_label}" --network host \
    -v "${repository_root}:${repository_root}:ro" -v "${state_root}:${state_root}" -w "${repository_root}" \
    -e NODE_ENV=test -e "PHASE9_MANUAL_STATE_ROOT=${state_root}" -e "PHASE9_MANUAL_MOCK_PORT=${mock_port}" \
    -e CONTENT_PR_IMPORT_GITHUB_TOKEN=phase9-local-mock-token \
    node:24-bookworm-slim ./node_modules/.bin/tsx scripts/v2-phase9-mock-github.ts >/dev/null
  for _ in $(seq 1 60); do
    curl --fail --silent --output /dev/null "http://127.0.0.1:${mock_port}/health" && break
    sleep 1
  done
  curl --fail --silent --output /dev/null "http://127.0.0.1:${mock_port}/health"
  docker run -d --name "${application_container_name}" --label "${resource_label}" --network host \
    -v "${repository_root}:${repository_root}:ro" -w "${repository_root}" \
    -e NODE_ENV=test -e "DATABASE_URL=${database_url}" -e NITRO_HOST=127.0.0.1 -e "NITRO_PORT=${application_port}" \
    -e "NUXT_PUBLIC_SITE_URL=http://127.0.0.1:${application_port}" \
    -e CMS_AUTH_SECRET=phase9-manual-test-secret-32-bytes-minimum -e CMS_SECURE_COOKIES=false \
    -e "CMS_CONTENT_ROOT=${repository_root}/content" -e CONTENT_CANDIDATE_ENV=test \
    -e CONTENT_PUBLISH_MODE=database -e CONTENT_SOURCE_NEWS=database -e CONTENT_SOURCE_WIKI=database \
    -e CONTENT_SOURCE_MEMBERS=database -e CONTENT_EXPORT_MODE=disabled -e CONTENT_PR_IMPORT_MODE=enabled \
    -e CONTENT_PR_IMPORT_REPOSITORY_ID=SDUTVINCI/sdutvinci_content \
    -e "CONTENT_PR_IMPORT_API_URL=http://127.0.0.1:${mock_port}" \
    -e CONTENT_PR_IMPORT_GITHUB_TOKEN=phase9-local-mock-token \
    -e CONTENT_PR_IMPORT_ROLE_CODES=content_importer -e CONTENT_PR_IMPORT_TEST_MODE=true \
    -e S3_ENDPOINT=http://127.0.0.1:1 -e S3_REGION=phase9-test -e S3_BUCKET=phase9-test \
    -e S3_ACCESS_KEY_ID=phase9-test -e S3_SECRET_ACCESS_KEY=phase9-test \
    -e S3_PUBLIC_BASE_URL=http://127.0.0.1:1/phase9-test \
    node:24-bookworm-slim node .output/server/index.mjs >/dev/null
  wait_for_app "${application_port}"
  start_rollback_app
  docker run -d --name "${worker_container_name}" --label "${resource_label}" --network host \
    --user "$(id -u):$(id -g)" \
    -v "${repository_root}:${repository_root}:ro" -v "${state_root}:${state_root}" -w "${repository_root}" \
    -e NODE_ENV=test -e "DATABASE_URL=${database_url}" \
    -e CONTENT_REPOSITORY_ID=SDUTVINCI/sdutvinci_content -e CONTENT_EXPORT_MODE=enabled \
    -e "CONTENT_EXPORT_REMOTE_URL=${state_root}/content-remote.git" -e CONTENT_EXPORT_REMOTE=origin \
    -e CONTENT_EXPORT_BRANCH=main -e "CONTENT_EXPORT_WORKSPACE=${state_root}/export-workspace" \
    -e CONTENT_EXPORT_AUTHOR_NAME="Vinci Phase 9 Test Exporter" \
    -e CONTENT_EXPORT_AUTHOR_EMAIL=phase9-export@example.invalid -e CONTENT_EXPORT_BATCH_SIZE=50 \
    -e CONTENT_EXPORT_POLL_SECONDS=2 -e CONTENT_EXPORT_LEASE_SECONDS=30 -e CONTENT_EXPORT_MAX_ATTEMPTS=3 \
    -e CONTENT_EXPORT_RETRY_BASE_SECONDS=1 -e CONTENT_EXPORT_RETRY_MAX_SECONDS=2 \
    -e CONTENT_EXPORT_TEST_MODE=true -e "CMS_CONTENT_ROOT=${repository_root}/content" \
    -e "CMS_GIT_WORKTREE=${state_root}/legacy-cms-worktree-do-not-create" \
    node:24-bookworm ./node_modules/.bin/tsx scripts/v2-content-export-worker.ts >/dev/null
  wait_for_exports
  trap - ERR INT TERM
  echo "阶段 9 隔离 CMS：http://127.0.0.1:${application_port}/cms/login"
  echo "账号：phase9admin"
  echo "密码：Phase9Manual123!"
  echo "本地成员 PR：SDUTVINCI/sdutvinci_content #9（只连接本地裸 Git + mock API）"
  echo "legacy Git 回退站点：http://127.0.0.1:${rollback_port}/team"
}

show_status() {
  is_owned_container "${container_name}" && echo "隔离数据库：运行中且归属正确" || echo "隔离数据库：未运行"
  is_owned_container "${application_container_name}" && echo "隔离应用：运行中且归属正确" || echo "隔离应用：未运行"
  if is_owned_container "${rollback_container_name}"; then
    curl --fail --silent "http://127.0.0.1:${rollback_port}/team/wangziming" | grep -q '王子铭' \
      && echo "legacy Git 回退应用：运行中、归属正确且成员读取正常" \
      || echo "legacy Git 回退应用：运行中但成员读取异常"
  else
    echo "legacy Git 回退应用：未运行"
  fi
  is_owned_container "${mock_container_name}" && echo "mock GitHub：运行中且归属正确" || echo "mock GitHub：未运行"
  is_owned_container "${worker_container_name}" && echo "成员导出 Worker：运行中且归属正确" || echo "成员导出 Worker：未运行"
}

inspect_resources() {
  local database_member_hashes legacy_member_links repository_member_hashes repository_member_files snapshot_members
  require_owned_state
  is_owned_container "${container_name}" || { echo "隔离数据库未运行。" >&2; return 1; }
  docker exec "${container_name}" psql -U "${database_user}" -d "${database_name}" -Atc \
    "select 'members='||count(*) from members;
     select 'member_revisions='||count(*) from member_revisions;
     select 'pr_runs='||count(*) from content_pr_import_runs;
     select 'pr_items='||count(*) from content_pr_import_items;
     select 'pending_proposals='||count(*) from member_proposals where status='pending';
     select 'member_export_jobs='||count(*) from content_export_jobs where target_type='member';
     select 'member_export_jobs_'||status||'='||count(*) from content_export_jobs where target_type='member' group by status order by status;
     select 'bindings='||count(*) from user_members;"
  repository_member_files="$(git --git-dir="${state_root}/content-remote.git" ls-tree -r --name-only main -- members | wc -l | tr -d ' ')"
  snapshot_members="$(git --git-dir="${state_root}/content-remote.git" show main:.vinci/snapshot.json | node -e 'let input="";process.stdin.on("data",chunk=>input+=chunk).on("end",()=>console.log(JSON.parse(input).members.length))')"
  echo "repository_member_files=${repository_member_files}"
  echo "snapshot_members=${snapshot_members}"
  legacy_member_links="$(curl --fail --silent "http://127.0.0.1:${rollback_port}/team" \
    | grep -oE 'href="/team/[^"#?]+' | sort -u | wc -l | tr -d ' ')"
  echo "legacy_member_links=${legacy_member_links}"
  database_member_hashes="$(docker exec "${container_name}" psql -U "${database_user}" -d "${database_name}" -Atc \
    "select m.member_key||':'||r.content_hash from members m join member_revisions r on r.id=m.current_revision_id where m.deleted_at is null order by m.member_key;")"
  repository_member_hashes="$(git --git-dir="${state_root}/content-remote.git" show main:.vinci/snapshot.json | node -e 'let input="";process.stdin.on("data",chunk=>input+=chunk).on("end",()=>console.log(JSON.parse(input).members.map(item=>`${item.memberKey}:${item.sha256}`).sort().join("\n")))')"
  [[ "${database_member_hashes}" == "${repository_member_hashes}" ]] \
    && echo "repository_matches_database=yes" \
    || echo "repository_matches_database=no"
}

case "${action}" in
  start) start_resources ;;
  restart-rollback) restart_rollback_app ;;
  status) show_status ;;
  inspect) inspect_resources ;;
  stop) stop_resources ;;
  *) echo "用法：$0 {start|restart-rollback|status|inspect|stop}" >&2; exit 2 ;;
esac
