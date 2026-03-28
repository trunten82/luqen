import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabPlugin } from '../../src/git-hosts/gitlab.js';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response;
}

function textResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitLabPlugin', () => {
  const plugin = new GitLabPlugin();
  const hostUrl = 'https://gitlab.com/api/v4';
  const token = 'glpat-test-token';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('type and displayName', () => {
    it('has correct type', () => {
      expect(plugin.type).toBe('gitlab');
    });

    it('has correct displayName', () => {
      expect(plugin.displayName).toBe('GitLab');
    });
  });

  describe('validateToken', () => {
    it('returns valid with username on success', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ username: 'testuser' }));

      const result = await plugin.validateToken(hostUrl, token);

      expect(result).toEqual({ valid: true, username: 'testuser' });
      expect(mockFetch).toHaveBeenCalledWith(`${hostUrl}/user`, {
        headers: { 'PRIVATE-TOKEN': token },
      });
    });

    it('returns invalid on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));

      const result = await plugin.validateToken(hostUrl, token);

      expect(result).toEqual({ valid: false, error: 'HTTP 401' });
    });

    it('returns invalid on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const result = await plugin.validateToken(hostUrl, token);

      expect(result).toEqual({ valid: false, error: 'Network failure' });
    });
  });

  describe('readFile', () => {
    const readOpts = {
      hostUrl,
      repo: 'owner/repo',
      path: 'src/index.ts',
      branch: 'main',
      token,
    };

    it('returns file content on success', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('console.log("hello")'));

      const result = await plugin.readFile(readOpts);

      expect(result).toBe('console.log("hello")');
      expect(mockFetch).toHaveBeenCalledWith(
        `${hostUrl}/projects/${encodeURIComponent('owner/repo')}/repository/files/${encodeURIComponent('src/index.ts')}/raw?ref=main`,
        { headers: { 'PRIVATE-TOKEN': token } },
      );
    });

    it('returns null on 404', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('', 404));

      const result = await plugin.readFile(readOpts);

      expect(result).toBeNull();
    });

    it('returns null on other HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('', 500));

      const result = await plugin.readFile(readOpts);

      expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('timeout'));

      const result = await plugin.readFile(readOpts);

      expect(result).toBeNull();
    });
  });

  describe('listFiles', () => {
    const listOpts = {
      hostUrl,
      repo: 'owner/repo',
      path: 'src',
      branch: 'main',
      token,
    };

    it('returns list of filenames on success', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([{ name: 'index.ts' }, { name: 'utils.ts' }]),
      );

      const result = await plugin.listFiles(listOpts);

      expect(result).toEqual(['index.ts', 'utils.ts']);
    });

    it('returns empty array on error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([], 500));

      const result = await plugin.listFiles(listOpts);

      expect(result).toEqual([]);
    });
  });

  describe('createPullRequest', () => {
    const prOpts = {
      hostUrl,
      repo: 'owner/repo',
      baseBranch: 'main',
      headBranch: 'feature/test',
      title: 'Test MR',
      body: 'MR description',
      changes: [
        { path: 'file1.ts', content: 'content1' },
        { path: 'file2.ts', content: 'content2' },
      ],
      token,
    };

    it('creates branch, commits, and merge request', async () => {
      const encodedRepo = encodeURIComponent('owner/repo');

      // 1. Create branch
      mockFetch.mockResolvedValueOnce(jsonResponse({ name: 'feature/test' }));
      // 2. Commit
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'abc123' }));
      // 3. Create MR
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ web_url: 'https://gitlab.com/owner/repo/-/merge_requests/42', iid: 42 }),
      );

      const result = await plugin.createPullRequest(prOpts);

      expect(result).toEqual({
        url: 'https://gitlab.com/owner/repo/-/merge_requests/42',
        number: 42,
      });

      // Verify 3 API calls
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Branch creation
      const branchCall = mockFetch.mock.calls[0];
      expect(branchCall[0]).toBe(
        `${hostUrl}/projects/${encodedRepo}/repository/branches?branch=feature/test&ref=main`,
      );
      expect(branchCall[1].method).toBe('POST');

      // Commit
      const commitCall = mockFetch.mock.calls[1];
      expect(commitCall[0]).toBe(`${hostUrl}/projects/${encodedRepo}/repository/commits`);
      const commitBody = JSON.parse(commitCall[1].body);
      expect(commitBody.branch).toBe('feature/test');
      expect(commitBody.commit_message).toBe('Test MR');
      expect(commitBody.actions).toHaveLength(2);
      expect(commitBody.actions[0]).toEqual({
        action: 'update',
        file_path: 'file1.ts',
        content: 'content1',
      });

      // Merge request
      const mrCall = mockFetch.mock.calls[2];
      expect(mrCall[0]).toBe(`${hostUrl}/projects/${encodedRepo}/merge_requests`);
      const mrBody = JSON.parse(mrCall[1].body);
      expect(mrBody.source_branch).toBe('feature/test');
      expect(mrBody.target_branch).toBe('main');
      expect(mrBody.title).toBe('Test MR');
      expect(mrBody.description).toBe('MR description');
    });

    it('throws on branch creation failure', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 400));

      await expect(plugin.createPullRequest(prOpts)).rejects.toThrow(
        'Failed to create branch: HTTP 400',
      );
    });

    it('throws on commit failure', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({})); // branch ok
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 400)); // commit fail

      await expect(plugin.createPullRequest(prOpts)).rejects.toThrow(
        'Failed to create commit: HTTP 400',
      );
    });

    it('throws on merge request failure', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({})); // branch ok
      mockFetch.mockResolvedValueOnce(jsonResponse({})); // commit ok
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 409)); // MR fail

      await expect(plugin.createPullRequest(prOpts)).rejects.toThrow(
        'Failed to create merge request: HTTP 409',
      );
    });
  });
});
