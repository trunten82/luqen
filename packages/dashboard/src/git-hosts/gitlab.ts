// packages/dashboard/src/git-hosts/gitlab.ts

import type {
  GitHostPlugin,
  GitHostValidation,
  ReadFileOptions,
  CreatePullRequestOptions,
  GitHostPullRequest,
} from './types.js';
export class GitLabPlugin implements GitHostPlugin {
  readonly type = 'gitlab' as const;
  readonly displayName = 'GitLab';

  private headers(token: string): Record<string, string> {
    return {
      'PRIVATE-TOKEN': token,
    };
  }

  async validateToken(hostUrl: string, token: string): Promise<GitHostValidation> {
    try {
      const res = await fetch(`${hostUrl}/user`, {
        headers: this.headers(token),
      });

      if (!res.ok) {
        return { valid: false, error: `HTTP ${res.status}` };
      }

      const data = await res.json() as { username: string };
      return { valid: true, username: data.username };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { valid: false, error: message };
    }
  }

  async readFile(options: ReadFileOptions): Promise<string | null> {
    const { hostUrl, repo, path, branch, token } = options;
    try {
      const encodedRepo = encodeURIComponent(repo);
      const encodedPath = encodeURIComponent(path);
      const url = `${hostUrl}/projects/${encodedRepo}/repository/files/${encodedPath}/raw?ref=${branch}`;
      const res = await fetch(url, { headers: this.headers(token) });

      if (res.status === 404) {
        return null;
      }

      if (!res.ok) {
        return null;
      }

      return await res.text();
    } catch {
      return null;
    }
  }

  async listFiles(options: ReadFileOptions): Promise<readonly string[]> {
    const { hostUrl, repo, path, branch, token } = options;
    try {
      const encodedRepo = encodeURIComponent(repo);
      const url = `${hostUrl}/projects/${encodedRepo}/repository/tree?path=${path}&ref=${branch}`;
      const res = await fetch(url, { headers: this.headers(token) });

      if (!res.ok) {
        return [];
      }

      const data = await res.json() as ReadonlyArray<{ name: string }>;
      return data.map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  async createPullRequest(options: CreatePullRequestOptions): Promise<GitHostPullRequest> {
    const { hostUrl, repo, baseBranch, headBranch, title, body, changes, token } = options;
    const hdrs = this.headers(token);
    const jsonHeaders = { ...hdrs, 'Content-Type': 'application/json' };
    const encodedRepo = encodeURIComponent(repo);
    const apiBase = `${hostUrl}/projects/${encodedRepo}`;

    // 1. Create branch from base
    const branchRes = await fetch(
      `${apiBase}/repository/branches?branch=${headBranch}&ref=${baseBranch}`,
      { method: 'POST', headers: hdrs },
    );
    if (!branchRes.ok) {
      throw new Error(`Failed to create branch: HTTP ${branchRes.status}`);
    }

    // 2. Commit all file changes in a single commit
    const actions = changes.map((change) => ({
      action: 'update' as const,
      file_path: change.path,
      content: change.content,
    }));

    const commitRes = await fetch(`${apiBase}/repository/commits`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        branch: headBranch,
        commit_message: title,
        actions,
      }),
    });
    if (!commitRes.ok) {
      throw new Error(`Failed to create commit: HTTP ${commitRes.status}`);
    }

    // 3. Create merge request
    const mrRes = await fetch(`${apiBase}/merge_requests`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        source_branch: headBranch,
        target_branch: baseBranch,
        title,
        description: body,
      }),
    });
    if (!mrRes.ok) {
      throw new Error(`Failed to create merge request: HTTP ${mrRes.status}`);
    }

    const mrData = await mrRes.json() as { web_url: string; iid: number };
    return { url: mrData.web_url, number: mrData.iid };
  }
}
