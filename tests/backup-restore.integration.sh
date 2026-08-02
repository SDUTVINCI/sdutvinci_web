#!/usr/bin/env bash

set -Eeuo pipefail

# Docker Compose gives exported shell variables precedence over the generated
# test .env. Remove every application-specific override before constructing any
# project so an acceptance or production URL cannot leak into this test.
unset \
  APP_BIND_ADDRESS \
  APP_IMAGE \
  APP_IMAGE_TAG \
  APP_OPS_IMAGE \
  APP_PORT \
  BACKUP_ROOT \
  CMS_AUTH_SECRET \
  CMS_CONTENT_ROOT \
  CMS_GIT_AUTHOR_EMAIL \
  CMS_GIT_AUTHOR_NAME \
  CMS_GIT_BRANCH \
  CMS_GIT_KNOWN_HOSTS_FILE \
  CMS_GIT_REMOTE \
  CMS_GIT_REMOTE_URL \
  CMS_GIT_SSH_KEY_FILE \
  CMS_GIT_SSH_KEY_PATH \
  CMS_GIT_WORKTREE \
  CMS_SECURE_COOKIES \
  COMPOSE_FILE \
  COMPOSE_PROFILES \
  COMPOSE_PROJECT_NAME \
  CONTENT_PUBLISH_MODE \
  DATABASE_URL \
  NUXT_PUBLIC_SITE_URL \
  POSTGRES_DB \
  POSTGRES_PASSWORD \
  POSTGRES_USER \
  RESTORE_CONFIRM \
  S3_ACCESS_KEY_ID \
  S3_BUCKET \
  S3_ENDPOINT \
  S3_PUBLIC_BASE_URL \
  S3_REGION \
  S3_SECRET_ACCESS_KEY \
  TEST_DATABASE_URL

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
test_root="$(mktemp -d /tmp/vinci-phase9-backup-restore-test.XXXXXX)"
source_directory="${test_root}/source-project"
target_directory="${test_root}/target-project"
migration_directory="${test_root}/migration-project-test"
backup_root="${test_root}/test-backups"
suffix="$$"
source_project="vinci-phase9-backup-source-test-${suffix}"
target_project="vinci-phase9-restore-target-test-${suffix}"
migration_project="vinci-phase11-migration-target-test-${suffix}"
source_database="vinci_phase9_backup_source_test"
target_database="vinci_phase9_restore_target_test"
migration_database="vinci_phase11_migration_target_test"
test_user="vinci_phase9_test"
test_password="phase9-test-only-password"
runtime_image="vinci-phase9-runtime-test"
operations_image="vinci-phase9-operations-test"
image_tag="phase9-${suffix}"
target_port="$((43000 + suffix % 1000))"
source_port="$((42000 + suffix % 1000))"
migration_port="$((44000 + suffix % 1000))"
s3_test_port="$((45000 + suffix % 1000))"
deploy_image_tags=()

cleanup() {
  if [ -d "$migration_directory" ]; then
    (
      cd -- "$migration_directory"
      docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
    )
  fi
  if [ -d "$target_directory" ]; then
    (
      cd -- "$target_directory"
      docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
    )
  fi
  if [ -d "$source_directory" ]; then
    (
      cd -- "$source_directory"
      docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
    )
  fi
  docker image rm \
    "${runtime_image}:${image_tag}" \
    "${operations_image}:${image_tag}" \
    >/dev/null 2>&1 || true
  local deploy_tag
  for deploy_tag in "${deploy_image_tags[@]}"; do
    docker image rm \
      "${runtime_image}:${deploy_tag}" "${operations_image}:${deploy_tag}" \
      >/dev/null 2>&1 || true
  done
  rm -rf -- "$test_root"
}
trap cleanup EXIT

for command in docker git realpath sha256sum tar curl; do
  command -v "$command" >/dev/null 2>&1 || {
    printf '缺少测试命令：%s\n' "$command" >&2
    exit 1
  }
done

