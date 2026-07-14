/**
 * Regression: createComplianceClient read `data.data.id` but the compliance
 * service returns the created client FLAT (`{id, secret, …}` at 201, no
 * envelope — see packages/compliance/src/api/routes/clients.ts). Every
 * per-org compliance client creation threw
 * `TypeError: Cannot read properties of undefined (reading 'id')` — the
 * startup backfill warned on every boot and the org-create path silently
 * failed to provision a client.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createComplianceClient } from '../src/compliance-client.js';

function mockFetchOnce(body: unknown, status = 201): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
}

describe('createComplianceClient response parsing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses the flat shape the compliance service actually returns', async () => {
    mockFetchOnce({ id: 'client-1', name: 'dashboard-Acme', secret: 's3cret', scopes: ['read'] });

    const result = await createComplianceClient('http://c', 'tok', 'org-1', 'Acme');

    expect(result).toEqual({ clientId: 'client-1', clientSecret: 's3cret' });
  });

  it('still accepts an enveloped { data: {…} } shape', async () => {
    mockFetchOnce({ data: { id: 'client-2', secret: 'sec2' } });

    const result = await createComplianceClient('http://c', 'tok', 'org-1', 'Acme');

    expect(result).toEqual({ clientId: 'client-2', clientSecret: 'sec2' });
  });

  it('throws a descriptive error (not a TypeError) on an unexpected shape', async () => {
    mockFetchOnce({ something: 'else' });

    await expect(
      createComplianceClient('http://c', 'tok', 'org-1', 'Acme'),
    ).rejects.toThrow(/unexpected.*shape/i);
  });

  it('throws with status on a non-ok response', async () => {
    mockFetchOnce({ error: 'nope' }, 403);

    await expect(
      createComplianceClient('http://c', 'tok', 'org-1', 'Acme'),
    ).rejects.toThrow(/403/);
  });
});
