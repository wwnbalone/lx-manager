# Local Install On iStoreOS

If you only need local installation on your own `r2s`, you do not need iStore store metadata or app publishing.

This repository already contains:

- the LuCI plugin files
- the `procd` service script
- a local install script

## 1. Prepare The Router

Install the runtime dependencies on iStoreOS first:

```sh
opkg update
opkg install node curl
```

If `node` is already installed from iStore, you can skip it.

## 2. Copy The Project To The Router

From your current machine:

```bash
scp -r /home/st/lx_manager root@<r2s-ip>:/root/lx_manager
```

## 3. Run The Installer On iStoreOS

SSH into the router and run:

```sh
cd /root/lx_manager
sh scripts/install-istoreos-local.sh
```

The script installs:

- app runtime into `/usr/libexec/lx-manager`
- LuCI controller into `/usr/lib/lua/luci/controller`
- LuCI CBI page into `/usr/lib/lua/luci/model/cbi`
- service script into `/etc/init.d/lx-manager`
- default config into `/etc/config/lx-manager` if it does not already exist

## 4. Configure In LuCI

Open:

- `Services -> LX Manager`

Recommended changes on `r2s`:

- `Sources Directory`: `/mnt/sda1/lx-manager/sources`
- `Log Directory`: `/mnt/sda1/lx-manager/logs`
- `Enable`: checked

If your router itself has a working proxy, optionally fill:

- `Outbound Proxy URL`: `http://127.0.0.1:7890`

## 5. Start The Service

Either use the LuCI page buttons, or:

```sh
uci set lx-manager.main.enabled='1'
uci commit lx-manager
/etc/init.d/lx-manager restart
```

## 6. Verify

```sh
curl http://127.0.0.1:4000/health
```

Then from another device:

```sh
curl http://<r2s-ip>:4000/custom-source.js
```

Use that subscription URL in LX Music.

## 7. Update Sources Manually

You can trigger a one-time update either from LuCI or with:

```sh
/etc/init.d/lx-manager update
```

## 8. Uninstall

If you want to remove only the plugin files:

```sh
cd /root/lx_manager
sh scripts/uninstall-istoreos-local.sh
```

This keeps:

- `/etc/config/lx-manager`
- your source data directory
- your log directory
