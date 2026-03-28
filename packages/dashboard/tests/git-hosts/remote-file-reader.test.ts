import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteFileReader } from '../../src/git-hosts/remote-file-reader.js';
import type { GitHostPlugin } from '../../src/git-hosts/types.js';

describe('RemoteFileReader', () => {
  const mockPlugin: GitHostPlugin = {
    type: 'test',
    displayName: 'Test',
    validateToken: vi.fn(),
    readFile: vi.fn(),
    listFiles: vi.fn(),
    createPullRequest: vi.fn(),
  };

  const baseOpts = {
    hostUrl: 'https://api.example.com',
    repo: 'owner/repo',
    branch: 'main',
    token: 'test-token',
  };

  const reader = new RemoteFileReader(mockPlugin, baseOpts);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // exists()
  // ---------------------------------------------------------------------------

  it('exists returns true when readFile returns content', async () => {
    (mockPlugin.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce('<html>');
    expect(await reader.exists('index.html')).toBe(true);
  });

  it('exists returns false when readFile returns null', async () => {
    (mockPlugin.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect(await reader.exists('missing.html')).toBe(false);
  });

  it('exists passes correct options to plugin.readFile', async () => {
    (mockPlugin.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await reader.exists('src/app.html');

    expect(mockPlugin.readFile).toHaveBeenCalledWith({
      hostUrl: 'https://api.example.com',
      repo: 'owner/repo',
      branch: 'main',
      token: 'test-token',
      path: 'src/app.html',
    });
  });

  // ---------------------------------------------------------------------------
  // read()
  // ---------------------------------------------------------------------------

  it('read delegates to plugin.readFile and returns content', async () => {
    (mockPlugin.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce('<html>content</html>');
    const content = await reader.read('index.html');

    expect(content).toBe('<html>content</html>');
    expect(mockPlugin.readFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'index.html' }),
    );
  });

  it('read returns null for missing files', async () => {
    (mockPlugin.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const content = await reader.read('nonexistent.html');

    expect(content).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // list()
  // ---------------------------------------------------------------------------

  it('list delegates to plugin.listFiles', async () => {
    (mockPlugin.listFiles as ReturnType<typeof vi.fn>).mockResolvedValueOnce(['index.html', 'style.css']);
    const files = await reader.list('');

    expect(files).toEqual(['index.html', 'style.css']);
    expect(mockPlugin.listFiles).toHaveBeenCalledWith(
      expect.objectContaining({ path: '' }),
    );
  });

  it('list returns empty array when no files found', async () => {
    (mockPlugin.listFiles as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const files = await reader.list('empty-dir');

    expect(files).toEqual([]);
  });

  it('list passes the subdirectory path correctly', async () => {
    (mockPlugin.listFiles as ReturnType<typeof vi.fn>).mockResolvedValueOnce(['template.hbs']);
    await reader.list('src/views');

    expect(mockPlugin.listFiles).toHaveBeenCalledWith({
      hostUrl: 'https://api.example.com',
      repo: 'owner/repo',
      branch: 'main',
      token: 'test-token',
      path: 'src/views',
    });
  });

  // ---------------------------------------------------------------------------
  // Constructor isolation
  // ---------------------------------------------------------------------------

  it('different readers use independent base options', async () => {
    const otherReader = new RemoteFileReader(mockPlugin, {
      hostUrl: 'https://other.example.com',
      repo: 'other/repo',
      branch: 'develop',
      token: 'other-token',
    });

    (mockPlugin.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await reader.read('a.html');
    await otherReader.read('b.html');

    expect(mockPlugin.readFile).toHaveBeenCalledWith(
      expect.objectContaining({ hostUrl: 'https://api.example.com', path: 'a.html' }),
    );
    expect(mockPlugin.readFile).toHaveBeenCalledWith(
      expect.objectContaining({ hostUrl: 'https://other.example.com', path: 'b.html' }),
    );
  });
});
