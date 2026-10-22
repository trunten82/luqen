#!/usr/bin/env bash
# install.test.sh — named-case tests for install.sh's trusted-proxy handling.
#
# Usage:
#   bash install.test.sh                 run every case
#   bash install.test.sh NAME [NAME...]  run only the named cases (isolation)
#
# An unknown NAME prints "no case named NAME" and exits 3, so a mistyped
# isolation run cannot pass. The repo-untouched case always runs last.
#
# Result lines:  ok: NAME | FAIL: NAME: reason | SKIP: NAME: reason
# Final line:    passed N failed M skipped K
# Exit status:   1 when any case failed, 3 for an unknown case name.
#
# The cases source install.sh with LUQEN_INSTALL_LIB_ONLY=1 and call its own
# functions against a temp install directory that holds a `packages` symlink to
# this checkout, so the installer finds the real built dashboard while every
# write lands in the temp directory. Build first:
#   npm run build -w packages/dashboard
#
# Environment:
#   LUQEN_REQUIRE_SYSTEMD_ANALYZE=1  a missing or blind systemd-analyze FAILs
#   LUQEN_REQUIRE_SCRIPT=1           a missing script(1) FAILs
# Without them those cases SKIP, with the reason on the result line.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_SH="${REPO_ROOT}/install.sh"
DIST="${REPO_ROOT}/packages/dashboard/dist"

PASS=0; FAILED=0; SKIPPED=0

ok()   { PASS=$((PASS + 1)); printf 'ok: %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf 'FAIL: %s: %s\n' "$1" "$2"; }
skip() { SKIPPED=$((SKIPPED + 1)); printf 'SKIP: %s: %s\n' "$1" "$2"; }

# ── Helpers used inside a case (each case runs in its own subshell) ──────────

die() { printf '%s\n' "$*" >&2; exit 1; }

skip_case() { printf '%s\n' "$*" >&2; exit 77; }

assert_eq() {
  local label="$1" actual="$2" expected="$3"
  [ "${actual}" = "${expected}" ] || die "${label}: expected [${expected}] but got [${actual}]"
}

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  case "${haystack}" in
    *"${needle}"*) ;;
    *) die "${label}: output does not contain [${needle}]; it was: ${haystack}" ;;
  esac
}

assert_not_contains() {
  local label="$1" haystack="$2" needle="$3"
  case "${haystack}" in
    *"${needle}"*) die "${label}: output unexpectedly contains [${needle}]; it was: ${haystack}" ;;
    *) ;;
  esac
}

# A temp INSTALL_DIR holding a packages symlink to this checkout. Every write
# the installer functions make lands under $TD.
new_tmp() {
  TD="$(mktemp -d)"
  trap 'rm -rf "${TD}"' EXIT
  mkdir -p "${TD}/install"
  ln -s "${REPO_ROOT}/packages" "${TD}/install/packages"
}

# Sourcing install.sh without its source mode would run the whole installer
# (clone, npm install, systemd units). Refuse instead of sourcing.
require_lib_mode() {
  grep -qE 'if \[ "\$\{LUQEN_INSTALL_LIB_ONLY:-\}" = "1" \]' "${INSTALL_SH}" \
    || die "install.sh has no LUQEN_INSTALL_LIB_ONLY source mode, so this case refuses to source it (sourcing would run the whole installer)"
  export LUQEN_INSTALL_LIB_ONLY=1
}

# Run a command the way the installer runs it (set -e on) and keep its status
# and output. Sets RC and writes the combined output to ${TD}/out.
run_rc() {
  set +e
  ( set -e; "$@" ) >"${TD}/out" 2>&1
  RC=$?
  set -e
}

render_unit_to() {
  local file="$1" node_path
  node_path="$(command -v node)"
  CONFIG_FILE="${TD}/install/dashboard.config.json"
  render_systemd_unit_dashboard >"${file}"
}

count_lines_matching() {
  local pattern="$1" file="$2" n
  n="$(grep -c -- "${pattern}" "${file}" || true)"
  printf '%s' "${n}"
}

# What the built dashboard's code default joins to, read from the dist.
dist_default_list() {
  node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const m = await import(pathToFileURL(process.argv[1]).href);
    process.stdout.write(m.DEFAULT_TRUSTED_PROXIES.join(","));
  ' "${DIST}/auth/trusted-proxies.js"
}

# ── Cases ────────────────────────────────────────────────────────────────────

CASES=()
define_case() { CASES+=("$1"); }

define_case dist-present
case_dist_present() {
  [ -f "${DIST}/config.js" ] && [ -f "${DIST}/auth/trusted-proxies.js" ] \
    || die "the built dashboard is missing; run: npm run build -w packages/dashboard"
}

