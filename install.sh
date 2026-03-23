#!/usr/bin/env bash
# install.sh — interactive installer for Luqen
# Usage:  curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash
# Flags:  --non-interactive, --port PORT, --pa11y-url URL, --db sqlite|postgres|mongodb, --help

set -euo pipefail

# ──────────────────────────────────────────────
# Color helpers
# ──────────────────────────────────────────────
if [ -t 1 ] && command -v tput &>/dev/null; then
  BOLD="$(tput bold)"; GREEN="$(tput setaf 2)"; YELLOW="$(tput setaf 3)"
  RED="$(tput setaf 1)"; CYAN="$(tput setaf 6)"; DIM="$(tput dim)"; RESET="$(tput sgr0)"
else
  BOLD="" GREEN="" YELLOW="" RED="" CYAN="" DIM="" RESET=""
fi

info()    { printf "%s  %s%s\n"   "${CYAN}•${RESET}"  "$*"          "${RESET}"; }
success() { printf "%s  %s%s\n"   "${GREEN}✔${RESET}" "${GREEN}$*"  "${RESET}"; }
warn()    { printf "%s  %s%s\n"   "${YELLOW}!${RESET}" "${YELLOW}$*" "${RESET}"; }
error()   { printf "%s  %s%s\n"   "${RED}✖${RESET}"   "${RED}$*"    "${RESET}" >&2; }
header()  { printf "\n%s%s%s\n\n" "${BOLD}${CYAN}"     "$*"          "${RESET}"; }
step()    { printf "\n%s[%s/%s]%s %s%s%s\n" "${DIM}" "$1" "$2" "${RESET}" "${BOLD}" "$3" "${RESET}"; }

spinner() {
  local pid=$1 msg="$2"
  local chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  while kill -0 "$pid" 2>/dev/null; do
    for (( i=0; i<${#chars}; i++ )); do
      printf "\r  %s %s" "${CYAN}${chars:$i:1}${RESET}" "$msg"
      sleep 0.1
    done
  done
  wait "$pid" 2>/dev/null
  local rc=$?
  printf "\r"
  return $rc
}

run_quiet() {
  local msg="$1"; shift
  local logfile
  logfile=$(mktemp /tmp/luqen-install-XXXXXX.log)
  ("$@") >"$logfile" 2>&1 &
  local pid=$!
  if spinner "$pid" "$msg"; then
    success "$msg"
    rm -f "$logfile"
    return 0
  else
    error "$msg — failed"
    printf "  %sLog:%s %s\n" "${DIM}" "${RESET}" "$logfile"
    return 1
  fi
}

# ──────────────────────────────────────────────
# Defaults
# ──────────────────────────────────────────────
COMPLIANCE_PORT=4000
DASHBOARD_PORT=5000
PA11Y_URL=""
PA11Y_DOCKER=false
PA11Y_SKIP=false
SEED=true
INTERACTIVE=true
REPO_URL="https://github.com/trunten82/luqen.git"
INSTALL_DIR="${HOME}/luqen"

# Database
DB_ADAPTER="sqlite"
DB_HOST=""
DB_PORT=""
DB_NAME=""
DB_USER=""
DB_PASSWORD=""
DB_CONNECTION_STRING=""

# Auth
AUTH_PROVIDER="none"  # none, entra, okta, google
AUTH_TENANT_ID=""
AUTH_CLIENT_ID=""
AUTH_CLIENT_SECRET=""
AUTH_ORG_URL=""
AUTH_HOSTED_DOMAIN=""

# Notifications
NOTIFY_SLACK=false
NOTIFY_TEAMS=false
NOTIFY_EMAIL=false
SLACK_WEBHOOK_URL=""
TEAMS_WEBHOOK_URL=""
SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""

# Storage plugins
PLUGIN_STORAGE_S3=false
PLUGIN_STORAGE_AZURE=false

# Modules
MOD_MONITOR=false

# Admin user
ADMIN_USERNAME=""
ADMIN_PASSWORD=""
API_KEY=""

# ──────────────────────────────────────────────
# Argument parsing
# ──────────────────────────────────────────────
show_help() {
  cat <<EOF
${BOLD}Luqen Installer${RESET}

Usage:
  curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash

Interactive wizard runs by default. Pass flags for headless/CI:

Options:
  --port PORT             Compliance port (default: 4000); dashboard = PORT+1000
  --pa11y-url URL         Existing pa11y webservice URL (validated)
  --pa11y-docker          Provision pa11y via Docker
  --db sqlite|postgres|mongodb  Database adapter (default: sqlite)
  --db-url URL            Database connection string (postgres:// or mongodb://)
  --auth none|entra|okta|google  Identity provider (default: none)
  --no-seed               Skip baseline seeding
  --non-interactive       Skip all prompts (use defaults + flags)
  --install-dir DIR       Installation directory (default: ~/luqen)
  --help                  Show this help

Plugins (non-interactive):
  --with-monitor          Include regulatory monitor agent
  --with-notify-slack     Install Slack plugin (requires --slack-webhook-url)
  --with-notify-teams     Install Teams plugin (requires --teams-webhook-url)
  --with-notify-email     Install Email plugin (requires --smtp-host etc.)
  --with-storage-s3       Install AWS S3 storage plugin
  --with-storage-azure    Install Azure Blob storage plugin

Auth config (non-interactive):
  --auth-tenant-id ID     Entra tenant ID
  --auth-client-id ID     OAuth client ID (Entra/Okta/Google)
  --auth-client-secret S  OAuth client secret
  --auth-org-url URL      Okta org URL
  --auth-hosted-domain D  Google hosted domain restriction

SMTP config (non-interactive):
  --smtp-host HOST        SMTP server hostname
  --smtp-port PORT        SMTP port (default: 587)
  --smtp-user USER        SMTP username
  --smtp-pass PASS        SMTP password
  --smtp-from ADDR        From address

Admin user (non-interactive):
  --admin-user USER       Admin username
  --admin-pass PASS       Admin password (min 8 chars)
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)             COMPLIANCE_PORT="$2"; DASHBOARD_PORT=$(( $2 + 1000 )); shift 2 ;;
    --pa11y-url)        PA11Y_URL="$2"; shift 2 ;;
    --pa11y-docker)     PA11Y_DOCKER=true; shift ;;
    --db)               DB_ADAPTER="$2"; shift 2 ;;
    --db-url)           DB_CONNECTION_STRING="$2"; shift 2 ;;
    --auth)             AUTH_PROVIDER="$2"; shift 2 ;;
    --auth-tenant-id)   AUTH_TENANT_ID="$2"; shift 2 ;;
    --auth-client-id)   AUTH_CLIENT_ID="$2"; shift 2 ;;
    --auth-client-secret) AUTH_CLIENT_SECRET="$2"; shift 2 ;;
    --auth-org-url)     AUTH_ORG_URL="$2"; shift 2 ;;
    --auth-hosted-domain) AUTH_HOSTED_DOMAIN="$2"; shift 2 ;;
    --no-seed)          SEED=false; shift ;;
    --non-interactive)  INTERACTIVE=false; shift ;;
    --install-dir)      INSTALL_DIR="$2"; shift 2 ;;
    --with-monitor)     MOD_MONITOR=true; shift ;;
    --with-notify-slack)   NOTIFY_SLACK=true; shift ;;
    --with-notify-teams)   NOTIFY_TEAMS=true; shift ;;
    --with-notify-email)   NOTIFY_EMAIL=true; shift ;;
    --with-storage-s3)     PLUGIN_STORAGE_S3=true; shift ;;
    --with-storage-azure)  PLUGIN_STORAGE_AZURE=true; shift ;;
    --slack-webhook-url)   SLACK_WEBHOOK_URL="$2"; shift 2 ;;
    --teams-webhook-url)   TEAMS_WEBHOOK_URL="$2"; shift 2 ;;
    --smtp-host)        SMTP_HOST="$2"; shift 2 ;;
    --smtp-port)        SMTP_PORT="$2"; shift 2 ;;
    --smtp-user)        SMTP_USER="$2"; shift 2 ;;
    --smtp-pass)        SMTP_PASS="$2"; shift 2 ;;
    --smtp-from)        SMTP_FROM="$2"; shift 2 ;;
    --admin-user)       ADMIN_USERNAME="$2"; shift 2 ;;
    --admin-pass)       ADMIN_PASSWORD="$2"; shift 2 ;;
    --help|-h) show_help ;;
    *) error "Unknown option: $1"; show_help ;;
  esac
