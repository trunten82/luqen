#!/usr/bin/env bash
# install.command — macOS double-clickable installer wrapper for Luqen
# Last reviewed for v3.1.0 (Phase 40 / DOC-03) — head migration 061
#
# Usage:
#   1. Download and double-click this file in Finder
#   2. Or: curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.command | bash
#   3. Or: chmod +x install.command && ./install.command
#
# This wrapper ensures install.sh runs correctly on macOS regardless of
# how it is launched (double-click, terminal, curl pipe).
# Supports both deployment modes: bare metal and Docker Compose.
#
# Post-install on macOS, this wrapper installs launchd plists for the
# four long-running daemons (compliance, branding, llm, dashboard) since
# install.sh's systemd block is a no-op on macOS. MCP runs embedded in
# the dashboard (Fastify plugin) — no separate luqen-mcp daemon.

set -euo pipefail

# ──────────────────────────────────────────────
# Resolve the directory this script lives in
# ──────────────────────────────────────────────
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

# ──────────────────────────────────────────────
# If launched by double-click (Finder / Login shell),
# open a real Terminal.app window and re-exec
# ──────────────────────────────────────────────
# Skip Terminal.app re-exec when called non-interactively (curl|bash, CI, ssh).
# Without this guard, piped use with no TERM_PROGRAM tries to launch
# Terminal.app and exits before the installer runs.
REEXEC_NONINTERACTIVE=0
for arg in "$@"; do
    case "$arg" in
        --non-interactive) REEXEC_NONINTERACTIVE=1 ;;
    esac
done
if [ "${REEXEC_NONINTERACTIVE}" = "0" ] && [ -z "${LUQEN_INSTALL_REEXEC:-}" ] && [ "${TERM_PROGRAM:-}" != "Apple_Terminal" ] && [ "${TERM_PROGRAM:-}" != "iTerm.app" ] && [ "${TERM_PROGRAM:-}" != "vscode" ] && [ -z "${SSH_TTY:-}" ] && [ -t 0 ]; then
    SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
    if [ -f "${SELF}" ]; then
        export LUQEN_INSTALL_REEXEC=1
        osascript -e "tell application \"Terminal\" to do script \"exec bash '${SELF}'\"" 2>/dev/null || true
        exit 0
    fi
fi

# ──────────────────────────────────────────────
# Ensure we use bash (not zsh)
# ──────────────────────────────────────────────
if [ -n "${ZSH_VERSION:-}" ]; then
    exec bash "$0" "$@"
fi

# ──────────────────────────────────────────────
# Set a sensible working directory
# ──────────────────────────────────────────────
cd "${HOME}"

# ──────────────────────────────────────────────
# macOS prerequisites
# ──────────────────────────────────────────────
if ! command -v git &>/dev/null; then
    echo ""
    echo "  git is not installed. Installing Xcode Command Line Tools..."
    xcode-select --install 2>/dev/null || true
    echo ""
    echo "  If a dialog appeared, complete the installation, then re-run this installer."
    echo ""
    read -rp "  Press Enter to exit..."
    exit 1
fi

if ! command -v node &>/dev/null; then
    if command -v brew &>/dev/null; then
        echo "  Node.js not found. Installing via Homebrew..."
        brew install node 2>/dev/null
    else
        echo ""
        echo "  Node.js 20+ is required. Install via Homebrew:"
        echo ""
        echo "    /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        echo "    brew install node"
        echo ""
        echo "  Or download from https://nodejs.org"
        echo ""
        read -rp "  Press Enter to exit..."
        exit 1
    fi
fi

# ──────────────────────────────────────────────
# macOS note: systemd is not available.
# Bare metal mode will create launchd agents.
# Docker mode requires Docker Desktop for Mac.
# The install.sh script detects this automatically.
# ──────────────────────────────────────────────

# ──────────────────────────────────────────────
# Locate and run install.sh
# ──────────────────────────────────────────────
INSTALL_SH=""

# 1. Check if install.sh is alongside this .command file
if [ -n "${SCRIPT_DIR}" ] && [ -f "${SCRIPT_DIR}/install.sh" ]; then
    INSTALL_SH="${SCRIPT_DIR}/install.sh"
fi

