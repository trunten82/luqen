#!/usr/bin/env bash
# install.sh — interactive installer for Luqen
# Last reviewed for v3.1.0 (Phase 40 / DOC-03) — head migration 061
# Usage:  curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash
# Flags:  --non-interactive, --mode bare-metal|docker, --port PORT, --help

set -euo pipefail

# ──────────────────────────────────────────────
# Guard against deleted CWD (getcwd error)
# ──────────────────────────────────────────────
cd "$HOME" 2>/dev/null || cd /root 2>/dev/null || cd /tmp

# ──────────────────────────────────────────────
# Re-exec from temp file when piped (curl | bash)
# so that stdin is the terminal for interactive prompts
# ──────────────────────────────────────────────
# Detect "actually piped" vs "stdin happens to not be a tty".
#   - curl | bash       → BASH_SOURCE[0] is empty/main, $0 is "bash" (or "-bash")
#   - bash install.sh   → BASH_SOURCE[0] is the file path, $0 is the file path
#   - ssh host 'bash install.sh' → same as above; stdin is closed but script is real
# Only the first case needs the cat>tmpfile re-exec to capture script + free stdin
# for prompts. Using BASH_SOURCE distinguishes them reliably.
__luqen_piped=0
if [ -z "${BASH_SOURCE[0]:-}" ] || [ "${BASH_SOURCE[0]}" = "main" ] || [ "${BASH_SOURCE[0]}" = "bash" ]; then
  __luqen_piped=1
fi
if [ "${__luqen_piped}" = "1" ] && [ -z "${LUQEN_INSTALL_REEXEC:-}" ]; then
  TMPSCRIPT="$(mktemp /tmp/luqen-install.XXXXXX.sh)"
  cat > "${TMPSCRIPT}"
  export LUQEN_INSTALL_REEXEC=1
  # Only redirect to /dev/tty if we have one (interactive use). Non-interactive
  # callers (CI, ssh host 'curl|bash --non-interactive ...') have no tty and
  # must run without the redirect or the script aborts on the redirect line.
  REEXEC_NONINTERACTIVE=0
  for arg in "$@"; do
    case "$arg" in
      --non-interactive) REEXEC_NONINTERACTIVE=1 ;;
    esac
  done
  if [ "${REEXEC_NONINTERACTIVE}" = "1" ] || [ ! -e /dev/tty ]; then
    exec bash "${TMPSCRIPT}" "$@"
  else
    exec bash "${TMPSCRIPT}" "$@" < /dev/tty
  fi
fi
unset __luqen_piped

# ──────────────────────────────────────────────
# Color helpers
# ──────────────────────────────────────────────
if [ -t 1 ] && command -v tput &>/dev/null; then
  # A terminal without TERM (or without one of these capabilities) makes tput
  # fail; under set -e that would abort the install, so a missing capability is
  # just no colour.
  BOLD="$(tput bold 2>/dev/null || true)"; GREEN="$(tput setaf 2 2>/dev/null || true)"
  YELLOW="$(tput setaf 3 2>/dev/null || true)"; RED="$(tput setaf 1 2>/dev/null || true)"
  CYAN="$(tput setaf 6 2>/dev/null || true)"; DIM="$(tput dim 2>/dev/null || true)"
  RESET="$(tput sgr0 2>/dev/null || true)"
else
  BOLD="" GREEN="" YELLOW="" RED="" CYAN="" DIM="" RESET=""
fi

# OUT picks /dev/tty if available (interactive), else stdout (non-interactive,
# CI, piped). Without this, every helper printf would fail under set -e when
# no controlling terminal exists.
if [ -e /dev/tty ] && { : >/dev/tty; } 2>/dev/null; then OUT=/dev/tty; else OUT=/dev/stdout; fi
info()    { printf "%s  %s%s\n"   "${CYAN}*${RESET}"  "$*"          "${RESET}" >"$OUT"; }
success() { printf "%s  %s%s\n"   "${GREEN}+${RESET}" "${GREEN}$*"  "${RESET}" >"$OUT"; }
warn()    { printf "%s  %s%s\n"   "${YELLOW}!${RESET}" "${YELLOW}$*" "${RESET}" >"$OUT"; }
error()   { printf "%s  %s%s\n"   "${RED}x${RESET}"   "${RED}$*"    "${RESET}" >"$OUT"; }
header()  { printf "\n%s%s%s\n\n" "${BOLD}${CYAN}"     "$*"          "${RESET}" >"$OUT"; }
step()    { printf "\n%s[%s/%s]%s %s%s%s\n" "${DIM}" "$1" "$2" "${RESET}" "${BOLD}" "$3" "${RESET}" >"$OUT"; }

run_quiet() {
  local label="$1"; shift
  local logfile
  logfile="$(mktemp -t luqen-install-step.XXXXXX.log 2>/dev/null || echo "/tmp/luqen-install-step-$$.log")"
  printf "  %-40s" "$label"
  if "$@" >"${logfile}" 2>&1; then
    printf "${GREEN}+${RESET}\n"
    rm -f "${logfile}"
  else
    printf "${RED}x${RESET}\n"
    printf "  %sFailing step output (last 20 lines):%s\n" "${DIM}" "${RESET}" >"$OUT"
    tail -n 20 "${logfile}" | sed 's/^/    /' >"$OUT"
    printf "  %sFull log: %s%s\n" "${DIM}" "${logfile}" "${RESET}" >"$OUT"
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
UNINSTALL=false
UNINSTALL_PURGE=false
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
INCLUDE_BRANDING=false
BRANDING_PORT=4100
LLM_PORT=4200

# ──────────────────────────────────────────────
# Phase 42: 4-profile wizard model
# ──────────────────────────────────────────────
# PROFILE drives INSTALL_COMPONENTS dispatch. Set by --profile flag or wizard.
# Default (when --non-interactive without --profile) = "dashboard" (D-01 invariant).
PROFILE=""                        # cli | api | dashboard | docker
API_SERVICES=""                   # CSV: subset of compliance,branding,llm
WITH_MONITOR="false"              # --with-monitor (opt-in)
WITHOUT_COMPLIANCE="false"        # --without-compliance (dashboard profile)
WITHOUT_BRANDING="false"          # --without-branding (dashboard profile)
WITHOUT_LLM="false"               # --without-llm (dashboard profile)
MONITOR_PORT="${MONITOR_PORT:-4300}"  # avoid collision with LLM (4200)
INSTALL_COMPONENTS=()             # populated by derive_install_components()
MONITOR_CLIENT_ID=""
MONITOR_CLIENT_SECRET=""

# ──────────────────────────────────────────────
# Public URLs / OAuth issuer (v3.x)
#
# Phase 30/31.1 introduced OAuth 2.1 + PKCE + DCR + JWKS discovery and
# Streamable HTTP MCP endpoints. The dashboard advertises itself as the
# OAuth issuer, so it MUST know its own externally-reachable URL.
# Operators can override these for production installs (real hostnames).
# Each defaults to the local-loopback URL for development.
# ──────────────────────────────────────────────
DASHBOARD_PUBLIC_URL=""        # default resolved post-port-parsing
COMPLIANCE_PUBLIC_URL=""
BRANDING_PUBLIC_URL=""
LLM_PUBLIC_URL=""

# ──────────────────────────────────────────────
# Dashboard trusted proxies (Phase 96 / OPS-01)
#
# The list of proxy addresses whose X-Forwarded-For the dashboard trusts.
# Given as --trusted-proxies LIST, as DASHBOARD_TRUSTED_PROXIES in the
# installer's environment (this default honours the environment, like
# MONITOR_PORT), or at the wizard prompt. The installer holds no parser and no
# validator of its own: trusted_proxies_check runs the BUILT dashboard's
# loadConfig and resolveTrustedProxies. Empty means "write nothing", so the
# dashboard's code default stays the only default.
# ──────────────────────────────────────────────
DASHBOARD_TRUSTED_PROXIES="${DASHBOARD_TRUSTED_PROXIES:-}"
TRUSTED_PROXIES_WRITE=""       # the checked canonical value; empty = write nothing
CHECK_TRUSTED_PROXIES_ONLY="false"

# ──────────────────────────────────────────────
# OAuth signing-key rotation (Phase 31.1)
# ──────────────────────────────────────────────
OAUTH_KEY_MAX_AGE_DAYS="90"

# ──────────────────────────────────────────────
# Ollama (LLM provider)
# Optional — defaults to LLM-service-side default
# ──────────────────────────────────────────────
OLLAMA_BASE_URL=""

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

Deployment profile (Phase 42):
  --profile cli|api|dashboard|docker
                              Deployment profile. Default: dashboard.
                              cli       = @luqen/core only (stdio MCP for IDEs)
                              api       = headless services (use --api-services)
                              dashboard = dashboard + chosen subset of services
                              docker    = full stack via docker compose
  --api-services CSV          Comma-separated subset of compliance,branding,llm.
                              Honoured only with --profile api. Default: all.
  --with-monitor              Register monitor agent (luqen-monitor.service).
                              Requires --profile dashboard, OR --profile api with
                              compliance in --api-services. Default: off.
  --without-compliance        Skip compliance service (dashboard profile).
  --without-branding          Skip branding service (dashboard profile).
  --without-llm               Skip llm service (dashboard profile).
  --monitor-port PORT         Monitor agent A2A port (default: 4300; 1024-65535).

Reverse proxy (dashboard):
  --trusted-proxies LIST      Proxy addresses whose X-Forwarded-For the dashboard trusts:
                              addresses, CIDR ranges, loopback, linklocal, uniquelocal
                              or none. REPLACES the dashboard default. Also read from
                              DASHBOARD_TRUSTED_PROXIES in the installer's environment
                              (the flag wins). Bare metal: the dashboard's own rules
                              check it after the checkout and build, before any secret,
                              configuration file or service unit is written; a refused
                              list stops the install there. Docker: the installer does
                              not check it; the dashboard container does when it
                              starts, after .env is written. Default: nothing written.
  --check-trusted-proxies     Check the list against the dashboard built in --install-dir,
                              print what would be written, and install nothing.

Uninstall:
  --uninstall                 Stop services, remove systemd units, delete install dir.
                              Combine with --purge to also delete data (DB, configs, logs).
                              Combine with --keep-data to be explicit about preserving data
                              (the default — same effect as bare --uninstall).
  --purge                     With --uninstall: also delete dashboard.config.json,
                              dashboard.db, packages/compliance/compliance.db, ~/.luqen.
  --keep-data                 With --uninstall: preserve data files (default).
EOF
  exit "${1:-0}"
}

uninstall_luqen() {
  local purge="${1:-no}"
  header "Uninstalling Luqen"

  if command -v systemctl &>/dev/null; then
    info "Stopping and disabling systemd units..."
    for unit in luqen-compliance luqen-branding luqen-llm luqen-dashboard luqen-monitor; do
      systemctl stop "${unit}" 2>/dev/null || true
      systemctl disable "${unit}" 2>/dev/null || true
      rm -f "/etc/systemd/system/${unit}.service"
    done
    systemctl daemon-reload 2>/dev/null || true
    success "systemd units removed."
  fi

  if [ -d "${INSTALL_DIR}" ]; then
    if [ "${purge}" = "yes" ]; then
      info "Purging install directory and all data: ${INSTALL_DIR}"
      rm -rf "${INSTALL_DIR}"
    else
      info "Removing install directory (keeping ${INSTALL_DIR}/dashboard.db, ${INSTALL_DIR}/packages/compliance/compliance.db, ${INSTALL_DIR}/dashboard.config.json)"
      local backup_dir="${HOME}/.luqen-uninstall-$(date +%s)"
      mkdir -p "${backup_dir}"
      [ -f "${INSTALL_DIR}/dashboard.config.json" ] && cp "${INSTALL_DIR}/dashboard.config.json" "${backup_dir}/" 2>/dev/null || true
      [ -f "${INSTALL_DIR}/dashboard.db" ] && cp "${INSTALL_DIR}/dashboard.db" "${backup_dir}/" 2>/dev/null || true
      [ -f "${INSTALL_DIR}/packages/compliance/compliance.db" ] && cp "${INSTALL_DIR}/packages/compliance/compliance.db" "${backup_dir}/" 2>/dev/null || true
      rm -rf "${INSTALL_DIR}"
      success "Install dir removed. Data preserved at: ${backup_dir}"
    fi
  else
    info "No install dir found at ${INSTALL_DIR}"
  fi

  if [ "${purge}" = "yes" ] && [ -d "${HOME}/.luqen" ]; then
    rm -rf "${HOME}/.luqen"
    success "Removed ${HOME}/.luqen"
  fi

  echo ""
  success "Luqen uninstalled."
  if [ "${purge}" != "yes" ]; then
    echo ""
    info "Re-run with --purge to also drop preserved data."
  fi
  exit 0
}