done

TOTAL_STEPS=12

# ──────────────────────────────────────────────
# Validation helpers
# ──────────────────────────────────────────────
validate_url() {
  curl -sf --max-time 5 "$1" >/dev/null 2>&1
}

validate_pa11y_url() {
  curl -sf --max-time 5 "${1}/api/tasks" >/dev/null 2>&1
}

validate_postgres() {
  local url="$1"
  node -e "
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: '${url}', connectionTimeoutMillis: 5000 });
    pool.query('SELECT 1').then(() => { pool.end(); process.exit(0); })
      .catch(e => { console.error(e.message); process.exit(1); });
  " 2>/dev/null
}

validate_mongodb() {
  local url="$1"
  node -e "
    const { MongoClient } = require('mongodb');
    const client = new MongoClient('${url}', { serverSelectionTimeoutMS: 5000 });
    client.connect().then(() => client.close()).then(() => process.exit(0))
      .catch(e => { console.error(e.message); process.exit(1); });
  " 2>/dev/null
}

validate_smtp() {
  local host="$1" port="$2" user="$3" pass="$4"
  node -e "
    const net = require('net');
    const sock = net.createConnection({ host: '${host}', port: ${port}, timeout: 5000 });
    sock.on('connect', () => { sock.destroy(); process.exit(0); });
    sock.on('error', (e) => { console.error(e.message); process.exit(1); });
    sock.on('timeout', () => { sock.destroy(); process.exit(1); });
  " 2>/dev/null
}

# ──────────────────────────────────────────────
# Interactive prompt helpers
# ──────────────────────────────────────────────
ask() {
  local prompt="$1" default="$2" var="$3"
  printf "  %s%s%s %s[%s]%s: " "${BOLD}" "${prompt}" "${RESET}" "${DIM}" "${default}" "${RESET}"
  read -r input
  eval "${var}=\"${input:-${default}}\""
}

ask_secret() {
  local prompt="$1" var="$2"
  printf "  %s%s%s: " "${BOLD}" "${prompt}" "${RESET}"
  read -rs input
  printf "\n"
  eval "${var}=\"${input}\""
}

ask_yn() {
  local prompt="$1" default="$2"
  local yn_hint="[Y/n]"
  [ "${default}" = "n" ] && yn_hint="[y/N]"
  printf "  %s%s%s %s%s%s: " "${BOLD}" "${prompt}" "${RESET}" "${DIM}" "${yn_hint}" "${RESET}"
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
  printf "\n  %s%s%s\n" "${BOLD}" "${prompt}" "${RESET}"
  local i=1
  for opt in "${options[@]}"; do
    printf "    %s%d)%s %s\n" "${CYAN}" "${i}" "${RESET}" "${opt}"
    i=$(( i + 1 ))
  done
  printf "\n    %sChoice%s: " "${BOLD}" "${RESET}"
  read -r choice
  echo "${choice}"
}