# 2. Check common install locations
if [ -z "${INSTALL_SH}" ] && [ -f "${HOME}/luqen/install.sh" ]; then
    INSTALL_SH="${HOME}/luqen/install.sh"
fi

# 3. Download and execute from GitHub
if [ -z "${INSTALL_SH}" ]; then
    echo ""
    echo "  Luqen Installer"
    echo "  ==============="
    echo ""
    echo "  install.sh not found locally -- downloading from GitHub..."
    echo ""

    if ! command -v curl &>/dev/null; then
        echo "  ERROR: curl is required but not installed."
        echo "  Install Xcode Command Line Tools: xcode-select --install"
        echo ""
        read -rp "  Press Enter to exit..."
        exit 1
    fi

    TMPSCRIPT="$(mktemp /tmp/luqen-install.XXXXXX.sh)"
    trap 'rm -f "${TMPSCRIPT}"' EXIT

    curl -fsSL "https://raw.githubusercontent.com/trunten82/luqen/master/install.sh" -o "${TMPSCRIPT}"
    chmod +x "${TMPSCRIPT}"
    INSTALL_SH="${TMPSCRIPT}"
fi

# ──────────────────────────────────────────────
# Run the installer, passing through all arguments
# ──────────────────────────────────────────────
bash "${INSTALL_SH}" "$@"
INSTALL_RC=$?

if [ "${INSTALL_RC}" -ne 0 ]; then
    exit "${INSTALL_RC}"
fi

# ──────────────────────────────────────────────
# macOS post-install: register launchd agents for v3.1.0 daemons
#
# install.sh writes systemd units on Linux and skips on macOS. Mirror the
# four units (compliance, branding, llm, dashboard) as user-level launchd
# plists under ~/Library/LaunchAgents. MCP is embedded in the dashboard
# (CLAUDE.md: "MCP embedded as Fastify plugin per service, never standalone
# port") — do NOT register a separate luqen-mcp agent.
# ──────────────────────────────────────────────

NODE_PATH="$(command -v node 2>/dev/null || true)"
INSTALL_DIR_DEFAULT="${HOME}/luqen"
INSTALL_DIR="${LUQEN_INSTALL_DIR:-${INSTALL_DIR_DEFAULT}}"

# Resolve installer-default ports (mirrors install.sh defaults).
COMPLIANCE_PORT="${COMPLIANCE_PORT:-4000}"
DASHBOARD_PORT="${DASHBOARD_PORT:-5000}"
BRANDING_PORT="${BRANDING_PORT:-4100}"
LLM_PORT="${LLM_PORT:-4200}"

# *_PUBLIC_URL defaults — operators override via the environment before
# running install.command, e.g. DASHBOARD_PUBLIC_URL=https://luqen.example.com.
DASHBOARD_PUBLIC_URL="${DASHBOARD_PUBLIC_URL:-http://localhost:${DASHBOARD_PORT}}"
COMPLIANCE_PUBLIC_URL="${COMPLIANCE_PUBLIC_URL:-http://localhost:${COMPLIANCE_PORT}}"
BRANDING_PUBLIC_URL="${BRANDING_PUBLIC_URL:-http://localhost:${BRANDING_PORT}}"
LLM_PUBLIC_URL="${LLM_PUBLIC_URL:-http://localhost:${LLM_PORT}}"
OAUTH_KEY_MAX_AGE_DAYS="${OAUTH_KEY_MAX_AGE_DAYS:-90}"

if [ -z "${NODE_PATH}" ] || [ ! -d "${INSTALL_DIR}/packages/dashboard/dist" ]; then
    echo ""
    echo "  (skipping launchd registration — node not found or install dir missing)"
    exit 0
fi

LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
mkdir -p "${LAUNCH_AGENTS_DIR}"