# parse_args "$@" -- sets the option globals from the command line and does
# nothing else: it never dispatches --uninstall or --check-trusted-proxies (the
# entry point does, after the source-mode return). install.test.sh calls it
# explicitly after sourcing this file in source mode.
parse_args() {
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
      --dashboard-public-url)  DASHBOARD_PUBLIC_URL="$2"; shift 2 ;;
      --compliance-public-url) COMPLIANCE_PUBLIC_URL="$2"; shift 2 ;;
      --branding-public-url)   BRANDING_PUBLIC_URL="$2"; shift 2 ;;
      --llm-public-url)        LLM_PUBLIC_URL="$2"; shift 2 ;;
      --trusted-proxies)       DASHBOARD_TRUSTED_PROXIES="$2"; shift 2 ;;
      --check-trusted-proxies) CHECK_TRUSTED_PROXIES_ONLY="true"; shift ;;
      --oauth-key-max-age-days) OAUTH_KEY_MAX_AGE_DAYS="$2"; shift 2 ;;
      --ollama-base-url)  OLLAMA_BASE_URL="$2"; shift 2 ;;
      --uninstall)        UNINSTALL=true; shift ;;
      --purge)            UNINSTALL_PURGE=true; shift ;;
      --keep-data)        UNINSTALL_PURGE=false; shift ;;
      --profile)
        case "$2" in
          cli|api|dashboard|docker) PROFILE="$2" ;;
          *) error "--profile must be one of: cli, api, dashboard, docker"; exit 1 ;;
        esac
        shift 2 ;;
      --api-services)
        API_SERVICES="$2"
        # Validate each token in the CSV against an allow-list (T-42-02)
        IFS=',' read -ra _api_tokens <<< "${API_SERVICES}"
        for _tok in "${_api_tokens[@]}"; do
          case "${_tok}" in
            compliance|branding|llm) ;;
            *) error "--api-services tokens must be one of: compliance, branding, llm (got: ${_tok})"; exit 1 ;;
          esac
        done
        unset _api_tokens _tok
        shift 2 ;;
      --with-monitor)       WITH_MONITOR="true"; shift ;;
      --without-compliance) WITHOUT_COMPLIANCE="true"; shift ;;
      --without-branding)   WITHOUT_BRANDING="true"; shift ;;
      --without-llm)        WITHOUT_LLM="true"; shift ;;
      --monitor-port)
        # T-42-03: validate monitor port is integer in 1024-65535
        if ! [[ "$2" =~ ^[0-9]+$ ]] || [ "$2" -lt 1024 ] || [ "$2" -gt 65535 ]; then
          error "--monitor-port must be an integer between 1024 and 65535 (got: $2)"
          exit 1
        fi
        MONITOR_PORT="$2"; shift 2 ;;
      --help|-h) show_help ;;
      # An unknown option installs nothing, so it does not exit 0: a caller (CI,
      # or install.command, which registers launchd agents after an exit 0)
      # would read that as a finished install.
      *) error "Unknown option: $1"; show_help 2 ;;
    esac
  done
}

resolve_public_url_defaults() {
  # Called after port parsing / wizard so defaults track the real ports.
  [ -z "${DASHBOARD_PUBLIC_URL}" ]  && DASHBOARD_PUBLIC_URL="http://localhost:${DASHBOARD_PORT}"
  [ -z "${COMPLIANCE_PUBLIC_URL}" ] && COMPLIANCE_PUBLIC_URL="http://localhost:${COMPLIANCE_PORT}"
  [ -z "${BRANDING_PUBLIC_URL}" ]   && BRANDING_PUBLIC_URL="http://localhost:${BRANDING_PORT}"
  [ -z "${LLM_PUBLIC_URL}" ]        && LLM_PUBLIC_URL="http://localhost:${LLM_PORT}"
}

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
# Trusted-proxy list (Phase 96 / OPS-01, D-02)
#
# One gateway to the dashboard's own rules: trusted_proxies_check runs the BUILT
# dashboard's loadConfig (config.ts's own split and trim of
# DASHBOARD_TRUSTED_PROXIES) and resolveTrustedProxies (the rules: no trust-all
# lists, the public-space ceiling, no hop counts). This file holds no second
# parser and no second validator, so the installer cannot drift from the
# dashboard. The value reaches node ONLY through the DASHBOARD_TRUSTED_PROXIES
# environment variable of one process; it is never spliced into the script text
# (validate_postgres does that, and it is the anti-pattern) and never appears in
# any argv.
#
# Exit codes of the node helper:
#   0  checked; stdout holds the answer for the mode
#   2  the dashboard REFUSES the list; stderr holds its message verbatim
#   3  the check could not be loaded or run; stderr holds the reason
# ──────────────────────────────────────────────
IFS= read -r -d '' TRUSTED_PROXIES_CHECK_JS <<'JS' || true
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [dist, mode] = process.argv.slice(1);
let loadConfig;
let resolveTrustedProxies;
try {
  const cfgMod = await import(pathToFileURL(join(dist, 'config.js')).href);
  const tpMod = await import(pathToFileURL(join(dist, 'auth', 'trusted-proxies.js')).href);
  loadConfig = cfgMod.loadConfig;
  resolveTrustedProxies = tpMod.resolveTrustedProxies;
  if (typeof loadConfig !== 'function') throw new Error('config.js does not export loadConfig');
  if (typeof resolveTrustedProxies !== 'function') throw new Error('trusted-proxies.js does not export resolveTrustedProxies');
} catch (err) {
  process.stderr.write(`cannot load the dashboard's trusted-proxy check from ${dist}: ${err && err.message ? err.message : err}\n`);
  process.exit(3);
}

// A path under a character device never exists, so the file layer is empty and
// the value is parsed by config.ts's own split and trim.
let cfg;
try {
  cfg = loadConfig('/dev/null/luqen-no-config.json');
} catch (err) {
  process.stderr.write(`cannot load the dashboard's trusted-proxy check from ${dist}: loadConfig failed: ${err && err.message ? err.message : err}\n`);
  process.exit(3);
}

let resolved;
try {
  resolved = resolveTrustedProxies(cfg.trustedProxies);
} catch (err) {
  process.stderr.write(`${err && err.message ? err.message : err}\n`);
  process.exit(2);
}

const joined = resolved === false ? 'none' : resolved.join(',');
// The answer is framed, so anything else on stdout (a stray console.log at
// import time, before or after) makes trusted_proxies_check fail closed instead
// of passing as the value.
if (mode === 'canonical') {
  process.stdout.write('<<TP:' + (cfg.trustedProxies === undefined ? 'unset' : joined) + ':TP>>');
} else if (mode === 'effective') {
  process.stdout.write('<<TP:' + joined + ':TP>>');
} else {
  process.stderr.write(`unknown mode ${mode}\n`);
  process.exit(3);
}
JS

# The characters a canonical list can hold: digits, letters (hex digits, the
# named ranges, IPv6 zone ids), . : / % , and - (an IPv6 zone id such as
# fe80::1%br-lan; MEASURED accepted by the dashboard). Spelled out rather than as
# ranges, so no locale can widen it.
TP_CANONICAL_CHARS='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.:/%,-'

# trusted_proxies_charset_ok <value> [extra-chars] -- 0 when every character of
# value is in TP_CANONICAL_CHARS (plus extra-chars). The gate in front of every
# sink: the unit and .install-state (which install.command sources as shell
# code and copies into an XML plist) take only the canonical set; the Docker
# .env also takes the space the operator typed. It does not rely on node's
# address parser to keep shell or XML metacharacters out.
trusted_proxies_charset_ok() {
  local allowed="${TP_CANONICAL_CHARS}${2:-}"
  case "$1" in
    *[!"${allowed}"]*) return 1 ;;
  esac
  return 0
}

# trusted_proxies_check <dist-dir> <canonical|effective> <value>
# Runs node in a subshell that drops every exported DASHBOARD_* name first, so
# no other dashboard setting can reach loadConfig, then hands the value over in
# the one environment variable. Returns node's exit status. On success it prints
# the answer only if node's whole stdout was one framed answer (<<TP:...:TP>>);
# anything else on stdout fails closed with status 3.
trusted_proxies_check() {
  local dist="$1" mode="$2" value="$3" framed="" rc=0
  framed="$(
    local _name
    while IFS= read -r _name; do
      unset "${_name}"
    done < <(compgen -e | grep '^DASHBOARD_' || true)
    export DASHBOARD_TRUSTED_PROXIES="${value}"
    exec node --input-type=module -e "${TRUSTED_PROXIES_CHECK_JS}" "${dist}" "${mode}"
  )" || rc=$?
  [ "${rc}" -eq 0 ] || return "${rc}"
  case "${framed}" in
    '<<TP:'*':TP>>') framed="${framed#<<TP:}"; framed="${framed%:TP>>}" ;;
    *) printf 'the dashboard check wrote something other than its framed answer to stdout\n' >&2; return 3 ;;
  esac
  case "${framed}" in
    *'<<TP:'*|*':TP>>'*) printf 'the dashboard check wrote more than one answer to stdout\n' >&2; return 3 ;;
  esac
  printf '%s' "${framed}"
}

# trusted_proxies_evaluate -- the one place that runs the dashboard's check on
# DASHBOARD_TRUSTED_PROXIES and derives the value to write. validate_trusted_proxies
# (the install) and check_trusted_proxies_only (--check-trusted-proxies) both call
# it, so the two cannot disagree about what would be written.
# Sets: TP_RC   0 checked, 2 refused, 3 or other = could not run the check
#       TP_ERR  the check's stderr (the dashboard's message when TP_RC is 2)
#       TP_BLANK  "true" when a non-empty value was blank after the dashboard's trim
#       TRUSTED_PROXIES_WRITE  the canonical value to write, empty = write nothing
trusted_proxies_evaluate() {
  TRUSTED_PROXIES_WRITE=""
  TP_RC=0
  TP_ERR=""
  TP_BLANK="false"
  [ -n "${DASHBOARD_TRUSTED_PROXIES}" ] || return 0

  local dist="${INSTALL_DIR}/packages/dashboard/dist"
  local out="" errfile
  errfile="$(mktemp)"
  out="$(trusted_proxies_check "${dist}" canonical "${DASHBOARD_TRUSTED_PROXIES}" 2>"${errfile}")" && TP_RC=0 || TP_RC=$?
  TP_ERR="$(cat "${errfile}")"
  rm -f "${errfile}"
  [ "${TP_RC}" -eq 0 ] || return 0

  if [ "${out}" = "unset" ]; then
    TP_BLANK="true"
  elif ! trusted_proxies_charset_ok "${out}"; then
    # WR-07: never write a value outside the canonical character set, whatever
    # the dashboard's code returned. Fails closed as "could not run the check".
    TP_RC=3
    TP_ERR="internal: the dashboard's canonical list holds a character outside [0-9A-Za-z.:/%,-]; nothing written"
  else
    TRUSTED_PROXIES_WRITE="${out}"
  fi
  return 0
}

# validate_trusted_proxies -- checks the operator's list with the built
# dashboard's own code. Runs after install_and_build (the dist exists only then)
# and before generate_secrets, so a refusal leaves no secret, configuration
# file or service unit behind. Sets TRUSTED_PROXIES_WRITE to the canonical value
# to write, or leaves it empty (write nothing). Fails closed: it never
# re-prompts, loops or falls back to writing the value.
validate_trusted_proxies() {
  if [ -z "${DASHBOARD_TRUSTED_PROXIES}" ]; then
    TRUSTED_PROXIES_WRITE=""
    info "Trusted proxies: none given, nothing written; the dashboard's default applies"
    return 0
  fi

  trusted_proxies_evaluate
  if [ "${TP_RC}" -eq 2 ]; then
    error "The dashboard refuses this trusted-proxy list:"
    error "${TP_ERR}"
    error "Nothing has been written yet (no secrets, configuration or service units). Correct --trusted-proxies or DASHBOARD_TRUSTED_PROXIES and run the installer again."
    exit 1
  fi
  if [ "${TP_RC}" -ne 0 ]; then
    error "Could not run the dashboard's trusted-proxy check in ${INSTALL_DIR}/packages/dashboard/dist: ${TP_ERR}"
    error "The install stops rather than write a list nothing has checked."
    exit 1
  fi
  if [ "${TP_BLANK}" = "true" ]; then
    warn "The trusted-proxy value was blank; nothing is written and the dashboard's default applies"
    return 0
  fi
  success "Trusted proxies accepted by the dashboard's rules: ${TRUSTED_PROXIES_WRITE}"
}

# The Environment= line for the dashboard unit, or nothing. systemd treats % as a
# specifier and DROPS the whole assignment when it meets an unknown one (measured:
# "Failed to resolve specifiers ... Invalid slot"), so every % is doubled.
# trusted_proxies_written_value undoes it.
dashboard_trusted_proxies_unit_line() {
  if [ -n "${TRUSTED_PROXIES_WRITE}" ]; then
    if ! trusted_proxies_charset_ok "${TRUSTED_PROXIES_WRITE}"; then
      printf 'internal: the trusted-proxy value holds a character outside [0-9A-Za-z.:/%%,-]; no unit line written\n' >&2
      return 1
    fi
    printf 'Environment=DASHBOARD_TRUSTED_PROXIES=%s\n' "${TRUSTED_PROXIES_WRITE//%/%%}"
  fi
}

