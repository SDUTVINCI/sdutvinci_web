#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
fixture_directory="$repository_root/tests/fixtures/deploy-cache"
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT

mkdir -p -- "$test_root/repository/scripts" "$test_root/repository/.deploy" "$test_root/bin"
cp -- "$repository_root/scripts/ops-common.sh" "$test_root/repository/scripts/"
cp -- "$repository_root/scripts/cleanup-deploy-cache.sh" "$test_root/repository/scripts/"
cp -- "$fixture_directory/docker" "$test_root/bin/docker"
chmod +x -- "$test_root/repository/scripts/cleanup-deploy-cache.sh" "$test_root/bin/docker"

export PATH="$test_root/bin:$PATH"
export FAKE_DOCKER_LOG="$test_root/docker.log"
export FAKE_RUNTIME_REPOSITORY="registry.invalid/vinci/runtime"
export FAKE_OPERATIONS_REPOSITORY="registry.invalid/vinci/operations"
export FAKE_CURRENT_COMMIT="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
export FAKE_CONTAINER_COMMIT="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
export FAKE_REMOVABLE_COMMIT="cccccccccccccccccccccccccccccccccccccccc"
export FAKE_CLEANUP_COMMIT="1111111111111111111111111111111111111111"
export FAKE_RETAINED_COMMIT_1="dddddddddddddddddddddddddddddddddddddddd"
export FAKE_RETAINED_COMMIT_2="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
export FAKE_FAILED_COMMIT="ffffffffffffffffffffffffffffffffffffffff"

printf 'commit=%s\nslot=blue\n' "$FAKE_CURRENT_COMMIT" \
  > "$test_root/repository/.deploy/current"
printf 'commit=%s\nmode=application\n' "$FAKE_FAILED_COMMIT" \
  > "$test_root/repository/.deploy/auto-deploy-failed"
printf 'commit=%s\nverified_by=previous_healthy_deployment\n' "$FAKE_REMOVABLE_COMMIT" \
  > "$test_root/repository/.deploy/rollback-verified"
: > "$FAKE_DOCKER_LOG"

dry_run_output="$("$test_root/repository/scripts/cleanup-deploy-cache.sh" --dry-run)"
printf '%s\n' "$dry_run_output" | grep -F \
  "保留部署状态引用的镜像：${FAKE_RUNTIME_REPOSITORY}:${FAKE_REMOVABLE_COMMIT}" >/dev/null
printf '%s\n' "$dry_run_output" | grep -F \
  "将删除旧部署镜像：${FAKE_RUNTIME_REPOSITORY}:${FAKE_CLEANUP_COMMIT}" >/dev/null
printf '%s\n' "$dry_run_output" | grep -F \
  "保留容器仍在引用的镜像：${FAKE_RUNTIME_REPOSITORY}:${FAKE_CONTAINER_COMMIT}" >/dev/null
printf '%s\n' "$dry_run_output" | grep -F \
  "保留部署状态引用的镜像：${FAKE_OPERATIONS_REPOSITORY}:${FAKE_FAILED_COMMIT}" >/dev/null
if grep -Eq '(^| )image (rm|prune)( |$)|(^| )builder prune( |$)' "$FAKE_DOCKER_LOG"; then
  printf 'dry-run unexpectedly modified Docker state\n' >&2
  exit 1
fi

: > "$FAKE_DOCKER_LOG"
"$test_root/repository/scripts/cleanup-deploy-cache.sh" --apply >/dev/null

if grep -E "^image rm -- .+:${FAKE_REMOVABLE_COMMIT}$" "$FAKE_DOCKER_LOG" >/dev/null; then
  printf 'verified rollback image was removed\n' >&2
  exit 1
fi
grep -Fx "image rm -- ${FAKE_RUNTIME_REPOSITORY}:${FAKE_CLEANUP_COMMIT}" \
  "$FAKE_DOCKER_LOG" >/dev/null
grep -Fx "image rm -- ${FAKE_OPERATIONS_REPOSITORY}:${FAKE_CLEANUP_COMMIT}" \
  "$FAKE_DOCKER_LOG" >/dev/null
grep -Fx "image prune --force --filter until=48h" "$FAKE_DOCKER_LOG" >/dev/null
grep -Fx "builder prune --force --filter until=48h" "$FAKE_DOCKER_LOG" >/dev/null

for protected_commit in \
  "$FAKE_CURRENT_COMMIT" \
  "$FAKE_CONTAINER_COMMIT" \
  "$FAKE_RETAINED_COMMIT_1" \
  "$FAKE_RETAINED_COMMIT_2" \
  "$FAKE_FAILED_COMMIT"; do
  if grep -E "^image rm -- .+:${protected_commit}$" "$FAKE_DOCKER_LOG" >/dev/null; then
    printf 'protected image was removed: %s\n' "$protected_commit" >&2
    exit 1
  fi
done

if grep -Eq '(^| )(volume|container) (rm|prune)( |$)|system prune' "$FAKE_DOCKER_LOG"; then
  printf 'cleanup crossed the container or volume safety boundary\n' >&2
  exit 1
fi

: > "$FAKE_DOCKER_LOG"
export FAKE_FAIL_CONTAINER_INSPECT=true
if "$test_root/repository/scripts/cleanup-deploy-cache.sh" --apply \
  > "$test_root/fail-closed.out" 2>&1; then
  printf 'cleanup did not fail closed when container inventory was incomplete\n' >&2
  exit 1
fi
unset FAKE_FAIL_CONTAINER_INSPECT
grep -F "为避免误删镜像，拒绝继续" "$test_root/fail-closed.out" >/dev/null
if grep -Eq '(^| )image (rm|prune)( |$)|(^| )builder prune( |$)' "$FAKE_DOCKER_LOG"; then
  printf 'incomplete container inventory unexpectedly modified Docker state\n' >&2
  exit 1
fi

mkdir -- "$test_root/repository/.deploy/operation.lock"
: > "$FAKE_DOCKER_LOG"
skip_output="$(
  "$test_root/repository/scripts/cleanup-deploy-cache.sh" --apply --skip-if-locked
)"
printf '%s\n' "$skip_output" | grep -F "本轮缓存清理跳过" >/dev/null
[ ! -s "$FAKE_DOCKER_LOG" ] || {
  printf 'lock-skipped cleanup unexpectedly called Docker\n' >&2
  exit 1
}

printf 'deploy cache cleanup integration test passed\n'