ask_validated() {
  local prompt="$1" default="$2" var="$3" validator="$4" err_msg="$5"
  local max_attempts=3 attempt=0
  while true; do
    ask "$prompt" "$default" "$var"
    local val
    eval "val=\"\${${var}}\""
    if $validator "$val"; then
      success "  Connection verified"
      return 0
    fi
    attempt=$(( attempt + 1 ))
    if [ $attempt -ge $max_attempts ]; then
      error "  $err_msg (failed $max_attempts attempts)"
      return 1
    fi
    warn "  $err_msg — try again ($attempt/$max_attempts)"
  done
}

# ──────────────────────────────────────────────
# INTERACTIVE WIZARD
# ──────────────────────────────────────────────
run_wizard() {
  printf "\n"
  printf "  %s╔══════════════════════════════════════════╗%s\n" "${BOLD}${CYAN}" "${RESET}"
  printf "  %s║         Luqen Installation Wizard        ║%s\n" "${BOLD}${CYAN}" "${RESET}"
  printf "  %s╚══════════════════════════════════════════╝%s\n" "${BOLD}${CYAN}" "${RESET}"
  printf "\n  Enterprise accessibility testing platform\n"

  # ── 3a: Components ──────────────────────────
  header "Components"
  printf "  Compliance service and Dashboard are always installed.\n\n"

  if ask_yn "Include pa11y webservice (accessibility scan engine)?" "y"; then
    local pa11y_choice
    pa11y_choice=$(ask_choice "pa11y webservice setup:" \
      "I have an existing pa11y instance (enter URL)" \
      "Provision a new instance via Docker" \
      "Skip — configure later")

    case "${pa11y_choice}" in
      1)
        local pa11y_ok=false
        for attempt in 1 2 3; do
          ask "pa11y webservice URL" "http://localhost:3000" PA11Y_URL
          printf "  %sValidating pa11y endpoint...%s " "${DIM}" "${RESET}"
          if validate_pa11y_url "${PA11Y_URL}"; then
            success "reachable"
            pa11y_ok=true
            break
          fi
          warn "Could not reach ${PA11Y_URL}/api/tasks (attempt ${attempt}/3)"
        done
        if [ "${pa11y_ok}" = "false" ]; then
          error "pa11y URL validation failed. You can set DASHBOARD_WEBSERVICE_URL later."
          PA11Y_URL="http://localhost:3000"
          PA11Y_SKIP=true
        fi
        ;;
      2)
        PA11Y_DOCKER=true
        PA11Y_URL="http://localhost:3000"
        success "Will provision pa11y via Docker"
        ;;
      *)
        PA11Y_URL="http://localhost:3000"
        PA11Y_SKIP=true
        warn "Skipping pa11y — set DASHBOARD_WEBSERVICE_URL later"
        ;;
    esac
  else
    PA11Y_URL="http://localhost:3000"
    PA11Y_SKIP=true
  fi

  if ask_yn "Include regulatory monitor agent?" "n"; then
    MOD_MONITOR=true
    success "Monitor agent enabled"
  fi

  # ── 3c: Database ────────────────────────────
  header "Database"
  printf "  The dashboard needs a database for scan results, users, and settings.\n\n"

  local db_choice
  db_choice=$(ask_choice "Database:" \
    "SQLite (default — zero configuration, file-based)" \
    "PostgreSQL (external server)" \
    "MongoDB (external server)")

  case "${db_choice}" in
    2)
      DB_ADAPTER="postgres"
      ask "PostgreSQL connection URL" "postgres://localhost:5432/luqen" DB_CONNECTION_STRING
      printf "  %sValidating PostgreSQL connection...%s " "${DIM}" "${RESET}"
      if validate_postgres "${DB_CONNECTION_STRING}"; then
        success "connected"
      else
        error "Could not connect to PostgreSQL"
        if ! ask_yn "Continue anyway? (you can fix the connection later)" "n"; then
          exit 1
        fi
      fi
      ;;
    3)
      DB_ADAPTER="mongodb"
      ask "MongoDB connection URL" "mongodb://localhost:27017/luqen" DB_CONNECTION_STRING
      printf "  %sValidating MongoDB connection...%s " "${DIM}" "${RESET}"
      if validate_mongodb "${DB_CONNECTION_STRING}"; then
        success "connected"
      else
        error "Could not connect to MongoDB"
        if ! ask_yn "Continue anyway? (you can fix the connection later)" "n"; then
          exit 1
        fi
      fi
      ;;
    *)
      DB_ADAPTER="sqlite"
      success "Using SQLite (no configuration needed)"
      ;;
  esac

  # ── 3d: Authentication ─────────────────────
  header "Authentication"
  printf "  Choose how users will sign in.\n\n"

  local auth_choice
  auth_choice=$(ask_choice "Identity provider:" \
    "None — solo/team mode (API key + local accounts)" \
    "Microsoft Entra ID (Azure AD SSO)" \
    "Okta" \
    "Google Workspace")

  case "${auth_choice}" in
    2)
      AUTH_PROVIDER="entra"
      ask "Entra tenant ID" "" AUTH_TENANT_ID
      ask "Entra client ID" "" AUTH_CLIENT_ID
      ask_secret "Entra client secret" AUTH_CLIENT_SECRET
      if [ -z "${AUTH_TENANT_ID}" ] || [ -z "${AUTH_CLIENT_ID}" ] || [ -z "${AUTH_CLIENT_SECRET}" ]; then
        error "All Entra fields are required"
        AUTH_PROVIDER="none"
      else
        success "Entra ID configured"
      fi
      ;;
    3)
      AUTH_PROVIDER="okta"
      ask "Okta org URL" "https://your-org.okta.com" AUTH_ORG_URL
      ask "Okta client ID" "" AUTH_CLIENT_ID
      ask_secret "Okta client secret" AUTH_CLIENT_SECRET
      if [ -z "${AUTH_ORG_URL}" ] || [ -z "${AUTH_CLIENT_ID}" ] || [ -z "${AUTH_CLIENT_SECRET}" ]; then
        error "All Okta fields are required"
        AUTH_PROVIDER="none"
      else
        success "Okta configured"
      fi
      ;;
    4)
      AUTH_PROVIDER="google"
      ask "Google client ID" "" AUTH_CLIENT_ID
      ask_secret "Google client secret" AUTH_CLIENT_SECRET
      ask "Hosted domain restriction (optional)" "" AUTH_HOSTED_DOMAIN
      if [ -z "${AUTH_CLIENT_ID}" ] || [ -z "${AUTH_CLIENT_SECRET}" ]; then
        error "Client ID and secret are required"
        AUTH_PROVIDER="none"
      else
        success "Google configured"
      fi
      ;;
    *)
      AUTH_PROVIDER="none"
      success "Solo/team mode (API key login)"
      ;;
  esac

  # ── 3e: Notifications ──────────────────────
  header "Notifications"
  printf "  Get notified when scans complete.\n\n"

  if ask_yn "Slack notifications?" "n"; then
    NOTIFY_SLACK=true
    ask "Slack webhook URL" "" SLACK_WEBHOOK_URL
  fi
  if ask_yn "Teams notifications?" "n"; then
    NOTIFY_TEAMS=true
    ask "Teams webhook URL" "" TEAMS_WEBHOOK_URL
  fi
  if ask_yn "Email reports (SMTP)?" "n"; then
    NOTIFY_EMAIL=true
    ask "SMTP host" "" SMTP_HOST
    ask "SMTP port" "587" SMTP_PORT
    ask "SMTP username" "" SMTP_USER
    ask_secret "SMTP password" SMTP_PASS
    ask "From address" "" SMTP_FROM
    printf "  %sValidating SMTP connection...%s " "${DIM}" "${RESET}"
    if validate_smtp "${SMTP_HOST}" "${SMTP_PORT}" "${SMTP_USER}" "${SMTP_PASS}"; then
      success "SMTP reachable"
    else
      warn "Could not reach SMTP server — you can fix this later in plugin settings"
    fi
  fi

  # ── 3f: Ports + install dir ────────────────
  header "Configuration"

  ask "Compliance service port" "${COMPLIANCE_PORT}" COMPLIANCE_PORT
  DASHBOARD_PORT=$(( COMPLIANCE_PORT + 1000 ))
  ask "Dashboard port" "${DASHBOARD_PORT}" DASHBOARD_PORT
  ask "Installation directory" "${INSTALL_DIR}" INSTALL_DIR

  # ── 3g: Admin user ─────────────────────────
  header "Admin Account"
  printf "  Create an admin user, or log in with the API key later.\n\n"

  if ask_yn "Create an admin user now?" "y"; then
    ask "Admin username" "admin" ADMIN_USERNAME
    while true; do
      printf "  %sAdmin password%s (min 8 chars): " "${BOLD}" "${RESET}"
      read -rs ADMIN_PASSWORD
      printf "\n"
      if [ ${#ADMIN_PASSWORD} -ge 8 ]; then break; fi
      warn "Password must be at least 8 characters."
    done
    success "Admin user will be created after install"
  fi

  # ── Summary ─────────────────────────────────
  printf "\n"
  printf "  %s┌──────────────────────────────────────────┐%s\n" "${BOLD}" "${RESET}"
  printf "  %s│          Installation Summary             │%s\n" "${BOLD}" "${RESET}"
  printf "  %s└──────────────────────────────────────────┘%s\n" "${BOLD}" "${RESET}"
  printf "\n"
  printf "  %-22s %s\n" "Install directory:" "${INSTALL_DIR}"
  printf "  %-22s %s\n" "Compliance port:" "${COMPLIANCE_PORT}"
  printf "  %-22s %s\n" "Dashboard port:" "${DASHBOARD_PORT}"
  printf "  %-22s %s\n" "Database:" "${DB_ADAPTER}"
  printf "  %-22s %s\n" "Authentication:" "${AUTH_PROVIDER}"
  printf "  %-22s %s\n" "pa11y:" "$([ "${PA11Y_SKIP}" = "true" ] && echo "skipped" || echo "${PA11Y_URL}")"
  [ "${PA11Y_DOCKER}" = "true" ] && printf "  %-22s %s\n" "pa11y Docker:" "yes"
  printf "  %-22s %s\n" "Monitor:" "$([ "${MOD_MONITOR}" = "true" ] && echo "yes" || echo "no")"

  local notifs=""
  [ "${NOTIFY_SLACK}" = "true" ] && notifs="${notifs}slack "
  [ "${NOTIFY_TEAMS}" = "true" ] && notifs="${notifs}teams "
  [ "${NOTIFY_EMAIL}" = "true" ] && notifs="${notifs}email "
  [ -z "${notifs}" ] && notifs="none"
  printf "  %-22s %s\n" "Notifications:" "${notifs}"

  [ -n "${ADMIN_USERNAME}" ] && printf "  %-22s %s\n" "Admin user:" "${ADMIN_USERNAME}"

  printf "\n"
  if ! ask_yn "Proceed with installation?" "y"; then
    info "Installation cancelled."
    exit 0
  fi
}

# ──────────────────────────────────────────────
# Step 1: Prerequisites
# ──────────────────────────────────────────────
check_prerequisites() {
  step 1 $TOTAL_STEPS "Checking prerequisites"

  local missing=()
  command -v git &>/dev/null || missing+=(git)
  command -v curl &>/dev/null || missing+=(curl)

  if ! command -v node &>/dev/null; then
    missing+=(nodejs)
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    info "Missing: ${missing[*]} — attempting auto-install..."
    if command -v apt-get &>/dev/null; then
      if ! command -v node &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
      fi
      apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq "${missing[@]}" >/dev/null 2>&1
    elif command -v yum &>/dev/null; then
      if ! command -v node &>/dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
      fi
      yum install -y "${missing[@]}" >/dev/null 2>&1
    elif command -v brew &>/dev/null; then
      brew install "${missing[@]}" >/dev/null 2>&1
    else
      error "Cannot auto-install: ${missing[*]}. Install Node.js 20+ and git manually."
      exit 1
    fi
  fi

  if ! command -v node &>/dev/null; then
    error "Node.js not found. Install Node.js 20+ from https://nodejs.org"
    exit 1
  fi

  NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
  if [ "${NODE_MAJOR}" -lt 20 ]; then
    error "Node.js 20+ required. Found: $(node --version)"
    exit 1
  fi

  success "Node.js $(node --version), npm $(npm --version), git $(git --version | awk '{print $3}')"
}

# ──────────────────────────────────────────────
# Step 2: Clone / pull
# ──────────────────────────────────────────────
clone_or_pull() {
  step 2 $TOTAL_STEPS "Fetching source code"

  if [ -d "${INSTALL_DIR}/.git" ]; then
    run_quiet "Pulling latest changes" git -C "${INSTALL_DIR}" pull --ff-only
  else
    run_quiet "Cloning repository" git clone "${REPO_URL}" "${INSTALL_DIR}"
  fi
}

# ──────────────────────────────────────────────
# Step 3: Interactive wizard (already ran above)
# ──────────────────────────────────────────────

# ──────────────────────────────────────────────
# Step 4: Install & build
# ──────────────────────────────────────────────
install_and_build() {
  step 4 $TOTAL_STEPS "Installing dependencies and building"

  cd "${INSTALL_DIR}"
  run_quiet "Installing npm dependencies" npm install --prefer-offline
  run_quiet "Building packages" npm run build --workspaces
}

# ──────────────────────────────────────────────
# Step 5: Generate JWT keys + session secret
# ──────────────────────────────────────────────
generate_secrets() {
  step 5 $TOTAL_STEPS "Generating secrets"

  KEYS_DIR="${INSTALL_DIR}/packages/compliance/keys"
  if [ -f "${KEYS_DIR}/private.pem" ]; then
    info "JWT keys already exist — reusing"
  else
    mkdir -p "${KEYS_DIR}"
    (cd "${INSTALL_DIR}/packages/compliance" && node dist/cli.js keys generate) >/dev/null 2>&1
    success "JWT RS256 key pair generated"
  fi

  SESSION_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
  success "Session secret generated"
}

# ──────────────────────────────────────────────
# Step 6: Seed compliance data
# ──────────────────────────────────────────────
seed_data() {
  step 6 $TOTAL_STEPS "Seeding compliance data"

  if [ "${SEED}" = "true" ]; then
    run_quiet "Seeding jurisdictions and regulations" \
      bash -c "cd '${INSTALL_DIR}/packages/compliance' && node dist/cli.js seed"
  else
    info "Seeding skipped (--no-seed)"
  fi
}

# ──────────────────────────────────────────────
# Step 7: Create OAuth client
# ──────────────────────────────────────────────
create_oauth_client() {
  step 7 $TOTAL_STEPS "Creating OAuth client"

  CLIENT_CACHE="${INSTALL_DIR}/.install-client"
  if [ -f "${CLIENT_CACHE}" ]; then
    CLIENT_ID=$(grep "^client_id=" "${CLIENT_CACHE}" | cut -d= -f2-)
    CLIENT_SECRET=$(grep "^client_secret=" "${CLIENT_CACHE}" | cut -d= -f2-)
    info "OAuth client already exists — reusing"
  else
    CLIENT_OUT=$(cd "${INSTALL_DIR}/packages/compliance" && node dist/cli.js clients create --name "luqen-dashboard" --scope "read write" 2>&1)
    CLIENT_ID=$(echo "${CLIENT_OUT}" | grep "client_id:" | awk '{print $2}')
    CLIENT_SECRET=$(echo "${CLIENT_OUT}" | grep "client_secret:" | awk '{print $2}')
    printf "client_id=%s\nclient_secret=%s\n" "${CLIENT_ID}" "${CLIENT_SECRET}" > "${CLIENT_CACHE}"
    chmod 600 "${CLIENT_CACHE}"
    success "OAuth client created"
  fi
}

# ──────────────────────────────────────────────
# Step 8: Write config files
# ──────────────────────────────────────────────
write_config() {
  step 8 $TOTAL_STEPS "Writing configuration"

  CONFIG_FILE="${INSTALL_DIR}/dashboard.config.json"

  local db_config=""
  case "${DB_ADAPTER}" in
    postgres)
      db_config="$(printf ',\n  "dbAdapter": "postgres",\n  "dbUrl": "%s"' "${DB_CONNECTION_STRING}")"
      ;;
    mongodb)
      db_config="$(printf ',\n  "dbAdapter": "mongodb",\n  "dbUrl": "%s"' "${DB_CONNECTION_STRING}")"
      ;;
    *)
      db_config=""
      ;;
  esac

  cat > "${CONFIG_FILE}" <<CONF
{
  "port": ${DASHBOARD_PORT},
  "complianceUrl": "http://localhost:${COMPLIANCE_PORT}",
  "webserviceUrl": "${PA11Y_URL}",
  "sessionSecret": "${SESSION_SECRET}",
  "complianceClientId": "${CLIENT_ID}",
  "complianceClientSecret": "${CLIENT_SECRET}",
  "dbPath": "${INSTALL_DIR}/dashboard.db",
  "reportsDir": "${INSTALL_DIR}/reports",
  "pluginsDir": "${INSTALL_DIR}/plugins"${db_config}
}
CONF
  chmod 600 "${CONFIG_FILE}"
  success "dashboard.config.json written"
}

