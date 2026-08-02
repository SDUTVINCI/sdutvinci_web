#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
snapshot_tag="v2-phase10-pre-removal-20260802-08a1c49"
test_root="$(mktemp -d /tmp/vinci-phase11-markdown-security-test.XXXXXX)"
trap 'rm -rf -- "$test_root"' EXIT

git -C "$repository_root" cat-file -e "${snapshot_tag}^{tag}" 2>/dev/null \
  || { printf '缺少阶段 10 删除前 annotated tag：%s\n' "$snapshot_tag" >&2; exit 1; }
git -C "$repository_root" archive "$snapshot_tag" content/news content/wiki \
  | tar --extract --file=- --directory "$test_root"

file_count="$(find "$test_root/content/news" "$test_root/content/wiki" -type f -name '*.md' | wc -l)"
[ "$file_count" -gt 200 ] \
  || { printf '删除前测试快照内容不完整：%s\n' "$file_count" >&2; exit 1; }
node "$repository_root/tests/helpers/create-phase11-wiki-snapshot.mjs" "$test_root/content"

cd -- "$repository_root"
V2_CONTENT_SNAPSHOT_SOURCE="$test_root/content" \
  ./node_modules/.bin/vitest run tests/cms-protected-markdown.test.ts
WIKI_CHECK_SOURCE="$test_root/content" npm run wiki:check

printf 'phase 11 historical snapshot Markdown/XSS security test passed: %s files\n' "$file_count"
