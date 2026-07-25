#!/usr/bin/env bash

set -Eeuo pipefail

die() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

[ "$#" -eq 2 ] || die "用法：$0 <起始 commit> <目标 commit>"
base_commit="$1"
target_commit="$2"

[[ "$base_commit" =~ ^[0-9a-f]{40}$ ]] || die "起始 commit 必须是完整的 40 位小写 SHA"
[[ "$target_commit" =~ ^[0-9a-f]{40}$ ]] || die "目标 commit 必须是完整的 40 位小写 SHA"
git cat-file -e "${base_commit}^{commit}" 2>/dev/null || die "起始 commit 不存在"
git cat-file -e "${target_commit}^{commit}" 2>/dev/null || die "目标 commit 不存在"
git merge-base --is-ancestor "$base_commit" "$target_commit" \
  || die "目标 commit 不是起始 commit 的后继"

mapfile -d '' changed_paths < <(
  git diff --no-renames --name-only --diff-filter=ACDMRTUXB -z "$base_commit" "$target_commit"
)

[ "${#changed_paths[@]}" -gt 0 ] || {
  printf 'application\n'
  exit 0
}

for path in "${changed_paths[@]}"; do
  case "$path" in
    content/*) ;;
    *)
      printf 'application\n'
      exit 0
      ;;
  esac
done

printf 'content\n'