# ──────────────────────────────────────────────
# Step 9: Install plugins
# ──────────────────────────────────────────────
install_plugins() {
  step 9 $TOTAL_STEPS "Installing plugins"

  local any_plugin=false

  install_plugin() {
    local pkg="$1" label="$2"
    local base_url="http://localhost:${DASHBOARD_PORT}"
    local result
    result=$(curl -sf -X POST "${base_url}/api/v1/plugins/install" \
      -H "Authorization: Bearer ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"packageName\": \"${pkg}\"}" 2>&1) || true

    if echo "${result}" | grep -q '"status"'; then
      success "  ${label}"
    else
      warn "  ${label}: ${result:-skipped}"
    fi
  }

  configure_plugin() {
    local plugin_id="$1"; shift
    local base_url="http://localhost:${DASHBOARD_PORT}"
    local config_json="$1"
    curl -sf -X PUT "${base_url}/api/v1/plugins/${plugin_id}/config" \
      -H "Authorization: Bearer ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d "${config_json}" >/dev/null 2>&1 || true
  }

  if [ "${AUTH_PROVIDER}" = "entra" ]; then
    install_plugin "@luqen/plugin-auth-entra" "Entra ID SSO"
    configure_plugin "auth-entra" "{\"tenantId\":\"${AUTH_TENANT_ID}\",\"clientId\":\"${AUTH_CLIENT_ID}\",\"clientSecret\":\"${AUTH_CLIENT_SECRET}\"}"
    any_plugin=true
  fi
  if [ "${AUTH_PROVIDER}" = "okta" ]; then
    install_plugin "@luqen/plugin-auth-okta" "Okta SSO"
    configure_plugin "auth-okta" "{\"orgUrl\":\"${AUTH_ORG_URL}\",\"clientId\":\"${AUTH_CLIENT_ID}\",\"clientSecret\":\"${AUTH_CLIENT_SECRET}\"}"
    any_plugin=true
  fi
  if [ "${AUTH_PROVIDER}" = "google" ]; then
    install_plugin "@luqen/plugin-auth-google" "Google SSO"
    local google_config="{\"clientId\":\"${AUTH_CLIENT_ID}\",\"clientSecret\":\"${AUTH_CLIENT_SECRET}\""
    [ -n "${AUTH_HOSTED_DOMAIN}" ] && google_config="${google_config},\"hostedDomain\":\"${AUTH_HOSTED_DOMAIN}\""
    google_config="${google_config}}"
    configure_plugin "auth-google" "${google_config}"
    any_plugin=true
  fi

  if [ "${NOTIFY_SLACK}" = "true" ]; then
    install_plugin "@luqen/plugin-notify-slack" "Slack notifications"
    [ -n "${SLACK_WEBHOOK_URL}" ] && configure_plugin "notify-slack" "{\"webhookUrl\":\"${SLACK_WEBHOOK_URL}\"}"
    any_plugin=true
  fi
  if [ "${NOTIFY_TEAMS}" = "true" ]; then
    install_plugin "@luqen/plugin-notify-teams" "Teams notifications"
    [ -n "${TEAMS_WEBHOOK_URL}" ] && configure_plugin "notify-teams" "{\"webhookUrl\":\"${TEAMS_WEBHOOK_URL}\"}"
    any_plugin=true
  fi
  if [ "${NOTIFY_EMAIL}" = "true" ]; then
    install_plugin "@luqen/plugin-notify-email" "Email reports"
    [ -n "${SMTP_HOST}" ] && configure_plugin "notify-email" \
      "{\"host\":\"${SMTP_HOST}\",\"port\":${SMTP_PORT},\"username\":\"${SMTP_USER}\",\"password\":\"${SMTP_PASS}\",\"from\":\"${SMTP_FROM}\"}"
    any_plugin=true
  fi

  if [ "${PLUGIN_STORAGE_S3}" = "true" ]; then
    install_plugin "@luqen/plugin-storage-s3" "AWS S3 storage"
    any_plugin=true
  fi
  if [ "${PLUGIN_STORAGE_AZURE}" = "true" ]; then
    install_plugin "@luqen/plugin-storage-azure" "Azure Blob storage"
    any_plugin=true
  fi

  if [ "${DB_ADAPTER}" = "postgres" ]; then
    install_plugin "@luqen/plugin-storage-postgres" "PostgreSQL adapter"
    configure_plugin "storage-postgres" "{\"connectionString\":\"${DB_CONNECTION_STRING}\"}"
    any_plugin=true
  fi
  if [ "${DB_ADAPTER}" = "mongodb" ]; then
    install_plugin "@luqen/plugin-storage-mongodb" "MongoDB adapter"
    configure_plugin "storage-mongodb" "{\"connectionString\":\"${DB_CONNECTION_STRING}\"}"
    any_plugin=true
  fi

  if [ "${any_plugin}" = "false" ]; then
    info "No plugins selected"
  fi
}

