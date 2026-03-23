#!/usr/bin/env bash
# install.command — macOS double-clickable installer wrapper for Luqen
#
# Usage:
#   1. Download and double-click this file in Finder
#   2. Or: curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.command | bash
#   3. Or: chmod +x install.command && ./install.command
#
# This wrapper ensures install.sh runs correctly on macOS regardless of
# how it is launched (double-click, terminal, curl pipe).
# Supports both deployment modes: bare metal and Docker Compose.

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
if [ -z "${LUQEN_INSTALL_REEXEC:-}" ] && [ "${TERM_PROGRAM:-}" != "Apple_Terminal" ] && [ "${TERM_PROGRAM:-}" != "iTerm.app" ] && [ "${TERM_PROGRAM:-}" != "vscode" ] && [ -z "${SSH_TTY:-}" ]; then
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
exec bash "${INSTALL_SH}" "$@"
