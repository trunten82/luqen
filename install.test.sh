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
# LUQEN_INSTALL_SH points the cases at another copy of the installer (used to
# record a RED run against an older revision without touching the checkout).
INSTALL_SH="${LUQEN_INSTALL_SH:-${REPO_ROOT}/install.sh}"
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
# A case that loads the installer more than once gets one directory per load;
# all of them are removed when the case exits, not only the last.
TD_ALL=()
new_tmp() {
  TD="$(mktemp -d)"
  TD_ALL+=("${TD}")
  trap 'rm -rf "${TD_ALL[@]}"' EXIT
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
#
# The command runs with OUT=/dev/stdout, and its output is captured through a
# pipe. Pointing the installer's messages at a regular file would not work: each
# message opens /dev/stdout with `>`, which truncates a regular file, so only
# the last message would survive.
run_rc() {
  local captured
  set +e
  captured="$( ( OUT=/dev/stdout; set -e; "$@" ) 2>&1; printf '\nRC=%s' "$?" )"
  set -e
  RC="${captured##*$'\n'RC=}"
  printf '%s' "${captured%$'\n'RC=*}" > "${TD}/out"
}

# source_installer <flags...> -- source install.sh in source mode and parse the
# flags with its own parse_args (source mode parses nothing by itself, WR-03).
# An older revision (LUQEN_INSTALL_SH) without parse_args parsed the flags while
# it was sourced, so the call is skipped there.
source_installer() {
  . "${INSTALL_SH}" "$@"
  if declare -F parse_args >/dev/null; then parse_args "$@"; fi
}

# Source install.sh against the temp install dir with the given extra flags.
# The caller's DASHBOARD_TRUSTED_PROXIES (none, unless the case exports one
# first) is read by the installer's default, as in a real run.
load_installer() {
  new_tmp; require_lib_mode
  # The explicit arguments to `.` replace this function's positional
  # parameters for the sourced file, so install.sh's flag loop reads only them.
  source_installer --install-dir "${TD}/install" "$@"
  OUT=/dev/null   # run_rc and messages_of switch it to a pipe when a case reads messages
}

# The messages a function prints, with OUT pointed at a pipe (see run_rc).
messages_of() {
  ( OUT=/dev/stdout; "$@" ) 2>&1
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
  source_installer --install-dir "${TD}/install" --trusted-proxies '192.0.2.10, 198.51.100.0/24'
  OUT=/dev/null
  validate_trusted_proxies
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
  source_installer --install-dir "${TD}/install"
  OUT=/dev/null
  validate_trusted_proxies
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
  source_installer --install-dir "${TD}/install"
  OUT=/dev/null
  validate_trusted_proxies
  render_unit_to "${TD}/unit"
  assert_eq "the written line" "$(grep -- 'DASHBOARD_TRUSTED_PROXIES' "${TD}/unit")" \
    "Environment=DASHBOARD_TRUSTED_PROXIES=198.51.100.7"
}

define_case flag-beats-env
case_flag_beats_env() {
  new_tmp; require_lib_mode
  export DASHBOARD_TRUSTED_PROXIES='198.51.100.7'
  set --
  source_installer --install-dir "${TD}/install" --trusted-proxies '192.0.2.10'
  OUT=/dev/null
  validate_trusted_proxies
  render_unit_to "${TD}/unit"
  assert_eq "the written line" "$(grep -- 'DASHBOARD_TRUSTED_PROXIES' "${TD}/unit")" \
    "Environment=DASHBOARD_TRUSTED_PROXIES=192.0.2.10"
}

# ── Task 2: refusals, fail-closed, systemd, profile, check mode ──────────────

# Every value in the list must be refused by validate_trusted_proxies with exit
# 1, the dashboard's own phrase, and the installer's "nothing written" line.
assert_refused() {
  local phrase="$1"; shift
  local val
  for val in "$@"; do
    DASHBOARD_TRUSTED_PROXIES="${val}"
    run_rc validate_trusted_proxies
    [ "${RC}" -eq 1 ] || die "value [${val}]: expected exit 1 but got ${RC}; output: $(cat "${TD}/out")"
    assert_contains "value [${val}]" "$(cat "${TD}/out")" "Invalid trustedProxies"
    assert_contains "value [${val}]" "$(cat "${TD}/out")" "${phrase}"
    assert_contains "value [${val}]" "$(cat "${TD}/out")" "Nothing has been written yet"
  done
}

define_case refuse-trust-all-word
case_refuse_trust_all_word() {
  load_installer --trusted-proxies 'true'
  assert_refused "it would trust every forwarded address" 'true' '*'
}

define_case refuse-zero-length-range
case_refuse_zero_length_range() {
  load_installer --trusted-proxies '0.0.0.0/0'
  assert_refused "a range of length 0 would trust every forwarded address" '0.0.0.0/0' '::/0'
}

define_case refuse-hop-count
case_refuse_hop_count() {
  load_installer --trusted-proxies '2'
  assert_refused "hop counts are not accepted" '2'
}

define_case refuse-empty-entry
case_refuse_empty_entry() {
  load_installer --trusted-proxies '192.0.2.10,,198.51.100.1'
  assert_refused "an empty entry" '192.0.2.10,,198.51.100.1'
}

define_case refuse-none-combined
case_refuse_none_combined() {
  load_installer --trusted-proxies 'none,loopback'
  assert_refused "none cannot be combined with other entries" 'none,loopback'
}

define_case refuse-public-v4-ceiling
case_refuse_public_v4_ceiling() {
  load_installer --trusted-proxies '2.0.0.0/7'
  assert_refused "more than one /8 of public IPv4 addresses" '2.0.0.0/7'
}

define_case refuse-global-v6-ceiling
case_refuse_global_v6_ceiling() {
  load_installer --trusted-proxies '2000::/15'
  assert_refused "more than one /16 of global IPv6 addresses" '2000::/15'
}

BARE_METAL_STEPS="resolve_public_url_defaults check_prerequisites clone_or_pull install_and_build generate_secrets seed_data create_oauth_client write_config create_systemd_services start_services_and_post_install show_summary_bare_metal show_v3_whats_new"

# Replace every step except validate_trusted_proxies with a stub that logs its
# name. generate_secrets also records what validate left to write.
stub_bare_metal_steps() {
  STEP_LOG="${TD}/steps.log"; : > "${STEP_LOG}"
  local f
  for f in ${BARE_METAL_STEPS}; do
    eval "${f}() { printf '%s\\n' ${f} >> \"\${STEP_LOG}\"; }"
  done
  generate_secrets() {
    printf '%s\n' generate_secrets >> "${STEP_LOG}"
    printf '%s' "${TRUSTED_PROXIES_WRITE}" > "${TD}/write-at-secrets"
  }
}

define_case refused-install-writes-nothing
case_refused_install_writes_nothing() {
  load_installer --profile dashboard --trusted-proxies '0.0.0.0/0'
  stub_bare_metal_steps
  run_rc run_bare_metal_install
  assert_eq "exit status of a refused install" "${RC}" "1"
  assert_eq "steps that ran before the refusal" "$(cat "${STEP_LOG}")" \
"resolve_public_url_defaults
check_prerequisites
clone_or_pull
install_and_build"
  [ ! -e "${TD}/write-at-secrets" ] || die "generate_secrets ran after a refusal"
  assert_eq "install dir contents" "$(ls -A "${TD}/install")" "packages"
  # And an accepted value lets every step run, with the canonical value set.
  load_installer --profile dashboard --trusted-proxies '192.0.2.10, Loopback'
  stub_bare_metal_steps
  run_rc run_bare_metal_install
  assert_eq "exit status of an accepted install" "${RC}" "0"
  assert_eq "steps that ran for an accepted value" "$(cat "${STEP_LOG}" | tr '\n' ' ')" \
    "resolve_public_url_defaults check_prerequisites clone_or_pull install_and_build generate_secrets seed_data create_oauth_client write_config create_systemd_services start_services_and_post_install show_summary_bare_metal show_v3_whats_new "
  assert_eq "value held when secrets are generated" "$(cat "${TD}/write-at-secrets")" "192.0.2.10,loopback"
}

define_case accept-ceiling-boundaries
case_accept_ceiling_boundaries() {
  local val
  for val in '11.0.0.0/8' '2000::/16'; do
    load_installer --trusted-proxies "${val}"
    validate_trusted_proxies
    assert_eq "value written for [${val}]" "${TRUSTED_PROXIES_WRITE}" "${val}"
  done
}

define_case none-written-as-none
case_none_written_as_none() {
  load_installer --trusted-proxies 'none'
  validate_trusted_proxies
  render_unit_to "${TD}/unit"
  assert_eq "the written line" "$(grep -- 'DASHBOARD_TRUSTED_PROXIES' "${TD}/unit")" \
    "Environment=DASHBOARD_TRUSTED_PROXIES=none"
  assert_eq "read-back" "$(trusted_proxies_readback systemd "${TD}/unit")" "none"
}

define_case blank-value-writes-nothing
case_blank_value_writes_nothing() {
  load_installer --trusted-proxies '   '
  validate_trusted_proxies
  assert_contains "the warning" "$(messages_of validate_trusted_proxies)" "was blank"
  assert_eq "value to write" "${TRUSTED_PROXIES_WRITE}" ""
  render_unit_to "${TD}/unit"
  assert_eq "unit lines naming the variable" "$(count_lines_matching 'DASHBOARD_TRUSTED_PROXIES' "${TD}/unit")" "0"
  assert_eq "read-back is the default" "$(trusted_proxies_readback systemd "${TD}/unit")" "$(dist_default_list)"
}

# Run validate_trusted_proxies and keep what it left in TRUSTED_PROXIES_WRITE
# even when it exits.
validate_and_report() {
  trap 'printf "%s" "${TRUSTED_PROXIES_WRITE}" > "${TD}/write"' EXIT
  validate_trusted_proxies
}

define_case missing-validator-fails-closed
case_missing_validator_fails_closed() {
  load_installer --trusted-proxies '192.0.2.10'
  rm "${TD}/install/packages"
  run_rc validate_and_report
  assert_eq "exit status" "${RC}" "1"
  assert_contains "message" "$(cat "${TD}/out")" "Could not run the dashboard's trusted-proxy check"
  assert_eq "value to write" "$(cat "${TD}/write")" ""
  assert_eq "install dir contents" "$(ls -A "${TD}/install")" ""
}

define_case node-missing-fails-closed
case_node_missing_fails_closed() {
  load_installer --trusted-proxies '192.0.2.10'
  mkdir -p "${TD}/bin"
  printf '#!/usr/bin/env bash\necho "node: not found" >&2\nexit 127\n' > "${TD}/bin/node"
  chmod +x "${TD}/bin/node"
  PATH="${TD}/bin:${PATH}"
  run_rc validate_and_report
  assert_eq "exit status" "${RC}" "1"
  assert_contains "message" "$(cat "${TD}/out")" "Could not run the dashboard's trusted-proxy check"
  assert_eq "value to write" "$(cat "${TD}/write")" ""
}

define_case percent-doubled-for-systemd
case_percent_doubled_for_systemd() {
  load_installer --trusted-proxies 'fe80::1%eth0'
  validate_trusted_proxies
  render_unit_to "${TD}/unit"
  assert_eq "the written line" "$(grep -- 'DASHBOARD_TRUSTED_PROXIES' "${TD}/unit")" \
    "Environment=DASHBOARD_TRUSTED_PROXIES=fe80::1%%eth0"
  assert_eq "read-back" "$(trusted_proxies_readback systemd "${TD}/unit")" "fe80::1%eth0"
}

# systemd-analyze verify exits 0 even when it ignores an assignment (measured),
# so every assertion reads the output text.
SYSTEMD_BAD_PATTERNS=("DASHBOARD_TRUSTED_PROXIES" "Invalid environment assignment" "Failed to resolve specifiers")

systemd_verify_text() {
  systemd-analyze verify "$1" 2>&1 || true
}

probe_unit_with_line() {
  local dir="$1" line="$2"
  mkdir -p "${dir}"
  printf '[Unit]\nDescription=probe\n\n[Service]\nType=simple\nExecStart=/bin/true\n%s\n' "${line}" > "${dir}/luqen-dashboard.service"
}

define_case systemd-parses-written-line
case_systemd_parses_written_line() {
  new_tmp
  local why=""
  if ! command -v systemd-analyze >/dev/null 2>&1; then
    why="systemd-analyze is not installed"
  fi
  if [ -z "${why}" ]; then
    # Positive controls first: the check must be able to see both defects.
    probe_unit_with_line "${TD}/ctl-space" 'Environment=DASHBOARD_TRUSTED_PROXIES=192.0.2.10, 198.51.100.0/24'
    probe_unit_with_line "${TD}/ctl-pct" 'Environment=DASHBOARD_TRUSTED_PROXIES=fe80::1%eth0'
    case "$(systemd_verify_text "${TD}/ctl-space/luqen-dashboard.service")" in
      *"Invalid environment assignment"*) ;;
      *) why="positive control blind: a raw spaced line produced no 'Invalid environment assignment' diagnostic" ;;
    esac
    case "$(systemd_verify_text "${TD}/ctl-pct/luqen-dashboard.service")" in
      *"Failed to resolve specifiers"*) ;;
      *) why="positive control blind: an undoubled % produced no 'Failed to resolve specifiers' diagnostic" ;;
    esac
  fi
  if [ -n "${why}" ]; then
    if [ "${LUQEN_REQUIRE_SYSTEMD_ANALYZE:-}" = "1" ]; then die "${why}"; fi
    skip_case "${why}"
  fi

  require_lib_mode
  local val dir text pat
  for val in '192.0.2.10, 198.51.100.0/24' '192.0.2.10, Loopback' 'none' 'fe80::1%eth0'; do
    dir="$(mktemp -d "${TD}/unit.XXXXXX")"
    (
      set --
      source_installer --install-dir "${TD}/install" --trusted-proxies "${val}"
      OUT=/dev/null
      validate_trusted_proxies
      node_path="$(command -v node)"
      CONFIG_FILE="${TD}/install/dashboard.config.json"
      render_systemd_unit_dashboard > "${dir}/luqen-dashboard.service"
    )
    text="$(systemd_verify_text "${dir}/luqen-dashboard.service")"
    # DUMP| lines are echoed by the runner even when the case passes, so the
    # log shows what systemd-analyze said about each written line.
    printf 'DUMP| systemd-analyze verify for [%s]:\n' "${val}"
    if [ -n "${text}" ]; then printf '%s\n' "${text}" | sed 's/^/DUMP|   /'; else printf 'DUMP|   (no output)\n'; fi

    for pat in "${SYSTEMD_BAD_PATTERNS[@]}"; do
      case "${text}" in
        *"${pat}"*) die "value [${val}]: systemd-analyze output contains [${pat}]" ;;
      esac
    done
  done
}