write_plist() {
    local label="$1"; shift
    local working_dir="$1"; shift
    local plist_path="${LAUNCH_AGENTS_DIR}/${label}.plist"
    # Remaining args are alternating ENV/value pairs until "--ARGS--", then ExecStart args.
    local env_xml="" exec_args=""
    local in_args=0
    while [ $# -gt 0 ]; do
        if [ "$1" = "--ARGS--" ]; then in_args=1; shift; continue; fi
        if [ ${in_args} -eq 0 ]; then
            local k="$1"; local v="$2"; shift 2
            env_xml+="    <key>${k}</key><string>${v}</string>"$'\n'
        else
            exec_args+="    <string>$1</string>"$'\n'; shift
        fi
    done

    cat > "${plist_path}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
${exec_args}  </array>
  <key>WorkingDirectory</key><string>${working_dir}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
${env_xml}  </dict>
  <key>StandardOutPath</key><string>/tmp/${label}.log</string>
  <key>StandardErrorPath</key><string>/tmp/${label}.err.log</string>
</dict>
</plist>
PLIST
    launchctl unload "${plist_path}" 2>/dev/null || true
    launchctl load "${plist_path}"
    echo "  + ${label} -> ${plist_path}"
}

echo ""
echo "  Registering launchd agents (compliance, branding, llm, dashboard)..."

write_plist "io.luqen.compliance" "${INSTALL_DIR}/packages/compliance" \
    COMPLIANCE_PORT "${COMPLIANCE_PORT}" \
    COMPLIANCE_PUBLIC_URL "${COMPLIANCE_PUBLIC_URL}" \
    COMPLIANCE_LLM_URL "${LLM_PUBLIC_URL}" \
    --ARGS-- "${INSTALL_DIR}/packages/compliance/dist/cli.js" "serve" "--port" "${COMPLIANCE_PORT}"

write_plist "io.luqen.branding" "${INSTALL_DIR}/packages/branding" \
    BRANDING_PORT "${BRANDING_PORT}" \
    BRANDING_PUBLIC_URL "${BRANDING_PUBLIC_URL}" \
    --ARGS-- "${INSTALL_DIR}/packages/branding/dist/cli.js" "serve" "--port" "${BRANDING_PORT}"

write_plist "io.luqen.llm" "${INSTALL_DIR}/packages/llm" \
    LLM_PORT "${LLM_PORT}" \
    LLM_PUBLIC_URL "${LLM_PUBLIC_URL}" \
    --ARGS-- "${INSTALL_DIR}/packages/llm/dist/cli.js" "serve" "--port" "${LLM_PORT}"

CONFIG_FILE="${INSTALL_DIR}/dashboard.config.json"
write_plist "io.luqen.dashboard" "${INSTALL_DIR}" \
    DASHBOARD_PUBLIC_URL "${DASHBOARD_PUBLIC_URL}" \
    DASHBOARD_JWKS_URI "${DASHBOARD_PUBLIC_URL}/oauth/.well-known/jwks.json" \
    DASHBOARD_JWKS_URL "${DASHBOARD_PUBLIC_URL}/oauth/.well-known/jwks.json" \
    OAUTH_KEY_MAX_AGE_DAYS "${OAUTH_KEY_MAX_AGE_DAYS}" \
    COMPLIANCE_PUBLIC_URL "${COMPLIANCE_PUBLIC_URL}" \
    BRANDING_PUBLIC_URL "${BRANDING_PUBLIC_URL}" \
    LLM_PUBLIC_URL "${LLM_PUBLIC_URL}" \
    --ARGS-- "${INSTALL_DIR}/packages/dashboard/dist/cli.js" "serve" "--config" "${CONFIG_FILE}"

# ──────────────────────────────────────────────
# What's new since v2.12.0 (mirrors install.sh)
# ──────────────────────────────────────────────
cat <<'NEWS'

  What's new since v2.12.0
  ========================

  New admin pages:
    /admin/audit         Agent audit log viewer (filter + CSV export) — audit.view
    /admin/oauth-keys    OAuth signing-key inventory + manual rotate — admin.system

  New end-user surface:
    /agent               Agent companion side panel (text + speech)
    /agent/share/<id>    Read-only share-link permalinks
    /api/mcp             Streamable HTTP MCP endpoint
    /oauth/.well-known/* Authorization-server / JWKS / protected-resource discovery

  New RBAC permission:
    mcp.use              Gate for calling MCP tools (back-filled by migration 054)

  For production set DASHBOARD_PUBLIC_URL / DASHBOARD_JWKS_URI before re-running
  this installer, and adjust ~/Library/LaunchAgents/io.luqen.*.plist accordingly.

  More detail: docs/deployment/installer-changelog.md

NEWS
