#!/usr/bin/env bash

set -Eeuo pipefail

action="${1:-status}"
container_name="vinci-v2-phase6-manual-test-db"
database_name="vinci_v2_phase6_manual_test"
database_user="phase6_manual_test"
database_password="phase6_manual_test_only"
database_port="55448"
application_port="34161"
state_root="/tmp/vinci-v2-phase6-manual-test"
resource_label="com.sdutvinci.scope=v2-phase6-manual-test"
database_url="postgresql://${database_user}:${database_password}@127.0.0.1:${database_port}/${database_name}"
repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
remote_path="${state_root}/content-remote.git"
workspace_path="${state_root}/content-workspace"

is_owned_container() {
  [[ "$(docker inspect -f '{{ index .Config.Labels "com.sdutvinci.scope" }}' \
    "${container_name}" 2>/dev/null || true)" == "v2-phase6-manual-test" ]]
}

require_owned_state() {
  [[ -f "${state_root}/.vinci-v2-phase6-manual-test" ]] || {
    echo "找不到阶段 6 人工验收归属标记，拒绝操作 ${state_root}。" >&2
    return 1
  }
}

require_running_resources() {
  is_owned_container && require_owned_state || {
    echo "阶段 6 人工验收资源未运行；先执行 $0 start。" >&2
    return 1
  }
}

stop_process() {
  local pid_file="$1"
  local expected_command="$2"
  [[ -f "${pid_file}" ]] || return 0
  local pid
  pid="$(<"${pid_file}")"
  if [[ "${pid}" =~ ^[0-9]+$ ]] && kill -0 "${pid}" 2>/dev/null; then
    local command_line
    command_line="$(tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null || true)"
    if [[ "${command_line}" == *"${expected_command}"* ]]; then
      kill "${pid}"
      for _ in $(seq 1 20); do
        kill -0 "${pid}" 2>/dev/null || break
        sleep 0.25
      done
    else
      echo "PID ${pid} 不属于阶段 6 的 ${expected_command}，拒绝停止。" >&2
      return 1
    fi
  fi
  rm -f -- "${pid_file}"
}

stop_resources() {
  if [[ -e "${state_root}" ]]; then
    require_owned_state
    stop_process "${state_root}/worker.pid" "v2-content-export-worker.ts"
    stop_process "${state_root}/application.pid" ".output/server/index.mjs"
  fi
  if docker inspect "${container_name}" >/dev/null 2>&1; then
    if ! is_owned_container; then
      echo "拒绝删除同名但不属于阶段 6 人工验收的容器。" >&2
      return 1
    fi
    docker rm -f "${container_name}" >/dev/null
  fi
  if [[ -d "${state_root}" ]]; then
    require_owned_state
    rm -rf -- "${state_root}"
  fi
  echo "阶段 6 人工验收数据库、Git 远端、工作区、日志和进程已精确清理。"
}

wait_for_database() {
  for _ in $(seq 1 30); do
    if docker exec "${container_name}" \
      pg_isready -U "${database_user}" -d "${database_name}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "阶段 6 人工验收数据库未就绪。" >&2
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
  echo "阶段 6 本地 HTTP 未就绪；请保留 ${state_root}/application.log。" >&2
  return 1
}

content_command() {
  local mode="$1"
  shift
  env -u TEST_DATABASE_URL \
    DATABASE_URL="${database_url}" \
    NODE_ENV=test \
    CONTENT_REPOSITORY_ID=SDUTVINCI/sdutvinci_content \
    CONTENT_EXPORT_MODE="${mode}" \
    CONTENT_EXPORT_REMOTE_URL="${remote_path}" \
    CONTENT_EXPORT_REMOTE=origin \
    CONTENT_EXPORT_BRANCH=main \
    CONTENT_EXPORT_WORKSPACE="${workspace_path}" \
    CONTENT_EXPORT_AUTHOR_NAME="Vinci Phase 6 Test Exporter" \
    CONTENT_EXPORT_AUTHOR_EMAIL="phase6-export@example.invalid" \
    CONTENT_EXPORT_BATCH_SIZE=50 \
    CONTENT_EXPORT_POLL_SECONDS=5 \
    CONTENT_EXPORT_LEASE_SECONDS=30 \
    CONTENT_EXPORT_MAX_ATTEMPTS=2 \
    CONTENT_EXPORT_RETRY_BASE_SECONDS=1 \
    CONTENT_EXPORT_RETRY_MAX_SECONDS=2 \
    CONTENT_EXPORT_TEST_MODE=true \
    CMS_CONTENT_ROOT="${repository_root}/content" \
    CMS_GIT_WORKTREE="${state_root}/legacy-cms-worktree-do-not-create" \
    "$@"
}

