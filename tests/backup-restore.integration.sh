#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
test_root="$(mktemp -d /tmp/vinci-phase9-backup-restore.XXXXXX)"
source_directory="${test_root}/source-project"
target_directory="${test_root}/target-project"
backup_root="${test_root}/test-backups"
suffix="$$"
source_project="vinci-phase9-backup-source-${suffix}"
target_project="vinci-phase9-restore-target-${suffix}"
source_database="vinci_phase9_backup_source_test"
target_database="vinci_phase9_restore_target_test"
test_user="vinci_phase9_test"
test_password="phase9-test-only-password"
runtime_image="vinci-phase9-runtime-test"
operations_image="vinci-phase9-operations-test"
image_tag="phase9-${suffix}"
target_port="$((43000 + suffix % 1000))"

cleanup() {
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
  rm -rf -- "$test_root"
}
trap cleanup EXIT

for command in docker git realpath sha256sum tar curl; do
  command -v "$command" >/dev/null 2>&1 || {
    printf '缺少测试命令：%s\n' "$command" >&2
    exit 1
  }
done

mkdir -p -- "$source_directory" "$target_directory" "$backup_root"
(
  cd -- "$repository_root"
  git ls-files --cached --others --exclude-standard -z \
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
  } > "${directory}/.env"
  chmod 0600 "${directory}/.env"
}

initialize_snapshot "$source_directory"
initialize_snapshot "$target_directory"
write_environment "$source_directory" "$source_project" "$source_database" 43991
write_environment "$target_directory" "$target_project" "$target_database" \
  "$target_port"
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
(
  cd -- "$backup_directory"
  sha256sum --check --strict SHA256SUMS
)

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

printf '%s\n' \
  'backup-restore integration test passed: checksum, empty-target restore,' \
  'forward migration, restored marker, app health, non-empty refusal, isolated volumes'
