import { describe, it, expect } from 'vitest';
import {
  assertPublicUrl,
  isPrivateHostname,
  isPrivateIpAddress,
  isPublicUrl,
  operatorPolicyFor,
  parseIpv4Literal,
  SsrfBlockedError,
  type HostResolver,
} from '../../src/net/ssrf-guard.js';

const resolveTo = (...addresses: string[]): HostResolver => async () => addresses;

describe('parseIpv4Literal', () => {
  it.each([
    ['127.0.0.1', [127, 0, 0, 1]],
    ['2130706433', [127, 0, 0, 1]],
    ['0x7f000001', [127, 0, 0, 1]],
    ['0x7f.1', [127, 0, 0, 1]],
    ['0177.0.0.1', [127, 0, 0, 1]],
    ['127.1', [127, 0, 0, 1]],
    ['192.168.3.50', [192, 168, 3, 50]],
  ])('parses %s', (input, expected) => {
    expect(parseIpv4Literal(input)).toEqual(expected);
  });

  it.each(['example.com', '256.1.1.1', '1.2.3.4.5', '', '08.1.1.1'])('rejects %s', (input) => {
    expect(parseIpv4Literal(input)).toBeNull();
  });
});

describe('isPrivateIpAddress', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.3.50',
    '169.254.169.254', '169.254.1.1', '100.64.0.1', '100.127.255.255', '0.0.0.0', '0.1.2.3',
    '224.0.0.1', '255.255.255.255', '2130706433', '0x7f000001',
    '::1', '[::1]', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:192.168.3.50', '::ffff:a9fe:a9fe',
    '::127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::',
  ])('%s is private', (address) => {
    expect(isPrivateIpAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808'])(
    '%s is public',
    (address) => { expect(isPrivateIpAddress(address)).toBe(false); },
  );
});

describe('isPrivateHostname', () => {
  it.each(['localhost', 'LOCALHOST.', 'app.localhost', 'printer.local', 'db.internal', '127.0.0.1', '[::1]', '2130706433'])(
    '%s is private',
    (host) => { expect(isPrivateHostname(host)).toBe(true); },
  );

  it.each(['example.com', '8.8.8.8', 'internal.example.com', 'local.example.com'])('%s is not', (host) => {
    expect(isPrivateHostname(host)).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  it('refuses non-http(s) schemes even with the opt-out', async () => {
    await expect(assertPublicUrl('file:///etc/passwd', { allowPrivate: true })).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertPublicUrl('ftp://example.com/')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it.each([
    'http://127.0.0.1:4000/',
    'http://192.168.3.50/',
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/',
    'http://localhost/',
  ])('refuses %s without resolving it', async (url) => {
    let resolved = false;
    const resolve: HostResolver = async () => { resolved = true; return ['93.184.216.34']; };
    await expect(assertPublicUrl(url, { resolve })).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(resolved).toBe(false);
  });

  it('refuses a name that resolves to any private address', async () => {
    await expect(assertPublicUrl('https://rebind.test/', { resolve: resolveTo('93.184.216.34', '127.0.0.1') }))
      .rejects.toThrow(/resolves to private address 127\.0\.0\.1/);
    await expect(assertPublicUrl('https://meta.test/', { resolve: resolveTo('169.254.169.254') }))
      .rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('fails closed when resolution fails or returns nothing', async () => {
    const failing: HostResolver = async () => { throw new Error('ENOTFOUND'); };
    await expect(assertPublicUrl('https://nx.test/', { resolve: failing })).rejects.toThrow(/DNS resolution failed/);
    await expect(assertPublicUrl('https://empty.test/', { resolve: resolveTo() })).rejects.toThrow(/no addresses/);
  });

  it('allows a name resolving only to public addresses', async () => {
    await expect(assertPublicUrl('https://example.test/', { resolve: resolveTo('93.184.216.34') })).resolves.toBeUndefined();
  });

  it('allowPrivate opts out of address checks', async () => {
    await expect(assertPublicUrl('http://127.0.0.1:4000/', { allowPrivate: true })).resolves.toBeUndefined();
  });

  it('trustedOrigins exempts the exact origin only — another port on the same host is still refused', async () => {
    const policy = { trustedOrigins: ['http://127.0.0.1:5555'] };
    await expect(assertPublicUrl('http://127.0.0.1:5555/x', policy)).resolves.toBeUndefined();
    await expect(assertPublicUrl('http://127.0.0.1:4000/x', policy)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('isPublicUrl is the non-throwing form', async () => {
    expect(await isPublicUrl('http://127.0.0.1/')).toBe(false);
    expect(await isPublicUrl('https://x.test/', { resolve: resolveTo('8.8.8.8') })).toBe(true);
  });
});

describe('operatorPolicyFor (local CLI / stdio MCP)', () => {
  it('opts out only when the operator targets a private host', () => {
    expect(operatorPolicyFor('http://localhost:3000/')).toEqual({ allowPrivate: true });
    expect(operatorPolicyFor('http://[::1]:3000/')).toEqual({ allowPrivate: true });
    expect(operatorPolicyFor('https://example.com/')).toEqual({});
    expect(operatorPolicyFor('not a url')).toEqual({});
  });
});