start_application() {
  require_owned_state
  stop_process "${state_root}/application.pid" ".output/server/index.mjs"
  nohup env -i \
    PATH="${PATH}" \
    NODE_ENV=production \
    DATABASE_URL="${database_url}" \
    NITRO_HOST=127.0.0.1 \
    NITRO_PORT="${application_port}" \
    NUXT_PUBLIC_SITE_URL="http://127.0.0.1:${application_port}" \
    CMS_AUTH_SECRET="phase6-manual-test-secret-32-bytes-minimum" \
    CMS_SECURE_COOKIES=false \
    CMS_CONTENT_ROOT="${repository_root}/content" \
    CMS_GIT_WORKTREE="${state_root}/legacy-cms-worktree-do-not-create" \
    CMS_GIT_REMOTE_URL="ssh://invalid.phase6.test/no-write-access" \
    CMS_GIT_REMOTE=origin \
    CMS_GIT_BRANCH=main \
    CMS_GIT_AUTHOR_NAME="Vinci Phase 6 Test" \
    CMS_GIT_AUTHOR_EMAIL="phase6@example.invalid" \
    CONTENT_PUBLISH_MODE=database \
    CONTENT_SOURCE_NEWS=database \
    CONTENT_SOURCE_WIKI=database \
    CONTENT_SOURCE_MEMBERS=legacy_git \
    CONTENT_CANDIDATE_ENV=production \
    CONTENT_EXPORT_MODE=disabled \
    CONTENT_EXPORT_WORKSPACE="${state_root}/application-unused-export-workspace" \
    S3_ENDPOINT="http://127.0.0.1:1" \
    S3_REGION=phase6-test \
    S3_BUCKET=phase6-test \
    S3_ACCESS_KEY_ID=phase6-test \
    S3_SECRET_ACCESS_KEY=phase6-test \
    S3_PUBLIC_BASE_URL="http://127.0.0.1:1/phase6-test" \
    node "${repository_root}/.output/server/index.mjs" \
      >"${state_root}/application.log" 2>&1 </dev/null &
  echo "$!" >"${state_root}/application.pid"
  wait_for_http
}

create_seed_repository() {
  local seed="${state_root}/content-seed"
  git init --initial-branch=main "${seed}" >/dev/null
  git -C "${seed}" config user.name "Vinci Phase 6 Seed"
  git -C "${seed}" config user.email "phase6-seed@example.invalid"
  mkdir "${seed}/content"
  cp -a "${repository_root}/content/." "${seed}/content/"
  git -C "${seed}" add content
  git -C "${seed}" commit -m "test: seed maintained content copy" >/dev/null
  git clone --bare "${seed}" "${remote_path}" >/dev/null
  git --git-dir="${remote_path}" config vinci.scope v2-phase6-manual-test
}

start_resources() {
  if docker inspect "${container_name}" >/dev/null 2>&1 || [[ -e "${state_root}" ]]; then
    echo "阶段 6 人工验收资源已存在；先核对后运行 $0 stop。" >&2
    return 1
  fi
  mkdir -m 700 "${state_root}"
  : >"${state_root}/.vinci-v2-phase6-manual-test"
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
    npm run cms:content:sync >/dev/null
  env -u TEST_DATABASE_URL \
    DATABASE_URL="${database_url}" \
    CMS_CONTENT_ROOT="${repository_root}/content" \
    npm run v2:revisions:backfill -- \
      --apply --confirm=BACKFILL_ARTICLE_REVISIONS >/dev/null
  create_seed_repository
  NUXT_PUBLIC_SITE_URL="http://127.0.0.1:${application_port}" npm run build
  start_application
  trap - ERR INT TERM
  echo "阶段 6 隔离应用：http://127.0.0.1:${application_port}"
  echo "下一步：$0 admin；随后由 Codex 执行 dry-run、接管和只读检查。"
}

create_admin() {
  require_running_resources
  cd -- "${repository_root}"
  env -u TEST_DATABASE_URL \
    DATABASE_URL="${database_url}" \
    CMS_AUTH_SECRET="phase6-manual-test-secret-32-bytes-minimum" \
    npm run cms:admin
}

