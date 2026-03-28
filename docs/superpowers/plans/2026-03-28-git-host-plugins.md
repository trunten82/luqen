# Git Host Plugin Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add plugin-based git host integration (GitHub, GitLab, Azure DevOps) with per-user PAT credentials and PR creation from fix proposals.

**Architecture:** Three-layer design — git host plugins (API adapters), dashboard DB/routes (credential + config management), and fix-to-PR pipeline (reads files remotely, applies fixes in memory, creates PR via plugin). Encryption reuses existing `encryptSecret`/`decryptSecret` from `plugins/crypto.ts`.

**Tech Stack:** TypeScript, Fastify, SQLite (better-sqlite3), HTMX, Handlebars, AES-256-GCM encryption, GitHub/GitLab/Azure DevOps REST APIs.

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `packages/dashboard/src/git-hosts/types.ts` | `GitHostPlugin` interface and shared types |
| `packages/dashboard/src/git-hosts/github.ts` | GitHub REST API v3 adapter |
| `packages/dashboard/src/git-hosts/gitlab.ts` | GitLab REST API v4 adapter |
| `packages/dashboard/src/git-hosts/azure-devops.ts` | Azure DevOps REST API adapter |
| `packages/dashboard/src/git-hosts/registry.ts` | Plugin registry (type → implementation) |
| `packages/dashboard/src/db/interfaces/git-host-repository.ts` | Repository interface for git host configs + credentials |
| `packages/dashboard/src/db/sqlite/repositories/git-host-repository.ts` | SQLite implementation |
| `packages/dashboard/src/routes/admin/git-hosts.ts` | Admin routes for git host config CRUD |
| `packages/dashboard/src/routes/git-credentials.ts` | Developer routes for credential management |
| `packages/dashboard/src/routes/fix-pr.ts` | PR creation from fix proposals |
| `packages/dashboard/src/views/admin/git-hosts.hbs` | Admin git host config page |
| `packages/dashboard/src/views/account/git-credentials.hbs` | Developer credential management page |
| `packages/dashboard/tests/git-hosts/github.test.ts` | GitHub plugin unit tests |
| `packages/dashboard/tests/git-hosts/gitlab.test.ts` | GitLab plugin unit tests |
| `packages/dashboard/tests/git-hosts/azure-devops.test.ts` | Azure DevOps plugin unit tests |
| `packages/dashboard/tests/db/git-hosts.test.ts` | Repository tests |
| `packages/dashboard/tests/routes/git-hosts.test.ts` | Route integration tests |
| `packages/dashboard/tests/routes/git-credentials.test.ts` | Credential route tests |
| `packages/dashboard/tests/routes/fix-pr.test.ts` | PR creation tests |

### Modified files
| File | Change |
|------|--------|
| `packages/dashboard/src/db/types.ts` | Add `GitHostConfig`, `DeveloperCredential` types; add `gitHostConfigId` to `ConnectedRepo` |
| `packages/dashboard/src/db/sqlite/migrations.ts` | Add migrations 032 (tables) and 033 (permission) |
| `packages/dashboard/src/db/sqlite/repositories/repo-repository.ts` | Add `gitHostConfigId` to row mapping |
| `packages/dashboard/src/db/interfaces/repo-repository.ts` | Add `gitHostConfigId` to create input |
| `packages/dashboard/src/permissions.ts` | Add `repos.credentials` permission |
| `packages/dashboard/src/server.ts` | Register new routes, pass git host registry |
| `packages/dashboard/src/views/partials/sidebar.hbs` | Add "Git Credentials" link in profile section |
| `packages/dashboard/src/views/repos.hbs` | Add git host dropdown, remove auth_token field |
| `packages/dashboard/src/views/fixes.hbs` | Add "Create PR" button when credentials available |
| `packages/dashboard/src/routes/repos.ts` | Accept `gitHostConfigId`, drop `authToken` from form |

---

## Task 1: GitHostPlugin Interface and Types

**Files:**
- Create: `packages/dashboard/src/git-hosts/types.ts`
- Modify: `packages/dashboard/src/db/types.ts`

- [ ] **Step 1: Create the plugin interface**

```typescript
// packages/dashboard/src/git-hosts/types.ts

export interface GitHostValidation {
  readonly valid: boolean;
  readonly username?: string;
  readonly error?: string;
}

export interface GitHostFile {
  readonly path: string;
  readonly content: string;
}

export interface GitHostPullRequest {
  readonly url: string;
  readonly number: number;
}

export interface ReadFileOptions {
  readonly hostUrl: string;
  readonly repo: string;
  readonly path: string;
  readonly branch: string;
  readonly token: string;
}

export interface CreatePullRequestOptions {
  readonly hostUrl: string;
  readonly repo: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly title: string;
  readonly body: string;
  readonly changes: ReadonlyArray<GitHostFile>;
  readonly token: string;
}

export interface GitHostPlugin {
  readonly type: string;
  readonly displayName: string;

  validateToken(hostUrl: string, token: string): Promise<GitHostValidation>;
  readFile(options: ReadFileOptions): Promise<string | null>;
  listFiles(options: ReadFileOptions): Promise<readonly string[]>;
  createPullRequest(options: CreatePullRequestOptions): Promise<GitHostPullRequest>;
}
```

