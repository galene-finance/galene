# Public demo host artifacts (ADO-37)

Operator recipe for `demo.galene.finance` beside production. **Marketing site
links are owned by Brand** — do not change `galene-website` / www from this
folder.

## Layout

| Path on host | Purpose |
| --- | --- |
| `/opt/galene` | Production data (**do not use for demo**) |
| `/opt/galene-demo` | Demo data volume |
| `galene-demo.container` | Quadlet unit (`GALENE_DEMO=1`, resource caps, `:latest`) |
| `galene-demo-restore.timer` | Every **6 hours UTC** wipe/restore → re-bootstrap |

The restore script deletes SQLite files with `podman unshare rm` (plain `rm` cannot unlink files owned by the container user) and starts the demo unit from an `EXIT` trap, including when the wipe fails. Reinstall `demo-restore.sh` on the app host after updating; merging git does not restart a running unit.

## Install (app host)

```bash
sudo mkdir -p /opt/galene-demo
sudo chown "$USER:$USER" /opt/galene-demo

install -m 0644 galene-demo.container ~/.config/containers/systemd/
sudo mkdir -p /usr/local/lib/galene
sudo install -m 0755 demo-restore.sh /usr/local/lib/galene/demo-restore.sh
install -m 0644 galene-demo-restore.service galene-demo-restore.timer ~/.config/containers/systemd/
# User timers live under ~/.config/systemd/user/ — copy service+timer there if
# your distro does not pick Quadlet-adjacent units for oneshots:
mkdir -p ~/.config/systemd/user
install -m 0644 galene-demo-restore.service galene-demo-restore.timer ~/.config/systemd/user/

systemctl --user daemon-reload
systemctl --user enable --now galene-demo
systemctl --user enable --now galene-demo-restore.timer
```

Wire TLS + the `Caddyfile.snippet` (or equivalent) so `demo.galene.finance`
proxies to `127.0.0.1:5174`.

## Image tag

- **Intent:** `ghcr.io/galene-finance/galene:latest` + `AutoUpdate=registry`
- **Until demo mode is on main:** temporarily use `:test` for QA, then switch
  the Quadlet `Image=` back to `:latest` after the maintainer ships main.

## Shared login

Bootstrapped on empty DB when `GALENE_DEMO=1`:

- Email: `demo@test.com`
- Password: `demopass1`

## Abuse / resources

- Caddy (or edge) rate limits — see `Caddyfile.snippet`
- App `loginThrottle` still applies
- Quadlet `PodmanArgs` memory/CPU/pids caps
- No real bank / Plaid / SMTP / OIDC secrets on the demo unit
