#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
state_root=/tmp/vinci-phase11-manual-acceptance-test
checkout="$state_root/checkout-test"
marker="$state_root/.vinci-phase11-manual-test-owner"
ready="$state_root/.vinci-phase11-manual-test-ready"
project=vinci-phase11-manual-acceptance-test
app_port=48211
s3_port=48212
runtime_image=vinci-phase11-manual-runtime-test
operations_image=vinci-phase11-manual-operations-test

die() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

assert_owned_state() {
  [ -f "$marker" ] && [ ! -L "$marker" ] \
    && [ "$(cat "$marker")" = vinci-phase11-manual-acceptance-test ] \
    || die "隔离验收状态不存在或归属标记不匹配；不得猜测清理"
  [ "$(stat -c '%u' "$state_root")" = "$EUID" ] \
    || die "隔离验收状态不属于当前用户"
}

compose() {
  (cd -- "$checkout" && docker compose "$@")
}

cleanup_owned_state() {
  assert_owned_state
  if [ -f "$checkout/.env" ]; then
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  local commit=""
  commit="$(git -C "$checkout" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$commit" =~ ^[0-9a-f]{40}$ ]]; then
    docker image rm "${runtime_image}:${commit}" "${operations_image}:${commit}" \
      >/dev/null 2>&1 || true
  fi
  rm -rf -- "$state_root"
}

start_environment() {
  [ ! -e "$state_root" ] || die "隔离验收环境已存在；请让 Codex 先核对状态"
  [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=${project}")" ] \
    || die "发现同名 test Compose 资源，拒绝接管"
  if ss -ltn | awk '{ print $4 }' | grep -Eq ":(${app_port}|${s3_port})$"; then
    die "隔离验收回环端口已被占用"
  fi
  mkdir -m 0700 "$state_root"
  printf 'vinci-phase11-manual-acceptance-test\n' > "$marker"
  trap 'cleanup_owned_state' ERR INT TERM
  git clone --quiet --no-local "$repository_root" "$checkout"
  local commit
  commit="$(git -C "$checkout" rev-parse HEAD)"
  mkdir -m 0700 "$state_root/backups-test" "$state_root/instances-test"
  mkdir -m 0750 "$state_root/logs-test"
  {
    printf 'COMPOSE_PROJECT_NAME=%s\n' "$project"
    printf 'COMPOSE_FILE=compose.yaml:tests/fixtures/v2-phase11-isolation.compose.yaml:tests/fixtures/v2-phase11-s3.compose.yaml\n'
    printf 'APP_IMAGE=%s\nAPP_OPS_IMAGE=%s\nAPP_IMAGE_TAG=%s\n' \
      "$runtime_image" "$operations_image" "$commit"
    printf 'APP_BIND_ADDRESS=127.0.0.1\nAPP_PORT=%s\n' "$app_port"
    printf 'POSTGRES_DB=vinci_phase11_manual_test\n'
    printf 'POSTGRES_USER=vinci_phase11_manual_test\n'
    printf 'POSTGRES_PASSWORD=phase11-manual-test-only-password\n'
    printf 'DATABASE_URL=postgresql://vinci_phase11_manual_test:phase11-manual-test-only-password@postgres:5432/vinci_phase11_manual_test\n'
    printf 'NUXT_PUBLIC_SITE_URL=http://127.0.0.1:%s\n' "$app_port"
    printf 'CMS_AUTH_SECRET=phase11-manual-test-auth-secret-at-least-32-characters\n'
    printf 'CMS_SECURE_COOKIES=false\nCONTENT_PUBLISH_MODE=database\n'
    printf 'S3_ENDPOINT=http://s3-test:45519\nS3_REGION=phase11-manual-test\n'
    printf 'S3_BUCKET=phase11-manual-test-bucket\n'
    printf 'S3_ACCESS_KEY_ID=phase11-manual-test-access\n'
    printf 'S3_SECRET_ACCESS_KEY=phase11-manual-test-secret\n'
    printf 'S3_PUBLIC_BASE_URL=http://s3-test:45519/phase11-manual-test-bucket\n'
    printf 'S3_FORCE_PATH_STYLE=true\nS3_TEST_PORT=%s\n' "$s3_port"
    printf 'BACKUP_ROOT=%s/backups-test\n' "$state_root"
    printf 'INSTANCE_EXPORT_ROOT=%s/instances-test\n' "$state_root"
    printf 'VINCI_LOG_ROOT=%s/logs-test\n' "$state_root"
    printf 'DEPLOY_GIT_REMOTE_URL=%s\nAUTO_DEPLOY_ENABLED=false\n' "$repository_root"
    printf 'DEPLOY_CACHE_CLEANUP_ENABLED=false\n'
  } > "$checkout/.env"
  chmod 0600 "$checkout/.env"

  compose build app-blue migrate
  compose up --detach --wait postgres s3-test
  compose --profile tools run --rm migrate
  compose up --detach --wait app-blue gateway
  mkdir -m 0700 "$checkout/.deploy"
  printf 'commit=%s\nimage=%s:%s\nslot=blue\nmode=application\n' \
    "$commit" "$runtime_image" "$commit" > "$checkout/.deploy/current"
  (
    cd -- "$checkout"
    ./vinci install --dry-run
    VINCI_OPERATIONS_TEST_MODE=true ./vinci doctor
    ./vinci backup --verify
  ) > "$state_root/preparation-report-test.log"
  printf 'ready\n' > "$ready"
  trap - ERR INT TERM
  printf '阶段 11 隔离人工验收环境已就绪：project=%s，资源均带 test 名称与 cn.vinci.test 标签。\n' "$project"
  printf '未输出数据库 URL、Token、私钥或破坏性命令。\n'
}

verify_environment() {
  assert_owned_state
  [ -f "$ready" ] && [ "$(cat "$ready")" = ready ] || die "隔离验收环境尚未准备完成"
  (
    cd -- "$checkout"
    ./vinci install --dry-run >/dev/null
    VINCI_OPERATIONS_TEST_MODE=true ./vinci status >/dev/null
    VINCI_OPERATIONS_TEST_MODE=true ./vinci doctor >/dev/null
    ./vinci backup --verify >/dev/null
  )
  printf 'PASS：当前登录用户 Dry Run、动态 systemd、status、doctor、备份与完整性校验均通过。\n'
  printf 'PASS：应用、PostgreSQL 与 S3 替身只使用回环端口和隔离 test 资源；未接触生产。\n'
  printf 'PASS：自动恢复/迁移/蓝绿/安全结果见阶段 11 验收文档，人工项仍等待维护者确认。\n'
}

status_environment() {
  assert_owned_state
  if [ -f "$ready" ]; then
    printf 'ready：%s\n' "$project"
  else
    printf 'preparing：%s\n' "$project"
  fi
  compose ps --format json \
    | node -e 'let value="";process.stdin.on("data",c=>value+=c);process.stdin.on("end",()=>{for(const row of JSON.parse(value||"[]"))console.log(`${row.Service}: ${row.State} ${row.Health||""}`.trim())})'
}

case "${1:-}" in
  start) start_environment ;;
  verify) verify_environment ;;
  status) status_environment ;;
  stop) cleanup_owned_state ;;
  *)
    printf '用法：%s {start|verify|status|stop}\n' "$0" >&2
    exit 2
    ;;
esac