# trusted_proxies_written_value <systemd|state|dotenv> <file> -- prints the value
# the dashboard will receive from a written file, or nothing when the line is
# absent. The last matching line wins, as it does in systemd.
trusted_proxies_written_value() {
  local kind="$1" file="$2" line=""
  case "${kind}" in
    systemd)
      line="$(grep '^Environment=DASHBOARD_TRUSTED_PROXIES=' "${file}" 2>/dev/null | tail -n 1 || true)"
      line="${line#Environment=DASHBOARD_TRUSTED_PROXIES=}"
      line="${line//%%/%}"   # undo dashboard_trusted_proxies_unit_line's doubling
      ;;
    state|dotenv)
      line="$(grep '^DASHBOARD_TRUSTED_PROXIES=' "${file}" 2>/dev/null | tail -n 1 || true)"
      line="${line#DASHBOARD_TRUSTED_PROXIES=}"
      ;;
    *)
      return 2
      ;;
  esac
  printf '%s' "${line}"
}

# trusted_proxies_readback <kind> <file> -- the list the dashboard will actually
# use for what is written in the file, resolved by the dashboard's own code.
trusted_proxies_readback() {
  local kind="$1" file="$2" value
  value="$(trusted_proxies_written_value "${kind}" "${file}")"
  trusted_proxies_check "${INSTALL_DIR}/packages/dashboard/dist" effective "${value}"
}

# trusted_proxies_summary_value <note> -- the pre-install summary value: the list
# with how it will be checked, or "dashboard default" when none was given.
trusted_proxies_summary_value() {
  if [ -n "${DASHBOARD_TRUSTED_PROXIES}" ]; then
    printf '%s (%s)' "${DASHBOARD_TRUSTED_PROXIES}" "$1"
  else
    printf 'dashboard default'
  fi
}

# A unit line that assigns DASHBOARD_TRUSTED_PROXIES (alone or among several
# assignments on one Environment= line), and an environment-file line that does.
TP_UNIT_ASSIGN_RE='^[[:space:]]*Environment=(.*[[:space:]"'"'"'])?DASHBOARD_TRUSTED_PROXIES='
TP_ENVFILE_ASSIGN_RE='^[[:space:]]*(export[[:space:]]+)?DASHBOARD_TRUSTED_PROXIES='

# trusted_proxies_overrides <unit-file|""> <config-file> -- one line per place
# that can override what the installer wrote, by path and key name only (never
# a value): a drop-in in <unit-file>.d that assigns DASHBOARD_TRUSTED_PROXIES
# (systemd applies drop-ins after the unit), an EnvironmentFile= named by the
# unit or a drop-in that sets it (systemd lets those override every
# Environment= line), and a trustedProxies key in the dashboard config file
# (the dashboard uses it whenever the variable is unset or blank). A file it
# cannot read is reported as unknown. Prints nothing when nothing can override.
trusted_proxies_overrides() {
  local unit="$1" config="$2" f envf n rc
  local -a unit_files=()
  if [ -n "${unit}" ]; then
    [ -r "${unit}" ] && unit_files+=("${unit}")
    for f in "${unit}.d"/*.conf; do
      [ -e "${f}" ] || continue
      if [ ! -r "${f}" ]; then
        printf 'drop-in %s cannot be read, so whether it sets DASHBOARD_TRUSTED_PROXIES is unknown\n' "${f}"
        continue
      fi
      unit_files+=("${f}")
      n="$(grep -cE -- "${TP_UNIT_ASSIGN_RE}" "${f}" || true)"
      if [ "${n:-0}" -gt 0 ]; then
        printf 'drop-in %s sets DASHBOARD_TRUSTED_PROXIES; it overrides %s\n' "${f}" "${unit}"
      fi
    done
    for f in "${unit_files[@]+"${unit_files[@]}"}"; do
      while IFS= read -r envf; do
        envf="${envf%"${envf##*[![:space:]]}"}"
        envf="${envf#-}"
        [ -n "${envf}" ] || continue
        if [ ! -r "${envf}" ]; then
          printf 'EnvironmentFile %s (named in %s) cannot be read here, so whether it sets DASHBOARD_TRUSTED_PROXIES is unknown\n' "${envf}" "${f}"
          continue
        fi
        n="$(grep -cE -- "${TP_ENVFILE_ASSIGN_RE}" "${envf}" || true)"
        if [ "${n:-0}" -gt 0 ]; then
          printf 'EnvironmentFile %s (named in %s) sets DASHBOARD_TRUSTED_PROXIES; it overrides every Environment= line\n' "${envf}" "${f}"
        fi
      done < <(sed -nE 's/^[[:space:]]*EnvironmentFile=[[:space:]]*//p' "${f}")
    done
  fi
  if [ -n "${config}" ] && [ -e "${config}" ]; then
    rc=0
    node -e '
      let c;
      try { c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); } catch { process.exit(2); }
      process.exit(c !== null && typeof c === "object" && Object.prototype.hasOwnProperty.call(c, "trustedProxies") ? 0 : 1);
    ' "${config}" 2>/dev/null || rc=$?
    case "${rc}" in
      0) printf '%s sets the trustedProxies key; the dashboard uses it whenever DASHBOARD_TRUSTED_PROXIES is unset or blank\n' "${config}" ;;
      1) ;;
      *) printf '%s could not be read as JSON, so whether it sets the trustedProxies key is unknown\n' "${config}" ;;
    esac
  fi
  return 0
}

# print_trusted_proxies_readback <kind> <file> -- closing-summary line. Reads the
# FILE the installer wrote (never the in-memory value) and resolves it with the
# dashboard's own code: it reports what THAT FILE sets. A drop-in, an
# EnvironmentFile or the config file's trustedProxies key can override it;
# trusted_proxies_overrides names each one, and a warning follows the line.
print_trusted_proxies_readback() {
  local kind="$1" file="$2" written effective="" rc=0
  if [ ! -r "${file}" ]; then
    warn "Trusted proxies: could not read back ${file} (file not readable)"
    return 0
  fi
  written="$(trusted_proxies_written_value "${kind}" "${file}")"
  effective="$(trusted_proxies_readback "${kind}" "${file}" 2>&1)" && rc=0 || rc=$?
  if [ "${rc}" -ne 0 ]; then
    warn "Trusted proxies: could not read back ${file} through the dashboard's check: ${effective}"
    return 0
  fi
  if [ -n "${written}" ]; then
    printf "  Trusted proxies (read back from %s): %s (set by this install)\n" "${file}" "${effective}"
  else
    printf "  Trusted proxies (read back from %s): %s (dashboard default, nothing written)\n" "${file}" "${effective}"
  fi
  local unit="" line
  [ "${kind}" = "systemd" ] && unit="${file}"
  while IFS= read -r line; do
    [ -n "${line}" ] && warn "Trusted proxies: the line above may not be what the dashboard uses: ${line}"
  done < <(trusted_proxies_overrides "${unit}" "${CONFIG_FILE:-${INSTALL_DIR}/dashboard.config.json}")
  return 0
}

# print_docker_trusted_proxies_result -- the Docker closing line. A Docker
# install has no host-side dashboard build, so this does NOT run the check: it
# reports what was written to .env, which the dashboard container checks when it
# starts (docker-compose.yml passes it to the dashboard service only).
print_docker_trusted_proxies_result() {
  local written
  written="$(trusted_proxies_written_value dotenv "${INSTALL_DIR}/.env")"
  if [ -n "${written}" ]; then
    printf "  Trusted proxies: %s (written to .env; the dashboard container started with it)\n" "${written}"
  else
    printf "  Trusted proxies: nothing written; the dashboard default applies\n"
  fi
}

# check_trusted_proxies_only -- the --check-trusted-proxies mode. Checks the
# list against the dashboard built in --install-dir and prints what an install
# would write. Installs nothing and runs no installer step. Exit 0 accepted or
# blank, 2 refused (the dashboard's message on stderr), 3 the check cannot run.
check_trusted_proxies_only() {
  local dist="${INSTALL_DIR}/packages/dashboard/dist"
  local effective="" rc=0

  trusted_proxies_evaluate
  if [ "${TP_RC}" -eq 2 ]; then
    printf '%s\n' "${TP_ERR}" >&2
    exit 2
  fi
  if [ "${TP_RC}" -ne 0 ]; then
    printf '%s\n' "${TP_ERR}" >&2
    exit 3
  fi

  effective="$(trusted_proxies_check "${dist}" effective "${TRUSTED_PROXIES_WRITE}")" && rc=0 || rc=$?
  if [ "${rc}" -ne 0 ]; then
    printf 'cannot read the effective list from %s\n' "${dist}" >&2
    exit 3
  fi
  if [ -z "${TRUSTED_PROXIES_WRITE}" ]; then
    printf 'blank: nothing would be written\n'
  else
    printf 'accepted: %s\n' "${TRUSTED_PROXIES_WRITE}"
    printf 'systemd line: %s\n' "$(dashboard_trusted_proxies_unit_line)"
  fi
  printf 'effective: %s\n' "${effective}"
  exit 0
}

# ──────────────────────────────────────────────
# Interactive prompt helpers
# ──────────────────────────────────────────────
# ask <prompt> <default> <var> / ask_secret <prompt> <var> -- the answer is
# stored in <var> as plain text with printf -v. No eval: a $, a backtick, a
# quote or a backslash in an answer (a password, a URL) is kept as typed and
# never run (IN-07).
ask() {
  local prompt="$1" default="$2" var="$3" input=""
  printf "  %s%s%s %s[%s]%s: " "${BOLD}" "${prompt}" "${RESET}" "${DIM}" "${default}" "${RESET}" >/dev/tty
  read -r input </dev/tty
  printf -v "${var}" '%s' "${input:-${default}}"
}

ask_secret() {
  local prompt="$1" var="$2" input=""
  printf "  %s%s%s: " "${BOLD}" "${prompt}" "${RESET}" >/dev/tty
  read -rs input </dev/tty
  printf "\n" >/dev/tty
  printf -v "${var}" '%s' "${input}"
}

ask_yn() {
  local prompt="$1" default="$2"
  local yn_hint="[Y/n]"
  [ "${default}" = "n" ] && yn_hint="[y/N]"
  printf "  %s%s%s %s%s%s: " "${BOLD}" "${prompt}" "${RESET}" "${DIM}" "${yn_hint}" "${RESET}" >/dev/tty
  read -r input </dev/tty
  input="${input:-${default}}"
  case "${input}" in
    [yY]*) return 0 ;;
    *)     return 1 ;;
  esac
}

ask_choice() {
  local prompt="$1"; shift
  local options=("$@")
  printf "\n  %s%s%s\n" "${BOLD}" "${prompt}" "${RESET}" >/dev/tty
  local i=1
  for opt in "${options[@]}"; do
    printf "    %s%d)%s %s\n" "${CYAN}" "${i}" "${RESET}" "${opt}" >/dev/tty
    i=$(( i + 1 ))
  done
  printf "\n    %sChoice [1]%s: " "${BOLD}" "${RESET}" >/dev/tty
  read -r choice </dev/tty
  echo "${choice:-1}"
}

# ask_trusted_proxies <bare-metal|docker> -- the wizard prompt for the
# dashboard's trusted-proxy list. NOT built on `ask`: the answer is read with
# `read -r` into a local and stored as plain text. An empty answer keeps the
# value already given by flag or environment. The argument says when the list is
# checked: on bare metal by validate_trusted_proxies after the checkout and
# build, on Docker by the dashboard container when it starts.
ask_trusted_proxies() {
  local timing="${1:-bare-metal}"
  local shown="${DASHBOARD_TRUSTED_PROXIES:-dashboard default}" answer=""
  printf "\n  %sTrusted proxies%s (reverse proxy / load balancer)\n" "${BOLD}" "${RESET}" >/dev/tty
  printf "  Set this when the dashboard sits behind a reverse proxy, load balancer or CDN\n" >/dev/tty
  printf "  whose address is not loopback, link-local or unique-local. A list REPLACES the\n" >/dev/tty
  printf "  default, so add loopback (and linklocal, uniquelocal) when a local proxy also\n" >/dev/tty
  printf "  sits in front. Examples: 192.0.2.10, 198.51.100.0/24, loopback. Leave it empty to\n" >/dev/tty
  printf "  keep the dashboard's default.\n" >/dev/tty
  if [ "${timing}" = "docker" ]; then
    printf "  The installer does not check the list: the dashboard container checks it when it\n" >/dev/tty
    printf "  starts, after .env is written, and a refused list keeps the dashboard down.\n" >/dev/tty
  else
    printf "  The dashboard's own rules check the list after the checkout and build, and a\n" >/dev/tty
    printf "  refused list stops the install before any secret, configuration file or\n" >/dev/tty
    printf "  service unit is written.\n" >/dev/tty
  fi
  printf "  %sTrusted proxies%s %s[%s]%s: " "${BOLD}" "${RESET}" "${DIM}" "${shown}" "${RESET}" >/dev/tty
  read -r answer </dev/tty || answer=""
  if [ -n "${answer}" ]; then
    DASHBOARD_TRUSTED_PROXIES="${answer}"
  fi
}

