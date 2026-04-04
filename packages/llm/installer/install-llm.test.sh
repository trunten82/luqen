#!/usr/bin/env bash
# install-llm.test.sh — test harness for install-llm.sh
# Tests flag parsing, defaults, non-interactive mode, and idempotency guards.
# Uses temp directories and PATH-based node mock — no real CLI execution.
#
# Usage:  bash packages/llm/installer/install-llm.test.sh

set -euo pipefail

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf "  ok: %s\n" "$1"; }
fail() { FAIL=$((FAIL+1)); printf "  FAIL: %s\n" "$1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="${SCRIPT_DIR}/install-llm.sh"

# ── Helpers ───────────────────────────────────────────────────────────────────

# Create a temp dir with a mock node binary that simulates the CLI.
# The mock node responds to all installer commands correctly.
make_mock_dir() {
  local dir
  dir="$(mktemp -d)"
  mkdir -p "${dir}/bin" "${dir}/dist" "${dir}/keys"

  # Stub dist/cli.js so the prerequisite check passes
  printf '#!/usr/bin/env node\nconsole.log("0.0.0-test");\n' > "${dir}/dist/cli.js"

  # Mock node binary
  cat > "${dir}/bin/node" <<'EOF'
#!/usr/bin/env bash
# Mock node for install-llm.sh tests
args=("$@")
cmd="${args[*]}"

case "${cmd}" in
  *"--version"*)
    echo "0.0.0-test"
    exit 0
    ;;
  *"keys generate"*)
    exit 0
    ;;
  *"clients create"*)
    echo "Client created:"
    echo "  ID:     mock-client-id"
    echo "  Secret: mock-secret-xyz"
    exit 0
    ;;
  *"providers create"*)
    echo '{"id":"mock-provider-1","name":"Mock","type":"ollama","baseUrl":"http://localhost:11434","status":"active","timeout":30000,"createdAt":"2025-01-01","updatedAt":"2025-01-01"}'
    exit 0
    ;;
  *"models register"*)
    echo '{"id":"mock-model-1","providerId":"mock-provider-1","modelId":"llama3.2","displayName":"llama3.2","status":"active","capabilities":[],"createdAt":"2025-01-01"}'
    exit 0
    ;;
  *"capabilities assign"*)
    echo "Assigned capability"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
EOF
  chmod +x "${dir}/bin/node"
  echo "${dir}"
}

# Run the installer with a given mock dir as INSTALL_DIR, using the mock node.
# Additional args are passed to the installer.
run_installer() {
  local mock_dir="$1"; shift
  local installer_args=("$@")
  # Prepend mock node to PATH and set INSTALL_DIR env
  env PATH="${mock_dir}/bin:${PATH}" \
    LUQEN_LLM_INSTALL_REEXEC=1 \
    bash "${INSTALLER}" --non-interactive "${installer_args[@]}" 2>&1 || true
}

printf "\nRunning install-llm.sh tests\n\n"

# ──────────────────────────────────────────────────────────────────────────────
# T01: --help exits 0
# ──────────────────────────────────────────────────────────────────────────────
if bash "${INSTALLER}" --help >/dev/null 2>&1; then
  ok "T01: --help exits 0"
else
  fail "T01: --help exits 0"
fi

# ──────────────────────────────────────────────────────────────────────────────
# T02: bash -n syntax check
# ──────────────────────────────────────────────────────────────────────────────
if bash -n "${INSTALLER}" 2>/dev/null; then
  ok "T02: syntax valid"
else
  fail "T02: syntax valid"
fi

# ──────────────────────────────────────────────────────────────────────────────
# T03: --non-interactive sets INTERACTIVE=false and skips wizard
# We confirm wizard is NOT invoked by checking that no interactive prompts appear.
# The wizard normally asks for Provider URL, Model name, etc. — none should appear.
# ──────────────────────────────────────────────────────────────────────────────
T03_DIR="$(make_mock_dir)"
T03_OUT=$(env PATH="${T03_DIR}/bin:${PATH}" \
  LUQEN_LLM_INSTALL_REEXEC=1 \
  LUQEN_LLM_INSTALL_DIR="${T03_DIR}" \
  bash "${INSTALLER}" --non-interactive 2>&1 || true)

