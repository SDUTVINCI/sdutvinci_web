#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
test_root="$(mktemp -d /tmp/vinci-phase11-install-test.XXXXXX)"
trap 'rm -rf -- "$test_root"' EXIT
checkout="$test_root/checkout"
fake_bin="$test_root/bin"
fake_units="$test_root/systemd"
fake_logrotate="$test_root/logrotate"
fake_state="$test_root/state"
mkdir -p "$checkout/scripts" "$checkout/systemd" "$fake_bin" \
  "$fake_units" "$fake_logrotate" "$fake_state"

cp "$repository_root/vinci" "$checkout/vinci"
cp "$repository_root/scripts/ops-common.sh" "$checkout/scripts/ops-common.sh"
cp "$repository_root/systemd/"* "$checkout/systemd/"
cp "$repository_root/tests/fixtures/install-auto-deploy/command" "$fake_bin/fake-command"
chmod 0755 "$checkout/vinci" "$fake_bin/fake-command"
for command_name in docker find getent install logrotate runuser stat systemctl systemd-analyze; do
  ln -s fake-command "$fake_bin/$command_name"
done

git -C "$checkout" init --initial-branch=main >/dev/null
git -C "$checkout" config user.name 'Phase 11 Install Test'
git -C "$checkout" config user.email 'phase11-install@test.invalid'
git -C "$checkout" remote add origin https://github.invalid/vinci/test.git
git -C "$checkout" add vinci scripts systemd
git -C "$checkout" commit -m 'phase 11 current-user installer test fixture' >/dev/null
printf '%s\n' \
  'COMPOSE_PROJECT_NAME=vinci-phase11-install-test' \
  'APP_IMAGE=registry.invalid/vinci/runtime-test' \
  'APP_OPS_IMAGE=registry.invalid/vinci/operations-test' \
  'POSTGRES_DB=vinci_phase11_install_test' \
  'POSTGRES_USER=vinci_phase11_test' \
  'POSTGRES_PASSWORD=phase11-test-password' \
  'DATABASE_URL=postgresql://vinci_phase11_test:phase11-test-password@postgres:5432/vinci_phase11_install_test' \
  'NUXT_PUBLIC_SITE_URL=http://127.0.0.1:34911' \
  'CMS_AUTH_SECRET=phase11-test-auth-secret-at-least-32-characters' \
  'S3_ENDPOINT=http://127.0.0.1:34912' \
  'S3_REGION=phase11-test' \
  'S3_BUCKET=phase11-test-bucket' \
  'S3_ACCESS_KEY_ID=phase11-test-access' \
  'S3_SECRET_ACCESS_KEY=phase11-test-secret' \
  'S3_PUBLIC_BASE_URL=http://127.0.0.1:34912/phase11-test-bucket' \
  'AUTO_DEPLOY_ENABLED=false' \
  "BACKUP_ROOT=$test_root/backups-test" \
  "INSTANCE_EXPORT_ROOT=$test_root/instances-test" \
  "VINCI_LOG_ROOT=$test_root/logs-test" \
  > "$checkout/.env"
chmod 0600 "$checkout/.env"

export PATH="$fake_bin:$PATH"
export VINCI_INSTALL_TEST_MODE=true
export VINCI_SYSTEMD_UNIT_DIR="$fake_units"
export VINCI_LOGROTATE_DIR="$fake_logrotate"
export FAKE_INSTALLER_LOG="$fake_state/commands.log"
export FAKE_INSTALLER_STATE="$fake_state"
export FAKE_TEST_GROUP=phase11testgroup
export FAKE_REPOSITORY_ROOT="$checkout"

export VINCI_TEST_RUN_USER=phase11alpha
export FAKE_TEST_UID=21001
export FAKE_TEST_GID=21002
export FAKE_TEST_HOME="$test_root/home-alpha-test"
mkdir -p "$FAKE_TEST_HOME"
(
  cd "$checkout"
  ./vinci install --dry-run
)
test ! -e "$checkout/.deploy/install.env"

export VINCI_TEST_RUN_USER=phase11beta
export FAKE_TEST_UID=22001
export FAKE_TEST_GID=22002
export FAKE_TEST_HOME="$test_root/nonstandard-beta-home-test"
mkdir -p "$FAKE_TEST_HOME"
(
  cd "$checkout"
  ./vinci install --systemd-only
)

for unit in auto-deploy backup content-reconcile maintenance-cleanup health; do
  test -f "$fake_units/vinci-cms-${unit}.service"
  grep -Fqx 'User=phase11beta' "$fake_units/vinci-cms-${unit}.service"
  grep -Fqx 'Group=phase11testgroup' "$fake_units/vinci-cms-${unit}.service"
  grep -Fq "WorkingDirectory=$checkout" "$fake_units/vinci-cms-${unit}.service"
done
test -f "$fake_logrotate/vinci-cms"
grep -Fq 'su phase11beta phase11testgroup' "$fake_logrotate/vinci-cms"
grep -Fqx 'user=phase11beta' "$checkout/.deploy/install.env"
grep -Fqx 'uid=22001' "$checkout/.deploy/install.env"
grep -Fqx 'gid=22002' "$checkout/.deploy/install.env"
grep -Fqx "home=${FAKE_TEST_HOME}" "$checkout/.deploy/install.env"
test -f "$fake_state/vinci-cms-auto-deploy.timer.enabled"
test -f "$fake_state/vinci-cms-health.timer.enabled"
if rg -n '@VINCI_|User=vinci-deploy|Group=vinci-deploy|/home/vinci-deploy' \
  "$fake_units" "$fake_logrotate"; then
  printf 'rendered current-user files retained a template or legacy identity\n' >&2
  exit 1
fi

verified_backup="$test_root/verified-backup-test"
mkdir -m 0700 "$verified_backup"
touch "$verified_backup/.vinci-verified"
touch "$verified_backup/.vinci-backup-owner"

external_legacy_root="$test_root/external-legacy-test"
mkdir -p "$external_legacy_root/.git"
rm -f "$fake_state/legacy-chown.executed"
if (
  cd "$checkout"
  ./vinci migrate-legacy-user --legacy-user=phase11legacy \
    --legacy-root="$external_legacy_root" --verified-backup="$verified_backup" \
    --confirm="MIGRATE:phase11legacy:phase11beta:$external_legacy_root"
) >/dev/null 2>&1; then
  printf 'legacy migration accepted a target other than its own repository\n' >&2
  exit 1
fi
test ! -e "$fake_state/legacy-chown.executed"

(
  cd "$checkout"
  ./vinci migrate-legacy-user --legacy-user=phase11legacy \
    --legacy-root="$checkout" --dry-run
  ./vinci migrate-legacy-user --legacy-user=phase11legacy \
    --legacy-root="$checkout" --verified-backup="$verified_backup" \
    --confirm="MIGRATE:phase11legacy:phase11beta:$checkout"
)
test -f "$fake_state/legacy-chown.executed"
grep -Fq 'systemctl disable --now vinci-cms-auto-deploy.timer' "$FAKE_INSTALLER_LOG"
grep -Fq "find $checkout -xdev -user phase11legacy -exec chown 22001:22002 -- {} +" \
  "$FAKE_INSTALLER_LOG"
if rg -n 'userdel|rm -rf' "$FAKE_INSTALLER_LOG"; then
  printf 'legacy migration attempted to delete the user or environment\n' >&2
  exit 1
fi

printf 'phase 11 current-user install test passed: different users, uid/gid/home, dynamic units, logrotate and verified legacy migration\n'
