#!/bin/sh
# Bootstrap a fresh Debian/Ubuntu box (Hetzner, DigitalOcean, …) into a running wardogs-plugins host.
#
#   curl -fsSL https://raw.githubusercontent.com/BMcKenzie123/wardogs-plugins/main/deploy/bootstrap.sh | sh
#
# What it does, idempotently:
#   1. apt: git, curl, ufw; Node.js 22 from NodeSource if the box has no Node >= 20
#   2. system user `wardogs`; repo cloned (or pulled) into /opt/wardogs-plugins
#   3. placeholder .env / plugins.json if none exist (you fill in the RCON details afterwards)
#   4. ufw: allow SSH only. The admin panel / metrics port stays local; reach it over an SSH tunnel.
#   5. deploy/install.sh: npm ci, build, systemd unit enabled and started
set -eu

REPO_URL=${REPO_URL:-https://github.com/BMcKenzie123/wardogs-plugins.git}
DIR=${DIR:-/opt/wardogs-plugins}
export DEBIAN_FRONTEND=noninteractive

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi

echo ">> packages"
apt-get update -y -qq
apt-get install -y -qq ca-certificates curl git ufw >/dev/null

need_node=1
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'Number(process.versions.node.split(".")[0])')
  [ "$major" -ge 20 ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  echo ">> Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "   node $(node -v), npm $(npm -v)"

echo ">> service user + checkout"
id wardogs >/dev/null 2>&1 || useradd --system --shell /usr/sbin/nologin --no-create-home wardogs
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  # The directory may already hold a .env / plugins.json copied in ahead of time; clone beside it and merge.
  rm -rf "$DIR.clone"
  git clone -q "$REPO_URL" "$DIR.clone"
  mkdir -p "$DIR"
  cp -a "$DIR.clone/." "$DIR/"
  rm -rf "$DIR.clone"
fi
cd "$DIR"
[ -f .env ] || { cp .env.example .env; echo "   wrote placeholder .env  <- put your RCON host/port/password in it"; }
[ -f plugins.json ] || { cp plugins.example.json plugins.json; echo "   wrote plugins.json from the example"; }

echo ">> firewall: SSH only (panel/metrics reachable via ssh -L)"
ufw allow OpenSSH >/dev/null
ufw --force enable >/dev/null

echo ">> install service"
sh ./deploy/install.sh

cat <<EOF

Done. Next:
  nano $DIR/.env                       # RCON_HOST / RCON_PORT / RCON_PASSWORD (+ ADMIN_PASSWORD, HTTP_PORT=8787)
  systemctl restart wardogs-plugins     # apply
  journalctl -u wardogs-plugins -f      # watch it connect
Admin panel from your PC:  ssh -L 8787:127.0.0.1:8787 root@<this box>   then open http://127.0.0.1:8787/admin
EOF
