#!/bin/sh
# Install or update wardogs-plugins as a systemd service.
# Run from the repo checkout (default /opt/wardogs-plugins) as a sudo-capable user.
#
#   sudo ./deploy/install.sh
#
# Idempotent: safe to re-run after `git pull` to rebuild and restart.
set -eu

cd "$(dirname "$0")/.."
REPO="$(pwd)"
UNIT=wardogs-plugins.service

if [ ! -f .env ]; then
  echo "!! $REPO/.env is missing. Copy .env.example and fill in the RCON details first." >&2
  exit 1
fi
if [ ! -f plugins.json ]; then
  echo ".. no plugins.json; starting from plugins.example.json"
  cp plugins.example.json plugins.json
fi

# Service account (no login shell, no home). Skipped if it already exists.
id wardogs >/dev/null 2>&1 || useradd --system --shell /usr/sbin/nologin --no-create-home wardogs

# The checkout is owned by the service user; let root (who runs deploys) use git in it.
git config --global --add safe.directory "$REPO" >/dev/null 2>&1 || true

# Build needs devDependencies (typescript); the runtime has none.
npm ci --no-audit --no-fund
npm run build
mkdir -p "$REPO/data"   # ReadWritePaths in the unit needs it to exist

chown -R wardogs:wardogs "$REPO"
chmod 600 .env

# Point the units at this checkout, then install them (the @ template serves extra instances).
sed "s#/opt/wardogs-plugins#$REPO#g" deploy/$UNIT > /etc/systemd/system/$UNIT
sed "s#/opt/wardogs-plugins#$REPO#g" deploy/wardogs-plugins@.service > /etc/systemd/system/wardogs-plugins@.service
systemctl daemon-reload
systemctl enable --now $UNIT
systemctl restart $UNIT
systemctl --no-pager --lines=5 status $UNIT

# Extra instances (deploy/add-instance.sh) share dist/, so they must pick up the new build too.
for u in $(systemctl list-units --type=service --all --plain --no-legend 'wardogs-plugins@*' 2>/dev/null | awk '{print $1}'); do
  systemctl restart "$u" && echo ".. restarted $u"
done