# ──────────────────────────────────────────────
# INTERACTIVE WIZARD (Phase 42 — 4-profile model)
# ──────────────────────────────────────────────
run_wizard() {
  printf "\n"
  printf "  %s+======================================+%s\n" "${BOLD}${CYAN}" "${RESET}"
  printf "  %s|     Luqen -- Installation Wizard     |%s\n" "${BOLD}${CYAN}" "${RESET}"
  printf "  %s+======================================+%s\n" "${BOLD}${CYAN}" "${RESET}"
  printf "\n  Enterprise accessibility testing platform\n"

  # ── 1: Choose deployment profile ───────────
  header "1. Choose deployment profile"
  printf "  Pick the topology that matches your deployment:\n\n"

  local profile_choice
  profile_choice=$(ask_choice "Profile:" \
    "Scanner CLI (only @luqen/core, stdio MCP for VS Code/Claude Code)" \
    "API services (headless: any subset of compliance/branding/llm)" \
    "Self-hosted dashboard (default -- UI + chosen subset of services)" \
    "Docker Compose (full stack in containers)")

  case "${profile_choice}" in
    1)
      PROFILE="cli"
      DEPLOY_MODE="cli-only"
      success "Scanner CLI selected (@luqen/core + stdio MCP entry point at packages/core/dist/mcp.js)"
      ;;
    2)
      PROFILE="api"
      DEPLOY_MODE="bare-metal"
      success "API services selected (headless)"
      run_wizard_api_services
      ;;
    4)
      PROFILE="docker"
      DEPLOY_MODE="docker"
      success "Docker Compose deployment selected"
      ;;
    *)
      PROFILE="dashboard"
      DEPLOY_MODE="bare-metal"
      success "Self-hosted dashboard selected (default)"
      # Per-component opt-out prompts (--without-X equivalents)
      if ! ask_yn "Include compliance service?" "y"; then
        WITHOUT_COMPLIANCE="true"
      fi
      if ! ask_yn "Include branding service?" "y"; then
        WITHOUT_BRANDING="true"
      fi
      if ! ask_yn "Include llm service?" "y"; then
        WITHOUT_LLM="true"
      fi
      ;;
  esac

  # ── Monitor agent opt-in (only meaningful when compliance is selected) ──
  local _monitor_eligible=0
  case "${PROFILE}" in
    dashboard)
      [ "${WITHOUT_COMPLIANCE}" = "false" ] && _monitor_eligible=1
      ;;
    api)
      [[ ",${API_SERVICES}," == *",compliance,"* ]] && _monitor_eligible=1
      ;;
  esac
  if [ "${_monitor_eligible}" = "1" ]; then
    printf "\n"
    if ask_yn "Install monitor agent (auto-tracks regulation changes -- opt-in only, port ${MONITOR_PORT})?" "n"; then
      WITH_MONITOR="true"
      success "Monitor agent will be registered as luqen-monitor.service"
    fi
  fi
  unset _monitor_eligible

  case "${DEPLOY_MODE}" in
    cli-only)  run_wizard_cli_only ;;
    docker)    run_wizard_docker ;;
    *)         run_wizard_bare_metal ;;
  esac
}

# ──────────────────────────────────────────────
# API services wizard — pick subset of compliance/branding/llm
# ──────────────────────────────────────────────
run_wizard_api_services() {
  header "API services subset"
  printf "  Pick which services to install (each gets its own systemd unit).\n\n"

  local _svcs=()
  if ask_yn "Install compliance service (port ${COMPLIANCE_PORT})?" "y"; then
    _svcs+=("compliance")
  fi
  if ask_yn "Install branding service (port ${BRANDING_PORT})?" "y"; then
    _svcs+=("branding")
  fi
  if ask_yn "Install llm service (port ${LLM_PORT})?" "y"; then
    _svcs+=("llm")
  fi

  if [ "${#_svcs[@]}" -eq 0 ]; then
    error "API profile requires at least one of compliance/branding/llm."
    exit 1
  fi
  API_SERVICES="$(IFS=,; echo "${_svcs[*]}")"
  success "API services: ${API_SERVICES}"
}

# ──────────────────────────────────────────────
# derive_install_components -- maps PROFILE + flags → INSTALL_COMPONENTS array
# Called after wizard / argument parsing completes (Phase 42 dispatch entry point).
# ──────────────────────────────────────────────
derive_install_components() {
  PROFILE="${PROFILE:-dashboard}"

  # Phase 96 / OPS-01 sink safety. A line break would start a new line in every
  # file the list is written to, so it is refused in every mode, before any step.
  case "${DASHBOARD_TRUSTED_PROXIES}" in
    *$'\n'*|*$'\r'*)
      error "--trusted-proxies (or DASHBOARD_TRUSTED_PROXIES) must not contain a line break."
      exit 1
      ;;
  esac

  case "${PROFILE}" in
    cli)
      INSTALL_COMPONENTS=(core)
      DEPLOY_MODE="cli-only"
      ;;
    api)
      IFS=',' read -ra INSTALL_COMPONENTS <<< "${API_SERVICES:-compliance,branding,llm}"
      DEPLOY_MODE="bare-metal"
      ;;
    dashboard)
      INSTALL_COMPONENTS=(core dashboard)
      [ "${WITHOUT_COMPLIANCE}" = "false" ] && INSTALL_COMPONENTS+=(compliance)
      [ "${WITHOUT_BRANDING}"   = "false" ] && INSTALL_COMPONENTS+=(branding)
      [ "${WITHOUT_LLM}"        = "false" ] && INSTALL_COMPONENTS+=(llm)
      DEPLOY_MODE="bare-metal"
      ;;
    docker)
      INSTALL_COMPONENTS=(docker)
      DEPLOY_MODE="docker"
      ;;
    *)
      error "Unknown profile: ${PROFILE}"
      exit 1
      ;;
  esac

  [ "${WITH_MONITOR}" = "true" ] && INSTALL_COMPONENTS+=(monitor)

  # Phase 96 / OPS-01: the trusted-proxy list is a dashboard setting. A profile
  # that installs no dashboard cannot honour it, so say so rather than drop it
  # silently (same precedent as --with-monitor below).
  if [ -n "${DASHBOARD_TRUSTED_PROXIES}" ] && \
     [[ " ${INSTALL_COMPONENTS[*]} " != *" dashboard "* ]] && \
     [[ " ${INSTALL_COMPONENTS[*]} " != *" docker "* ]]; then
    error "--trusted-proxies (or DASHBOARD_TRUSTED_PROXIES in the installer's environment) is a dashboard setting, and profile ${PROFILE} installs no dashboard. Remove it, or choose --profile dashboard or docker."
    exit 1
  fi

  # Docker writes the list to .env unchecked (no host-side dist exists, so the
  # dashboard checks it when the container starts). compose rewrites # $ quotes
  # backticks and backslashes in .env, and the dashboard can never accept any of
  # them, so refusing them here is sink safety, NOT a second validator: it
  # refuses only what the dashboard also refuses.
  if [[ " ${INSTALL_COMPONENTS[*]} " == *" docker "* ]] && [ -n "${DASHBOARD_TRUSTED_PROXIES}" ]; then
    local _bad
    for _bad in '#' '$' "'" '"' '`' '\'; do
      case "${DASHBOARD_TRUSTED_PROXIES}" in
        *"${_bad}"*)
          error "The trusted-proxy list contains ${_bad}: the dashboard would refuse it and compose would rewrite it in .env. Remove it and run the installer again."
          exit 1
          ;;
      esac
    done
    # WR-07: then an allow-list, the canonical set plus the space an operator
    # types after a comma. Every other character is one the dashboard refuses.
    if ! trusted_proxies_charset_ok "${DASHBOARD_TRUSTED_PROXIES}" ' '; then
      error "The trusted-proxy list contains a character other than letters, digits, spaces and . : / % , -: the dashboard would refuse it, so it is not written to .env. Correct it and run the installer again."
      exit 1
    fi
  fi

  # T-42-06: --with-monitor requires compliance
  if [[ " ${INSTALL_COMPONENTS[*]} " == *" monitor "* ]] && \
     [[ " ${INSTALL_COMPONENTS[*]} " != *" compliance "* ]]; then
    error "--with-monitor requires compliance (selected profile does not include it)"
    exit 1
  fi

  # Graceful-degradation banners (dashboard profile only)
  if [ "${PROFILE}" = "dashboard" ]; then
    if [[ " ${INSTALL_COMPONENTS[*]} " != *" compliance "* ]]; then
      warn "Compliance service was not selected. The dashboard will run, but"
      warn "'Run scan' will fall back to local-only mode and the regulation matrix"
      warn "will not be auto-updated. Re-run with --profile dashboard (default) to install."
    fi
    if [[ " ${INSTALL_COMPONENTS[*]} " != *" branding "* ]]; then
      warn "Branding service not selected -- brand-related classification will fall back to 'unknown'."
    fi
    if [[ " ${INSTALL_COMPONENTS[*]} " != *" llm "* ]]; then
      warn "LLM service not selected -- the Agent companion panel will be hidden behind a feature flag."
    fi
  fi
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
  BRANDING_PORT=$(( COMPLIANCE_PORT + 100 ))
  ask "Branding port" "${BRANDING_PORT}" BRANDING_PORT
  DASHBOARD_PORT=$(( COMPLIANCE_PORT + 1000 ))
  ask "Dashboard port" "${DASHBOARD_PORT}" DASHBOARD_PORT
  ask_trusted_proxies docker

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

  # ── 5: Plugins ─────────────────────────────
  header "5. Plugins"
  printf "  Plugins extend Luqen with notifications, cloud storage, and more.\n"
  printf "  You can also install plugins later from the dashboard.\n\n"

  # ── Notification plugins ──────────────────
  if ask_yn "Install notification plugins?" "n"; then
    printf "\n"
    local notify_choice
    notify_choice=$(ask_choice "Which notification plugin?" \
      "Slack (webhook alerts)" \
      "Microsoft Teams (webhook alerts)" \
      "Email Reports (SMTP delivery)" \
      "All notification plugins")

    case "${notify_choice}" in
      1) NOTIFY_SLACK=true; ask "Slack webhook URL" "" SLACK_WEBHOOK_URL ;;
      2) NOTIFY_TEAMS=true; ask "Teams webhook URL" "" TEAMS_WEBHOOK_URL ;;
      3)
        NOTIFY_EMAIL=true
        ask "SMTP host" "" SMTP_HOST
        ask "SMTP port" "587" SMTP_PORT
        ask "SMTP username" "" SMTP_USER
        ask_secret "SMTP password" SMTP_PASS
        ask "From address" "" SMTP_FROM
        printf "  %sValidating SMTP...%s " "${DIM}" "${RESET}" >/dev/tty
        if validate_smtp "${SMTP_HOST}" "${SMTP_PORT}"; then
          success "SMTP reachable"
        else
          warn "Could not reach SMTP -- configure later in plugin settings"
        fi
        ;;
      4)
        NOTIFY_SLACK=true; NOTIFY_TEAMS=true; NOTIFY_EMAIL=true
        ask "Slack webhook URL (or leave empty)" "" SLACK_WEBHOOK_URL
        ask "Teams webhook URL (or leave empty)" "" TEAMS_WEBHOOK_URL
        ask "SMTP host (or leave empty)" "" SMTP_HOST
        if [ -n "${SMTP_HOST}" ]; then
          ask "SMTP port" "587" SMTP_PORT
          ask "SMTP username" "" SMTP_USER
          ask_secret "SMTP password" SMTP_PASS
          ask "From address" "" SMTP_FROM
        fi
        success "Notification plugins selected"
        ;;
    esac
  fi

  # ── Storage plugins ──────────────────────
  printf "\n"
  if ask_yn "Install cloud storage plugins?" "n"; then
    printf "\n"
    local storage_choice
    storage_choice=$(ask_choice "Which storage plugin?" \
      "AWS S3" \
      "Azure Blob Storage" \
      "Both")

    case "${storage_choice}" in
      1)
        STORAGE_S3=true
        ask "S3 bucket name" "" S3_BUCKET
        ask "AWS region" "us-east-1" S3_REGION
        ask_secret "AWS access key ID" S3_ACCESS_KEY
        ask_secret "AWS secret access key" S3_SECRET_KEY
        ;;
      2)
        STORAGE_AZURE=true
        ask "Azure container name" "" AZURE_CONTAINER
        ask_secret "Azure connection string" AZURE_CONNECTION_STRING
        ;;
      3)
        STORAGE_S3=true; STORAGE_AZURE=true
        ask "S3 bucket name (or leave empty)" "" S3_BUCKET
        if [ -n "${S3_BUCKET}" ]; then
          ask "AWS region" "us-east-1" S3_REGION
          ask_secret "AWS access key ID" S3_ACCESS_KEY
          ask_secret "AWS secret access key" S3_SECRET_KEY
        fi
        ask "Azure container name (or leave empty)" "" AZURE_CONTAINER
        if [ -n "${AZURE_CONTAINER}" ]; then
          ask_secret "Azure connection string" AZURE_CONNECTION_STRING
        fi
        success "Storage plugins selected"
        ;;
    esac
  fi

  # ── 6: Ports ─────────────────────────────────
  header "6. Ports"
  ask "Compliance port" "${COMPLIANCE_PORT}" COMPLIANCE_PORT
  BRANDING_PORT=$(( COMPLIANCE_PORT + 100 ))
  ask "Branding port" "${BRANDING_PORT}" BRANDING_PORT
  DASHBOARD_PORT=$(( COMPLIANCE_PORT + 1000 ))
  ask "Dashboard port" "${DASHBOARD_PORT}" DASHBOARD_PORT
  if [ "${PROFILE}" = "dashboard" ]; then
    ask_trusted_proxies bare-metal
  fi

  # ── Install dir ──────────────────────────────
  ask "Installation directory" "${INSTALL_DIR}" INSTALL_DIR

  # ── 7: Admin user ────────────────────────────
  header "7. Admin Account"
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
  printf "  %-22s %s\n" "Branding port:" "${BRANDING_PORT}"
  printf "  %-22s %s\n" "Dashboard port:" "${DASHBOARD_PORT}"
  if [ "${PROFILE}" = "dashboard" ]; then
    printf "  %-22s %s\n" "Trusted proxies:" "$(trusted_proxies_summary_value "checked by the dashboard's rules after the build")"
  fi
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
  printf "  %-22s %s\n" "Branding port:" "${BRANDING_PORT}"
  printf "  %-22s %s\n" "Dashboard port:" "${DASHBOARD_PORT}"
  printf "  %-22s %s\n" "Trusted proxies:" "$(trusted_proxies_summary_value "checked when the dashboard container starts")"
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

  # Phase 42: monitor agent declares engines.node >=22 but works on Node 20.4+
  # (top-level await + fetch). Hard-gate to Node 20 floor so install fails loudly
  # if someone has an even older Node and selected --with-monitor.
  if [[ " ${INSTALL_COMPONENTS[*]} " == *" monitor "* ]]; then
    if [ "${NODE_MAJOR}" -lt 20 ]; then
      error "Monitor agent requires Node.js >= 20 (found Node ${NODE_MAJOR})"
      exit 1
    fi
    info "Monitor agent will run on Node ${NODE_MAJOR} (engines field >=22 is advisory)"
  fi

  success "Node.js $(node --version), npm $(npm --version), git $(git --version | awk '{print $3}')"

  # Install Chromium for pa11y scanner (pa11y uses headless Chromium for page rendering)
  # Note: PDF generation uses PDFKit (no browser needed), but pa11y still requires Chromium
  if ! command -v chromium &>/dev/null && ! command -v chromium-browser &>/dev/null && ! command -v google-chrome &>/dev/null; then
    info "Installing Chromium (required by pa11y for accessibility scanning)..."
    if command -v apt-get &>/dev/null; then
      apt-get install -y -qq chromium fonts-liberation libnss3 libatk1.0-0 \
        libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
        libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 libasound2 libgbm1 \
        >/dev/null 2>&1 && success "Chromium installed" || warn "Could not install Chromium -- scanning may not work"
    elif command -v yum &>/dev/null; then
      yum install -y chromium >/dev/null 2>&1 && success "Chromium installed" || warn "Could not install Chromium"
    elif command -v brew &>/dev/null; then
      brew install --cask chromium >/dev/null 2>&1 && success "Chromium installed" || warn "Could not install Chromium"
    else
      warn "Please install Chromium manually for accessibility scanning"
    fi
  else
    success "Chromium found"
  fi
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
  # Build order matters: core → compliance → branding → llm → dashboard → monitor
  # Phase 42 (Plan 42-01 Task 1 step 11): per-component dispatch — only build packages
  # that are part of the selected profile. core is always built (it's the lib base).
  run_quiet "Building @luqen/core" npm run build -w packages/core
  if [[ " ${INSTALL_COMPONENTS[*]} " == *" compliance "* ]]; then
    run_quiet "Building @luqen/compliance" npm run build -w packages/compliance
  fi
  if [[ " ${INSTALL_COMPONENTS[*]} " == *" branding "* ]]; then
    run_quiet "Building @luqen/branding" npm run build -w packages/branding
  fi
  if [[ " ${INSTALL_COMPONENTS[*]} " == *" llm "* ]]; then
    run_quiet "Building @luqen/llm" npm run build -w packages/llm
  fi
  if [[ " ${INSTALL_COMPONENTS[*]} " == *" dashboard "* ]]; then
    run_quiet "Building @luqen/dashboard" npm run build -w packages/dashboard
  fi
  if [[ " ${INSTALL_COMPONENTS[*]} " == *" monitor "* ]]; then
    run_quiet "Building @luqen/monitor" npm run build -w packages/monitor
  fi
}

