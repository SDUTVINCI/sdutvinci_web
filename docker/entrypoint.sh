#!/bin/sh
set -eu

worktree="${CMS_GIT_WORKTREE:-/var/lib/vinci-cms/worktree}"
expected_worktree="/var/lib/vinci-cms/worktree"
ssh_source="/run/secrets/cms_git_ssh_key"
known_hosts_source="/run/secrets/cms_git_known_hosts"
ssh_directory="/home/node/.ssh"
ssh_key="${ssh_directory}/cms_git_ssh_key"

if [ "$worktree" != "$expected_worktree" ]; then
  echo "CMS_GIT_WORKTREE must be ${expected_worktree} inside the application container." >&2
  exit 1
fi

mkdir -p "$worktree"
chown node:node "$worktree"

if [ -e "$ssh_source" ] || [ -e "$known_hosts_source" ]; then
  if [ ! -f "$ssh_source" ] || [ ! -f "$known_hosts_source" ]; then
    echo "Both CMS Git SSH key and known_hosts must be mounted together." >&2
    exit 1
  fi

  install -d -m 0700 -o node -g node "$ssh_directory"
  install -m 0600 -o node -g node "$ssh_source" "$ssh_key"
  install -m 0644 -o node -g node "$known_hosts_source" "${ssh_directory}/known_hosts"
  export CMS_GIT_SSH_KEY_PATH="$ssh_key"
fi

exec gosu node "$@"
