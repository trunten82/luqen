import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { ChromiumProbe } from '@luqen/core';
import { registerHealthRoute, logBrowserResolution } from '../../src/routes/health.js';

const OK_AT_REST = { status: 'ok' as const };

describe('GET /health', () => {
  it('H1: health reports ok and the browser source when a browser resolves', async () => {
    const server = Fastify({ logger: false });
    const probe = vi.fn(async (): Promise<ChromiumProbe> => ({ ok: true, executablePath: '/usr/bin/chromium', source: 'system' }));
    await registerHealthRoute(server, { version: '9.9.9', probe, atRest: OK_AT_REST });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      version: '9.9.9',
      checks: {
        browser: { status: 'ok', source: 'system' },
        atRestEncryption: { status: 'ok' },
      },
    });
    await server.close();
  });

  it('H2: health reports degraded when no browser resolves', async () => {
    const server = Fastify({ logger: false });
    const probe = vi.fn(async (): Promise<ChromiumProbe> => ({ ok: false, tried: ['/a', '/b'] }));
    await registerHealthRoute(server, { version: '9.9.9', probe, atRest: OK_AT_REST });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.checks.browser.status).toBe('failed');
    await server.close();
  });

  it('H3: health never exposes filesystem paths', async () => {
    const failedServer = Fastify({ logger: false });
    const failedProbe = vi.fn(async (): Promise<ChromiumProbe> => ({ ok: false, tried: ['/secret/one', '/root/.cache/x'] }));
    await registerHealthRoute(failedServer, { version: '9.9.9', probe: failedProbe, atRest: OK_AT_REST });
    await failedServer.ready();
    const failedResponse = await failedServer.inject({ method: 'GET', url: '/health' });
    const failedRaw = failedResponse.payload;
    expect(failedRaw).not.toContain('/secret/one');
    expect(failedRaw).not.toContain('/root/.cache/x');
    expect(failedRaw).not.toContain('/usr/');
    expect(failedRaw).not.toContain('/root/');
    await failedServer.close();

    const okServer = Fastify({ logger: false });
    const okProbe = vi.fn(async (): Promise<ChromiumProbe> => ({ ok: true, executablePath: '/secret/bin/chrome', source: 'system' }));
    await registerHealthRoute(okServer, { version: '9.9.9', probe: okProbe, atRest: OK_AT_REST });
    await okServer.ready();
    const okResponse = await okServer.inject({ method: 'GET', url: '/health' });
    const okRaw = okResponse.payload;
    expect(okRaw).not.toContain('/secret/bin/chrome');
    expect(okRaw).not.toContain('/usr/');
    expect(okRaw).not.toContain('/root/');
    await okServer.close();
  });

  it('H4: health probes the browser again on every request', async () => {
    const server = Fastify({ logger: false });
    const probe = vi.fn()
      .mockResolvedValueOnce({ ok: false, tried: ['/a'] })
      .mockResolvedValueOnce({ ok: true, executablePath: '/usr/bin/chromium', source: 'system' });
    await registerHealthRoute(server, { version: '9.9.9', probe, atRest: OK_AT_REST });
    await server.ready();

    const first = await server.inject({ method: 'GET', url: '/health' });
    expect(first.json().status).toBe('degraded');
    const second = await server.inject({ method: 'GET', url: '/health' });
    expect(second.json().status).toBe('ok');
    expect(probe).toHaveBeenCalledTimes(2);
    await server.close();
  });

  it('H5: checks.atRestEncryption.status is carried through; failed degrades top-level status, empty/ok do not', async () => {
    const okBrowserProbe = vi.fn(async (): Promise<ChromiumProbe> => ({ ok: true, executablePath: '/usr/bin/chromium', source: 'system' }));

    const failedServer = Fastify({ logger: false });
    await registerHealthRoute(failedServer, { version: '9.9.9', probe: okBrowserProbe, atRest: { status: 'failed' } });
    await failedServer.ready();
    const failedResponse = await failedServer.inject({ method: 'GET', url: '/health' });
    const failedBody = failedResponse.json();
    expect(failedBody.checks.atRestEncryption.status).toBe('failed');
    expect(failedBody.status).toBe('degraded');
    await failedServer.close();

    const emptyServer = Fastify({ logger: false });
    await registerHealthRoute(emptyServer, { version: '9.9.9', probe: okBrowserProbe, atRest: { status: 'empty' } });
    await emptyServer.ready();
    const emptyResponse = await emptyServer.inject({ method: 'GET', url: '/health' });
    const emptyBody = emptyResponse.json();
    expect(emptyBody.checks.atRestEncryption.status).toBe('empty');
    expect(emptyBody.status).toBe('ok');
    await emptyServer.close();

    const okServer = Fastify({ logger: false });
    await registerHealthRoute(okServer, { version: '9.9.9', probe: okBrowserProbe, atRest: { status: 'ok' } });
    await okServer.ready();
    const okResponse = await okServer.inject({ method: 'GET', url: '/health' });
    const okBody = okResponse.json();
    expect(okBody.checks.atRestEncryption.status).toBe('ok');
    expect(okBody.status).toBe('ok');
    await okServer.close();
  });

  it('H6: /health never exposes at-rest counts, store names, key material or paths (extends H3)', async () => {
    const probe = vi.fn(async (): Promise<ChromiumProbe> => ({ ok: true, executablePath: '/usr/bin/chromium', source: 'system' }));
    const server = Fastify({ logger: false });
    await registerHealthRoute(server, { version: '9.9.9', probe, atRest: { status: 'failed' } });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/health' });
    const raw = response.payload;
    // The only allowed shape for atRestEncryption is { status: <enum> }.
    const body = response.json();
    expect(Object.keys(body.checks.atRestEncryption)).toEqual(['status']);
    expect(raw).not.toMatch(/oauth-signing-keys|service-connections|git-credentials|plugin-configs/);
    expect(raw).not.toMatch(/[A-Za-z0-9+/]{16,}={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]{16,}={0,2}/); // no iv:ciphertext:tag shape
    expect(raw).not.toContain('checked');
    expect(raw).not.toContain('failed":');
    await server.close();
  });

  it('H7: the route never re-runs the at-rest check per request — the precomputed result is reused', async () => {
    const probe = vi.fn(async (): Promise<ChromiumProbe> => ({ ok: true, executablePath: '/usr/bin/chromium', source: 'system' }));
    let atRestStatusReads = 0;
    const server = Fastify({ logger: false });
    // A getter lets the test COUNT how many times the route reads the
    // precomputed result, without registerHealthRoute itself knowing.
    const atRest = {
      get status() {
        atRestStatusReads++;
        return 'ok' as const;
      },
    };
    await registerHealthRoute(server, { version: '9.9.9', probe, atRest });
    await server.ready();

    await server.inject({ method: 'GET', url: '/health' });
    await server.inject({ method: 'GET', url: '/health' });

    // Exactly one property read per request (two requests -> two reads).
    // The route has no way to call checkAtRestDecryption itself — it never
    // receives a DB handle or the encryption key, only this precomputed
    // status — so this also proves there is no SEPARATE check invocation.
    expect(atRestStatusReads).toBe(2);
    await server.close();
  });
});

