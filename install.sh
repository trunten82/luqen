#!/usr/bin/env bash
# install.sh — one-line installer for Luqen
# Usage (local):  curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash
# Usage (docker): curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash -s -- --docker
# Options:
#   --docker          use Docker Compose instead of local Node.js
#   --port PORT       override compliance port (default: 4000); dashboard uses PORT+1000
#   --pa11y-url URL   set the pa11y webservice URL (default: http://localhost:3000)
#   --no-seed         skip baseline seeding
#   --help            show this help

set -euo pipefail

# ──────────────────────────────────────────────
# Color helpers
# ──────────────────────────────────────────────
if [ -t 1 ] && command -v tput &>/dev/null; then
  BOLD="$(tput bold)"
  GREEN="$(tput setaf 2)"
  YELLOW="$(tput setaf 3)"
  RED="$(tput setaf 1)"
  CYAN="$(tput setaf 6)"
  RESET="$(tput sgr0)"
else
  BOLD="" GREEN="" YELLOW="" RED="" CYAN="" RESET=""
fi

info()    { printf "%s  %s%s\n"    "${CYAN}•${RESET}"   "$*"        "${RESET}"; }
success() { printf "%s  %s%s\n"    "${GREEN}✔${RESET}"  "${GREEN}$*" "${RESET}"; }
warn()    { printf "%s  %s%s\n"    "${YELLOW}!${RESET}"  "${YELLOW}$*" "${RESET}"; }
error()   { printf "%s  %s%s\n"    "${RED}✖${RESET}"    "${RED}$*"   "${RESET}" >&2; }
header()  { printf "\n%s%s%s\n\n" "${BOLD}${CYAN}" "$*" "${RESET}"; }

# ──────────────────────────────────────────────
# Defaults
# ──────────────────────────────────────────────
DOCKER_MODE=false
COMPLIANCE_PORT=4000
DASHBOARD_PORT=5000
PA11Y_URL="http://localhost:3000"
SEED=true
REPO_URL="https://github.com/trunten82/luqen.git"
INSTALL_DIR="${HOME}/luqen"

# ──────────────────────────────────────────────
# Argument parsing
# ──────────────────────────────────────────────
show_help() {
  cat <<EOF
${BOLD}Luqen Installer${RESET}

Usage:
  curl -fsSL ${REPO_URL}/raw/master/install.sh | bash
  curl -fsSL ${REPO_URL}/raw/master/install.sh | bash -s -- [OPTIONS]

Options:
  --docker          Use Docker Compose instead of local Node.js
  --port PORT       Override compliance port (default: 4000); dashboard uses PORT+1000
  --pa11y-url URL   Set the pa11y webservice URL (default: http://localhost:3000)
  --no-seed         Skip baseline seeding
  --help            Show this help message
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker)     DOCKER_MODE=true; shift ;;
    --port)       COMPLIANCE_PORT="$2"; DASHBOARD_PORT=$(( $2 + 1000 )); shift 2 ;;
    --pa11y-url)  PA11Y_URL="$2"; shift 2 ;;
    --no-seed)    SEED=false; shift ;;
    --help|-h)    show_help ;;
    *)            error "Unknown option: $1"; show_help ;;
  esac
done

# ──────────────────────────────────────────────
# Shared: clone or pull repo
# ──────────────────────────────────────────────
clone_or_pull() {
  if [ -d "${INSTALL_DIR}/.git" ]; then
    info "Repository already exists at ${INSTALL_DIR} — pulling latest changes..."
    git -C "${INSTALL_DIR}" pull --ff-only
    success "Repository updated."
  else
    info "Cloning repository to ${INSTALL_DIR}..."
    git clone "${REPO_URL}" "${INSTALL_DIR}"
    success "Repository cloned."
  fi
}

