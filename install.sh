#!/usr/bin/env bash
# install.sh — interactive installer for Luqen
# Usage:  curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash
# Flags:  --non-interactive, --mode bare-metal|docker, --port PORT, --help

set -euo pipefail

# ──────────────────────────────────────────────
# Re-exec from temp file when piped (curl | bash)
# so that stdin is the terminal for interactive prompts
# ──────────────────────────────────────────────
if [ ! -t 0 ] && [ -z "${LUQEN_INSTALL_REEXEC:-}" ]; then
  TMPSCRIPT="$(mktemp /tmp/luqen-install.XXXXXX.sh)"
  cat > "${TMPSCRIPT}"
  export LUQEN_INSTALL_REEXEC=1
  exec bash "${TMPSCRIPT}" "$@" < /dev/tty
fi

# ──────────────────────────────────────────────
# Color helpers
# ──────────────────────────────────────────────
if [ -t 1 ] && command -v tput &>/dev/null; then
  BOLD="$(tput bold)"; GREEN="$(tput setaf 2)"; YELLOW="$(tput setaf 3)"
  RED="$(tput setaf 1)"; CYAN="$(tput setaf 6)"; DIM="$(tput dim)"; RESET="$(tput sgr0)"
else
  BOLD="" GREEN="" YELLOW="" RED="" CYAN="" DIM="" RESET=""
fi

info()    { printf "%s  %s%s\n"   "${CYAN}*${RESET}"  "$*"          "${RESET}"; }
success() { printf "%s  %s%s\n"   "${GREEN}+${RESET}" "${GREEN}$*"  "${RESET}"; }
warn()    { printf "%s  %s%s\n"   "${YELLOW}!${RESET}" "${YELLOW}$*" "${RESET}"; }
error()   { printf "%s  %s%s\n"   "${RED}x${RESET}"   "${RED}$*"    "${RESET}" >&2; }
header()  { printf "\n%s%s%s\n\n" "${BOLD}${CYAN}"     "$*"          "${RESET}"; }
step()    { printf "\n%s[%s/%s]%s %s%s%s\n" "${DIM}" "$1" "$2" "${RESET}" "${BOLD}" "$3" "${RESET}"; }

run_quiet() {
  local label="$1"; shift
  printf "  %-40s" "$label"
  if "$@" >/dev/null 2>&1; then
    printf "${GREEN}+${RESET}\n"
  else
    printf "${RED}x${RESET}\n"
    return 1
  fi
}

# ──────────────────────────────────────────────
# Defaults
# ──────────────────────────────────────────────
DEPLOY_MODE="bare-metal"     # bare-metal | docker
COMPLIANCE_PORT=4000
DASHBOARD_PORT=5000
PA11Y_URL=""
PA11Y_MODE="builtin"         # builtin | external
SEED=true
INTERACTIVE=true
REPO_URL="https://github.com/trunten82/luqen.git"
INSTALL_DIR="${HOME}/luqen"

# Database
DB_ADAPTER="sqlite"
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

# CLI-only options
INCLUDE_COMPLIANCE=false

# Storage plugins
STORAGE_S3=false
STORAGE_AZURE=false
S3_BUCKET=""
S3_REGION="us-east-1"
S3_ACCESS_KEY=""
S3_SECRET_KEY=""
AZURE_CONTAINER=""
AZURE_CONNECTION_STRING=""

# Admin user
ADMIN_USERNAME=""
ADMIN_PASSWORD=""
API_KEY=""

