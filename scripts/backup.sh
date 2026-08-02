#!/usr/bin/env bash

set -Eeuo pipefail
# shellcheck source=scripts/ops-common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/ops-common.sh"

[ "$EUID" -ne 0 ] \
  || ops_die "不要使用 sudo/root 直接运行备份；请以执行 ./vinci install 的当前维护用户运行 ./vinci backup"

ops_require_command docker
ops_require_command git
ops_require_command realpath
ops_require_command sha256sum
ops_require_command stat
ops_require_command df
ops_acquire_lock

cd -- "$OPS_REPOSITORY_ROOT"

database="$(ops_required_compose_env POSTGRES_DB)"
database_user="$(ops_required_compose_env POSTGRES_USER)"
ops_validate_identifier POSTGRES_DB "$database"
ops_validate_identifier POSTGRES_USER "$database_user"
ops_postgres_container >/dev/null
ops_verify_postgres_identity "$database" "$database_user"

backup_root_requested="${BACKUP_ROOT:-$(ops_compose_env BACKUP_ROOT)}"
backup_root="$(ops_require_external_absolute_path BACKUP_ROOT "$backup_root_requested")"
mkdir -p -- "$backup_root"
chmod 0700 "$backup_root"
ops_assert_owned_directory BACKUP_ROOT "$backup_root"

state_root="${backup_root}/.vinci-state"
mkdir -p -- "$state_root"
chmod 0700 "$state_root"
ops_assert_owned_directory "备份状态目录" "$state_root"
state_marker="${state_root}/owner"
if [ ! -e "$state_marker" ]; then
  printf 'vinci-backup-state-v2\n%s\n' "$(ops_project_name)" > "$state_marker"
  chmod 0600 "$state_marker"
fi
[ -f "$state_marker" ] && [ ! -L "$state_marker" ] \
  || ops_die "备份状态归属标记不安全"
[ "$(sed -n '1p' "$state_marker")" = "vinci-backup-state-v2" ] \
  || ops_die "备份状态归属标记不匹配"
[ "$(sed -n '2p' "$state_marker")" = "$(ops_project_name)" ] \
  || ops_die "备份状态不属于当前 Compose 项目"

backup_min_free_bytes="$(ops_config_value BACKUP_MIN_FREE_BYTES 1073741824)"
backup_critical_free_bytes="$(ops_config_value BACKUP_CRITICAL_FREE_BYTES 536870912)"
ops_validate_nonnegative_integer BACKUP_MIN_FREE_BYTES "$backup_min_free_bytes"
ops_validate_nonnegative_integer BACKUP_CRITICAL_FREE_BYTES "$backup_critical_free_bytes"
[ "$backup_min_free_bytes" -ge "$backup_critical_free_bytes" ] \
  || ops_die "BACKUP_MIN_FREE_BYTES 不得小于 BACKUP_CRITICAL_FREE_BYTES"
available_bytes="$(ops_available_bytes "$backup_root")"
ops_validate_nonnegative_integer "磁盘剩余字节" "$available_bytes"
if [ "$available_bytes" -lt "$backup_critical_free_bytes" ]; then
  printf '{"at":"%s","code":"BACKUP_DISK_CRITICAL","availableBytes":%s,"thresholdBytes":%s}\n' \
    "$(date -u +%FT%TZ)" "$available_bytes" "$backup_critical_free_bytes" \
    >> "${state_root}/alerts.jsonl"
  ops_die "备份磁盘剩余空间低于保护阈值"
fi
if [ "$available_bytes" -lt "$backup_min_free_bytes" ]; then
  printf '{"at":"%s","code":"BACKUP_DISK_LOW","availableBytes":%s,"thresholdBytes":%s}\n' \
    "$(date -u +%FT%TZ)" "$available_bytes" "$backup_min_free_bytes" \
    >> "${state_root}/alerts.jsonl"
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
project="$(ops_project_name)"
final_directory="${backup_root}/${project}-${timestamp}"
[ ! -e "$final_directory" ] || ops_die "备份目标已存在：${final_directory}"
staging_directory="$(mktemp -d "${backup_root}/.vinci-backup.XXXXXX")"
backup_completed=false
cleanup_staging() {
  if [ -d "$staging_directory" ] \
    && [ "$(dirname -- "$staging_directory")" = "$backup_root" ] \
    && [ -f "${staging_directory}/.vinci-staging-owner" ]; then
    rm -rf -- "$staging_directory"
  fi
}
backup_exit() {
  local status="$?"
  cleanup_staging
  if [ "$status" -ne 0 ] && [ "$backup_completed" != true ]; then
    printf '{"at":"%s","code":"BACKUP_FAILED","status":%s}\n' \
      "$(date -u +%FT%TZ)" "$status" >> "${state_root}/alerts.jsonl" 2>/dev/null || true
  fi
  rmdir -- "$OPS_LOCK_DIRECTORY" 2>/dev/null || true
}
trap backup_exit EXIT
chmod 0700 "$staging_directory"
printf 'vinci-backup-staging-v2\n' > "${staging_directory}/.vinci-staging-owner"
chmod 0600 "${staging_directory}/.vinci-staging-owner"

