#!/usr/bin/env bash
# install.sh — interactive installer for Luqen
# Usage:  curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash
# Flags:  --docker, --port PORT, --pa11y-url URL, --no-seed, --non-interactive, --help

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
  DIM="$(tput dim)"
  RESET="$(tput sgr0)"
else
  BOLD="" GREEN="" YELLOW="" RED="" CYAN="" DIM="" RESET=""
fi

info()    { printf "%s  %s%s\n"   "${CYAN}•${RESET}"    "$*"          "${RESET}"; }
success() { printf "%s  %s%s\n"   "${GREEN}✔${RESET}"   "${GREEN}$*"  "${RESET}"; }
warn()    { printf "%s  %s%s\n"   "${YELLOW}!${RESET}"   "${YELLOW}$*" "${RESET}"; }
error()   { printf "%s  %s%s\n"   "${RED}✖${RESET}"     "${RED}$*"    "${RESET}" >&2; }
header()  { printf "\n%s%s%s\n\n" "${BOLD}${CYAN}"       "$*"          "${RESET}"; }

# ──────────────────────────────────────────────
# Defaults
# ──────────────────────────────────────────────
DOCKER_MODE=""
COMPLIANCE_PORT=4000
DASHBOARD_PORT=5000
PA11Y_URL=""
PA11Y_DOCKER=false
SEED=true
INTERACTIVE=true
REPO_URL="https://github.com/trunten82/luqen.git"
INSTALL_DIR="${HOME}/luqen"

# Modules (all enabled by default)
MOD_COMPLIANCE=true
MOD_DASHBOARD=true
MOD_MONITOR=false

# Plugins
PLUGIN_AUTH_ENTRA=false
PLUGIN_NOTIFY_SLACK=false
PLUGIN_NOTIFY_TEAMS=false
PLUGIN_NOTIFY_EMAIL=false
PLUGIN_STORAGE_S3=false
PLUGIN_STORAGE_AZURE=false

# Admin user
ADMIN_USERNAME=""
ADMIN_PASSWORD=""

# ──────────────────────────────────────────────
# Argument parsing
# ──────────────────────────────────────────────
show_help() {
  cat <<EOF
${BOLD}Luqen Installer${RESET}

Usage:
  curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash

Interactive wizard runs by default. Pass flags to skip interactive prompts:

Options:
  --docker              Use Docker Compose instead of local Node.js
  --local               Use local Node.js installation
  --port PORT           Override compliance port (default: 4000); dashboard = PORT+1000
  --pa11y-url URL       Existing pa11y webservice URL
  --pa11y-docker        Create a new pa11y webservice via Docker
  --no-seed             Skip baseline seeding
  --non-interactive     Skip all prompts (use defaults + flags)
  --install-dir DIR     Installation directory (default: ~/luqen)
  --help                Show this help message

Modules (default: compliance + dashboard):
  --with-monitor        Include the regulatory monitor agent

Plugins:
  --with-auth-entra     Install Azure Entra ID SSO plugin
  --with-notify-slack   Install Slack notification plugin
  --with-notify-teams   Install Teams notification plugin
  --with-notify-email   Install Email notification plugin
  --with-storage-s3     Install AWS S3 storage plugin
  --with-storage-azure  Install Azure Blob storage plugin
  --with-all-plugins    Install all plugins

Storage adapter:
  # Future: --db-adapter <sqlite|postgres|mongodb>
  # Currently only SQLite is supported (default, no configuration needed).
  # PostgreSQL and MongoDB adapters will be available as plugins.
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker)           DOCKER_MODE=docker; shift ;;
    --local)            DOCKER_MODE=local; shift ;;
    --port)             COMPLIANCE_PORT="$2"; DASHBOARD_PORT=$(( $2 + 1000 )); shift 2 ;;
    --pa11y-url)        PA11Y_URL="$2"; shift 2 ;;
    --pa11y-docker)     PA11Y_DOCKER=true; shift ;;
    --no-seed)          SEED=false; shift ;;
    --non-interactive)  INTERACTIVE=false; shift ;;
    --install-dir)      INSTALL_DIR="$2"; shift 2 ;;
    --with-monitor)     MOD_MONITOR=true; shift ;;
    --with-auth-entra)     PLUGIN_AUTH_ENTRA=true; shift ;;
    --with-notify-slack)   PLUGIN_NOTIFY_SLACK=true; shift ;;
    --with-notify-teams)   PLUGIN_NOTIFY_TEAMS=true; shift ;;
    --with-notify-email)   PLUGIN_NOTIFY_EMAIL=true; shift ;;
    --with-storage-s3)     PLUGIN_STORAGE_S3=true; shift ;;
    --with-storage-azure)  PLUGIN_STORAGE_AZURE=true; shift ;;
    --with-all-plugins)
      PLUGIN_AUTH_ENTRA=true; PLUGIN_NOTIFY_SLACK=true; PLUGIN_NOTIFY_TEAMS=true
      PLUGIN_NOTIFY_EMAIL=true; PLUGIN_STORAGE_S3=true; PLUGIN_STORAGE_AZURE=true
      shift ;;
    --help|-h) show_help ;;
    *) error "Unknown option: $1"; show_help ;;
  esac
