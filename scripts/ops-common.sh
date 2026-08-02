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

ops_resolve_command() {
  local command_name="$1"
  shift
  local resolved candidate
  resolved="$(command -v "$command_name" 2>/dev/null || true)"
  if [ -n "$resolved" ]; then
    printf '%s' "$resolved"
    return 0
  fi
  for candidate in "$@"; do
    if [[ "$candidate" = /* ]] && [ -f "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
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

ops_active_image_tag() {
  local state_file="$OPS_REPOSITORY_ROOT/.deploy/current"
  local image_tag=""

  if [ -e "$state_file" ]; then
    [ -f "$state_file" ] && [ ! -L "$state_file" ] \
      || ops_die "部署状态不是安全普通文件，拒绝选择运维镜像"
    image_tag="$(awk -F= '$1 == "commit" { print $2; exit }' "$state_file")"
    [[ "$image_tag" =~ ^[0-9a-f]{40}$ ]] \
      || ops_die "部署状态中的 commit 无效，拒绝选择运维镜像"
    git -C "$OPS_REPOSITORY_ROOT" cat-file -e "${image_tag}^{commit}" 2>/dev/null \
      || ops_die "部署状态中的 commit 不存在于当前 Git 历史"
  else
    image_tag="$(ops_required_compose_env APP_IMAGE_TAG)"
    [[ "$image_tag" =~ ^[0-9a-f]{40}$ ]] \
      || ops_die "APP_IMAGE_TAG 必须是已发布镜像的完整 40 位小写 Commit SHA"
  fi

  printf '%s' "$image_tag"
}

ops_export_active_image_tag() {
  APP_IMAGE_TAG="$(ops_active_image_tag)"
  export APP_IMAGE_TAG
}

ops_compose_service_is_running() {
  local service_name="$1"
  local container_ids
  container_ids="$(docker compose ps --quiet --status running "$service_name")" || return 1
  [ -n "$container_ids" ]
}

ops_config_value() {
  local key="$1"
  local fallback="$2"
  local value="${!key:-}"

  if [ -z "$value" ]; then
    value="$(ops_compose_env "$key")"
  fi
  printf '%s' "${value:-$fallback}"
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

  local account_home=""
  if command -v getent >/dev/null 2>&1; then
    account_home="$(getent passwd "$EUID" 2>/dev/null | awk -F: 'NR == 1 { print $6 }')"
  fi
  if [ -n "$account_home" ] && [[ "$account_home" = /* ]]; then
    account_home="$(realpath -m -- "$account_home")"
    [ "$resolved" != "$account_home" ] || ops_die "${label} 不得直接使用当前账号 Home 根"
  fi

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

ops_assert_owned_directory() {
  local label="$1"
  local path="$2"
  local owner mode

  [ -d "$path" ] || ops_die "${label} 不是目录：${path}"
  [ ! -L "$path" ] || ops_die "${label} 不得是符号链接：${path}"
  owner="$(stat -c '%u' "$path")"
  [ "$owner" = "$EUID" ] \
    || ops_die "${label} 属主错误：期望 UID ${EUID}，实际 ${owner}"
  mode="$(stat -c '%a' "$path")"
  case "$mode" in
    700|750) ;;
    *) ops_die "${label} 权限必须为 0700 或 0750，实际为 ${mode}" ;;
  esac
}

ops_available_bytes() {
  df --output=avail -B1 -- "$1" | awk 'NR == 2 { print $1 }'
}

ops_validate_nonnegative_integer() {
  local label="$1"
  local value="$2"
  [[ "$value" =~ ^[0-9]+$ ]] || ops_die "${label} 必须是非负整数"
}