# ──────────────────────────────────────────────
# Step 10: Create systemd services
# ──────────────────────────────────────────────
create_systemd_services() {
  step 10 $TOTAL_STEPS "Creating systemd services"

  if ! command -v systemctl &>/dev/null; then
    warn "systemd not available — skipping service creation"
    return
  fi

  # Compliance service
  cat > /etc/systemd/system/luqen-compliance.service <<UNIT
[Unit]
Description=Luqen Compliance Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}/packages/compliance
Environment=NODE_ENV=production
Environment=COMPLIANCE_PORT=${COMPLIANCE_PORT}
ExecStart=$(command -v node) dist/cli.js serve --port ${COMPLIANCE_PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

  # Dashboard service
  cat > /etc/systemd/system/luqen-dashboard.service <<UNIT
[Unit]
Description=Luqen Dashboard
After=network.target luqen-compliance.service
Wants=luqen-compliance.service

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
Environment=DASHBOARD_SESSION_SECRET=${SESSION_SECRET}
Environment=DASHBOARD_COMPLIANCE_URL=http://localhost:${COMPLIANCE_PORT}
Environment=DASHBOARD_WEBSERVICE_URL=${PA11Y_URL}
Environment=DASHBOARD_COMPLIANCE_CLIENT_ID=${CLIENT_ID}
Environment=DASHBOARD_COMPLIANCE_CLIENT_SECRET=${CLIENT_SECRET}
ExecStart=$(command -v node) packages/dashboard/dist/cli.js serve --config ${CONFIG_FILE}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload >/dev/null 2>&1
  systemctl enable luqen-compliance.service >/dev/null 2>&1
  systemctl enable luqen-dashboard.service >/dev/null 2>&1
  success "systemd services created and enabled"
}