# ──────────────────────────────────────────────
# LOCAL DEPLOYMENT
# ──────────────────────────────────────────────
local_install() {
  header "Luqen — Local Installation"

  # ── Prerequisites ──────────────────────────
  info "Checking prerequisites..."

  if ! command -v node &>/dev/null; then
    error "Node.js is not installed. Please install Node.js 20+ from https://nodejs.org"
    exit 1
  fi

  NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
  if [ "${NODE_MAJOR}" -lt 20 ]; then
    error "Node.js 20+ is required. Found: $(node --version)"
    exit 1
  fi
  success "Node.js $(node --version) detected."

  if ! command -v npm &>/dev/null; then
    error "npm is not installed. Please install npm."
    exit 1
  fi
  success "npm $(npm --version) detected."

  if ! command -v git &>/dev/null; then
    error "git is not installed. Please install git."
    exit 1
  fi
  success "git $(git --version | awk '{print $3}') detected."

  # ── Clone / Pull ───────────────────────────
  clone_or_pull

  cd "${INSTALL_DIR}"

  # ── npm install ────────────────────────────
  info "Installing npm dependencies..."
  npm install --prefer-offline 2>&1 | tail -3
  success "Dependencies installed."

  # ── Build ──────────────────────────────────
  info "Building all packages..."
  npm run build --workspaces 2>&1 | grep -E '(error|warning|Built|tsc|done)' || true
  success "Build complete."

  # ── JWT keys ───────────────────────────────
  KEYS_DIR="${INSTALL_DIR}/packages/compliance/keys"
  if [ -f "${KEYS_DIR}/private.pem" ] && [ -f "${KEYS_DIR}/public.pem" ]; then
    warn "JWT keys already exist at ${KEYS_DIR} — skipping generation."
  else
    info "Generating JWT RS256 key pair..."
    mkdir -p "${KEYS_DIR}"
    (cd "${INSTALL_DIR}/packages/compliance" && node dist/cli.js keys generate)
    success "JWT keys generated at ${KEYS_DIR}"
  fi

  # ── Seed ───────────────────────────────────
  if [ "${SEED}" = "true" ]; then
    info "Seeding baseline compliance data..."
    DB_PATH="${INSTALL_DIR}/packages/compliance/compliance.db"
    if [ -f "${DB_PATH}" ]; then
      warn "Database already exists — seed will be idempotent (no duplicates)."
    fi
    (cd "${INSTALL_DIR}/packages/compliance" && node dist/cli.js seed)
    success "Baseline data seeded."
  else
    warn "Skipping baseline seeding (--no-seed)."
  fi

  # ── OAuth client ───────────────────────────
  CLIENT_CACHE="${INSTALL_DIR}/.install-client"
  if [ -f "${CLIENT_CACHE}" ]; then
    warn "OAuth client already created (cached in ${CLIENT_CACHE})."
    CLIENT_ID=$(grep "^client_id=" "${CLIENT_CACHE}" | cut -d= -f2-)
    CLIENT_SECRET=$(grep "^client_secret=" "${CLIENT_CACHE}" | cut -d= -f2-)
  else
    info "Creating default OAuth2 client..."
    CLIENT_OUT=$(cd "${INSTALL_DIR}/packages/compliance" && node dist/cli.js clients create --name "luqen-dashboard" --scope "read write")
    CLIENT_ID=$(echo "${CLIENT_OUT}" | grep "client_id:" | awk '{print $2}')
    CLIENT_SECRET=$(echo "${CLIENT_OUT}" | grep "client_secret:" | awk '{print $2}')
    printf "client_id=%s\nclient_secret=%s\n" "${CLIENT_ID}" "${CLIENT_SECRET}" > "${CLIENT_CACHE}"
    chmod 600 "${CLIENT_CACHE}"
    success "OAuth2 client created."
  fi

  # ── Print quickstart ───────────────────────
  cat <<EOF

${GREEN}${BOLD}═══════════════════════════════════════════════════════${RESET}
${GREEN}${BOLD}  Luqen installed successfully!${RESET}
${GREEN}${BOLD}═══════════════════════════════════════════════════════${RESET}

${BOLD}Installation directory:${RESET}  ${INSTALL_DIR}

${BOLD}Start services:${RESET}

  # Terminal 1 — Compliance service (port ${COMPLIANCE_PORT})
  cd ${INSTALL_DIR}/packages/compliance
  COMPLIANCE_PORT=${COMPLIANCE_PORT} node dist/cli.js serve

  # Terminal 2 — Dashboard (port ${DASHBOARD_PORT})
  cd ${INSTALL_DIR}/packages/dashboard
  DASHBOARD_PORT=${DASHBOARD_PORT} \\
    DASHBOARD_COMPLIANCE_URL=http://localhost:${COMPLIANCE_PORT} \\
    DASHBOARD_WEBSERVICE_URL=${PA11Y_URL} \\
    DASHBOARD_COMPLIANCE_CLIENT_ID=${CLIENT_ID} \\
    DASHBOARD_COMPLIANCE_CLIENT_SECRET=${CLIENT_SECRET} \\
    DASHBOARD_SESSION_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))") \\
    node dist/cli.js serve

