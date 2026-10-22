#!/usr/bin/env bash
# compare-trusted-proxies.test.sh -- named-case tests for scripts/compare-trusted-proxies.sh.
#
# Usage:
#   bash scripts/compare-trusted-proxies.test.sh                 run every case
#   bash scripts/compare-trusted-proxies.test.sh NAME [NAME...]  run only the named cases
#
# An unknown NAME prints "no case named NAME" and exits 3, so a mistyped
# isolation run cannot pass. The repo-untouched case always runs last.
#
# Result lines:  ok: NAME | FAIL: NAME: reason
# Final line:    passed N failed M
# Exit status:   1 when any case failed, 3 for an unknown case name.
#
# Every case builds a fixture under a mktemp -d root: a fragment unit, a drop-in,
# a fake process environment, an install dir whose `packages` and `install.sh`
# are symlinks to this checkout, and a recording systemctl stub. The script under
# test is pointed at them with --systemctl and --proc-root. Nothing touches a real
# unit or process. The fixture holds a CANARY secret and fixture addresses; the
# cases assert none of them reaches the output. Build first:
#   npm run build -w packages/dashboard

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${LUQEN_COMPARE_SH:-${REPO_ROOT}/scripts/compare-trusted-proxies.sh}"

PASS=0; FAILED=0

ok()   { PASS=$((PASS + 1)); printf 'ok: %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf 'FAIL: %s: %s\n' "$1" "$2"; }

die() { printf '%s\n' "$*" >&2; exit 1; }

assert_eq() {
  local label="$1" actual="$2" expected="$3"
  [ "${actual}" = "${expected}" ] || die "${label}: expected [${expected}] but got [${actual}]"
}

# assert_line <label> <exact line> -- the output holds this whole line
assert_line() {
  grep -qxF -- "$2" "${OUTD}/out" || die "$1: no line [$2] in the output: $(tr '\n' '|' < "${OUTD}/out")"
}

# assert_match <label> <extended regex> -- some output line matches
assert_match() {
  grep -qE -- "$2" "${OUTD}/out" || die "$1: no line matches [$2] in the output: $(tr '\n' '|' < "${OUTD}/out")"
}

# assert_absent <label> <literal> -- the output holds the text nowhere
assert_absent() {
  if grep -qF -- "$2" "${OUTD}/out"; then
    die "$1: the output contains [$2]"
  fi
}

sha() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

# ── Fixture ──────────────────────────────────────────────────────────────────

# TD   the fixture the script may read (and must not change)
# OUTD where the test keeps its own captured output and the systemctl log
# CANARY a unique secret planted in the fragment, the process environment and
#        the stub's Environment answer
new_fixture() {
  TD="$(mktemp -d)"; OUTD="$(mktemp -d)"
  trap 'rm -rf "${TD}" "${OUTD}"' EXIT
  CANARY="CANARYSECRET$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  mkdir -p "${TD}/units" "${TD}/units/luqen-dashboard.service.d" "${TD}/proc/4242" \
           "${TD}/install" "${TD}/bin" "${TD}/tmp" "${TD}/home"
  ln -s "${REPO_ROOT}/packages" "${TD}/install/packages"
  ln -s "${REPO_ROOT}/install.sh" "${TD}/install/install.sh"
  cat > "${TD}/units/luqen-dashboard.service" <<UNIT
[Unit]
Description=Luqen Dashboard

[Service]
Type=simple
WorkingDirectory=${TD}/install
Environment=NODE_ENV=production
Environment=DASHBOARD_SESSION_SECRET=${CANARY}
ExecStart=/usr/bin/node cli.js serve
UNIT
  printf '4242\n' > "${TD}/mainpid"
  printf 'no\n' > "${TD}/needreload"
  : > "${TD}/envfiles"
  export STUB_LOG="${OUTD}/systemctl.log"
  : > "${STUB_LOG}"
  write_stub
}

# The recording stub. It logs every -p property it is asked for. For
# `Environment` (or no -p at all, or `cat`) it answers with the canary, so a
# script that printed the answer would show it.
write_stub() {
  cat > "${TD}/bin/systemctl" <<'STUB'
#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
canary_answer() { printf 'Environment=DASHBOARD_SESSION_SECRET=%s\n' "$(grep -o 'CANARYSECRET[0-9a-f]*' "${ROOT}/units/luqen-dashboard.service" | head -n 1)"; }
if [ "${1:-}" != "show" ]; then
  printf 'NOT-SHOW:%s\n' "$*" >> "${STUB_LOG}"
  canary_answer
  exit 0
fi
props=""
prev=""
for a in "$@"; do
  [ "${prev}" = "-p" ] && props="${a}"
  prev="${a}"
done
if [ -z "${props}" ]; then
  printf 'ALL-PROPERTIES\n' >> "${STUB_LOG}"
  canary_answer
  exit 0
fi
IFS=, read -ra list <<<"${props}"
for p in "${list[@]}"; do
  printf '%s\n' "${p}" >> "${STUB_LOG}"
  case "${p}" in
    FragmentPath)      printf '%s\n' "${ROOT}/units/luqen-dashboard.service" ;;
    DropInPaths)       find "${ROOT}/units/luqen-dashboard.service.d" -name '*.conf' | sort | tr '\n' ' ' | sed 's/ $//'; printf '\n' ;;
    EnvironmentFiles)  cat "${ROOT}/envfiles" ;;
    MainPID)           cat "${ROOT}/mainpid" ;;
    WorkingDirectory)  printf '%s\n' "${ROOT}/install" ;;
    NeedDaemonReload)  cat "${ROOT}/needreload" ;;
    Environment)       canary_answer ;;
    *)                 printf 'UNKNOWN\n' ;;
  esac
