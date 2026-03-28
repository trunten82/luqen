class GitHubPlugin {
  get type() { return 'github'; }
  get displayName() { return 'GitHub'; }

  headers(token) {
    return {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'luqen-dashboard',
    };
  }

  async validateToken(hostUrl, token) {
    try {
      const res = await fetch(`${hostUrl}/user`, {
        headers: this.headers(token),
      });

      if (!res.ok) {
        return { valid: false, error: `HTTP ${res.status}` };
      }

      const data = await res.json();
      return { valid: true, username: data.login };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { valid: false, error: message };
    }
  }

  async readFile(options) {
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

      const data = await res.json();
      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch {
      return null;
    }
  }

  async listFiles(options) {
    const { hostUrl, repo, path, branch, token } = options;
    try {
      const url = `${hostUrl}/repos/${repo}/contents/${path}?ref=${branch}`;
      const res = await fetch(url, { headers: this.headers(token) });

      if (!res.ok) {
        return [];
      }

      const data = await res.json();
      return data.map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  async createPullRequest(options) {
    const { hostUrl, repo, baseBranch, headBranch, title, body, changes, token } = options;
    const hdrs = this.headers(token);
    const apiBase = `${hostUrl}/repos/${repo}`;

    // 1. Get base branch SHA
    const refRes = await fetch(`${apiBase}/git/ref/heads/${baseBranch}`, { headers: hdrs });
    if (!refRes.ok) {
      throw new Error(`Failed to get base branch ref: HTTP ${refRes.status}`);
    }
    const refData = await refRes.json();
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
    const commitData = await commitRes.json();
    const baseTreeSha = commitData.tree.sha;

    // 4. Create blobs for each change
    const treeEntries = [];
    for (const change of changes) {
      const blobRes = await fetch(`${apiBase}/git/blobs`, {
        method: 'POST',
        headers: { ...hdrs, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: change.content, encoding: 'utf-8' }),
      });
      if (!blobRes.ok) {
        throw new Error(`Failed to create blob for ${change.path}: HTTP ${blobRes.status}`);
      }
      const blobData = await blobRes.json();
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
    const treeData = await treeRes.json();

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
    const newCommitData = await newCommitRes.json();

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
    const prData = await prRes.json();

    return { url: prData.html_url, number: prData.number };
  }
}

const manifest = {
  name: 'git-host-github',
  displayName: 'GitHub',
  type: 'git-host',
  version: '1.0.0',
  description: 'Git integration with GitHub and GitHub Enterprise for PR creation from accessibility fixes',
  configSchema: [
    {
      key: 'hostUrl',
      label: 'API Host URL',
      type: 'string',
      required: true,
      default: 'https://api.github.com',
      description: 'Use https://api.github.com for GitHub.com or your GitHub Enterprise API URL',
    },
  ],
};

const instance = new GitHubPlugin();

export default {
  manifest,
  gitHost: instance,
  async activate() {},
  async deactivate() {},
  async healthCheck() { return true; },
};