# ──────────────────────────────────────────────
# Step 11: Start services + post-install
# ──────────────────────────────────────────────
start_services() {
  step 11 $TOTAL_STEPS "Starting services"

  if command -v systemctl &>/dev/null; then
    systemctl start luqen-compliance.service >/dev/null 2>&1
    info "Waiting for compliance service..."
    local attempts=0
    until curl -sf "http://localhost:${COMPLIANCE_PORT}/api/v1/health" >/dev/null 2>&1; do
      attempts=$(( attempts + 1 ))
      if [ "${attempts}" -ge 15 ]; then
        error "Compliance service did not start. Check: journalctl -u luqen-compliance"
        return
      fi
      sleep 2
    done
    success "Compliance service running"

    systemctl start luqen-dashboard.service >/dev/null 2>&1
    info "Waiting for dashboard..."
    attempts=0
    until curl -sf "http://localhost:${DASHBOARD_PORT}/health" >/dev/null 2>&1; do
      attempts=$(( attempts + 1 ))
      if [ "${attempts}" -ge 15 ]; then
        error "Dashboard did not start. Check: journalctl -u luqen-dashboard"
        return
      fi
      sleep 2
    done
    success "Dashboard running"
  else
    # Fallback: start directly
    info "Starting services directly (no systemd)..."

    COMPLIANCE_API_KEY=setup-temp-key \
      nohup node "${INSTALL_DIR}/packages/compliance/dist/cli.js" serve --port "${COMPLIANCE_PORT}" \
      > /tmp/luqen-comp-install.log 2>&1 &
    COMP_PID=$!
    sleep 3

    DASHBOARD_SESSION_SECRET="${SESSION_SECRET}" \
      DASHBOARD_COMPLIANCE_URL="http://localhost:${COMPLIANCE_PORT}" \
      DASHBOARD_COMPLIANCE_API_KEY="setup-temp-key" \
      DASHBOARD_WEBSERVICE_URL="${PA11Y_URL}" \
      DASHBOARD_COMPLIANCE_CLIENT_ID="${CLIENT_ID}" \
      DASHBOARD_COMPLIANCE_CLIENT_SECRET="${CLIENT_SECRET}" \
      nohup node "${INSTALL_DIR}/packages/dashboard/dist/cli.js" serve --port "${DASHBOARD_PORT}" \
      > /tmp/luqen-dash-install.log 2>&1 &
    DASH_PID=$!
    sleep 4
    success "Services started (PIDs: ${COMP_PID}, ${DASH_PID})"
  fi

  # Grab API key from dashboard log
  API_KEY=""
  if command -v systemctl &>/dev/null; then
    API_KEY=$(journalctl -u luqen-dashboard --no-pager -n 50 2>/dev/null | grep -oP 'API Key: \K[a-f0-9]{64}' | head -1 || echo "")
  fi
  if [ -z "${API_KEY}" ] && [ -f /tmp/luqen-dash-install.log ]; then
    API_KEY=$(grep -oP 'API Key: \K[a-f0-9]{64}' /tmp/luqen-dash-install.log 2>/dev/null || echo "")
  fi

  # Create admin user
  if [ -n "${API_KEY}" ] && [ -n "${ADMIN_USERNAME}" ]; then
    local result
    result=$(curl -sf -X POST "http://localhost:${DASHBOARD_PORT}/api/v1/setup" \
      -H "Authorization: Bearer ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"username\": \"${ADMIN_USERNAME}\", \"password\": \"${ADMIN_PASSWORD}\", \"role\": \"admin\"}" 2>&1) || true
    if echo "${result}" | grep -q '"username"'; then
      success "Admin user '${ADMIN_USERNAME}' created"
    else
      warn "Could not create admin user"
    fi
  fi

  # Install plugins (needs running services)
  if [ -n "${API_KEY}" ]; then
    install_plugins
  else
    warn "Could not retrieve API key — skipping plugin installation"
  fi

  # Stop temp processes if not using systemd
  if ! command -v systemctl &>/dev/null; then
    kill "${COMP_PID}" "${DASH_PID}" 2>/dev/null || true
    wait "${COMP_PID}" "${DASH_PID}" 2>/dev/null || true
  fi
}