ops_info "使用 PostgreSQL pg_dump 创建自定义格式备份..."
backup_retry_attempts="$(ops_config_value BACKUP_RETRY_ATTEMPTS 3)"
backup_retry_delay_seconds="$(ops_config_value BACKUP_RETRY_DELAY_SECONDS 2)"
ops_validate_nonnegative_integer BACKUP_RETRY_ATTEMPTS "$backup_retry_attempts"
ops_validate_nonnegative_integer BACKUP_RETRY_DELAY_SECONDS "$backup_retry_delay_seconds"
[ "$backup_retry_attempts" -ge 1 ] || ops_die "BACKUP_RETRY_ATTEMPTS 必须至少为 1"
dump_succeeded=false
for ((attempt = 1; attempt <= backup_retry_attempts; attempt += 1)); do
  : > "${staging_directory}/postgresql.dump"
  if docker compose exec -T postgres \
    pg_dump --format=custom --compress=9 --no-owner --no-acl \
    "--username=${database_user}" "--dbname=${database}" \
    > "${staging_directory}/postgresql.dump"; then
    dump_succeeded=true
    break
  fi
  printf '{"at":"%s","code":"BACKUP_DUMP_RETRY","attempt":%s}\n' \
    "$(date -u +%FT%TZ)" "$attempt" >> "${state_root}/alerts.jsonl"
  [ "$attempt" -ge "$backup_retry_attempts" ] \
    || sleep "$backup_retry_delay_seconds"
done
if [ "$dump_succeeded" != true ]; then
  printf '{"at":"%s","code":"BACKUP_DUMP_FAILED","attempts":%s}\n' \
    "$(date -u +%FT%TZ)" "$backup_retry_attempts" >> "${state_root}/alerts.jsonl"
  ops_die "PostgreSQL 备份在重试后仍失败；旧备份未执行清理"
fi
docker compose exec -T postgres pg_restore --list \
  < "${staging_directory}/postgresql.dump" >/dev/null

repository_commit="$(git rev-parse HEAD)"
{
  printf 'format=vinci-cms-backup-v2\n'
  printf 'created_at=%s\n' "$timestamp"
  printf 'compose_project=%s\n' "$project"
  printf 'source_database=%s\n' "$database"
  printf 'source_database_user=%s\n' "$database_user"
  printf 'repository_commit=%s\n' "$repository_commit"
  printf 'markdown_authority=PostgreSQL\n'
  printf 'content_snapshot_role=readable-disaster-recovery-material\n'
  printf 'image_authority=S3-compatible-object-storage\n'
} > "${staging_directory}/manifest.env"

required_config=(
  NUXT_PUBLIC_SITE_URL DATABASE_URL POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD
  CMS_AUTH_SECRET CMS_SECURE_COOKIES S3_ENDPOINT S3_REGION S3_BUCKET
  S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_PUBLIC_BASE_URL
  CONTENT_REPOSITORY_ID CONTENT_EXPORT_MODE CONTENT_EXPORT_REMOTE_URL
  CONTENT_EXPORT_BRANCH CONTENT_EXPORT_SSH_KEY_FILE
  CONTENT_EXPORT_KNOWN_HOSTS_FILE CONTENT_RECONCILIATION_ROOT
  CONTENT_RECOVERY_MODE BACKUP_ROOT BACKUP_RETRY_ATTEMPTS
  BACKUP_RETRY_DELAY_SECONDS BACKUP_MIN_FREE_BYTES
  BACKUP_CRITICAL_FREE_BYTES BACKUP_RETENTION_DAILY_DAYS
  BACKUP_RETENTION_WEEKLY_WEEKS BACKUP_RETENTION_MONTHLY_MONTHS
  CONTENT_SNAPSHOT_RETENTION_DAYS RECONCILIATION_REPORT_RETENTION_DAYS
  RECONCILIATION_TEMP_RETENTION_DAYS
)
{
  printf '# Values are intentionally omitted. Back up the real .env separately in an encrypted secret store.\n'
  printf '# STATUS is set/missing according to the active Docker Compose environment.\n'
  for key in "${required_config[@]}"; do
    if [ -n "$(ops_compose_env "$key")" ]; then
      printf '%s=set\n' "$key"
    else
      printf '%s=missing\n' "$key"
    fi
  done
} > "${staging_directory}/config-checklist.txt"
cp -- "$OPS_REPOSITORY_ROOT/.env.example" "${staging_directory}/env.example"

{
  printf 'repository_id=%s\n' "$(ops_compose_env CONTENT_REPOSITORY_ID)"
  printf 'role=independent-readable-snapshot-and-controlled-recovery-material\n'
  printf 'backup=protect the independent remote and keep a verified git bundle separately\n'
  printf 'required=news,wiki,members,.vinci/snapshot.json,manifest.json\n'
} > "${staging_directory}/content-repository-checklist.txt"

(
  cd -- "$staging_directory"
  sha256sum -- postgresql.dump manifest.env config-checklist.txt env.example \
    content-repository-checklist.txt > SHA256SUMS
  sha256sum --check --quiet SHA256SUMS
)

chmod -R go-rwx "$staging_directory"
mv -- "$staging_directory" "$final_directory"
printf 'vinci-backup-v2\n%s\n' "$project" > "${final_directory}/.vinci-backup-owner"
chmod 0600 "${final_directory}/.vinci-backup-owner"
printf '{"status":"succeeded","completedAt":"%s","path":"%s","availableBytes":%s}\n' \
  "$(date -u +%FT%TZ)" "$(basename -- "$final_directory")" "$available_bytes" \
  > "${state_root}/latest-success.json"
chmod 0600 "${state_root}/latest-success.json"
backup_completed=true
ops_info "备份完成：${final_directory}"