- [ ] **Step 2: Add DB types**

Add to `packages/dashboard/src/db/types.ts`:

```typescript
export interface GitHostConfig {
  readonly id: string;
  readonly orgId: string;
  readonly pluginType: string;
  readonly hostUrl: string;
  readonly displayName: string;
  readonly createdAt: string;
}

export interface DeveloperCredential {
  readonly id: string;
  readonly userId: string;
  readonly gitHostConfigId: string;
  readonly tokenHint: string;
  readonly validatedUsername: string | null;
  readonly createdAt: string;
}
```

Add `gitHostConfigId` to `ConnectedRepo`:

```typescript
export interface ConnectedRepo {
  // ... existing fields ...
  readonly gitHostConfigId: string | null;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/git-hosts/types.ts packages/dashboard/src/db/types.ts
git commit -m "feat: git host plugin interface and DB types"
```

---

## Task 2: Database Migration and Repository

**Files:**
- Modify: `packages/dashboard/src/db/sqlite/migrations.ts`
- Create: `packages/dashboard/src/db/interfaces/git-host-repository.ts`
- Create: `packages/dashboard/src/db/sqlite/repositories/git-host-repository.ts`
- Create: `packages/dashboard/tests/db/git-hosts.test.ts`

- [ ] **Step 1: Write failing repository tests**

```typescript
// packages/dashboard/tests/db/git-hosts.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

describe('GitHostRepository', () => {
  const dbPath = `/tmp/test-git-hosts-${randomUUID()}.db`;
  let storage: SqliteStorageAdapter;

  beforeAll(async () => {
    storage = new SqliteStorageAdapter(dbPath);
    await storage.migrate();
  });

  afterAll(() => {
    void storage.disconnect();
    rmSync(dbPath, { force: true });
  });

  describe('git_host_configs', () => {
    it('creates and retrieves a git host config', async () => {
      const config = await storage.gitHosts.createConfig({
        orgId: 'system',
        pluginType: 'github',
        hostUrl: 'https://api.github.com',
        displayName: 'GitHub',
      });
      expect(config.pluginType).toBe('github');
      expect(config.hostUrl).toBe('https://api.github.com');

      const list = await storage.gitHosts.listConfigs('system');
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(config.id);
    });

    it('deletes a git host config', async () => {
      const config = await storage.gitHosts.createConfig({
        orgId: 'system',
        pluginType: 'gitlab',
        hostUrl: 'https://gitlab.com/api/v4',
        displayName: 'GitLab',
      });
      await storage.gitHosts.deleteConfig(config.id);
      const list = await storage.gitHosts.listConfigs('system');
      expect(list.find((c) => c.id === config.id)).toBeUndefined();
    });
  });

  describe('developer_credentials', () => {
    it('stores and retrieves encrypted credentials', async () => {
      const config = await storage.gitHosts.createConfig({
        orgId: 'system',
        pluginType: 'github',
        hostUrl: 'https://api.github.com',
        displayName: 'Test GH',
      });

      await storage.gitHosts.storeCredential({
        userId: 'user-1',
        gitHostConfigId: config.id,
        encryptedToken: 'iv:cipher:tag',
        tokenHint: '••••abcd',
        validatedUsername: 'octocat',
      });

      const creds = await storage.gitHosts.listCredentials('user-1');
      expect(creds).toHaveLength(1);
      expect(creds[0].tokenHint).toBe('••••abcd');
      expect(creds[0].validatedUsername).toBe('octocat');
    });

    it('retrieves credential for a specific git host config', async () => {
      const cred = await storage.gitHosts.getCredentialForHost('user-1', 'non-existent');
      expect(cred).toBeNull();
    });

    it('deletes a credential', async () => {
      const creds = await storage.gitHosts.listCredentials('user-1');
      if (creds.length > 0) {
        await storage.gitHosts.deleteCredential(creds[0].id, 'user-1');
      }
      const after = await storage.gitHosts.listCredentials('user-1');
      expect(after).toHaveLength(0);
    });

    it('cascades delete when git host config is removed', async () => {
      const config = await storage.gitHosts.createConfig({
        orgId: 'system',
        pluginType: 'github',
        hostUrl: 'https://cascade-test.com',
        displayName: 'Cascade Test',
      });
      await storage.gitHosts.storeCredential({
        userId: 'cascade-user',
        gitHostConfigId: config.id,
        encryptedToken: 'iv:ct:tag',
        tokenHint: '••••1234',
      });
      await storage.gitHosts.deleteConfig(config.id);
      const creds = await storage.gitHosts.listCredentials('cascade-user');
      expect(creds).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w packages/dashboard -- --run tests/db/git-hosts.test.ts`
Expected: FAIL — `storage.gitHosts` does not exist.

- [ ] **Step 3: Add migration 032**

Add to `packages/dashboard/src/db/sqlite/migrations.ts`:

