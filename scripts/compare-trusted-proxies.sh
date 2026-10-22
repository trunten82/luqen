#!/usr/bin/env bash
# compare-trusted-proxies.sh -- where a host's DASHBOARD_TRUSTED_PROXIES lives,
# and whether the running value is in the canonical form install.sh writes.
#
# Usage (as root, on the dashboard host):
#   bash scripts/compare-trusted-proxies.sh [--unit NAME] [--install-dir DIR]
#                                           [--systemctl CMD] [--proc-root DIR]
#
# READ-ONLY. Output is variable names, file paths, counts and verdict words: no
# value, and no hash of one (a trusted-proxy list has so little entropy that an
# unsalted hash is reversed by guessing). Every comparison happens inside this
# run, on shell variables, and only its yes/no verdict is printed. The script
# never asks systemd for the unit's Environment property (it asks only for
# FragmentPath, DropInPaths, EnvironmentFiles, MainPID, WorkingDirectory and
# NeedDaemonReload), never prints a unit file, and creates no file. Never run it
# with -x.
#
# The value is read from the running dashboard's process environment
# (<proc-root>/<MainPID>/environ), which is what the dashboard actually uses.
# The unit files are only counted. The installer's own code decides what the
# installer would write: the script sources <install-dir>/install.sh in source
# mode (LUQEN_INSTALL_LIB_ONLY=1, inside subshells) and calls
# trusted_proxies_check and dashboard_trusted_proxies_unit_line. The check's
# stderr is discarded because the dashboard's refusal message names entries.
#
# Keys printed (one fact per line, last line is result=compared):
#   file=P role=fragment|dropin environment_lines=N trusted_proxies_lines=M simple_form_lines=K
#   envfile=P trusted_proxies_lines=M | envfile=P unreadable
#   running=present|absent|not-running
#   validator=accepted|blank|refused|unavailable   installer_would_write=nothing
#   running_is_canonical=yes|no
#       the running value is byte-equal to the canonical form the installer
#       writes for it. It says nothing about intent: the installer writes
#       whatever list the operator types, which this script never sees.
#   file=P file_line_equals_installer_line=yes|no   (one per simple-form line)
#       that line is byte-equal to the line the installer writes for the
#       running value
#   installer_writes_to=fragment  configured_in=P,P|none  location_differs=yes|no
#   set_in_more_than_one_place=yes|no  need_daemon_reload=yes|no
#
# Exit 0 compared. Exit 69 when it cannot compare (the reason line says why, and
# nothing else is printed): the process environment is unreadable, the install
# dir's install.sh predates the trusted-proxy check, the dashboard is not built,
# or the dashboard's check cannot run. Exit 2 for a usage error.
#
# Test seams (used by scripts/compare-trusted-proxies.test.sh, not for normal use):
#   --systemctl CMD   the systemctl to ask (default: systemctl)
#   --proc-root DIR   where <pid>/environ lives (default: /proc)

set +x
set -euo pipefail

UNIT="luqen-dashboard.service"
INSTALL_DIR=""
SYSTEMCTL="systemctl"
PROC_ROOT="/proc"

usage() {
  printf 'usage: bash compare-trusted-proxies.sh [--unit NAME] [--install-dir DIR] [--systemctl CMD] [--proc-root DIR]\n' >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --unit)        [ "$#" -ge 2 ] || usage; UNIT="$2"; shift 2 ;;
    --install-dir) [ "$#" -ge 2 ] || usage; INSTALL_DIR="$2"; shift 2 ;;
    --systemctl)   [ "$#" -ge 2 ] || usage; SYSTEMCTL="$2"; shift 2 ;;
    --proc-root)   [ "$#" -ge 2 ] || usage; PROC_ROOT="$2"; shift 2 ;;
    *)             usage ;;
  esac
done

# Facts are collected and printed at the end, so an exit 69 prints its reason
# line and nothing else.
REPORT=""
emit() { REPORT+="$*"$'\n'; }

unavailable() {
  printf 'unavailable: %s\n' "$1" >&2
  exit 69
}

# prop <Name> -- one systemd property value for the unit. Only the six names
# listed in the header are ever passed here.
prop() {
  "${SYSTEMCTL}" show -p "$1" --value "${UNIT}"
}

count_matching() { # <regex> <file> -- the number of matching lines, never the lines
  local n
  n="$(grep -cE -- "$1" "$2" || true)"
  printf '%s' "${n:-0}"
}

ENV_ASSIGN='^[[:space:]]*Environment=.*DASHBOARD_TRUSTED_PROXIES='
SIMPLE_FORM='^Environment=DASHBOARD_TRUSTED_PROXIES=[^[:space:]"'"'"']+$'