# ──────────────────────────────────────────────
# pa11y Docker setup
# ──────────────────────────────────────────────
setup_pa11y_docker() {
  if [ "${PA11Y_DOCKER}" != "true" ]; then return; fi

  info "Setting up pa11y webservice via Docker..."

  if ! command -v docker &>/dev/null; then
    error "Docker is required for pa11y provisioning but not found"
    return
  fi

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'pa11y-webservice'; then
    info "pa11y-webservice container already running"
    return
  fi

  docker network create luqen-net 2>/dev/null || true

  docker run -d --name pa11y-mongo --network luqen-net --restart unless-stopped \
    -v pa11y-mongo-data:/data/db mongo:7 >/dev/null 2>&1 || true

  docker run -d --name pa11y-webservice --network luqen-net --restart unless-stopped \
    -p 3000:3000 -e DATABASE="mongodb://pa11y-mongo:27017/pa11y-webservice" \
    pa11y/pa11y-webservice >/dev/null 2>&1 || true

  info "Waiting for pa11y webservice..."
  local attempts=0
  until curl -sf http://localhost:3000/api/tasks >/dev/null 2>&1; do
    attempts=$(( attempts + 1 ))
    if [ "${attempts}" -ge 20 ]; then
      error "pa11y did not start. Check: docker logs pa11y-webservice"
      return
    fi
    sleep 2
  done
  success "pa11y webservice running at http://localhost:3000"
}

