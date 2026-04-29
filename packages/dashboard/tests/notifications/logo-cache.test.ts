import { describe, it, expect, vi } from 'vitest';
import { LogoCache } from '../../src/notifications/logo-cache.js';

function imageResponse(body = 'PNG'): Response {
  return new Response(Buffer.from(body), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

describe('LogoCache', () => {
  it('returns null on miss', () => {
    const c = new LogoCache();
    expect(c.get('org-1')).toBeNull();
  });

  it('fetches and caches on first call, reuses on second', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return imageResponse();
    }) as unknown as typeof fetch;

    const c = new LogoCache({ fetchImpl });
    const a = await c.fetch('org-1', 'https://cdn/logo.png');
    const b = await c.fetch('org-1', 'https://cdn/logo.png');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(calls).toBe(1);
  });

  it('expires entries past TTL', async () => {
    let now = 1000;
    const fetchImpl = (async () => imageResponse()) as unknown as typeof fetch;
    const c = new LogoCache({ fetchImpl, ttlMs: 100, nowFn: () => now });
    await c.fetch('o', 'https://x/logo.png');
    expect(c.get('o')).not.toBeNull();
    now += 200;
    expect(c.get('o')).toBeNull();
  });

  it('returns null on non-2xx', async () => {
    const fetchImpl = (async () =>
      new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const c = new LogoCache({ fetchImpl });
    const r = await c.fetch('o', 'https://broken/x.png');
    expect(r).toBeNull();
    expect(c.size()).toBe(0);
  });

  it('returns null when content-type is not an image', async () => {
    const fetchImpl = (async () =>
      new Response('html', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    const c = new LogoCache({ fetchImpl });
    expect(await c.fetch('o', 'https://x/y')).toBeNull();
  });

  it('returns null on timeout/abort', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;
    const c = new LogoCache({ fetchImpl, timeoutMs: 5 });
    const r = await c.fetch('o', 'https://slow/logo.png');
    expect(r).toBeNull();
  });

  it('invalidate drops cached entry', async () => {
    const fetchImpl = (async () => imageResponse()) as unknown as typeof fetch;
    const c = new LogoCache({ fetchImpl });
    await c.fetch('o', 'https://x/y.png');
    expect(c.size()).toBe(1);
    c.invalidate('o');
    expect(c.size()).toBe(0);
  });

  it('evicts oldest when over maxEntries', async () => {
    const fetchImpl = (async () => imageResponse()) as unknown as typeof fetch;
    const c = new LogoCache({ fetchImpl, maxEntries: 2 });
    await c.fetch('a', 'https://x/a.png');
    await c.fetch('b', 'https://x/b.png');
    await c.fetch('c', 'https://x/c.png');
    expect(c.size()).toBe(2);
    expect(c.get('a')).toBeNull();
    expect(c.get('b')).not.toBeNull();
    expect(c.get('c')).not.toBeNull();
  });

  it('reads from local file path', async () => {
    const { writeFile, mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'logo-cache-'));
    const file = join(dir, 'logo.png');
    await writeFile(file, Buffer.from('PNGBYTES'));
    const c = new LogoCache();
    const r = await c.fetch('o', file);
    expect(r).not.toBeNull();
    expect(r?.contentType).toBe('image/png');
  });
});
