#!/usr/bin/env bash

set -Eeuo pipefail
# shellcheck source=scripts/ops-common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/ops-common.sh"

ops_require_command docker
ops_require_command realpath
ops_require_command sha256sum
ops_acquire_lock

cd -- "$OPS_REPOSITORY_ROOT"

backup_requested="${1:-}"
[ -n "$backup_requested" ] || ops_die "用法：RESTORE_CONFIRM='<项目>:<数据库>' ./scripts/restore.sh /绝对路径/备份目录"
backup_directory="$(ops_require_external_absolute_path 备份目录 "$backup_requested")"
[ -d "$backup_directory" ] || ops_die "备份目录不存在：${backup_directory}"
[ ! -L "$backup_directory" ] || ops_die "备份目录不得是符号链接"

for required_file in manifest.env postgresql.dump SHA256SUMS; do
  [ -f "${backup_directory}/${required_file}" ] \
    || ops_die "备份缺少文件：${required_file}"
done

(
  cd -- "$backup_directory"
  sha256sum --check --strict SHA256SUMS
)

format="$(awk -F= '$1 == "format" { print $2; exit }' "${backup_directory}/manifest.env")"
case "$format" in
  vinci-cms-backup-v1|vinci-cms-backup-v2) ;;
  *) ops_die "不支持的备份格式：${format:-未知}" ;;
esac

database="$(ops_required_compose_env POSTGRES_DB)"
database_user="$(ops_required_compose_env POSTGRES_USER)"
project="$(ops_project_name)"
ops_validate_identifier POSTGRES_DB "$database"
ops_validate_identifier POSTGRES_USER "$database_user"

expected_confirmation="${project}:${database}"
[ "${RESTORE_CONFIRM:-}" = "$expected_confirmation" ] \
  || ops_die "恢复会写入数据库。请设置精确确认令牌 RESTORE_CONFIRM='${expected_confirmation}'"

ops_postgres_container >/dev/null
ops_verify_postgres_identity "$database" "$database_user"

table_count="$(
  docker compose exec -T postgres sh -eu -c \
    'exec psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "select count(*) from pg_catalog.pg_tables where schemaname not in ('"'"'pg_catalog'"'"', '"'"'information_schema'"'"')"'
)"
table_count="${table_count//$'\r'/}"
table_count="${table_count//$'\n'/}"
[ "$table_count" = "0" ] \
  || ops_die "目标数据库不是空库（发现 ${table_count:-未知} 张用户表）；拒绝覆盖或清理现有数据"

docker compose exec -T postgres pg_restore --list \
  < "${backup_directory}/postgresql.dump" >/dev/null

source_database="$(awk -F= '$1 == "source_database" { print $2; exit }' "${backup_directory}/manifest.env")"
ops_info "确认目标为空，开始把备份数据库 ${source_database:-未知} 恢复到 ${database}..."
docker compose exec -T postgres \
  pg_restore --exit-on-error --no-owner --no-acl \
  "--username=${database_user}" "--dbname=${database}" \
  < "${backup_directory}/postgresql.dump"

ops_info "数据库恢复完成。请立即执行：docker compose --profile tools run --rm migrate"
ops_info "独立内容仓库检查清单仅供人工审查，不会自动覆盖数据库或内容仓库。"
ops_info "正常迁移必须使用本 PostgreSQL 备份；独立 snapshot 只用于受控灾难恢复入口。"