define_case profile-without-dashboard-refused
case_profile_without_dashboard_refused() {
  local prof
  for prof in api cli; do
    load_installer --profile "${prof}" --trusted-proxies '192.0.2.10'
    run_rc derive_install_components
    [ "${RC}" -eq 1 ] || die "profile ${prof}: expected exit 1 but got ${RC}"
    assert_contains "profile ${prof}" "$(cat "${TD}/out")" "--trusted-proxies"
    assert_contains "profile ${prof}" "$(cat "${TD}/out")" "profile ${prof}"
  done
  load_installer --profile dashboard --trusted-proxies '192.0.2.10'
  run_rc derive_install_components
  assert_eq "dashboard profile exit status" "${RC}" "0"
}

define_case check-mode-installs-nothing
case_check_mode_installs_nothing() {
  new_tmp
  local before after stdout_file="${TD}/stdout" stderr_file="${TD}/stderr" rc
  : > "${stdout_file}"; : > "${stderr_file}"
  before="$(find "${TD}" | sort | sha256sum)"
  run_check() {
    set +e
    HOME="${TD}" bash "${INSTALL_SH}" "$@" --install-dir "${TD}/install" >"${stdout_file}" 2>"${stderr_file}" </dev/null
    rc=$?
    set -e
  }
  run_check --trusted-proxies '192.0.2.10, Loopback' --check-trusted-proxies
  assert_eq "accepted exit status" "${rc}" "0"
  assert_eq "accepted output" "$(cat "${stdout_file}")" \
"accepted: 192.0.2.10,loopback
systemd line: Environment=DASHBOARD_TRUSTED_PROXIES=192.0.2.10,loopback
effective: 192.0.2.10,loopback"
  run_check --check-trusted-proxies --trusted-proxies '0.0.0.0/0'
  assert_eq "refused exit status" "${rc}" "2"
  assert_contains "refused message" "$(cat "${stderr_file}")" "Invalid trustedProxies"
  run_check --trusted-proxies '   ' --check-trusted-proxies
  assert_eq "blank exit status" "${rc}" "0"
  assert_eq "blank output" "$(cat "${stdout_file}")" \
"blank: nothing would be written
effective: $(dist_default_list)"
  after="$(find "${TD}" | sort | sha256sum)"
  assert_eq "temp dir listing before and after" "${after}" "${before}"
}