takeover_dry_run() {
  require_running_resources
  [[ ! -e "${workspace_path}" ]] || {
    echo "接管前工作区已存在，拒绝覆盖；请保留证据并停止验收。" >&2
    return 1
  }
  cd -- "${repository_root}"
  content_command dry_run npm run v2:content:takeover --silent \
    >"${state_root}/takeover-dry-run.json"
  node -e '
    const report = require(process.argv[1])
    const counts = report.actions.reduce((result, item) => {
      result[item.action] = (result[item.action] || 0) + 1
      return result
    }, {})
    console.log(JSON.stringify({
      repositoryId: report.repositoryId,
      branch: report.branch,
      baseCommit: report.baseCommit,
      clean: report.clean,
      trackedFileCount: report.trackedFileCount,
      databaseFileCount: report.databaseFileCount,
      databaseDeletedCount: report.databaseDeletedCount,
      actionCounts: counts,
      preservedFileCount: report.preservedFiles.length,
      conflicts: report.conflicts,
      reportSha256: report.reportSha256,
      requiredConfirmation: report.requiredConfirmation
    }, null, 2))
  ' "${state_root}/takeover-dry-run.json"
  echo "Dry Run 完整报告：${state_root}/takeover-dry-run.json"
}

takeover_apply() {
  require_running_resources
  [[ -f "${state_root}/takeover-dry-run.json" ]] || {
    echo "缺少 Dry Run 报告；先执行 $0 takeover-dry-run。" >&2
    return 1
  }
  local confirmation
  confirmation="$(node -p \
    'require(process.argv[1]).requiredConfirmation' \
    "${state_root}/takeover-dry-run.json")"
  cd -- "${repository_root}"
  content_command enabled npm run v2:content:takeover --silent -- \
    --apply "--confirm=${confirmation}" \
    >"${state_root}/takeover-result.json"
  echo "测试内容仓库已按确认令牌逐项接管；结果：${state_root}/takeover-result.json"
}

start_worker() {
  require_running_resources
  [[ -f "${state_root}/takeover-result.json" ]] || {
    echo "必须先完成测试仓库接管。" >&2
    return 1
  }
  stop_process "${state_root}/worker.pid" "v2-content-export-worker.ts"
  cd -- "${repository_root}"
  nohup env -u TEST_DATABASE_URL \
    DATABASE_URL="${database_url}" \
    NODE_ENV=test \
    CONTENT_REPOSITORY_ID=SDUTVINCI/sdutvinci_content \
    CONTENT_EXPORT_MODE=enabled \
    CONTENT_EXPORT_REMOTE_URL="${remote_path}" \
    CONTENT_EXPORT_REMOTE=origin \
    CONTENT_EXPORT_BRANCH=main \
    CONTENT_EXPORT_WORKSPACE="${workspace_path}" \
    CONTENT_EXPORT_AUTHOR_NAME="Vinci Phase 6 Test Exporter" \
    CONTENT_EXPORT_AUTHOR_EMAIL="phase6-export@example.invalid" \
    CONTENT_EXPORT_BATCH_SIZE=50 \
    CONTENT_EXPORT_POLL_SECONDS=5 \
    CONTENT_EXPORT_LEASE_SECONDS=30 \
    CONTENT_EXPORT_MAX_ATTEMPTS=2 \
    CONTENT_EXPORT_RETRY_BASE_SECONDS=1 \
    CONTENT_EXPORT_RETRY_MAX_SECONDS=2 \
    CONTENT_EXPORT_TEST_MODE=true \
    CMS_CONTENT_ROOT="${repository_root}/content" \
    CMS_GIT_WORKTREE="${state_root}/legacy-cms-worktree-do-not-create" \
    ./node_modules/.bin/tsx scripts/v2-content-export-worker.ts \
    >"${state_root}/worker.log" 2>&1 </dev/null &
  echo "$!" >"${state_root}/worker.pid"
  echo "阶段 6 Worker 已启动，轮询间隔 5 秒。"
}

deny_remote() {
  require_running_resources
  local hook="${remote_path}/hooks/pre-receive"
  [[ "$(git --git-dir="${remote_path}" config --get vinci.scope)" == \
    "v2-phase6-manual-test" ]] || {
    echo "测试 Git 远端归属不正确，拒绝写入故障钩子。" >&2
    return 1
  }
  printf '%s\n' \
    '#!/bin/sh' \
    '# VINCI_V2_PHASE6_MANUAL_DENY' \
    'echo "phase6 isolated remote denies push" >&2' \
    'exit 1' >"${hook}"
  chmod 700 "${hook}"
  echo "测试内容远端现已拒绝 Push；网站数据库发布仍应成功。"
}

