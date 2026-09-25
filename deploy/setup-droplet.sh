#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 24.04 DigitalOcean Droplet.
# Run from the hearth-intake-app folder on the droplet:
#   sudo bash deploy/setup-droplet.sh
# It installs Docker, opens only ports 22/80/443, writes .env.production
# with freshly generated secrets (asking for your domain), and starts Hearth.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Firewall: allow SSH, HTTP, HTTPS only"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

if [ ! -f .env.production ]; then
  IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
  SUGGEST="$(echo "$IP" | tr . -).sslip.io"
  read -r -p "Domain for Hearth [${SUGGEST}]: " DOMAIN
  DOMAIN=${DOMAIN:-$SUGGEST}
  cp .env.production.example .env.production
  sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" .env.production
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env.production
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env.production
  sed -i "s|^EVV_CREDENTIALS_KEY=.*|EVV_CREDENTIALS_KEY=$(openssl rand -hex 32)|" .env.production
  sed -i "s|^APP_BASE_URL=.*|APP_BASE_URL=https://${DOMAIN}|" .env.production
  chmod 600 .env.production
  echo "==> Wrote .env.production (secrets generated). Back up EVV_CREDENTIALS_KEY somewhere safe."
fi

echo "==> Building and starting (first build takes a few minutes)"
docker compose --env-file .env.production up -d --build

echo "==> Waiting for Hearth to report healthy"
for i in $(seq 1 60); do
  if docker compose --env-file .env.production exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    DOMAIN=$(grep '^DOMAIN=' .env.production | cut -d= -f2)
    echo ""
    echo "Hearth is up: https://${DOMAIN}"
    echo "Next: create your platform admin (see deploy/DEPLOY-DIGITALOCEAN.md, step 6)."
    exit 0
  fi
  sleep 5
done
echo "Hearth didn't report healthy yet. Check: docker compose --env-file .env.production logs app"
exit 1
