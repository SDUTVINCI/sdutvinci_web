#!/usr/bin/env bash

set -eu

if [ -f .deploy/fail-next ]; then
  rm -- .deploy/fail-next
  exit 1
fi

printf 'commit=%s\nmode=%s\n' \
  "$DEPLOY_COMMIT" \
  "$DEPLOY_MODE" \
  >> .deploy/fake-deploy-log

git switch --detach "$DEPLOY_COMMIT" >/dev/null
printf 'commit=%s\nslot=blue\nmode=%s\n' \
  "$DEPLOY_COMMIT" \
  "$DEPLOY_MODE" \
  > .deploy/current
