# Git Host Plugins

Luqen integrates with git hosting platforms to read source files and create pull requests from accessibility fix proposals.

## Supported Platforms

| Platform | Plugin Type | Default Host URL |
|----------|------------|-----------------|
| GitHub | `github` | `https://api.github.com` |
| GitLab | `gitlab` | `https://gitlab.com/api/v4` |
| Azure DevOps | `azure-devops` | `https://dev.azure.com` |

Self-hosted instances (GitHub Enterprise, GitLab CE/EE, Azure DevOps Server) are supported — configure the appropriate host URL.

## Setup

### 1. Admin: Install a git host

Navigate to **Admin → Git Hosts → Add Git Host**:
- Select the platform type
- Enter the API host URL
- Give it a display name (e.g., "Company GitHub")

### 2. Admin: Connect websites to repos

Navigate to **Admin → Repositories → Connect Repository**:
- Enter the site URL pattern (e.g., `https://example.com%`)
- Enter the repo identifier (e.g., `owner/repo` for GitHub/GitLab, `org/project/repo` for Azure DevOps)
- Select the git host from the dropdown
- Set the branch (defaults to `main`)

### 3. Developer: Add credentials

Navigate to **Profile → Git Credentials**:
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

### 4. Developer: Create PRs from fixes

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

## Extending

To add a new git host platform, implement the `GitHostPlugin` interface:

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

Register it in `packages/dashboard/src/git-hosts/registry.ts`.