# ──────────────────────────────────────────────
# Step 4: Generate JWT keys + session secret
# ──────────────────────────────────────────────
generate_secrets() {
  step 4 $TOTAL_STEPS_BM "Generating secrets"

  if [[ " ${INSTALL_COMPONENTS[*]} " == *" compliance "* ]]; then
    KEYS_DIR="${INSTALL_DIR}/packages/compliance/keys"
    if [ -f "${KEYS_DIR}/private.pem" ]; then
      info "Compliance JWT keys already exist -- reusing"
    else
      mkdir -p "${KEYS_DIR}"
      (cd "${INSTALL_DIR}/packages/compliance" && node dist/cli.js keys generate) >/dev/null 2>&1
      success "Compliance JWT RS256 key pair generated"
    fi
  fi

  if [[ " ${INSTALL_COMPONENTS[*]} " == *" branding "* ]]; then
    BRANDING_KEYS_DIR="${INSTALL_DIR}/packages/branding/keys"
    if [ -f "${BRANDING_KEYS_DIR}/private.pem" ]; then
      info "Branding JWT keys already exist -- reusing"
    else
      mkdir -p "${BRANDING_KEYS_DIR}"
      (cd "${INSTALL_DIR}/packages/branding" && node dist/cli.js keys generate) >/dev/null 2>&1
      success "Branding JWT RS256 key pair generated"
    fi
  fi

  if [[ " ${INSTALL_COMPONENTS[*]} " == *" llm "* ]]; then
    LLM_KEYS_DIR="${INSTALL_DIR}/packages/llm/keys"
    if [ -f "${LLM_KEYS_DIR}/private.pem" ]; then
      info "LLM JWT keys already exist -- reusing"
    else
      mkdir -p "${LLM_KEYS_DIR}"
      (cd "${INSTALL_DIR}/packages/llm" && node dist/cli.js keys generate) >/dev/null 2>&1
      success "LLM JWT RS256 key pair generated"
    fi
  fi

  SESSION_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
  success "Session secret generated"
}

# ──────────────────────────────────────────────
# Step 5: Seed compliance data
# ──────────────────────────────────────────────
seed_data() {
  step 5 $TOTAL_STEPS_BM "Seeding compliance data"

  if [[ " ${INSTALL_COMPONENTS[*]} " != *" compliance "* ]]; then
    info "Compliance not selected -- skipping seed"
    return
  fi

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
mint_compliance_oauth_client() {
  CLIENT_CACHE="${INSTALL_DIR}/.install-client"
  if [ -f "${CLIENT_CACHE}" ]; then
    CLIENT_ID=$(grep "^client_id=" "${CLIENT_CACHE}" | cut -d= -f2-)
    CLIENT_SECRET=$(grep "^client_secret=" "${CLIENT_CACHE}" | cut -d= -f2-)
    info "Compliance OAuth client already exists -- reusing"
  else
    CLIENT_OUT=$(cd "${INSTALL_DIR}/packages/compliance" && node dist/cli.js clients create --name "luqen-dashboard" --scope "admin" --grant client_credentials 2>&1)
    CLIENT_ID=$(echo "${CLIENT_OUT}" | grep "client_id:" | awk '{print $2}')
    CLIENT_SECRET=$(echo "${CLIENT_OUT}" | grep "client_secret:" | awk '{print $2}')
    printf "client_id=%s\nclient_secret=%s\n" "${CLIENT_ID}" "${CLIENT_SECRET}" > "${CLIENT_CACHE}"
    chmod 600 "${CLIENT_CACHE}"
    success "Compliance OAuth client created"
  fi
}

mint_branding_oauth_client() {
  BRANDING_CLIENT_CACHE="${INSTALL_DIR}/.install-branding-client"
  if [ -f "${BRANDING_CLIENT_CACHE}" ]; then
    BRANDING_CLIENT_ID=$(grep "^client_id=" "${BRANDING_CLIENT_CACHE}" | cut -d= -f2-)
    BRANDING_CLIENT_SECRET=$(grep "^client_secret=" "${BRANDING_CLIENT_CACHE}" | cut -d= -f2-)
    info "Branding OAuth client already exists -- reusing"
  else
    CLIENT_OUT=$(cd "${INSTALL_DIR}/packages/branding" && node dist/cli.js clients create --name "luqen-dashboard" --scope "admin" --grant client_credentials 2>&1)
    BRANDING_CLIENT_ID=$(echo "${CLIENT_OUT}" | grep "client_id:" | awk '{print $2}')
    BRANDING_CLIENT_SECRET=$(echo "${CLIENT_OUT}" | grep "client_secret:" | awk '{print $2}')
    printf "client_id=%s\nclient_secret=%s\n" "${BRANDING_CLIENT_ID}" "${BRANDING_CLIENT_SECRET}" > "${BRANDING_CLIENT_CACHE}"
    chmod 600 "${BRANDING_CLIENT_CACHE}"
    success "Branding OAuth client created"
  fi
}

mint_llm_dashboard_oauth_client() {
  LLM_CLIENT_CACHE="${INSTALL_DIR}/.install-llm-client"
  if [ -f "${LLM_CLIENT_CACHE}" ]; then
    LLM_CLIENT_ID=$(grep "^client_id=" "${LLM_CLIENT_CACHE}" | cut -d= -f2-)
    LLM_CLIENT_SECRET=$(grep "^client_secret=" "${LLM_CLIENT_CACHE}" | cut -d= -f2-)
    info "LLM OAuth client already exists -- reusing"
  else
    CLIENT_OUT=$(cd "${INSTALL_DIR}/packages/llm" && node dist/cli.js clients create --name "dashboard" --scopes "read,write,admin" 2>&1)
    LLM_CLIENT_ID=$(echo "${CLIENT_OUT}" | grep "ID:" | awk '{print $NF}')
    LLM_CLIENT_SECRET=$(echo "${CLIENT_OUT}" | grep "Secret:" | awk '{print $NF}')
    if [ -n "${LLM_CLIENT_ID}" ] && [ -n "${LLM_CLIENT_SECRET}" ]; then
      printf "client_id=%s\nclient_secret=%s\n" "${LLM_CLIENT_ID}" "${LLM_CLIENT_SECRET}" > "${LLM_CLIENT_CACHE}"
      chmod 600 "${LLM_CLIENT_CACHE}"
      success "LLM OAuth client created (dashboard)"
    else
      warn "Could not parse LLM OAuth client output -- dashboard LLM integration will need manual config"
      LLM_CLIENT_ID=""
      LLM_CLIENT_SECRET=""
    fi
  fi
}

mint_llm_compliance_oauth_client() {
  COMPLIANCE_LLM_CLIENT_CACHE="${INSTALL_DIR}/.install-compliance-llm-client"
  if [ -f "${COMPLIANCE_LLM_CLIENT_CACHE}" ]; then
    COMPLIANCE_LLM_CLIENT_ID=$(grep "^client_id=" "${COMPLIANCE_LLM_CLIENT_CACHE}" | cut -d= -f2-)
    COMPLIANCE_LLM_CLIENT_SECRET=$(grep "^client_secret=" "${COMPLIANCE_LLM_CLIENT_CACHE}" | cut -d= -f2-)
    info "Compliance→LLM OAuth client already exists -- reusing"
  else
    CLIENT_OUT=$(cd "${INSTALL_DIR}/packages/llm" && node dist/cli.js clients create --name "compliance" --scopes "read,write,admin" 2>&1)
    COMPLIANCE_LLM_CLIENT_ID=$(echo "${CLIENT_OUT}" | grep "ID:" | awk '{print $NF}')
    COMPLIANCE_LLM_CLIENT_SECRET=$(echo "${CLIENT_OUT}" | grep "Secret:" | awk '{print $NF}')
    if [ -n "${COMPLIANCE_LLM_CLIENT_ID}" ] && [ -n "${COMPLIANCE_LLM_CLIENT_SECRET}" ]; then
      printf "client_id=%s\nclient_secret=%s\n" "${COMPLIANCE_LLM_CLIENT_ID}" "${COMPLIANCE_LLM_CLIENT_SECRET}" > "${COMPLIANCE_LLM_CLIENT_CACHE}"
      chmod 600 "${COMPLIANCE_LLM_CLIENT_CACHE}"
      success "LLM OAuth client created (compliance)"
    else
      warn "Could not parse Compliance→LLM OAuth client output -- compliance LLM integration will need manual config"
      COMPLIANCE_LLM_CLIENT_ID=""
      COMPLIANCE_LLM_CLIENT_SECRET=""
    fi
  fi
}

# Phase 42 / Plan 42-01 Task 2: monitor agent OAuth client (compliance scope).
# Caller is expected to gate on INSTALL_COMPONENTS membership. Mints a "luqen-monitor"
# client on the compliance service (admin scope). Cache file is chmod 600 (T-42-05).
mint_monitor_oauth_client() {
  MONITOR_CLIENT_CACHE="${INSTALL_DIR}/.install-monitor-client"
  if [ -f "${MONITOR_CLIENT_CACHE}" ]; then
    MONITOR_CLIENT_ID=$(grep "^client_id=" "${MONITOR_CLIENT_CACHE}" | cut -d= -f2-)
    MONITOR_CLIENT_SECRET=$(grep "^client_secret=" "${MONITOR_CLIENT_CACHE}" | cut -d= -f2-)
    info "Monitor OAuth client already exists -- reusing"
  else
    CLIENT_OUT=$(cd "${INSTALL_DIR}/packages/compliance" && node dist/cli.js clients create --name "luqen-monitor" --scope "admin" --grant client_credentials 2>&1)
    MONITOR_CLIENT_ID=$(echo "${CLIENT_OUT}" | grep "client_id:" | awk '{print $2}')
    MONITOR_CLIENT_SECRET=$(echo "${CLIENT_OUT}" | grep "client_secret:" | awk '{print $2}')
    if [ -n "${MONITOR_CLIENT_ID}" ] && [ -n "${MONITOR_CLIENT_SECRET}" ]; then
      printf "client_id=%s\nclient_secret=%s\n" "${MONITOR_CLIENT_ID}" "${MONITOR_CLIENT_SECRET}" \
        > "${MONITOR_CLIENT_CACHE}"
      chmod 600 "${MONITOR_CLIENT_CACHE}"
      success "Monitor OAuth client created (compliance scope)"
    else
      warn "Could not parse Monitor OAuth client output -- monitor agent will need manual config"
      MONITOR_CLIENT_ID=""
      MONITOR_CLIENT_SECRET=""
    fi
  fi
}

create_oauth_client() {
  step 6 $TOTAL_STEPS_BM "Creating OAuth clients"

  # Phase 42 / Plan 42-01 Task 1 step 12: gate each minting block by INSTALL_COMPONENTS.
  # Compliance + Branding + LLM-dashboard + LLM-compliance are linked to dashboard ↔ service
  # interconnects; only mint when both endpoints are present.
  local has_compliance=0 has_branding=0 has_llm=0 has_dashboard=0 has_monitor=0
  case " ${INSTALL_COMPONENTS[*]} " in *" compliance "*) has_compliance=1 ;; esac
  case " ${INSTALL_COMPONENTS[*]} " in *" branding "*)   has_branding=1 ;; esac
  case " ${INSTALL_COMPONENTS[*]} " in *" llm "*)        has_llm=1 ;; esac
  case " ${INSTALL_COMPONENTS[*]} " in *" dashboard "*)  has_dashboard=1 ;; esac
  case " ${INSTALL_COMPONENTS[*]} " in *" monitor "*)    has_monitor=1 ;; esac

  # Compliance↔Dashboard client: mint when both compliance + dashboard are installed
  if [ "${has_compliance}" = "1" ] && [ "${has_dashboard}" = "1" ]; then
    mint_compliance_oauth_client
  fi

  # Branding↔Dashboard client: mint when both branding + dashboard are installed
  if [ "${has_branding}" = "1" ] && [ "${has_dashboard}" = "1" ]; then
    mint_branding_oauth_client
  fi

  # LLM↔Dashboard client: mint when both llm + dashboard are installed
  if [ "${has_llm}" = "1" ] && [ "${has_dashboard}" = "1" ]; then
    mint_llm_dashboard_oauth_client
  fi

  # LLM↔Compliance client: mint when both llm + compliance are installed (compliance calls llm)
  if [ "${has_llm}" = "1" ] && [ "${has_compliance}" = "1" ]; then
    mint_llm_compliance_oauth_client
  fi

  # Monitor↔Compliance client: mint when monitor selected (compliance is required by validation)
  if [ "${has_monitor}" = "1" ]; then
    mint_monitor_oauth_client
  fi

  # Phase 42 / Plan 42-02 Task 1 step 1: write .install-state for install.command
  # to consume on macOS (launchd block needs INSTALL_COMPONENTS + MONITOR_* values
  # that live in this child process). chmod 600 — file contains OAuth secrets.
  write_install_state
}

