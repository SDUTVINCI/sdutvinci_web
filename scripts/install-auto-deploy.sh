#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"

case "${1:-}" in
  ""|--install)
    exec "$repository_root/vinci" install --systemd-only
    ;;
  --status)
    exec "$repository_root/vinci" status
    ;;
  --disable)
    printf '%s\n' \
      '兼容入口不再按固定用户管理 timer。请用当前安装用户执行：' \
      '  sudo systemctl disable --now vinci-cms-auto-deploy.timer'
    ;;
  -h|--help)
    printf '%s\n' \
      '此脚本仅为旧书签兼容包装；新安装统一使用：./vinci install' \
      '状态检查统一使用：./vinci status 和 ./vinci doctor'
    ;;
  *)
    printf '错误：未知参数：%s\n' "$1" >&2
    exit 2
    ;;
esac
