#!/usr/bin/env bash

set -Eeuo pipefail
# shellcheck source=scripts/ops-common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/ops-common.sh"

[ "$EUID" -ne 0 ] \
  || ops_die "不要使用 sudo 直接运行备份；请先执行 sudo -iu vinci-deploy，再运行 /opt/vinci-cms/scripts/backup.sh"

ops_require_command docker
ops_require_command git
ops_require_command realpath
ops_require_command sha256sum
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
[ ! -L "$backup_root" ] || ops_die "BACKUP_ROOT 不得是符号链接"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
project="$(ops_project_name)"
final_directory="${backup_root}/${project}-${timestamp}"
[ ! -e "$final_directory" ] || ops_die "备份目标已存在：${final_directory}"
staging_directory="$(mktemp -d "${backup_root}/.vinci-backup.XXXXXX")"
cleanup_staging() {
  rm -rf -- "$staging_directory"
}
trap 'cleanup_staging; rmdir -- "$OPS_LOCK_DIRECTORY" 2>/dev/null || true' EXIT
chmod 0700 "$staging_directory"

ops_info "使用 PostgreSQL pg_dump 创建自定义格式备份..."
docker compose exec -T postgres \
  pg_dump --format=custom --compress=9 --no-owner --no-acl \
  "--username=${database_user}" "--dbname=${database}" \
  > "${staging_directory}/postgresql.dump"
docker compose exec -T postgres pg_restore --list \
  < "${staging_directory}/postgresql.dump" >/dev/null

repository_commit="$(git rev-parse HEAD)"
{
  printf 'format=vinci-cms-backup-v1\n'
  printf 'created_at=%s\n' "$timestamp"
  printf 'compose_project=%s\n' "$project"
  printf 'source_database=%s\n' "$database"
  printf 'source_database_user=%s\n' "$database_user"
  printf 'repository_commit=%s\n' "$repository_commit"
  printf 'markdown_authority=GitHub\n'
  printf 'image_authority=S3-compatible-object-storage\n'
} > "${staging_directory}/manifest.env"

required_config=(
  NUXT_PUBLIC_SITE_URL DATABASE_URL POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD
  CMS_AUTH_SECRET CMS_SECURE_COOKIES CMS_GIT_REMOTE_URL CMS_GIT_BRANCH
  CMS_GIT_SSH_KEY_FILE CMS_GIT_KNOWN_HOSTS_FILE S3_ENDPOINT S3_REGION S3_BUCKET
  S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_PUBLIC_BASE_URL
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

git_worktree="/var/lib/vinci-cms/worktree"
app_service=""
state_file="$OPS_REPOSITORY_ROOT/.deploy/current"
if [ -f "$state_file" ] && [ ! -L "$state_file" ]; then
  active_slot="$(awk -F= '$1 == "slot" { print $2; exit }' "$state_file")"
  case "$active_slot" in
    blue|green) app_service="app-${active_slot}" ;;
    "") ;;
    *) ops_die "部署状态中的活动槽位无效" ;;
  esac
fi
if [ -z "$app_service" ]; then
  for candidate_service in app-blue app-green; do
    if [ -n "$(docker compose ps -q "$candidate_service")" ]; then
      app_service="$candidate_service"
      break
    fi
  done
fi
app_container=""
[ -z "$app_service" ] || app_container="$(docker compose ps -q "$app_service")"
if [ -n "$app_container" ] \
  && docker inspect --format '{{.State.Running}}' "$app_container" | grep -qx true \
  && docker compose exec -T --user node "$app_service" git -C "$git_worktree" rev-parse --is-inside-work-tree 2>/dev/null | grep -qx true; then
  configured_git_remote="$(ops_required_compose_env CMS_GIT_REMOTE_URL)"
  actual_git_remote="$(docker compose exec -T --user node "$app_service" git -C "$git_worktree" remote get-url origin | tr -d '\r')"
  [ "$actual_git_remote" = "$configured_git_remote" ] \
    || ops_die "CMS Git 工作区 origin 与配置不一致，拒绝备份错误目标"

  docker compose exec -T --user node "$app_service" git -C "$git_worktree" status --porcelain=v1 \
    > "${staging_directory}/cms-git-status.txt"
  docker compose exec -T --user node "$app_service" git -C "$git_worktree" rev-parse HEAD \
    > "${staging_directory}/cms-git-head.txt"
  docker compose exec -T --user node "$app_service" git -C "$git_worktree" diff --binary HEAD \
    > "${staging_directory}/cms-git-working-tree.patch"
  docker compose exec -T --user node "$app_service" git -C "$git_worktree" bundle create - --all \
    > "${staging_directory}/cms-git-refs.bundle"
  docker compose exec -T --user node "$app_service" sh -eu -c \
    'cd "$1"; git ls-files --others --exclude-standard -z | tar --null --files-from=- --create --gzip --file=-' \
    sh "$git_worktree" > "${staging_directory}/cms-git-untracked.tar.gz"
  git bundle list-heads "${staging_directory}/cms-git-refs.bundle" >/dev/null
else
  printf 'CMS Git worktree was not initialized or the app service was not running.\n' \
    > "${staging_directory}/cms-git-status.txt"
fi

(
  cd -- "$staging_directory"
  sha256sum -- * > SHA256SUMS
  sha256sum --check --quiet SHA256SUMS
)

chmod -R go-rwx "$staging_directory"
mv -- "$staging_directory" "$final_directory"
trap 'rmdir -- "$OPS_LOCK_DIRECTORY" 2>/dev/null || true' EXIT
ops_info "备份完成：${final_directory}"