done
STUB
  chmod +x "${TD}/bin/systemctl"
}

# write_dropin <whole line>
write_dropin() {
  printf '[Service]\n%s\n' "$1" > "${TD}/units/luqen-dashboard.service.d/trusted-proxies.conf"
}

# write_environ [value] -- NUL-separated process environment; with no argument the
# variable is absent from it.
write_environ() {
  {
    printf 'NODE_ENV=production\0'
    printf 'DASHBOARD_SESSION_SECRET=%s\0' "${CANARY}"
    if [ "$#" -gt 0 ]; then printf 'DASHBOARD_TRUSTED_PROXIES=%s\0' "$1"; fi
  } > "${TD}/proc/4242/environ"
}

# run_compare [extra args] -- sets RC, keeps combined output in ${OUTD}/out
run_compare() {
  set +e
  env HOME="${TD}/home" TMPDIR="${TD}/tmp" STUB_LOG="${STUB_LOG}" \
    bash "${SCRIPT}" --systemctl "${TD}/bin/systemctl" --proc-root "${TD}/proc" "$@" \
    > "${OUTD}/out" 2>&1
  RC=$?
  set -e
}

# ── Cases ────────────────────────────────────────────────────────────────────

CASES=()
define() { CASES+=("$1"); }

VALUE='192.0.2.10,198.51.100.0/24'
DROPIN_LINE="Environment=DASHBOARD_TRUSTED_PROXIES=${VALUE}"

define compare-reports-location-and-hashes
case_compare_reports_location_and_hashes() {
  local h lh dropin
  new_fixture; write_dropin "${DROPIN_LINE}"; write_environ "${VALUE}"
  dropin="${TD}/units/luqen-dashboard.service.d/trusted-proxies.conf"
  h="$(sha "${VALUE}")"; lh="$(sha "${DROPIN_LINE}")"
  run_compare
  assert_eq "exit status" "${RC}" "0"
  assert_match "fragment line" "^file=.*luqen-dashboard\.service role=fragment environment_lines=2 trusted_proxies_lines=0 simple_form_lines=0$"
  assert_match "drop-in line" "^file=.*trusted-proxies\.conf role=dropin environment_lines=1 trusted_proxies_lines=1 simple_form_lines=1$"
  assert_line "file line hash" "file=${dropin} file_line_sha256=${lh}"
  assert_line "running" "running=present"
  assert_line "running hash" "running_sha256=${h}"
  assert_line "validator" "validator=accepted"
  assert_line "installer value hash" "installer_value_sha256=${h}"
  assert_line "installer line hash" "installer_line_sha256=${lh}"
  assert_line "value equality" "running_equals_installer_value=yes"
  assert_line "semantic equality" "running_semantically_equal=yes"
  assert_line "file line equality" "file=${dropin} file_line_equals_installer_line=yes"
  assert_line "writes to" "installer_writes_to=fragment"
  assert_line "configured in" "configured_in=${dropin}"
  assert_line "location differs" "location_differs=yes"
  assert_line "one place" "set_in_more_than_one_place=no"
  assert_line "daemon reload" "need_daemon_reload=no"
  assert_eq "last line" "$(tail -n 1 "${OUTD}/out")" "result=compared"
}

