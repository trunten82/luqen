import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveUrlToFile } from '../../src/source-mapper/routing-strategies.js';

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pally-route-'));
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

    const result = await resolveUrlToFile('/about', 'nextjs-app', tmpDir);
    expect(result).toBe(join(tmpDir, 'app', 'about', 'page.tsx'));
  });

  it('nextjs-app: resolves / to app/page.tsx', async () => {
    await mkdir(join(tmpDir, 'app'), { recursive: true });
    await writeFile(join(tmpDir, 'app', 'page.tsx'), '<div/>');

    const result = await resolveUrlToFile('/', 'nextjs-app', tmpDir);
    expect(result).toBe(join(tmpDir, 'app', 'page.tsx'));
  });

  it('nextjs-pages: resolves /about to pages/about.tsx', async () => {
    await mkdir(join(tmpDir, 'pages'), { recursive: true });
    await writeFile(join(tmpDir, 'pages', 'about.tsx'), '<div/>');

    const result = await resolveUrlToFile('/about', 'nextjs-pages', tmpDir);
    expect(result).toBe(join(tmpDir, 'pages', 'about.tsx'));
  });

  it('nuxt: resolves /about to pages/about.vue', async () => {
    await mkdir(join(tmpDir, 'pages'), { recursive: true });
    await writeFile(join(tmpDir, 'pages', 'about.vue'), '<template/>');

    const result = await resolveUrlToFile('/about', 'nuxt', tmpDir);
    expect(result).toBe(join(tmpDir, 'pages', 'about.vue'));
  });

  it('sveltekit: resolves /about to src/routes/about/+page.svelte', async () => {
    await mkdir(join(tmpDir, 'src', 'routes', 'about'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'routes', 'about', '+page.svelte'), '<div/>');

    const result = await resolveUrlToFile('/about', 'sveltekit', tmpDir);
    expect(result).toBe(join(tmpDir, 'src', 'routes', 'about', '+page.svelte'));
  });

  it('plain-html: resolves /about to about.html', async () => {
    await writeFile(join(tmpDir, 'about.html'), '<!DOCTYPE html>');

    const result = await resolveUrlToFile('/about', 'plain-html', tmpDir);
    expect(result).toBe(join(tmpDir, 'about.html'));
  });

  it('plain-html: falls back to about/index.html', async () => {
    await mkdir(join(tmpDir, 'about'), { recursive: true });
    await writeFile(join(tmpDir, 'about', 'index.html'), '<!DOCTYPE html>');

    const result = await resolveUrlToFile('/about', 'plain-html', tmpDir);
    expect(result).toBe(join(tmpDir, 'about', 'index.html'));
  });

  it('nextjs-app: resolves dynamic segment [id]', async () => {
    await mkdir(join(tmpDir, 'app', '[id]'), { recursive: true });
    await writeFile(join(tmpDir, 'app', '[id]', 'page.tsx'), '<div/>');

    const result = await resolveUrlToFile('/123', 'nextjs-app', tmpDir);
    expect(result).toBe(join(tmpDir, 'app', '[id]', 'page.tsx'));
  });

  it('returns null when no matching file exists', async () => {
    const result = await resolveUrlToFile('/nonexistent', 'nextjs-app', tmpDir);
    expect(result).toBeNull();
  });

  it('returns null for unknown framework', async () => {
    const result = await resolveUrlToFile('/about', 'unknown', tmpDir);
    expect(result).toBeNull();
  });
});