# ── Where the unit and its files are ────────────────────────────────────────

FRAGMENT="$(prop FragmentPath)" || unavailable "systemctl could not report the unit's FragmentPath"
DROPINS="$(prop DropInPaths)" || unavailable "systemctl could not report the unit's DropInPaths"
ENVFILES_RAW="$(prop EnvironmentFiles)" || unavailable "systemctl could not report the unit's EnvironmentFiles"
MAINPID="$(prop MainPID)" || unavailable "systemctl could not report the unit's MainPID"
NEED_RELOAD="$(prop NeedDaemonReload)" || unavailable "systemctl could not report the unit's NeedDaemonReload"
if [ -z "${INSTALL_DIR}" ]; then
  INSTALL_DIR="$(prop WorkingDirectory)" || unavailable "systemctl could not report the unit's WorkingDirectory"
fi
[ -n "${INSTALL_DIR}" ] || unavailable "the unit has no WorkingDirectory; pass --install-dir"

CONFIGURED_IN=()       # paths that set the name
FRAGMENT_SETS="no"
FILE_LINES=()          # "path<TAB>line" for each simple-form line, in memory only

# scan_unit_file <path> <fragment|dropin>
scan_unit_file() {
  local path="$1" role="$2" env_lines tp_lines simple_lines line
  if [ ! -r "${path}" ]; then
    emit "file=${path} role=${role} unreadable"
    return 0
  fi
  env_lines="$(count_matching '^[[:space:]]*Environment=' "${path}")"
  tp_lines="$(count_matching "${ENV_ASSIGN}" "${path}")"
  simple_lines="$(count_matching "${SIMPLE_FORM}" "${path}")"
  emit "file=${path} role=${role} environment_lines=${env_lines} trusted_proxies_lines=${tp_lines} simple_form_lines=${simple_lines}"
  if [ "${tp_lines}" -gt 0 ]; then
    CONFIGURED_IN+=("${path}")
    [ "${role}" = "fragment" ] && FRAGMENT_SETS="yes"
  fi
  while IFS= read -r line; do
    [ -n "${line}" ] || continue
    FILE_LINES+=("${path}"$'\t'"${line}")
  done < <(grep -E -- "${SIMPLE_FORM}" "${path}" || true)
}

if [ -n "${FRAGMENT}" ]; then scan_unit_file "${FRAGMENT}" fragment; fi
for dropin in ${DROPINS}; do
  scan_unit_file "${dropin}" dropin
done

# EnvironmentFiles entries look like "-/path (ignore_errors=yes)" or
# "/path (ignore_errors=no)"; a leading "-" marks an optional file.
while IFS= read -r envfile; do
  envfile="${envfile#"${envfile%%[![:space:]]*}"}"
  envfile="${envfile#-}"
  [ -n "${envfile}" ] || continue
  if [ -r "${envfile}" ]; then
    n="$(count_matching '^[[:space:]]*DASHBOARD_TRUSTED_PROXIES=' "${envfile}")"
    emit "envfile=${envfile} trusted_proxies_lines=${n}"
    [ "${n}" -gt 0 ] && CONFIGURED_IN+=("${envfile}")
  else
    emit "envfile=${envfile} unreadable"
  fi
done < <(printf '%s\n' "${ENVFILES_RAW}" | sed -E 's/ \(ignore_errors=[a-z]+\)[[:space:]]*/\n/g')

# ── The running value (compared in memory, never printed) ───────────────────

RUNNING=""
RUNNING_STATE="absent"
if [ "${MAINPID}" = "0" ] || [ -z "${MAINPID}" ]; then
  RUNNING_STATE="not-running"
else
  environ="${PROC_ROOT}/${MAINPID}/environ"
  [ -r "${environ}" ] || unavailable "cannot read the dashboard process environment (run as root on the dashboard host)"
  while IFS= read -r -d '' entry || [ -n "${entry}" ]; do
    case "${entry}" in
      DASHBOARD_TRUSTED_PROXIES=*)
        if [ "${RUNNING_STATE}" = "absent" ]; then   # getenv returns the first
          RUNNING="${entry#DASHBOARD_TRUSTED_PROXIES=}"
          RUNNING_STATE="present"
        fi
        ;;
    esac
  done < "${environ}" || unavailable "cannot read the dashboard process environment (run as root on the dashboard host)"
fi
emit "running=${RUNNING_STATE}"

# ── What the installer would write, through the installer's own code ────────

DIST="${INSTALL_DIR}/packages/dashboard/dist"
INSTALLER="${INSTALL_DIR}/install.sh"

