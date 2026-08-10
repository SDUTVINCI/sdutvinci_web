#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
container_name="vinci-cms-local-test-postgres"
app_container_name="vinci-cms-local-test-app"
s3_container_name="vinci-cms-local-test-s3"
runtime_image="vinci-cms-local-test-runtime:test"
container_label_key="com.sdutvinci.scope"
container_label_value="cms-local-test"
database_name="vinci_cms_local_test"
database_user="vinci_local_test"
database_password="vinci-local-test-password"
database_port="${CMS_LOCAL_TEST_DATABASE_PORT:-55439}"
app_port="${CMS_LOCAL_TEST_APP_PORT:-3300}"
s3_port="${CMS_LOCAL_TEST_S3_PORT:-5901}"
state_root="/tmp/vinci-cms-local-test-${UID}"
state_marker="${state_root}/owner"
content_root="${CMS_LOCAL_TEST_CONTENT_ROOT:-$(dirname -- "$repository_root")/sdutvinci_content}"
database_url="postgresql://${database_user}:${database_password}@127.0.0.1:${database_port}/${database_name}"
auth_secret="cms-local-test-secret-with-at-least-32-characters"

die() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

assert_state_root() {
  [ -d "$state_root" ] && [ ! -L "$state_root" ] || die "测试状态目录无效：${state_root}"
  [ -f "$state_marker" ] && [ ! -L "$state_marker" ] || die "缺少测试环境归属标记"
  [ "$(cat -- "$state_marker")" = 'vinci-cms-local-test' ] || die "测试环境归属标记不匹配"
}