repair_remote() {
  require_running_resources
  local hook="${remote_path}/hooks/pre-receive"
  [[ -f "${hook}" ]] || {
    echo "测试内容远端当前没有故障钩子。"
    return 0
  }
  grep -qx '# VINCI_V2_PHASE6_MANUAL_DENY' "${hook}" || {
    echo "故障钩子归属不匹配，拒绝删除。" >&2
    return 1
  }
  rm -f -- "${hook}"
  echo "测试内容远端写权限已恢复；现在可在 CMS 点击“手动重试导出”。"
}

run_consistency() {
  require_running_resources
  cd -- "${repository_root}"
  content_command enabled npm run v2:phase6:consistency
}

inspect_repository() {
  require_running_resources
  git --git-dir="${remote_path}" log --oneline --decorate -8 main
  git -c core.quotePath=false --git-dir="${remote_path}" \
    ls-tree -r --name-only main |
    awk '
      /^news\// { news += 1 }
      /^wiki\// { wiki += 1 }
      /^content\/members\// { members += 1 }
      /^\.github\/workflows\// { workflows += 1 }
      END {
        printf "news=%d wiki=%d preserved_members=%d code_workflows=%d\n",
          news, wiki, members, workflows
      }
    '
  git --git-dir="${remote_path}" show main:.vinci/snapshot.json |
    node -e '
      let input = ""
      process.stdin.on("data", chunk => input += chunk)
      process.stdin.on("end", () => {
        const value = JSON.parse(input)
        console.log(JSON.stringify({
          formatVersion: value.formatVersion,
          files: value.files.length,
          tombstones: value.tombstones.length
        }))
      })
    '
  git --git-dir="${remote_path}" show main:manifest.json |
    node -e '
      let input = ""
      process.stdin.on("data", chunk => input += chunk)
      process.stdin.on("end", () => {
        const value = JSON.parse(input)
        console.log(JSON.stringify({
          formatVersion: value.formatVersion,
          snapshot: value.snapshot,
          files: value.files.length
        }))
      })
    '
}

show_status() {
  if is_owned_container; then
    echo "隔离数据库：运行中且归属正确"
  else
    echo "隔离数据库：未运行"
  fi
  for process_name in application worker; do
    if [[ -f "${state_root}/${process_name}.pid" ]] &&
      kill -0 "$(<"${state_root}/${process_name}.pid")" 2>/dev/null; then
      echo "${process_name}：运行中"
    else
      echo "${process_name}：未运行"
    fi
  done
  if [[ -d "${remote_path}" ]]; then
    echo "测试内容远端 HEAD：$(git --git-dir="${remote_path}" rev-parse main)"
  fi
}

run_smoke() {
  trap 'stop_resources' ERR INT TERM
  start_resources
  takeover_dry_run
  takeover_apply
  start_worker
  for _ in $(seq 1 20); do
    if kill -0 "$(<"${state_root}/worker.pid")" 2>/dev/null; then
      break
    fi
    sleep 0.25
  done
  curl --fail --silent --output /dev/null \
    "http://127.0.0.1:${application_port}/"
  kill -0 "$(<"${state_root}/worker.pid")"
  inspect_repository
  run_consistency
  deny_remote
  repair_remote
  stop_resources
  trap - ERR INT TERM
  echo "阶段 6 人工验收脚本冒烟生命周期通过；这不替代浏览器人工验收。"
}

case "${action}" in
  start) start_resources ;;
  admin) create_admin ;;
  takeover-dry-run) takeover_dry_run ;;
  takeover-apply) takeover_apply ;;
  worker) start_worker ;;
  deny-remote) deny_remote ;;
  repair-remote) repair_remote ;;
  consistency) run_consistency ;;
  inspect) inspect_repository ;;
  status) show_status ;;
  smoke) run_smoke ;;
  stop) stop_resources ;;
  *)
    echo "用法：$0 {start|admin|takeover-dry-run|takeover-apply|worker|deny-remote|repair-remote|consistency|inspect|status|smoke|stop}" >&2
    exit 2
    ;;
esac