mkdir -p -- "$source_directory" "$target_directory" "$migration_directory" "$backup_root"
(
  cd -- "$repository_root"
  git ls-files --cached --others --exclude-standard -z \
    | while IFS= read -r -d '' path; do
        [ ! -e "$path" ] || printf '%s\0' "$path"
      done \
    | tar --null --verbatim-files-from --files-from=- --create --file=-
) | tar --extract --file=- --directory "$source_directory"
cp -a -- "$source_directory/." "$target_directory/"

initialize_snapshot() {
  local directory="$1"
  (
    cd -- "$directory"
    git init --quiet --initial-branch=main
    git config user.name 'Phase 9 Restore Test'
    git config user.email 'phase9-test@localhost'
    git add --all
    git commit --quiet --message 'phase 9 isolated restore test snapshot'
  )
}

write_environment() {
  local directory="$1"
  local project="$2"
  local database="$3"
  local port="$4"

  printf '%s\n' 'phase9-test-key-placeholder' \
    > "${directory}/phase9-test-git-key"
  printf '%s\n' 'github.invalid ssh-ed25519 AAAATESTONLY' \
    > "${directory}/phase9-test-known-hosts"
  chmod 0600 "${directory}/phase9-test-git-key"

  {
    printf 'COMPOSE_PROJECT_NAME=%s\n' "$project"
    printf 'APP_IMAGE=%s\n' "$runtime_image"
    printf 'APP_OPS_IMAGE=%s\n' "$operations_image"
    printf 'APP_IMAGE_TAG=%s\n' "$image_tag"
    printf 'APP_BIND_ADDRESS=127.0.0.1\n'
    printf 'APP_PORT=%s\n' "$port"
    printf 'POSTGRES_DB=%s\n' "$database"
    printf 'POSTGRES_USER=%s\n' "$test_user"
    printf 'POSTGRES_PASSWORD=%s\n' "$test_password"
    printf 'DATABASE_URL=postgresql://%s:%s@postgres:5432/%s\n' \
      "$test_user" "$test_password" "$database"
    printf 'BACKUP_ROOT=%s\n' "$backup_root"
    printf 'NUXT_PUBLIC_SITE_URL=http://127.0.0.1:%s\n' "$port"
    printf 'CMS_AUTH_SECRET=phase9-test-only-auth-secret-at-least-32-characters\n'
    printf 'CMS_SECURE_COOKIES=false\n'
    printf 'CMS_GIT_REMOTE_URL=ssh://git@github.invalid/phase9/test.git\n'
    printf 'CMS_GIT_BRANCH=main\n'
    printf 'CMS_GIT_SSH_KEY_FILE=%s/phase9-test-git-key\n' "$directory"
    printf 'CMS_GIT_KNOWN_HOSTS_FILE=%s/phase9-test-known-hosts\n' "$directory"
    printf 'S3_ENDPOINT=https://s3.invalid\n'
    printf 'S3_REGION=phase9-test\n'
    printf 'S3_BUCKET=phase9-test\n'
    printf 'S3_ACCESS_KEY_ID=phase9-test\n'
    printf 'S3_SECRET_ACCESS_KEY=phase9-test\n'
    printf 'S3_PUBLIC_BASE_URL=https://media.invalid\n'
    printf 'COMPOSE_FILE=compose.yaml:tests/fixtures/v2-phase11-isolation.compose.yaml\n'
  } > "${directory}/.env"
  chmod 0600 "${directory}/.env"
}

initialize_snapshot "$source_directory"
initialize_snapshot "$target_directory"
cp -a -- "$source_directory/." "$migration_directory/"
write_environment "$source_directory" "$source_project" "$source_database" "$source_port"
write_environment "$target_directory" "$target_project" "$target_database" \
  "$target_port"
