import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AzureDevOpsPlugin } from '../../src/git-hosts/azure-devops.js';

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

describe('AzureDevOpsPlugin', () => {
  const plugin = new AzureDevOpsPlugin();
  const hostUrl = 'https://dev.azure.com';
  const token = 'ado-pat-token';
  const expectedAuth = `Basic ${btoa(':' + token)}`;

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('type and displayName', () => {
    it('has correct type', () => {
      expect(plugin.type).toBe('azure-devops');
    });

    it('has correct displayName', () => {
      expect(plugin.displayName).toBe('Azure DevOps');
    });
  });

  describe('validateToken', () => {
    it('returns valid with username on success', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          authenticatedUser: { providerDisplayName: 'Test User' },
        }),
      );

      const result = await plugin.validateToken(hostUrl, token);

      expect(result).toEqual({ valid: true, username: 'Test User' });
      expect(mockFetch).toHaveBeenCalledWith(
        `${hostUrl}/_apis/connectionData?api-version=7.1`,
        { headers: { Authorization: expectedAuth } },
      );
    });

    it('returns invalid on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));

      const result = await plugin.validateToken(hostUrl, token);

      expect(result).toEqual({ valid: false, error: 'HTTP 401' });
    });

    it('returns invalid on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await plugin.validateToken(hostUrl, token);

      expect(result).toEqual({ valid: false, error: 'Connection refused' });
    });
  });

  describe('readFile', () => {
    const readOpts = {
      hostUrl,
      repo: 'myorg/myproject/myrepo',
      path: 'src/index.ts',
      branch: 'main',
      token,
    };

    it('returns file content on success', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('file content here'));

      const result = await plugin.readFile(readOpts);

      expect(result).toBe('file content here');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/myorg/myproject/_apis/git/repositories/myrepo/items'),
        expect.objectContaining({ headers: { Authorization: expectedAuth } }),
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
      repo: 'myorg/myproject/myrepo',
      path: '/src',
      branch: 'main',
      token,
    };

    it('returns list of filenames on success', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            { path: '/src/index.ts', isFolder: false },
            { path: '/src/utils.ts', isFolder: false },
          ],
        }),
      );

      const result = await plugin.listFiles(listOpts);

      expect(result).toEqual(['index.ts', 'utils.ts']);
    });

    it('returns empty array on error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));

      const result = await plugin.listFiles(listOpts);

      expect(result).toEqual([]);
    });
  });

  describe('createPullRequest', () => {
    const prOpts = {
      hostUrl,
      repo: 'myorg/myproject/myrepo',
      baseBranch: 'main',
      headBranch: 'feature/test',
      title: 'Test PR',
      body: 'PR description',
      changes: [
        { path: '/src/file1.ts', content: 'content1' },
        { path: '/src/file2.ts', content: 'content2' },
      ],
      token,
    };

    it('gets ref, pushes, and creates pull request', async () => {
      // 1. Get base ref
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ value: [{ objectId: 'abc123def456' }] }),
      );
      // 2. Push
      mockFetch.mockResolvedValueOnce(jsonResponse({ pushId: 1 }));
      // 3. Create PR
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          url: 'https://dev.azure.com/myorg/myproject/_apis/git/repositories/myrepo/pullRequests/99',
          pullRequestId: 99,
        }),
      );

      const result = await plugin.createPullRequest(prOpts);

      expect(result).toEqual({
        url: 'https://dev.azure.com/myorg/myproject/_apis/git/repositories/myrepo/pullRequests/99',
        number: 99,
      });

      // Verify 3 API calls
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Ref lookup
      const refCall = mockFetch.mock.calls[0];
      expect(refCall[0]).toContain('/refs?filter=heads/main&api-version=7.1');

      // Push
      const pushCall = mockFetch.mock.calls[1];
      expect(pushCall[0]).toContain('/pushes?api-version=7.1');
      const pushBody = JSON.parse(pushCall[1].body);
      expect(pushBody.refUpdates[0].name).toBe('refs/heads/feature/test');
      expect(pushBody.refUpdates[0].newObjectId).toBe('abc123def456');
      expect(pushBody.commits[0].changes).toHaveLength(2);
      expect(pushBody.commits[0].changes[0]).toEqual({
        changeType: 'edit',
        item: { path: '/src/file1.ts' },
        newContent: { content: 'content1', contentType: 'rawtext' },
      });

      // PR creation
      const prCall = mockFetch.mock.calls[2];
      expect(prCall[0]).toContain('/pullrequests?api-version=7.1');
      const prBody = JSON.parse(prCall[1].body);
      expect(prBody.sourceRefName).toBe('refs/heads/feature/test');
      expect(prBody.targetRefName).toBe('refs/heads/main');
      expect(prBody.title).toBe('Test PR');
      expect(prBody.description).toBe('PR description');
    });

    it('throws on ref lookup failure', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 404));

      await expect(plugin.createPullRequest(prOpts)).rejects.toThrow(
        'Failed to get base branch ref: HTTP 404',
      );
    });

    it('throws when base branch not found', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ value: [] }));

      await expect(plugin.createPullRequest(prOpts)).rejects.toThrow(
        'Base branch "main" not found',
      );
    });

    it('throws on push failure', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ value: [{ objectId: 'abc123' }] }),
      );
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 400));

      await expect(plugin.createPullRequest(prOpts)).rejects.toThrow(
        'Failed to push changes: HTTP 400',
      );
    });

    it('throws on PR creation failure', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ value: [{ objectId: 'abc123' }] }),
      );
      mockFetch.mockResolvedValueOnce(jsonResponse({})); // push ok
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 409)); // PR fail

      await expect(plugin.createPullRequest(prOpts)).rejects.toThrow(
        'Failed to create pull request: HTTP 409',
      );
    });
  });
});
