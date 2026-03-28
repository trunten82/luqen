# Git Host Plugin Architecture — Design Spec

**Date:** 2026-03-28
**Status:** Approved (brainstorming session)

## Overview

Replace the current system-level repo authentication with a plugin-based git host architecture. Each git platform (GitHub, GitLab, Azure DevOps) is a plugin. Admins install plugins per org. Developers store their own PAT per git host. PRs are created under the developer's identity.

## Data Model

### `git_host_configs` (org-level)

Created when an admin installs and configures a git host plugin for an org.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| org_id | TEXT NOT NULL | FK → organizations |
| plugin_type | TEXT NOT NULL | `github`, `gitlab`, `azure-devops` |
| host_url | TEXT NOT NULL | API base URL (e.g. `https://api.github.com`, `https://gitlab.company.com/api/v4`) |
| display_name | TEXT NOT NULL | Human label ("Company GitHub", "Internal GitLab") |
| created_at | TEXT NOT NULL | ISO timestamp |

Unique constraint: `(org_id, plugin_type, host_url)` — one config per host URL per org.

### `developer_credentials` (per-user, per git host)

Each developer stores their PAT for each git host they need to interact with.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| user_id | TEXT NOT NULL | FK → dashboard_users |
| git_host_config_id | TEXT NOT NULL | FK → git_host_configs |
| encrypted_token | TEXT NOT NULL | AES-256-GCM encrypted PAT |
| token_hint | TEXT NOT NULL | Last 4 chars for display (`••••abc1`) |
| validated_username | TEXT | Git host username returned during validation |
| created_at | TEXT NOT NULL | ISO timestamp |

Unique constraint: `(user_id, git_host_config_id)` — one credential per user per host config.

### `connected_repos` (modified)

Existing table changes:

| Column | Change |
|--------|--------|
| auth_token | **Remove** — credentials are now per-user |
| git_host_config_id | **Add** TEXT — FK → git_host_configs, links repo to its hosting platform |

The table continues to map website URLs to repos at the org level. One org can have many website→repo mappings.

## Plugin Interface

Each git host plugin is a TypeScript module implementing `GitHostPlugin`:

```typescript
interface GitHostPlugin {
  readonly type: 'github' | 'gitlab' | 'azure-devops';
  readonly displayName: string;

  /** Validate that a PAT works and return the authenticated username. */
  validateToken(hostUrl: string, token: string): Promise<{
    readonly valid: boolean;
    readonly username?: string;
    readonly error?: string;
  }>;

  /** Read a file from a repo at a given branch. Returns null if not found. */
  readFile(options: {
    readonly hostUrl: string;
    readonly repo: string;
    readonly path: string;
    readonly branch: string;
    readonly token: string;
  }): Promise<string | null>;

  /** List files in a directory. Used for framework detection. */
  listFiles(options: {
    readonly hostUrl: string;
    readonly repo: string;
    readonly path: string;
    readonly branch: string;
    readonly token: string;
  }): Promise<readonly string[]>;

  /** Create a branch, commit file changes, and open a PR/MR. */
  createPullRequest(options: {
    readonly hostUrl: string;
    readonly repo: string;
    readonly baseBranch: string;
    readonly headBranch: string;
    readonly title: string;
    readonly body: string;
    readonly changes: ReadonlyArray<{
      readonly path: string;
      readonly content: string;
    }>;
    readonly token: string;
  }): Promise<{
    readonly url: string;
    readonly number: number;
  }>;
}
```

### Plugin Implementations

Three built-in plugins, each in its own file under `packages/dashboard/src/plugins/git-hosts/`:

- `github.ts` — GitHub REST API v3 (`api.github.com` or GitHub Enterprise)
- `gitlab.ts` — GitLab REST API v4 (gitlab.com or self-hosted)
- `azure-devops.ts` — Azure DevOps REST API (`dev.azure.com` or on-prem TFS)

Plugins are registered at startup and available for admin installation per org. Future third-party plugins can follow the same interface.

## Permission Model

| Permission | Who | What |
|------------|-----|------|
| `repos.manage` (existing) | Org Admin+ | Link websites to repos, configure git host configs |
| `repos.credentials` (new) | Developer+ | Store/manage own git credentials |
| `issues.fix` (existing) | Developer+ | View and apply fix proposals |

The "Create PR" button on fix proposals is visible only when the user has BOTH `repos.credentials` AND `issues.fix`, AND has a valid credential stored for the repo's git host.

## Encryption

PATs are encrypted at rest using AES-256-GCM:
- Encryption key derived from `SESSION_SECRET` via HKDF (or a dedicated `GIT_TOKEN_ENCRYPTION_KEY` env var if set)
- Each token gets a unique IV
- Stored as `iv:ciphertext:authTag` in the `encrypted_token` column
- Decrypted only when making API calls, never returned to the frontend

## User Journeys

### Admin: Install git host plugin

1. Admin → Plugins → sees "GitHub", "GitLab", "Azure DevOps" in available plugins
2. Installs "GitHub" → prompted for host URL (defaults to `https://api.github.com`)
3. Gives it a display name ("Company GitHub")
4. Config saved to `git_host_configs`

### Admin: Connect website to repo