# Internal
SESSION_SECRET=""
CLIENT_ID=""
CLIENT_SECRET=""
CONFIG_FILE=""

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
  --mode bare-metal|docker    Deployment mode (default: bare-metal)
  --port PORT                 Compliance port (default: 4000); dashboard = PORT+1000
  --pa11y-url URL             External pa11y webservice URL (validated)
  --db sqlite|postgres|mongodb  Database adapter (default: sqlite)
  --db-url URL                Database connection string (postgres:// or mongodb://)
  --auth none|entra|okta|google  Identity provider (default: none)
  --no-seed                   Skip baseline seeding
  --non-interactive           Skip all prompts (use defaults + flags)
  --install-dir DIR           Installation directory (default: ~/luqen)
  --help                      Show this help

Auth config (non-interactive):
  --auth-tenant-id ID         Entra tenant ID
  --auth-client-id ID         OAuth client ID (Entra/Okta/Google)
  --auth-client-secret S      OAuth client secret
  --auth-org-url URL          Okta org URL
  --auth-hosted-domain D      Google hosted domain restriction

Notifications (non-interactive):
  --with-notify-slack         Install Slack plugin (requires --slack-webhook-url)
  --with-notify-teams         Install Teams plugin (requires --teams-webhook-url)
  --with-notify-email         Install Email plugin (requires --smtp-host etc.)
  --slack-webhook-url URL     Slack webhook URL
  --teams-webhook-url URL     Teams webhook URL
  --smtp-host HOST            SMTP server hostname
  --smtp-port PORT            SMTP port (default: 587)
  --smtp-user USER            SMTP username
  --smtp-pass PASS            SMTP password
  --smtp-from ADDR            From address

Admin user (non-interactive):
  --admin-user USER           Admin username
  --admin-pass PASS           Admin password (min 8 chars)
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)             DEPLOY_MODE="$2"; shift 2 ;;
    --port)             COMPLIANCE_PORT="$2"; DASHBOARD_PORT=$(( $2 + 1000 )); shift 2 ;;
    --pa11y-url)        PA11Y_URL="$2"; PA11Y_MODE="external"; shift 2 ;;
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
    --with-notify-slack)   NOTIFY_SLACK=true; shift ;;
    --with-notify-teams)   NOTIFY_TEAMS=true; shift ;;
    --with-notify-email)   NOTIFY_EMAIL=true; shift ;;
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

# ──────────────────────────────────────────────
# Validation helpers
# ──────────────────────────────────────────────
validate_url() {
  curl -sf --max-time 5 "$1" >/dev/null 2>&1
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
  local host="$1" port="$2"
  node -e "
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({ host: '${host}', port: ${port}, secure: false, tls: { rejectUnauthorized: false } });
    t.verify().then(() => process.exit(0)).catch(() => {
      const net = require('net');
      const sock = net.createConnection({ host: '${host}', port: ${port}, timeout: 5000 });
      sock.on('connect', () => { sock.destroy(); process.exit(0); });
      sock.on('error', () => process.exit(1));
      sock.on('timeout', () => { sock.destroy(); process.exit(1); });
    });
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

# ──────────────────────────────────────────────
# INTERACTIVE WIZARD
# ──────────────────────────────────────────────
run_wizard() {
  printf "\n"
  printf "  %s+======================================+%s\n" "${BOLD}${CYAN}" "${RESET}"
  printf "  %s|     Luqen -- Installation Wizard     |%s\n" "${BOLD}${CYAN}" "${RESET}"
  printf "  %s+======================================+%s\n" "${BOLD}${CYAN}" "${RESET}"
  printf "\n  Enterprise accessibility testing platform\n"

  # ── 1: What to install ─────────────────────
  header "1. What would you like to install?"
  printf "  Choose the setup that matches your role:\n\n"

  local install_choice
  install_choice=$(ask_choice "Installation type:" \
    "Developer tools (CLI scanner + MCP server for IDE integration)" \
    "Full platform (dashboard + compliance + scanner + plugins)" \
    "Docker Compose (full platform in containers)")

  case "${install_choice}" in
    1)
      DEPLOY_MODE="cli-only"
      success "Developer tools — CLI scanner + MCP server for VS Code / Claude Code"
      printf "\n  %sAlso install the compliance module?%s\n" "${DIM}" "${RESET}"
      printf "  (adds legal compliance checking against 58 jurisdictions)\n\n"
      if ask_yn "Include compliance module?" "n"; then
        INCLUDE_COMPLIANCE=true
        success "Compliance module included"
      fi
      ;;
    3)
      DEPLOY_MODE="docker"
      success "Docker Compose deployment selected"
      ;;
    *)
      DEPLOY_MODE="bare-metal"
      success "Full platform selected (dashboard + compliance + scanner)"
      ;;
  esac

  case "${DEPLOY_MODE}" in
    cli-only)  run_wizard_cli_only ;;
    docker)    run_wizard_docker ;;
    *)         run_wizard_bare_metal ;;
  esac
}

# ──────────────────────────────────────────────
# CLI-only wizard — minimal, just the scanner
# ──────────────────────────────────────────────
run_wizard_cli_only() {
  header "CLI Scanner Setup"
  printf "  Installs @luqen/core with built-in pa11y scanner.\n"
  printf "  Use as: luqen scan https://example.com\n"
  printf "  Or as MCP server in VS Code / Claude Code.\n\n"

  ask "Installation directory" "${INSTALL_DIR}" INSTALL_DIR

  # Summary
  printf "\n"
  printf "  %s%-22s%s %s\n" "${BOLD}" "Mode:" "${RESET}" "CLI scanner only"
  printf "  %s%-22s%s %s\n" "${BOLD}" "Install directory:" "${RESET}" "${INSTALL_DIR}"
  printf "  %s%-22s%s %s\n" "${BOLD}" "Scanner:" "${RESET}" "Built-in pa11y (no external service)"
  printf "\n"

  if ! ask_yn "Proceed with installation?" "y"; then
    info "Installation cancelled."
    exit 0
  fi
}