write_environment "$migration_directory" "$migration_project" \
  "$migration_database" "$migration_port"
{
  printf 'S3_ENDPOINT=http://s3-test:45519\n'
  printf 'S3_PUBLIC_BASE_URL=http://s3-test:45519/phase11-test-bucket\n'
  printf 'S3_FORCE_PATH_STYLE=true\n'
  printf 'S3_TEST_PORT=%s\n' "$s3_test_port"
  printf 'COMPOSE_FILE=compose.yaml:tests/fixtures/v2-phase11-isolation.compose.yaml:tests/fixtures/v2-phase11-s3.compose.yaml\n'
  printf 'INSTANCE_EXPORT_ROOT=%s/test-instance-packages\n' "$test_root"
  printf 'DEPLOY_CACHE_CLEANUP_ENABLED=false\n'
} >> "$migration_directory/.env"
phase1_revision_source=$'---\ntitle: Phase 1 backup\n---\nphase1 backup body\n'
phase1_revision_hash="$(
  printf '%s' "$phase1_revision_source" | sha256sum | cut -d ' ' -f1
)"

printf '隔离演练根目录：%s\n' "$test_root"
printf '测试备份路径：%s\n' "$backup_root"
printf '源/目标 Compose project：%s / %s\n' \
  "$source_project" "$target_project"

(
  cd -- "$source_directory"
  docker compose config --quiet
  docker compose build app-blue migrate
  docker compose up --detach --wait postgres
  docker compose --profile tools run --rm migrate
  docker compose exec -T postgres psql \
    --username "$test_user" \
    --dbname "$source_database" \
    --set ON_ERROR_STOP=1 \
    --command "insert into audit_logs (action, target_type, target_id, metadata) values ('phase9.restore.marker', 'phase9-test', 'source', '{\"restored\":true}')"
  printf '%s\n' "
      do \$\$
      declare
        phase1_article_id uuid;
        phase1_revision_id uuid;
        phase1_user_id uuid;
      begin
        insert into articles (
          collection, relative_path, public_path, directory, title,
          frontmatter, search_text, content_hash
        )
        values (
          'wiki', 'phase1-backup.md', '/wiki/phase1-backup', 'wiki',
          'Phase 1 backup', '{\"title\":\"Phase 1 backup\"}',
          'phase 1 backup', '$phase1_revision_hash'
        )
        returning id into phase1_article_id;

        insert into article_revisions (
          article_id, revision_number, markdown_source, body,
          frontmatter, content_hash, source_kind
        )
        values (
          phase1_article_id, 1,
          E'---\ntitle: Phase 1 backup\n---\nphase1 backup body\n',
          E'phase1 backup body\n',
          '{\"title\":\"Phase 1 backup\"}', '$phase1_revision_hash', 'backfill'
        )
        returning id into phase1_revision_id;

        update articles
        set current_revision_id = phase1_revision_id
        where id = phase1_article_id;

        insert into users (account, password_hash)
        values ('phase1backup', 'test-only')
        returning id into phase1_user_id;

        insert into drafts (
          article_id, owner_user_id, collection, title, body,
          base_content_hash, base_revision_id
        )
        values (
          phase1_article_id, phase1_user_id, 'wiki',
          'Phase 1 backup draft', 'draft body',
          '$phase1_revision_hash', phase1_revision_id
        );
      end
      \$\$;
    " | docker compose exec -T postgres psql \
    --username "$test_user" \
    --dbname "$source_database" \
    --set ON_ERROR_STOP=1
  ./scripts/backup.sh
)

backup_directory="$(
  find "$backup_root" -mindepth 1 -maxdepth 1 -type d \
    -name "${source_project}-*" -print -quit
)"
[ -n "$backup_directory" ] || {
  printf '未找到测试备份目录\n' >&2
  exit 1
}
grep -qx 'format=vinci-cms-backup-v2' "${backup_directory}/manifest.env"
test -f "${backup_directory}/.vinci-backup-owner"
test -f "${backup_root}/.vinci-state/latest-success.json"
test -f "${backup_root}/.vinci-state/owner"
(
  cd -- "$backup_directory"
  sha256sum --check --strict SHA256SUMS
)
(
  cd -- "$source_directory"
  ./scripts/backup-verify.sh "$backup_directory"
)
test -f "${backup_directory}/.vinci-integrity-verified"

