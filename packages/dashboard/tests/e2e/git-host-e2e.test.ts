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
    const content = await plugin.readFile({
      hostUrl, repo, path: 'index.html', branch: 'main', token: TOKEN,
    });
    expect(content).toContain('<html>');
    expect(content).toContain('logo.png');
  });

  it('lists files in repo root', async () => {
    const files = await plugin.listFiles({
      hostUrl, repo, path: '', branch: 'main', token: TOKEN,
    });
    expect(files).toContain('index.html');
  });

  it('creates and cleans up a PR', async () => {
    const branchName = `luqen/e2e-test-${Date.now()}`;
    const pr = await plugin.createPullRequest({
      hostUrl,
      repo,
      baseBranch: 'main',
      headBranch: branchName,
      title: '[E2E Test] Automated PR — safe to delete',
      body: 'This PR was created by an automated E2E test.',
      changes: [{
        path: 'index.html',
        content: '<html lang="en"><head><title>Test</title></head><body><img src="logo.png" alt="Logo"><button type="button">Click me</button></body></html>',
      }],
      token: TOKEN,
    });
    expect(pr.url).toContain('github.com');
    expect(pr.number).toBeGreaterThan(0);

    // Cleanup: close PR and delete branch
    const headers = { Authorization: `token ${TOKEN}`, 'Content-Type': 'application/json' };
    await fetch(`${hostUrl}/repos/${repo}/pulls/${pr.number}`, {
      method: 'PATCH', headers, body: JSON.stringify({ state: 'closed' }),
    });
    await fetch(`${hostUrl}/repos/${repo}/git/refs/heads/${encodeURIComponent(branchName)}`, {
      method: 'DELETE', headers: { Authorization: `token ${TOKEN}` },
    });
  });
});
