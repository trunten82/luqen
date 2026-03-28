import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubPlugin } from '../../src/git-hosts/github.js';

const HOST = 'https://api.github.com';
const TOKEN = 'ghp_test_token_123';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GitHubPlugin', () => {
  let plugin: GitHubPlugin;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    plugin = new GitHubPlugin();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct type and displayName', () => {
    expect(plugin.type).toBe('github');
    expect(plugin.displayName).toBe('GitHub');
  });

  describe('validateToken', () => {
    it('returns valid with username on 200', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ login: 'octocat' }));

      const result = await plugin.validateToken(HOST, TOKEN);

      expect(result).toEqual({ valid: true, username: 'octocat' });
      expect(mockFetch).toHaveBeenCalledWith(`${HOST}/user`, {
        headers: {
          Authorization: `token ${TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'luqen-dashboard',
        },
      });
    });

    it('returns invalid on 401', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'Bad credentials' }, 401));

      const result = await plugin.validateToken(HOST, TOKEN);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('HTTP 401');
    });

    it('returns invalid on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const result = await plugin.validateToken(HOST, TOKEN);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Network failure');
    });
  });

  describe('readFile', () => {
    const baseOpts = { hostUrl: HOST, repo: 'owner/repo', path: 'README.md', branch: 'main', token: TOKEN };

    it('returns decoded content from base64', async () => {
      const content = Buffer.from('# Hello World').toString('base64');
      mockFetch.mockResolvedValueOnce(jsonResponse({ content }));

      const result = await plugin.readFile(baseOpts);

      expect(result).toBe('# Hello World');
      expect(mockFetch).toHaveBeenCalledWith(
        `${HOST}/repos/owner/repo/contents/README.md?ref=main`,
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it('returns null on 404', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404));

      const result = await plugin.readFile(baseOpts);

      expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('timeout'));

      const result = await plugin.readFile(baseOpts);

      expect(result).toBeNull();
    });
  });

  describe('listFiles', () => {
    const baseOpts = { hostUrl: HOST, repo: 'owner/repo', path: 'src', branch: 'main', token: TOKEN };

    it('returns array of filenames', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { name: 'index.ts' },
        { name: 'utils.ts' },
      ]));

      const result = await plugin.listFiles(baseOpts);

      expect(result).toEqual(['index.ts', 'utils.ts']);
    });

    it('returns empty array on error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404));

      const result = await plugin.listFiles(baseOpts);

      expect(result).toEqual([]);
    });
  });

  describe('createPullRequest', () => {
    const prOpts = {
      hostUrl: HOST,
      repo: 'owner/repo',
      baseBranch: 'main',
      headBranch: 'feature/test',
      title: 'Test PR',
      body: 'PR description',
      changes: [{ path: 'file.txt', content: 'hello' }],
      token: TOKEN,
    };

    it('executes all 8 API calls and returns PR url and number', async () => {
      // 1. GET ref
      mockFetch.mockResolvedValueOnce(jsonResponse({ object: { sha: 'base-sha-123' } }));
      // 2. POST create ref
      mockFetch.mockResolvedValueOnce(jsonResponse({ ref: 'refs/heads/feature/test' }, 201));
      // 3. GET base commit
      mockFetch.mockResolvedValueOnce(jsonResponse({ tree: { sha: 'tree-sha-456' } }));
      // 4. POST blob
      mockFetch.mockResolvedValueOnce(jsonResponse({ sha: 'blob-sha-789' }, 201));
      // 5. POST tree
      mockFetch.mockResolvedValueOnce(jsonResponse({ sha: 'new-tree-sha' }, 201));
      // 6. POST commit
      mockFetch.mockResolvedValueOnce(jsonResponse({ sha: 'new-commit-sha' }, 201));
      // 7. PATCH update ref
      mockFetch.mockResolvedValueOnce(jsonResponse({ object: { sha: 'new-commit-sha' } }));
      // 8. POST pull request
      mockFetch.mockResolvedValueOnce(jsonResponse({
        html_url: 'https://github.com/owner/repo/pull/42',
        number: 42,
      }, 201));

      const result = await plugin.createPullRequest(prOpts);

      expect(result).toEqual({
        url: 'https://github.com/owner/repo/pull/42',
        number: 42,
      });
      expect(mockFetch).toHaveBeenCalledTimes(8);

      // Verify key API calls
      const calls = mockFetch.mock.calls;

      // 1. Get base ref
      expect(calls[0][0]).toBe(`${HOST}/repos/owner/repo/git/ref/heads/main`);

      // 2. Create branch ref
      expect(calls[1][0]).toBe(`${HOST}/repos/owner/repo/git/refs`);
      expect(calls[1][1].method).toBe('POST');

      // 3. Get base commit
      expect(calls[2][0]).toBe(`${HOST}/repos/owner/repo/git/commits/base-sha-123`);

      // 4. Create blob
      expect(calls[3][0]).toBe(`${HOST}/repos/owner/repo/git/blobs`);
      expect(JSON.parse(calls[3][1].body)).toEqual({ content: 'hello', encoding: 'utf-8' });

      // 5. Create tree
      expect(calls[4][0]).toBe(`${HOST}/repos/owner/repo/git/trees`);
      expect(JSON.parse(calls[4][1].body)).toEqual({
        base_tree: 'tree-sha-456',
        tree: [{ path: 'file.txt', mode: '100644', type: 'blob', sha: 'blob-sha-789' }],
      });

      // 6. Create commit
      expect(calls[5][0]).toBe(`${HOST}/repos/owner/repo/git/commits`);
      expect(JSON.parse(calls[5][1].body)).toEqual({
        message: 'Test PR',
        tree: 'new-tree-sha',
        parents: ['base-sha-123'],
      });

      // 7. Update ref
      expect(calls[6][0]).toBe(`${HOST}/repos/owner/repo/git/refs/heads/feature/test`);
      expect(calls[6][1].method).toBe('PATCH');

      // 8. Create PR
      expect(calls[7][0]).toBe(`${HOST}/repos/owner/repo/pulls`);
      expect(JSON.parse(calls[7][1].body)).toEqual({
        title: 'Test PR',
        body: 'PR description',
        head: 'feature/test',
        base: 'main',
      });
    });

    it('throws when base branch ref fails', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404));

      await expect(plugin.createPullRequest(prOpts)).rejects.toThrow('Failed to get base branch ref: HTTP 404');
    });

    it('handles multiple file changes', async () => {
      const multiOpts = {
        ...prOpts,
        changes: [
          { path: 'a.txt', content: 'aaa' },
          { path: 'b.txt', content: 'bbb' },
        ],
      };

      // 1. GET ref
      mockFetch.mockResolvedValueOnce(jsonResponse({ object: { sha: 'sha1' } }));
      // 2. POST create ref
      mockFetch.mockResolvedValueOnce(jsonResponse({ ref: 'refs/heads/feature/test' }, 201));
      // 3. GET base commit
      mockFetch.mockResolvedValueOnce(jsonResponse({ tree: { sha: 'tree1' } }));
      // 4. POST blob for a.txt
      mockFetch.mockResolvedValueOnce(jsonResponse({ sha: 'blob-a' }, 201));
      // 5. POST blob for b.txt
      mockFetch.mockResolvedValueOnce(jsonResponse({ sha: 'blob-b' }, 201));
      // 6. POST tree
      mockFetch.mockResolvedValueOnce(jsonResponse({ sha: 'new-tree' }, 201));
      // 7. POST commit
      mockFetch.mockResolvedValueOnce(jsonResponse({ sha: 'new-commit' }, 201));
      // 8. PATCH update ref
      mockFetch.mockResolvedValueOnce(jsonResponse({ object: { sha: 'new-commit' } }));
      // 9. POST pull request
      mockFetch.mockResolvedValueOnce(jsonResponse({ html_url: 'https://github.com/owner/repo/pull/99', number: 99 }, 201));

      const result = await plugin.createPullRequest(multiOpts);

      expect(result.number).toBe(99);
      // 8 base calls + 1 extra blob = 9
      expect(mockFetch).toHaveBeenCalledTimes(9);
    });
  });
});
