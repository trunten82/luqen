/**
 * ACT-01 (D-06): the ONE module that decides how a dismissal actor reads. Pure unit tests of its
 * exports; the surfaces that use it (report page, Excel export) have their own tests.
 *
 * Public repo: Fabrikam / Northwind labels only.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env['TZ'] ??= 'UTC';

import type { FastifyBaseLogger } from 'fastify';
import { loadTranslations, t, SUPPORTED_LOCALES } from '../../../src/i18n/index.js';
import type { Locale } from '../../../src/i18n/index.js';
import {
  actorLabelText,
  describeActor,
  hasApiKeyActor,
  isApiKeyActor,
  orgKeyMap,
  withDisplayedActors,
  type ScanOrgKeys,
} from '../../../src/services/issue-dismissals/actor-label.js';
import type { IssueDismissal } from '../../../src/db/interfaces/issue-dismissal-repository.js';
import type { AuthUser } from '../../../src/auth/middleware.js';

beforeAll(() => {
  loadTranslations();
});

const KEY_ID = '0a1b2c3d4e5f60718293a4b5c6d7e8f9';
const OTHER_KEY_ID = 'ffeeddccbbaa99887766554433221100';
const CREATED = '2026-03-01T10:00:00.000Z';
const SNAP_CREATED = '2026-02-01T08:30:00.000Z';

const KEYS: ScanOrgKeys = new Map([[KEY_ID, { label: 'Fabrikam CI', createdAt: CREATED }]]);

function named(label: string, createdAt: string, locale: Locale): string {
  return `${t('issueDismissals.actor.apiKeyNamed', locale, { name: label })} (${t('admin.apiKeys.created', locale)} ${new Date(createdAt).toLocaleString(locale)})`;
}

function describeKey(actorId: string, extra: { snapshot?: { label: string; keyCreatedAt: string } | null; showKeyNames?: boolean; keys?: ScanOrgKeys } = {}) {
  return describeActor({
    actor: actorId,
    actorId,
    snapshot: extra.snapshot ?? null,
    keys: extra.keys ?? KEYS,
    showKeyNames: extra.showKeyNames ?? true,
  });
}

describe('describeActor and actorLabelText', () => {
  it('ACT a user actor reads its user name', () => {
    const d = describeActor({ actor: 'fabrikam-admin', actorId: 'c0ffee00-0000-4000-8000-000000000001', keys: KEYS, showKeyNames: true });
    expect(d).toEqual({ kind: 'user', name: 'fabrikam-admin' });
    expect(actorLabelText(d, 'en')).toBe('fabrikam-admin');
  });

  it('ACT a user named api-key reads its user name', () => {
    const d = describeActor({ actor: 'api-key', actorId: 'c0ffee00-0000-4000-8000-000000000002', keys: KEYS, showKeyNames: true });
    expect(d).toEqual({ kind: 'user', name: 'api-key' });
    expect(actorLabelText(d, 'en')).toBe('api-key');
    expect(isApiKeyActor('api-key', 'c0ffee00-0000-4000-8000-000000000002')).toBe(false);
    // A user whose chosen name carries a real key id is still a user.
    const spoof = describeActor({ actor: `api-key:${KEY_ID}`, actorId: 'c0ffee00-0000-4000-8000-000000000003', keys: KEYS, showKeyNames: true });
    expect(actorLabelText(spoof, 'en')).toBe(`api-key:${KEY_ID}`);
  });

  it('ACT an API key of the scan org reads API key with its label and creation time', () => {
    const d = describeKey(`api-key:${KEY_ID}`);
    expect(d).toEqual({ kind: 'apiKey', key: { label: 'Fabrikam CI', createdAt: CREATED } });
    expect(actorLabelText(d, 'en')).toBe(named('Fabrikam CI', CREATED, 'en'));
    expect(actorLabelText(d, 'en')).toMatch(/^API key: Fabrikam CI \(Created .+\)$/);
  });

  it('ACT a marking key is named from its snapshot before the live key list', () => {
    const d = describeKey(`api-key:${KEY_ID}`, { snapshot: { label: 'Fabrikam CI (old)', keyCreatedAt: SNAP_CREATED } });
    expect(actorLabelText(d, 'en')).toBe(named('Fabrikam CI (old)', SNAP_CREATED, 'en'));
    // A deleted key: the live list no longer holds it, the snapshot still names it.
    const gone = describeKey(`api-key:${KEY_ID}`, { keys: new Map(), snapshot: { label: 'Fabrikam CI', keyCreatedAt: SNAP_CREATED } });
    expect(actorLabelText(gone, 'en')).toBe(named('Fabrikam CI', SNAP_CREATED, 'en'));
  });

  it('ACT a key outside the scan org reads API key', () => {
    const d = describeKey(`api-key:${OTHER_KEY_ID}`);
    expect(d).toEqual({ kind: 'apiKey', key: null });
    expect(actorLabelText(d, 'en')).toBe('API key');
  });

  it('ACT key names are withheld when the viewer may not see them', () => {
    const d = describeKey(`api-key:${KEY_ID}`, { showKeyNames: false, snapshot: { label: 'Fabrikam CI', keyCreatedAt: SNAP_CREATED } });
    expect(d).toEqual({ kind: 'apiKey', key: null });
    expect(actorLabelText(d, 'en')).toBe('API key');
    expect(actorLabelText(d, 'en')).not.toContain('Fabrikam');
  });

  it('ACT the session and bare legacy key actors read API key', () => {
    for (const actor of ['api-key:session', 'api-key', 'api-key:']) {
      const d = describeActor({ actor, actorId: actor, keys: KEYS, showKeyNames: true });
      expect(actorLabelText(d, 'en'), actor).toBe('API key');
    }
    expect(hasApiKeyActor([row({ createdBy: 'api-key', createdById: 'api-key' })])).toBe(true);
  });

  it('ACT the label is translated for the locale', () => {
    const d = describeKey(`api-key:${KEY_ID}`);
    for (const locale of SUPPORTED_LOCALES) {
      expect(actorLabelText(d, locale), locale).toBe(named('Fabrikam CI', CREATED, locale));
    }
    expect(actorLabelText(d, 'de')).not.toMatch(/^API key/);
    expect(actorLabelText(describeKey(`api-key:${OTHER_KEY_ID}`), 'it')).toBe(t('issueDismissals.actor.apiKey', 'it'));
  });

  it('ACT no label carries the stored identifier or the key id', () => {
    const cases = [
      describeKey(`api-key:${KEY_ID}`),
      describeKey(`api-key:${KEY_ID}`, { snapshot: { label: 'Fabrikam CI', keyCreatedAt: SNAP_CREATED } }),
      describeKey(`api-key:${KEY_ID}`, { showKeyNames: false }),
      describeKey(`api-key:${OTHER_KEY_ID}`),
      describeKey('api-key:session'),
      describeKey('api-key'),
    ];
    for (const d of cases) {
      for (const locale of SUPPORTED_LOCALES) {
        const text = actorLabelText(d, locale);
        expect(text).not.toContain('api-key:');
        expect(text).not.toContain(KEY_ID);
        expect(text).not.toContain(OTHER_KEY_ID);
      }
    }
  });
});

function row(over: Partial<IssueDismissal>): IssueDismissal {
  return {
    id: 'd-1',
    orgId: 'org-fabrikam',
    siteUrl: 'https://fabrikam.example/shop/',
    siteKey: 'fabrikam.example/shop',
    code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
    selector: '#fabrikam-promo-note',
    reason: 'Hidden copy',
    status: 'active',
    createdBy: 'fabrikam-admin',
    createdById: 'c0ffee00-0000-4000-8000-000000000001',
    createdAt: '2026-10-01T10:00:00.000Z',
    revokedBy: null,
    revokedById: null,
    revokedAt: null,
    revokeComment: null,
    ...over,
  };
}

const LOG = { warn: vi.fn() } as unknown as FastifyBaseLogger;
const ADMIN = { id: 'u-admin', username: 'fabrikam-admin', role: 'admin', currentOrgId: 'org-fabrikam' } as unknown as AuthUser;

function storageWith(listKeys: (orgId?: string) => Promise<unknown>) {
  return { apiKeys: { listKeys: vi.fn(listKeys) } } as never;
}

describe('orgKeyMap and withDisplayedActors', () => {
  it('ACT orgKeyMap keeps only the scan org rows and never throws', async () => {
    const storage = storageWith(async () => [
      { id: KEY_ID, orgId: 'org-fabrikam', label: 'Fabrikam CI', createdAt: CREATED },
      { id: OTHER_KEY_ID, orgId: 'org-northwind', label: 'Northwind CI', createdAt: CREATED },
    ]);
    const map = await orgKeyMap(storage, 'org-fabrikam', LOG, 'scan-1');
    expect([...map.keys()]).toEqual([KEY_ID]);
    const failing = storageWith(async () => { throw new Error('driver said SELECT secret'); });
    const warn = vi.fn();
    const empty = await orgKeyMap(failing, 'org-fabrikam', { warn } as unknown as FastifyBaseLogger, 'scan-1');
    expect(empty.size).toBe(0);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SELECT secret');
  });

  it('ACT a dismissal set with no key actor is returned as it is and reads no key', async () => {
    const storage = storageWith(async () => []);
    const rows = [row({})];
    const out = await withDisplayedActors(storage, ADMIN, { id: 'scan-1', orgId: 'org-fabrikam' }, rows, 'en', LOG);
    expect(out).toBe(rows);
    expect((storage as unknown as { apiKeys: { listKeys: ReturnType<typeof vi.fn> } }).apiKeys.listKeys).not.toHaveBeenCalled();
  });

  it('ACT the display copy relabels a key actor and leaves the stored row alone', async () => {
    const storage = storageWith(async () => [{ id: KEY_ID, orgId: 'org-fabrikam', label: 'Fabrikam CI', createdAt: CREATED }]);
    const stored = row({ createdBy: `api-key:${KEY_ID}`, createdById: `api-key:${KEY_ID}` });
    const out = await withDisplayedActors(storage, ADMIN, { id: 'scan-1', orgId: 'org-fabrikam' }, [stored], 'en', LOG);
    expect(out[0]!.createdBy).toBe(named('Fabrikam CI', CREATED, 'en'));
    expect(out[0]!.id).toBe(stored.id);
    expect(stored.createdBy).toBe(`api-key:${KEY_ID}`);
  });
});
