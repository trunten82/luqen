import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveUrlToFile } from '../../src/source-mapper/routing-strategies.js';
import { LocalFileReader } from '../../src/source-mapper/file-reader.js';

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'luqen-route-'));
}

describe('resolveUrlToFile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('nextjs-app: resolves /about to app/about/page.tsx', async () => {
    await mkdir(join(tmpDir, 'app', 'about'), { recursive: true });
    await writeFile(join(tmpDir, 'app', 'about', 'page.tsx'), '<div/>');

    const result = await resolveUrlToFile('/about', 'nextjs-app', new LocalFileReader(tmpDir));
    expect(result).toBe(join('app', 'about', 'page.tsx'));
  });

  it('nextjs-app: resolves / to app/page.tsx', async () => {
    await mkdir(join(tmpDir, 'app'), { recursive: true });
    await writeFile(join(tmpDir, 'app', 'page.tsx'), '<div/>');

    const result = await resolveUrlToFile('/', 'nextjs-app', new LocalFileReader(tmpDir));
    expect(result).toBe(join('app', 'page.tsx'));
  });

  it('nextjs-pages: resolves /about to pages/about.tsx', async () => {
    await mkdir(join(tmpDir, 'pages'), { recursive: true });
    await writeFile(join(tmpDir, 'pages', 'about.tsx'), '<div/>');

    const result = await resolveUrlToFile('/about', 'nextjs-pages', new LocalFileReader(tmpDir));
    expect(result).toBe(join('pages', 'about.tsx'));
  });

  it('nuxt: resolves /about to pages/about.vue', async () => {
    await mkdir(join(tmpDir, 'pages'), { recursive: true });
    await writeFile(join(tmpDir, 'pages', 'about.vue'), '<template/>');

    const result = await resolveUrlToFile('/about', 'nuxt', new LocalFileReader(tmpDir));
    expect(result).toBe(join('pages', 'about.vue'));
  });

  it('sveltekit: resolves /about to src/routes/about/+page.svelte', async () => {
    await mkdir(join(tmpDir, 'src', 'routes', 'about'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'routes', 'about', '+page.svelte'), '<div/>');

    const result = await resolveUrlToFile('/about', 'sveltekit', new LocalFileReader(tmpDir));
    expect(result).toBe(join('src', 'routes', 'about', '+page.svelte'));
  });

  it('plain-html: resolves /about to about.html', async () => {
    await writeFile(join(tmpDir, 'about.html'), '<!DOCTYPE html>');

    const result = await resolveUrlToFile('/about', 'plain-html', new LocalFileReader(tmpDir));
    expect(result).toBe('about.html');
  });

  it('plain-html: falls back to about/index.html', async () => {
    await mkdir(join(tmpDir, 'about'), { recursive: true });
    await writeFile(join(tmpDir, 'about', 'index.html'), '<!DOCTYPE html>');

    const result = await resolveUrlToFile('/about', 'plain-html', new LocalFileReader(tmpDir));
    expect(result).toBe(join('about', 'index.html'));
  });

  it('nextjs-app: resolves dynamic segment [id]', async () => {
    await mkdir(join(tmpDir, 'app', '[id]'), { recursive: true });
    await writeFile(join(tmpDir, 'app', '[id]', 'page.tsx'), '<div/>');

    const result = await resolveUrlToFile('/123', 'nextjs-app', new LocalFileReader(tmpDir));
    expect(result).toBe(join('app', '[id]', 'page.tsx'));
  });

  it('returns null when no matching file exists', async () => {
    const result = await resolveUrlToFile('/nonexistent', 'nextjs-app', new LocalFileReader(tmpDir));
    expect(result).toBeNull();
  });

  it('returns null for unknown framework', async () => {
    const result = await resolveUrlToFile('/about', 'unknown', new LocalFileReader(tmpDir));
    expect(result).toBeNull();
  });

  it('sveltekit: resolves / to src/routes/+page.svelte', async () => {
    await mkdir(join(tmpDir, 'src', 'routes'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'routes', '+page.svelte'), '<div/>');

    const result = await resolveUrlToFile('/', 'sveltekit', new LocalFileReader(tmpDir));
    expect(result).toBe(join('src', 'routes', '+page.svelte'));
  });

  it('sveltekit: resolves dynamic segment [id]', async () => {
    await mkdir(join(tmpDir, 'src', 'routes', '[id]'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'routes', '[id]', '+page.svelte'), '<div/>');

    const result = await resolveUrlToFile('/123', 'sveltekit', new LocalFileReader(tmpDir));
    expect(result).toBe(join('src', 'routes', '[id]', '+page.svelte'));
  });

  it('sveltekit: returns null when no matching file', async () => {
    await mkdir(join(tmpDir, 'src', 'routes'), { recursive: true });

    const result = await resolveUrlToFile('/nonexistent', 'sveltekit', new LocalFileReader(tmpDir));
    expect(result).toBeNull();
  });

  it('nextjs-app: catch-all segment [...]', async () => {
    await mkdir(join(tmpDir, 'app', '[...slug]'), { recursive: true });
    await writeFile(join(tmpDir, 'app', '[...slug]', 'page.tsx'), '<div/>');

    const result = await resolveUrlToFile('/any/deep/path', 'nextjs-app', new LocalFileReader(tmpDir));
    expect(result).toBe(join('app', '[...slug]', 'page.tsx'));
  });

  it('nextjs-pages: resolves dynamic segment via [id] dir', async () => {
    await mkdir(join(tmpDir, 'pages', '[id]'), { recursive: true });
    await writeFile(join(tmpDir, 'pages', '[id].tsx'), '<div/>');

    const result = await resolveUrlToFile('/123', 'nextjs-pages', new LocalFileReader(tmpDir));
    expect(result).toBe(join('pages', '[id].tsx'));
  });

  it('nuxt: resolves dynamic segment via [id] dir', async () => {
    await mkdir(join(tmpDir, 'pages', '[id]'), { recursive: true });
    await writeFile(join(tmpDir, 'pages', '[id].vue'), '<template/>');

    const result = await resolveUrlToFile('/123', 'nuxt', new LocalFileReader(tmpDir));
    expect(result).toBe(join('pages', '[id].vue'));
  });

  it('nuxt: returns null when no matching file', async () => {
    await mkdir(join(tmpDir, 'pages'), { recursive: true });

    const result = await resolveUrlToFile('/nonexistent', 'nuxt', new LocalFileReader(tmpDir));
    expect(result).toBeNull();
  });
});
