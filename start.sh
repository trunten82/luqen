#!/usr/bin/env bash
# start.sh — One-command startup for Luqen (compliance + dashboard)
#
# Usage:
#   ./start.sh                    # start with defaults
#   ./start.sh --pa11y-url URL    # specify pa11y webservice
#   ./start.sh --port 4000        # custom compliance port (dashboard = +1000)
#
# This script handles first-run setup automatically:
#   - Generates session secret (if not set)
#   - Generates JWT keys (if missing)
#   - Seeds baseline compliance data (if not done)
#   - Creates OAuth client for dashboard↔compliance auth (if not done)
#   - Starts both services with correct environment variables

set -euo pipefail

# ── Colors ────────────────────────────────────────────
if [ -t 1 ] && command -v tput &>/dev/null; then
  BOLD="$(tput bold)"; GREEN="$(tput setaf 2)"; YELLOW="$(tput setaf 3)"
  RED="$(tput setaf 1)"; CYAN="$(tput setaf 6)"; DIM="$(tput dim)"; RESET="$(tput sgr0)"
else
  BOLD="" GREEN="" YELLOW="" RED="" CYAN="" DIM="" RESET=""
fi

info()    { printf "%s  %s%s\n" "${CYAN}•${RESET}" "$*" "${RESET}"; }
success() { printf "%s  %s%s\n" "${GREEN}✔${RESET}" "${GREEN}$*" "${RESET}"; }
warn()    { printf "%s  %s%s\n" "${YELLOW}!${RESET}" "${YELLOW}$*" "${RESET}"; }
error()   { printf "%s  %s%s\n" "${RED}✖${RESET}" "${RED}$*" "${RESET}" >&2; }

# ── Defaults ──────────────────────────────────────────
COMPLIANCE_PORT="${COMPLIANCE_PORT:-4000}"
DASHBOARD_PORT="${DASHBOARD_PORT:-5000}"
PA11Y_URL="${DASHBOARD_WEBSERVICE_URL:-http://localhost:3000}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Argument parsing ──────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)       COMPLIANCE_PORT="$2"; DASHBOARD_PORT=$(( $2 + 1000 )); shift 2 ;;
    --pa11y-url)  PA11Y_URL="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: ./start.sh [--port PORT] [--pa11y-url URL]"
      echo ""
      echo "  --port PORT       Compliance port (default: 4000, dashboard = PORT+1000)"
      echo "  --pa11y-url URL   pa11y webservice URL (default: http://localhost:3000)"
      exit 0
      ;;
    *) error "Unknown option: $1"; exit 1 ;;
  esac
done

cd "${ROOT_DIR}"

printf "\n${BOLD}${CYAN}  Luqen — Starting services${RESET}\n\n"

# ── Build (if needed) ─────────────────────────────────
if [ ! -d "packages/dashboard/dist" ] || [ ! -d "packages/compliance/dist" ]; then
  info "Building packages..."
  npm run build --workspaces 2>&1 | tail -3
  success "Build complete."
else
  info "Using existing build (run 'npm run build --workspaces' to rebuild)."
fi

# ── JWT keys ──────────────────────────────────────────
KEYS_DIR="${ROOT_DIR}/packages/compliance/keys"
if [ ! -f "${KEYS_DIR}/private.pem" ]; then
  info "Generating JWT signing keys..."
  (cd packages/compliance && node dist/cli.js keys generate)
  success "JWT keys generated."
else
  info "JWT keys found."
fi

# ── Session secret ────────────────────────────────────
if [ -z "${DASHBOARD_SESSION_SECRET:-}" ]; then
  SECRET_FILE="${ROOT_DIR}/.session-secret"
  if [ -f "${SECRET_FILE}" ]; then
    DASHBOARD_SESSION_SECRET="$(cat "${SECRET_FILE}")"
    info "Session secret loaded from .session-secret"
  else
    DASHBOARD_SESSION_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
    echo "${DASHBOARD_SESSION_SECRET}" > "${SECRET_FILE}"
    chmod 600 "${SECRET_FILE}"
    success "Session secret generated and saved to .session-secret"
  fi
fi
export DASHBOARD_SESSION_SECRET

# ── Seed compliance data ──────────────────────────────
COMPLIANCE_DB="${ROOT_DIR}/packages/compliance/compliance.db"
if [ ! -f "${COMPLIANCE_DB}" ]; then
  info "Seeding baseline compliance data (58 jurisdictions, 62 regulations)..."
  (cd packages/compliance && node dist/cli.js seed)
  success "Compliance data seeded."
else
  info "Compliance database found."
fi

# ── OAuth client for dashboard ────────────────────────
CLIENT_CACHE="${ROOT_DIR}/.oauth-client"
if [ -f "${CLIENT_CACHE}" ]; then
  CLIENT_ID=$(grep "^client_id=" "${CLIENT_CACHE}" | cut -d= -f2-)
  CLIENT_SECRET=$(grep "^client_secret=" "${CLIENT_CACHE}" | cut -d= -f2-)
  info "OAuth client loaded from .oauth-client"
else
  info "Creating OAuth client for dashboard..."
  CLIENT_OUT=$(cd packages/compliance && node dist/cli.js clients create --name "dashboard" --scope "admin" --grant "client_credentials" 2>&1)
  CLIENT_ID=$(echo "${CLIENT_OUT}" | grep -oP 'client_id:\s*\K\S+' || echo "")
  CLIENT_SECRET=$(echo "${CLIENT_OUT}" | grep -oP 'client_secret:\s*\K\S+' || echo "")

  if [ -z "${CLIENT_ID}" ] || [ -z "${CLIENT_SECRET}" ]; then
    warn "Could not parse OAuth client output. Dashboard may need manual config."
    warn "Output was: ${CLIENT_OUT}"
  else
    printf "client_id=%s\nclient_secret=%s\n" "${CLIENT_ID}" "${CLIENT_SECRET}" > "${CLIENT_CACHE}"
    chmod 600 "${CLIENT_CACHE}"
    success "OAuth client created (saved to .oauth-client)"
  fi
fi

# ── Export environment ────────────────────────────────
export DASHBOARD_COMPLIANCE_URL="http://localhost:${COMPLIANCE_PORT}"
export DASHBOARD_WEBSERVICE_URL="${PA11Y_URL}"
export DASHBOARD_COMPLIANCE_CLIENT_ID="${CLIENT_ID:-}"
export DASHBOARD_COMPLIANCE_CLIENT_SECRET="${CLIENT_SECRET:-}"

# ── Summary ───────────────────────────────────────────
printf "\n"
printf "  ${BOLD}Compliance:${RESET}  http://localhost:${COMPLIANCE_PORT}\n"
printf "  ${BOLD}Dashboard:${RESET}   http://localhost:${DASHBOARD_PORT}\n"
printf "  ${BOLD}pa11y:${RESET}       ${PA11Y_URL}\n"
printf "\n"

# ── Start services ────────────────────────────────────
info "Starting compliance (port ${COMPLIANCE_PORT}) + dashboard (port ${DASHBOARD_PORT})..."
printf "\n"

exec npx concurrently \
  -n compliance,dashboard \
  -c blue,green \
  "cd packages/compliance && node dist/cli.js serve --port ${COMPLIANCE_PORT}" \
  "node packages/dashboard/dist/cli.js serve --config ${ROOT_DIR}/dashboard.config.json --port ${DASHBOARD_PORT}"
