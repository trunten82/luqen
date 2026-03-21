import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectFramework } from '../../src/source-mapper/framework-detector.js';

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'luqen-fw-'));
}

describe('detectFramework', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('detects nextjs-app when app/page.tsx exists and next.config.js present', async () => {
    await writeFile(join(tmpDir, 'next.config.js'), 'module.exports = {}');
    await mkdir(join(tmpDir, 'app'), { recursive: true });
    await writeFile(join(tmpDir, 'app', 'page.tsx'), '<div/>');

    const result = await detectFramework(tmpDir);
    expect(result).toBe('nextjs-app');
  });

  it('detects nextjs-pages when pages/ dir exists and next dep in package.json', async () => {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.0.0' } }),
    );
    await mkdir(join(tmpDir, 'pages'), { recursive: true });
    await writeFile(join(tmpDir, 'pages', 'index.tsx'), '<div/>');

    const result = await detectFramework(tmpDir);
    expect(result).toBe('nextjs-pages');
  });

  it('detects nuxt via nuxt.config.ts', async () => {
    await writeFile(join(tmpDir, 'nuxt.config.ts'), 'export default defineNuxtConfig({})');

    const result = await detectFramework(tmpDir);
    expect(result).toBe('nuxt');
  });

  it('detects sveltekit via svelte.config.js', async () => {
    await writeFile(join(tmpDir, 'svelte.config.js'), 'export default {}');

    const result = await detectFramework(tmpDir);
    expect(result).toBe('sveltekit');
  });

  it('detects plain-html when index.html exists', async () => {
    await writeFile(join(tmpDir, 'index.html'), '<!DOCTYPE html>');

    const result = await detectFramework(tmpDir);
    expect(result).toBe('plain-html');
  });

  it('returns unknown when nothing matches', async () => {
    const result = await detectFramework(tmpDir);
    expect(result).toBe('unknown');
  });
});