# ── Task 3: wizard prompt, Docker, macOS, closing summary ────────────────────

# feed_tty <answer> <done-file>: write the answer, then keep stdin open until the
# driver writes <done-file> (bounded at 25 s). Some script(1) versions end the
# session as soon as their stdin reaches EOF, before the child has read the
# answer from the pty; holding stdin open makes the result independent of that.
feed_tty() {
  printf '%s\n' "$1"
  local i=0
  while [ ! -e "$2" ] && [ "$i" -lt 250 ]; do sleep 0.1; i=$((i + 1)); done
}

# Drive a function that reads from /dev/tty. script(1) gives the child a pty,
# the answer is fed on stdin. A missing script(1) FAILs under
# LUQEN_REQUIRE_SCRIPT=1 and otherwise SKIPs.
require_script_or_skip() {
  if ! command -v script >/dev/null 2>&1; then
    if [ "${LUQEN_REQUIRE_SCRIPT:-}" = "1" ]; then die "script(1) is not installed"; fi
    skip_case "script(1) is not installed"
  fi
}

# prompt_answer <current-flag-value-or-empty> <answer> [timing] -- prints the
# value of DASHBOARD_TRUSTED_PROXIES after ask_trusted_proxies [timing] has read
# <answer>. What the prompt printed is left in ${TD}/script.out.
prompt_answer() {
  local current="$1" answer="$2" timing="${3:-}" driver="${TD}/driver.sh" result="${TD}/result"
  : > "${result}"
  {
    printf '%s\n' 'set -euo pipefail'
    printf '%s\n' 'export LUQEN_INSTALL_LIB_ONLY=1'
    if [ -n "${current}" ]; then
      printf '. %q --install-dir %q --trusted-proxies %q\n' "${INSTALL_SH}" "${TD}/install" "${current}"
      printf 'if declare -F parse_args >/dev/null; then parse_args --install-dir %q --trusted-proxies %q; fi\n' "${TD}/install" "${current}"
    else
      printf '. %q --install-dir %q\n' "${INSTALL_SH}" "${TD}/install"
      printf 'if declare -F parse_args >/dev/null; then parse_args --install-dir %q; fi\n' "${TD}/install"
    fi
    printf 'ask_trusted_proxies %s\n' "${timing}"
    printf 'printf %%s "${DASHBOARD_TRUSTED_PROXIES}" > %q\n' "${result}"
    printf ': > %q\n' "${TD}/driver.done"
  } > "${driver}"
  rm -f "${TD}/driver.done"
  feed_tty "${answer}" "${TD}/driver.done" | timeout 30 script -qec "bash ${driver}" /dev/null >"${TD}/script.out" 2>&1 || true
  cat "${result}"
}