done

# ──────────────────────────────────────────────
# Interactive prompt helpers
# ──────────────────────────────────────────────
ask() {
  local prompt="$1" default="$2" var="$3"
  printf "%s %s[%s]%s: " "${BOLD}${prompt}${RESET}" "${DIM}" "${default}" "${RESET}"
  read -r input
  eval "${var}=\"${input:-${default}}\""
}

ask_yn() {
  local prompt="$1" default="$2"
  local yn_hint="[Y/n]"
  [ "${default}" = "n" ] && yn_hint="[y/N]"
  printf "%s %s%s%s: " "${BOLD}${prompt}${RESET}" "${DIM}" "${yn_hint}" "${RESET}"
  read -r input
  input="${input:-${default}}"
  case "${input}" in
    [yY]*) return 0 ;;
    *)     return 1 ;;
  esac
}

ask_choice() {
  local prompt="$1"; shift
  local options=("$@")
  printf "\n%s\n" "${BOLD}${prompt}${RESET}"
  local i=1
  for opt in "${options[@]}"; do
    printf "  %s%d)%s %s\n" "${CYAN}" "${i}" "${RESET}" "${opt}"
    i=$(( i + 1 ))
  done
  printf "\n  %sChoice%s: " "${BOLD}" "${RESET}"
  read -r choice
  echo "${choice}"
}

