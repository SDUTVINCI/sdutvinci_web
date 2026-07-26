#!/usr/bin/env bash

set -Eeuo pipefail

service_name="vinci-cms-auto-deploy.service"
timer_name="vinci-cms-auto-deploy.timer"
deploy_user="${VINCI_CMS_DEPLOY_USER:-vinci-deploy}"
repository_root="${VINCI_CMS_ROOT:-/opt/vinci-cms}"
unit_directory="${VINCI_CMS_SYSTEMD_UNIT_DIR:-/etc/systemd/system}"

die() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

info() {
  printf '%s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少必需命令：$1"
}

usage() {
  cat <<'EOF'
用法：
  sudo /opt/vinci-cms/scripts/install-auto-deploy.sh
  sudo /opt/vinci-cms/scripts/install-auto-deploy.sh --status
  sudo /opt/vinci-cms/scripts/install-auto-deploy.sh --disable

不带参数：
  校验部署目录和 Docker 权限，安装 systemd unit，人工试跑一次，
  只有试跑成功才启用每分钟检查的 timer。

--status：
  只读显示 timer、最近一次 service 状态和日志。

--disable：
  停止并禁用未来的定时检查，不停止网站、数据库或正在运行的部署。
EOF
}

require_root() {
  [ "$(id -u)" -eq 0 ] \
    || die "请使用有 sudo 权限的个人账号执行：sudo $repository_root/scripts/install-auto-deploy.sh"
}

run_as_deploy() {
  runuser -u "$deploy_user" -- "$@"
}

show_status() {
  systemctl status --no-pager "$timer_name" || true
  systemctl status --no-pager "$service_name" || true
  journalctl -u "$service_name" -n 80 --no-pager || true
}

disable_timer() {
  require_root
  require_command systemctl

  info "停止并禁用自动部署 timer..."
  systemctl disable --now "$timer_name" >/dev/null 2>&1 || true

  if systemctl is-active --quiet "$timer_name"; then
    die "$timer_name 仍处于活动状态，请执行 --status 查看详情"
  fi

  info "自动部署 timer 已停用。当前网站、PostgreSQL、gateway 和应用容器均未停止。"
  info "如果 service 正在执行部署，请等待它自行完成，不要强制终止。"
}