1. Admin → Repos → "Connect Repository"
2. Selects git host from dropdown (populated from org's `git_host_configs`)
3. Enters: site URL pattern, repo identifier (e.g. `owner/repo`), branch
4. Saved to `connected_repos` with `git_host_config_id`

### Developer: Store credentials

1. Developer → Profile → "Git Credentials" tab
2. Sees list of org's configured git hosts
3. Clicks "Add Token" next to "Company GitHub"
4. Enters PAT → system calls `plugin.validateToken()` → shows "Authenticated as @username"
5. Token encrypted and saved to `developer_credentials`

### Developer: Create PR from fix proposals

1. Developer views scan report for `example.com`
2. Clicks "Fixes" tab → sees proposed accessibility fixes
3. Selects fixes with checkboxes
4. Clicks "Create Pull Request"
5. System:
   a. Resolves `example.com` → `github.com/acme/website` via `connected_repos`
   b. Looks up developer's credential for that git host config
   c. Reads current file contents via `plugin.readFile()`
   d. Applies fix proposals to file contents in memory
   e. Calls `plugin.createPullRequest()` with all changed files
   f. Returns PR URL to developer
6. Developer sees "PR #42 created: https://github.com/acme/website/pull/42"

## Dashboard Routes

### Git Host Config (admin)

- `GET /admin/git-hosts` — list configured git hosts for current org
- `POST /admin/git-hosts` — create git host config (install plugin for org)
- `DELETE /admin/git-hosts/:id` — remove git host config

### Developer Credentials (user profile)

- `GET /account/git-credentials` — list user's stored credentials (token hints only)
- `POST /account/git-credentials` — validate and store a new PAT
- `DELETE /account/git-credentials/:id` — remove a stored credential

### Connected Repos (admin, modified)

- `GET /admin/repos` — existing, add git host dropdown
- `POST /admin/repos` — existing, add `gitHostConfigId` field
- Remove `authToken` field from form

### Fix Proposals (developer)

- `POST /reports/:id/fixes/create-pr` — new endpoint, creates PR from selected fixes

## Migration Plan

### Dashboard Migration 032: Git host tables

```sql
CREATE TABLE git_host_configs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plugin_type TEXT NOT NULL,
  host_url TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(org_id, plugin_type, host_url)
);

CREATE TABLE developer_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  git_host_config_id TEXT NOT NULL REFERENCES git_host_configs(id) ON DELETE CASCADE,
  encrypted_token TEXT NOT NULL,
  token_hint TEXT NOT NULL,
  validated_username TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, git_host_config_id)
);

ALTER TABLE connected_repos ADD COLUMN git_host_config_id TEXT REFERENCES git_host_configs(id);
```

Note: `auth_token` column is kept for backward compatibility but ignored. New repos use `git_host_config_id`.

### Dashboard Migration 033: Add repos.credentials permission

Add `repos.credentials` to Owner, Admin, and Member roles.

## Core Package Changes

### Source Mapper Adaptation

The source mapper currently reads files from local disk. Add an alternative `RemoteSourceMapper` that:
- Takes a `GitHostPlugin` instance + credentials + repo info
- Implements the same mapping logic but reads files via API instead of filesystem
- Falls back to the existing local filesystem mapper when `repoPath` is set

### Fix Proposer Adaptation

The fix proposer currently reads source files from disk. Add support for:
- Receiving file contents from the remote source mapper
- Returning proposed changes as `{ path, oldContent, newContent }` tuples (already close to current format)

No changes needed to the fix applier — PR creation replaces local file writing.

## Sidebar Changes

Add "Git Credentials" link under the user profile section:
- Visible when user has `repos.credentials` permission
- Links to `/account/git-credentials`

The existing "Repositories" link under admin section remains for repo connections.

## Security Considerations

- PATs are encrypted at rest (AES-256-GCM), never logged or returned to frontend
- Token validation happens server-side only
- Rate limiting on credential endpoints (5 req/15min)
- Credentials deleted when user is removed from org
- Credentials deleted when git host config is removed (CASCADE)
- Git API calls use the developer's token — permissions are whatever their PAT grants
- No admin can see or use another user's credentials

## Testing Strategy

### Unit tests (mocked)
- Each plugin's API interaction (readFile, listFiles, createPullRequest, validateToken)
- Token encryption/decryption round-trip
- Permission guard tests for all new routes
- Credential CRUD (store, list, delete)

### Integration tests (mocked HTTP)
- PR creation flow end-to-end (select fixes → resolve repo → read files → create PR)
- Token validation flow (valid PAT, invalid PAT, expired PAT)

### E2E tests (real GitHub API)
- Use the existing `trunten82` GitHub account and PAT
- **Setup**: create a private repo `trunten82/luqen-e2e-test` with a dummy HTML page containing known accessibility issues
- **Test flow**:
  1. Configure GitHub git host for the test org
  2. Store the PAT as developer credential
  3. Connect the dummy site URL to the private repo
  4. Run a scan against the dummy page
  5. Select fix proposals and create a real PR
  6. Verify PR exists on GitHub via API
  7. Close/delete the PR after verification
- E2E tests are gated behind `LUQEN_E2E_GIT=true` env var (skipped in normal CI)
- The private repo tests that token auth works (public repos don't need auth)
