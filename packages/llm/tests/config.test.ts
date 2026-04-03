import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadConfig, DEFAULT_CONFIG } from '../src/config.js';

describe('loadConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns default config when no file exists', () => {
    const config = loadConfig('/nonexistent/path.json');
    expect(config.port).toBe(4200);
    expect(config.host).toBe('0.0.0.0');
    expect(config.dbPath).toBe('./llm.db');
  });

  it('applies env overrides', () => {
    vi.stubEnv('LLM_PORT', '9999');
    vi.stubEnv('LLM_HOST', '127.0.0.1');
    vi.stubEnv('LLM_DB_PATH', '/tmp/test.db');
    const config = loadConfig('/nonexistent/path.json');
    expect(config.port).toBe(9999);
    expect(config.host).toBe('127.0.0.1');
    expect(config.dbPath).toBe('/tmp/test.db');
  });

  it('applies CORS origin from env as comma-separated list', () => {
    vi.stubEnv('LLM_CORS_ORIGIN', 'http://a.com, http://b.com');
    const config = loadConfig('/nonexistent/path.json');
    expect(config.cors.origin).toEqual(['http://a.com', 'http://b.com']);
  });

  it('applies JWT key path overrides from env', () => {
    vi.stubEnv('LLM_JWT_PRIVATE_KEY', '/tmp/priv.pem');
    vi.stubEnv('LLM_JWT_PUBLIC_KEY', '/tmp/pub.pem');
    const config = loadConfig('/nonexistent/path.json');
    expect(config.jwtKeyPair.privateKeyPath).toBe('/tmp/priv.pem');
    expect(config.jwtKeyPair.publicKeyPath).toBe('/tmp/pub.pem');
  });

  it('DEFAULT_CONFIG is frozen', () => {
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
  });
});