# Phase 42 / Plan 42-02 Task 1: emit a flat KEY=value state file at
# ${INSTALL_DIR}/.install-state. Read by install.command's launchd block to
# drive per-component plist generation. Shape is shell-safe (KEY=value lines)
# so install.command can `. .install-state` directly. Avoid quoting — values
# never contain spaces/newlines (ports are integers, URLs are http URLs,
# OAuth IDs/secrets are hex/base64).
write_install_state() {
  local state_file="${INSTALL_DIR}/.install-state"
  # Only a value the dashboard's rules accepted and trusted_proxies_evaluate
  # checked against [0-9A-Za-z.:/%,-], so it is safe for `. .install-state` and
  # for XML. Checked again here, at the sink, before the file is touched.
  if ! trusted_proxies_charset_ok "${TRUSTED_PROXIES_WRITE}"; then
    error "internal: the trusted-proxy value holds a character outside [0-9A-Za-z.:/%,-]; ${state_file} not written"
    exit 1
  fi
  cat > "${state_file}" <<STATE
INSTALL_COMPONENTS=${INSTALL_COMPONENTS[*]}
COMPLIANCE_PORT=${COMPLIANCE_PORT}
BRANDING_PORT=${BRANDING_PORT}
LLM_PORT=${LLM_PORT}
DASHBOARD_PORT=${DASHBOARD_PORT}
MONITOR_PORT=${MONITOR_PORT}
COMPLIANCE_PUBLIC_URL=${COMPLIANCE_PUBLIC_URL}
BRANDING_PUBLIC_URL=${BRANDING_PUBLIC_URL}
LLM_PUBLIC_URL=${LLM_PUBLIC_URL}
DASHBOARD_PUBLIC_URL=${DASHBOARD_PUBLIC_URL}
MONITOR_CLIENT_ID=${MONITOR_CLIENT_ID}
MONITOR_CLIENT_SECRET=${MONITOR_CLIENT_SECRET}
MONITOR_CHECK_INTERVAL=${MONITOR_CHECK_INTERVAL:-manual}
OAUTH_KEY_MAX_AGE_DAYS=${OAUTH_KEY_MAX_AGE_DAYS}
STATE
  if [ -n "${TRUSTED_PROXIES_WRITE}" ]; then
    printf 'DASHBOARD_TRUSTED_PROXIES=%s\n' "${TRUSTED_PROXIES_WRITE}" >> "${state_file}"
  fi
  chmod 600 "${state_file}"
}

# ──────────────────────────────────────────────
# Step 7: Write config file
# ──────────────────────────────────────────────
write_config() {
  step 7 $TOTAL_STEPS_BM "Writing configuration"

  # Resolve to absolute path
  INSTALL_DIR="$(cd "${INSTALL_DIR}" && pwd)"
  CONFIG_FILE="${INSTALL_DIR}/dashboard.config.json"

  # Phase 42: dashboard.config.json is only meaningful when dashboard is installed.
  # Profiles cli + api skip this step entirely.
  if [[ " ${INSTALL_COMPONENTS[*]} " != *" dashboard "* ]]; then
    info "Dashboard not selected -- skipping dashboard.config.json"
    return
  fi

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
  "brandingUrl": "http://localhost:${BRANDING_PORT}",
  "llmUrl": "http://localhost:4200",
  "sessionSecret": "${SESSION_SECRET}",
  "complianceClientId": "${CLIENT_ID}",
  "complianceClientSecret": "${CLIENT_SECRET}",
  "brandingClientId": "${BRANDING_CLIENT_ID:-}",
  "brandingClientSecret": "${BRANDING_CLIENT_SECRET:-}",
  "llmClientId": "${LLM_CLIENT_ID:-}",
  "llmClientSecret": "${LLM_CLIENT_SECRET:-}",
  "dbPath": "${INSTALL_DIR}/dashboard.db",
  "reportsDir": "${INSTALL_DIR}/reports",
  "pluginsDir": "${INSTALL_DIR}/plugins"${webservice_field}${db_config}
}
CONF
  chmod 600 "${CONFIG_FILE}"
  success "dashboard.config.json written (all absolute paths)"
}

# ──────────────────────────────────────────────
# Step 8: Create systemd services (Phase 42 — dispatch loop over INSTALL_COMPONENTS)
# ──────────────────────────────────────────────
write_systemd_unit_compliance() {
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
Environment=COMPLIANCE_PUBLIC_URL=${COMPLIANCE_PUBLIC_URL}
Environment=COMPLIANCE_LLM_URL=${LLM_PUBLIC_URL}
Environment=COMPLIANCE_LLM_CLIENT_ID=${COMPLIANCE_LLM_CLIENT_ID:-}
Environment=COMPLIANCE_LLM_CLIENT_SECRET=${COMPLIANCE_LLM_CLIENT_SECRET:-}
ExecStart=${node_path} ${INSTALL_DIR}/packages/compliance/dist/cli.js serve --port ${COMPLIANCE_PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
}

write_systemd_unit_branding() {
  cat > /etc/systemd/system/luqen-branding.service <<UNIT
[Unit]
Description=Luqen Branding Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}/packages/branding
Environment=NODE_ENV=production
Environment=BRANDING_PORT=${BRANDING_PORT}
Environment=BRANDING_PUBLIC_URL=${BRANDING_PUBLIC_URL}
ExecStart=${node_path} ${INSTALL_DIR}/packages/branding/dist/cli.js serve --port ${BRANDING_PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
}

write_systemd_unit_llm() {
  local llm_ollama_env=""
  if [ -n "${OLLAMA_BASE_URL}" ]; then
    llm_ollama_env="Environment=OLLAMA_BASE_URL=${OLLAMA_BASE_URL}"
  fi
  cat > /etc/systemd/system/luqen-llm.service <<UNIT
[Unit]
Description=Luqen LLM Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}/packages/llm
Environment=NODE_ENV=production
Environment=LLM_PORT=${LLM_PORT}
Environment=LLM_PUBLIC_URL=${LLM_PUBLIC_URL}
${llm_ollama_env}
ExecStart=${node_path} ${INSTALL_DIR}/packages/llm/dist/cli.js serve --port ${LLM_PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
}

# render_systemd_unit_dashboard -- prints the dashboard unit to stdout. Reads
# node_path from the caller's scope, as create_systemd_services sets it. Split
# from write_systemd_unit_dashboard so install.test.sh can render without
# writing under /etc.
render_systemd_unit_dashboard() {
  local dashboard_trusted_proxies_env
  dashboard_trusted_proxies_env="$(dashboard_trusted_proxies_unit_line)" || return 1
  cat <<UNIT
[Unit]
Description=Luqen Dashboard
After=network.target luqen-compliance.service luqen-branding.service luqen-llm.service
Wants=luqen-compliance.service luqen-branding.service luqen-llm.service

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
Environment=DASHBOARD_PUBLIC_URL=${DASHBOARD_PUBLIC_URL}
Environment=DASHBOARD_JWKS_URI=${DASHBOARD_PUBLIC_URL}/oauth/.well-known/jwks.json
Environment=DASHBOARD_JWKS_URL=${DASHBOARD_PUBLIC_URL}/oauth/.well-known/jwks.json
Environment=OAUTH_KEY_MAX_AGE_DAYS=${OAUTH_KEY_MAX_AGE_DAYS}
Environment=COMPLIANCE_PUBLIC_URL=${COMPLIANCE_PUBLIC_URL}
Environment=BRANDING_PUBLIC_URL=${BRANDING_PUBLIC_URL}
Environment=LLM_PUBLIC_URL=${LLM_PUBLIC_URL}
${dashboard_trusted_proxies_env}
ExecStart=${node_path} ${INSTALL_DIR}/packages/dashboard/dist/cli.js serve --config ${CONFIG_FILE}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
}

write_systemd_unit_dashboard() {
  # Render first, so a refused value (WR-07) leaves the existing unit as it was.
  local unit_text
  unit_text="$(render_systemd_unit_dashboard)" || { error "The dashboard unit was not written."; exit 1; }
  printf '%s\n' "${unit_text}" > /etc/systemd/system/luqen-dashboard.service
}

write_systemd_unit_monitor() {
  # Phase 42 / Plan 42-01 Task 2: monitor agent system unit.
  # MONITOR_CLIENT_SECRET passed via Environment= (T-42-04 — never via ExecStart argv).
  cat > /etc/systemd/system/luqen-monitor.service <<UNIT
[Unit]
Description=Luqen Monitor Agent
After=network.target luqen-compliance.service
Wants=luqen-compliance.service

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}/packages/monitor
Environment=NODE_ENV=production
Environment=MONITOR_COMPLIANCE_URL=${COMPLIANCE_PUBLIC_URL}
Environment=MONITOR_CLIENT_ID=${MONITOR_CLIENT_ID}
Environment=MONITOR_CLIENT_SECRET=${MONITOR_CLIENT_SECRET}
Environment=MONITOR_URL=http://localhost:${MONITOR_PORT}
Environment=MONITOR_CHECK_INTERVAL=${MONITOR_CHECK_INTERVAL:-manual}
ExecStart=${node_path} ${INSTALL_DIR}/packages/monitor/dist/cli.js serve --port ${MONITOR_PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
}

create_systemd_services() {
  step 8 $TOTAL_STEPS_BM "Creating systemd services"

  if ! command -v systemctl &>/dev/null; then
    warn "systemd not available -- skipping service creation"
    return
  fi

  local node_path
  node_path="$(command -v node)"

  local component
  for component in "${INSTALL_COMPONENTS[@]}"; do
    case "${component}" in
      compliance) write_systemd_unit_compliance ;;
      branding)   write_systemd_unit_branding ;;
      llm)        write_systemd_unit_llm ;;
      dashboard)  write_systemd_unit_dashboard ;;
      monitor)    write_systemd_unit_monitor ;;
      core|docker) : ;;  # no system unit
    esac
  done

  systemctl daemon-reload >/dev/null 2>&1
  for component in "${INSTALL_COMPONENTS[@]}"; do
    case "${component}" in
      compliance|branding|llm|dashboard|monitor)
        systemctl enable "luqen-${component}.service" >/dev/null 2>&1
        ;;
    esac
  done
  success "systemd services created and enabled"
}