# ──────────────────────────────────────────────
# Step 12: Summary
# ──────────────────────────────────────────────
show_summary() {
  step 12 $TOTAL_STEPS "Installation complete"

  printf "\n"
  printf "  %s%s╔══════════════════════════════════════════╗%s\n" "${BOLD}" "${GREEN}" "${RESET}"
  printf "  %s%s║      Luqen installed successfully!       ║%s\n" "${BOLD}" "${GREEN}" "${RESET}"
  printf "  %s%s╚══════════════════════════════════════════╝%s\n" "${BOLD}" "${GREEN}" "${RESET}"
  printf "\n"
  printf "  %sURLs:%s\n" "${BOLD}" "${RESET}"
  printf "    Dashboard:   %s%shttp://localhost:${DASHBOARD_PORT}%s\n" "${BOLD}" "${CYAN}" "${RESET}"
  printf "    Compliance:  %s%shttp://localhost:${COMPLIANCE_PORT}%s\n" "${BOLD}" "${CYAN}" "${RESET}"
  printf "    pa11y:       %s\n" "${PA11Y_URL}"
  printf "\n"

  if [ -n "${ADMIN_USERNAME}" ]; then
    printf "  %sLogin:%s\n" "${BOLD}" "${RESET}"
    printf "    Username:  %s\n" "${ADMIN_USERNAME}"
    printf "    Password:  (the password you entered)\n"
    printf "\n"
  fi

  if [ -n "${API_KEY}" ]; then
    printf "  %sAPI Key:%s (save this — also works for login)\n" "${BOLD}" "${RESET}"
    printf "    %s%s%s\n" "${YELLOW}" "${API_KEY}" "${RESET}"
    printf "\n"
  fi

  printf "  %sConfig:%s  %s\n" "${BOLD}" "${RESET}" "${CONFIG_FILE}"
  printf "\n"

  if command -v systemctl &>/dev/null; then
    printf "  %sService management:%s\n" "${BOLD}" "${RESET}"
    printf "    systemctl status  luqen-compliance luqen-dashboard\n"
    printf "    systemctl restart luqen-compliance luqen-dashboard\n"
    printf "    systemctl stop    luqen-compliance luqen-dashboard\n"
    printf "    journalctl -fu    luqen-dashboard\n"
    printf "\n"

    printf "  %sCurrent status:%s\n" "${BOLD}" "${RESET}"
    systemctl --no-pager status luqen-compliance.service 2>/dev/null | head -3 | sed 's/^/    /' || true
    systemctl --no-pager status luqen-dashboard.service 2>/dev/null | head -3 | sed 's/^/    /' || true
    printf "\n"
  else
    printf "  %sStart services:%s\n" "${BOLD}" "${RESET}"
    printf "    cd %s && npm run dev:all\n" "${INSTALL_DIR}"
    printf "\n"
  fi
}

# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────

# Run wizard if interactive
if [ "${INTERACTIVE}" = "true" ] && [ -t 0 ]; then
  run_wizard
fi

# Apply defaults for non-interactive
[ -z "${PA11Y_URL}" ] && PA11Y_URL="http://localhost:3000"

# Execute installation steps
check_prerequisites          # Step 1
clone_or_pull                # Step 2
                             # Step 3 was the wizard
setup_pa11y_docker           # Step 3b (if Docker pa11y requested)
install_and_build            # Step 4
generate_secrets             # Step 5
seed_data                    # Step 6
create_oauth_client          # Step 7
write_config                 # Step 8
                             # Step 9: plugins installed in step 11 (needs running services)
create_systemd_services      # Step 10
start_services               # Step 11 (also does step 9 plugins + admin user)
show_summary                 # Step 12