# installer_call <function> [args...] -- runs one install.sh function in a
# subshell that has sourced install.sh in source mode. The subshell keeps
# install.sh's globals, its `set -e` and its `cd "$HOME"` out of this script.
installer_call() {
  (
    fn=("$@")
    set --
    export LUQEN_INSTALL_LIB_ONLY=1
    # shellcheck disable=SC1090
    . "${INSTALLER}"
    "${fn[@]}"
  )
}

# installer_unit_line <canonical value> -- the Environment= line install.sh
# would write for that value, from install.sh's own writer.
installer_unit_line() {
  (
    value="$1"
    set --
    export LUQEN_INSTALL_LIB_ONLY=1
    # shellcheck disable=SC1090
    . "${INSTALLER}"
    TRUSTED_PROXIES_WRITE="${value}"
    dashboard_trusted_proxies_unit_line
  )
}

VALIDATOR=""
INSTALLER_VALUE=""

if [ "${RUNNING_STATE}" = "present" ]; then
  # Never source an installer that has no source mode: sourcing it would run it.
  if [ ! -r "${INSTALLER}" ] \
     || ! grep -q 'LUQEN_INSTALL_LIB_ONLY' "${INSTALLER}" \
     || ! grep -q '^trusted_proxies_check()' "${INSTALLER}" \
     || ! grep -q '^dashboard_trusted_proxies_unit_line()' "${INSTALLER}"; then
    unavailable "install.sh in ${INSTALL_DIR} predates the trusted-proxy check"
  fi
  [ -f "${DIST}/auth/trusted-proxies.js" ] \
    || unavailable "the dashboard in ${INSTALL_DIR} is not built (no ${DIST}/auth/trusted-proxies.js)"

  if [ -z "${RUNNING//[[:space:]]/}" ]; then
    VALIDATOR="blank"
  else
    rc=0
    INSTALLER_VALUE="$(installer_call trusted_proxies_check "${DIST}" canonical "${RUNNING}" 2>/dev/null)" || rc=$?
    case "${rc}" in
      0) if [ "${INSTALLER_VALUE}" = "unset" ]; then VALIDATOR="blank"; else VALIDATOR="accepted"; fi ;;
      2) VALIDATOR="refused" ;;
      *) VALIDATOR="unavailable" ;;
    esac
  fi
  emit "validator=${VALIDATOR}"

  case "${VALIDATOR}" in
    unavailable)
      unavailable "the dashboard's own check could not run in ${INSTALL_DIR}" ;;
    blank)
      emit "installer_would_write=nothing" ;;
    accepted)
      installer_line="$(installer_unit_line "${INSTALLER_VALUE}" 2>/dev/null)" \
        || unavailable "install.sh could not render its unit line"
      installer_line="${installer_line%$'\n'}"
      # INSTALLER_VALUE is the canonical form of RUNNING, so this measures form,
      # not whether RUNNING is the list anyone meant (WR-05).
      if [ "${RUNNING}" = "${INSTALLER_VALUE}" ]; then
        emit "running_is_canonical=yes"
      else
        emit "running_is_canonical=no"
      fi
      for pair in "${FILE_LINES[@]+"${FILE_LINES[@]}"}"; do
        if [ "${pair#*$'\t'}" = "${installer_line}" ]; then eq="yes"; else eq="no"; fi
        emit "file=${pair%%$'\t'*} file_line_equals_installer_line=${eq}"
      done
      ;;
    refused)
      : ;;
  esac
elif [ "${RUNNING_STATE}" = "absent" ]; then
  emit "installer_would_write=nothing"
fi

# ── Location ────────────────────────────────────────────────────────────────

emit "installer_writes_to=fragment"
if [ "${#CONFIGURED_IN[@]}" -gt 0 ]; then
  joined=""
  for p in "${CONFIGURED_IN[@]}"; do joined="${joined:+${joined},}${p}"; done
  emit "configured_in=${joined}"
else
  emit "configured_in=none"
fi
if [ "${#CONFIGURED_IN[@]}" -gt 0 ] && [ "${FRAGMENT_SETS}" = "no" ]; then
  emit "location_differs=yes"
else
  emit "location_differs=no"
fi
if [ "${#CONFIGURED_IN[@]}" -gt 1 ]; then
  emit "set_in_more_than_one_place=yes"
else
  emit "set_in_more_than_one_place=no"
fi
case "${NEED_RELOAD}" in
  yes) emit "need_daemon_reload=yes" ;;
  *)   emit "need_daemon_reload=no" ;;
esac
emit "result=compared"

printf '%s' "${REPORT}"
