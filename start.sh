#!/usr/bin/env bash
# start.sh — One-command startup for Luqen (compliance + branding + llm + dashboard)
#
# Usage:
#   ./start.sh                    # start with defaults
#   ./start.sh --pa11y-url URL    # specify pa11y webservice
#   ./start.sh --port 4000        # custom compliance port (branding = +100, llm = +200, dashboard = +1000)
#
# This script handles first-run setup automatically:
#   - Generates session secret (if not set)
#   - Generates JWT keys for compliance, branding, and llm (if missing)
#   - Seeds baseline compliance data (if not done)
#   - Creates OAuth clients for dashboard↔compliance and dashboard↔branding auth
#   - Starts all services with correct environment variables

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
BRANDING_PORT="${BRANDING_PORT:-4100}"
LLM_PORT="${LLM_PORT:-4200}"
DASHBOARD_PORT="${DASHBOARD_PORT:-5000}"
PA11Y_URL="${DASHBOARD_WEBSERVICE_URL:-http://localhost:3000}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Argument parsing ──────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)       COMPLIANCE_PORT="$2"; BRANDING_PORT=$(( $2 + 100 )); LLM_PORT=$(( $2 + 200 )); DASHBOARD_PORT=$(( $2 + 1000 )); shift 2 ;;
    --pa11y-url)  PA11Y_URL="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: ./start.sh [--port PORT] [--pa11y-url URL]"
      echo ""
      echo "  --port PORT       Compliance port (default: 4000, branding = PORT+100, llm = PORT+200, dashboard = PORT+1000)"
      echo "  --pa11y-url URL   pa11y webservice URL (default: http://localhost:3000)"
      exit 0
      ;;
    *) error "Unknown option: $1"; exit 1 ;;
  esac
done

cd "${ROOT_DIR}"

printf "\n${BOLD}${CYAN}  Luqen — Starting services${RESET}\n\n"

# ── Build (if needed) ─────────────────────────────────
if [ ! -d "packages/dashboard/dist" ] || [ ! -d "packages/compliance/dist" ] || [ ! -d "packages/branding/dist" ] || [ ! -d "packages/llm/dist" ]; then
  info "Building packages..."
  npm run build --workspaces 2>&1 | tail -3
  success "Build complete."
else
  info "Using existing build (run 'npm run build --workspaces' to rebuild)."
fi

# ── JWT keys (compliance) ─────────────────────────────
COMPLIANCE_KEYS_DIR="${ROOT_DIR}/packages/compliance/keys"
if [ ! -f "${COMPLIANCE_KEYS_DIR}/private.pem" ]; then
  info "Generating compliance JWT signing keys..."
  (cd packages/compliance && node dist/cli.js keys generate)
  success "Compliance JWT keys generated."
else
  info "Compliance JWT keys found."
fi

# ── JWT keys (branding) ──────────────────────────────
BRANDING_KEYS_DIR="${ROOT_DIR}/packages/branding/keys"
if [ ! -f "${BRANDING_KEYS_DIR}/private.pem" ]; then
  info "Generating branding JWT signing keys..."
  (cd packages/branding && node dist/cli.js keys generate)
  success "Branding JWT keys generated."
else
  info "Branding JWT keys found."
fi

# ── JWT keys (llm) ───────────────────────────────────
LLM_KEYS_DIR="${ROOT_DIR}/packages/llm/keys"
if [ ! -f "${LLM_KEYS_DIR}/private.pem" ]; then
  info "Generating LLM JWT signing keys..."
  (cd packages/llm && node dist/cli.js keys generate)
  success "LLM JWT keys generated."
else
  info "LLM JWT keys found."
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

# ── OAuth client for dashboard → compliance ───────────
COMPLIANCE_CLIENT_CACHE="${ROOT_DIR}/.oauth-client"
if [ -f "${COMPLIANCE_CLIENT_CACHE}" ]; then
  COMPLIANCE_CLIENT_ID=$(grep "^client_id=" "${COMPLIANCE_CLIENT_CACHE}" | cut -d= -f2-)
  COMPLIANCE_CLIENT_SECRET=$(grep "^client_secret=" "${COMPLIANCE_CLIENT_CACHE}" | cut -d= -f2-)
  info "Compliance OAuth client loaded from .oauth-client"