# Wizard asks "Provider URL", "Model name" etc — none should appear
if echo "${T03_OUT}" | grep -iq "Provider URL\|Model name\|Client name"; then
  fail "T03: --non-interactive should skip wizard (wizard output detected)"
else
  ok "T03: --non-interactive skips wizard"
fi
rm -rf "${T03_DIR}"

# ──────────────────────────────────────────────────────────────────────────────
# T04: --port sets LLM_PORT (verifiable via the summary block)
# ──────────────────────────────────────────────────────────────────────────────
T04_DIR="$(make_mock_dir)"
T04_OUT=$(env PATH="${T04_DIR}/bin:${PATH}" \
  LUQEN_LLM_INSTALL_REEXEC=1 \
  LUQEN_LLM_INSTALL_DIR="${T04_DIR}" \
  bash "${INSTALLER}" --non-interactive --port 4299 2>&1 || true)

if echo "${T04_OUT}" | grep -q "4299"; then
  ok "T04: --port sets LLM_PORT"
else
  fail "T04: --port sets LLM_PORT (output: ${T04_OUT})"
fi
rm -rf "${T04_DIR}"

# ──────────────────────────────────────────────────────────────────────────────
# T05: --provider-type openai sets PROVIDER_TYPE
# We verify by checking the node args for the providers create call.
# ──────────────────────────────────────────────────────────────────────────────
T05_DIR="$(make_mock_dir)"
T05_LOGFILE="${T05_DIR}/cmd.log"
# Override mock node to log the providers create command to a file
cat > "${T05_DIR}/bin/node" <<EOF
#!/usr/bin/env bash
args=("\$@")
cmd="\${args[*]}"
case "\${cmd}" in
  *"--version"*)
    echo "0.0.0-test"; exit 0 ;;
  *"keys generate"*)
    exit 0 ;;
  *"clients create"*)
    echo "Client created:"; echo "  ID:     x"; echo "  Secret: y"; exit 0 ;;
  *"providers create"*)
    # Log args to file so test can verify --type openai was passed
    echo "\${cmd}" >> "${T05_LOGFILE}"
    echo '{"id":"p1","name":"t","type":"openai","baseUrl":"x","status":"active","timeout":30000,"createdAt":"2025","updatedAt":"2025"}'
    exit 0 ;;
  *"models register"*)
    echo '{"id":"m1","providerId":"p1","modelId":"t","displayName":"t","status":"active","capabilities":[],"createdAt":"2025"}'
    exit 0 ;;
  *"capabilities assign"*)
    exit 0 ;;
  *)
    exit 0 ;;
esac
EOF
chmod +x "${T05_DIR}/bin/node"

env PATH="${T05_DIR}/bin:${PATH}" \
  LUQEN_LLM_INSTALL_REEXEC=1 \
  LUQEN_LLM_INSTALL_DIR="${T05_DIR}" \
  bash "${INSTALLER}" --non-interactive --provider-type openai >/dev/null 2>&1 || true

if [ -f "${T05_LOGFILE}" ] && grep -iq "openai" "${T05_LOGFILE}"; then
  ok "T05: --provider-type sets PROVIDER_TYPE"
else
  fail "T05: --provider-type sets PROVIDER_TYPE (log: $(cat "${T05_LOGFILE}" 2>/dev/null || echo 'empty'))"
fi
rm -rf "${T05_DIR}"

# ──────────────────────────────────────────────────────────────────────────────
# T06: Idempotency — existing keys skipped
# Create keys/private.pem and verify "already exist" message appears.
# ──────────────────────────────────────────────────────────────────────────────
T06_DIR="$(make_mock_dir)"
touch "${T06_DIR}/keys/private.pem"  # Simulate pre-existing keys

