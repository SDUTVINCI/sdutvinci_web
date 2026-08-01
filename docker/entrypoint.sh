#!/bin/sh
set -eu

exec gosu node "$@"