define_case wizard-prompt-sets-value
case_wizard_prompt_sets_value() {
  new_tmp; require_lib_mode; require_script_or_skip
  assert_eq "typed answer is stored verbatim" "$(prompt_answer '' '198.51.100.0/24, loopback')" "198.51.100.0/24, loopback"
  assert_eq "an empty answer keeps the value from the flag" "$(prompt_answer '192.0.2.10' '')" "192.0.2.10"
  assert_eq "an empty answer with nothing given stays empty" "$(prompt_answer '' '')" ""
  # When the list is checked, as the prompt states it (WR-01).
  prompt_answer '' '' bare-metal >/dev/null
  assert_contains "bare-metal prompt" "$(tr -d '\r' < "${TD}/script.out" | tr '\n' ' ')" "check the list after the checkout and build"
  prompt_answer '' '' docker >/dev/null
  assert_contains "docker prompt" "$(tr -d '\r' < "${TD}/script.out" | tr '\n' ' ')" "The installer does not check the list: the dashboard container checks it when it"
  assert_not_contains "docker prompt" "$(tr -d '\r' < "${TD}/script.out" | tr '\n' ' ')" "before any secret"
  local marker="${TD}/pwned"
  assert_eq "a command-substitution answer is stored literally" \
    "$(prompt_answer '' "\$(touch ${marker})")" "\$(touch ${marker})"
  [ ! -e "${marker}" ] || die "the prompt executed its answer: ${marker} exists"
}

# drive_prompt <call> <answer> <expected> -- runs <call> (an ask/ask_secret line
# that stores into ANSWER) under script(1) with <answer> on stdin, and prints
# only "same" or "differ": whether ANSWER equals <expected> byte for byte. The
# answer itself is never printed.
drive_prompt() {
  local call="$1" answer="$2" expected="$3" driver="${TD}/pdriver.sh" result="${TD}/presult"
  printf '%s' "${expected}" > "${TD}/pexpected"
  : > "${result}"
  {
    printf '%s\n' 'set -euo pipefail'
    printf '%s\n' 'export LUQEN_INSTALL_LIB_ONLY=1'
    printf '. %q\n' "${INSTALL_SH}"
    printf '%s\n' 'ANSWER=""'
    printf '%s\n' "${call}"
    printf 'if [ "${ANSWER}" = "$(cat %q)" ]; then printf same > %q; else printf differ > %q; fi\n' "${TD}/pexpected" "${result}" "${result}"
    printf ': > %q\n' "${TD}/pdriver.done"
  } > "${driver}"
  rm -f "${TD}/pdriver.done"
  feed_tty "${answer}" "${TD}/pdriver.done" | timeout 30 script -qec "bash ${driver}" /dev/null >/dev/null 2>&1 || true
  cat "${result}"
}

define_case prompt-works-without-term
case_prompt_works_without_term() {
  new_tmp; require_lib_mode; require_script_or_skip
  # A terminal with no TERM: the colour setup must not abort the installer.
  local got
  got="$(unset TERM; prompt_answer '' '192.0.2.44')"
  assert_eq "a terminal without TERM still stores the answer" "${got}" "192.0.2.44"
}

define_case prompts-store-answers-verbatim
case_prompts_store_answers_verbatim() {
  new_tmp; require_lib_mode; require_script_or_skip
  local marker="${TD}/pwned" a
  for a in "\$(touch ${marker})" "a\`touch ${marker}\`b" 'say "hi"' 'back\slash' 'pa$$w0rd!$HOME'; do
    assert_eq "ask stores the answer as typed" "$(drive_prompt 'ask "Admin username" "admin" ANSWER' "${a}" "${a}")" "same"
    assert_eq "ask_secret stores the answer as typed" "$(drive_prompt 'ask_secret "SMTP password" ANSWER' "${a}" "${a}")" "same"
  done
  [ ! -e "${marker}" ] || die "a prompt executed its answer: ${marker} exists"
  assert_eq "an empty answer takes the default" "$(drive_prompt 'ask "Admin username" "admin" ANSWER' '' 'admin')" "same"
  # Control: the comparison can say differ.
  assert_eq "control" "$(drive_prompt 'ask "Admin username" "admin" ANSWER' 'typed' 'something else')" "differ"
}

define_case docker-env-written
case_docker_env_written() {
  load_installer --profile docker --trusted-proxies '192.0.2.10, 198.51.100.0/24'
  SESSION_SECRET="test-session-secret"
  render_docker_env > "${TD}/env"
  assert_eq "lines beginning with the variable" "$(grep -c '^DASHBOARD_TRUSTED_PROXIES=' "${TD}/env" || true)" "1"
  assert_eq "the written line" "$(grep '^DASHBOARD_TRUSTED_PROXIES=' "${TD}/env")" \
    "DASHBOARD_TRUSTED_PROXIES=192.0.2.10, 198.51.100.0/24"
}

define_case docker-env-nothing-when-empty
case_docker_env_nothing_when_empty() {
  load_installer --profile docker
  SESSION_SECRET="test-session-secret"
  render_docker_env > "${TD}/env"
  assert_eq "lines beginning with the variable" "$(grep -c '^DASHBOARD_TRUSTED_PROXIES=' "${TD}/env" || true)" "0"
  grep -q '^# .*DASHBOARD_TRUSTED_PROXIES' "${TD}/env" || die "the commented explanation of DASHBOARD_TRUSTED_PROXIES is missing from .env"
}

define_case docker-env-charset-refused
case_docker_env_charset_refused() {
  local bad
  for bad in 'loopback # note' 'a$b' "it's" 'say "x"' 'back`tick' 'back\slash'; do
    load_installer --profile docker --trusted-proxies "${bad}"
    run_rc derive_install_components
    [ "${RC}" -eq 1 ] || die "value [${bad}]: expected exit 1 but got ${RC}"
    assert_contains "value [${bad}]" "$(cat "${TD}/out")" "the dashboard would refuse it"
    assert_contains "value [${bad}]" "$(cat "${TD}/out")" "compose would rewrite it"
  done
  # Characters the dashboard can accept are not refused here.
  local good
  for good in 'fe80::1%eth0' '2001:db8::/32, loopback'; do
    load_installer --profile docker --trusted-proxies "${good}"
    run_rc derive_install_components
    [ "${RC}" -eq 0 ] || die "value [${good}]: expected exit 0 but got ${RC}: $(cat "${TD}/out")"
  done
}