# Override mock to fail if keys generate is called
cat > "${T06_DIR}/bin/node" <<'EOF'
#!/usr/bin/env bash
args=("$@")
cmd="${args[*]}"
case "${cmd}" in
  *"--version"*)
    echo "0.0.0-test"; exit 0 ;;
  *"keys generate"*)
    echo "ERROR: keys generate should be skipped!" >&2; exit 1 ;;
  *"clients create"*)
    echo "Client created:"; echo "  ID:     x"; echo "  Secret: y"; exit 0 ;;
  *"providers create"*)
    echo '{"id":"p1","name":"t","type":"ollama","baseUrl":"x","status":"active","timeout":30000,"createdAt":"2025","updatedAt":"2025"}'; exit 0 ;;
  *"models register"*)
    echo '{"id":"m1","providerId":"p1","modelId":"t","displayName":"t","status":"active","capabilities":[],"createdAt":"2025"}'; exit 0 ;;
  *"capabilities assign"*)
    exit 0 ;;
  *)
    exit 0 ;;
esac
EOF
chmod +x "${T06_DIR}/bin/node"

T06_OUT=$(env PATH="${T06_DIR}/bin:${PATH}" \
  LUQEN_LLM_INSTALL_REEXEC=1 \
  LUQEN_LLM_INSTALL_DIR="${T06_DIR}" \
  bash "${INSTALLER}" --non-interactive 2>&1 || true)

if echo "${T06_OUT}" | grep -iq "already exist"; then
  ok "T06: Idempotency -- existing keys skipped"
else
  fail "T06: Idempotency -- existing keys skipped (output: ${T06_OUT})"
fi
rm -rf "${T06_DIR}"

# ──────────────────────────────────────────────────────────────────────────────
# T07: Idempotency — existing client cache skipped
# Create .install-llm-client cache file and verify "already exists" appears.
# ──────────────────────────────────────────────────────────────────────────────
T07_DIR="$(make_mock_dir)"
touch "${T07_DIR}/keys/private.pem"
printf "client_id=cached-id\nclient_secret=cached-secret\n" > "${T07_DIR}/.install-llm-client"

# Override mock to fail if clients create is called
cat > "${T07_DIR}/bin/node" <<'EOF'
#!/usr/bin/env bash
args=("$@")
cmd="${args[*]}"
case "${cmd}" in
  *"--version"*)
    echo "0.0.0-test"; exit 0 ;;
  *"keys generate"*)
    exit 0 ;;
  *"clients create"*)
    echo "ERROR: clients create should be skipped!" >&2; exit 1 ;;
  *"providers create"*)
    echo '{"id":"p1","name":"t","type":"ollama","baseUrl":"x","status":"active","timeout":30000,"createdAt":"2025","updatedAt":"2025"}'; exit 0 ;;
  *"models register"*)
    echo '{"id":"m1","providerId":"p1","modelId":"t","displayName":"t","status":"active","capabilities":[],"createdAt":"2025"}'; exit 0 ;;
  *"capabilities assign"*)
    exit 0 ;;
  *)
    exit 0 ;;
esac
EOF
chmod +x "${T07_DIR}/bin/node"

T07_OUT=$(env PATH="${T07_DIR}/bin:${PATH}" \
  LUQEN_LLM_INSTALL_REEXEC=1 \
  LUQEN_LLM_INSTALL_DIR="${T07_DIR}" \
  bash "${INSTALLER}" --non-interactive 2>&1 || true)

if echo "${T07_OUT}" | grep -iq "already exist"; then
  ok "T07: Idempotency -- existing client cache skipped"
else
  fail "T07: Idempotency -- existing client cache skipped (output: ${T07_OUT})"
fi
rm -rf "${T07_DIR}"

# ──────────────────────────────────────────────────────────────────────────────
# T08: Unknown flag exits non-zero
# ──────────────────────────────────────────────────────────────────────────────
if bash "${INSTALLER}" --unknown-flag >/dev/null 2>&1; then
  fail "T08: unknown flag should exit non-zero"
else
  ok "T08: unknown flag exits non-zero"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────────────────
printf "\n%d passed, %d failed\n" ${PASS} ${FAIL}
[ ${FAIL} -eq 0 ] || exit 1
