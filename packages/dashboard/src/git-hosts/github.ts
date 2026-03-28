// packages/dashboard/src/git-hosts/github.ts

import type {
  GitHostPlugin,
  GitHostValidation,
  ReadFileOptions,
  CreatePullRequestOptions,
  GitHostPullRequest,
} from './types.js';

export class GitHubPlugin implements GitHostPlugin {
  readonly type = 'github' as const;
  readonly displayName = 'GitHub';

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'luqen-dashboard',
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

      const data = await res.json() as { login: string };
      return { valid: true, username: data.login };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { valid: false, error: message };
    }
  }

  async readFile(options: ReadFileOptions): Promise<string | null> {
    const { hostUrl, repo, path, branch, token } = options;
    try {
      const url = `${hostUrl}/repos/${repo}/contents/${path}?ref=${branch}`;
      const res = await fetch(url, { headers: this.headers(token) });

      if (res.status === 404) {
        return null;
      }

      if (!res.ok) {
        return null;
      }

      const data = await res.json() as { content: string };
      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch {
      return null;
    }
  }

  async listFiles(options: ReadFileOptions): Promise<readonly string[]> {
    const { hostUrl, repo, path, branch, token } = options;
    try {
      const url = `${hostUrl}/repos/${repo}/contents/${path}?ref=${branch}`;
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
    const apiBase = `${hostUrl}/repos/${repo}`;

    // 1. Get base branch SHA
    const refRes = await fetch(`${apiBase}/git/ref/heads/${baseBranch}`, { headers: hdrs });
    if (!refRes.ok) {
      throw new Error(`Failed to get base branch ref: HTTP ${refRes.status}`);
    }
    const refData = await refRes.json() as { object: { sha: string } };
    const baseSha = refData.object.sha;

    // 2. Create branch ref
    const createRefRes = await fetch(`${apiBase}/git/refs`, {
      method: 'POST',
      headers: { ...hdrs, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${headBranch}`, sha: baseSha }),
    });
    if (!createRefRes.ok) {
      throw new Error(`Failed to create branch ref: HTTP ${createRefRes.status}`);
    }

    // 3. Get base commit to find tree SHA
    const commitRes = await fetch(`${apiBase}/git/commits/${baseSha}`, { headers: hdrs });
    if (!commitRes.ok) {
      throw new Error(`Failed to get base commit: HTTP ${commitRes.status}`);
    }
    const commitData = await commitRes.json() as { tree: { sha: string } };
    const baseTreeSha = commitData.tree.sha;

    // 4. Create blobs for each change
    const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const change of changes) {
      const blobRes = await fetch(`${apiBase}/git/blobs`, {
        method: 'POST',
        headers: { ...hdrs, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: change.content, encoding: 'utf-8' }),
      });
      if (!blobRes.ok) {
        throw new Error(`Failed to create blob for ${change.path}: HTTP ${blobRes.status}`);
      }
      const blobData = await blobRes.json() as { sha: string };
      treeEntries.push({
        path: change.path,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      });
    }

    // 5. Create tree
    const treeRes = await fetch(`${apiBase}/git/trees`, {
      method: 'POST',
      headers: { ...hdrs, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    });
    if (!treeRes.ok) {
      throw new Error(`Failed to create tree: HTTP ${treeRes.status}`);
    }
    const treeData = await treeRes.json() as { sha: string };

    // 6. Create commit
    const newCommitRes = await fetch(`${apiBase}/git/commits`, {
      method: 'POST',
      headers: { ...hdrs, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: title,
        tree: treeData.sha,
        parents: [baseSha],
      }),
    });
    if (!newCommitRes.ok) {
      throw new Error(`Failed to create commit: HTTP ${newCommitRes.status}`);
    }
    const newCommitData = await newCommitRes.json() as { sha: string };

    // 7. Update branch ref to point to new commit
    const updateRefRes = await fetch(`${apiBase}/git/refs/heads/${headBranch}`, {
      method: 'PATCH',
      headers: { ...hdrs, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: newCommitData.sha }),
    });
    if (!updateRefRes.ok) {
      throw new Error(`Failed to update branch ref: HTTP ${updateRefRes.status}`);
    }

    // 8. Create pull request
    const prRes = await fetch(`${apiBase}/pulls`, {
      method: 'POST',
      headers: { ...hdrs, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        body,
        head: headBranch,
        base: baseBranch,
      }),
    });
    if (!prRes.ok) {
      throw new Error(`Failed to create pull request: HTTP ${prRes.status}`);
    }
    const prData = await prRes.json() as { html_url: string; number: number };

    return { url: prData.html_url, number: prData.number };
  }
}