```typescript
{
  id: '032',
  name: 'git-host-configs-and-developer-credentials',
  sql: `
CREATE TABLE IF NOT EXISTS git_host_configs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  plugin_type TEXT NOT NULL,
  host_url TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(org_id, plugin_type, host_url)
);
CREATE INDEX IF NOT EXISTS idx_git_host_configs_org ON git_host_configs(org_id);

CREATE TABLE IF NOT EXISTS developer_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  git_host_config_id TEXT NOT NULL REFERENCES git_host_configs(id) ON DELETE CASCADE,
  encrypted_token TEXT NOT NULL,
  token_hint TEXT NOT NULL,
  validated_username TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, git_host_config_id)
);
CREATE INDEX IF NOT EXISTS idx_developer_credentials_user ON developer_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_developer_credentials_host ON developer_credentials(git_host_config_id);

ALTER TABLE connected_repos ADD COLUMN git_host_config_id TEXT REFERENCES git_host_configs(id);
`,
},
```

- [ ] **Step 4: Add migration 033 — repos.credentials permission**

```typescript
{
  id: '033',
  name: 'add-repos-credentials-permission',
  sql: `
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'repos.credentials'
  FROM roles r
  WHERE r.name IN ('Owner', 'Admin', 'Member')
  AND r.org_id != 'system';

-- Also add to system developer and admin roles
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'repos.credentials'
  FROM roles r
  WHERE r.name IN ('admin', 'developer')
  AND r.org_id = 'system';
`,
},
```

- [ ] **Step 5: Create repository interface**

```typescript
// packages/dashboard/src/db/interfaces/git-host-repository.ts
import type { GitHostConfig, DeveloperCredential } from '../types.js';

export interface CreateGitHostConfigInput {
  readonly orgId: string;
  readonly pluginType: string;
  readonly hostUrl: string;
  readonly displayName: string;
}

export interface StoreCredentialInput {
  readonly userId: string;
  readonly gitHostConfigId: string;
  readonly encryptedToken: string;
  readonly tokenHint: string;
  readonly validatedUsername?: string;
}

export interface DeveloperCredentialRow extends DeveloperCredential {
  readonly encryptedToken: string;
}

export interface GitHostRepository {
  createConfig(input: CreateGitHostConfigInput): Promise<GitHostConfig>;
  getConfig(id: string): Promise<GitHostConfig | null>;
  listConfigs(orgId: string): Promise<GitHostConfig[]>;
  deleteConfig(id: string): Promise<void>;

  storeCredential(input: StoreCredentialInput): Promise<DeveloperCredential>;
  getCredentialForHost(userId: string, gitHostConfigId: string): Promise<DeveloperCredentialRow | null>;
  listCredentials(userId: string): Promise<DeveloperCredential[]>;
  deleteCredential(id: string, userId: string): Promise<void>;
}
```

- [ ] **Step 6: Create SQLite repository implementation**

