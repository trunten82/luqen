import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig, DEFAULT_CONFIG } from '../src/config.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('loadConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `luqen-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.LUQEN_WEBSERVICE_URL;
    delete process.env.LUQEN_WEBSERVICE_AUTH;
    delete process.env.LUQEN_CONFIG;
    delete process.env.LUQEN_COMPLIANCE_URL;
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

  it('loads config from .luqen.json in cwd', async () => {
    writeFileSync(join(tempDir, '.luqen.json'), JSON.stringify({ standard: 'WCAG2AAA', concurrency: 3 }));
    const config = await loadConfig({ cwd: tempDir });
    expect(config.standard).toBe('WCAG2AAA');
    expect(config.concurrency).toBe(3);
    expect(config.timeout).toBe(30000);
  });

  it('walks up directories to find config', async () => {
    const child = join(tempDir, 'sub', 'dir');
    mkdirSync(child, { recursive: true });
    writeFileSync(join(tempDir, '.luqen.json'), JSON.stringify({ concurrency: 10 }));
    const config = await loadConfig({ cwd: child });
    expect(config.concurrency).toBe(10);
  });

  it('uses --config override over discovery', async () => {
    const configPath = join(tempDir, 'custom.json');
    writeFileSync(configPath, JSON.stringify({ concurrency: 42 }));
    writeFileSync(join(tempDir, '.luqen.json'), JSON.stringify({ concurrency: 1 }));
    const config = await loadConfig({ cwd: tempDir, configPath });
    expect(config.concurrency).toBe(42);
  });

  it('overrides webserviceUrl from LUQEN_WEBSERVICE_URL env', async () => {
    process.env.LUQEN_WEBSERVICE_URL = 'http://custom:9000';
    const config = await loadConfig({ cwd: tempDir });
    expect(config.webserviceUrl).toBe('http://custom:9000');
  });

  it('overrides webserviceHeaders.Authorization from LUQEN_WEBSERVICE_AUTH', async () => {
    process.env.LUQEN_WEBSERVICE_AUTH = 'Bearer secret';
    const config = await loadConfig({ cwd: tempDir });
    expect(config.webserviceHeaders.Authorization).toBe('Bearer secret');
  });

  it('uses LUQEN_CONFIG env as config path', async () => {
    const configPath = join(tempDir, 'env-config.json');
    writeFileSync(configPath, JSON.stringify({ concurrency: 99 }));
    process.env.LUQEN_CONFIG = configPath;
    const config = await loadConfig({ cwd: tempDir });
    expect(config.concurrency).toBe(99);
  });

  it('includes complianceUrl when LUQEN_COMPLIANCE_URL is set', async () => {
    process.env.LUQEN_COMPLIANCE_URL = 'https://compliance.example.com/api';
    const config = await loadConfig({ cwd: tempDir });
    expect(config.complianceUrl).toBe('https://compliance.example.com/api');
  });

  it('does not include complianceUrl when LUQEN_COMPLIANCE_URL is not set', async () => {
    const config = await loadConfig({ cwd: tempDir });
    expect(config.complianceUrl).toBeUndefined();
  });

  it('validates standard is a valid WCAG level', async () => {
    writeFileSync(join(tempDir, '.luqen.json'), JSON.stringify({ standard: 'INVALID' }));
    await expect(loadConfig({ cwd: tempDir })).rejects.toThrow(/standard/);
  });
});
