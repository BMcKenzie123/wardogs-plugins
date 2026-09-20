#!/bin/sh
# Set one value in /opt/wardogs-plugins/.env without it touching your shell history or a chat window.
#   ssh -t <box> "sh /opt/wardogs-plugins/deploy/set-secret.sh RCON_PASSWORD"
# Prompts with echo off, writes the value (any characters are fine), restarts the service.
set -eu
KEY=${1:?usage: set-secret.sh <KEY> [instance]   e.g. RCON_PASSWORD, DISCORD_WEBHOOK_URL, STEAM_API_KEY; instance = a name from deploy/add-instance.sh}
INSTANCE=${2:-}
if [ -n "$INSTANCE" ]; then
  ENV_FILE=${ENV_FILE:-/opt/wardogs-plugins/instances/$INSTANCE/.env}
  SERVICE=${SERVICE:-wardogs-plugins@$INSTANCE}
else
  ENV_FILE=${ENV_FILE:-/opt/wardogs-plugins/.env}
  SERVICE=${SERVICE:-wardogs-plugins}
fi
[ -f "$ENV_FILE" ] || { echo "!! $ENV_FILE does not exist" >&2; exit 1; }
printf '%s: ' "$KEY"
stty -echo 2>/dev/null || true
read -r VALUE
stty echo 2>/dev/null || true
echo
[ -n "$VALUE" ] || { echo "empty value, nothing changed" >&2; exit 1; }
KEY="$KEY" VALUE="$VALUE" ENV_FILE="$ENV_FILE" node -e '
const fs = require("fs");
const { KEY, VALUE, ENV_FILE } = process.env;
let s = fs.readFileSync(ENV_FILE, "utf8");
const line = `${KEY}=${VALUE}`;
const re = new RegExp(`^${KEY}=.*$`, "m");
s = re.test(s) ? s.replace(re, () => line) : `${s.replace(/\n?$/, "\n")}${line}\n`;
fs.writeFileSync(ENV_FILE, s);
'
chown wardogs:wardogs "$ENV_FILE" 2>/dev/null || true
chmod 600 "$ENV_FILE"
echo "$KEY saved to $ENV_FILE"
if [ "${NO_RESTART:-0}" != 1 ] && command -v systemctl >/dev/null 2>&1; then
  systemctl restart "$SERVICE" && echo "$SERVICE restarted"
fi