# ──────────────────────────────────────────────
# INTERACTIVE WIZARD
# ──────────────────────────────────────────────
run_wizard() {
  header "Luqen Installation Wizard"
  printf "  Welcome! This wizard will guide you through setting up Luqen,\n"
  printf "  the enterprise accessibility testing platform.\n\n"

  # ── Step 1: Deployment mode ────────────────────
  local choice
  choice=$(ask_choice "How would you like to deploy Luqen?" \
    "Docker Compose (recommended — all services in containers)" \
    "Local Node.js (requires Node.js 20+)")

  case "${choice}" in
    1) DOCKER_MODE=docker ;;
    2) DOCKER_MODE=local ;;
    *) DOCKER_MODE=docker ;;
  esac
  success "Deployment: ${DOCKER_MODE}"

  # ── Step 1b: Docker deployment type ──────────
  DEPLOY_TEMPLATE="standard"
  if [ "${DOCKER_MODE}" = "docker" ]; then
    printf "\n"
    choice=$(ask_choice "Docker deployment type:" \
      "Minimal — Compliance + Dashboard only (bring your own pa11y)" \
      "Standard — Includes pa11y + MongoDB + Redis (recommended)" \
      "Full — Standard + Monitor agent + PDF generation")

    case "${choice}" in
      1) DEPLOY_TEMPLATE="minimal" ;;
      2) DEPLOY_TEMPLATE="standard"; PA11Y_DOCKER=true; PA11Y_URL="http://pa11y:3000" ;;
      3) DEPLOY_TEMPLATE="full"; PA11Y_DOCKER=true; PA11Y_URL="http://pa11y:3000"; MOD_MONITOR=true ;;
      *) DEPLOY_TEMPLATE="standard"; PA11Y_DOCKER=true; PA11Y_URL="http://pa11y:3000" ;;
    esac
    success "Template: ${DEPLOY_TEMPLATE}"
  fi

  # ── Step 2: pa11y webservice ──────────────────
  # Skip if Docker template already includes pa11y
  if [ "${PA11Y_DOCKER}" = "true" ] && [ "${DOCKER_MODE}" = "docker" ]; then
    info "pa11y webservice included in Docker template."
  else
    printf "\n"
    header "pa11y Webservice"
    printf "  Luqen uses pa11y webservice as its accessibility scan engine.\n"
    printf "  You can connect to an existing instance or create a new one.\n\n"

    choice=$(ask_choice "pa11y webservice setup:" \
      "I have an existing pa11y webservice" \
      "Create a new pa11y webservice via Docker" \
      "Skip — I'll configure it later")

  case "${choice}" in
    1)
      ask "pa11y webservice URL" "http://localhost:3000" PA11Y_URL
      ;;
    2)
      PA11Y_DOCKER=true
      PA11Y_URL="http://localhost:3000"
      success "Will create pa11y webservice via Docker on port 3000"
      ;;
    3|*)
      PA11Y_URL="http://localhost:3000"
      warn "Skipping pa11y setup. Set DASHBOARD_WEBSERVICE_URL later."
      ;;
  esac
  fi

  # ── Step 3: Modules ────────────────────────────
  printf "\n"
  header "Modules"
  printf "  Core modules (always installed): ${BOLD}core${RESET}, ${BOLD}compliance${RESET}, ${BOLD}dashboard${RESET}\n\n"

  if ask_yn "Install the regulatory monitor agent? (watches legal sources for changes)" "n"; then
    MOD_MONITOR=true
    success "Monitor agent: enabled"
  fi

  # ── Step 4: Plugins ────────────────────────────
  printf "\n"
  header "Plugins"
  printf "  Plugins extend Luqen with additional capabilities.\n"
  printf "  You can install plugins now or add them later from Admin > Plugins.\n\n"

  choice=$(ask_choice "Plugin installation:" \
    "Select plugins individually" \
    "Install all plugins" \
    "Skip — I'll install plugins later")

  case "${choice}" in
    1)
      printf "\n"
      if ask_yn "  Azure Entra ID SSO (enterprise single sign-on)" "n"; then
        PLUGIN_AUTH_ENTRA=true
      fi
      if ask_yn "  Slack notifications (scan results to Slack channels)" "n"; then
        PLUGIN_NOTIFY_SLACK=true
      fi
      if ask_yn "  Teams notifications (scan results to Microsoft Teams)" "n"; then
        PLUGIN_NOTIFY_TEAMS=true
      fi
      if ask_yn "  Email reports (scheduled SMTP email delivery)" "y"; then
        PLUGIN_NOTIFY_EMAIL=true
      fi
      if ask_yn "  AWS S3 storage (store reports in S3 buckets)" "n"; then
        PLUGIN_STORAGE_S3=true
      fi
      if ask_yn "  Azure Blob storage (store reports in Azure)" "n"; then
        PLUGIN_STORAGE_AZURE=true
      fi
      ;;
    2)
      PLUGIN_AUTH_ENTRA=true; PLUGIN_NOTIFY_SLACK=true; PLUGIN_NOTIFY_TEAMS=true
      PLUGIN_NOTIFY_EMAIL=true; PLUGIN_STORAGE_S3=true; PLUGIN_STORAGE_AZURE=true
      success "All plugins selected"
      ;;
    3|*)
      info "No plugins selected. Install from Admin > Plugins later."
      ;;
  esac

  # ── Step 5: Ports ──────────────────────────────
  printf "\n"
  header "Configuration"

  ask "Compliance service port" "${COMPLIANCE_PORT}" COMPLIANCE_PORT
  DASHBOARD_PORT=$(( COMPLIANCE_PORT + 1000 ))
  ask "Dashboard port" "${DASHBOARD_PORT}" DASHBOARD_PORT
  ask "Installation directory" "${INSTALL_DIR}" INSTALL_DIR

  # ── Step 6: Admin user ─────────────────────────
  printf "\n"
  header "Admin Account"
  printf "  Create the first admin user now, or log in with the API key later.\n\n"

  if ask_yn "Create an admin user now?" "y"; then
    ask "Admin username" "admin" ADMIN_USERNAME
    while true; do
      printf "  %sAdmin password%s (min 8 chars): " "${BOLD}" "${RESET}"
      read -rs ADMIN_PASSWORD
      printf "\n"
      if [ ${#ADMIN_PASSWORD} -ge 8 ]; then
        break
      fi
      warn "Password must be at least 8 characters. Try again."
    done
    success "Admin user will be created after installation."
  fi

  # ── Step 7: Summary ────────────────────────────
  printf "\n"
  header "Installation Summary"

  printf "  %-24s %s\n" "Deployment:" "${BOLD}${DOCKER_MODE}${RESET}"
  printf "  %-24s %s\n" "Install directory:" "${INSTALL_DIR}"
  printf "  %-24s %s\n" "Compliance port:" "${COMPLIANCE_PORT}"
  printf "  %-24s %s\n" "Dashboard port:" "${DASHBOARD_PORT}"
  printf "  %-24s %s\n" "pa11y webservice:" "${PA11Y_URL}"
  [ "${PA11Y_DOCKER}" = "true" ] && printf "  %-24s %s\n" "pa11y Docker:" "yes (will be created)"
  printf "  %-24s %s\n" "Monitor agent:" "$([ "${MOD_MONITOR}" = "true" ] && echo "yes" || echo "no")"

  local plugins_list=""
  [ "${PLUGIN_AUTH_ENTRA}"    = "true" ] && plugins_list="${plugins_list}entra "
  [ "${PLUGIN_NOTIFY_SLACK}"  = "true" ] && plugins_list="${plugins_list}slack "
  [ "${PLUGIN_NOTIFY_TEAMS}"  = "true" ] && plugins_list="${plugins_list}teams "
  [ "${PLUGIN_NOTIFY_EMAIL}"  = "true" ] && plugins_list="${plugins_list}email "
  [ "${PLUGIN_STORAGE_S3}"    = "true" ] && plugins_list="${plugins_list}s3 "
  [ "${PLUGIN_STORAGE_AZURE}" = "true" ] && plugins_list="${plugins_list}azure "
  [ -z "${plugins_list}" ] && plugins_list="none"
  printf "  %-24s %s\n" "Plugins:" "${plugins_list}"

  [ -n "${ADMIN_USERNAME}" ] && printf "  %-24s %s\n" "Admin user:" "${ADMIN_USERNAME}"

  printf "\n"
  if ! ask_yn "Proceed with installation?" "y"; then
    info "Installation cancelled."
    exit 0
  fi
}

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
# pa11y Docker setup
# ──────────────────────────────────────────────
setup_pa11y_docker() {
  if [ "${PA11Y_DOCKER}" != "true" ]; then return; fi

  header "Setting up pa11y webservice (Docker)"

  if docker ps --format '{{.Names}}' | grep -q 'pa11y-webservice'; then
    warn "pa11y-webservice container already running."
    return
  fi

  info "Starting pa11y webservice with MongoDB..."
  docker network create luqen-net 2>/dev/null || true

  # MongoDB for pa11y
  docker run -d \
    --name pa11y-mongo \
    --network luqen-net \
    --restart unless-stopped \
    -v pa11y-mongo-data:/data/db \
    mongo:7 >/dev/null 2>&1 || warn "pa11y-mongo already exists"

  # pa11y webservice
  docker run -d \
    --name pa11y-webservice \
    --network luqen-net \
    --restart unless-stopped \
    -p 3000:3000 \
    -e DATABASE="mongodb://pa11y-mongo:27017/pa11y-webservice" \
    pa11y/pa11y-webservice >/dev/null 2>&1 || warn "pa11y-webservice already exists"

  # Wait for health
  info "Waiting for pa11y webservice to be ready..."
  local attempts=0
  until curl -sf http://localhost:3000/api/tasks >/dev/null 2>&1; do
    attempts=$(( attempts + 1 ))
    if [ "${attempts}" -ge 20 ]; then
      error "pa11y webservice did not start. Check: docker logs pa11y-webservice"
      return
    fi
    printf "."
    sleep 2
  done
  printf "\n"
  success "pa11y webservice running at http://localhost:3000"
}

# ──────────────────────────────────────────────
# Plugin activation (post-install)
# ──────────────────────────────────────────────
activate_plugins() {
  local api_key="$1"
  local base_url="http://localhost:${DASHBOARD_PORT}"

  info "Installing selected plugins..."

  install_plugin() {
    local pkg="$1" label="$2"
    info "  Installing ${label}..."
    local result
    result=$(curl -sf -X POST "${base_url}/api/v1/plugins/install" \
      -H "Authorization: Bearer ${api_key}" \
      -H "Content-Type: application/json" \
      -d "{\"packageName\": \"${pkg}\"}" 2>&1) || true

    if echo "${result}" | grep -q '"status"'; then
      success "  ${label} installed"
    else
      warn "  ${label}: ${result:-install skipped}"
    fi
  }

  [ "${PLUGIN_AUTH_ENTRA}"    = "true" ] && install_plugin "@luqen/plugin-auth-entra"    "Entra ID SSO"
  [ "${PLUGIN_NOTIFY_SLACK}"  = "true" ] && install_plugin "@luqen/plugin-notify-slack"  "Slack notifications"
  [ "${PLUGIN_NOTIFY_TEAMS}"  = "true" ] && install_plugin "@luqen/plugin-notify-teams"  "Teams notifications"
  [ "${PLUGIN_NOTIFY_EMAIL}"  = "true" ] && install_plugin "@luqen/plugin-notify-email"  "Email reports"
  [ "${PLUGIN_STORAGE_S3}"    = "true" ] && install_plugin "@luqen/plugin-storage-s3"    "S3 storage"
  [ "${PLUGIN_STORAGE_AZURE}" = "true" ] && install_plugin "@luqen/plugin-storage-azure" "Azure Blob storage"
}

# ──────────────────────────────────────────────
# Create admin user (post-install)
# ──────────────────────────────────────────────
create_admin_user() {
  local api_key="$1"
  if [ -z "${ADMIN_USERNAME}" ]; then return; fi

  local base_url="http://localhost:${DASHBOARD_PORT}"
  info "Creating admin user '${ADMIN_USERNAME}'..."

  local result
  result=$(curl -sf -X POST "${base_url}/api/v1/setup" \
    -H "Authorization: Bearer ${api_key}" \
    -H "Content-Type: application/json" \
    -d "{\"username\": \"${ADMIN_USERNAME}\", \"password\": \"${ADMIN_PASSWORD}\", \"role\": \"admin\"}" 2>&1) || true

  if echo "${result}" | grep -q '"username"'; then
    success "Admin user '${ADMIN_USERNAME}' created."
  else
    warn "Could not create admin user: ${result:-unknown error}"
  fi
}

# ──────────────────────────────────────────────
# Generate .luqen.json config
# ──────────────────────────────────────────────
generate_config() {
  local config_file="${INSTALL_DIR}/.luqen.json"
  if [ -f "${config_file}" ]; then
    warn "Config file already exists at ${config_file} — skipping."
    return
  fi

  cat > "${config_file}" <<CONF
{
  "complianceUrl": "http://localhost:${COMPLIANCE_PORT}",
  "dashboardUrl": "http://localhost:${DASHBOARD_PORT}",
  "webserviceUrl": "${PA11Y_URL}",
  "outputDir": "./luqen-reports",
  "monitor": ${MOD_MONITOR}
}
CONF
  success "Configuration written to ${config_file}"
}

# ──────────────────────────────────────────────
# LOCAL DEPLOYMENT
# ──────────────────────────────────────────────
local_install() {
  header "Luqen — Local Installation"

  # ── Prerequisites ──────────────────────────
  info "Checking prerequisites..."

  # Auto-install missing prerequisites
  install_prerequisites() {
    local missing=()
    command -v git &>/dev/null || missing+=(git)
    command -v node &>/dev/null || missing+=(nodejs)
    command -v npm &>/dev/null || missing+=(npm)
    command -v curl &>/dev/null || missing+=(curl)

    if [ ${#missing[@]} -eq 0 ]; then return 0; fi

    info "Missing prerequisites: ${missing[*]}"

    if command -v apt-get &>/dev/null; then
      info "Installing via apt-get..."
      # Add NodeSource repo for Node.js 20
      if ! command -v node &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
      fi
      apt-get update -qq && apt-get install -y -qq "${missing[@]}" 2>/dev/null
    elif command -v yum &>/dev/null; then
      info "Installing via yum..."
      if ! command -v node &>/dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - 2>/dev/null
      fi
      yum install -y "${missing[@]}" 2>/dev/null
    elif command -v brew &>/dev/null; then
      info "Installing via Homebrew..."
      brew install "${missing[@]}" 2>/dev/null
    else
      error "Cannot auto-install prerequisites. Please install manually: ${missing[*]}"
      error "Node.js 20+: https://nodejs.org  |  Git: https://git-scm.com"
      exit 1
    fi
    success "Prerequisites installed."
  }

  install_prerequisites

  if ! command -v node &>/dev/null; then
    error "Node.js is not installed and could not be auto-installed. Please install Node.js 20+ from https://nodejs.org"
    exit 1
  fi

  NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
  if [ "${NODE_MAJOR}" -lt 20 ]; then
    error "Node.js 20+ is required. Found: $(node --version)"
    exit 1
  fi
  success "Node.js $(node --version) detected."

  if ! command -v npm &>/dev/null; then error "npm is not installed."; exit 1; fi
  success "npm $(npm --version) detected."

  if ! command -v git &>/dev/null; then error "git is not installed."; exit 1; fi
  success "git $(git --version | awk '{print $3}') detected."

  # ── pa11y Docker (if requested) ─────────────
  setup_pa11y_docker

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
  if [ -f "${KEYS_DIR}/private.pem" ]; then
    warn "JWT keys already exist — skipping generation."
  else
    info "Generating JWT RS256 key pair..."
    mkdir -p "${KEYS_DIR}"
    (cd "${INSTALL_DIR}/packages/compliance" && node dist/cli.js keys generate)
    success "JWT keys generated."
  fi

  # ── Seed ───────────────────────────────────
  if [ "${SEED}" = "true" ]; then
    info "Seeding baseline compliance data..."
    (cd "${INSTALL_DIR}/packages/compliance" && node dist/cli.js seed)
    success "Baseline data seeded (58 jurisdictions, 62 regulations)."
  fi

  # ── OAuth client ───────────────────────────
  CLIENT_CACHE="${INSTALL_DIR}/.install-client"
  if [ -f "${CLIENT_CACHE}" ]; then
    CLIENT_ID=$(grep "^client_id=" "${CLIENT_CACHE}" | cut -d= -f2-)
    CLIENT_SECRET=$(grep "^client_secret=" "${CLIENT_CACHE}" | cut -d= -f2-)
  else
    info "Creating OAuth2 client..."
    CLIENT_OUT=$(cd "${INSTALL_DIR}/packages/compliance" && node dist/cli.js clients create --name "luqen-dashboard" --scope "read write")
    CLIENT_ID=$(echo "${CLIENT_OUT}" | grep "client_id:" | awk '{print $2}')
    CLIENT_SECRET=$(echo "${CLIENT_OUT}" | grep "client_secret:" | awk '{print $2}')
    printf "client_id=%s\nclient_secret=%s\n" "${CLIENT_ID}" "${CLIENT_SECRET}" > "${CLIENT_CACHE}"
    chmod 600 "${CLIENT_CACHE}"
    success "OAuth2 client created."
  fi

  # ── Generate config ────────────────────────
  generate_config

  # ── Session secret ─────────────────────────
  SESSION_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")

  # ── Start services for post-install ────────
  info "Starting services for post-install setup..."

  COMPLIANCE_API_KEY=setup-temp-key \
    nohup node packages/compliance/dist/cli.js serve --port "${COMPLIANCE_PORT}" > /tmp/luqen-comp-install.log 2>&1 &
  COMP_PID=$!
  sleep 3

  DASHBOARD_SESSION_SECRET="${SESSION_SECRET}" \
    DASHBOARD_COMPLIANCE_URL="http://localhost:${COMPLIANCE_PORT}" \
    DASHBOARD_COMPLIANCE_API_KEY="setup-temp-key" \
    DASHBOARD_WEBSERVICE_URL="${PA11Y_URL}" \
    DASHBOARD_COMPLIANCE_CLIENT_ID="${CLIENT_ID}" \
    DASHBOARD_COMPLIANCE_CLIENT_SECRET="${CLIENT_SECRET}" \
    nohup node packages/dashboard/dist/cli.js serve --port "${DASHBOARD_PORT}" > /tmp/luqen-dash-install.log 2>&1 &
  DASH_PID=$!
  sleep 4

  # Grab the generated API key
  API_KEY=$(grep -oP 'API Key: \K[a-f0-9]{64}' /tmp/luqen-dash-install.log 2>/dev/null || echo "")

  if [ -n "${API_KEY}" ]; then
    # ── Create admin user ──────────────────────
    create_admin_user "${API_KEY}"

    # ── Install plugins ────────────────────────
    activate_plugins "${API_KEY}"
  fi

  # Stop temp services
  kill "${COMP_PID}" "${DASH_PID}" 2>/dev/null || true
  wait "${COMP_PID}" "${DASH_PID}" 2>/dev/null || true

  # ── Print quickstart ───────────────────────
  cat <<EOF

${GREEN}${BOLD}═══════════════════════════════════════════════════════${RESET}
${GREEN}${BOLD}  Luqen installed successfully!${RESET}
${GREEN}${BOLD}═══════════════════════════════════════════════════════${RESET}

${BOLD}Installation directory:${RESET}  ${INSTALL_DIR}

${BOLD}Start services:${RESET}

  # Option A: Start both services (recommended)
  cd ${INSTALL_DIR}
  npm run dev:all

  # Option B: Start individually
  cd ${INSTALL_DIR}/packages/compliance
  COMPLIANCE_PORT=${COMPLIANCE_PORT} node dist/cli.js serve

  cd ${INSTALL_DIR}/packages/dashboard
  DASHBOARD_PORT=${DASHBOARD_PORT} \\
    DASHBOARD_COMPLIANCE_URL=http://localhost:${COMPLIANCE_PORT} \\
    DASHBOARD_WEBSERVICE_URL=${PA11Y_URL} \\
    DASHBOARD_SESSION_SECRET=${SESSION_SECRET} \\
    node dist/cli.js serve

${BOLD}Access:${RESET}

  Dashboard:   ${CYAN}http://localhost:${DASHBOARD_PORT}${RESET}
  Compliance:  ${CYAN}http://localhost:${COMPLIANCE_PORT}${RESET}
EOF

  if [ -n "${ADMIN_USERNAME}" ]; then
    printf "  Login:       ${BOLD}%s${RESET} / (your password)\n" "${ADMIN_USERNAME}"
  fi

  if [ -n "${API_KEY}" ]; then
    printf "\n${BOLD}API Key:${RESET}       ${YELLOW}%s${RESET}\n" "${API_KEY}"
    printf "               (also works for login — save it securely)\n"
  fi

  printf "\n${BOLD}pa11y:${RESET}         %s\n" "${PA11Y_URL}"
  printf "\n"
}

# ──────────────────────────────────────────────
# DOCKER DEPLOYMENT
# ──────────────────────────────────────────────
docker_install() {
  header "Luqen — Docker Installation"

  # ── Prerequisites ──────────────────────────
  info "Checking prerequisites..."

  if ! command -v docker &>/dev/null; then
    error "Docker is not installed. Get it from https://docs.docker.com/get-docker/"
    exit 1
  fi
  success "Docker $(docker --version | awk '{print $3}' | tr -d ',') detected."

  if docker compose version &>/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
  else
    error "Docker Compose is not installed."
    exit 1
  fi
  success "Docker Compose detected."

  if ! command -v git &>/dev/null; then error "git is not installed."; exit 1; fi
  success "git detected."

  # ── pa11y Docker (if requested) ─────────────
  setup_pa11y_docker

  # ── Clone / Pull ───────────────────────────
  clone_or_pull
  cd "${INSTALL_DIR}"

  # ── Configure .env ─────────────────────────
  ENV_FILE="${INSTALL_DIR}/.env"
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
  [ "${COMPLIANCE_PORT}" != "4000" ] && set_env_var "COMPLIANCE_PORT" "${COMPLIANCE_PORT}"
  [ "${DASHBOARD_PORT}"  != "5000" ] && set_env_var "DASHBOARD_PORT"  "${DASHBOARD_PORT}"

  success ".env configured."

  # ── Select docker-compose template ──────────
  TEMPLATE_FILE="${INSTALL_DIR}/deploy/templates/docker-compose.${DEPLOY_TEMPLATE:-standard}.yml"
  COMPOSE_FILE="${INSTALL_DIR}/docker-compose.yml"
  if [ -f "${TEMPLATE_FILE}" ]; then
    info "Using ${DEPLOY_TEMPLATE:-standard} deployment template..."
    cp "${TEMPLATE_FILE}" "${COMPOSE_FILE}"
    success "docker-compose.yml generated from ${DEPLOY_TEMPLATE:-standard} template."
  else
    info "Using existing docker-compose.yml"
  fi

  # ── Docker Compose up ──────────────────────
  info "Building and starting containers..."
  ${COMPOSE_CMD} up -d --build
  success "Containers started."

  # ── Wait for health ────────────────────────
  info "Waiting for services to be healthy..."
  local attempts=0
  until curl -sf "http://localhost:${DASHBOARD_PORT}/health" >/dev/null 2>&1; do
    attempts=$(( attempts + 1 ))
    if [ "${attempts}" -ge 30 ]; then
      error "Services did not become healthy. Check: ${COMPOSE_CMD} logs"
      exit 1
    fi
    printf "."
    sleep 3
  done
  printf "\n"
  success "Services are healthy."

  # ── Seed ───────────────────────────────────
  if [ "${SEED}" = "true" ]; then
    info "Seeding baseline data..."
    docker exec luqen-compliance node dist/cli.js seed 2>/dev/null || true
    success "Baseline data seeded."
  fi

  # ── Grab API key ───────────────────────────
  API_KEY=$(${COMPOSE_CMD} logs dashboard 2>/dev/null | grep -oP 'API Key: \K[a-f0-9]{64}' | head -1 || echo "")

  if [ -n "${API_KEY}" ]; then
    create_admin_user "${API_KEY}"
    activate_plugins "${API_KEY}"
  fi

  # ── Generate config ────────────────────────
  generate_config

  # ── Print summary ──────────────────────────
  cat <<EOF

${GREEN}${BOLD}═══════════════════════════════════════════════════════${RESET}
${GREEN}${BOLD}  Luqen (Docker) installed successfully!${RESET}
${GREEN}${BOLD}═══════════════════════════════════════════════════════${RESET}

${BOLD}Access:${RESET}

  Dashboard:   ${CYAN}http://localhost:${DASHBOARD_PORT}${RESET}
  Compliance:  ${CYAN}http://localhost:${COMPLIANCE_PORT}${RESET}
EOF

  if [ -n "${ADMIN_USERNAME}" ]; then
    printf "  Login:       ${BOLD}%s${RESET} / (your password)\n" "${ADMIN_USERNAME}"
  fi

  if [ -n "${API_KEY}" ]; then
    printf "\n${BOLD}API Key:${RESET}       ${YELLOW}%s${RESET}\n" "${API_KEY}"
  fi

  cat <<EOF

${BOLD}Commands:${RESET}

  View logs:     ${COMPOSE_CMD} -f ${INSTALL_DIR}/docker-compose.yml logs -f
  Stop:          ${COMPOSE_CMD} -f ${INSTALL_DIR}/docker-compose.yml down
  Restart:       ${COMPOSE_CMD} -f ${INSTALL_DIR}/docker-compose.yml restart
  Update:        cd ${INSTALL_DIR} && git pull && ${COMPOSE_CMD} up -d --build

EOF
}

# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────

# Run wizard if interactive and no deployment mode specified
if [ "${INTERACTIVE}" = "true" ] && [ -z "${DOCKER_MODE}" ] && [ -t 0 ]; then
  run_wizard
fi

# Default to local if still not set
[ -z "${DOCKER_MODE}" ] && DOCKER_MODE=local
[ -z "${PA11Y_URL}" ]   && PA11Y_URL="http://localhost:3000"

if [ "${DOCKER_MODE}" = "docker" ]; then
  docker_install
else
  local_install
fi