# ──────────────────────────────────────────────
# Docker wizard — minimal prompts
# ──────────────────────────────────────────────
run_wizard_docker() {
  info "Scanner: built-in (pa11y library in container)"

  # ── Ports ────────────────────────────────────
  header "2. Ports"
  ask "Compliance port" "${COMPLIANCE_PORT}" COMPLIANCE_PORT
  DASHBOARD_PORT=$(( COMPLIANCE_PORT + 1000 ))
  ask "Dashboard port" "${DASHBOARD_PORT}" DASHBOARD_PORT

  # ── Admin user ───────────────────────────────
  header "3. Admin Account"
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
    success "Admin user will be created after startup"
  fi

  # ── Summary ──────────────────────────────────
  print_summary_docker
}

# ──────────────────────────────────────────────
# Bare-metal wizard — full prompts
# ──────────────────────────────────────────────
run_wizard_bare_metal() {

  # ── 2: Scanner Engine ────────────────────────
  header "2. Scanner Engine"

  local scanner_choice
  scanner_choice=$(ask_choice "Scanner engine:" \
    "Built-in (pa11y library -- recommended, no external deps)" \
    "External pa11y webservice (enter URL, validated)")

  case "${scanner_choice}" in
    2)
      PA11Y_MODE="external"
      local pa11y_ok=false
      for attempt in 1 2 3; do
        ask "pa11y webservice URL" "http://localhost:3000" PA11Y_URL
        printf "  %sValidating pa11y endpoint...%s " "${DIM}" "${RESET}"
        if validate_url "${PA11Y_URL}/api/tasks"; then
          success "reachable"
          pa11y_ok=true
          break
        fi
        warn "Could not reach ${PA11Y_URL}/api/tasks (attempt ${attempt}/3)"
      done
      if [ "${pa11y_ok}" = "false" ]; then
        error "pa11y URL validation failed. You can configure it later."
        PA11Y_URL=""
        PA11Y_MODE="builtin"
      fi
      ;;
    *)
      PA11Y_MODE="builtin"
      PA11Y_URL=""
      success "Built-in scanner (pa11y library, no external service needed)"
      ;;
  esac

  # ── 3: Database ──────────────────────────────
  header "3. Database"
  printf "  The dashboard needs a database for scan results, users, and settings.\n\n"

  local db_choice
  db_choice=$(ask_choice "Database:" \
    "SQLite (default, no setup needed)" \
    "PostgreSQL (enter connection string, validated)" \
    "MongoDB (enter connection URI, validated)")

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
      ask "MongoDB connection URI" "mongodb://localhost:27017/luqen" DB_CONNECTION_STRING
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

  # ── 4: Authentication ───────────────────────
  header "4. Authentication"
  printf "  Choose how users will sign in.\n\n"

  local auth_choice
  auth_choice=$(ask_choice "Identity provider:" \
    "API key only (solo/team mode -- default)" \
    "Azure Entra ID SSO" \
    "Okta SSO" \
    "Google Workspace SSO")

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

  # ── 5: Notifications (multi-select) ─────────
  header "5. Notifications"
  printf "  Get notified when scans complete (select all that apply).\n\n"

  if ask_yn "Slack notifications?" "n"; then
    NOTIFY_SLACK=true
    ask "Slack webhook URL" "" SLACK_WEBHOOK_URL
  fi
  if ask_yn "Microsoft Teams notifications?" "n"; then
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
    if validate_smtp "${SMTP_HOST}" "${SMTP_PORT}"; then
      success "SMTP reachable"
    else
      warn "Could not reach SMTP server -- you can fix this later in plugin settings"
    fi
  fi

  # ── 6: Storage Plugins ──────────────────────
  header "6. Report Storage"
  printf "  Reports are stored locally by default. Optional cloud storage:\n\n"

  if ask_yn "AWS S3 storage?" "n"; then
    STORAGE_S3=true
    ask "S3 bucket name" "" S3_BUCKET
    ask "AWS region" "us-east-1" S3_REGION
    ask_secret "AWS access key ID" S3_ACCESS_KEY
    ask_secret "AWS secret access key" S3_SECRET_KEY
  fi
  if ask_yn "Azure Blob storage?" "n"; then
    STORAGE_AZURE=true
    ask "Azure container name" "" AZURE_CONTAINER
    ask_secret "Azure connection string" AZURE_CONNECTION_STRING
  fi

  # ── 7: Ports ─────────────────────────────────
  header "7. Ports"
  ask "Compliance port" "${COMPLIANCE_PORT}" COMPLIANCE_PORT
  DASHBOARD_PORT=$(( COMPLIANCE_PORT + 1000 ))
  ask "Dashboard port" "${DASHBOARD_PORT}" DASHBOARD_PORT

  # ── Install dir ──────────────────────────────
  ask "Installation directory" "${INSTALL_DIR}" INSTALL_DIR

  # ── 8: Admin user ────────────────────────────
  header "8. Admin Account"
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

  # ── 8: Summary ───────────────────────────────
  print_summary_bare_metal
}

