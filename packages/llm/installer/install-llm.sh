#!/usr/bin/env bash
# install-llm.sh — standalone installer for the @luqen/llm module
# Usage:  bash packages/llm/installer/install-llm.sh
# Flags:  --non-interactive, --port PORT, --provider-type TYPE,
#         --provider-url URL, --provider-name NAME, --model NAME,
#         --client-name NAME, --client-scopes SCOPES, --help

set -euo pipefail

# ──────────────────────────────────────────────
# Capture script location before any cd
# ──────────────────────────────────────────────
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"

# ──────────────────────────────────────────────
# Guard against deleted CWD (getcwd error)
# ──────────────────────────────────────────────
cd "$HOME" 2>/dev/null || cd /root 2>/dev/null || cd /tmp

# ──────────────────────────────────────────────
# Re-exec from temp file when piped (curl | bash)
# so that stdin is the terminal for interactive prompts.
# Skip re-exec when --non-interactive or --help is passed
# (no tty needed for those flows).
# ──────────────────────────────────────────────
_NEEDS_TTY=true
for _arg in "$@"; do
  case "${_arg}" in
    --non-interactive|--help|-h) _NEEDS_TTY=false; break ;;
  esac
done

if [ "${_NEEDS_TTY}" = "true" ] && [ ! -t 0 ] && [ -z "${LUQEN_LLM_INSTALL_REEXEC:-}" ] && (exec </dev/tty) 2>/dev/null; then
  TMPSCRIPT="$(mktemp /tmp/luqen-llm-install.XXXXXX.sh)"
  cat > "${TMPSCRIPT}"
  export LUQEN_LLM_INSTALL_REEXEC=1
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

# Output destination: /dev/tty if usable, else stderr
if (exec >/dev/tty) 2>/dev/null; then
  _OUT=/dev/tty
else
  _OUT=/dev/stderr
fi

info()    { printf "%s  %s%s\n"   "${CYAN}*${RESET}"  "$*"          "${RESET}" >"${_OUT}"; }
success() { printf "%s  %s%s\n"   "${GREEN}+${RESET}" "${GREEN}$*"  "${RESET}" >"${_OUT}"; }
warn()    { printf "%s  %s%s\n"   "${YELLOW}!${RESET}" "${YELLOW}$*" "${RESET}" >"${_OUT}"; }
error()   { printf "%s  %s%s\n"   "${RED}x${RESET}"   "${RED}$*"    "${RESET}" >"${_OUT}"; }
header()  { printf "\n%s%s%s\n\n" "${BOLD}${CYAN}"     "$*"          "${RESET}" >"${_OUT}"; }
step()    { printf "\n%s[%s/%s]%s %s%s%s\n" "${DIM}" "$1" "$2" "${RESET}" "${BOLD}" "$3" "${RESET}" >"${_OUT}"; }

run_quiet() {
  local label="$1"; shift
  printf "  %-40s" "$label" >"${_OUT}"
  if "$@" >/dev/null 2>&1; then
    printf "${GREEN}+${RESET}\n" >"${_OUT}"
  else
    printf "${RED}x${RESET}\n" >"${_OUT}"
    return 1
  fi
}

# ──────────────────────────────────────────────
# Defaults
# ──────────────────────────────────────────────
INSTALL_DIR="${LUQEN_LLM_INSTALL_DIR:-$(cd "${_SCRIPT_DIR}/.." && pwd)}"  # packages/llm/
LLM_PORT=4200
INTERACTIVE=true
PROVIDER_TYPE="ollama"
PROVIDER_URL="http://localhost:11434"
PROVIDER_NAME="Local Ollama"
MODEL_NAME="llama3.2"
CLIENT_NAME="dashboard"
CLIENT_SCOPES="read,write,admin"