define compare-prints-no-value
case_compare_prints_no_value() {
  local needle
  new_fixture; write_dropin "${DROPIN_LINE}"; write_environ "${VALUE}"
  run_compare
  assert_eq "exit status" "${RC}" "0"
  for needle in "${CANARY}" 192.0.2.10 198.51.100 192.0.2 '2001:db8' "${VALUE}" 'DASHBOARD_SESSION_SECRET='; do
    assert_absent "output" "${needle}"
  done
}

define compare-never-asks-for-unit-environment
case_compare_never_asks_for_unit_environment() {
  local props
  new_fixture; write_dropin "${DROPIN_LINE}"; write_environ "${VALUE}"
  run_compare
  assert_eq "exit status" "${RC}" "0"
  props="$(tr '\n' ' ' < "${STUB_LOG}")"
  [ -s "${STUB_LOG}" ] || die "the stub log is empty, so the script never called systemctl and this case measures nothing"
  # Exact-line comparison: EnvironmentFiles is allowed, Environment itself is not.
  if grep -qxE 'Environment|ALL-PROPERTIES|NOT-SHOW:.*' "${STUB_LOG}"; then
    die "systemctl was asked for the unit's environment; it was asked for: ${props}"
  fi
  assert_absent "output" "${CANARY}"
}

define compare-refused-value-message-suppressed
case_compare_refused_value_message_suppressed() {
  new_fixture; write_dropin "Environment=DASHBOARD_TRUSTED_PROXIES=0.0.0.0/0"; write_environ "0.0.0.0/0"
  run_compare
  assert_eq "exit status" "${RC}" "0"
  assert_line "validator" "validator=refused"
  assert_absent "output" "0.0.0.0/0"
  assert_absent "output" "Invalid trustedProxies"
  assert_absent "output" "trustedProxies"
  assert_eq "last line" "$(tail -n 1 "${OUTD}/out")" "result=compared"
}

define compare-spaced-value-semantic-equal
case_compare_spaced_value_semantic_equal() {
  new_fixture; write_dropin "Environment=DASHBOARD_TRUSTED_PROXIES=192.0.2.10,198.51.100.0/24"
  write_environ "192.0.2.10, 198.51.100.0/24"
  run_compare
  assert_eq "exit status" "${RC}" "0"
  assert_line "validator" "validator=accepted"
  assert_line "value equality" "running_equals_installer_value=no"
  assert_line "semantic equality" "running_semantically_equal=yes"
  assert_line "running hash" "running_sha256=$(sha '192.0.2.10, 198.51.100.0/24')"
  assert_absent "output" "192.0.2.10"
  assert_absent "output" "198.51.100"
}

define compare-absent-value
case_compare_absent_value() {
  new_fixture; write_environ
  run_compare
  assert_eq "exit status" "${RC}" "0"
  assert_line "running" "running=absent"
  assert_line "installer value" "installer_would_write=nothing"
  assert_line "location differs" "location_differs=no"
  assert_line "configured in" "configured_in=none"
  assert_eq "last line" "$(tail -n 1 "${OUTD}/out")" "result=compared"
}

define compare-envfile-reported
case_compare_envfile_reported() {
  local ef
  new_fixture; write_environ "${VALUE}"
  ef="${TD}/dashboard.env"
  printf 'NODE_ENV=production\nDASHBOARD_TRUSTED_PROXIES=%s\nDASHBOARD_SESSION_SECRET=%s\n' "${VALUE}" "${CANARY}" > "${ef}"
  printf -- '-%s (ignore_errors=yes)\n%s (ignore_errors=no)\n' "${TD}/missing.env" "${ef}" > "${TD}/envfiles"
  run_compare
  assert_eq "exit status" "${RC}" "0"
  assert_line "env file with the setting" "envfile=${ef} trusted_proxies_lines=1"
  assert_line "env file that is not there" "envfile=${TD}/missing.env unreadable"
  assert_line "configured in" "configured_in=${ef}"
  assert_line "location differs" "location_differs=yes"
  assert_absent "output" "${CANARY}"
  assert_absent "output" "192.0.2.10"
}