backup_count_before="$(
  find "$backup_root" -mindepth 1 -maxdepth 1 -type d \
    -name "${source_project}-*" | wc -l
)"
mkdir -p "${source_directory}/.deploy/operation.lock"
if (
  cd -- "$source_directory"
  ./scripts/backup.sh
) > "${test_root}/backup-lock.log" 2>&1; then
  printf '备份互斥锁错误地允许并发运行\n' >&2
  exit 1
fi
grep -q '已有部署、备份或恢复操作正在执行' "${test_root}/backup-lock.log"
rmdir "${source_directory}/.deploy/operation.lock"
test "$(
  find "$backup_root" -mindepth 1 -maxdepth 1 -type d \
    -name "${source_project}-*" | wc -l
)" = "$backup_count_before"

if (
  cd -- "$source_directory"
  BACKUP_MIN_FREE_BYTES=999999999999999999 \
  BACKUP_CRITICAL_FREE_BYTES=999999999999999999 \
    ./scripts/backup.sh
) > "${test_root}/backup-disk.log" 2>&1; then
  printf '备份错误地忽略了磁盘保护阈值\n' >&2
  exit 1
fi
grep -q '备份磁盘剩余空间低于保护阈值' "${test_root}/backup-disk.log"
grep -q 'BACKUP_DISK_CRITICAL' "${backup_root}/.vinci-state/alerts.jsonl"
test "$(
  find "$backup_root" -mindepth 1 -maxdepth 1 -type d \
    -name "${source_project}-*" | wc -l
)" = "$backup_count_before"

real_docker="$(command -v docker)"
mkdir -p "${test_root}/retry-bin"
retry_counter="${test_root}/retry-counter"
{
  printf '%s\n' '#!/usr/bin/env bash'
  printf '%s\n' 'set -Eeuo pipefail'
  printf '%s\n' 'if printf "%s\n" "$*" | grep -q "pg_dump"; then'
  printf '  count="$(cat %q 2>/dev/null || printf 0)"\n' "$retry_counter"
  printf '%s\n' '  count=$((count + 1))'
  printf '  printf "%%s\\n" "$count" > %q\n' "$retry_counter"
  printf '%s\n' '  if [ "$count" -le 2 ]; then exit 1; fi'
  printf '%s\n' 'fi'
  printf 'exec %q "$@"\n' "$real_docker"
} > "${test_root}/retry-bin/docker"
chmod 0755 "${test_root}/retry-bin/docker"
sleep 1
(
  cd -- "$source_directory"
  PATH="${test_root}/retry-bin:${PATH}" \
  BACKUP_RETRY_ATTEMPTS=3 \
  BACKUP_RETRY_DELAY_SECONDS=0 \
    ./scripts/backup.sh
)
test "$(cat "$retry_counter")" = 3
grep -q 'BACKUP_DUMP_RETRY' "${backup_root}/.vinci-state/alerts.jsonl"
test "$(
  find "$backup_root" -mindepth 1 -maxdepth 1 -type d \
    -name "${source_project}-*" | wc -l
)" = "$((backup_count_before + 1))"

