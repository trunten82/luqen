#!/usr/bin/env bash
# post-comment.sh — build the Luqen gate PR comment body and upsert it.
#
# Inputs (environment variables set by action.yml step env: block):
#   GITHUB_TOKEN     — GitHub token with pull-requests: write scope
#   GITHUB_REPOSITORY — owner/repo
#   PR_NUMBER        — pull request number
#   DIFF_JSON_PATH   — path to the gate-output BaselineDiff JSON
#   ENRICHMENT_JSON_PATH — (optional) path to compliance enrichment JSON
#
# Security (T-79-06):
#   - GITHUB_TOKEN is read ONLY from the environment; never echoed, never logged,
#     never passed on argv.
#   - Comment body is written to a temp file and passed via --field body=@file.
#   - set +x is asserted before any token-adjacent lines.
#
# Fork PR handling (T-79-07):
#   - A 403 from the GitHub API is non-fatal: downgrade to ::warning:: and exit 0.

set -euo pipefail

# ---------------------------------------------------------------------------
# Validate required environment
# ---------------------------------------------------------------------------

: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${PR_NUMBER:?PR_NUMBER is required}"
: "${DIFF_JSON_PATH:?DIFF_JSON_PATH is required}"

# ---------------------------------------------------------------------------
# Build the comment body via the comment-reporter-cli entry point
# (single body-generation mechanism — no inline node -e, no alternate path)
# ---------------------------------------------------------------------------

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

if [ -n "${ENRICHMENT_JSON_PATH:-}" ] && [ -f "$ENRICHMENT_JSON_PATH" ]; then
  node packages/core/dist/comment-reporter-cli.js "$DIFF_JSON_PATH" "$ENRICHMENT_JSON_PATH" > "$BODY_FILE"
else
  node packages/core/dist/comment-reporter-cli.js "$DIFF_JSON_PATH" > "$BODY_FILE"
fi

# ---------------------------------------------------------------------------
# Upsert the sticky comment (find by <!-- luqen-gate --> marker)
# ---------------------------------------------------------------------------

MARKER='<!-- luqen-gate -->'

# Find the existing comment ID (if any)
COMMENT_ID=""
COMMENT_ID=$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" \
  --jq ".[] | select(.body | contains(\"$MARKER\")) | .id" 2>/dev/null | head -1 || true)

# T-79-06: token is never echoed; disable trace before token-adjacent operations
set +x

post_exit=0
if [ -n "$COMMENT_ID" ]; then
  # PATCH the existing comment
  GH_TOKEN="$GITHUB_TOKEN" gh api \
    "repos/$GITHUB_REPOSITORY/issues/comments/$COMMENT_ID" \
    -X PATCH \
    --field "body=@$BODY_FILE" > /dev/null 2>&1 || post_exit=$?
else
  # POST a new comment
  GH_TOKEN="$GITHUB_TOKEN" gh api \
    "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" \
    -X POST \
    --field "body=@$BODY_FILE" > /dev/null 2>&1 || post_exit=$?
fi

set -x

# ---------------------------------------------------------------------------
# T-79-07: fork PR — 403 means read-only token; degrade, do not fail the build
# ---------------------------------------------------------------------------

if [ "$post_exit" -eq 0 ]; then
  echo "Luqen gate: PR comment posted/updated."
elif [ "$post_exit" -ne 0 ]; then
  echo "::warning::Luqen gate: could not post/update PR comment (status $post_exit). This is expected for fork PRs with a read-only token."
  exit 0
fi
