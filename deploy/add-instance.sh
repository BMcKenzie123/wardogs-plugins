#!/bin/sh
# Add another game server to this box. Each instance has its own .env, plugins.json, data/, HTTP port
# and panel path, and shares the built code with the primary. Idempotent: re-run to repair.
#
#   sudo sh deploy/add-instance.sh eu 8788
#   sudo sh deploy/set-secret.sh RCON_HOST eu        # then RCON_PORT eu and RCON_PASSWORD eu
#
# Result: service wardogs-plugins@eu, panel at https://<host>/eu/admin, health at /eu/healthz.
set -eu
NAME=${1:?usage: add-instance.sh <name> <http-port>   e.g. add-instance.sh eu 8788}
PORT=${2:?usage: add-instance.sh <name> <http-port>}
case "$NAME" in *[!a-z0-9-]*) echo "!! name must be lowercase letters, digits and dashes" >&2; exit 1 ;; esac

cd "$(dirname "$0")/.."
REPO="$(pwd)"
DIR="$REPO/instances/$NAME"
PRIMARY="$REPO/.env"
[ -f "$PRIMARY" ] || { echo "!! $PRIMARY is missing; set up the primary server first (deploy/install.sh)" >&2; exit 1; }
[ -f "$REPO/dist/index.js" ] || { echo "!! no build in $REPO/dist; run deploy/install.sh first" >&2; exit 1; }

mkdir -p "$DIR/data"

if [ ! -f "$DIR/.env" ]; then
  # Same admins, Steam key, Discord settings and polling as the primary; RCON details are placeholders
  # (the host starts anyway and keeps trying until they are real).
  grep -E '^(ADMIN_USERS|ADMIN_PASSWORD|STEAM_API_KEY|DISCORD_WEBHOOK_URL|DISCORD_BOT_TOKEN|POLL_MS|AUDIT_POLL_MS|LOG_LEVEL|RCON_TIMEOUT_MS)=' "$PRIMARY" > "$DIR/.env" || true
  cat >> "$DIR/.env" <<EOF
RCON_HOST=127.0.0.1
RCON_PORT=1
RCON_SCHEME=http
RCON_PASSWORD=CHANGE_ME
DATA_DIR=$DIR/data
PLUGINS_FILE=$DIR/plugins.json
HTTP_PORT=$PORT
HTTP_BIND=127.0.0.1
TZ=UTC
EOF
  echo ".. wrote $DIR/.env (RCON details are placeholders: deploy/set-secret.sh RCON_HOST $NAME, RCON_PORT $NAME, RCON_PASSWORD $NAME)"
fi

if [ ! -f "$DIR/plugins.json" ]; then
  # Start from the primary's config: same plugins and copy, with the unit name and the URL paths adjusted.
  SRC="$REPO/plugins.json"
  [ -f "$SRC" ] || SRC="$REPO/plugins.example.json"
  NAME="$NAME" SRC="$SRC" DST="$DIR/plugins.json" node -e '
    const fs = require("fs");
    const { NAME, SRC, DST } = process.env;
    const up = NAME.toUpperCase();
    const j = JSON.parse(fs.readFileSync(SRC, "utf8").split("TAW WARDOGS NA").join(`TAW WARDOGS ${up}`));
    const setPath = (p, v) => { if (j[p]) j[p].path = v; };
    setPath("admin-panel", `/${NAME}/admin`);
    setPath("health-endpoint", `/${NAME}/healthz`);
    setPath("prometheus-metrics", `/${NAME}/metrics`);
    setPath("web-dashboard", `/${NAME}/`);
    if (j["admin-panel"]) {
      j["admin-panel"].label = up;
      j["admin-panel"].otherPanels = [{ name: "NA", url: "/admin" }];
    }
    fs.writeFileSync(DST, JSON.stringify(j, null, 2) + "\n");
  '
  echo ".. wrote $DIR/plugins.json (panel /$NAME/admin, health /$NAME/healthz)"
fi

chown -R wardogs:wardogs "$DIR"
chmod 600 "$DIR/.env"

# The template unit, pointed at this checkout; one service per instance name.
sed "s#/opt/wardogs-plugins#$REPO#g" deploy/wardogs-plugins@.service > /etc/systemd/system/wardogs-plugins@.service
systemctl daemon-reload
systemctl enable --now "wardogs-plugins@$NAME" >/dev/null 2>&1 || true
systemctl restart "wardogs-plugins@$NAME"

# Caddy: route this instance's panel and health check next to the primary's (once).
CADDY=/etc/caddy/Caddyfile
if [ -f "$CADDY" ] && ! grep -q "# instance:$NAME " "$CADDY"; then
  NAME="$NAME" PORT="$PORT" CADDY="$CADDY" node -e '
    const fs = require("fs");
    const { NAME, PORT, CADDY } = process.env;
    const id = NAME.replace(/-/g, "_");
    let s = fs.readFileSync(CADDY, "utf8");
    const block = `\t# instance:${NAME} (added by deploy/add-instance.sh)\n\t@inst_${id} path /${NAME}/admin /${NAME}/admin/* /${NAME}/healthz\n\thandle @inst_${id} {\n\t\treverse_proxy 127.0.0.1:${PORT}\n\t}\n`;
    const at = s.lastIndexOf("\thandle {");
    if (at < 0) throw new Error(`no catch-all handle block in ${CADDY}`);
    fs.writeFileSync(CADDY, s.slice(0, at) + block + s.slice(at));
  '
  caddy validate --config "$CADDY" >/dev/null && systemctl reload caddy
  echo ".. Caddy routes /$NAME/admin and /$NAME/healthz to 127.0.0.1:$PORT"
fi

systemctl --no-pager --lines=3 status "wardogs-plugins@$NAME" || true
echo
echo "Instance $NAME is up. Give it its server: sudo sh deploy/set-secret.sh RCON_HOST $NAME (then RCON_PORT $NAME, RCON_PASSWORD $NAME)."