validate_installation_target() {
  local actual_root
  local enabled
  local configured_remote
  local actual_remote
  local current_commit
  local env_mode

  if [ "$repository_root" != "/opt/vinci-cms" ] \
    || [ "$unit_directory" != "/etc/systemd/system" ] \
    || [ "$deploy_user" != "vinci-deploy" ]; then
    [ "${VINCI_CMS_INSTALLER_TEST_MODE:-false}" = "true" ] \
      || die "部署账号、目录和 unit 目录只能在隔离测试模式中覆盖"
  fi

  require_command awk
  require_command bash
  require_command docker
  require_command getent
  require_command git
  require_command grep
  require_command install
  require_command journalctl
  require_command realpath
  require_command runuser
  require_command stat
  require_command systemctl
  require_command systemd-analyze

  getent passwd "$deploy_user" >/dev/null \
    || die "部署账号不存在：$deploy_user"

  [ -d "$repository_root" ] || die "部署目录不存在：$repository_root"
  [ ! -L "$repository_root" ] \
    || die "部署目录不得是符号链接：$repository_root"
  actual_root="$(cd -- "$repository_root" && pwd -P)"
  repository_root="$(realpath -m -- "$repository_root")"
  [ "$actual_root" = "$repository_root" ] \
    || die "部署目录路径不一致，期望 $repository_root，实际 $actual_root"

  [ -d "$repository_root/.git" ] \
    || die "部署目录不是预期的 Git working tree：$repository_root"
  [ -f "$repository_root/scripts/auto-deploy.sh" ] \
    && [ ! -L "$repository_root/scripts/auto-deploy.sh" ] \
    && [ -x "$repository_root/scripts/auto-deploy.sh" ] \
    || die "缺少可执行的 scripts/auto-deploy.sh"

  for unit in "$service_name" "$timer_name"; do
    [ -f "$repository_root/systemd/$unit" ] \
      && [ ! -L "$repository_root/systemd/$unit" ] \
      || die "缺少普通 unit 模板：systemd/$unit"
  done

  [ -f "$repository_root/.env" ] && [ ! -L "$repository_root/.env" ] \
    || die ".env 必须是普通文件，且不得是符号链接"
  env_mode="$(stat -c '%a' "$repository_root/.env")"
  [ "$env_mode" = "600" ] \
    || die ".env 权限必须是 600；请执行：chmod 600 $repository_root/.env"
  run_as_deploy test -r "$repository_root/.env" \
    || die "$deploy_user 无法读取 $repository_root/.env"

  [ -f "$repository_root/.deploy/current" ] \
    && [ ! -L "$repository_root/.deploy/current" ] \
    || die "缺少 .deploy/current；必须先完成人工首次部署"

  run_as_deploy git -C "$repository_root" rev-parse --is-inside-work-tree \
    | grep -Fxq true \
    || die "$deploy_user 无法读取部署仓库"

  if [ -n "$(
    run_as_deploy git -C "$repository_root" \
      status --porcelain=v1 --untracked-files=no
  )" ]; then
    die "部署仓库存在已跟踪文件改动；请先识别并处理，安装器不会覆盖"
  fi

  current_commit="$(
    awk -F= '$1 == "commit" { print $2; exit }' \
      "$repository_root/.deploy/current"
  )"
  [[ "$current_commit" =~ ^[0-9a-f]{40}$ ]] \
    || die ".deploy/current 中的 commit 不是完整的 40 位小写 SHA"
  run_as_deploy git -C "$repository_root" \
    cat-file -e "${current_commit}^{commit}" 2>/dev/null \
    || die ".deploy/current 指向的 commit 不存在于部署仓库"

  enabled="$(
    # shellcheck disable=SC2016
    run_as_deploy bash -c '
      cd -- "$1"
      docker compose config --environment
    ' _ "$repository_root" \
      | awk -F= '$1 == "AUTO_DEPLOY_ENABLED" {
          sub(/^[^=]*=/, "")
          print
          exit
        }'
  )"
  [ "$enabled" = "true" ] \
    || die ".env 中 AUTO_DEPLOY_ENABLED 必须显式设置为 true"

  configured_remote="$(
    # shellcheck disable=SC2016
    run_as_deploy bash -c '
      cd -- "$1"
      docker compose config --environment
    ' _ "$repository_root" \
      | awk -F= '$1 == "DEPLOY_GIT_REMOTE_URL" {
          sub(/^[^=]*=/, "")
          print
          exit
        }'
  )"
  [ -n "$configured_remote" ] \
    || die ".env 中缺少 DEPLOY_GIT_REMOTE_URL"
  actual_remote="$(
    run_as_deploy git -C "$repository_root" remote get-url origin
  )"
  [ "$actual_remote" = "$configured_remote" ] \
    || die "origin 与 DEPLOY_GIT_REMOTE_URL 不一致，拒绝启用"

  run_as_deploy docker info >/dev/null \
    || die "$deploy_user 无法连接 Docker；请检查 docker 组并重新登录会话"
}

install_and_enable() {
  require_root
  validate_installation_target

  if systemctl is-active --quiet "$service_name"; then
    die "自动部署 service 正在运行；请等待完成后再更新安装"
  fi

  systemctl disable --now "$timer_name" >/dev/null 2>&1 || true
  info "环境校验通过，安装 root-owned systemd unit..."
  install -d -o root -g root -m 0755 "$unit_directory"
  install -o root -g root -m 0644 \
    "$repository_root/systemd/$service_name" \
    "$unit_directory/$service_name"
  install -o root -g root -m 0644 \
    "$repository_root/systemd/$timer_name" \
    "$unit_directory/$timer_name"

  systemd-analyze verify \
    "$unit_directory/$service_name" \
    "$unit_directory/$timer_name"
  systemctl daemon-reload

  info "先执行一次安全试跑；成功后才会启用 timer..."
  systemctl reset-failed "$service_name" >/dev/null 2>&1 || true
  if ! systemctl start "$service_name"; then
    systemctl disable --now "$timer_name" >/dev/null 2>&1 || true
    info "首次试跑失败，timer 未启用。最近日志如下："
    journalctl -u "$service_name" -n 80 --no-pager || true
    die "请按日志排查；修复后重新运行同一条安装命令"
  fi

  systemctl enable --now "$timer_name"
  systemctl is-enabled --quiet "$timer_name" \
    || die "$timer_name 未成功设为开机启用"
  systemctl is-active --quiet "$timer_name" \
    || die "$timer_name 未成功启动"

  info "自动部署已启用：服务器会定期检查 GitHub main，并只部署验证完成的不可变镜像。"
  info "查看状态：sudo $repository_root/scripts/install-auto-deploy.sh --status"
  info "暂停检查：sudo $repository_root/scripts/install-auto-deploy.sh --disable"
}

action="${1:-install}"
[ "$#" -le 1 ] || {
  usage >&2
  exit 2
}

case "$action" in
  install|--install)
    install_and_enable
    ;;
  --status)
    require_root
    require_command journalctl
    require_command systemctl
    show_status
    ;;
  --disable)
    disable_timer
    ;;
  -h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
