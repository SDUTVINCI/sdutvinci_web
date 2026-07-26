#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
temporary_root="$(mktemp -d)"
trap 'rm -rf -- "$temporary_root"' EXIT

origin="$temporary_root/origin.git"
checkout="$temporary_root/checkout"
fake_bin="$temporary_root/bin"

git init --bare --initial-branch=main "$origin" >/dev/null
git clone "$origin" "$checkout" >/dev/null 2>&1
git -C "$checkout" config user.name 'Auto Deploy Test'
git -C "$checkout" config user.email 'auto-deploy@test.invalid'

mkdir -p "$checkout/scripts" "$checkout/.deploy" "$fake_bin"
cp "$repository_root/scripts/auto-deploy.sh" "$checkout/scripts/auto-deploy.sh"
cp "$repository_root/scripts/classify-deployment.sh" "$checkout/scripts/classify-deployment.sh"
cp "$repository_root/scripts/ops-common.sh" "$checkout/scripts/ops-common.sh"
cp "$repository_root/tests/fixtures/auto-deploy/deploy.sh" "$checkout/scripts/deploy.sh"
cp "$repository_root/tests/fixtures/auto-deploy/docker" "$fake_bin/docker"
chmod 0755 "$checkout/scripts/"*.sh "$fake_bin/docker"

git -C "$checkout" add scripts
git -C "$checkout" commit -m 'initial deployment scripts' >/dev/null
git -C "$checkout" push -u origin main >/dev/null 2>&1

initial_commit="$(git -C "$checkout" rev-parse HEAD)"
printf 'commit=%s\nslot=blue\nmode=application\n' \
  "$initial_commit" \
  > "$checkout/.deploy/current"

export PATH="$fake_bin:$PATH"
export FAKE_AUTO_DEPLOY_ENABLED=false

(
  cd -- "$checkout"
  ./scripts/auto-deploy.sh
)
[ ! -f "$checkout/.deploy/fake-deploy-log" ]
export FAKE_AUTO_DEPLOY_ENABLED=true

(
  cd -- "$checkout"
  ./scripts/auto-deploy.sh
)
[ ! -f "$checkout/.deploy/fake-deploy-log" ]

git -C "$checkout" switch main >/dev/null
mkdir -p "$checkout/content/wiki"
printf '# Content test\n' > "$checkout/content/wiki/auto-deploy.md"
git -C "$checkout" add content/wiki/auto-deploy.md
git -C "$checkout" commit -m 'content test' >/dev/null
git -C "$checkout" push origin main >/dev/null 2>&1
content_commit="$(git -C "$checkout" rev-parse HEAD)"
export FAKE_MISSING_REFERENCE="registry.invalid/vinci/runtime:${content_commit}"

(
  cd -- "$checkout"
  ./scripts/auto-deploy.sh
)
[ ! -f "$checkout/.deploy/fake-deploy-log" ]
unset FAKE_MISSING_REFERENCE

(
  cd -- "$checkout"
  ./scripts/auto-deploy.sh
)
grep -Fqx "commit=${content_commit}" "$checkout/.deploy/fake-deploy-log"
grep -Fqx 'mode=content' "$checkout/.deploy/fake-deploy-log"

git -C "$checkout" switch main >/dev/null
mkdir -p "$checkout/app"
printf '<template>application</template>\n' > "$checkout/app/auto-deploy.vue"
git -C "$checkout" add app/auto-deploy.vue
git -C "$checkout" commit -m 'application test' >/dev/null
git -C "$checkout" push origin main >/dev/null 2>&1
failed_commit="$(git -C "$checkout" rev-parse HEAD)"
touch "$checkout/.deploy/fail-next"

if (
  cd -- "$checkout"
  ./scripts/auto-deploy.sh
); then
  printf 'expected the fake candidate deployment to fail\n' >&2
  exit 1
fi

grep -Fqx "commit=${failed_commit}" "$checkout/.deploy/auto-deploy-failed"
line_count_before="$(wc -l < "$checkout/.deploy/fake-deploy-log")"

(
  cd -- "$checkout"
  ./scripts/auto-deploy.sh
)
line_count_after="$(wc -l < "$checkout/.deploy/fake-deploy-log")"
[ "$line_count_before" = "$line_count_after" ]

git -C "$checkout" switch main >/dev/null
printf '<template>fixed</template>\n' > "$checkout/app/auto-deploy.vue"
git -C "$checkout" add app/auto-deploy.vue
git -C "$checkout" commit -m 'forward fix' >/dev/null
git -C "$checkout" push origin main >/dev/null 2>&1
fixed_commit="$(git -C "$checkout" rev-parse HEAD)"

(
  cd -- "$checkout"
  ./scripts/auto-deploy.sh
)
grep -Fqx "commit=${fixed_commit}" "$checkout/.deploy/fake-deploy-log"
tail -n 1 "$checkout/.deploy/fake-deploy-log" | grep -Fqx 'mode=application'
[ ! -e "$checkout/.deploy/auto-deploy-failed" ]

printf 'auto-deploy integration test passed\n'
