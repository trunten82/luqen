import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig, DEFAULT_CONFIG } from '../src/config.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('loadConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `pally-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.PALLY_WEBSERVICE_URL;
    delete process.env.PALLY_WEBSERVICE_AUTH;
    delete process.env.PALLY_AGENT_CONFIG;
  });

  it('returns defaults when no config file exists', async () => {
    const config = await loadConfig({ cwd: tempDir });
    expect(config.standard).toBe('WCAG2AA');
    expect(config.concurrency).toBe(5);
    expect(config.timeout).toBe(30000);
    expect(config.pollTimeout).toBe(60000);
    expect(config.maxPages).toBe(100);
    expect(config.crawlDepth).toBe(3);
    expect(config.alsoCrawl).toBe(false);
  });

  it('loads config from .pally-agent.json in cwd', async () => {
    writeFileSync(join(tempDir, '.pally-agent.json'), JSON.stringify({ standard: 'WCAG2AAA', concurrency: 3 }));
    const config = await loadConfig({ cwd: tempDir });
    expect(config.standard).toBe('WCAG2AAA');
    expect(config.concurrency).toBe(3);
    expect(config.timeout).toBe(30000);
  });

  it('walks up directories to find config', async () => {
    const child = join(tempDir, 'sub', 'dir');
    mkdirSync(child, { recursive: true });
    writeFileSync(join(tempDir, '.pally-agent.json'), JSON.stringify({ concurrency: 10 }));
    const config = await loadConfig({ cwd: child });
    expect(config.concurrency).toBe(10);
  });

  it('uses --config override over discovery', async () => {
    const configPath = join(tempDir, 'custom.json');
    writeFileSync(configPath, JSON.stringify({ concurrency: 42 }));
    writeFileSync(join(tempDir, '.pally-agent.json'), JSON.stringify({ concurrency: 1 }));
    const config = await loadConfig({ cwd: tempDir, configPath });
    expect(config.concurrency).toBe(42);
  });

  it('overrides webserviceUrl from PALLY_WEBSERVICE_URL env', async () => {
    process.env.PALLY_WEBSERVICE_URL = 'http://custom:9000';
    const config = await loadConfig({ cwd: tempDir });
    expect(config.webserviceUrl).toBe('http://custom:9000');
  });

  it('overrides webserviceHeaders.Authorization from PALLY_WEBSERVICE_AUTH', async () => {
    process.env.PALLY_WEBSERVICE_AUTH = 'Bearer secret';
    const config = await loadConfig({ cwd: tempDir });
    expect(config.webserviceHeaders.Authorization).toBe('Bearer secret');
  });

  it('uses PALLY_AGENT_CONFIG env as config path', async () => {
    const configPath = join(tempDir, 'env-config.json');
    writeFileSync(configPath, JSON.stringify({ concurrency: 99 }));
    process.env.PALLY_AGENT_CONFIG = configPath;
    const config = await loadConfig({ cwd: tempDir });
    expect(config.concurrency).toBe(99);
  });

  it('validates standard is a valid WCAG level', async () => {
    writeFileSync(join(tempDir, '.pally-agent.json'), JSON.stringify({ standard: 'INVALID' }));
    await expect(loadConfig({ cwd: tempDir })).rejects.toThrow(/standard/);
  });
});
