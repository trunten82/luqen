// packages/dashboard/src/git-hosts/azure-devops.ts

import type {
  GitHostPlugin,
  GitHostValidation,
  ReadFileOptions,
  CreatePullRequestOptions,
  GitHostPullRequest,
} from './types.js';

export class AzureDevOpsPlugin implements GitHostPlugin {
  readonly type = 'azure-devops' as const;
  readonly displayName = 'Azure DevOps';

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Basic ${btoa(':' + token)}`,
    };
  }

  private parseRepo(repo: string): { org: string; project: string; repoName: string } {
    const parts = repo.split('/');
    if (parts.length !== 3) {
      throw new Error(`Invalid Azure DevOps repo format: expected "org/project/repo", got "${repo}"`);
    }
    return { org: parts[0], project: parts[1], repoName: parts[2] };
  }

  async validateToken(hostUrl: string, token: string): Promise<GitHostValidation> {
    try {
      // For Azure DevOps, repo is not needed — we use the first segment or just the org from hostUrl
      // The token param already contains the org info via the hostUrl
      // We need the org from somewhere — extract from a separate call or use _apis/connectionData
      // Since validateToken only gets hostUrl and token, we call connectionData at root
      const res = await fetch(
        `${hostUrl}/_apis/connectionData?api-version=7.1`,
        { headers: this.headers(token) },
      );

      if (!res.ok) {
        return { valid: false, error: `HTTP ${res.status}` };
      }

      const data = await res.json() as {
        authenticatedUser: { providerDisplayName: string };
      };
      return { valid: true, username: data.authenticatedUser.providerDisplayName };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { valid: false, error: message };
    }
  }

  async readFile(options: ReadFileOptions): Promise<string | null> {
    const { hostUrl, repo, path, branch, token } = options;
    try {
      const { org, project, repoName } = this.parseRepo(repo);
      const url =
        `${hostUrl}/${org}/${project}/_apis/git/repositories/${repoName}/items` +
        `?path=${encodeURIComponent(path)}` +
        `&versionDescriptor.version=${encodeURIComponent(branch)}` +
        `&api-version=7.1`;
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
      const { org, project, repoName } = this.parseRepo(repo);
      const url =
        `${hostUrl}/${org}/${project}/_apis/git/repositories/${repoName}/items` +
        `?scopePath=${encodeURIComponent(path)}` +
        `&recursionLevel=OneLevel` +
        `&versionDescriptor.version=${encodeURIComponent(branch)}` +
        `&api-version=7.1`;
      const res = await fetch(url, { headers: this.headers(token) });

      if (!res.ok) {
        return [];
      }

      const data = await res.json() as {
        value: ReadonlyArray<{ path: string; isFolder: boolean }>;
      };
      return data.value.map((entry) => {
        const segments = entry.path.split('/');
        return segments[segments.length - 1];
      });
    } catch {
      return [];
    }
  }

  async createPullRequest(options: CreatePullRequestOptions): Promise<GitHostPullRequest> {
    const { hostUrl, repo, baseBranch, headBranch, title, body, changes, token } = options;
    const { org, project, repoName } = this.parseRepo(repo);
    const hdrs = this.headers(token);
    const jsonHeaders = { ...hdrs, 'Content-Type': 'application/json' };
    const repoBase = `${hostUrl}/${org}/${project}/_apis/git/repositories/${repoName}`;

    // 1. Get base ref objectId
    const refRes = await fetch(
      `${repoBase}/refs?filter=heads/${baseBranch}&api-version=7.1`,
      { headers: hdrs },
    );
    if (!refRes.ok) {
      throw new Error(`Failed to get base branch ref: HTTP ${refRes.status}`);
    }
    const refData = await refRes.json() as { value: Array<{ objectId: string }> };
    if (!refData.value || refData.value.length === 0) {
      throw new Error(`Base branch "${baseBranch}" not found`);
    }
    const baseSha = refData.value[0].objectId;

    // 2. Push: create branch + commit changes
    const pushChanges = changes.map((change) => ({
      changeType: 'edit',
      item: { path: change.path },
      newContent: { content: change.content, contentType: 'rawtext' },
    }));

    const pushRes = await fetch(`${repoBase}/pushes?api-version=7.1`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        refUpdates: [
          {
            name: `refs/heads/${headBranch}`,
            oldObjectId: '0000000000000000000000000000000000000000',
            newObjectId: baseSha,
          },
        ],
        commits: [
          {
            comment: title,
            changes: pushChanges,
          },
        ],
      }),
    });
    if (!pushRes.ok) {
      throw new Error(`Failed to push changes: HTTP ${pushRes.status}`);
    }

    // 3. Create pull request
    const prRes = await fetch(`${repoBase}/pullrequests?api-version=7.1`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        sourceRefName: `refs/heads/${headBranch}`,
        targetRefName: `refs/heads/${baseBranch}`,
        title,
        description: body,
      }),
    });
    if (!prRes.ok) {
      throw new Error(`Failed to create pull request: HTTP ${prRes.status}`);
    }

    const prData = await prRes.json() as { url: string; pullRequestId: number };
    return { url: prData.url, number: prData.pullRequestId };
  }
}