# ──────────────────────────────────────────────
# Help
# ──────────────────────────────────────────────
_print_help() {
  cat <<EOF
${BOLD}Luqen LLM Module Installer${RESET}

Usage:
  bash install-llm.sh [options]

Interactive wizard runs by default. Pass flags for headless/CI:

Options:
  --non-interactive           Skip all prompts (use defaults + flags)
  --port PORT                 LLM service port (default: 4200)
  --provider-type TYPE        Provider type: ollama | openai (default: ollama)
  --provider-url URL          Provider base URL (default: http://localhost:11434)
  --provider-name NAME        Provider display name (default: Local Ollama)
  --model NAME                Model name to register (default: llama3.2)
  --client-name NAME          OAuth client name for callers (default: dashboard)
  --client-scopes SCOPES      Comma-separated scopes (default: read,write,admin)
  --help                      Show this help

What this installer does:
  1. Verifies the LLM package is built (dist/cli.js must exist)
  2. Generates RS256 JWT keys (idempotent)
  3. Creates an OAuth2 client for a named caller (idempotent)
  4. Registers an LLM provider (idempotent)
  5. Registers a model and assigns it to all 4 capabilities (idempotent)
  6. Prints a dashboard.config.json snippet with credentials
EOF
}
show_help()       { _print_help; exit 0; }
show_help_error() { _print_help; exit 1; }

# ──────────────────────────────────────────────
# Argument parsing
# ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive)   INTERACTIVE=false; shift ;;
    --port)              LLM_PORT="$2"; shift 2 ;;
    --provider-type)     PROVIDER_TYPE="$2"; shift 2 ;;
    --provider-url)      PROVIDER_URL="$2"; shift 2 ;;
    --provider-name)     PROVIDER_NAME="$2"; shift 2 ;;
    --model)             MODEL_NAME="$2"; shift 2 ;;
    --client-name)       CLIENT_NAME="$2"; shift 2 ;;
    --client-scopes)     CLIENT_SCOPES="$2"; shift 2 ;;
    --help|-h)           show_help ;;
    *) error "Unknown option: $1"; show_help_error ;;
  esac
done

# ──────────────────────────────────────────────
# Interactive prompt helpers
# ──────────────────────────────────────────────
ask() {
  local prompt="$1" default="$2" var="$3"
  printf "  %s%s%s %s[%s]%s: " "${BOLD}" "${prompt}" "${RESET}" "${DIM}" "${default}" "${RESET}" >"${_OUT}"
  read -r input </dev/tty
  eval "${var}=\"${input:-${default}}\""
}

ask_secret() {
  local prompt="$1" var="$2"
  printf "  %s%s%s: " "${BOLD}" "${prompt}" "${RESET}" >"${_OUT}"
  read -rs input </dev/tty
  printf "\n" >"${_OUT}"
  eval "${var}=\"${input}\""
}

ask_yn() {
  local prompt="$1" default="$2"
  local yn_hint="[Y/n]"
  [ "${default}" = "n" ] && yn_hint="[y/N]"
  printf "  %s%s%s %s%s%s: " "${BOLD}" "${prompt}" "${RESET}" "${DIM}" "${yn_hint}" "${RESET}" >"${_OUT}"
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
  printf "\n  %s%s%s\n" "${BOLD}" "${prompt}" "${RESET}" >"${_OUT}"
  local i=1
  for opt in "${options[@]}"; do
    printf "    %s%d)%s %s\n" "${CYAN}" "${i}" "${RESET}" "${opt}" >"${_OUT}"
    i=$(( i + 1 ))
  done
  printf "\n    %sChoice [1]%s: " "${BOLD}" "${RESET}" >"${_OUT}"
  read -r choice </dev/tty
  echo "${choice:-1}"
}