${BOLD}Access URLs:${RESET}

  Dashboard:   ${CYAN}http://localhost:${DASHBOARD_PORT}${RESET}
  Compliance:  ${CYAN}http://localhost:${COMPLIANCE_PORT}${RESET}
  API docs:    ${CYAN}http://localhost:${COMPLIANCE_PORT}/docs${RESET}

${BOLD}OAuth2 credentials (save these):${RESET}

  client_id:     ${YELLOW}${CLIENT_ID}${RESET}
  client_secret: ${YELLOW}${CLIENT_SECRET}${RESET}
  (also saved to: ${INSTALL_DIR}/.install-client)

${BOLD}pa11y webservice:${RESET}  ${PA11Y_URL}
  (Ensure pa11y-webservice is running before scanning)

EOF
}

# ──────────────────────────────────────────────
# DOCKER DEPLOYMENT
# ──────────────────────────────────────────────
docker_install() {
  header "Luqen — Docker Installation"

  # ── Prerequisites ──────────────────────────
  info "Checking prerequisites..."

  if ! command -v docker &>/dev/null; then
    error "Docker is not installed. Please install Docker from https://docs.docker.com/get-docker/"
    exit 1
  fi
  success "Docker $(docker --version | awk '{print $3}' | tr -d ',') detected."

  # Support both old `docker-compose` and new `docker compose`
  if docker compose version &>/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
  else
    error "Docker Compose is not installed. Please install Docker Compose."
    exit 1
  fi
  success "Docker Compose detected (${COMPOSE_CMD})."

  if ! command -v git &>/dev/null; then
    error "git is not installed. Please install git."
    exit 1
  fi
  success "git $(git --version | awk '{print $3}') detected."

  # ── Clone / Pull ───────────────────────────
  clone_or_pull

  cd "${INSTALL_DIR}"

  # ── Apply port / URL overrides to .env ─────
  ENV_FILE="${INSTALL_DIR}/.env"
  # Create or update .env (idempotent)
  touch "${ENV_FILE}"

  set_env_var() {
    local key="$1" val="$2"
    if grep -q "^${key}=" "${ENV_FILE}" 2>/dev/null; then
      sed -i "s|^${key}=.*|${key}=${val}|" "${ENV_FILE}"
    else
      echo "${key}=${val}" >> "${ENV_FILE}"
    fi
  }

  set_env_var "LUQEN_WEBSERVICE_URL" "${PA11Y_URL}"
  # Port overrides: rebuild compose with custom ports if changed
  if [ "${COMPLIANCE_PORT}" != "4000" ]; then
    set_env_var "COMPLIANCE_PORT" "${COMPLIANCE_PORT}"
    warn "Custom compliance port ${COMPLIANCE_PORT} set in .env"
    warn "You may need to update docker-compose.yml ports manually for external exposure."
  fi
  if [ "${DASHBOARD_PORT}" != "5000" ]; then
    set_env_var "DASHBOARD_PORT" "${DASHBOARD_PORT}"
    warn "Custom dashboard port ${DASHBOARD_PORT} set in .env"
    warn "You may need to update docker-compose.yml ports manually for external exposure."
  fi

  success ".env configured."

  # ── Docker Compose up ──────────────────────
  info "Building and starting containers (this may take a few minutes)..."
  ${COMPOSE_CMD} up -d --build
  success "Containers started."

  # ── Wait for health checks ─────────────────
  info "Waiting for compliance service to be healthy..."
  ATTEMPTS=0
  MAX_ATTEMPTS=30
  until docker inspect --format='{{.State.Health.Status}}' luqen-compliance 2>/dev/null | grep -q "healthy"; do
    ATTEMPTS=$(( ATTEMPTS + 1 ))
    if [ "${ATTEMPTS}" -ge "${MAX_ATTEMPTS}" ]; then
      error "Compliance service did not become healthy within 90 seconds."
      error "Check logs with: ${COMPOSE_CMD} logs compliance"
      exit 1
    fi
    printf "."
    sleep 3
  done
  printf "\n"
  success "Compliance service is healthy."

  info "Waiting for dashboard to be healthy..."
  ATTEMPTS=0
  until docker inspect --format='{{.State.Health.Status}}' luqen-dashboard 2>/dev/null | grep -q "healthy"; do
    ATTEMPTS=$(( ATTEMPTS + 1 ))
    if [ "${ATTEMPTS}" -ge "${MAX_ATTEMPTS}" ]; then
      error "Dashboard did not become healthy within 90 seconds."
      error "Check logs with: ${COMPOSE_CMD} logs dashboard"
      exit 1
    fi
    printf "."
    sleep 3
  done
  printf "\n"
  success "Dashboard is healthy."

  # ── Seed + create client in container ──────
  CLIENT_CACHE="${INSTALL_DIR}/.install-client"

  if [ "${SEED}" = "true" ]; then
    info "Seeding baseline compliance data inside container..."
    docker exec luqen-compliance node dist/cli.js seed
    success "Baseline data seeded."
  else
    warn "Skipping baseline seeding (--no-seed)."
  fi

  if [ -f "${CLIENT_CACHE}" ]; then
    warn "OAuth client already created (cached in ${CLIENT_CACHE})."
    CLIENT_ID=$(grep "^client_id=" "${CLIENT_CACHE}" | cut -d= -f2-)
    CLIENT_SECRET=$(grep "^client_secret=" "${CLIENT_CACHE}" | cut -d= -f2-)
  else
    info "Creating default OAuth2 client inside container..."
    CLIENT_OUT=$(docker exec luqen-compliance node dist/cli.js clients create --name "luqen-dashboard" --scope "read write")
    CLIENT_ID=$(echo "${CLIENT_OUT}" | grep "client_id:" | awk '{print $2}')
    CLIENT_SECRET=$(echo "${CLIENT_OUT}" | grep "client_secret:" | awk '{print $2}')
    printf "client_id=%s\nclient_secret=%s\n" "${CLIENT_ID}" "${CLIENT_SECRET}" > "${CLIENT_CACHE}"
    chmod 600 "${CLIENT_CACHE}"
    success "OAuth2 client created."
  fi

  # ── Print access URLs ──────────────────────
  cat <<EOF

${GREEN}${BOLD}═══════════════════════════════════════════════════════${RESET}
${GREEN}${BOLD}  Luqen (Docker) installed successfully!${RESET}
${GREEN}${BOLD}═══════════════════════════════════════════════════════${RESET}

${BOLD}Installation directory:${RESET}  ${INSTALL_DIR}

${BOLD}Access URLs:${RESET}

  Dashboard:   ${CYAN}http://localhost:${DASHBOARD_PORT}${RESET}
  Compliance:  ${CYAN}http://localhost:${COMPLIANCE_PORT}${RESET}
  API docs:    ${CYAN}http://localhost:${COMPLIANCE_PORT}/docs${RESET}

${BOLD}OAuth2 credentials (save these):${RESET}

  client_id:     ${YELLOW}${CLIENT_ID}${RESET}
  client_secret: ${YELLOW}${CLIENT_SECRET}${RESET}
  (also saved to: ${INSTALL_DIR}/.install-client)

${BOLD}pa11y webservice:${RESET}  ${PA11Y_URL}

${BOLD}Useful commands:${RESET}

  View logs:         ${COMPOSE_CMD} -f ${INSTALL_DIR}/docker-compose.yml logs -f
  Stop services:     ${COMPOSE_CMD} -f ${INSTALL_DIR}/docker-compose.yml down
  Restart services:  ${COMPOSE_CMD} -f ${INSTALL_DIR}/docker-compose.yml restart
  Update & rebuild:  cd ${INSTALL_DIR} && git pull && ${COMPOSE_CMD} up -d --build

EOF
}

# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────
if [ "${DOCKER_MODE}" = "true" ]; then
  docker_install
else
  local_install
fi
