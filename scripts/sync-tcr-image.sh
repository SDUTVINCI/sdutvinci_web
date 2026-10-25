#!/usr/bin/env bash

set -Eeuo pipefail

die() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

[ "$#" -ge 2 ] && [ "$#" -le 3 ] \
  || die '用法：sync-tcr-image.sh <40位 main SHA> <runtime|operations> [sha256:摘要]'

sync_commit="$1"
sync_image="$2"
sync_expected_digest="${3:-}"
[[ "$sync_commit" =~ ^[0-9a-f]{40}$ ]] || die '版本必须是完整的 40 位小写 SHA'
if [ -n "$sync_expected_digest" ]; then
  [[ "$sync_expected_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || die '镜像摘要格式无效'
fi
case "$sync_image" in
  runtime) sync_suffix='' ;;
  operations) sync_suffix='-ops' ;;
  *) die '镜像类型只接受 runtime 或 operations' ;;
esac

sync_repository="${GITHUB_REPOSITORY:-}"
[[ "$sync_repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
  || die '缺少有效的 GITHUB_REPOSITORY'
sync_source="ghcr.io/${sync_repository,,}${sync_suffix}"
sync_destination="ccr.ccs.tencentyun.com/sdutvinci/sdutvinci_web${sync_suffix}:${sync_commit}"

for sync_command in skopeo regctl timeout sha256sum tee; do
  command -v "$sync_command" >/dev/null || die "缺少命令：${sync_command}"
done

umask 077
sync_workdir="$(mktemp -d)"
export REGCTL_CONFIG="$sync_workdir/regctl.json"
trap 'rm -rf -- "$sync_workdir"' EXIT
sync_transfer_pid=''
sync_logger_pid=''
sync_log_fd=''

close_sync_log() {
  if [ -n "$sync_log_fd" ]; then
    exec {sync_log_fd}>&-
    sync_log_fd=''
  fi
  if [ -n "$sync_logger_pid" ]; then
    wait "$sync_logger_pid" || true
    sync_logger_pid=''
  fi
}

cancel_sync() {
  trap '' INT TERM
  if [ -n "$sync_transfer_pid" ]; then
    # GNU timeout runs its child in a separate process group. Cancel that group
    # as well as this shell, so a cancelled workflow cannot keep uploading.
    kill -TERM -- "-$sync_transfer_pid" 2>/dev/null \
      || kill -TERM "$sync_transfer_pid" 2>/dev/null || true
    wait "$sync_transfer_pid" 2>/dev/null || true
  fi
  close_sync_log
  exit "$1"
}

trap 'cancel_sync 130' INT
trap 'cancel_sync 143' TERM

# One timeout covers source resolution, staging all manifests/layers locally,
# uploading, and reading the destination back. Keep the local OCI cache between
# attempts so slow uploads cannot stall GHCR reads or force another download.
sync_attempt() {
  set -Eeuo pipefail
  local source_digest destination_digest cache_digest cache_ref stage_started cache_bytes
  printf 'GHCR 源摘要解析\n' > "$sync_workdir/phase"
  if [ ! -s "$sync_workdir/source.digest" ]; then
    skopeo inspect --raw "docker://${sync_source}:${sync_commit}" > "$sync_workdir/source.manifest"
    source_digest="sha256:$(sha256sum "$sync_workdir/source.manifest" | cut -d ' ' -f 1)"
    if [ -n "$sync_expected_digest" ] && [ "$source_digest" != "$sync_expected_digest" ]; then
      printf 'source digest mismatch: expected %s, got %s\n' "$sync_expected_digest" "$source_digest" >&2
      return 1
    fi
    printf '%s\n' "$source_digest" > "$sync_workdir/source.digest"
  fi
  source_digest="$(cat "$sync_workdir/source.digest")"
  cache_ref="oci:${sync_workdir}/image:release"

  # Credentials come from docker/login-action's credential file, never CLI args.
  # Source copies use the outer retry loop; chunk-level upload retries remain
  # inside the same per-attempt 60-minute timeout.
  if [ ! -f "$sync_workdir/cache.ready" ]; then
    printf 'GHCR 下载到本地\n' > "$sync_workdir/phase"
    stage_started="$SECONDS"
    printf '[GHCR 下载] 开始下载固定摘要 %s 到本地 OCI 缓存。\n' "$source_digest"
    skopeo copy --all --preserve-digests --retry-times 0 \
      "docker://${sync_source}@${source_digest}" "$cache_ref"
    skopeo inspect --raw "$cache_ref" > "$sync_workdir/cache.manifest"
    cache_digest="sha256:$(sha256sum "$sync_workdir/cache.manifest" | cut -d ' ' -f 1)"
    if [ "$cache_digest" != "$source_digest" ]; then
      printf 'cache digest mismatch: expected %s, got %s\n' "$source_digest" "$cache_digest" >&2
      return 1
    fi
    printf '%s\n' "$cache_digest" > "$sync_workdir/cache.ready"
    cache_bytes="$(du -sb "$sync_workdir/image" | cut -f 1)"
    printf '[GHCR 下载] 完成并验证摘要，耗时 %s 秒，本地缓存 %s 字节。\n' \
      "$((SECONDS - stage_started))" "$cache_bytes"
  else
    printf '[GHCR 下载] 复用本轮任务已经校验的本地 OCI 缓存，无需再次从 GHCR 下载。\n'
  fi

  printf '本地缓存上传腾讯云\n' > "$sync_workdir/phase"
  stage_started="$SECONDS"
  printf '[腾讯云上传] 从本地 OCI 缓存通过 HTTP/1.1 上传；大层按 8 MiB 分块，最多 2 个并发请求。\n'
  # Bound request size instead of keeping one multi-hundred-MB PATCH open.
  # Registry configuration is task-local; credentials still come from Docker.
  regctl registry set ccr.ccs.tencentyun.com --skip-check \
    --blob-max 8388608 --blob-chunk 8388608 --req-concurrent 2
  # Scope HTTP/1.1 compatibility to the TCR upload; GHCR downloads keep their
  # default transport. TLS and certificate verification remain enabled.
  GODEBUG="${GODEBUG:+$GODEBUG,}http2client=0" regctl image copy --force-recursive --verbosity info \
    "ocidir://${sync_workdir}/image:release" "$sync_destination"
  printf '[腾讯云上传] 完成，耗时 %s 秒。\n' "$((SECONDS - stage_started))"
  printf '腾讯云目标摘要校验\n' > "$sync_workdir/phase"
  skopeo inspect --raw "docker://${sync_destination}" > "$sync_workdir/destination.manifest"
  destination_digest="sha256:$(sha256sum "$sync_workdir/destination.manifest" | cut -d ' ' -f 1)"
  if [ "$destination_digest" != "$source_digest" ]; then
    printf 'destination digest mismatch: expected %s, got %s\n' "$source_digest" "$destination_digest" >&2
    return 1
  fi
  printf '镜像摘要验证成功：%s\n' "$destination_digest"
}

export -f sync_attempt
export sync_commit sync_source sync_destination sync_expected_digest sync_workdir

for sync_attempt_number in 1 2 3; do
  sync_started_at="$SECONDS"
  printf '[%s] 同步 %s，第 %s/3 次尝试（单次最多 60 分钟，3 次累计最多 180 分钟）\n' \
    "$(date -u +%FT%TZ)" "$sync_destination" "$sync_attempt_number"
  exec {sync_log_fd}> >(tee "$sync_workdir/attempt.log")
  sync_logger_pid="$!"
  timeout --signal=TERM --kill-after=10s 3600s bash -c sync_attempt >&"$sync_log_fd" 2>&1 &
  sync_transfer_pid="$!"
  if wait "$sync_transfer_pid"; then
    sync_status=0
  else
    sync_status="$?"
  fi
  sync_transfer_pid=''
  close_sync_log
  if [ "$sync_status" -eq 0 ]; then
    printf '同步完成，耗时 %s 秒。\n' "$((SECONDS - sync_started_at))"
    exit 0
  fi

  sync_failed_phase="$(cat "$sync_workdir/phase" 2>/dev/null || printf '启动')"
  printf '本次同步失败，阶段：%s，退出码 %s，耗时 %s 秒。\n' \
    "$sync_failed_phase" "$sync_status" "$((SECONDS - sync_started_at))" >&2
  case "$sync_status" in 130|143) exit "$sync_status" ;; esac
  if grep -Eiq 'unauthorized|authentication required|invalid (username|password|reference)|requested access.*denied|access denied|denied:|manifest unknown|name unknown|digest mismatch' \
    "$sync_workdir/attempt.log"; then
    die '认证、权限、源镜像或摘要校验失败，停止重试'
  fi
  [ "$sync_attempt_number" -lt 3 ] || die '同步已尝试 3 次，停止；可按原 SHA 单独补传'
  sync_delay="$((sync_attempt_number * 30))"
  printf '%s 秒后重试。\n' "$sync_delay"
  sleep "$sync_delay"
done