# ──────────────────────────────────────────────
# Summary — bare metal
# ──────────────────────────────────────────────
print_summary_bare_metal() {
  printf "\n"
  printf "  %s+------------------------------------------+%s\n" "${BOLD}" "${RESET}"
  printf "  %s|        8. Installation Summary            |%s\n" "${BOLD}" "${RESET}"
  printf "  %s+------------------------------------------+%s\n" "${BOLD}" "${RESET}"
  printf "\n"
  printf "  %-22s %s\n" "Mode:" "Bare metal"
  printf "  %-22s %s\n" "Install directory:" "${INSTALL_DIR}"
  printf "  %-22s %s\n" "Compliance port:" "${COMPLIANCE_PORT}"
  printf "  %-22s %s\n" "Dashboard port:" "${DASHBOARD_PORT}"
  printf "  %-22s %s\n" "Scanner:" "$([ "${PA11Y_MODE}" = "external" ] && echo "external (${PA11Y_URL})" || echo "built-in (pa11y library)")"
  printf "  %-22s %s\n" "Database:" "${DB_ADAPTER}"
  printf "  %-22s %s\n" "Authentication:" "${AUTH_PROVIDER}"

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
# Summary — Docker
# ──────────────────────────────────────────────
print_summary_docker() {
  printf "\n"
  printf "  %s+------------------------------------------+%s\n" "${BOLD}" "${RESET}"
  printf "  %s|          Installation Summary             |%s\n" "${BOLD}" "${RESET}"
  printf "  %s+------------------------------------------+%s\n" "${BOLD}" "${RESET}"
  printf "\n"
  printf "  %-22s %s\n" "Mode:" "Docker Compose"
  printf "  %-22s %s\n" "Compliance port:" "${COMPLIANCE_PORT}"
  printf "  %-22s %s\n" "Dashboard port:" "${DASHBOARD_PORT}"
  printf "  %-22s %s\n" "Scanner:" "built-in (pa11y library)"
  printf "  %-22s %s\n" "Database:" "SQLite (container volume)"
  [ -n "${ADMIN_USERNAME}" ] && printf "  %-22s %s\n" "Admin user:" "${ADMIN_USERNAME}"

  printf "\n"
  if ! ask_yn "Proceed with installation?" "y"; then
    info "Installation cancelled."
    exit 0
  fi
}

# ══════════════════════════════════════════════
#  BARE-METAL INSTALLATION
# ══════════════════════════════════════════════

TOTAL_STEPS_BM=10

# ──────────────────────────────────────────────
# Step 1: Prerequisites
# ──────────────────────────────────────────────
check_prerequisites() {
  step 1 $TOTAL_STEPS_BM "Checking prerequisites"

  local missing=()
  command -v git &>/dev/null || missing+=(git)
  command -v curl &>/dev/null || missing+=(curl)

  if ! command -v node &>/dev/null; then
    missing+=(nodejs)
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    info "Missing: ${missing[*]} -- attempting auto-install..."
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
  step 2 $TOTAL_STEPS_BM "Fetching source code"

  if [ -d "${INSTALL_DIR}/.git" ]; then
    run_quiet "Pulling latest changes" git -C "${INSTALL_DIR}" pull --ff-only
  else
    run_quiet "Cloning repository" git clone "${REPO_URL}" "${INSTALL_DIR}"
  fi
}

# ──────────────────────────────────────────────
# Step 3: Install & build
# ──────────────────────────────────────────────
install_and_build() {
  step 3 $TOTAL_STEPS_BM "Installing dependencies and building"

  cd "${INSTALL_DIR}"
  run_quiet "Installing npm dependencies" npm install --prefer-offline
  run_quiet "Building packages" npm run build --workspaces
}

# ──────────────────────────────────────────────
# Step 4: Generate JWT keys + session secret
# ──────────────────────────────────────────────
generate_secrets() {
  step 4 $TOTAL_STEPS_BM "Generating secrets"

  KEYS_DIR="${INSTALL_DIR}/packages/compliance/keys"
  if [ -f "${KEYS_DIR}/private.pem" ]; then
    info "JWT keys already exist -- reusing"
  else
    mkdir -p "${KEYS_DIR}"
    (cd "${INSTALL_DIR}/packages/compliance" && node dist/cli.js keys generate) >/dev/null 2>&1
    success "JWT RS256 key pair generated"
  fi

  SESSION_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
  success "Session secret generated"
}

# ──────────────────────────────────────────────
# Step 5: Seed compliance data
# ──────────────────────────────────────────────
seed_data() {
  step 5 $TOTAL_STEPS_BM "Seeding compliance data"

  if [ "${SEED}" = "true" ]; then
    run_quiet "Seeding jurisdictions and regulations" \
      bash -c "cd '${INSTALL_DIR}/packages/compliance' && node dist/cli.js seed"
  else
    info "Seeding skipped (--no-seed)"
  fi
}

# ──────────────────────────────────────────────
# Step 6: Create OAuth client
# ──────────────────────────────────────────────
create_oauth_client() {
  step 6 $TOTAL_STEPS_BM "Creating OAuth client"

  CLIENT_CACHE="${INSTALL_DIR}/.install-client"
  if [ -f "${CLIENT_CACHE}" ]; then
    CLIENT_ID=$(grep "^client_id=" "${CLIENT_CACHE}" | cut -d= -f2-)
    CLIENT_SECRET=$(grep "^client_secret=" "${CLIENT_CACHE}" | cut -d= -f2-)
    info "OAuth client already exists -- reusing"
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
# Step 7: Write config file
# ──────────────────────────────────────────────
write_config() {
  step 7 $TOTAL_STEPS_BM "Writing configuration"

  # Resolve to absolute path
  INSTALL_DIR="$(cd "${INSTALL_DIR}" && pwd)"
  CONFIG_FILE="${INSTALL_DIR}/dashboard.config.json"

  local db_config=""
  case "${DB_ADAPTER}" in
    postgres)
      db_config="$(printf ',\n  "dbAdapter": "postgres",\n  "dbUrl": "%s"' "${DB_CONNECTION_STRING}")"
      ;;
    mongodb)
      db_config="$(printf ',\n  "dbAdapter": "mongodb",\n  "dbUrl": "%s"' "${DB_CONNECTION_STRING}")"
      ;;
  esac

  # Only set webserviceUrl if user provided an external pa11y URL
  local webservice_field=""
  if [ "${PA11Y_MODE}" = "external" ] && [ -n "${PA11Y_URL}" ]; then
    webservice_field="$(printf ',\n  "webserviceUrl": "%s"' "${PA11Y_URL}")"
  fi

  cat > "${CONFIG_FILE}" <<CONF
{
  "port": ${DASHBOARD_PORT},
  "complianceUrl": "http://localhost:${COMPLIANCE_PORT}",
  "sessionSecret": "${SESSION_SECRET}",
  "complianceClientId": "${CLIENT_ID}",
  "complianceClientSecret": "${CLIENT_SECRET}",
  "dbPath": "${INSTALL_DIR}/dashboard.db",
  "reportsDir": "${INSTALL_DIR}/reports",
  "pluginsDir": "${INSTALL_DIR}/plugins"${webservice_field}${db_config}
}
CONF
  chmod 600 "${CONFIG_FILE}"
  success "dashboard.config.json written (all absolute paths)"
}

