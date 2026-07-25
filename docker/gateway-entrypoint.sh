#!/bin/sh

set -eu

config="/config/Caddyfile"
default_config="/etc/caddy/Caddyfile.default"

if [ ! -e "$config" ]; then
  cp "$default_config" "$config"
fi

[ -f "$config" ] || {
  echo "Gateway config must be a regular file: $config" >&2
  exit 1
}
[ ! -L "$config" ] || {
  echo "Gateway config must not be a symbolic link: $config" >&2
  exit 1
}

caddy validate --config "$config" --adapter caddyfile
exec caddy run --config "$config" --adapter caddyfile