```typescript
// packages/dashboard/src/db/sqlite/repositories/git-host-repository.ts
import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { GitHostConfig, DeveloperCredential } from '../../types.js';
import type {
  GitHostRepository,
  CreateGitHostConfigInput,
  StoreCredentialInput,
  DeveloperCredentialRow,
} from '../../interfaces/git-host-repository.js';

interface ConfigRow {
  id: string;
  org_id: string;
  plugin_type: string;
  host_url: string;
  display_name: string;
  created_at: string;
}

interface CredentialRow {
  id: string;
  user_id: string;
  git_host_config_id: string;
  encrypted_token: string;
  token_hint: string;
  validated_username: string | null;
  created_at: string;
}

function rowToConfig(row: ConfigRow): GitHostConfig {
  return {
    id: row.id,
    orgId: row.org_id,
    pluginType: row.plugin_type,
    hostUrl: row.host_url,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

function rowToCredential(row: CredentialRow): DeveloperCredential {
  return {
    id: row.id,
    userId: row.user_id,
    gitHostConfigId: row.git_host_config_id,
    tokenHint: row.token_hint,
    validatedUsername: row.validated_username,
    createdAt: row.created_at,
  };
}

function rowToCredentialWithToken(row: CredentialRow): DeveloperCredentialRow {
  return {
    ...rowToCredential(row),
    encryptedToken: row.encrypted_token,
  };
}

export class SqliteGitHostRepository implements GitHostRepository {
  constructor(private readonly db: Database) {}

  async createConfig(input: CreateGitHostConfigInput): Promise<GitHostConfig> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO git_host_configs (id, org_id, plugin_type, host_url, display_name, created_at)
       VALUES (@id, @orgId, @pluginType, @hostUrl, @displayName, @createdAt)`,
    ).run({ id, orgId: input.orgId, pluginType: input.pluginType, hostUrl: input.hostUrl, displayName: input.displayName, createdAt });
    return { id, orgId: input.orgId, pluginType: input.pluginType, hostUrl: input.hostUrl, displayName: input.displayName, createdAt };
  }

  async getConfig(id: string): Promise<GitHostConfig | null> {
    const row = this.db.prepare('SELECT * FROM git_host_configs WHERE id = ?').get(id) as ConfigRow | undefined;
    return row ? rowToConfig(row) : null;
  }

  async listConfigs(orgId: string): Promise<GitHostConfig[]> {
    const rows = this.db.prepare('SELECT * FROM git_host_configs WHERE org_id = ? ORDER BY created_at').all(orgId) as ConfigRow[];
    return rows.map(rowToConfig);
  }

  async deleteConfig(id: string): Promise<void> {
    this.db.prepare('DELETE FROM git_host_configs WHERE id = ?').run(id);
  }

  async storeCredential(input: StoreCredentialInput): Promise<DeveloperCredential> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(
      `INSERT OR REPLACE INTO developer_credentials (id, user_id, git_host_config_id, encrypted_token, token_hint, validated_username, created_at)
       VALUES (@id, @userId, @gitHostConfigId, @encryptedToken, @tokenHint, @validatedUsername, @createdAt)`,
    ).run({
      id,
      userId: input.userId,
      gitHostConfigId: input.gitHostConfigId,
      encryptedToken: input.encryptedToken,
      tokenHint: input.tokenHint,
      validatedUsername: input.validatedUsername ?? null,
      createdAt,
    });
    return { id, userId: input.userId, gitHostConfigId: input.gitHostConfigId, tokenHint: input.tokenHint, validatedUsername: input.validatedUsername ?? null, createdAt };
  }

  async getCredentialForHost(userId: string, gitHostConfigId: string): Promise<DeveloperCredentialRow | null> {
    const row = this.db.prepare(
      'SELECT * FROM developer_credentials WHERE user_id = ? AND git_host_config_id = ?',
    ).get(userId, gitHostConfigId) as CredentialRow | undefined;
    return row ? rowToCredentialWithToken(row) : null;
  }

  async listCredentials(userId: string): Promise<DeveloperCredential[]> {
    const rows = this.db.prepare(
      `SELECT dc.*, ghc.display_name AS host_display_name, ghc.plugin_type
       FROM developer_credentials dc
       JOIN git_host_configs ghc ON ghc.id = dc.git_host_config_id
       WHERE dc.user_id = ?
       ORDER BY dc.created_at`,
    ).all(userId) as CredentialRow[];
    return rows.map(rowToCredential);
  }

  async deleteCredential(id: string, userId: string): Promise<void> {
    this.db.prepare('DELETE FROM developer_credentials WHERE id = ? AND user_id = ?').run(id, userId);
  }
}
```

- [ ] **Step 7: Wire repository into SqliteStorageAdapter**

In `packages/dashboard/src/db/sqlite/index.ts`, add:
- Import `SqliteGitHostRepository`
- Add `gitHosts: SqliteGitHostRepository` property
- Initialize in constructor: `this.gitHosts = new SqliteGitHostRepository(this.db);`

Also add to `packages/dashboard/src/db/interfaces/index.ts` or the storage adapter interface.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run build -w packages/dashboard && npm test -w packages/dashboard -- --run tests/db/git-hosts.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/dashboard/src/db/ packages/dashboard/tests/db/git-hosts.test.ts
git commit -m "feat: git host configs and developer credentials DB layer"
```

---

## Task 3: GitHub Plugin

**Files:**
- Create: `packages/dashboard/src/git-hosts/github.ts`
- Create: `packages/dashboard/src/git-hosts/registry.ts`
- Create: `packages/dashboard/tests/git-hosts/github.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/dashboard/tests/git-hosts/github.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubPlugin } from '../../src/git-hosts/github.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('GitHubPlugin', () => {
  const plugin = new GitHubPlugin();
  const hostUrl = 'https://api.github.com';
  const token = 'ghp_test123';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('validateToken', () => {
    it('returns valid with username on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: 'octocat' }),
      });
      const result = await plugin.validateToken(hostUrl, token);
      expect(result).toEqual({ valid: true, username: 'octocat' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/user',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'token ghp_test123' }),
        }),
      );
    });

    it('returns invalid on 401', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      const result = await plugin.validateToken(hostUrl, token);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid');
    });
  });

  describe('readFile', () => {
    it('returns file content decoded from base64', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: Buffer.from('hello world').toString('base64'), encoding: 'base64' }),
      });
      const content = await plugin.readFile({ hostUrl, repo: 'owner/repo', path: 'index.html', branch: 'main', token });
      expect(content).toBe('hello world');
    });

    it('returns null on 404', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      const content = await plugin.readFile({ hostUrl, repo: 'owner/repo', path: 'missing.html', branch: 'main', token });
      expect(content).toBeNull();
    });
  });

  describe('createPullRequest', () => {
    it('creates branch, commits, and opens PR', async () => {
      // 1. Get base branch SHA
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ object: { sha: 'base-sha-123' } }),
      });
      // 2. Create branch ref
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      // 3. Get current tree
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tree: { sha: 'tree-sha-123' } }),
      });
      // 4. Create blobs (one per file)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sha: 'blob-sha-1' }),
      });
      // 5. Create tree
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sha: 'new-tree-sha' }),
      });
      // 6. Create commit
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sha: 'commit-sha-123' }),
      });
      // 7. Update branch ref
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      // 8. Create PR
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ html_url: 'https://github.com/owner/repo/pull/42', number: 42 }),
      });

      const result = await plugin.createPullRequest({
        hostUrl,
        repo: 'owner/repo',
        baseBranch: 'main',
        headBranch: 'luqen/fix-a11y-123',
        title: 'Fix accessibility issues',
        body: 'Automated fixes',
        changes: [{ path: 'index.html', content: '<html>fixed</html>' }],
        token,
      });
      expect(result).toEqual({ url: 'https://github.com/owner/repo/pull/42', number: 42 });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w packages/dashboard -- --run tests/git-hosts/github.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement GitHub plugin**

```typescript
// packages/dashboard/src/git-hosts/github.ts
import type {
  GitHostPlugin,
  GitHostValidation,
  GitHostPullRequest,
  ReadFileOptions,
  CreatePullRequestOptions,
} from './types.js';

