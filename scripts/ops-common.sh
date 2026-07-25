#!/usr/bin/env bash

set -Eeuo pipefail

OPS_REPOSITORY_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"

ops_die() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

ops_info() {
  printf '%s\n' "$*"
}

ops_require_command() {
  command -v "$1" >/dev/null 2>&1 || ops_die "缺少必需命令：$1"
}

ops_compose_env() {
  local key="$1"
  local line

  line="$(
    cd -- "$OPS_REPOSITORY_ROOT"
    docker compose config --environment 2>/dev/null | awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }'
  )"
  printf '%s' "$line"
}

ops_required_compose_env() {
  local key="$1"
  local value
  value="$(ops_compose_env "$key")"
  [ -n "$value" ] || ops_die ".env 中缺少 ${key}"
  printf '%s' "$value"
}

ops_validate_identifier() {
  local label="$1"
  local value="$2"
  [[ "$value" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] \
    || ops_die "${label} 只能包含字母、数字、下划线和短横线，且必须以字母或下划线开头"
}

ops_require_external_absolute_path() {
  local label="$1"
  local requested="$2"
  local resolved

  [ -n "$requested" ] || ops_die "${label} 不能为空"
  [[ "$requested" = /* ]] || ops_die "${label} 必须是绝对路径"
  resolved="$(realpath -m -- "$requested")"
  [ "$resolved" != "/" ] || ops_die "${label} 不得是根目录"

  case "$resolved/" in
    "$OPS_REPOSITORY_ROOT/"*)
      ops_die "${label} 必须位于项目目录之外"
      ;;
  esac

  printf '%s' "$resolved"
}

ops_project_name() {
  local project
  project="$(ops_compose_env COMPOSE_PROJECT_NAME)"
  printf '%s' "${project:-vinci-cms}"
}

ops_postgres_container() {
  local container
  container="$(
    cd -- "$OPS_REPOSITORY_ROOT"
    docker compose ps -q postgres
  )"
  [ -n "$container" ] || ops_die "PostgreSQL Compose 服务未运行"
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = "true" ] \
    || ops_die "PostgreSQL Compose 容器未运行"

  local expected_project
  expected_project="$(ops_project_name)"
  [ "$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container")" = "$expected_project" ] \
    || ops_die "PostgreSQL 容器不属于预期 Compose 项目 ${expected_project}"
  [ "$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$container")" = "postgres" ] \
    || ops_die "目标容器不是 postgres 服务"

  printf '%s' "$container"
}

ops_verify_postgres_identity() {
  local database="$1"
  local user="$2"
  local actual

  actual="$(
    cd -- "$OPS_REPOSITORY_ROOT"
    docker compose exec -T postgres sh -eu -c \
      'exec psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "select current_database() || chr(9) || current_user"'
  )"
  actual="${actual//$'\r'/}"
  actual="${actual//$'\n'/}"

  [ "$actual" = "${database}"$'\t'"${user}" ] \
    || ops_die "数据库目标校验失败：期望 ${database}/${user}，实际 ${actual:-未知}"
}

ops_acquire_lock() {
  OPS_LOCK_DIRECTORY="$OPS_REPOSITORY_ROOT/.deploy/operation.lock"
  mkdir -p -- "$OPS_REPOSITORY_ROOT/.deploy"
  if ! mkdir -- "$OPS_LOCK_DIRECTORY" 2>/dev/null; then
    ops_die "已有部署、备份或恢复操作正在执行：${OPS_LOCK_DIRECTORY}"
  fi
  trap 'rmdir -- "$OPS_LOCK_DIRECTORY" 2>/dev/null || true' EXIT
}
