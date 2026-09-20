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

# Build needs devDependencies (typescript); the runtime has none.
npm ci --no-audit --no-fund
npm run build
mkdir -p "$REPO/data"   # ReadWritePaths in the unit needs it to exist

chown -R wardogs:wardogs "$REPO"
chmod 600 .env

# Point the unit at this checkout, then install it.
sed "s#/opt/wardogs-plugins#$REPO#g" deploy/$UNIT > /etc/systemd/system/$UNIT
systemctl daemon-reload
systemctl enable --now $UNIT
systemctl restart $UNIT
systemctl --no-pager --lines=5 status $UNIT