(
  cd -- "$target_directory"
  docker compose config --quiet
  docker compose up --detach --wait postgres
  target_container="$(docker compose ps -q postgres)"
  test "$(
    docker inspect --format \
      '{{ index .Config.Labels "com.docker.compose.project" }}' \
      "$target_container"
  )" = "$target_project"

  RESTORE_CONFIRM="${target_project}:${target_database}" \
    ./scripts/restore.sh "$backup_directory"
  docker compose --profile tools run --rm migrate
  docker compose up --detach --wait app-blue gateway

  marker_count="$(
    docker compose exec -T postgres psql \
      --username "$test_user" \
      --dbname "$target_database" \
      --tuples-only --no-align \
      --command "select count(*) from audit_logs where action = 'phase9.restore.marker'"
  )"
  marker_count="${marker_count//$'\r'/}"
  marker_count="${marker_count//$'\n'/}"
  test "$marker_count" = 1
  revision_count="$(
    printf '%s\n' "
        select count(*)
        from article_revisions r
        join articles a on a.current_revision_id = r.id
        join drafts d on d.base_revision_id = r.id
        where r.revision_number = 1
          and r.content_hash = '$phase1_revision_hash'
          and r.markdown_source =
            E'---\ntitle: Phase 1 backup\n---\nphase1 backup body\n';
      " | docker compose exec -T postgres psql \
      --username "$test_user" \
      --dbname "$target_database" \
      --tuples-only --no-align
  )"
  revision_count="${revision_count//$'\r'/}"
  revision_count="${revision_count//$'\n'/}"
  test "$revision_count" = 1
  curl --fail --silent --show-error \
    "http://127.0.0.1:${target_port}/api/health" >/dev/null
  (
    cd -- "$source_directory"
    RECOVERY_VERIFICATION_CONFIRM="RECOVERABLE:$(basename -- "$backup_directory")" \
      ./scripts/backup-mark-recoverable.sh "$backup_directory"
  )
  test -f "${backup_directory}/.vinci-verified"

  if RESTORE_CONFIRM="${target_project}:${target_database}" \
    ./scripts/restore.sh "$backup_directory" \
    > "${test_root}/second-restore.log" 2>&1; then
    printf '恢复脚本错误地接受了非空目标数据库\n' >&2
    exit 1
  fi
  grep -q '目标数据库不是空库' "${test_root}/second-restore.log"

  source_volume="${source_project}_postgres_data"
  target_volume="${target_project}_postgres_data"
  test "$source_volume" != "$target_volume"
  docker volume inspect "$source_volume" "$target_volume" >/dev/null
)

instance_root="${test_root}/test-instance-packages"
(
  cd -- "$source_directory"
  INSTANCE_EXPORT_ROOT="$instance_root" \
    ./vinci export-instance "--backup=${backup_directory}"
)
instance_package="$(find "$instance_root" -mindepth 1 -maxdepth 1 -type d -name '*test*-instance-*' -print -quit)"
[ -n "$instance_package" ] || {
  printf '未生成名称含 test 的阶段 11 迁移包\n' >&2
  exit 1
}
test -f "$instance_package/instance-manifest.env"
test -f "$instance_package/code-repository.bundle"
test -f "$instance_package/database-backup/postgresql.dump"
if find "$instance_package" -type f \( -name '.env' -o -name '*private*' -o -name '*token*' \) -print -quit | grep -q .; then
  printf '迁移包错误包含明文配置或私钥/Token 文件\n' >&2
  exit 1
fi

(
  cd -- "$migration_directory"
  docker compose config --quiet
  docker compose up --detach --wait postgres s3-test
  s3_container="$(docker compose ps -q s3-test)"
  s3_mapping="$(docker inspect --format \
    '{{(index (index .NetworkSettings.Ports "45519/tcp") 0).HostIp}}:{{(index (index .NetworkSettings.Ports "45519/tcp") 0).HostPort}}' \
    "$s3_container")"
  [ "$s3_mapping" = "127.0.0.1:${s3_test_port}" ] \
    || { printf 'S3 test service is not on its exact loopback port: %s\n' "$s3_mapping" >&2; exit 1; }
  docker compose exec -T s3-test node -e \
    "fetch('http://127.0.0.1:45519/phase11-test-bucket',{method:'HEAD'}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
  import_confirm="IMPORT:$(basename -- "$instance_package"):${migration_project}:${migration_database}"
  VINCI_INSTANCE_TEST_MODE=true \
    ./vinci import-instance "$instance_package" "--confirm=${import_confirm}"
  curl --fail --silent --show-error \
    "http://127.0.0.1:${migration_port}/api/health" >/dev/null
  marker_count="$(
    docker compose exec -T postgres psql --username "$test_user" \
      --dbname "$migration_database" --tuples-only --no-align \
      --command "select count(*) from audit_logs where action = 'phase9.restore.marker'"
  )"
  marker_count="${marker_count//$'\r'/}"
  marker_count="${marker_count//$'\n'/}"
  test "$marker_count" = 1
)