# ──────────────────────────────────────────────
# INTERACTIVE WIZARD
# ──────────────────────────────────────────────
run_wizard() {
  printf "\n" >"${_OUT}"
  printf "  %s+==========================================+%s\n" "${BOLD}${CYAN}" "${RESET}" >"${_OUT}"
  printf "  %s|  Luqen LLM Module -- Installation Wizard  |%s\n" "${BOLD}${CYAN}" "${RESET}" >"${_OUT}"
  printf "  %s+==========================================+%s\n" "${BOLD}${CYAN}" "${RESET}" >"${_OUT}"
  printf "\n  AI-powered accessibility capabilities for the Luqen platform\n" >"${_OUT}"

  # ── 1: LLM Provider ────────────────────────
  header "1. LLM Provider"
  printf "  Choose the LLM provider to use for AI capabilities.\n\n" >"${_OUT}"

  local provider_choice
  provider_choice=$(ask_choice "Provider type:" \
    "Ollama (local, free — recommended for self-hosted)" \
    "OpenAI (cloud, requires API key)")

  case "${provider_choice}" in
    2)
      PROVIDER_TYPE="openai"
      PROVIDER_URL="https://api.openai.com/v1"
      PROVIDER_NAME="OpenAI"
      ;;
    *)
      PROVIDER_TYPE="ollama"
      PROVIDER_URL="http://localhost:11434"
      PROVIDER_NAME="Local Ollama"
      ;;
  esac

  ask "Provider URL" "${PROVIDER_URL}" PROVIDER_URL
  ask "Provider name" "${PROVIDER_NAME}" PROVIDER_NAME

  # Test connectivity for Ollama
  if [ "${PROVIDER_TYPE}" = "ollama" ]; then
    printf "\n" >"${_OUT}"
    if curl -sf --max-time 5 "${PROVIDER_URL}/api/tags" >/dev/null 2>&1; then
      success "Ollama is reachable at ${PROVIDER_URL}"
    else
      warn "Could not reach Ollama at ${PROVIDER_URL}"
      info "Continuing anyway — you can configure this later from Admin → LLM"
    fi
  fi

  # ── 2: Model ────────────────────────────────
  header "2. Model"
  local default_model="llama3.2"
  [ "${PROVIDER_TYPE}" = "openai" ] && default_model="gpt-4o-mini"
  ask "Model name" "${default_model}" MODEL_NAME

  # ── 3: OAuth Client ─────────────────────────
  header "3. OAuth Client"
  printf "  Which service will call the LLM module?\n" >"${_OUT}"
  printf "  %s(e.g. dashboard, compliance, both)%s\n\n" "${DIM}" "${RESET}" >"${_OUT}"
  ask "Client name" "${CLIENT_NAME}" CLIENT_NAME
  ask "Client scopes" "${CLIENT_SCOPES}" CLIENT_SCOPES

  # ── 4: Summary + confirm ────────────────────
  header "4. Summary"
  printf "  Provider:  %s%s%s (%s)\n" "${BOLD}" "${PROVIDER_NAME}" "${RESET}" "${PROVIDER_TYPE}" >"${_OUT}"
  printf "  URL:       %s\n" "${PROVIDER_URL}" >"${_OUT}"
  printf "  Model:     %s\n" "${MODEL_NAME}" >"${_OUT}"
  printf "  Client:    %s (%s)\n" "${CLIENT_NAME}" "${CLIENT_SCOPES}" >"${_OUT}"
  printf "  Port:      %s\n\n" "${LLM_PORT}" >"${_OUT}"

  if ! ask_yn "Proceed with installation?" "y"; then
    info "Installation cancelled."
    exit 0
  fi
}