define_case flag-written-and-read-back
case_flag_written_and_read_back() {
  new_tmp; require_lib_mode
  unset DASHBOARD_TRUSTED_PROXIES
  set --
  . "${INSTALL_SH}" --install-dir "${TD}/install" --trusted-proxies '192.0.2.10, 198.51.100.0/24'
  OUT=/dev/stdout
  validate_trusted_proxies >"${TD}/validate.out"
  render_unit_to "${TD}/unit"
  assert_eq "unit lines naming the variable" "$(count_lines_matching 'DASHBOARD_TRUSTED_PROXIES' "${TD}/unit")" "1"
  assert_eq "the written line" "$(grep -- 'DASHBOARD_TRUSTED_PROXIES' "${TD}/unit")" \
    "Environment=DASHBOARD_TRUSTED_PROXIES=192.0.2.10,198.51.100.0/24"
  assert_eq "read back through the dashboard's resolver" \
    "$(trusted_proxies_readback systemd "${TD}/unit")" "192.0.2.10,198.51.100.0/24"
}

define_case nothing-given-nothing-written
case_nothing_given_nothing_written() {
  new_tmp; require_lib_mode
  unset DASHBOARD_TRUSTED_PROXIES
  set --
  . "${INSTALL_SH}" --install-dir "${TD}/install"
  OUT=/dev/stdout
  validate_trusted_proxies >"${TD}/validate.out"
  render_unit_to "${TD}/unit"
  assert_eq "unit lines naming the variable" "$(count_lines_matching 'DASHBOARD_TRUSTED_PROXIES' "${TD}/unit")" "0"
  local from_dist readback
  from_dist="$(dist_default_list)"
  readback="$(trusted_proxies_readback systemd "${TD}/unit")"
  assert_eq "read-back equals the dist's DEFAULT_TRUSTED_PROXIES" "${readback}" "${from_dist}"
  assert_eq "the dashboard default" "${readback}" "loopback,linklocal,uniquelocal"
}

define_case env-var-input-written
case_env_var_input_written() {
  new_tmp; require_lib_mode
  export DASHBOARD_TRUSTED_PROXIES='198.51.100.7'
  set --
  . "${INSTALL_SH}" --install-dir "${TD}/install"
  OUT=/dev/stdout
  validate_trusted_proxies >"${TD}/validate.out"
  render_unit_to "${TD}/unit"
  assert_eq "the written line" "$(grep -- 'DASHBOARD_TRUSTED_PROXIES' "${TD}/unit")" \
    "Environment=DASHBOARD_TRUSTED_PROXIES=198.51.100.7"
}

define_case flag-beats-env
case_flag_beats_env() {
  new_tmp; require_lib_mode
  export DASHBOARD_TRUSTED_PROXIES='198.51.100.7'
  set --
  . "${INSTALL_SH}" --install-dir "${TD}/install" --trusted-proxies '192.0.2.10'
  OUT=/dev/stdout
  validate_trusted_proxies >"${TD}/validate.out"
  render_unit_to "${TD}/unit"
  assert_eq "the written line" "$(grep -- 'DASHBOARD_TRUSTED_PROXIES' "${TD}/unit")" \
    "Environment=DASHBOARD_TRUSTED_PROXIES=192.0.2.10"
}

# Always runs last, whatever cases were selected: nothing in the checkout may
# differ after the run from before it.
repo_snapshot() {
  {
    git -C "${REPO_ROOT}" status --porcelain -- . ':(exclude).planning'
    git -C "${REPO_ROOT}" diff -- . ':(exclude).planning'
    git -C "${REPO_ROOT}" ls-files -o --exclude-standard -z -- . ':(exclude).planning' \
      | (cd "${REPO_ROOT}" && xargs -0r sha256sum)
  } | sha256sum
}

case_repo_untouched() {
  local after
  after="$(repo_snapshot)"
  assert_eq "checkout snapshot after the run" "${after}" "${BASELINE_SNAPSHOT}"
}

# ── Runner ───────────────────────────────────────────────────────────────────

run_case() {
  local name="$1" fn="case_${1//-/_}" out rc last
  set +e
  out="$( ( set -euo pipefail; "${fn}" ) 2>&1 )"
  rc=$?
  set -e
  last="$(printf '%s\n' "${out}" | tail -n 1)"
  case "${rc}" in
    0)  ok "${name}" ;;
    77) skip "${name}" "${last}" ;;
    *)  fail "${name}" "${last}"
        printf '%s\n' "${out}" | sed 's/^/    | /' ;;
  esac
}

is_known_case() {
  local c
  for c in "${CASES[@]}" repo-untouched; do
    [ "${c}" = "$1" ] && return 0
  done
  return 1
}

main() {
  local selected=() name
  if [ "$#" -gt 0 ]; then selected=("$@"); else selected=("${CASES[@]}"); fi
  for name in "${selected[@]}"; do
    if ! is_known_case "${name}"; then
      printf 'no case named %s\n' "${name}"
      exit 3
    fi
  done

  BASELINE_SNAPSHOT="$(repo_snapshot)"
  for name in "${selected[@]}"; do
    [ "${name}" = "repo-untouched" ] && continue
    run_case "${name}"
  done
  run_case repo-untouched

  printf 'passed %d failed %d skipped %d\n' "${PASS}" "${FAILED}" "${SKIPPED}"
  [ "${FAILED}" -eq 0 ] || exit 1
}

main "$@"
