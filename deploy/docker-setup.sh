#!/bin/bash
# Quick Docker setup for Luqen
set -euo pipefail

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Generating .env file..."
  SESSION_SECRET=$(openssl rand -hex 32)
  cat > "$ENV_FILE" <<EOF
SESSION_SECRET=$SESSION_SECRET
COMPLIANCE_PORT=4000
DASHBOARD_PORT=5000
# PA11Y_URL=http://your-pa11y:3000  # Optional: external pa11y webservice
EOF
  echo "Created .env with generated session secret"
fi

echo "Starting Luqen..."
docker compose up -d --build

echo ""
echo "Waiting for services..."
sleep 10

echo ""
echo "Dashboard: http://localhost:${DASHBOARD_PORT:-5000}"
echo "Compliance: http://localhost:${COMPLIANCE_PORT:-4000}"
echo ""
echo "Check status: docker compose ps"
echo "View logs: docker compose logs -f"
