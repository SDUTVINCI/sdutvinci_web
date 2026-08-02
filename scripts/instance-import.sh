#!/usr/bin/env bash

set -Eeuo pipefail
# shellcheck source=scripts/ops-common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/ops-common.sh"

ops_require_command git
ops_require_command realpath
ops_require_command sha256sum

package_requested="${1:-}"
confirmation_argument="${2:-}"
if [ "$#" -eq 1 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; }; then
  printf '用法：./vinci import-instance /绝对/迁移包 --confirm=IMPORT:<包名>:<项目>:<数据库>\n'
  exit 0
fi
[ "$#" -eq 2 ] && [[ "$confirmation_argument" = --confirm=* ]] \
  || ops_die "用法：./vinci import-instance /绝对/迁移包 --confirm=IMPORT:<包名>:<项目>:<数据库>"
package_directory="$(ops_require_external_absolute_path 迁移包 "$package_requested")"
[ -d "$package_directory" ] && [ ! -L "$package_directory" ] \
  || ops_die "迁移包目录不存在或不安全"
ops_assert_owned_directory 迁移包 "$package_directory"
[ -f "$package_directory/.vinci-instance-owner" ] \
  && [ ! -L "$package_directory/.vinci-instance-owner" ] \
  || ops_die "迁移包缺少安全归属标记"
for required in instance-manifest.env SHA256SUMS code-repository.bundle \
  secret-rebuild-checklist.txt database-backup; do
  [ -e "$package_directory/$required" ] || ops_die "迁移包缺少：$required"
done
if find "$package_directory" -xdev -type l -print -quit | grep -q .; then
  ops_die "迁移包不得包含符号链接"
fi
if find "$package_directory" -xdev ! -type d ! -type f -print -quit | grep -q .; then
  ops_die "迁移包不得包含特殊文件"
fi
(
  cd -- "$package_directory"
  sha256sum --check --strict SHA256SUMS
)
git bundle verify "$package_directory/code-repository.bundle" >/dev/null
format="$(awk -F= '$1 == "format" { print $2; exit }' "$package_directory/instance-manifest.env")"
[ "$format" = vinci-instance-v1 ] || ops_die "不支持的迁移包格式"

project="$(ops_project_name)"
database="$(ops_required_compose_env POSTGRES_DB)"
expected="IMPORT:$(basename -- "$package_directory"):${project}:${database}"
[ "${confirmation_argument#*=}" = "$expected" ] \
  || ops_die "迁移确认令牌不匹配；期望 ${expected}"
backup_name="$(awk -F= '$1 == "database_backup" { print $2; exit }' "$package_directory/instance-manifest.env")"
backup_directory="$package_directory/database-backup"
[ "$(basename -- "$backup_directory")" = database-backup ] || ops_die "迁移包备份路径无效"
[ -f "$backup_directory/manifest.env" ] || ops_die "迁移包内数据库备份无效"

repository_commit="$(awk -F= '$1 == "repository_commit" { print $2; exit }' "$package_directory/instance-manifest.env")"
[[ "$repository_commit" =~ ^[0-9a-f]{40}$ ]] || ops_die "迁移包代码 Commit 无效"
git -C "$OPS_REPOSITORY_ROOT" cat-file -e "${repository_commit}^{commit}" 2>/dev/null \
  || ops_die "当前代码 clone 不含迁移包 Commit；请先以普通 fetch 获取并复核，不要 reset/rebase"

restore_confirmation="RESTORE:${project}:${database}:$(basename -- "$backup_directory")"
"$OPS_REPOSITORY_ROOT/vinci" restore "$backup_directory" \
  "--confirm=${restore_confirmation}"
if [ "${VINCI_INSTANCE_TEST_MODE:-false}" = "true" ]; then
  [[ "$project" == *test* ]] && [[ "$database" == *test* ]] \
    && [[ "$(basename -- "$package_directory")" == *test* ]] \
    || ops_die "VINCI_INSTANCE_TEST_MODE 只允许名称含 test 的隔离资源"
  mkdir -p "$OPS_REPOSITORY_ROOT/.deploy"
  printf 'commit=%s\nimage=instance-test\nslot=blue\nmode=application\n' \
    "$repository_commit" > "$OPS_REPOSITORY_ROOT/.deploy/current"
  VINCI_OPERATIONS_TEST_MODE=true "$OPS_REPOSITORY_ROOT/vinci" doctor
else
  "$OPS_REPOSITORY_ROOT/vinci" update "$repository_commit"
  "$OPS_REPOSITORY_ROOT/vinci" doctor
fi
ops_info "实例导入完成：数据库、Migration、蓝绿健康、内容任务和 S3/COS 诊断通过。"
ops_info "切换 DNS 前请保留旧服务器和本迁移包；密钥材料仍由独立加密存储管理。"
