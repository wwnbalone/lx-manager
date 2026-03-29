#!/bin/sh
set -eu

if [ "$(id -u)" != "0" ]; then
    echo "Please run as root." >&2
    exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

APP_DIR="/usr/libexec/lx-manager"
INITD_FILE="/etc/init.d/lx-manager"
CONFIG_FILE="/etc/config/lx-manager"
CONTROLLER_DIR="/usr/lib/lua/luci/controller"
CBI_DIR="/usr/lib/lua/luci/model/cbi"

need_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

need_cmd cp
need_cmd mkdir
need_cmd rm

if ! command -v node >/dev/null 2>&1; then
    echo "Warning: node is not installed. Install the Node.js package in iStoreOS first." >&2
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "Warning: curl is not installed. Source update will not work until curl is available." >&2
fi

echo "Installing LX Manager LuCI plugin files..."

mkdir -p "$APP_DIR" "$CONTROLLER_DIR" "$CBI_DIR" /etc/config /etc/init.d

rm -rf "$APP_DIR/lib" "$APP_DIR/sources" "$APP_DIR/node_modules"

cp "$REPO_DIR/app.js" "$APP_DIR/app.js"
cp "$REPO_DIR/updater.js" "$APP_DIR/updater.js"
cp "$REPO_DIR/package.json" "$APP_DIR/package.json"
cp -R "$REPO_DIR/lib" "$APP_DIR/lib"
cp -R "$REPO_DIR/sources" "$APP_DIR/sources"
cp -R "$REPO_DIR/node_modules" "$APP_DIR/node_modules"

cp "$REPO_DIR/luci-app-lx-manager/luasrc/controller/lx_manager.lua" "$CONTROLLER_DIR/lx_manager.lua"
cp "$REPO_DIR/luci-app-lx-manager/luasrc/model/cbi/lx_manager.lua" "$CBI_DIR/lx_manager.lua"
cp "$REPO_DIR/luci-app-lx-manager/root/etc/init.d/lx-manager" "$INITD_FILE"
chmod 0755 "$INITD_FILE"

if [ ! -f "$CONFIG_FILE" ]; then
    cp "$REPO_DIR/luci-app-lx-manager/root/etc/config/lx-manager" "$CONFIG_FILE"
    echo "Installed default UCI config to $CONFIG_FILE"
else
    echo "Keeping existing config at $CONFIG_FILE"
fi

rm -f /tmp/luci-indexcache
rm -rf /tmp/luci-modulecache 2>/dev/null || true

if [ -x "$INITD_FILE" ]; then
    "$INITD_FILE" enable >/dev/null 2>&1 || true
fi

echo "Install complete."
echo "Open LuCI -> Services -> LX Manager"
echo "Recommended next step: change source/log directories to external storage."