define compare-set-in-two-places
case_compare_set_in_two_places() {
  local ef
  new_fixture; write_dropin "${DROPIN_LINE}"; write_environ "${VALUE}"
  ef="${TD}/dashboard.env"
  printf 'DASHBOARD_TRUSTED_PROXIES=%s\n' "${VALUE}" > "${ef}"
  printf '%s (ignore_errors=no)\n' "${ef}" > "${TD}/envfiles"
  run_compare
  assert_eq "exit status" "${RC}" "0"
  assert_line "one place" "set_in_more_than_one_place=yes"
}

define compare-writes-nothing
case_compare_writes_nothing() {
  local before after git_before git_after tmp_listing
  new_fixture; write_dropin "${DROPIN_LINE}"; write_environ "${VALUE}"
  listing() { (cd "${TD}" && find . -printf '%p %s %T@\n' | sort); }
  before="$(listing)"
  git_before="$(git -C "${REPO_ROOT}" status --porcelain -- . ':(exclude).planning' | sha256sum)"
  run_compare
  assert_eq "exit status" "${RC}" "0"
  after="$(listing)"
  git_after="$(git -C "${REPO_ROOT}" status --porcelain -- . ':(exclude).planning' | sha256sum)"
  assert_eq "fixture listing (paths, sizes, mtimes)" "${after}" "${before}"
  tmp_listing="$(ls -A "${TD}/tmp")"
  assert_eq "TMPDIR given to the script" "${tmp_listing}" ""
  assert_eq "git status of the checkout" "${git_after}" "${git_before}"
}

define compare-missing-environ-exits-69
case_compare_missing_environ_exits_69() {
  new_fixture; write_dropin "${DROPIN_LINE}"
  rm -f "${TD}/proc/4242/environ"
  run_compare
  assert_eq "exit status" "${RC}" "69"
  assert_match "reason" "cannot read the dashboard process environment"
  assert_eq "lines printed" "$(wc -l < "${OUTD}/out" | tr -d ' ')" "1"
  assert_absent "output" "file="
  assert_absent "output" "result="
}

define compare-old-installer-exits-69
case_compare_old_installer_exits_69() {
  new_fixture; write_dropin "${DROPIN_LINE}"; write_environ "${VALUE}"
  rm -f "${TD}/install/install.sh"
  # An installer from before the trusted-proxy check, with no source mode. If the
  # script sourced it, it would run: the marker file proves it did not.
  printf '#!/usr/bin/env bash\ntouch "%s/installer-ran"\necho running-the-old-installer\n' "${OUTD}" > "${TD}/install/install.sh"
  run_compare
  assert_eq "exit status" "${RC}" "69"
  assert_match "reason" "install\.sh in .* predates the trusted-proxy check"
  [ ! -e "${OUTD}/installer-ran" ] || die "the old installer was executed"
  assert_absent "output" "result=compared"
}

define compare-unknown-option-exits-2
case_compare_unknown_option_exits_2() {
  new_fixture
  run_compare --no-such-option
  assert_eq "exit status" "${RC}" "2"
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
  assert_eq "checkout snapshot after the run" "$(repo_snapshot)" "${BASELINE_SNAPSHOT}"
}

# ── Runner ───────────────────────────────────────────────────────────────────

run_case() {
  local name="$1" fn="case_${1//-/_}" out rc last
  set +e
  out="$( ( set -euo pipefail; "${fn}" ) 2>&1 )"
  rc=$?
  set -e
  last="$(printf '%s\n' "${out}" | tail -n 1)"
  if [ "${rc}" -eq 0 ]; then
    ok "${name}"
  else
    fail "${name}" "${last}"
    printf '%s\n' "${out}" | sed 's/^/    | /'
  fi
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

  # A stray value in the caller's environment must not leak into the cases.
  unset DASHBOARD_TRUSTED_PROXIES
  BASELINE_SNAPSHOT="$(repo_snapshot)"
  for name in "${selected[@]}"; do
    [ "${name}" = "repo-untouched" ] && continue
    run_case "${name}"
  done
  run_case repo-untouched

  printf 'passed %d failed %d\n' "${PASS}" "${FAILED}"
  [ "${FAILED}" -eq 0 ] || exit 1
}

main "$@"
