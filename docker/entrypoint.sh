#!/bin/sh
set -eu

if [ "$(id -u)" = "$(id -u node)" ]; then
  exec "$@"
fi

exec gosu node "$@"
