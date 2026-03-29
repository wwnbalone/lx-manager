#!/bin/sh
set -eu

if [ "$(id -u)" != "0" ]; then
    echo "Please run as root." >&2
    exit 1
fi

APP_DIR="/usr/libexec/lx-manager"
INITD_FILE="/etc/init.d/lx-manager"
CONTROLLER_FILE="/usr/lib/lua/luci/controller/lx_manager.lua"
CBI_FILE="/usr/lib/lua/luci/model/cbi/lx_manager.lua"

if [ -x "$INITD_FILE" ]; then
    "$INITD_FILE" stop >/dev/null 2>&1 || true
    "$INITD_FILE" disable >/dev/null 2>&1 || true
fi

rm -f "$INITD_FILE" "$CONTROLLER_FILE" "$CBI_FILE"
rm -rf "$APP_DIR"
rm -f /tmp/luci-indexcache
rm -rf /tmp/luci-modulecache 2>/dev/null || true

echo "LX Manager plugin files removed."
echo "Kept /etc/config/lx-manager and your data directories untouched."