define_case docker-summary-says-what-was-written
case_docker_summary_says_what_was_written() {
  local calls line
  calls="$(mktemp)"
  load_installer --profile docker --trusted-proxies '192.0.2.10'
  SESSION_SECRET="test-session-secret"
  # A Docker install has no host-side dist: the closing line must not run the check.
  trusted_proxies_check() { echo called >> "${calls}"; return 1; }
  render_docker_env > "${TD}/install/.env"
  line="$(print_docker_trusted_proxies_result)"
  assert_contains "with a value" "${line}" "192.0.2.10"
  assert_contains "with a value" "${line}" "the dashboard container started with it"
  unset DASHBOARD_TRUSTED_PROXIES   # the first load left it set in this shell
  load_installer --profile docker
  SESSION_SECRET="test-session-secret"
  trusted_proxies_check() { echo called >> "${calls}"; return 1; }
  render_docker_env > "${TD}/install/.env"
  line="$(print_docker_trusted_proxies_result)"
  assert_contains "with nothing" "${line}" "nothing written; the dashboard default applies"
  assert_eq "calls to the host-side check" "$(wc -l < "${calls}" | tr -d ' ')" "0"
  rm -f "${calls}"
}

define_case newline-refused-before-any-sink
case_newline_refused_before_any_sink() {
  local prof val
  for prof in dashboard docker api cli; do
    for val in $'192.0.2.10\n198.51.100.1' $'192.0.2.10\r'; do
      load_installer --profile "${prof}" --trusted-proxies "${val}"
      run_rc derive_install_components
      [ "${RC}" -eq 1 ] || die "profile ${prof}: a value with a line break was not refused (exit ${RC})"
      assert_contains "profile ${prof}" "$(cat "${TD}/out")" "line break"
    done
  done
}

define_case compose-passes-to-dashboard-only
case_compose_passes_to_dashboard_only() {
  command -v python3 >/dev/null 2>&1 || die "python3 is not installed"
  python3 - "${REPO_ROOT}/docker-compose.yml" <<'PYEOF' || die "compose check failed (see lines above)"
import sys
try:
    import yaml
except ImportError:
    print("PyYAML is not installed"); sys.exit(1)
d = yaml.safe_load(open(sys.argv[1]))
want = "DASHBOARD_TRUSTED_PROXIES=${DASHBOARD_TRUSTED_PROXIES:-}"
hits = {}
for name, svc in (d.get("services") or {}).items():
    env = svc.get("environment") or []
    if isinstance(env, dict):
        env = [f"{k}={v}" for k, v in env.items()]
    found = [e for e in env if str(e).split("=", 1)[0] == "DASHBOARD_TRUSTED_PROXIES"]
    if found:
        hits[name] = found
if hits != {"dashboard": [want]}:
    print(f"expected exactly the dashboard service to carry [{want}]; found {hits}")
    sys.exit(1)
PYEOF
  python3 "${REPO_ROOT}/tools/lint-compose.py" "${REPO_ROOT}/docker-compose.yml" >/dev/null \
    || die "tools/lint-compose.py rejects docker-compose.yml"
}

define_case install-state-carries-validated-value
case_install_state_carries_validated_value() {
  load_installer --trusted-proxies '192.0.2.10, Loopback'
  validate_trusted_proxies
  INSTALL_COMPONENTS=(core dashboard)
  write_install_state
  assert_eq "value in .install-state" "$(trusted_proxies_written_value state "${TD}/install/.install-state")" "192.0.2.10,loopback"
}

define_case install-state-omits-when-empty
case_install_state_omits_when_empty() {
  load_installer
  validate_trusted_proxies
  INSTALL_COMPONENTS=(core dashboard)
  write_install_state
  assert_eq "lines naming the variable" "$(count_lines_matching 'DASHBOARD_TRUSTED_PROXIES' "${TD}/install/.install-state")" "0"
}

# Run a copy of install.command beside a stub install.sh, as on macOS: PATH-first
# uname (Darwin) and launchctl stubs, a temp HOME, and an .install-state holding
# <state-extra-lines>. The caller's environment is whatever the case exported.
run_install_command() {
  local state_extra="$1" mac="${TD}/mac"
  mkdir -p "${mac}/bin" "${mac}/home" "${mac}/luqen/packages/dashboard/dist"
  cp "${REPO_ROOT}/install.command" "${mac}/install.command"
  printf '#!/usr/bin/env bash\nexit 0\n' > "${mac}/install.sh"
  printf '#!/bin/sh\necho Darwin\n' > "${mac}/bin/uname"
  printf '#!/bin/sh\nexit 0\n' > "${mac}/bin/launchctl"
  chmod +x "${mac}/bin/uname" "${mac}/bin/launchctl" "${mac}/install.sh"
  printf 'INSTALL_COMPONENTS=dashboard\n%s' "${state_extra}" > "${mac}/luqen/.install-state"
  PLIST="${mac}/home/Library/LaunchAgents/io.luqen.dashboard.plist"
  PATH="${mac}/bin:${PATH}" HOME="${mac}/home" LUQEN_INSTALL_DIR="${mac}/luqen" \
    bash "${mac}/install.command" --non-interactive </dev/null >"${mac}/out" 2>&1 \
    || die "install.command failed: $(tail -n 5 "${mac}/out")"
  [ -f "${PLIST}" ] || die "no dashboard plist was written; install.command said: $(tail -n 5 "${mac}/out")"
}

define_case macos-plist-carries-value
case_macos_plist_carries_value() {
  new_tmp
  run_install_command $'DASHBOARD_TRUSTED_PROXIES=192.0.2.10,loopback\n'
  grep -qF '<key>DASHBOARD_TRUSTED_PROXIES</key><string>192.0.2.10,loopback</string>' "${PLIST}" \
    || die "the dashboard plist does not carry the value from .install-state"
}

define_case macos-plist-ignores-caller-env
case_macos_plist_ignores_caller_env() {
  new_tmp
  export DASHBOARD_TRUSTED_PROXIES='0.0.0.0/0'
  run_install_command ''
  assert_eq "plist lines naming the variable" "$(count_lines_matching 'DASHBOARD_TRUSTED_PROXIES' "${PLIST}")" "0"
}

