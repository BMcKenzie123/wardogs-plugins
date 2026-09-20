#!/bin/sh
# Deploy (or redeploy) to a box over SSH from your own machine.
#
#   deploy/remote-deploy.sh <ssh-host> [.env] [plugins.json]
#
# <ssh-host> is an entry in ~/.ssh/config (e.g. wardogs-box) or user@ip. Root access is required the
# first time (the bootstrap installs packages and the systemd unit). Optional local .env / plugins.json
# are copied to the box before the service (re)starts; omit them to keep whatever is already there.
set -eu

HOST=${1:?usage: deploy/remote-deploy.sh <ssh-host> [.env] [plugins.json]}
ENV_FILE=${2:-}
PLUGINS_FILE=${3:-}
DIR=/opt/wardogs-plugins
BOOTSTRAP=https://raw.githubusercontent.com/BMcKenzie123/wardogs-plugins/main/deploy/bootstrap.sh

echo ">> bootstrap on $HOST"
ssh "$HOST" "curl -fsSL $BOOTSTRAP | sh"

if [ -n "$ENV_FILE" ]; then
  echo ">> copying $ENV_FILE -> $HOST:$DIR/.env"
  scp -q "$ENV_FILE" "$HOST:$DIR/.env"
  ssh "$HOST" "chown wardogs:wardogs $DIR/.env && chmod 600 $DIR/.env"
fi
if [ -n "$PLUGINS_FILE" ]; then
  echo ">> copying $PLUGINS_FILE -> $HOST:$DIR/plugins.json"
  scp -q "$PLUGINS_FILE" "$HOST:$DIR/plugins.json"
  ssh "$HOST" "chown wardogs:wardogs $DIR/plugins.json"
fi

echo ">> restart + status"
ssh "$HOST" "systemctl restart wardogs-plugins && sleep 3 && systemctl --no-pager --lines=15 status wardogs-plugins"
