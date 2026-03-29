# iStoreOS Plugin

This repository now includes an OpenWrt/iStoreOS package skeleton:

- `luci-app-lx-manager/`

For local installation on your own router, you can skip store metadata entirely and use:

- [INSTALL_ISTOREOS_LOCAL.md](./INSTALL_ISTOREOS_LOCAL.md)
- `scripts/install-istoreos-local.sh`

It provides:

- a LuCI page under `Services -> LX Manager`
- a `procd` service script
- a UCI config file
- packaging logic to bundle the current Node.js app, source files, and runtime dependencies

## What This Covers

This package is suitable for:

- iStoreOS 24.10
- OpenWrt 23.05 / 24.10 style systems
- manual `ipk` build and installation

## What It Does Not Yet Cover

This repository does not include the iStore app-store metadata package layer.

iStore app cards usually use a separate `app-meta-*` package in the `openwrt-app-meta` style feed. That is a different repository concern from the LuCI app itself. The LuCI plugin here is the functional package; store listing metadata can be added later if you want it to show up as a polished iStore card.

## Package Layout

The package copies these runtime files into `/usr/libexec/lx-manager/`:

- `app.js`
- `updater.js`
- `lib/`
- `sources/`
- `node_modules/`
- `package.json`

The service entrypoints are:

- `/etc/init.d/lx-manager`
- `/etc/config/lx-manager`

## Default Runtime Paths

The package defaults are conservative:

- sources: `/etc/lx-manager/sources`
- logs: `/var/log/lx-manager`

On `r2s`, you should usually change them in LuCI to an external disk path, for example:

- `/mnt/sda1/lx-manager/sources`
- `/mnt/sda1/lx-manager/logs`

## Build Notes

In an OpenWrt/iStoreOS SDK or full buildroot, place this repository as a feed or symlink the package directory:

```bash
ln -s /path/to/lx_manager/luci-app-lx-manager package/luci-app-lx-manager
```

Then select and build:

```bash
make menuconfig
make package/luci-app-lx-manager/compile V=s
```

## After Install

1. Open LuCI: `Services -> LX Manager`
2. Set external storage paths if needed
3. Enable the service
4. Start or restart it from the page
5. Copy the subscription URL shown on the page into LX Music

## Optional Next Step

If you want, the next step can be:

1. add a dedicated iStore `app-meta-lx-manager` package for store display
2. add a proper logo/icon
3. make the LuCI page show live status and last update result with AJAX