# run_install_command_mode <args...> -- runs a copy of install.command beside a
# copy of the REAL install.sh, as on macOS: PATH-first uname (Darwin), a
# launchctl that logs every call, and git, npm, systemctl and sudo stubs that
# fail, so a mode that fell through to an install stops at its first step.
# Sets RC, LAUNCHCTL_LOG, AGENTS_DIR and MAC_OUT.
run_install_command_mode() {
  local mac="${TD}/mac" t
  mkdir -p "${mac}/bin" "${mac}/home"
  cp "${REPO_ROOT}/install.command" "${mac}/install.command"
  cp "${INSTALL_SH}" "${mac}/install.sh"
  printf '#!/bin/sh\necho Darwin\n' > "${mac}/bin/uname"
  LAUNCHCTL_LOG="${mac}/launchctl.log"; : > "${LAUNCHCTL_LOG}"
  printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> %q\nexit 0\n' "${LAUNCHCTL_LOG}" > "${mac}/bin/launchctl"
  for t in git npm systemctl sudo; do
    printf '#!/bin/sh\necho "stub %s: refused in this test" >&2\nexit 1\n' "${t}" > "${mac}/bin/${t}"
  done
  chmod +x "${mac}/bin/"*
  # The stub must be able to log, or an empty log would prove nothing.
  PATH="${mac}/bin:${PATH}" launchctl probe
  [ "$(cat "${LAUNCHCTL_LOG}")" = "probe" ] || die "the launchctl stub does not log, so this case measures nothing"
  : > "${LAUNCHCTL_LOG}"
  AGENTS_DIR="${mac}/home/Library/LaunchAgents"
  MAC_OUT="${mac}/out"
  set +e
  PATH="${mac}/bin:${PATH}" HOME="${mac}/home" LUQEN_INSTALL_DIR="${TD}/install" \
    bash "${mac}/install.command" --non-interactive "$@" --install-dir "${TD}/install" </dev/null >"${MAC_OUT}" 2>&1
  RC=$?
  set -e
}

# entries_in <dir> -- how many entries the directory holds; 0 when it is absent.
entries_in() {
  if [ -d "$1" ]; then ls -A "$1" | wc -l | tr -d ' '; else printf '0'; fi
}

define_case macos-no-install-modes-leave-launchd-alone
case_macos_no_install_modes_leave_launchd_alone() {
  new_tmp
  local plists
  run_install_command_mode --check-trusted-proxies --trusted-proxies '192.0.2.10'
  assert_eq "check mode exit status" "${RC}" "0"
  assert_contains "check mode ran the real install.sh check" "$(cat "${MAC_OUT}")" "accepted: 192.0.2.10"
  assert_eq "launchctl calls in check mode" "$(cat "${LAUNCHCTL_LOG}")" ""
  plists="$(entries_in "${AGENTS_DIR}")"
  assert_eq "plists written in check mode" "${plists}" "0"

  run_install_command_mode --help
  assert_eq "help exit status" "${RC}" "0"
  assert_eq "launchctl calls for --help" "$(cat "${LAUNCHCTL_LOG}")" ""
  plists="$(entries_in "${AGENTS_DIR}")"
  assert_eq "plists written for --help" "${plists}" "0"

  # -h is the short help: install.sh shows the help for it too, so the wrapper
  # must stop after it exactly as after --help.
  run_install_command_mode -h
  assert_eq "-h exit status" "${RC}" "0"
  assert_contains "-h ran the real install.sh help" "$(cat "${MAC_OUT}")" "Usage:"
  assert_eq "launchctl calls for -h" "$(cat "${LAUNCHCTL_LOG}")" ""
  plists="$(entries_in "${AGENTS_DIR}")"
  assert_eq "plists written for -h" "${plists}" "0"

  run_install_command_mode --no-such-option
  assert_eq "unknown option exit status" "${RC}" "2"
  assert_eq "launchctl calls for an unknown option" "$(cat "${LAUNCHCTL_LOG}")" ""
  plists="$(entries_in "${AGENTS_DIR}")"
  assert_eq "plists written for an unknown option" "${plists}" "0"
}

# stub_destructive_tools <dir> -- PATH-first systemctl, rm, git, npm, sudo and
# apt-get that log their arguments to <dir>/calls.log and change nothing.
stub_destructive_tools() {
  local dir="$1" t
  mkdir -p "${dir}"
  : > "${dir}/calls.log"
  for t in systemctl rm git npm sudo apt-get; do
    printf '#!/bin/sh\nprintf "%s %%s\\n" "$*" >> %q\nexit 1\n' "${t}" "${dir}/calls.log" > "${dir}/${t}"
    chmod +x "${dir}/${t}"
  done
}

define_case source-mode-dispatches-nothing
case_source_mode_dispatches_nothing() {
  new_tmp; require_lib_mode
  local stubs="${TD}/stubs"
  stub_destructive_tools "${stubs}"
  # The stubs must log, or an empty log would prove nothing.
  PATH="${stubs}:${PATH}" systemctl probe || true
  assert_eq "stub log after the probe" "$(cat "${stubs}/calls.log")" "systemctl probe"
  : > "${stubs}/calls.log"
  mkdir -p "${TD}/home"
  (
    PATH="${stubs}:${PATH}"
    HOME="${TD}/home"
    . "${INSTALL_SH}" --uninstall --purge --install-dir "${TD}/no-such-install"
    printf 'sourced\n' > "${TD}/sourced"
    if declare -F parse_args >/dev/null; then
      parse_args --uninstall --purge --install-dir "${TD}/no-such-install"
      printf '%s' "${UNINSTALL}" > "${TD}/uninstall-flag"
    fi
  ) >"${TD}/out" 2>&1 || die "sourcing with --uninstall failed: $(tail -n 3 "${TD}/out")"
  [ -e "${TD}/sourced" ] || die "the sourced file exited (an uninstall dispatch ends in exit 0): $(tail -n 3 "${TD}/out")"
  assert_eq "systemctl/rm/git/npm calls while sourcing with --uninstall" "$(cat "${stubs}/calls.log")" ""
  assert_not_contains "installer output" "$(cat "${TD}/out")" "Uninstalling"
  assert_eq "parse_args read --uninstall (and dispatched nothing)" "$(cat "${TD}/uninstall-flag" 2>/dev/null)" "true"
}