else
  info "Creating OAuth client for dashboard → compliance..."
  CLIENT_OUT=$(cd packages/compliance && node dist/cli.js clients create --name "dashboard" --scope "admin" --grant "client_credentials" 2>&1)
  COMPLIANCE_CLIENT_ID=$(echo "${CLIENT_OUT}" | grep -oP 'client_id:\s*\K\S+' || echo "")
  COMPLIANCE_CLIENT_SECRET=$(echo "${CLIENT_OUT}" | grep -oP 'client_secret:\s*\K\S+' || echo "")

  if [ -z "${COMPLIANCE_CLIENT_ID}" ] || [ -z "${COMPLIANCE_CLIENT_SECRET}" ]; then
    warn "Could not parse compliance OAuth client output. Dashboard may need manual config."
    warn "Output was: ${CLIENT_OUT}"
  else
    printf "client_id=%s\nclient_secret=%s\n" "${COMPLIANCE_CLIENT_ID}" "${COMPLIANCE_CLIENT_SECRET}" > "${COMPLIANCE_CLIENT_CACHE}"
    chmod 600 "${COMPLIANCE_CLIENT_CACHE}"
    success "Compliance OAuth client created (saved to .oauth-client)"
  fi
fi

# ── OAuth client for dashboard → branding ─────────────
BRANDING_CLIENT_CACHE="${ROOT_DIR}/.branding-oauth-client"
if [ -f "${BRANDING_CLIENT_CACHE}" ]; then
  BRANDING_CLIENT_ID=$(grep "^client_id=" "${BRANDING_CLIENT_CACHE}" | cut -d= -f2-)
  BRANDING_CLIENT_SECRET=$(grep "^client_secret=" "${BRANDING_CLIENT_CACHE}" | cut -d= -f2-)
  info "Branding OAuth client loaded from .branding-oauth-client"
else
  info "Creating OAuth client for dashboard → branding..."
  CLIENT_OUT=$(cd packages/branding && node dist/cli.js clients create --name "dashboard" --scope "admin" --grant "client_credentials" 2>&1)
  BRANDING_CLIENT_ID=$(echo "${CLIENT_OUT}" | grep -oP 'client_id:\s*\K\S+' || echo "")
  BRANDING_CLIENT_SECRET=$(echo "${CLIENT_OUT}" | grep -oP 'client_secret:\s*\K\S+' || echo "")

  if [ -z "${BRANDING_CLIENT_ID}" ] || [ -z "${BRANDING_CLIENT_SECRET}" ]; then
    warn "Could not parse branding OAuth client output. Dashboard may need manual config."
    warn "Output was: ${CLIENT_OUT}"
  else
    printf "client_id=%s\nclient_secret=%s\n" "${BRANDING_CLIENT_ID}" "${BRANDING_CLIENT_SECRET}" > "${BRANDING_CLIENT_CACHE}"
    chmod 600 "${BRANDING_CLIENT_CACHE}"
    success "Branding OAuth client created (saved to .branding-oauth-client)"
  fi
fi

# ── Export environment ────────────────────────────────
export DASHBOARD_COMPLIANCE_URL="http://localhost:${COMPLIANCE_PORT}"
export DASHBOARD_BRANDING_URL="http://localhost:${BRANDING_PORT}"
export DASHBOARD_LLM_URL="http://localhost:${LLM_PORT}"
export DASHBOARD_WEBSERVICE_URL="${PA11Y_URL}"
export DASHBOARD_COMPLIANCE_CLIENT_ID="${COMPLIANCE_CLIENT_ID:-}"
export DASHBOARD_COMPLIANCE_CLIENT_SECRET="${COMPLIANCE_CLIENT_SECRET:-}"
export DASHBOARD_BRANDING_CLIENT_ID="${BRANDING_CLIENT_ID:-}"
export DASHBOARD_BRANDING_CLIENT_SECRET="${BRANDING_CLIENT_SECRET:-}"

# ── Summary ───────────────────────────────────────────
printf "\n"
printf "  ${BOLD}Compliance:${RESET}  http://localhost:${COMPLIANCE_PORT}\n"
printf "  ${BOLD}Branding:${RESET}    http://localhost:${BRANDING_PORT}\n"
printf "  ${BOLD}LLM:${RESET}         http://localhost:${LLM_PORT}\n"
printf "  ${BOLD}Dashboard:${RESET}   http://localhost:${DASHBOARD_PORT}\n"
printf "  ${BOLD}pa11y:${RESET}       ${PA11Y_URL}\n"
printf "\n"

# ── Start services ────────────────────────────────────
info "Starting compliance (port ${COMPLIANCE_PORT}) + branding (port ${BRANDING_PORT}) + llm (port ${LLM_PORT}) + dashboard (port ${DASHBOARD_PORT})..."
printf "\n"

exec npx concurrently \
  -n compliance,branding,llm,dashboard \
  -c blue,yellow,magenta,green \
  "cd packages/compliance && node dist/cli.js serve --port ${COMPLIANCE_PORT}" \
  "cd packages/branding && node dist/cli.js serve --port ${BRANDING_PORT}" \
  "cd packages/llm && node dist/cli.js serve --port ${LLM_PORT}" \
  "node packages/dashboard/dist/cli.js serve --config ${ROOT_DIR}/dashboard.config.json --port ${DASHBOARD_PORT}"
