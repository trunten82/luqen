# Git Host Plugins

Luqen integrates with git hosting platforms to read source files and create pull requests from accessibility fix proposals. Git host plugins are proper PluginManager plugins (type `git-host`), built-in to the dashboard and auto-activated on first run.

## Supported Platforms

| Platform | Plugin Name | Default Host URL |
|----------|------------|-----------------|
| GitHub | `git-host-github` | `https://api.github.com` |
| GitLab | `git-host-gitlab` | `https://gitlab.com/api/v4` |
| Azure DevOps | `git-host-azure-devops` | `https://dev.azure.com` |

Self-hosted instances (GitHub Enterprise, GitLab CE/EE, Azure DevOps Server) are supported — configure the appropriate host URL.

## Plugin Architecture

Git host plugins are registered in `plugin-registry.json` alongside catalogue plugins but differ in two ways:

1. **Built-in** — they ship with the dashboard (no tarball download required)
2. **Auto-activated** — activated automatically when the dashboard starts

They follow the standard PluginManager lifecycle (`activate`, `deactivate`, `configure`) and appear on the **Admin > Plugins** page like any other plugin.

## Setup

### 1. Global admin: Install the git-host plugin

Navigate to **Admin > Plugins** and install the git-host plugin for your platform (e.g., `git-host-github`). Click **Activate** and optionally configure the default host URL (defaults are listed in the table above). Self-hosted instances (GitHub Enterprise, GitLab CE/EE, Azure DevOps Server) should set the host URL here.

### 2. Org admin: Activate for your organisation

Navigate to **Admin > Plugins**, find the git-host plugin, and click **Activate** for your org. The plugin inherits the global default host URL — override it if your org uses a different instance.

### 3. Org admin: Configure a git host

Navigate to **Admin > Git Hosts > Add Git Host**:
- Select the platform type
- Enter the API host URL (validated against private/reserved IP ranges for SSRF protection)
- Give it a display name (e.g., "Company GitHub")
- Select the organization scope from the dropdown

### 4. Org admin: Connect websites to repos

Navigate to **Admin > Connected Repos > Connect Repository**:
- Enter the site URL pattern (e.g., `https://example.com%`)
- Enter the repo identifier (e.g., `owner/repo` for GitHub/GitLab, `org/project/repo` for Azure DevOps)
- Select the git host from the dropdown
- Select the organization from the org dropdown (org-scoped)
- Set the branch (defaults to `main`)

### 5. Developer: Add credentials

Navigate to **Profile > Git Credentials** (also accessible via the sidebar Repositories section):
- For each configured git host, click "Validate & Save"
- Enter your Personal Access Token (PAT)
- The system validates it against the git host API and shows your username
- Token is encrypted at rest and never shown again

### PAT Requirements

| Platform | Required Scopes |
|----------|----------------|
| GitHub | `repo` (Full control of private repositories) |
| GitLab | `api` (Full API access) |
| Azure DevOps | Code (Read & Write), Pull Request Contribute |

### 6. Developer: Create PRs from fixes

1. Run a scan on a connected website
2. View the scan report → Fixes tab
3. Select the fixes you want to apply
4. Click "Create Pull Request"
5. The system reads source files, applies fixes, and opens a PR under your name

## Security

- PATs are encrypted at rest using AES-256-GCM
- Each developer stores their own credentials — no shared tokens
- Admins cannot see or use developer tokens
- Credentials are deleted when the git host config is removed (cascade)
- Credentials are scoped to the user — one PAT per git host per developer
- **SSRF protection** — all git host API URLs are validated against private/reserved IP ranges (IPv4 loopback, link-local, RFC 1918, IPv6 loopback and link-local) before any outbound request. 15 unit tests cover all private IP ranges.

## Extending

To add a new git host platform, implement the `GitHostPlugin` interface and register it as a PluginManager plugin (type `git-host`):

```typescript
interface GitHostPlugin {
  readonly type: string;
  readonly displayName: string;
  validateToken(hostUrl: string, token: string): Promise<GitHostValidation>;
  readFile(options: ReadFileOptions): Promise<string | null>;
  listFiles(options: ReadFileOptions): Promise<readonly string[]>;
  createPullRequest(options: CreatePullRequestOptions): Promise<GitHostPullRequest>;
}
```

Add the plugin entry to `packages/dashboard/plugin-registry.json` with type `git-host` and a `configSchema` array defining the host URL field.