# ──────────────────────────────────────────────
# Step 8: Create systemd services
# ──────────────────────────────────────────────
create_systemd_services() {
  step 8 $TOTAL_STEPS_BM "Creating systemd services"

  if ! command -v systemctl &>/dev/null; then
    warn "systemd not available -- skipping service creation"
    return
  fi

  local node_path
  node_path="$(command -v node)"

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
ExecStart=${node_path} ${INSTALL_DIR}/packages/compliance/dist/cli.js serve --port ${COMPLIANCE_PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

  # Dashboard service — absolute paths everywhere
  local env_webservice=""
  if [ "${PA11Y_MODE}" = "external" ] && [ -n "${PA11Y_URL}" ]; then
    env_webservice="Environment=DASHBOARD_WEBSERVICE_URL=${PA11Y_URL}"
  fi

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
Environment=DASHBOARD_COMPLIANCE_CLIENT_ID=${CLIENT_ID}
Environment=DASHBOARD_COMPLIANCE_CLIENT_SECRET=${CLIENT_SECRET}
${env_webservice}
ExecStart=${node_path} ${INSTALL_DIR}/packages/dashboard/dist/cli.js serve --config ${CONFIG_FILE}
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
# Step 9: Start services + post-install tasks
# ──────────────────────────────────────────────
start_services_and_post_install() {
  step 9 $TOTAL_STEPS_BM "Starting services"

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

    nohup node "${INSTALL_DIR}/packages/compliance/dist/cli.js" serve --port "${COMPLIANCE_PORT}" \
      > /tmp/luqen-comp-install.log 2>&1 &
    COMP_PID=$!
    sleep 3

    DASHBOARD_SESSION_SECRET="${SESSION_SECRET}" \
      DASHBOARD_COMPLIANCE_URL="http://localhost:${COMPLIANCE_PORT}" \
      DASHBOARD_COMPLIANCE_CLIENT_ID="${CLIENT_ID}" \
      DASHBOARD_COMPLIANCE_CLIENT_SECRET="${CLIENT_SECRET}" \
      nohup node "${INSTALL_DIR}/packages/dashboard/dist/cli.js" serve --config "${CONFIG_FILE}" \
      > /tmp/luqen-dash-install.log 2>&1 &
    DASH_PID=$!
    sleep 4
    success "Services started (PIDs: ${COMP_PID}, ${DASH_PID})"
  fi

  # Generate a fresh API key via CLI (reliable, not log-dependent)
  API_KEY=""
  local key_output
  key_output=$(node "${INSTALL_DIR}/packages/dashboard/dist/cli.js" api-key \
    --config "${INSTALL_DIR}/dashboard.config.json" 2>&1) || true
  API_KEY=$(echo "${key_output}" | grep -oP '[a-f0-9]{64}' | head -1 || echo "")

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

  # Install plugins (needs running services + API key)
  if [ -n "${API_KEY}" ]; then
    install_plugins
  else
    warn "Could not retrieve API key -- skipping plugin installation"
  fi

  # Stop temp processes if not using systemd
  if ! command -v systemctl &>/dev/null; then
    kill "${COMP_PID}" "${DASH_PID}" 2>/dev/null || true
    wait "${COMP_PID}" "${DASH_PID}" 2>/dev/null || true
  fi
}

# ──────────────────────────────────────────────
# Plugin installation (via REST API)
# ──────────────────────────────────────────────
install_plugins() {
  info "Installing plugins..."

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
# Step 10: Summary (bare metal)
# ──────────────────────────────────────────────
show_summary_bare_metal() {
  step 10 $TOTAL_STEPS_BM "Installation complete"

  printf "\n"
  printf "  %s%s+==========================================+%s\n" "${BOLD}" "${GREEN}" "${RESET}"
  printf "  %s%s|      Luqen installed successfully!       |%s\n" "${BOLD}" "${GREEN}" "${RESET}"
  printf "  %s%s+==========================================+%s\n" "${BOLD}" "${GREEN}" "${RESET}"
  printf "\n"
  printf "  %sURLs:%s\n" "${BOLD}" "${RESET}"
  printf "    Dashboard:   %s%shttp://localhost:${DASHBOARD_PORT}%s\n" "${BOLD}" "${CYAN}" "${RESET}"
  printf "    Compliance:  %s%shttp://localhost:${COMPLIANCE_PORT}%s\n" "${BOLD}" "${CYAN}" "${RESET}"
  if [ "${PA11Y_MODE}" = "external" ] && [ -n "${PA11Y_URL}" ]; then
    printf "    pa11y:       %s\n" "${PA11Y_URL}"
  else
    printf "    Scanner:     built-in (pa11y library)\n"
  fi
  printf "\n"

  if [ -n "${ADMIN_USERNAME}" ]; then
    printf "  %sLogin:%s\n" "${BOLD}" "${RESET}"
    printf "    Username:  %s\n" "${ADMIN_USERNAME}"
    printf "    Password:  (the password you entered)\n"
    printf "\n"
  fi

  if [ -n "${API_KEY}" ]; then
    printf "  %sAPI Key:%s (save this -- also works for login)\n" "${BOLD}" "${RESET}"
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

# ══════════════════════════════════════════════
#  DOCKER COMPOSE INSTALLATION
# ══════════════════════════════════════════════

TOTAL_STEPS_DOCKER=5

run_docker_install() {
  # Step 1: Prerequisites
  step 1 $TOTAL_STEPS_DOCKER "Checking Docker prerequisites"

  if ! command -v docker &>/dev/null; then
    error "Docker is not installed. Install from https://docs.docker.com/engine/install/"
    exit 1
  fi
  if ! docker compose version &>/dev/null 2>&1 && ! docker-compose --version &>/dev/null 2>&1; then
    error "Docker Compose is not installed. Install from https://docs.docker.com/compose/install/"
    exit 1
  fi
  success "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

  # Determine compose command
  local COMPOSE_CMD="docker compose"
  if ! docker compose version &>/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
  fi

  # Step 2: Clone / pull
  step 2 $TOTAL_STEPS_DOCKER "Fetching source code"

  if [ -d "${INSTALL_DIR}/.git" ]; then
    run_quiet "Pulling latest changes" git -C "${INSTALL_DIR}" pull --ff-only
  else
    if ! command -v git &>/dev/null; then
      error "git is required to clone the repository."
      exit 1
    fi
    run_quiet "Cloning repository" git clone "${REPO_URL}" "${INSTALL_DIR}"
  fi

  # Step 3: Generate .env file
  step 3 $TOTAL_STEPS_DOCKER "Generating configuration"

  INSTALL_DIR="$(cd "${INSTALL_DIR}" && pwd)"
  SESSION_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p 2>/dev/null | tr -d '\n')

  local ENV_FILE="${INSTALL_DIR}/.env"
  cat > "${ENV_FILE}" <<ENVFILE
# Luqen Docker Compose configuration
# Generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
COMPLIANCE_PORT=${COMPLIANCE_PORT}
DASHBOARD_PORT=${DASHBOARD_PORT}
DASHBOARD_SESSION_SECRET=${SESSION_SECRET}
LUQEN_WEBSERVICE_URL=
ENVFILE
  chmod 600 "${ENV_FILE}"
  success ".env written at ${ENV_FILE}"

  # Step 4: Build and start
  step 4 $TOTAL_STEPS_DOCKER "Building and starting containers"

  cd "${INSTALL_DIR}"
  run_quiet "Building images" ${COMPOSE_CMD} build
  run_quiet "Starting containers" ${COMPOSE_CMD} up -d

  info "Waiting for services to become healthy..."
  local attempts=0
  until curl -sf "http://localhost:${DASHBOARD_PORT}/health" >/dev/null 2>&1; do
    attempts=$(( attempts + 1 ))
    if [ "${attempts}" -ge 30 ]; then
      error "Services did not start. Check: ${COMPOSE_CMD} logs"
      return
    fi
    sleep 2
  done
  success "All containers running and healthy"

  # Grab API key from container logs
  API_KEY=""
  API_KEY=$(${COMPOSE_CMD} logs dashboard 2>/dev/null | grep -oP 'API Key: \K[a-f0-9]{64}' | head -1 || echo "")

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

  # Step 5: Summary
  step 5 $TOTAL_STEPS_DOCKER "Installation complete"

  printf "\n"
  printf "  %s%s+==========================================+%s\n" "${BOLD}" "${GREEN}" "${RESET}"
  printf "  %s%s|      Luqen installed successfully!       |%s\n" "${BOLD}" "${GREEN}" "${RESET}"
  printf "  %s%s+==========================================+%s\n" "${BOLD}" "${GREEN}" "${RESET}"
  printf "\n"
  printf "  %sURLs:%s\n" "${BOLD}" "${RESET}"
  printf "    Dashboard:   %s%shttp://localhost:${DASHBOARD_PORT}%s\n" "${BOLD}" "${CYAN}" "${RESET}"
  printf "    Compliance:  %s%shttp://localhost:${COMPLIANCE_PORT}%s\n" "${BOLD}" "${CYAN}" "${RESET}"
  printf "    Scanner:     built-in (pa11y library)\n"
  printf "\n"

  if [ -n "${ADMIN_USERNAME}" ]; then
    printf "  %sLogin:%s\n" "${BOLD}" "${RESET}"
    printf "    Username:  %s\n" "${ADMIN_USERNAME}"
    printf "    Password:  (the password you entered)\n"
    printf "\n"
  fi

  if [ -n "${API_KEY}" ]; then
    printf "  %sAPI Key:%s (save this -- also works for login)\n" "${BOLD}" "${RESET}"
    printf "    %s%s%s\n" "${YELLOW}" "${API_KEY}" "${RESET}"
    printf "\n"
  fi

  printf "  %sDocker management:%s\n" "${BOLD}" "${RESET}"
  printf "    cd %s\n" "${INSTALL_DIR}"
  printf "    ${COMPOSE_CMD} ps              # status\n"
  printf "    ${COMPOSE_CMD} logs -f         # follow logs\n"
  printf "    ${COMPOSE_CMD} down            # stop\n"
  printf "    ${COMPOSE_CMD} up -d           # start\n"
  printf "\n"
  printf "  %sData volumes:%s\n" "${BOLD}" "${RESET}"
  printf "    compliance-data, compliance-keys, dashboard-data, dashboard-reports\n"
  printf "\n"
}

# ══════════════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════════════

# Run wizard if interactive
if [ "${INTERACTIVE}" = "true" ] && { [ -t 0 ] || [ -n "${LUQEN_INSTALL_REEXEC:-}" ]; }; then
  run_wizard
fi

# Route to the correct installation path
case "${DEPLOY_MODE}" in
  docker)
    run_docker_install
    ;;
  cli-only)
    # Developer tools — CLI scanner + optional compliance
    check_prerequisites
    clone_or_pull

    local total_steps=3
    [ "${INCLUDE_COMPLIANCE}" = "true" ] && total_steps=5

    step 1 ${total_steps} "Installing dependencies"
    run_quiet "Installing npm dependencies" npm install --prefer-offline
    success "Dependencies installed"

    step 2 ${total_steps} "Building scanner"
    run_quiet "Building @luqen/core" npm run build -w packages/core
    success "Build complete"

    step 3 ${total_steps} "Linking CLI"
    run_quiet "Linking luqen command" npm link -w packages/core
    success "CLI linked"

    if [ "${INCLUDE_COMPLIANCE}" = "true" ]; then
      step 4 ${total_steps} "Building compliance module"
      run_quiet "Building @luqen/compliance" npm run build -w packages/compliance
      success "Compliance built"

      step 5 ${total_steps} "Setting up compliance"
      (cd "${INSTALL_DIR}/packages/compliance" && node dist/cli.js keys generate 2>/dev/null || true)
      (cd "${INSTALL_DIR}/packages/compliance" && node dist/cli.js seed 2>/dev/null || true)
      success "Compliance ready (58 jurisdictions, 62 regulations)"
    fi

    printf "\n"
    printf "  %s+======================================+%s\n" "${GREEN}${BOLD}" "${RESET}"
    printf "  %s|    Luqen Developer Tools Installed   |%s\n" "${GREEN}${BOLD}" "${RESET}"
    printf "  %s+======================================+%s\n" "${GREEN}${BOLD}" "${RESET}"
    printf "\n"
    printf "  %sScan a site:%s\n" "${BOLD}" "${RESET}"
    printf "    luqen scan https://example.com\n"
    printf "    luqen scan https://example.com --format both\n"
    printf "\n"
    if [ "${INCLUDE_COMPLIANCE}" = "true" ]; then
      printf "  %sScan with compliance checking:%s\n" "${BOLD}" "${RESET}"
      printf "    cd %s/packages/compliance && node dist/cli.js serve &\n" "${INSTALL_DIR}"
      printf "    luqen scan https://example.com --compliance-url http://localhost:4000 --jurisdictions EU,US\n"
      printf "\n"
      printf "  %sCompliance MCP server:%s\n" "${BOLD}" "${RESET}"
      printf "    node %s/packages/compliance/dist/cli.js mcp\n" "${INSTALL_DIR}"
      printf "\n"
    fi
    printf "  %sMCP server (for VS Code / Claude Code):%s\n" "${BOLD}" "${RESET}"
    printf "    node %s/packages/core/dist/mcp.js\n" "${INSTALL_DIR}"
    printf "\n"
    printf "  No external services needed — pa11y runs as a built-in library.\n"
    printf "\n"
    ;;
  *)
    # Full bare metal installation
    check_prerequisites          # Step 1
    clone_or_pull                # Step 2
    install_and_build            # Step 3
    generate_secrets             # Step 4
    seed_data                    # Step 5
    create_oauth_client          # Step 6
    write_config                 # Step 7
    create_systemd_services      # Step 8
    start_services_and_post_install  # Step 9
    show_summary_bare_metal      # Step 10
    ;;
esac
