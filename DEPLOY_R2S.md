# R2S Deployment

This project can run on `r2s` with either Debian/Armbian `systemd` or OpenWrt `procd`.

## Recommended Layout

Keep the code on the system partition and keep sources/logs on external storage.

- App directory: `/opt/lx-manager`
- Data directory: `/data/lx-manager`
- Sources: `/data/lx-manager/sources`
- Logs: `/data/lx-manager/logs`
- Env file: `/etc/lx-manager.env`

If your `r2s` mounts the disk elsewhere, change the paths in `/etc/lx-manager.env`.

## 1. Install Runtime

Install Node.js 18+ first. On Debian/Armbian:

```bash
apt update
apt install -y nodejs npm
```

On OpenWrt, install `node` and `npm` from your package source if available, or use your existing runtime.

## 2. Copy Project And Install Dependencies

```bash
mkdir -p /opt
cp -r /path/to/lx_manager /opt/lx-manager
cd /opt/lx-manager
npm ci --omit=dev
```

## 3. Prepare Data Directories

Use an SSD, TF card data partition, or USB disk. Do not keep growing logs and source snapshots on small router flash.

```bash
mkdir -p /data/lx-manager/sources
mkdir -p /data/lx-manager/logs
cp /opt/lx-manager/deploy/r2s/lx-manager.env.example /etc/lx-manager.env
```

Edit `/etc/lx-manager.env` and at least confirm:

- `HOST=0.0.0.0`
- `PORT=4000`
- `SOURCE_BASE_DIR=/data/lx-manager/sources`
- `LOG_DIR=/data/lx-manager/logs`
- `PROXY_URL=http://127.0.0.1:7890` only if the router itself runs a proxy

## 4. Start With systemd

For Debian/Armbian:

```bash
cp /opt/lx-manager/deploy/r2s/lx-manager.service /etc/systemd/system/lx-manager.service
systemctl daemon-reload
systemctl enable --now lx-manager
systemctl status lx-manager
```

## 5. Start With OpenWrt init.d

For OpenWrt:

```bash
cp /opt/lx-manager/deploy/r2s/lx-manager.openwrt.init /etc/init.d/lx-manager
chmod +x /etc/init.d/lx-manager
/etc/init.d/lx-manager enable
/etc/init.d/lx-manager start
/etc/init.d/lx-manager status
```

## 6. Verify

Check locally on the router:

```bash
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/custom-source.js
```

Then open from another machine:

```bash
curl http://<r2s-ip>:4000/health
```

If that fails, check firewall rules and whether the service is really listening on `0.0.0.0`.

## 7. Logs

Application logs go into `LOG_DIR`, default naming:

- `lx-manager-YYYY-MM-DD.log`

The app already rotates by file size and total size, and deletes old files by retention days.

Useful commands:

```bash
tail -f /data/lx-manager/logs/lx-manager-$(date +%F).log
journalctl -u lx-manager -f
```

On OpenWrt:

```bash
logread -f
```

## 8. Upgrade

```bash
cd /opt/lx-manager
systemctl stop lx-manager
cp -r /path/to/new/lx_manager/* /opt/lx-manager/
npm ci --omit=dev
systemctl start lx-manager
```

OpenWrt uses `/etc/init.d/lx-manager stop` and `start` instead of `systemctl`.

## Notes

- If upstream audio source APIs are unstable, set `PROXY_URL` only when the router has a working outbound proxy.
- The service keeps LX client compatibility unchanged. The extra validation and source filtering happen only on the server side.
- If you want automatic source updates on the router, run `node updater.js` by cron and keep the data directory on external storage.
