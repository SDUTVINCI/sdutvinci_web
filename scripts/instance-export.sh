#!/usr/bin/env bash

set -Eeuo pipefail
# shellcheck source=scripts/ops-common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/ops-common.sh"

ops_require_command cp
ops_require_command git
ops_require_command node
ops_require_command realpath
ops_require_command sha256sum

backup_directory=""
for argument in "$@"; do
  case "$argument" in
    --backup=*) backup_directory="${argument#*=}" ;;
    -h|--help)
      printf '用法：./vinci export-instance [--backup=/绝对路径/已校验备份]\n'
      exit 0
      ;;
    *) ops_die "export-instance 未知参数：${argument}" ;;
  esac
done

if [ -z "$backup_directory" ]; then
  "$OPS_REPOSITORY_ROOT/vinci" backup --verify
  backup_root="$(ops_config_value BACKUP_ROOT /var/backups/vinci-cms)"
  state_file="$backup_root/.vinci-state/latest-success.json"
  backup_name="$(node -e 'const f=require("fs");const v=JSON.parse(f.readFileSync(process.argv[1],"utf8"));if(v.status!=="succeeded"||!v.path)process.exit(2);process.stdout.write(v.path)' "$state_file")"
  backup_directory="$backup_root/$backup_name"
fi

backup_directory="$(ops_require_external_absolute_path 备份目录 "$backup_directory")"
[ -d "$backup_directory" ] && [ ! -L "$backup_directory" ] \
  || ops_die "备份目录不存在或不安全"
ops_assert_owned_directory 备份目录 "$backup_directory"
[ -f "$backup_directory/.vinci-backup-owner" ] \
  && [ -f "$backup_directory/.vinci-integrity-verified" ] \
  || ops_die "迁移包只接受带归属标记且已通过 ./vinci backup --verify 的备份"
(
  cd -- "$backup_directory"
  sha256sum --check --strict SHA256SUMS
)

ops_acquire_lock
instance_root_requested="$(ops_config_value INSTANCE_EXPORT_ROOT /var/backups/vinci-cms-instances)"
instance_root="$(ops_require_external_absolute_path INSTANCE_EXPORT_ROOT "$instance_root_requested")"
mkdir -p -- "$instance_root"
chmod 0700 "$instance_root"
ops_assert_owned_directory INSTANCE_EXPORT_ROOT "$instance_root"
root_marker="$instance_root/.vinci-instance-root"
if [ ! -e "$root_marker" ]; then
  printf 'vinci-instance-root-v1\n%s\n' "$(ops_project_name)" > "$root_marker"
  chmod 0600 "$root_marker"
fi
[ -f "$root_marker" ] && [ ! -L "$root_marker" ] \
  || ops_die "迁移包根归属标记不安全"
[ "$(sed -n '1p' "$root_marker")" = vinci-instance-root-v1 ] \
  && [ "$(sed -n '2p' "$root_marker")" = "$(ops_project_name)" ] \
  || ops_die "迁移包根不属于当前 Compose 项目"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
package_name="$(ops_project_name)-instance-${timestamp}"
package_directory="$instance_root/$package_name"
[ ! -e "$package_directory" ] || ops_die "迁移包目标已存在"
staging="$(mktemp -d "$instance_root/.vinci-instance.XXXXXX")"
cleanup() {
  local status=$?
  if [ -d "$staging" ] && [ -f "$staging/.vinci-instance-staging" ]; then
    rm -rf -- "$staging"
  fi
  rmdir -- "$OPS_LOCK_DIRECTORY" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT
printf 'vinci-instance-staging-v1\n' > "$staging/.vinci-instance-staging"
mkdir -m 0700 "$staging/database-backup"
cp -a -- "$backup_directory/." "$staging/database-backup/"

repository_commit="$(git -C "$OPS_REPOSITORY_ROOT" rev-parse HEAD)"
[[ "$repository_commit" =~ ^[0-9a-f]{40}$ ]] || ops_die "代码 Commit 无效"
git -C "$OPS_REPOSITORY_ROOT" bundle create "$staging/code-repository.bundle" HEAD
git bundle verify "$staging/code-repository.bundle" >/dev/null

current_state="$OPS_REPOSITORY_ROOT/.deploy/current"
active_commit=""
active_image=""
active_slot=""
if [ -f "$current_state" ] && [ ! -L "$current_state" ]; then
  active_commit="$(awk -F= '$1 == "commit" { print $2; exit }' "$current_state")"
  active_image="$(awk -F= '$1 == "image" { print $2; exit }' "$current_state")"
  active_slot="$(awk -F= '$1 == "slot" { print $2; exit }' "$current_state")"
fi

{
  printf 'format=vinci-instance-v1\n'
  printf 'created_at=%s\n' "$timestamp"
  printf 'source_host=%s\n' "$(hostname)"
  printf 'source_user=%s\nsource_uid=%s\nsource_gid=%s\n' "$(id -un)" "$EUID" "$(id -g)"
  printf 'compose_project=%s\n' "$(ops_project_name)"
  printf 'repository_commit=%s\n' "$repository_commit"
  printf 'active_commit=%s\nactive_image=%s\nactive_slot=%s\n' "$active_commit" "$active_image" "$active_slot"
  printf 'runtime_image_repository=%s\n' "$(ops_required_compose_env APP_IMAGE)"
  printf 'operations_image_repository=%s\n' "$(ops_required_compose_env APP_OPS_IMAGE)"
  printf 'database_backup=%s\n' "$(basename -- "$backup_directory")"
  printf 'content_repository_id=%s\n' "$(ops_compose_env CONTENT_REPOSITORY_ID)"
  printf 'content_repository_role=independent-snapshot-not-database-authority\n'
  printf 'object_storage_authority=S3-compatible\n'
  printf 'secret_material=in-separate-encrypted-store-not-in-package\n'
} > "$staging/instance-manifest.env"

{
  printf '# No secret values are stored in this instance package.\n'
  for key in DATABASE_URL POSTGRES_PASSWORD CMS_AUTH_SECRET S3_ACCESS_KEY_ID \
    S3_SECRET_ACCESS_KEY CONTENT_EXPORT_SSH_KEY_FILE \
    CONTENT_PR_IMPORT_GITHUB_TOKEN CONTENT_PR_BRANCH_CLEANUP_GITHUB_TOKEN; do
    if [ -n "$(ops_compose_env "$key")" ]; then
      printf '%s=set\n' "$key"
    else
      printf '%s=missing\n' "$key"
    fi
  done
} > "$staging/secret-rebuild-checklist.txt"
printf 'vinci-instance-v1\n%s\n' "$(ops_project_name)" > "$staging/.vinci-instance-owner"
rm -- "$staging/.vinci-instance-staging"
(
  cd -- "$staging"
  find . -type f ! -name SHA256SUMS -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum -- > SHA256SUMS
  sha256sum --check --strict SHA256SUMS
)
chmod -R go-rwx "$staging"
mv -- "$staging" "$package_directory"
ops_info "迁移包已创建并校验：${package_directory}"
ops_info "真实 .env、Token 和私钥未进入包；请通过独立加密通道传输密钥材料。"