# ──────────────────────────────────────────────
# INSTALL
# ──────────────────────────────────────────────
run_install() {
  local TOTAL_STEPS=5

  # ── Step 1: Prerequisites ───────────────────
  step 1 ${TOTAL_STEPS} "Checking prerequisites"

  local CLI="${INSTALL_DIR}/dist/cli.js"
  if [ ! -f "${CLI}" ]; then
    error "dist/cli.js not found in ${INSTALL_DIR}"
    error "Please build the package first:  npm run build -w packages/llm"
    exit 1
  fi

  if ! (cd "${INSTALL_DIR}" && node dist/cli.js --version) >/dev/null 2>&1; then
    error "node dist/cli.js --version failed — package may not be built correctly"
    exit 1
  fi

  success "LLM package is built and runnable"

  # ── Step 2: JWT keys ────────────────────────
  step 2 ${TOTAL_STEPS} "Generating JWT keys"

  local KEYS_DIR="${INSTALL_DIR}/keys"
  if [ -f "${KEYS_DIR}/private.pem" ]; then
    info "JWT keys already exist -- reusing"
  else
    mkdir -p "${KEYS_DIR}"
    (cd "${INSTALL_DIR}" && node dist/cli.js keys generate) >/dev/null 2>&1
    success "RS256 JWT key pair generated"
  fi

  # ── Step 3: OAuth client ────────────────────
  step 3 ${TOTAL_STEPS} "Creating OAuth client"

  local CLIENT_CACHE="${INSTALL_DIR}/.install-llm-client"
  local CLIENT_ID="" CLIENT_SECRET=""

  if [ -f "${CLIENT_CACHE}" ]; then
    info "OAuth client already exists -- reusing"
    CLIENT_ID=$(grep "^client_id=" "${CLIENT_CACHE}" | cut -d= -f2-)
    CLIENT_SECRET=$(grep "^client_secret=" "${CLIENT_CACHE}" | cut -d= -f2-)
  else
    local CLIENT_OUT
    CLIENT_OUT=$(cd "${INSTALL_DIR}" && node dist/cli.js clients create \
      --name "${CLIENT_NAME}" --scopes "${CLIENT_SCOPES}" 2>&1)
    CLIENT_ID=$(echo "${CLIENT_OUT}" | grep "ID:" | awk '{print $NF}')
    CLIENT_SECRET=$(echo "${CLIENT_OUT}" | grep "Secret:" | awk '{print $NF}')
    if [ -n "${CLIENT_ID}" ] && [ -n "${CLIENT_SECRET}" ]; then
      printf "client_id=%s\nclient_secret=%s\n" "${CLIENT_ID}" "${CLIENT_SECRET}" > "${CLIENT_CACHE}"
      chmod 600 "${CLIENT_CACHE}"
      success "OAuth client '${CLIENT_NAME}' created"
    else
      warn "Could not parse OAuth client output -- configure manually from Admin → LLM"
      CLIENT_ID=""
      CLIENT_SECRET=""
    fi
  fi

  # ── Step 4: Provider + model + capabilities ─
  step 4 ${TOTAL_STEPS} "Registering provider and model"

  local PROVIDER_CACHE="${INSTALL_DIR}/.install-llm-provider"
  local PROVIDER_ID=""

  if [ -f "${PROVIDER_CACHE}" ]; then
    info "Provider already registered -- reusing"
    PROVIDER_ID=$(cat "${PROVIDER_CACHE}")
  else
    local PROVIDER_OUT
    PROVIDER_OUT=$(cd "${INSTALL_DIR}" && node dist/cli.js providers create \
      --name "${PROVIDER_NAME}" --type "${PROVIDER_TYPE}" --url "${PROVIDER_URL}" 2>&1)
    PROVIDER_ID=$(echo "${PROVIDER_OUT}" | node -e \
      "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).id)}catch{}})")
    if [ -n "${PROVIDER_ID}" ]; then
      echo "${PROVIDER_ID}" > "${PROVIDER_CACHE}"
      chmod 600 "${PROVIDER_CACHE}"
      success "Provider '${PROVIDER_NAME}' registered (id: ${PROVIDER_ID})"
    else
      warn "Could not register provider -- configure manually from Admin → LLM"
      PROVIDER_ID=""
    fi
  fi

  local MODEL_CACHE="${INSTALL_DIR}/.install-llm-model"
  local MODEL_ID=""

  if [ -f "${MODEL_CACHE}" ]; then
    info "Model already registered -- reusing"
    MODEL_ID=$(cat "${MODEL_CACHE}")
  elif [ -n "${PROVIDER_ID}" ]; then
    local MODEL_OUT
    MODEL_OUT=$(cd "${INSTALL_DIR}" && node dist/cli.js models register \
      --name "${MODEL_NAME}" --provider-id "${PROVIDER_ID}" 2>&1)
    MODEL_ID=$(echo "${MODEL_OUT}" | node -e \
      "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).id)}catch{}})")
    if [ -n "${MODEL_ID}" ]; then
      echo "${MODEL_ID}" > "${MODEL_CACHE}"
      chmod 600 "${MODEL_CACHE}"
      success "Model '${MODEL_NAME}' registered (id: ${MODEL_ID})"
      # Assign to all 4 capabilities
      for cap in extract-requirements generate-fix analyse-report discover-branding; do
        if (cd "${INSTALL_DIR}" && node dist/cli.js capabilities assign \
            --capability "${cap}" --model-id "${MODEL_ID}") >/dev/null 2>&1; then
          success "  ${cap} --> ${MODEL_NAME}"
        else
          warn "  Could not assign ${cap} -- configure manually from Admin → LLM"
        fi
      done
    else
      warn "Could not register model -- configure manually from Admin → LLM"
    fi
  else
    warn "Skipping model registration (no provider ID available)"
  fi

  # ── Step 5: Summary ──────────────────────────
  step 5 ${TOTAL_STEPS} "Installation complete"

  printf "\n" >"${_OUT}"
  printf "  %s+------------------------------------------+%s\n" "${BOLD}${CYAN}" "${RESET}" >"${_OUT}"
  printf "  %s  Luqen LLM Module -- Installation Summary  %s\n" "${BOLD}${CYAN}" "${RESET}" >"${_OUT}"
  printf "  %s+------------------------------------------+%s\n\n" "${BOLD}${CYAN}" "${RESET}" >"${_OUT}"

  if [ -n "${CLIENT_ID}" ] && [ -n "${CLIENT_SECRET}" ]; then
    printf "  %sOAuth Client%s\n" "${BOLD}" "${RESET}" >"${_OUT}"
    printf "    ID:      %s\n" "${CLIENT_ID}" >"${_OUT}"
    printf "    Secret:  %s%s%s   (keep safe -- not shown again)\n\n" \
      "${YELLOW}" "${CLIENT_SECRET}" "${RESET}" >"${_OUT}"

    printf "  %sAdd to dashboard.config.json:%s\n" "${BOLD}" "${RESET}" >"${_OUT}"
    printf "    %s\"llm\": {%s\n" "${DIM}" "${RESET}" >"${_OUT}"
    printf "      \"url\": \"http://localhost:%s\",\n" "${LLM_PORT}" >"${_OUT}"
    printf "      \"clientId\": \"%s\",\n" "${CLIENT_ID}" >"${_OUT}"
    printf "      \"clientSecret\": \"%s\"\n" "${CLIENT_SECRET}" >"${_OUT}"
    printf "    %s}%s\n\n" "${DIM}" "${RESET}" >"${_OUT}"
  else
    warn "OAuth client credentials not available -- configure manually"
    printf "\n" >"${_OUT}"
  fi

  if [ -n "${PROVIDER_ID}" ] && [ -n "${MODEL_ID}" ]; then
    printf "  %sLLM Configuration%s\n" "${BOLD}" "${RESET}" >"${_OUT}"
    printf "    Provider: %s (%s)\n" "${PROVIDER_NAME}" "${PROVIDER_TYPE}" >"${_OUT}"
    printf "    Model:    %s\n" "${MODEL_NAME}" >"${_OUT}"
    printf "    Capabilities assigned: extract-requirements, generate-fix,\n" >"${_OUT}"
    printf "                           analyse-report, discover-branding\n\n" >"${_OUT}"
  fi

  printf "  %sStart the service:%s\n" "${BOLD}" "${RESET}" >"${_OUT}"
  printf "    cd %s && node dist/cli.js serve --port %s\n\n" "${INSTALL_DIR}" "${LLM_PORT}" >"${_OUT}"

  success "LLM module installation complete"
}

# ──────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────
$INTERACTIVE && run_wizard
run_install
