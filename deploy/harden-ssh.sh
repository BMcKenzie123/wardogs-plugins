#!/bin/sh
# Turn off SSH password logins once key access is confirmed. Root stays allowed with a key only.
# Run on the box as root AFTER `ssh <box> true` works with your key from another terminal.
set -eu
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/00-wardogs.conf <<CONF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
sshd -t
systemctl restart ssh 2>/dev/null || systemctl restart sshd
sshd -T | grep -E '^(passwordauthentication|permitrootlogin) '
echo "password logins disabled; keys only"
