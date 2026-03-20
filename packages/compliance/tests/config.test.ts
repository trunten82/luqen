import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, DEFAULT_CONFIG } from '../src/config.js';

describe('Config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns default config when no file or env vars exist', () => {
    const config = loadConfig('/nonexistent/path/compliance.config.json');
    expect(config.port).toBe(4000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.dbPath).toBe('./compliance.db');
    expect(config.tokenExpiry).toBe('1h');
    expect(config.rateLimit.read).toBe(100);
    expect(config.rateLimit.write).toBe(20);
    expect(config.rateLimit.windowMs).toBe(60000);
  });

  it('overrides port from COMPLIANCE_PORT env var', () => {
    process.env.COMPLIANCE_PORT = '5000';
    const config = loadConfig('/nonexistent/path');
    expect(config.port).toBe(5000);
  });

  it('overrides dbPath from COMPLIANCE_DB_PATH env var', () => {
    process.env.COMPLIANCE_DB_PATH = '/tmp/test.db';
    const config = loadConfig('/nonexistent/path');
    expect(config.dbPath).toBe('/tmp/test.db');
  });

  it('overrides JWT key paths from env vars', () => {
    process.env.COMPLIANCE_JWT_PRIVATE_KEY = '/keys/priv.pem';
    process.env.COMPLIANCE_JWT_PUBLIC_KEY = '/keys/pub.pem';
    const config = loadConfig('/nonexistent/path');
    expect(config.jwtKeyPair.privateKeyPath).toBe('/keys/priv.pem');
    expect(config.jwtKeyPair.publicKeyPath).toBe('/keys/pub.pem');
  });

  it('overrides CORS origin from COMPLIANCE_CORS_ORIGIN (comma-separated)', () => {
    process.env.COMPLIANCE_CORS_ORIGIN = 'http://a.com,http://b.com';
    const config = loadConfig('/nonexistent/path');
    expect(config.cors.origin).toEqual(['http://a.com', 'http://b.com']);
  });

  it('DEFAULT_CONFIG is immutable (frozen)', () => {
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
  });
});