describe('logBrowserResolution', () => {
  function fakeLog() {
    return { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  }

  it('S1: startup logs an error naming every tried path when no browser resolves', () => {
    const fakeLogInstance = fakeLog();
    const failedProbe: ChromiumProbe = { ok: false, tried: ['/fake/one', '/fake/two'] };
    logBrowserResolution(fakeLogInstance as never, failedProbe);

    expect(fakeLogInstance.error).toHaveBeenCalledTimes(1);
    const [payload] = fakeLogInstance.error.mock.calls[0];
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('/fake/one');
    expect(serialized).toContain('/fake/two');
    expect(fakeLogInstance.info).not.toHaveBeenCalled();
  });

  it('S2: startup logs the resolved browser when one resolves', () => {
    const fakeLogInstance = fakeLog();
    const okProbe: ChromiumProbe = { ok: true, executablePath: '/usr/bin/chromium', source: 'system' };
    logBrowserResolution(fakeLogInstance as never, okProbe);

    expect(fakeLogInstance.info).toHaveBeenCalledTimes(1);
    const [payload] = fakeLogInstance.info.mock.calls[0];
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('/usr/bin/chromium');
    expect(serialized).toContain('system');
    expect(fakeLogInstance.error).not.toHaveBeenCalled();
  });
});