container_is_owned() {
  local target="$1"
  [ "$(docker inspect --format "{{ index .Config.Labels \"${container_label_key}\" }}" "$target" 2>/dev/null || true)" = "$container_label_value" ]
}

server_is_running() {
  [ "$(docker inspect --format '{{.State.Running}}' "$app_container_name" 2>/dev/null || true)" = 'true' ]
  container_is_owned "$app_container_name"
}

start_environment() {
  command -v docker >/dev/null || die '缺少 docker'
  command -v npm >/dev/null || die '缺少 npm'
  [ -x "$repository_root/node_modules/.bin/tsx" ] || die '依赖未安装，请先运行 npm ci'
  [ -d "$content_root/.git" ] && [ -d "$content_root/news" ] \
    && [ -d "$content_root/wiki" ] && [ -d "$content_root/members" ] \
    || die "独立内容仓库无效：${content_root}"
  [ -z "$(git -C "$content_root" status --porcelain)" ] || die '独立内容仓库工作区不干净，拒绝导入'

  if [ -e "$state_root" ]; then
    assert_state_root
    if server_is_running && container_is_owned "$container_name"; then
      printf '测试环境已经运行：http://127.0.0.1:%s/cms/login\n' "$app_port"
      return 0
    fi
    die "发现未完整运行的旧测试环境，请先执行 $0 stop"
  fi
  docker inspect "$container_name" >/dev/null 2>&1 \
    && die "已存在同名容器，拒绝覆盖：${container_name}"
  docker inspect "$app_container_name" >/dev/null 2>&1 \
    && die "已存在同名容器，拒绝覆盖：${app_container_name}"
  docker inspect "$s3_container_name" >/dev/null 2>&1 \
    && die "已存在同名容器，拒绝覆盖：${s3_container_name}"

  install -d -m 0700 "$state_root"
  printf 'vinci-cms-local-test\n' > "$state_marker"
  trap 'printf "启动失败；请执行 %s stop 清理隔离资源\n" "$0" >&2' ERR

  docker run --name "$container_name" \
    --label "${container_label_key}=${container_label_value}" \
    -e "POSTGRES_DB=${database_name}" \
    -e "POSTGRES_USER=${database_user}" \
    -e "POSTGRES_PASSWORD=${database_password}" \
    -p "127.0.0.1:${database_port}:5432" \
    -d postgres:17-bookworm >/dev/null

  docker run --name "$s3_container_name" \
    --label "${container_label_key}=${container_label_value}" \
    -e MINIO_ROOT_USER=vinci-local-test \
    -e MINIO_ROOT_PASSWORD=vinci-local-test-password \
    -p "127.0.0.1:${s3_port}:9000" \
    -d minio/minio server /data >/dev/null

  local attempt
  for attempt in $(seq 1 30); do
    if docker exec "$container_name" pg_isready -U "$database_user" -d "$database_name" >/dev/null 2>&1; then
      break
    fi
    [ "$attempt" -lt 30 ] || die '隔离 PostgreSQL 未在 30 秒内就绪'
    sleep 1
  done

  for attempt in $(seq 1 30); do
    if curl --fail --silent --output /dev/null "http://127.0.0.1:${s3_port}/minio/health/live"; then break; fi
    [ "$attempt" -lt 30 ] || die '隔离 S3 未在 30 秒内就绪'
    sleep 1
  done
  docker run --rm --network host --entrypoint /bin/sh minio/mc -c \
    "mc alias set local http://127.0.0.1:${s3_port} vinci-local-test vinci-local-test-password >/dev/null && mc mb --ignore-existing local/vinci-local-test >/dev/null && mc anonymous set download local/vinci-local-test >/dev/null"

  (
    cd -- "$repository_root"
    DATABASE_URL="$database_url" CMS_AUTH_SECRET="$auth_secret" npm run db:migrate
    DATABASE_URL="$database_url" CMS_AUTH_SECRET="$auth_secret" \
      CMS_CONTENT_ROOT="$content_root" ./node_modules/.bin/tsx scripts/cms-local-test-fixture.ts
  )

  docker build --target runtime --tag "$runtime_image" "$repository_root" >/dev/null
  docker run --name "$app_container_name" \
    --label "${container_label_key}=${container_label_value}" \
    --network host \
    --user "${UID}:$(id -g)" \
    --read-only \
    --tmpfs /tmp:rw,nosuid,nodev,size=256m \
    -e HOME=/tmp \
    -e DATABASE_URL="$database_url" \
    -e CMS_AUTH_SECRET="$auth_secret" \
    -e CMS_SECURE_COOKIES=false \
    -e NUXT_PUBLIC_SITE_URL="http://127.0.0.1:${app_port}" \
    -e S3_ENDPOINT="http://127.0.0.1:${s3_port}" \
    -e S3_REGION=local-test \
    -e S3_BUCKET=vinci-local-test \
    -e S3_ACCESS_KEY_ID=vinci-local-test \
    -e S3_SECRET_ACCESS_KEY=vinci-local-test-password \
    -e S3_PUBLIC_BASE_URL="http://127.0.0.1:${s3_port}/vinci-local-test" \
    -e S3_FORCE_PATH_STYLE=true \
    --volume "${repository_root}:/app:rw" \
    --workdir /app \
    -d "$runtime_image" \
    npm run dev -- --host 127.0.0.1 --port "$app_port" >/dev/null

  for attempt in $(seq 1 60); do
    if curl --fail --silent --output /dev/null "http://127.0.0.1:${app_port}/cms/login"; then
      trap - ERR
      printf '\n测试环境已启动：\n'
      printf '  地址：http://127.0.0.1:%s/cms/login\n' "$app_port"
      printf '  账号：testadmin\n'
      printf '  密码：VinciLocalTest!2026\n'
      printf '  日志：docker logs %s\n' "$app_container_name"
      return 0
    fi
    server_is_running || die "Nuxt 测试服务提前退出，请执行 docker logs ${app_container_name}"
    [ "$attempt" -lt 60 ] || die "Nuxt 测试服务未在 60 秒内就绪，请执行 docker logs ${app_container_name}"
    sleep 1
  done
}

stop_environment() {
  if [ -e "$state_root" ]; then
    assert_state_root
  fi
  if docker inspect "$app_container_name" >/dev/null 2>&1; then
    container_is_owned "$app_container_name" \
      || die "同名容器不属于本测试环境，拒绝删除：${app_container_name}"
    docker rm -f "$app_container_name" >/dev/null
  fi
  docker image inspect "$runtime_image" >/dev/null 2>&1 && docker image rm "$runtime_image" >/dev/null || true

  if docker inspect "$container_name" >/dev/null 2>&1; then
    container_is_owned "$container_name" \
      || die "同名容器不属于本测试环境，拒绝删除：${container_name}"
    docker rm -f "$container_name" >/dev/null
    printf '已删除隔离测试数据库；其中数据不可恢复。\n'
  fi

  if docker inspect "$s3_container_name" >/dev/null 2>&1; then
    container_is_owned "$s3_container_name" || die "同名 S3 容器不属于本测试环境，拒绝删除：${s3_container_name}"
    docker rm -f "$s3_container_name" >/dev/null
    printf '已删除隔离测试 S3；其中对象不可恢复。\n'
  fi

  if [ -e "$state_root" ]; then
    assert_state_root
    find "$state_root" -xdev -depth -mindepth 1 -delete
    rmdir -- "$state_root"
  fi
  printf '本地 CMS 测试环境已停止。\n'
}

show_status() {
  if [ ! -e "$state_root" ]; then
    printf '本地 CMS 测试环境未运行。\n'
    return 1
  fi
  assert_state_root
  server_is_running || die 'Nuxt 测试服务未运行'
  container_is_owned "$container_name" || die '隔离 PostgreSQL 未运行或归属不匹配'
  container_is_owned "$s3_container_name" || die '隔离 S3 未运行或归属不匹配'
  docker exec "$container_name" psql -U "$database_user" -d "$database_name" -Atc \
    "select 'articles=' || count(*) || ',members=' || (select count(*) from members) from articles;"
  printf 'URL=http://127.0.0.1:%s/cms/login\n' "$app_port"
}

case "${1:-start}" in
  start) [ "$#" -eq 1 ] || [ "$#" -eq 0 ] || die 'start 不接受额外参数'; start_environment ;;
  stop) [ "$#" -eq 1 ] || die 'stop 不接受额外参数'; stop_environment ;;
  restart) [ "$#" -eq 1 ] || die 'restart 不接受额外参数'; stop_environment; start_environment ;;
  status) [ "$#" -eq 1 ] || die 'status 不接受额外参数'; show_status ;;
  *) die "用法：$0 [start|stop|restart|status]" ;;
esac