deploy_origin="$test_root/phase11-deploy-origin-test.git"
git init --quiet --bare "$deploy_origin"
git -C "$source_directory" remote add origin "$deploy_origin"
deploy_commit_one="$(git -C "$source_directory" rev-parse HEAD)"
printf 'phase11-bluegreen-test-two\n' > "$source_directory/phase11-deploy-test-marker.txt"
git -C "$source_directory" add phase11-deploy-test-marker.txt
git -C "$source_directory" commit --quiet --message 'phase 11 blue green test second commit'
deploy_commit_two="$(git -C "$source_directory" rev-parse HEAD)"
sed -i '/^  app-green:/i\    healthcheck:\n      test: ["CMD", "false"]\n      interval: 1s\n      timeout: 1s\n      retries: 1\n      start_period: 0s' \
  "$source_directory/tests/fixtures/v2-phase11-isolation.compose.yaml"
git -C "$source_directory" add tests/fixtures/v2-phase11-isolation.compose.yaml
git -C "$source_directory" commit --quiet --message 'phase 11 blue green test failing candidate'
deploy_commit_three="$(git -C "$source_directory" rev-parse HEAD)"
git -C "$source_directory" push --quiet origin main
for deploy_tag in "$deploy_commit_one" "$deploy_commit_two" "$deploy_commit_three"; do
  docker image tag "${runtime_image}:${image_tag}" "${runtime_image}:${deploy_tag}"
  docker image tag "${operations_image}:${image_tag}" "${operations_image}:${deploy_tag}"
  deploy_image_tags+=("$deploy_tag")
done
{
  printf 'DEPLOY_GIT_REMOTE_URL=%s\n' "$deploy_origin"
  printf 'DEPLOY_CACHE_CLEANUP_ENABLED=false\n'
  printf 'CMS_GIT_BRANCH=main\n'
} >> "$source_directory/.env"

(
  cd -- "$source_directory"
  for deploy_commit in "$deploy_commit_one" "$deploy_commit_two"; do
    DEPLOY_COMMIT="$deploy_commit" DEPLOY_MODE=application \
      APP_IMAGE="$runtime_image" APP_OPS_IMAGE="$operations_image" \
      APP_IMAGE_TAG="$deploy_commit" ./scripts/deploy.sh
  done
  grep -Fqx "commit=${deploy_commit_two}" .deploy/current
  grep -Fqx 'slot=green' .deploy/current
  grep -Fqx "commit=${deploy_commit_one}" .deploy/rollback-verified
  curl --fail --silent --show-error \
    "http://127.0.0.1:${source_port}/api/health" >/dev/null
  if DEPLOY_COMMIT="$deploy_commit_three" DEPLOY_MODE=application \
    APP_IMAGE="$runtime_image" APP_OPS_IMAGE="$operations_image" \
    APP_IMAGE_TAG="$deploy_commit_three" ./scripts/deploy.sh \
    > "$test_root/phase11-bluegreen-failure-test.log" 2>&1; then
    printf 'failing blue candidate unexpectedly deployed\n' >&2
    exit 1
  fi
  grep -Fqx "commit=${deploy_commit_two}" .deploy/current
  grep -Fqx 'slot=green' .deploy/current
  test "$(git rev-parse HEAD)" = "$deploy_commit_two"
  curl --fail --silent --show-error \
    "http://127.0.0.1:${source_port}/api/health" >/dev/null
)

printf '%s\n' \
  'backup-restore integration test passed: checksum, empty-target restore,' \
  'forward migration, restored marker, app health, non-empty refusal, isolated volumes,' \
  'phase 11 export/import package, separate secrets, migration health/storage doctor,' \
  'actual local-image blue/green update, verified rollback marker and failed-candidate rollback'