define_case lib-mode-executed-refuses
case_lib_mode_executed_refuses() {
  new_tmp
  local stubs="${TD}/stubs" rc
  stub_destructive_tools "${stubs}"
  mkdir -p "${TD}/home"
  # Check mode only, so a regression here can at worst run the check, never an install.
  set +e
  env PATH="${stubs}:${PATH}" HOME="${TD}/home" LUQEN_INSTALL_LIB_ONLY=1 \
    bash "${INSTALL_SH}" --non-interactive --check-trusted-proxies --trusted-proxies '192.0.2.10' \
    --install-dir "${TD}/install" </dev/null >"${TD}/stdout" 2>"${TD}/stderr"
  rc=$?
  set -e
  assert_eq "exit status of an executed install.sh in source mode" "${rc}" "64"
  assert_contains "the reason" "$(cat "${TD}/stderr")" "LUQEN_INSTALL_LIB_ONLY=1 is for sourcing install.sh"
  assert_eq "stdout" "$(cat "${TD}/stdout")" ""
  assert_eq "tool calls" "$(cat "${stubs}/calls.log")" ""
}

define_case summary-reads-back-written-unit
case_summary_reads_back_written_unit() {
  load_installer --trusted-proxies '192.0.2.10,198.51.100.0/24'
  validate_trusted_proxies
  render_unit_to "${TD}/unit"
  # Only a real read of the file can pass: memory now disagrees with the file.
  TRUSTED_PROXIES_WRITE="198.51.100.99"
  assert_eq "summary line for a unit with the setting" "$(print_trusted_proxies_readback systemd "${TD}/unit")" \
    "  Trusted proxies (read back from ${TD}/unit): 192.0.2.10,198.51.100.0/24 (set by this install)"
  # A unit without the line, with a non-empty value still in memory.
  grep -v 'DASHBOARD_TRUSTED_PROXIES' "${TD}/unit" > "${TD}/unit-none"
  TRUSTED_PROXIES_WRITE="198.51.100.99"
  assert_eq "summary line for a unit without the setting" "$(print_trusted_proxies_readback systemd "${TD}/unit-none")" \
    "  Trusted proxies (read back from ${TD}/unit-none): $(dist_default_list) (dashboard default, nothing written)"
}

define_case summary-warns-about-overrides
case_summary_warns_about_overrides() {
  load_installer --trusted-proxies '192.0.2.10'
  validate_trusted_proxies
  local unit="${TD}/sd/luqen-dashboard.service" msgs v
  mkdir -p "${TD}/sd/luqen-dashboard.service.d"
  render_unit_to "${unit}"
  # Control: nothing can override, so no warning.
  msgs="$(messages_of print_trusted_proxies_readback systemd "${unit}")"
  assert_contains "control line" "${msgs}" "(set by this install)"
  assert_not_contains "control" "${msgs}" "may not be what the dashboard uses"
  # A drop-in, an EnvironmentFile and the config key, each setting a list; and a
  # drop-in plus an EnvironmentFile that do not.
  printf '[Service]\nEnvironment=NODE_ENV=production DASHBOARD_TRUSTED_PROXIES=198.51.100.91\n' > "${TD}/sd/luqen-dashboard.service.d/50-proxy.conf"
  printf '[Service]\nEnvironment=OTHER=1\nEnvironmentFile=-%s\nEnvironmentFile=%s\n' "${TD}/sd/sets.env" "${TD}/sd/other.env" > "${TD}/sd/luqen-dashboard.service.d/60-envfile.conf"
  printf 'OTHER=1\nDASHBOARD_TRUSTED_PROXIES=198.51.100.92\n' > "${TD}/sd/sets.env"
  printf 'OTHER=1\n' > "${TD}/sd/other.env"
  printf '{"sessionSecret":"x","trustedProxies":["198.51.100.93"]}\n' > "${CONFIG_FILE}"
  msgs="$(messages_of print_trusted_proxies_readback systemd "${unit}")"
  assert_contains "drop-in named" "${msgs}" "drop-in ${TD}/sd/luqen-dashboard.service.d/50-proxy.conf sets DASHBOARD_TRUSTED_PROXIES"
  assert_contains "environment file named" "${msgs}" "EnvironmentFile ${TD}/sd/sets.env (named in ${TD}/sd/luqen-dashboard.service.d/60-envfile.conf) sets DASHBOARD_TRUSTED_PROXIES"
  assert_contains "config key named" "${msgs}" "${CONFIG_FILE} sets the trustedProxies key"
  assert_not_contains "a drop-in that sets nothing" "${msgs}" "60-envfile.conf sets"
  assert_not_contains "an environment file that sets nothing" "${msgs}" "other.env"
  for v in 198.51.100.91 198.51.100.92 198.51.100.93; do
    assert_not_contains "no value printed" "${msgs}" "${v}"
  done
  # The macOS path (.install-state) checks only the config key.
  INSTALL_COMPONENTS=(core dashboard)
  write_install_state
  msgs="$(messages_of print_trusted_proxies_readback state "${TD}/install/.install-state")"
  assert_contains "state: config key named" "${msgs}" "${CONFIG_FILE} sets the trustedProxies key"
  assert_not_contains "state: no drop-in check" "${msgs}" "drop-in"
}

define_case written-value-charset-enforced
case_written_value_charset_enforced() {
  local bad
  for bad in '192.0.2.10;touch x' '192.0.2.10$(id)' '192.0.2.10</string>' '192.0.2.10 loopback' $'192.0.2.10\tx'; do
    load_installer --trusted-proxies '192.0.2.10'
    # The dashboard's answer is replaced by a crafted one: the installer must
    # not trust it.
    CRAFTED="${bad}"
    trusted_proxies_check() { printf '%s' "${CRAFTED}"; }
    run_rc validate_and_report
    assert_eq "value [${bad}]: exit status" "${RC}" "1"
    assert_contains "value [${bad}]" "$(cat "${TD}/out")" "outside [0-9A-Za-z.:/%,-]"
    assert_eq "value [${bad}]: value to write" "$(cat "${TD}/write")" ""
    # Each sink refuses it on its own as well.
    TRUSTED_PROXIES_WRITE="${bad}"
    run_rc dashboard_trusted_proxies_unit_line
    assert_eq "value [${bad}]: unit line exit status" "${RC}" "1"
    assert_not_contains "value [${bad}]: unit line" "$(cat "${TD}/out")" "Environment="
    INSTALL_COMPONENTS=(core dashboard)
    run_rc write_install_state
    assert_eq "value [${bad}]: .install-state exit status" "${RC}" "1"
    [ ! -e "${TD}/install/.install-state" ] || die "value [${bad}]: .install-state was written"
  done
  # A value the dashboard accepts, with a zone id holding -, is still written.
  load_installer --trusted-proxies 'fe80::1%br-lan'
  validate_trusted_proxies
  assert_eq "zone id with -" "${TRUSTED_PROXIES_WRITE}" "fe80::1%br-lan"
}

