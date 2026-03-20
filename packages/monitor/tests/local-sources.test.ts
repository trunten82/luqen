import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadLocalSources } from '../src/local-sources.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `pally-monitor-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('loadLocalSources', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- Loading from explicit config path ----

  it('loads sources from an explicit config path', async () => {
    const configPath = join(tmpDir, 'custom-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        sources: [
          { name: 'EAA Directive', url: 'https://example.com/eaa', type: 'html' },
          { name: 'WCAG Feed', url: 'https://example.com/feed', type: 'rss' },
        ],
      }),
    );

    const sources = await loadLocalSources(configPath);
    expect(sources).toHaveLength(2);
    expect(sources[0].name).toBe('EAA Directive');
    expect(sources[0].url).toBe('https://example.com/eaa');
    expect(sources[0].type).toBe('html');
    expect(sources[1].type).toBe('rss');
  });

  it('assigns stable ids to loaded sources', async () => {
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        sources: [{ name: 'Test', url: 'https://example.com', type: 'html' }],
      }),
    );

    const sources = await loadLocalSources(configPath);
    expect(sources[0].id).toBeTruthy();
    expect(typeof sources[0].id).toBe('string');
  });

  // ---- Fallback: returns empty array when file doesn't exist ----

  it('returns empty array when no config file exists', async () => {
    const sources = await loadLocalSources(join(tmpDir, 'nonexistent.json'));
    expect(sources).toEqual([]);
  });

  // ---- Validation: rejects malformed JSON ----

  it('throws on malformed JSON (not valid JSON)', async () => {
    const configPath = join(tmpDir, 'bad.json');
    writeFileSync(configPath, '{ not valid json !!!');

    await expect(loadLocalSources(configPath)).rejects.toThrow();
  });

  it('throws when sources array is missing', async () => {
    const configPath = join(tmpDir, 'no-sources.json');
    writeFileSync(configPath, JSON.stringify({ other: 'data' }));

    await expect(loadLocalSources(configPath)).rejects.toThrow('sources');
  });

  it('throws when a source is missing required fields', async () => {
    const configPath = join(tmpDir, 'incomplete.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        sources: [{ name: 'Missing URL' }],
      }),
    );

    await expect(loadLocalSources(configPath)).rejects.toThrow();
  });

  it('throws when a source has an invalid type', async () => {
    const configPath = join(tmpDir, 'bad-type.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        sources: [{ name: 'Bad', url: 'https://example.com', type: 'xml' }],
      }),
    );

    await expect(loadLocalSources(configPath)).rejects.toThrow('type');
  });

  // ---- Lookup order: explicit path takes precedence ----

  it('explicit path takes precedence over cwd fallback', async () => {
    // Create a config in cwd-like directory
    const cwdConfig = join(tmpDir, '.pally-monitor.json');
    writeFileSync(
      cwdConfig,
      JSON.stringify({
        sources: [{ name: 'CWD Source', url: 'https://cwd.example.com', type: 'html' }],
      }),
    );

    // Create a config at an explicit path
    const explicitConfig = join(tmpDir, 'explicit.json');
    writeFileSync(
      explicitConfig,
      JSON.stringify({
        sources: [{ name: 'Explicit Source', url: 'https://explicit.example.com', type: 'api' }],
      }),
    );

    const sources = await loadLocalSources(explicitConfig);
    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe('Explicit Source');
  });

  // ---- Lookup order: cwd fallback ----

  it('falls back to .pally-monitor.json in provided directory', async () => {
    const configPath = join(tmpDir, '.pally-monitor.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        sources: [{ name: 'CWD Fallback', url: 'https://cwd.example.com', type: 'html' }],
      }),
    );

    // Pass undefined to trigger fallback, but override cwd for testing
    const sources = await loadLocalSources(undefined, tmpDir);
    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe('CWD Fallback');
  });

  it('falls back to home dir config when cwd config is absent', async () => {
    const homeDir = makeTmpDir();
    const homeConfig = join(homeDir, '.pally-monitor.json');
    writeFileSync(
      homeConfig,
      JSON.stringify({
        sources: [{ name: 'Home Source', url: 'https://home.example.com', type: 'rss' }],
      }),
    );

    // Neither explicit path nor cwd has config; home dir does
    const emptyDir = makeTmpDir();
    const sources = await loadLocalSources(undefined, emptyDir, homeDir);
    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe('Home Source');

    rmSync(homeDir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  });
});
