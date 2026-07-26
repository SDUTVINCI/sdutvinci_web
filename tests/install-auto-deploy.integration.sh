#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
temporary_root="$(mktemp -d)"
trap 'rm -rf -- "$temporary_root"' EXIT

checkout="$temporary_root/checkout"
fake_bin="$temporary_root/bin"
fake_units="$temporary_root/systemd"
fake_state="$temporary_root/state"

mkdir -p \
  "$checkout/scripts" \
  "$checkout/systemd" \
  "$checkout/.deploy" \
  "$fake_bin" \
  "$fake_units" \
  "$fake_state"

cp "$repository_root/scripts/install-auto-deploy.sh" \
  "$checkout/scripts/install-auto-deploy.sh"
cp "$repository_root/scripts/auto-deploy.sh" \
  "$checkout/scripts/auto-deploy.sh"
cp "$repository_root/systemd/vinci-cms-auto-deploy.service" \
  "$checkout/systemd/vinci-cms-auto-deploy.service"
cp "$repository_root/systemd/vinci-cms-auto-deploy.timer" \
  "$checkout/systemd/vinci-cms-auto-deploy.timer"
cp "$repository_root/tests/fixtures/install-auto-deploy/command" \
  "$fake_bin/fake-command"

chmod 0755 \
  "$checkout/scripts/"*.sh \
  "$fake_bin/fake-command"

for command_name in \
  docker \
  getent \
  id \
  install \
  journalctl \
  runuser \
  systemctl \
  systemd-analyze; do
  ln -s fake-command "$fake_bin/$command_name"
done

git -C "$checkout" init --initial-branch=main >/dev/null
git -C "$checkout" config user.name 'Installer Test'
git -C "$checkout" config user.email 'installer@test.invalid'
git -C "$checkout" remote add origin https://github.com/example/vinci.git
git -C "$checkout" add scripts systemd
git -C "$checkout" commit -m 'installer fixture' >/dev/null

current_commit="$(git -C "$checkout" rev-parse HEAD)"
printf 'commit=%s\nslot=blue\nmode=application\n' \
  "$current_commit" \
  > "$checkout/.deploy/current"
printf '%s\n' \
  'AUTO_DEPLOY_ENABLED=true' \
  'DEPLOY_GIT_REMOTE_URL=https://github.com/example/vinci.git' \
  > "$checkout/.env"
chmod 0600 "$checkout/.env"

export FAKE_INSTALLER_LOG="$fake_state/commands.log"
export FAKE_INSTALLER_STATE="$fake_state"
export PATH="$fake_bin:$PATH"
export VINCI_CMS_DEPLOY_USER=vinci-deploy
export VINCI_CMS_INSTALLER_TEST_MODE=true
export VINCI_CMS_ROOT="$checkout"
export VINCI_CMS_SYSTEMD_UNIT_DIR="$fake_units"

export FAKE_AUTO_DEPLOY_ENABLED=false
if "$checkout/scripts/install-auto-deploy.sh"; then
  printf 'expected disabled AUTO_DEPLOY_ENABLED to reject installation\n' >&2
  exit 1
fi
test ! -e "$fake_state/timer-enabled"

export FAKE_AUTO_DEPLOY_ENABLED=true
"$checkout/scripts/install-auto-deploy.sh"

test -f "$fake_units/vinci-cms-auto-deploy.service"
test -f "$fake_units/vinci-cms-auto-deploy.timer"
test -f "$fake_state/timer-enabled"
grep -Fqx 'systemctl start vinci-cms-auto-deploy.service' \
  "$FAKE_INSTALLER_LOG"
grep -Fqx 'systemctl enable --now vinci-cms-auto-deploy.timer' \
  "$FAKE_INSTALLER_LOG"

"$checkout/scripts/install-auto-deploy.sh" --status
"$checkout/scripts/install-auto-deploy.sh" --disable
test ! -e "$fake_state/timer-enabled"

: > "$FAKE_INSTALLER_LOG"
export FAKE_INSTALLER_START_FAIL=true

if "$checkout/scripts/install-auto-deploy.sh"; then
  printf 'expected failed first service run to reject timer enable\n' >&2
  exit 1
fi

test ! -e "$fake_state/timer-enabled"
if grep -Fq 'systemctl enable --now vinci-cms-auto-deploy.timer' \
  "$FAKE_INSTALLER_LOG"; then
  printf 'timer was enabled after a failed first service run\n' >&2
  exit 1
fi

printf 'install-auto-deploy integration test passed\n'
