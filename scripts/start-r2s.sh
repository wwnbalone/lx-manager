#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${LX_MANAGER_ENV_FILE:-/etc/lx-manager.env}

if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
fi

SOURCE_DIR=${SOURCE_BASE_DIR:-"$APP_DIR/sources"}
LOG_PATH=${LOG_DIR:-"$APP_DIR/logs"}

mkdir -p "$SOURCE_DIR" "$LOG_PATH"

cd "$APP_DIR"
exec node app.js