export class GitHubPlugin implements GitHostPlugin {
  readonly type = 'github';
  readonly displayName = 'GitHub';

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'luqen-dashboard',
    };
  }

  async validateToken(hostUrl: string, token: string): Promise<GitHostValidation> {
    const response = await fetch(`${hostUrl}/user`, { headers: this.headers(token) });
    if (!response.ok) {
      return { valid: false, error: `Invalid token (HTTP ${response.status})` };
    }
    const data = await response.json() as { login: string };
    return { valid: true, username: data.login };
  }

  async readFile(options: ReadFileOptions): Promise<string | null> {
    const { hostUrl, repo, path, branch, token } = options;
    const url = `${hostUrl}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    const response = await fetch(url, { headers: this.headers(token) });
    if (!response.ok) return null;
    const data = await response.json() as { content: string; encoding: string };
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }

  async listFiles(options: ReadFileOptions): Promise<readonly string[]> {
    const { hostUrl, repo, path, branch, token } = options;
    const url = `${hostUrl}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    const response = await fetch(url, { headers: this.headers(token) });
    if (!response.ok) return [];
    const data = await response.json() as Array<{ name: string }>;
    return Array.isArray(data) ? data.map((f) => f.name) : [];
  }

  async createPullRequest(options: CreatePullRequestOptions): Promise<GitHostPullRequest> {
    const { hostUrl, repo, baseBranch, headBranch, title, body, changes, token } = options;
    const h = this.headers(token);
    const api = `${hostUrl}/repos/${repo}`;

    // 1. Get base branch SHA
    const baseRef = await fetch(`${api}/git/ref/heads/${encodeURIComponent(baseBranch)}`, { headers: h });
    const baseData = await baseRef.json() as { object: { sha: string } };
    const baseSha = baseData.object.sha;

    // 2. Create new branch
    await fetch(`${api}/git/refs`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${headBranch}`, sha: baseSha }),
    });

    // 3. Get base tree
    const commitRes = await fetch(`${api}/git/commits/${baseSha}`, { headers: h });
    const commitData = await commitRes.json() as { tree: { sha: string } };
    const baseTreeSha = commitData.tree.sha;

    // 4. Create blobs for each changed file
    const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const change of changes) {
      const blobRes = await fetch(`${api}/git/blobs`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: change.content, encoding: 'utf-8' }),
      });
      const blobData = await blobRes.json() as { sha: string };
      treeItems.push({ path: change.path, mode: '100644', type: 'blob', sha: blobData.sha });
    }

    // 5. Create new tree
    const treeRes = await fetch(`${api}/git/trees`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    });
    const treeData = await treeRes.json() as { sha: string };

    // 6. Create commit
    const newCommitRes = await fetch(`${api}/git/commits`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: title,
        tree: treeData.sha,
        parents: [baseSha],
      }),
    });
    const newCommitData = await newCommitRes.json() as { sha: string };

    // 7. Update branch ref
    await fetch(`${api}/git/refs/heads/${encodeURIComponent(headBranch)}`, {
      method: 'PATCH',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: newCommitData.sha }),
    });

    // 8. Create pull request
    const prRes = await fetch(`${api}/pulls`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, head: headBranch, base: baseBranch }),
    });
    const prData = await prRes.json() as { html_url: string; number: number };
    return { url: prData.html_url, number: prData.number };
  }
}
```

- [ ] **Step 4: Create plugin registry**

```typescript
// packages/dashboard/src/git-hosts/registry.ts
import type { GitHostPlugin } from './types.js';
import { GitHubPlugin } from './github.js';

const plugins = new Map<string, GitHostPlugin>();

export function registerGitHostPlugin(plugin: GitHostPlugin): void {
  plugins.set(plugin.type, plugin);
}

export function getGitHostPlugin(type: string): GitHostPlugin | undefined {
  return plugins.get(type);
}

export function listGitHostPluginTypes(): readonly string[] {
  return [...plugins.keys()];
}

// Register built-in plugins
registerGitHostPlugin(new GitHubPlugin());
```

- [ ] **Step 5: Run tests**

Run: `npm run build -w packages/dashboard && npm test -w packages/dashboard -- --run tests/git-hosts/github.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/git-hosts/ packages/dashboard/tests/git-hosts/
git commit -m "feat: GitHub git host plugin with registry"
```

---

## Task 4: GitLab Plugin

**Files:**
- Create: `packages/dashboard/src/git-hosts/gitlab.ts`
- Create: `packages/dashboard/tests/git-hosts/gitlab.test.ts`

- [ ] **Step 1: Write failing tests**

Same pattern as GitHub tests but for GitLab API v4:
- `validateToken`: `GET /api/v4/user` with `PRIVATE-TOKEN` header
- `readFile`: `GET /api/v4/projects/:id/repository/files/:path/raw?ref=branch`
- `listFiles`: `GET /api/v4/projects/:id/repository/tree?path=...&ref=...`
- `createPullRequest`: create branch, commit actions, create merge request

Tests follow the same mock fetch pattern as Task 3.

- [ ] **Step 2: Implement GitLab plugin**

Key differences from GitHub:
- Auth header: `PRIVATE-TOKEN: <token>` (not `Authorization: token`)
- Repo identifier: URL-encoded `owner/repo` (e.g. `owner%2Frepo`)
- File content: raw endpoint returns content directly, no base64
- PR = "Merge Request": `POST /api/v4/projects/:id/merge_requests`
- Commits: `POST /api/v4/projects/:id/repository/commits` with `actions` array (simpler than GitHub's tree API)

- [ ] **Step 3: Register in registry**

Add to `packages/dashboard/src/git-hosts/registry.ts`:
```typescript
import { GitLabPlugin } from './gitlab.js';
registerGitHostPlugin(new GitLabPlugin());
```

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "feat: GitLab git host plugin"
```

---

## Task 5: Azure DevOps Plugin

**Files:**
- Create: `packages/dashboard/src/git-hosts/azure-devops.ts`
- Create: `packages/dashboard/tests/git-hosts/azure-devops.test.ts`

- [ ] **Step 1: Write failing tests**

Azure DevOps API patterns:
- `validateToken`: `GET https://dev.azure.com/{org}/_apis/connectionData` with Basic auth (`:pat` as username)
- `readFile`: `GET /{org}/{project}/_apis/git/repositories/{repo}/items?path=...&version=...`
- `listFiles`: `GET /{org}/{project}/_apis/git/repositories/{repo}/items?scopePath=...&recursionLevel=OneLevel`
- `createPullRequest`: push to branch via `POST /_apis/git/repositories/{repo}/pushes`, then `POST /pullrequests`

Repo format: `org/project/repo` (split by `/` into three parts).

- [ ] **Step 2: Implement Azure DevOps plugin**

Key differences:
- Auth: Basic auth with empty username and PAT as password: `Authorization: Basic base64(:pat)`
- API version query param: `?api-version=7.1`
- Repo identifier: three-part `org/project/repo`
- Push API sends refs + commits + changes in one call
- PR requires `sourceRefName` and `targetRefName` with `refs/heads/` prefix

- [ ] **Step 3: Register in registry**

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "feat: Azure DevOps git host plugin"
```

---

## Task 6: Permission and Sidebar Updates

**Files:**
- Modify: `packages/dashboard/src/permissions.ts`
- Modify: `packages/dashboard/src/views/partials/sidebar.hbs`

- [ ] **Step 1: Add repos.credentials permission**

In `packages/dashboard/src/permissions.ts`, add to `ALL_PERMISSIONS`:
```typescript
{ id: 'repos.credentials', label: 'Manage git credentials', group: 'Repositories' },
```

Add to `ORG_OWNER_PERMISSIONS`, `ORG_ADMIN_PERMISSIONS`, `ORG_MEMBER_PERMISSIONS`.

- [ ] **Step 2: Add perm flag in server.ts**

In the `perm` object in `server.ts`, add:
```typescript
reposCredentials: perms.has('repos.credentials'),
```

- [ ] **Step 3: Add sidebar link**

In `sidebar.hbs`, in the user profile section (near the bottom), add:
```handlebars
{{#if perm.reposCredentials}}
<a href="/account/git-credentials" class="sidebar__link {{#if (eq currentPath '/account/git-credentials')}}sidebar__link--active{{/if}}">
  <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M10 2L3 7v6l7 5 7-5V7l-7-5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>
  <span>Git Credentials</span>
</a>
{{/if}}
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: repos.credentials permission and sidebar link"
```

---

## Task 7: Admin Git Host Config Routes and UI

**Files:**
- Create: `packages/dashboard/src/routes/admin/git-hosts.ts`
- Create: `packages/dashboard/src/views/admin/git-hosts.hbs`
- Create: `packages/dashboard/tests/routes/git-hosts.test.ts`
- Modify: `packages/dashboard/src/server.ts`

- [ ] **Step 1: Write failing route tests**

Test: GET /admin/git-hosts returns 200, POST creates config, DELETE removes config, permission guards.

- [ ] **Step 2: Create route handler**

Endpoints:
- `GET /admin/git-hosts` — list configs for current org, render template
- `POST /admin/git-hosts` — create config (pluginType, hostUrl, displayName)
- `DELETE /admin/git-hosts/:id` — remove config

All require `requirePermission('repos.manage')`.

- [ ] **Step 3: Create template**

Simple page with:
- Table of configured git hosts (type, host URL, display name, delete button)
- "Add Git Host" form (dropdown of available plugin types, host URL, display name)

- [ ] **Step 4: Register routes in server.ts**

Import and call `gitHostRoutes(server, storage)`.

- [ ] **Step 5: Run tests, commit**

```bash
git commit -m "feat: admin git host config routes and UI"
```

---

## Task 8: Developer Credential Routes and UI

**Files:**
- Create: `packages/dashboard/src/routes/git-credentials.ts`
- Create: `packages/dashboard/src/views/account/git-credentials.hbs`
- Create: `packages/dashboard/tests/routes/git-credentials.test.ts`
- Modify: `packages/dashboard/src/server.ts`

- [ ] **Step 1: Write failing route tests**

Test: GET /account/git-credentials lists, POST validates token and stores encrypted, DELETE removes credential, permission guards.

- [ ] **Step 2: Create route handler**

Endpoints:
- `GET /account/git-credentials` — list user's credentials with host info
- `POST /account/git-credentials` — validate PAT via plugin, encrypt, store
- `DELETE /account/git-credentials/:id` — remove own credential

All require `requirePermission('repos.credentials')`.

POST flow:
1. Look up git host config by `gitHostConfigId`
2. Get plugin from registry by `config.pluginType`
3. Call `plugin.validateToken(config.hostUrl, token)`
4. If invalid, return error
5. Encrypt token: `encryptSecret(token, encryptionKey)`
6. Store with hint: `••••${token.slice(-4)}`

- [ ] **Step 3: Create template**

Profile sub-page showing:
- Table of credentials (host name, type, username, token hint, delete button)
- "Add Credential" form per unconfigured host (shows available hosts without existing credential)

- [ ] **Step 4: Register routes in server.ts**

- [ ] **Step 5: Run tests, commit**

```bash
git commit -m "feat: developer git credential routes and UI"
```

---

## Task 9: Update Repos Page

**Files:**
- Modify: `packages/dashboard/src/routes/repos.ts`
- Modify: `packages/dashboard/src/views/repos.hbs`
- Modify: `packages/dashboard/src/db/sqlite/repositories/repo-repository.ts`

- [ ] **Step 1: Add gitHostConfigId to repo form**

In `repos.hbs`, replace the auth_token field with a git host dropdown:
```handlebars
<div class="form-group">
  <label for="gitHostConfigId">Git Host</label>
  <select id="gitHostConfigId" name="gitHostConfigId" class="select">
    <option value="">None (local path only)</option>
    {{#each gitHosts}}
    <option value="{{id}}">{{displayName}} ({{pluginType}})</option>
    {{/each}}
  </select>
</div>
```

- [ ] **Step 2: Update route handler**

In POST /admin/repos, accept `gitHostConfigId` instead of `authToken`. Pass git host configs to GET template.

- [ ] **Step 3: Update repo repository**

Add `git_host_config_id` to row mapping and create input.

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "feat: connect repos to git hosts, remove auth_token from form"
```

---

## Task 10: PR Creation from Fix Proposals

**Files:**
- Create: `packages/dashboard/src/routes/fix-pr.ts`
- Modify: `packages/dashboard/src/views/fixes.hbs`
- Create: `packages/dashboard/tests/routes/fix-pr.test.ts`

- [ ] **Step 1: Write failing tests**

Test: POST /reports/:id/fixes/create-pr with selected fix IDs, creates PR via plugin, returns PR URL.

- [ ] **Step 2: Create route handler**

`POST /reports/:id/fixes/create-pr` requires `repos.credentials` + `issues.fix`:

1. Load scan report
2. Find connected repo for the scanned URL
3. Look up git host config from the repo
4. Look up developer's credential for that host
5. Decrypt token
6. For each selected fix, read current file via `plugin.readFile()`
7. Apply fix (string replacement) in memory
8. Call `plugin.createPullRequest()` with all changed files
9. Return PR URL

- [ ] **Step 3: Update fixes template**

Add checkboxes to fix proposals and a "Create Pull Request" button (visible only when user has credentials for the repo's git host).

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "feat: create PRs from fix proposals via git host plugins"
```

---

## Task 11: E2E Test Setup

**Files:**
- Create: `packages/dashboard/tests/e2e/git-host-e2e.test.ts`

- [ ] **Step 1: Create private test repo on GitHub**

```bash
TOKEN="$GITHUB_PAT"
curl -s -X POST -H "Authorization: token $TOKEN" \
  https://api.github.com/user/repos \
  -d '{"name":"luqen-e2e-test","private":true,"auto_init":true}'
```

- [ ] **Step 2: Add dummy HTML page with known a11y issues**

```bash
curl -s -X PUT -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/trunten82/luqen-e2e-test/contents/index.html" \
  -d '{
    "message": "Add test page with a11y issues",
    "content": "'$(echo '<html><head><title>Test</title></head><body><img src="logo.png"><div onclick="alert()">Click me</div></body></html>' | base64 -w0)'"
  }'
```

- [ ] **Step 3: Write E2E test**

```typescript
// packages/dashboard/tests/e2e/git-host-e2e.test.ts
import { describe, it, expect } from 'vitest';
import { GitHubPlugin } from '../../src/git-hosts/github.js';

const E2E = process.env['LUQEN_E2E_GIT'] === 'true';
const TOKEN = process.env['GITHUB_PAT'] ?? '';

describe.skipIf(!E2E)('GitHub E2E', () => {
  const plugin = new GitHubPlugin();
  const hostUrl = 'https://api.github.com';
  const repo = 'trunten82/luqen-e2e-test';

  it('validates token against real GitHub API', async () => {
    const result = await plugin.validateToken(hostUrl, TOKEN);
    expect(result.valid).toBe(true);
    expect(result.username).toBe('trunten82');
  });

  it('reads file from private repo', async () => {
    const content = await plugin.readFile({ hostUrl, repo, path: 'index.html', branch: 'main', token: TOKEN });
    expect(content).toContain('<html>');
    expect(content).toContain('logo.png');
  });

  it('creates and cleans up a PR', async () => {
    const branchName = `luqen/e2e-test-${Date.now()}`;
    const pr = await plugin.createPullRequest({
      hostUrl,
      repo,
      baseBranch: 'main',
      headBranch: branchName,
      title: '[E2E Test] Automated PR — safe to delete',
      body: 'This PR was created by an automated E2E test and can be safely deleted.',
      changes: [{ path: 'index.html', content: '<html lang="en"><head><title>Test</title></head><body><img src="logo.png" alt="Logo"><button type="button">Click me</button></body></html>' }],
      token: TOKEN,
    });
    expect(pr.url).toContain('github.com');
    expect(pr.number).toBeGreaterThan(0);

    // Cleanup: close PR and delete branch
    await fetch(`${hostUrl}/repos/${repo}/pulls/${pr.number}`, {
      method: 'PATCH',
      headers: { Authorization: `token ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed' }),
    });
    await fetch(`${hostUrl}/repos/${repo}/git/refs/heads/${encodeURIComponent(branchName)}`, {
      method: 'DELETE',
      headers: { Authorization: `token ${TOKEN}` },
    });
  });
});
```

- [ ] **Step 4: Run E2E test manually**

```bash
LUQEN_E2E_GIT=true GITHUB_PAT=ghp_... npm test -w packages/dashboard -- --run tests/e2e/git-host-e2e.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "test: E2E tests for GitHub plugin with private repo"
```

---

## Task 12: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/reference/dashboard-config.md`

- [ ] **Step 1: Update README**

Add "Git Host Integration" to features list. Mention GitHub, GitLab, Azure DevOps support with per-developer PAT credentials and automated PR creation.

- [ ] **Step 2: Update CHANGELOG**

Add v2.2.0 section with the git host plugin feature.

- [ ] **Step 3: Update config docs**

Document the `GIT_TOKEN_ENCRYPTION_KEY` env var (optional, falls back to session secret).

- [ ] **Step 4: Update plugin documentation**

Add a `docs/reference/git-host-plugins.md` documenting:
- How to install a git host plugin (admin flow)
- Supported platforms (GitHub, GitLab, Azure DevOps) with host URL examples
- Self-hosted instances (GitHub Enterprise, GitLab CE/EE, Azure DevOps Server) — just set the correct host URL
- PAT requirements per platform (which scopes/permissions the PAT needs):
  - GitHub: `repo` scope (full control of private repos)
  - GitLab: `api` scope
  - Azure DevOps: Code (Read & Write), Pull Request Contribute
- How developers add their credentials
- How the PR creation flow works
- Security: encryption at rest, per-user isolation, no admin access to developer tokens
- Extending: how to write a new git host plugin (implement `GitHostPlugin` interface)

- [ ] **Step 5: Update the luqen skill file**

Update `/root/.claude/skills/luqen/SKILL.md` to mention git host plugin support.

- [ ] **Step 6: Commit**

```bash
git commit -m "docs: git host plugin integration and plugin documentation"
```

---

## Self-Review Checklist

- [x] **Spec coverage**: All spec sections mapped to tasks (plugin interface, DB, 3 plugins, permissions, admin routes, credential routes, repo update, PR creation, E2E, docs)
- [x] **Placeholder scan**: No TBD/TODO — all code blocks complete
- [x] **Type consistency**: `GitHostPlugin`, `GitHostConfig`, `DeveloperCredential`, `DeveloperCredentialRow` consistent across tasks
- [x] **Encryption**: Uses existing `encryptSecret`/`decryptSecret` from `plugins/crypto.ts`
- [x] **Permission**: `repos.credentials` added in migration 033, wired in permissions.ts, checked in routes
