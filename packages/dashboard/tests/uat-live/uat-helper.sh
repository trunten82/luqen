#!/bin/bash
# Stateful UAT helper for driving live dashboard flows via the real UI endpoints.
# Source this, then: uat_login user pass; uat_get /path; uat_post /path field=v...
# State (cookie jar + csrf) lives in /tmp/uat-$USERKEY.*
BASE="http://localhost:5000"

uat_login() {
  local user="$1" pass="$2"
  USERKEY="$user"
  JAR="/tmp/uat-$USERKEY.jar"
  rm -f "$JAR"
  local csrf
  csrf=$(curl -s -c "$JAR" "$BASE/login" | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/.*value="//;s/"//')
  local code
  code=$(curl -s -b "$JAR" -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/login" \
    --data-urlencode "username=$user" --data-urlencode "password=$pass" --data-urlencode "_csrf=$csrf")
  if [ "$code" != "302" ]; then echo "LOGIN FAILED ($code) for $user" >&2; return 1; fi
  # cache a page csrf token for subsequent posts
  CSRF=$(curl -s -b "$JAR" -c "$JAR" "$BASE/reports" | grep -o 'name="csrf-token" content="[^"]*"' | head -1 | sed 's/.*content="//;s/"//')
  echo "logged in: $user (csrf ${CSRF:0:8}...)"
}

uat_get() { # uat_get /path [outfile]
  local path="$1" out="${2:-/dev/null}"
  curl -s -b "$JAR" -c "$JAR" -o "$out" -w "GET $path -> %{http_code} (%{size_download}b)\n" "$BASE$path"
}

uat_post() { # uat_post /path field=value...  (form-encoded, csrf header + field)
  local path="$1"; shift
  local args=()
  for kv in "$@"; do args+=(--data-urlencode "$kv"); done
  curl -s -b "$JAR" -c "$JAR" -o /tmp/uat-last-body -w "POST $path -> %{http_code}\n" \
    -H "X-CSRF-Token: $CSRF" "${args[@]}" --data-urlencode "_csrf=$CSRF" -X POST "$BASE$path"
}

uat_post_json() { # uat_post_json /path '{"json":"body"}'
  local path="$1" body="${2:-{}}"
  curl -s -b "$JAR" -c "$JAR" -o /tmp/uat-last-body -w "POST $path -> %{http_code}\n" \
    -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" -d "$body" -X POST "$BASE$path"
}

uat_delete() { # uat_delete /path
  local path="$1"
  curl -s -b "$JAR" -c "$JAR" -o /tmp/uat-last-body -w "DELETE $path -> %{http_code}\n" \
    -H "X-CSRF-Token: $CSRF" -X DELETE "$BASE$path"
}

uat_body() { head -c "${1:-400}" /tmp/uat-last-body; echo; }