# ──────────────────────────────────────────────
# Step 9: Start services + post-install tasks
# ──────────────────────────────────────────────
_wait_for_health() {
  # Args: <label> <url> <log-hint>
  local label="$1" url="$2" hint="$3"
  info "Waiting for ${label}..."
  local attempts=0
  until curl -sf "${url}" >/dev/null 2>&1; do
    attempts=$(( attempts + 1 ))
    if [ "${attempts}" -ge 15 ]; then
      error "${label} did not start. Check: ${hint}"
      return 1
    fi
    sleep 2
  done
  success "${label} running"
  return 0
}

start_services_and_post_install() {
  step 9 $TOTAL_STEPS_BM "Starting services"

  local has_dashboard=0 has_compliance=0 has_branding=0 has_llm=0 has_monitor=0
  case " ${INSTALL_COMPONENTS[*]} " in *" compliance "*) has_compliance=1 ;; esac
  case " ${INSTALL_COMPONENTS[*]} " in *" branding "*)   has_branding=1 ;; esac
  case " ${INSTALL_COMPONENTS[*]} " in *" llm "*)        has_llm=1 ;; esac
  case " ${INSTALL_COMPONENTS[*]} " in *" dashboard "*)  has_dashboard=1 ;; esac
  case " ${INSTALL_COMPONENTS[*]} " in *" monitor "*)    has_monitor=1 ;; esac

  # Track fallback PIDs for cleanup (when systemd is unavailable)
  local COMP_PID="" BRANDING_PID="" LLM_PID="" DASH_PID="" MON_PID=""

  if command -v systemctl &>/dev/null; then
    if [ "${has_compliance}" = "1" ]; then
      systemctl start luqen-compliance.service >/dev/null 2>&1
      _wait_for_health "Compliance service" \
        "http://localhost:${COMPLIANCE_PORT}/api/v1/health" \
        "journalctl -u luqen-compliance" || return
    fi
    if [ "${has_branding}" = "1" ]; then
      systemctl start luqen-branding.service >/dev/null 2>&1
      _wait_for_health "Branding service" \
        "http://localhost:${BRANDING_PORT}/api/v1/health" \
        "journalctl -u luqen-branding" || return
    fi
    if [ "${has_llm}" = "1" ]; then
      systemctl start luqen-llm.service >/dev/null 2>&1
      _wait_for_health "LLM service" \
        "http://localhost:${LLM_PORT}/api/v1/health" \
        "journalctl -u luqen-llm" || return
    fi
    if [ "${has_dashboard}" = "1" ]; then
      systemctl start luqen-dashboard.service >/dev/null 2>&1
      _wait_for_health "Dashboard" \
        "http://localhost:${DASHBOARD_PORT}/health" \
        "journalctl -u luqen-dashboard" || return
    fi
    if [ "${has_monitor}" = "1" ]; then
      systemctl start luqen-monitor.service >/dev/null 2>&1
      # Monitor's A2A endpoint exposes /agent.json (agent card); use that as a probe.
      _wait_for_health "Monitor agent" \
        "http://localhost:${MONITOR_PORT}/agent.json" \
        "journalctl -u luqen-monitor" || \
        warn "Monitor health probe failed -- agent may still be starting; check journalctl -u luqen-monitor"
    fi
  else
    # Fallback: start directly via nohup (no systemd available)
    info "Starting services directly (no systemd)..."

    if [ "${has_compliance}" = "1" ]; then
      nohup node "${INSTALL_DIR}/packages/compliance/dist/cli.js" serve --port "${COMPLIANCE_PORT}" \
        > /tmp/luqen-comp-install.log 2>&1 &
      COMP_PID=$!
      _wait_for_health "Compliance service" \
        "http://localhost:${COMPLIANCE_PORT}/api/v1/health" \
        "/tmp/luqen-comp-install.log" || return
    fi
    if [ "${has_branding}" = "1" ]; then
      nohup node "${INSTALL_DIR}/packages/branding/dist/cli.js" serve --port "${BRANDING_PORT}" \
        > /tmp/luqen-branding-install.log 2>&1 &
      BRANDING_PID=$!
      _wait_for_health "Branding service" \
        "http://localhost:${BRANDING_PORT}/api/v1/health" \
        "/tmp/luqen-branding-install.log" || return
    fi
    if [ "${has_llm}" = "1" ]; then
      nohup node "${INSTALL_DIR}/packages/llm/dist/cli.js" serve --port "${LLM_PORT}" \
        > /tmp/luqen-llm-install.log 2>&1 &
      LLM_PID=$!
      _wait_for_health "LLM service" \
        "http://localhost:${LLM_PORT}/api/v1/health" \
        "/tmp/luqen-llm-install.log" || return
    fi
    if [ "${has_dashboard}" = "1" ]; then
      nohup node "${INSTALL_DIR}/packages/dashboard/dist/cli.js" serve --config "${CONFIG_FILE}" \
        > /tmp/luqen-dash-install.log 2>&1 &
      DASH_PID=$!
      _wait_for_health "Dashboard" \
        "http://localhost:${DASHBOARD_PORT}/health" \
        "/tmp/luqen-dash-install.log" || return
    fi
    if [ "${has_monitor}" = "1" ]; then
      MONITOR_COMPLIANCE_URL="${COMPLIANCE_PUBLIC_URL}" \
      MONITOR_CLIENT_ID="${MONITOR_CLIENT_ID}" \
      MONITOR_CLIENT_SECRET="${MONITOR_CLIENT_SECRET}" \
      MONITOR_URL="http://localhost:${MONITOR_PORT}" \
      MONITOR_CHECK_INTERVAL="${MONITOR_CHECK_INTERVAL:-manual}" \
      nohup node "${INSTALL_DIR}/packages/monitor/dist/cli.js" serve --port "${MONITOR_PORT}" \
        > /tmp/luqen-monitor-install.log 2>&1 &
      MON_PID=$!
      _wait_for_health "Monitor agent" \
        "http://localhost:${MONITOR_PORT}/agent.json" \
        "/tmp/luqen-monitor-install.log" || \
        warn "Monitor health probe failed -- agent may still be starting"
    fi
    success "Services started"
  fi

  # ── Dashboard-gated post-install (API key, admin user, plugins) ──
  # API key + admin-user setup + plugin install all require a running dashboard.
  # Profiles cli + api have no dashboard, so skip these steps cleanly.
  if [ "${has_dashboard}" = "1" ]; then
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

    # Install plugins (needs running dashboard + API key)
    if [ -n "${API_KEY}" ]; then
      install_plugins
    else
      warn "Could not retrieve API key -- skipping plugin installation"
    fi
  else
    info "Skipping plugin install (no dashboard in selected profile)"
  fi

  # Stop temp processes if not using systemd
  if ! command -v systemctl &>/dev/null; then
    kill ${COMP_PID:-} ${BRANDING_PID:-} ${LLM_PID:-} ${DASH_PID:-} ${MON_PID:-} 2>/dev/null || true
    wait ${COMP_PID:-} ${BRANDING_PID:-} ${LLM_PID:-} ${DASH_PID:-} ${MON_PID:-} 2>/dev/null || true
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

  local has_dashboard=0 has_compliance=0 has_branding=0 has_llm=0 has_monitor=0
  case " ${INSTALL_COMPONENTS[*]} " in *" compliance "*) has_compliance=1 ;; esac
  case " ${INSTALL_COMPONENTS[*]} " in *" branding "*)   has_branding=1 ;; esac
  case " ${INSTALL_COMPONENTS[*]} " in *" llm "*)        has_llm=1 ;; esac
  case " ${INSTALL_COMPONENTS[*]} " in *" dashboard "*)  has_dashboard=1 ;; esac
  case " ${INSTALL_COMPONENTS[*]} " in *" monitor "*)    has_monitor=1 ;; esac

  printf "\n"
  printf "  %s%s+==========================================+%s\n" "${BOLD}" "${GREEN}" "${RESET}"
  printf "  %s%s|      Luqen installed successfully!       |%s\n" "${BOLD}" "${GREEN}" "${RESET}"
  printf "  %s%s+==========================================+%s\n" "${BOLD}" "${GREEN}" "${RESET}"
  printf "\n"
  printf "  %sProfile:%s     %s\n" "${BOLD}" "${RESET}" "${PROFILE}"
  printf "  %sComponents:%s  %s\n" "${BOLD}" "${RESET}" "${INSTALL_COMPONENTS[*]}"
  printf "\n"
  printf "  %sURLs:%s\n" "${BOLD}" "${RESET}"
  [ "${has_dashboard}"  = "1" ] && printf "    Dashboard:   %s%shttp://localhost:${DASHBOARD_PORT}%s\n" "${BOLD}" "${CYAN}" "${RESET}"
  [ "${has_compliance}" = "1" ] && printf "    Compliance:  %s%shttp://localhost:${COMPLIANCE_PORT}%s\n" "${BOLD}" "${CYAN}" "${RESET}"
  [ "${has_branding}"   = "1" ] && printf "    Branding:    %s%shttp://localhost:${BRANDING_PORT}%s\n" "${BOLD}" "${CYAN}" "${RESET}"
  [ "${has_llm}"        = "1" ] && printf "    LLM:         %s%shttp://localhost:${LLM_PORT}%s\n" "${BOLD}" "${CYAN}" "${RESET}"
  [ "${has_monitor}"    = "1" ] && printf "    Monitor:     %s%shttp://localhost:${MONITOR_PORT}%s\n" "${BOLD}" "${CYAN}" "${RESET}"
  if [ "${PA11Y_MODE}" = "external" ] && [ -n "${PA11Y_URL}" ]; then
    printf "    pa11y:       %s\n" "${PA11Y_URL}"
  else
    printf "    Scanner:     built-in (pa11y library)\n"
  fi
  printf "\n"

  if [ -n "${ADMIN_USERNAME}" ] && [ "${has_dashboard}" = "1" ]; then
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

  if [ "${has_dashboard}" = "1" ] && [ -n "${CONFIG_FILE}" ]; then
    printf "  %sConfig:%s  %s\n" "${BOLD}" "${RESET}" "${CONFIG_FILE}"
    printf "\n"
  fi

  if [ "${has_dashboard}" = "1" ]; then
    if command -v systemctl &>/dev/null && [ -f /etc/systemd/system/luqen-dashboard.service ]; then
      print_trusted_proxies_readback systemd /etc/systemd/system/luqen-dashboard.service
    else
      print_trusted_proxies_readback state "${INSTALL_DIR}/.install-state"
    fi
    printf "\n"
  fi

  if command -v systemctl &>/dev/null; then
    # Build space-separated list of installed unit names
    local _units=""
    [ "${has_compliance}" = "1" ] && _units="${_units} luqen-compliance"
    [ "${has_branding}"   = "1" ] && _units="${_units} luqen-branding"
    [ "${has_llm}"        = "1" ] && _units="${_units} luqen-llm"
    [ "${has_dashboard}"  = "1" ] && _units="${_units} luqen-dashboard"
    [ "${has_monitor}"    = "1" ] && _units="${_units} luqen-monitor"
    _units="${_units# }"

    if [ -n "${_units}" ]; then
      printf "  %sService management:%s\n" "${BOLD}" "${RESET}"
      printf "    systemctl status %s\n" "${_units}"
      printf "    systemctl restart %s\n" "${_units}"
      printf "    systemctl stop    %s\n" "${_units}"
      [ "${has_dashboard}"  = "1" ] && printf "    journalctl -fu    luqen-dashboard\n"
      [ "${has_branding}"   = "1" ] && printf "    journalctl -fu    luqen-branding\n"
      [ "${has_llm}"        = "1" ] && printf "    journalctl -fu    luqen-llm\n"
      [ "${has_monitor}"    = "1" ] && printf "    journalctl -fu    luqen-monitor\n"
      printf "\n"

      printf "  %sCurrent status:%s\n" "${BOLD}" "${RESET}"
      [ "${has_compliance}" = "1" ] && systemctl --no-pager status luqen-compliance.service 2>/dev/null | head -3 | sed 's/^/    /' || true
      [ "${has_branding}"   = "1" ] && systemctl --no-pager status luqen-branding.service   2>/dev/null | head -3 | sed 's/^/    /' || true
      [ "${has_llm}"        = "1" ] && systemctl --no-pager status luqen-llm.service        2>/dev/null | head -3 | sed 's/^/    /' || true
      [ "${has_dashboard}"  = "1" ] && systemctl --no-pager status luqen-dashboard.service  2>/dev/null | head -3 | sed 's/^/    /' || true
      [ "${has_monitor}"    = "1" ] && systemctl --no-pager status luqen-monitor.service    2>/dev/null | head -3 | sed 's/^/    /' || true
      printf "\n"
    fi
  else
    printf "  %sStart services:%s\n" "${BOLD}" "${RESET}"
    printf "    cd %s && npm run dev:all\n" "${INSTALL_DIR}"
    printf "\n"
  fi

  if [ "${has_monitor}" = "1" ]; then
    printf "  %sMonitor agent:%s\n" "${BOLD}" "${RESET}"
    printf "    Registered as luqen-monitor.service (port %s, manual mode).\n" "${MONITOR_PORT}"
    printf "    The agent listens for A2A requests but does not auto-scan. To run a scan:\n"
    printf "      sudo -u root node %s/packages/monitor/dist/cli.js scan\n" "${INSTALL_DIR}"
    printf "    Disable startup at boot: %ssystemctl disable luqen-monitor%s\n" "${DIM}" "${RESET}"
    printf "\n"
  fi
}

