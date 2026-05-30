import { describe, it, expect } from 'vitest';
import { isPrivateHostname, validateScanUrl } from '../../src/services/scan-service.js';

describe('isPrivateHostname (SSRF guard)', () => {
  it('blocks the full 127.0.0.0/8 loopback range, not just 127.0.0.1', () => {
    expect(isPrivateHostname('127.0.0.1')).toBe(true);
    expect(isPrivateHostname('127.0.0.2')).toBe(true);
    expect(isPrivateHostname('127.255.255.254')).toBe(true);
  });

  it('blocks IPv6 loopback', () => {
    expect(isPrivateHostname('::1')).toBe(true);
    expect(isPrivateHostname('[::1]')).toBe(true);
  });

  it('blocks common private / link-local / internal hostnames', () => {
    expect(isPrivateHostname('localhost')).toBe(true);
    expect(isPrivateHostname('0.0.0.0')).toBe(true);
    expect(isPrivateHostname('10.0.0.5')).toBe(true);
    expect(isPrivateHostname('192.168.1.10')).toBe(true);
    expect(isPrivateHostname('172.16.0.1')).toBe(true);
    expect(isPrivateHostname('169.254.0.1')).toBe(true);
    expect(isPrivateHostname('foo.internal')).toBe(true);
    expect(isPrivateHostname('foo.local')).toBe(true);
  });

  it('allows public hostnames', () => {
    expect(isPrivateHostname('example.com')).toBe(false);
    expect(isPrivateHostname('8.8.8.8')).toBe(false);
  });
});

describe('validateScanUrl allowPrivate escape hatch', () => {
  it('rejects loopback URLs by default (secure default)', () => {
    const result = validateScanUrl('http://127.0.0.1/');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects another loopback address by default', () => {
    const result = validateScanUrl('http://127.0.0.2/');
    expect('error' in result).toBe(true);
  });

  it('accepts loopback URLs when allowPrivate is true', () => {
    const result = validateScanUrl('http://127.0.0.1/', true);
    expect('url' in result).toBe(true);
    if ('url' in result) {
      expect(result.url.hostname).toBe('127.0.0.1');
    }
  });

  it('still accepts public URLs regardless of allowPrivate', () => {
    expect('url' in validateScanUrl('https://example.com/')).toBe(true);
    expect('url' in validateScanUrl('https://example.com/', true)).toBe(true);
  });
});