# fake_dist <dir> <config.js body> -- a stand-in dashboard dist whose loadConfig
# splits the variable and whose resolveTrustedProxies returns the list.
fake_dist() {
  mkdir -p "$1/auth"
  printf '{"type":"module"}\n' > "$1/package.json"
  printf '%s\nexport function loadConfig() { return { trustedProxies: process.env.DASHBOARD_TRUSTED_PROXIES.split(",") }; }\n' "$2" > "$1/config.js"
  printf 'export function resolveTrustedProxies(l) { return l; }\n' > "$1/auth/trusted-proxies.js"
}

define_case stray-stdout-fails-closed
case_stray_stdout_fails_closed() {
  load_installer
  local out rc
  # Control: a clean stand-in answers, so a failure below is the stray output.
  fake_dist "${TD}/clean" ''
  out="$(trusted_proxies_check "${TD}/clean" canonical '192.0.2.10')" && rc=0 || rc=$?
  assert_eq "clean stand-in exit status" "${rc}" "0"
  assert_eq "clean stand-in answer" "${out}" "192.0.2.10"
  fake_dist "${TD}/before" 'console.log("198.51.100.66");'
  out="$(trusted_proxies_check "${TD}/before" canonical '192.0.2.10' 2>/dev/null)" && rc=0 || rc=$?
  assert_eq "stray output before the answer: exit status" "${rc}" "3"
  assert_eq "stray output before the answer: stdout" "${out}" ""
  fake_dist "${TD}/after" 'process.on("exit", () => process.stdout.write("x"));'
  out="$(trusted_proxies_check "${TD}/after" canonical '192.0.2.10' 2>/dev/null)" && rc=0 || rc=$?
  assert_eq "stray output after the answer: exit status" "${rc}" "3"
  assert_eq "stray output after the answer: stdout" "${out}" ""
}

define_case docker-env-allow-list
case_docker_env_allow_list() {
  local bad good
  for bad in '192.0.2.10;x' '192.0.2.*' '<x>' 'a|b' '192.0.2.10&' $'192.0.2.10\tloopback'; do
    load_installer --profile docker --trusted-proxies "${bad}"
    run_rc derive_install_components
    [ "${RC}" -eq 1 ] || die "value [${bad}]: expected exit 1 but got ${RC}"
    assert_contains "value [${bad}]" "$(cat "${TD}/out")" "not written to .env"
  done
  for good in 'fe80::1%br-lan' '2001:db8::/32, loopback' '192.0.2.10 , LoopBack'; do
    load_installer --profile docker --trusted-proxies "${good}"
    run_rc derive_install_components
    [ "${RC}" -eq 0 ] || die "value [${good}]: expected exit 0 but got ${RC}: $(cat "${TD}/out")"
  done
}

define_case macos-plist-follows-install-dir
case_macos_plist_follows_install_dir() {
  new_tmp
  local mac="${TD}/mac" plist
  mkdir -p "${mac}/bin" "${mac}/home/luqen/packages/dashboard/dist" "${mac}/other/packages/dashboard/dist"
  cp "${REPO_ROOT}/install.command" "${mac}/install.command"
  printf '#!/usr/bin/env bash\nexit 0\n' > "${mac}/install.sh"
  printf '#!/bin/sh\necho Darwin\n' > "${mac}/bin/uname"
  printf '#!/bin/sh\nexit 0\n' > "${mac}/bin/launchctl"
  chmod +x "${mac}/bin/uname" "${mac}/bin/launchctl" "${mac}/install.sh"
  # An older install in ~/luqen and this run's install in --install-dir.
  printf 'INSTALL_COMPONENTS=dashboard\nDASHBOARD_TRUSTED_PROXIES=198.51.100.1\n' > "${mac}/home/luqen/.install-state"
  printf 'INSTALL_COMPONENTS=dashboard\nDASHBOARD_TRUSTED_PROXIES=192.0.2.10\n' > "${mac}/other/.install-state"
  env -u LUQEN_INSTALL_DIR PATH="${mac}/bin:${PATH}" HOME="${mac}/home" \
    bash "${mac}/install.command" --non-interactive --install-dir "${mac}/other" </dev/null >"${mac}/out" 2>&1 \
    || die "install.command failed: $(tail -n 5 "${mac}/out")"
  plist="${mac}/home/Library/LaunchAgents/io.luqen.dashboard.plist"
  [ -f "${plist}" ] || die "no dashboard plist was written: $(tail -n 5 "${mac}/out")"
  grep -qF '<key>DASHBOARD_TRUSTED_PROXIES</key><string>192.0.2.10</string>' "${plist}" \
    || die "the plist does not carry the --install-dir install's value"
  assert_eq "plist lines naming ~/luqen" "$(count_lines_matching "${mac}/home/luqen" "${plist}")" "0"
  grep -qF "<string>${mac}/other/packages/dashboard/dist/cli.js</string>" "${plist}" \
    || die "the plist does not point at the --install-dir install"
}

define_case macos-plist-refuses-unsafe-state
case_macos_plist_refuses_unsafe_state() {
  new_tmp
  local mac="${TD}/mac" rc
  mkdir -p "${mac}/bin" "${mac}/home" "${mac}/luqen/packages/dashboard/dist"
  cp "${REPO_ROOT}/install.command" "${mac}/install.command"
  printf '#!/usr/bin/env bash\nexit 0\n' > "${mac}/install.sh"
  printf '#!/bin/sh\necho Darwin\n' > "${mac}/bin/uname"
  printf '#!/bin/sh\nexit 0\n' > "${mac}/bin/launchctl"
  chmod +x "${mac}/bin/uname" "${mac}/bin/launchctl" "${mac}/install.sh"
  printf "INSTALL_COMPONENTS=dashboard\nDASHBOARD_TRUSTED_PROXIES='192.0.2.10</string><key>X</key><string>y'\n" > "${mac}/luqen/.install-state"
  set +e
  PATH="${mac}/bin:${PATH}" HOME="${mac}/home" LUQEN_INSTALL_DIR="${mac}/luqen" \
    bash "${mac}/install.command" --non-interactive </dev/null >"${mac}/out" 2>&1
  rc=$?
  set -e
  assert_eq "exit status" "${rc}" "1"
  assert_contains "reason" "$(cat "${mac}/out")" "no launchd plist was written"
  assert_eq "plists written" "$(entries_in "${mac}/home/Library/LaunchAgents")" "0"
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
    0)  ok "${name}"
        printf '%s\n' "${out}" | grep '^DUMP|' | sed 's/^DUMP|/    |/' || true ;;
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

  # A stray value in the caller's environment must not leak into the cases.
  unset DASHBOARD_TRUSTED_PROXIES
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