# ══════════════════════════════════════════════
#  DOCKER COMPOSE INSTALLATION
# ══════════════════════════════════════════════

TOTAL_STEPS_DOCKER=5

# render_docker_env -- prints the Docker Compose .env to stdout. Reads
# SESSION_SECRET and the port / URL settings from the caller's scope. Split from
# run_docker_install so install.test.sh can render it without Docker.
render_docker_env() {
  local docker_trusted_proxies_line=""
  if [ -n "${DASHBOARD_TRUSTED_PROXIES}" ]; then
    docker_trusted_proxies_line="DASHBOARD_TRUSTED_PROXIES=${DASHBOARD_TRUSTED_PROXIES}"
  fi
  cat <<ENVFILE
# Luqen Docker Compose configuration
# Generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Last reviewed for v3.1.0 (Phase 40 / DOC-03) — head migration 061
COMPLIANCE_PORT=${COMPLIANCE_PORT}
DASHBOARD_PORT=${DASHBOARD_PORT}
DASHBOARD_SESSION_SECRET=${SESSION_SECRET}
# OPTIONAL — at-rest AES key, independent of DASHBOARD_SESSION_SECRET above.
# This installer documents this variable but never generates a value for it
# (rotating it requires re-keying existing encrypted data first — see the
# runbook). Defaults to DASHBOARD_SESSION_SECRET when left unset:
# docs/guides/security-administration.md#rotating-the-session-secret-and-the-at-rest-encryption-key
# DASHBOARD_ENCRYPTION_KEY=
LUQEN_WEBSERVICE_URL=

# ── Public URLs (Phase 30/31.1) ──
# Override these with real hostnames for production installs.
DASHBOARD_PUBLIC_URL=${DASHBOARD_PUBLIC_URL}
COMPLIANCE_PUBLIC_URL=${COMPLIANCE_PUBLIC_URL}
BRANDING_PUBLIC_URL=${BRANDING_PUBLIC_URL}
LLM_PUBLIC_URL=${LLM_PUBLIC_URL}

# ── OAuth signing key rotation (Phase 31.1) ──
OAUTH_KEY_MAX_AGE_DAYS=${OAUTH_KEY_MAX_AGE_DAYS}

# ── JWKS discovery (Phase 31.1) ──
# Either set DASHBOARD_JWKS_URI / DASHBOARD_JWKS_URL (preferred) or
# DASHBOARD_JWT_PUBLIC_KEY (PEM, "\n" allowed for single-line env form).
DASHBOARD_JWKS_URI=${DASHBOARD_PUBLIC_URL}/oauth/.well-known/jwks.json
DASHBOARD_JWKS_URL=${DASHBOARD_PUBLIC_URL}/oauth/.well-known/jwks.json
# DASHBOARD_JWT_PUBLIC_KEY=

# ── Optional: Ollama provider for the LLM service ──
# OLLAMA_BASE_URL=http://localhost:11434

# ── Reverse proxy: trusted proxies (Phase 96 / OPS-01) ──
# DASHBOARD_TRUSTED_PROXIES lists the proxy addresses whose X-Forwarded-For the
# dashboard trusts. Unset (the default) means the dashboard's own default
# applies. A Docker install has no dashboard build on the host, so the
# dashboard checks this list when its container starts; a refused list keeps the
# container down and the installer prints the compose logs.
# See docs/getting-started/installation.md.
${docker_trusted_proxies_line}
ENVFILE
}

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
  render_docker_env > "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  success ".env written at ${ENV_FILE}"

  # Step 4: Build and start
  step 4 $TOTAL_STEPS_DOCKER "Building and starting containers"

  cd "${INSTALL_DIR}"
  if ! run_quiet "Building images" ${COMPOSE_CMD} build; then
    error "docker compose build failed — see step output above. Aborting."
    exit 1
  fi
  if ! run_quiet "Starting containers" ${COMPOSE_CMD} up -d; then
    error "docker compose up failed — see step output above. Aborting."
    exit 1
  fi

  info "Waiting for services to become healthy..."
  local attempts=0
  until curl -sf "http://localhost:${DASHBOARD_PORT}/health" >/dev/null 2>&1; do
    attempts=$(( attempts + 1 ))
    if [ "${attempts}" -ge 30 ]; then
      error "Services did not become healthy after $((attempts * 2))s. Recent compose logs:"
      ${COMPOSE_CMD} logs --tail 30 2>&1 | sed 's/^/    /' >"$OUT" || true
      error "For full logs: cd ${INSTALL_DIR} && ${COMPOSE_CMD} logs"
      exit 1
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
  print_docker_trusted_proxies_result
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
#  WHAT'S NEW SINCE v2.12.0  (printed at end of every install)
# ══════════════════════════════════════════════

show_v3_whats_new() {
  printf "\n"
  printf "  %s%sWhat's new since v2.12.0%s\n" "${BOLD}" "${CYAN}" "${RESET}"
  printf "  %s========================%s\n\n" "${DIM}" "${RESET}"

  printf "  %sNew admin pages:%s\n" "${BOLD}" "${RESET}"
  printf "    %s/admin/audit%s         Agent audit log viewer (filter + CSV export) — %saudit.view%s\n" \
    "${CYAN}" "${RESET}" "${YELLOW}" "${RESET}"
  printf "    %s/admin/oauth-keys%s    OAuth signing-key inventory + manual rotate — %sadmin.system%s\n\n" \
    "${CYAN}" "${RESET}" "${YELLOW}" "${RESET}"

  printf "  %sNew end-user surface:%s\n" "${BOLD}" "${RESET}"
  printf "    %s/agent%s               Agent companion side panel (text + speech)\n" "${CYAN}" "${RESET}"
  printf "    %s/agent/share/<id>%s    Read-only conversation share-link permalinks\n" "${CYAN}" "${RESET}"
  printf "    %s/api/mcp%s             Streamable HTTP MCP endpoint (Claude Desktop, IDEs)\n" "${CYAN}" "${RESET}"
  printf "    %s/oauth/.well-known/*%s Authorization-server / JWKS / protected-resource discovery\n\n" \
    "${CYAN}" "${RESET}"

  printf "  %sNew RBAC permission:%s\n" "${BOLD}" "${RESET}"
  printf "    %smcp.use%s              Gate for calling MCP tools (back-filled onto every existing role by migration 054)\n\n" \
    "${YELLOW}" "${RESET}"

  printf "  %sFor production deployments, set these env vars on the dashboard unit:%s\n" "${BOLD}" "${RESET}"
  printf "    DASHBOARD_PUBLIC_URL    External URL the dashboard advertises (OAuth issuer / MCP discovery)\n"
  printf "    DASHBOARD_JWKS_URI      JWKS endpoint (defaults to \${DASHBOARD_PUBLIC_URL}/oauth/.well-known/jwks.json)\n"
  printf "    OAUTH_KEY_MAX_AGE_DAYS  Signing-key rotation budget (default 90)\n"
  printf "    DASHBOARD_TRUSTED_PROXIES  Proxy addresses whose X-Forwarded-For is trusted (install.sh --trusted-proxies; default: loopback, linklocal, uniquelocal)\n\n"

  printf "  %sMore detail:%s docs/deployment/installer-changelog.md\n\n" "${BOLD}" "${RESET}"
}

# run_bare_metal_install -- the full bare-metal sequence. A function so
# install.test.sh can run it with every step stubbed and check the order.
run_bare_metal_install() {
  resolve_public_url_defaults  # Pre-step: fill in *_PUBLIC_URL defaults
  check_prerequisites          # Step 1
  clone_or_pull                # Step 2
  install_and_build            # Step 3
  validate_trusted_proxies     # Between 3 and 4: after the checkout and build, before any secret, config or unit (D-02)
  generate_secrets             # Step 4
  seed_data                    # Step 5
  create_oauth_client          # Step 6
  write_config                 # Step 7
  create_systemd_services      # Step 8
  start_services_and_post_install  # Step 9
  show_summary_bare_metal      # Step 10
  show_v3_whats_new            # Post: print v3.x changes summary
}

# Source mode: install.test.sh and scripts/compare-trusted-proxies.sh set
# LUQEN_INSTALL_LIB_ONLY=1 and source this file to load the functions above
# without installing anything. Nothing above this line parses the command line
# or dispatches a mode (parse_args is only defined), so a sourced file with
# --uninstall among its arguments runs no uninstall. Executed rather than
# sourced (bash install.sh, curl | bash) with the variable set, it stops with
# exit 64 instead of exiting 0 having done nothing.
if [ "${LUQEN_INSTALL_LIB_ONLY:-}" = "1" ]; then
  if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    printf 'LUQEN_INSTALL_LIB_ONLY=1 is for sourcing install.sh; unset it to install\n' >&2
    exit 64
  fi
  return 0
fi

parse_args "$@"

if [ "${CHECK_TRUSTED_PROXIES_ONLY}" = "true" ] && [ "${UNINSTALL:-false}" = "true" ]; then
  error "--check-trusted-proxies installs nothing and cannot be combined with --uninstall"
  exit 1
fi

if [ "${UNINSTALL:-false}" = "true" ]; then
  uninstall_luqen "$([ "${UNINSTALL_PURGE:-false}" = "true" ] && echo yes || echo no)"
fi

# --check-trusted-proxies: dispatched here so every function is defined and
# --install-dir is honoured whatever the flag order. Before the wizard, so it
# never prompts and never installs.
if [ "${CHECK_TRUSTED_PROXIES_ONLY}" = "true" ]; then
  check_trusted_proxies_only
fi

# ══════════════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════════════

# Run wizard if interactive
if [ "${INTERACTIVE}" = "true" ] && { [ -t 0 ] || [ -n "${LUQEN_INSTALL_REEXEC:-}" ]; }; then
  run_wizard
fi

# Phase 42: derive INSTALL_COMPONENTS from PROFILE + flags before dispatching.
# Honours D-01 (non-interactive default = dashboard profile, all 4 services, no monitor).
derive_install_components

# Route to the correct installation path. DEPLOY_MODE was set by derive_install_components
# (which translates PROFILE → DEPLOY_MODE). Legacy --mode docker also honoured.
case "${DEPLOY_MODE}" in
  docker)
    resolve_public_url_defaults
    run_docker_install
    show_v3_whats_new
    ;;
  cli-only)
    # Phase 42 Profile 1: Scanner CLI — @luqen/core only + stdio MCP for VS Code/Claude Code.
    check_prerequisites
    clone_or_pull

    step 1 3 "Installing dependencies"
    run_quiet "Installing npm dependencies" npm install --prefer-offline
    success "Dependencies installed"

    step 2 3 "Building scanner"
    run_quiet "Building @luqen/core" npm run build -w packages/core
    success "Build complete"

    step 3 3 "Linking CLI"
    run_quiet "Linking luqen command" npm link -w packages/core
    success "CLI linked"

    printf "\n"
    printf "  %s+======================================+%s\n" "${GREEN}${BOLD}" "${RESET}"
    printf "  %s|    Luqen Scanner CLI Installed       |%s\n" "${GREEN}${BOLD}" "${RESET}"
    printf "  %s+======================================+%s\n" "${GREEN}${BOLD}" "${RESET}"
    printf "\n"
    printf "  %sScan a site:%s\n" "${BOLD}" "${RESET}"
    printf "    luqen scan https://example.com\n"
    printf "    luqen scan https://example.com --format both\n"
    printf "\n"
    printf "  %sStdio MCP server (for VS Code / Claude Code):%s\n" "${BOLD}" "${RESET}"
    printf "    node %s/packages/core/dist/mcp.js\n" "${INSTALL_DIR}"
    printf "\n"
    printf "  No external services needed -- pa11y runs as a built-in library.\n"
    printf "  For HTTP/Streamable MCP and the dashboard, use --profile dashboard.\n"
    printf "\n"
    ;;
  *)
    run_bare_metal_install
    ;;
esac
