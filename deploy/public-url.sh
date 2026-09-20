#!/bin/sh
# Put the admin panel on a public HTTPS URL. Caddy terminates TLS with an automatic Let's Encrypt
# certificate and proxies ONLY /admin, /admin/* and /healthz to the app, which is re-bound to loopback.
#
#   sh deploy/public-url.sh <hostname>
#   e.g.  sh deploy/public-url.sh 65-108-108-235.sslip.io      (no domain needed; sslip.io maps the name to the IP)
#         sh deploy/public-url.sh admin.example.com             (your own DNS A record pointing at this box)
#
# Re-run with a different hostname any time. Requires root on a Debian/Ubuntu box set up by bootstrap.sh.
set -eu
HOST=${1:?usage: public-url.sh <hostname>}
DIR=${DIR:-/opt/wardogs-plugins}
export DEBIAN_FRONTEND=noninteractive

if ! command -v caddy >/dev/null 2>&1; then
  echo ">> installing Caddy (official repo)"
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null
  [ -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ] ||
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq >/dev/null
  apt-get install -y -qq caddy >/dev/null
fi

echo ">> Caddyfile for $HOST"
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Frame-Options DENY
		X-Content-Type-Options nosniff
		Referrer-Policy same-origin
	}
	@allowed path /admin /admin/* /healthz
	handle @allowed {
		reverse_proxy 127.0.0.1:8787
	}
	handle {
		respond "not found" 404
	}
}
EOF
caddy validate --config /etc/caddy/Caddyfile >/dev/null

echo ">> app binds loopback only; Caddy is the only public door"
if grep -q '^HTTP_BIND=' "$DIR/.env"; then sed -i 's|^HTTP_BIND=.*|HTTP_BIND=127.0.0.1|' "$DIR/.env"; else printf '\nHTTP_BIND=127.0.0.1\n' >> "$DIR/.env"; fi

echo ">> firewall: 80 (ACME + redirect) and 443"
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null

systemctl enable --now caddy >/dev/null 2>&1
systemctl reload caddy || systemctl restart caddy
systemctl restart wardogs-plugins

echo
echo "public URL: https://$HOST/admin"
echo "First certificate issuance takes ~10-30 s; watch with:  journalctl -u caddy -n 20 -o cat"
