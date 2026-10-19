/**
 * The Dismissed section's view model: API-key names and their creation-time tag (HARD-08, D-91-10).
 *
 * A marking key is named from the snapshot stored with the dismissal, so the name survives the key's
 * deletion; a revoking key is named from the scan org's live key rows. Both carry the key's creation
 * time as a tag, which tells two keys with the same label apart. Names and tags appear only when the
 * caller says the viewer may see them (showKeyNames). The stored identifier is never in the view.
 */
import { describe, it, expect } from 'vitest';
import type { IssueDismissal } from '../../../src/db/interfaces/issue-dismissal-repository.js';
import { buildDismissalsView } from '../../../src/services/issue-dismissals/dismissals-view.js';

process.env['TZ'] ??= 'UTC';

const AT_A = '2026-03-01T10:00:00.000Z';
const AT_B = '2026-05-17T16:30:00.000Z';

function row(overrides: Partial<IssueDismissal> = {}): IssueDismissal {
  return {
    id: 'd-1',
    orgId: 'org-fabrikam',
    siteUrl: 'https://example.com/',
    siteKey: 'https://example.com',
    code: 'WCAG2AA.1_4_3',
    selector: '#hero > p',
    reason: 'seeded',
    status: 'active',
    createdBy: 'alice',
    createdById: 'u-1',
    createdAt: '2026-10-01T08:00:00.000Z',
    revokedBy: null,
    revokedById: null,
    revokedAt: null,
    revokeComment: null,
    createdByKeySnapshot: null,
    ...overrides,
  };
}

const keyActor = (id: string) => ({ createdBy: `api-key:${id}`, createdById: `api-key:${id}` });

describe('API-key names in the Dismissed section (HARD-08)', () => {
  it('HARD-08 a deleted key still renders its label and creation time', () => {
    const rows = [row({ ...keyActor('k-gone'), createdByKeySnapshot: { label: 'CI deploy', keyCreatedAt: AT_A } })];
    const view = buildDismissalsView(rows, { keys: new Map(), showKeyNames: true });

    const r = view!.active[0]!;
    expect(r.actorIsApiKey).toBe(true);
    expect(r.actorKeyName).toBe('CI deploy');
    expect(r.actorKeyCreatedDisplay).toBe(new Date(AT_A).toLocaleString());
    expect(r.actorKeyCreatedIso).toBe(AT_A);
    // The view never carries the stored identifier in a name or tag.
    expect(JSON.stringify([r.actorKeyName, r.actorKeyCreatedDisplay, r.actorKeyCreatedIso])).not.toContain('k-gone');
  });

  it('HARD-08 two keys with the same label render different creation times', () => {
    const rows = [
      row({ id: 'd-1', ...keyActor('k-1'), createdByKeySnapshot: { label: 'CI deploy', keyCreatedAt: AT_A } }),
      row({ id: 'd-2', ...keyActor('k-2'), createdByKeySnapshot: { label: 'CI deploy', keyCreatedAt: AT_B } }),
      row({
        id: 'd-3', status: 'revoked', revokedBy: 'api-key:k-3', revokedById: 'api-key:k-3',
        revokedAt: '2026-10-02T08:00:00.000Z', revokeComment: null,
      }),
      row({
        id: 'd-4', status: 'revoked', revokedBy: 'api-key:k-4', revokedById: 'api-key:k-4',
        revokedAt: '2026-10-03T08:00:00.000Z', revokeComment: null,
      }),
    ];
    const keys = new Map([
      ['k-3', { label: 'CI deploy', createdAt: AT_A }],
      ['k-4', { label: 'CI deploy', createdAt: AT_B }],
    ]);
    const view = buildDismissalsView(rows, { keys, showKeyNames: true })!;

    const [a, b] = view.active;
    expect([a!.actorKeyName, b!.actorKeyName]).toEqual(['CI deploy', 'CI deploy']);
    expect(a!.actorKeyCreatedDisplay).not.toBe('');
    expect(a!.actorKeyCreatedDisplay).not.toBe(b!.actorKeyCreatedDisplay);

    const [c, d] = view.revoked;
    expect([c!.revokedByKeyName, d!.revokedByKeyName]).toEqual(['CI deploy', 'CI deploy']);
    expect(c!.revokedByKeyCreatedDisplay).not.toBe('');
    expect(c!.revokedByKeyCreatedDisplay).not.toBe(d!.revokedByKeyCreatedDisplay);
  });

  it('HARD-08 a viewer who may not touch the scan org sees the generic label even with a snapshot', () => {
    const rows = [
      row({ id: 'd-1', ...keyActor('k-1'), createdByKeySnapshot: { label: 'CI deploy', keyCreatedAt: AT_A } }),
      row({
        id: 'd-2', ...keyActor('k-2'), status: 'revoked', revokedBy: 'api-key:k-2', revokedById: 'api-key:k-2',
        revokedAt: '2026-10-02T08:00:00.000Z', revokeComment: null,
      }),
    ];
    const keys = new Map([['k-2', { label: 'Live key', createdAt: AT_B }]]);
    const hidden = buildDismissalsView(rows, { keys, showKeyNames: false })!;
    for (const r of [...hidden.active, ...hidden.revoked]) {
      expect(r.actorIsApiKey).toBe(true);
      expect(r.actorKeyName).toBe('');
      expect(r.actorKeyCreatedDisplay).toBe('');
      expect(r.revokedByKeyName).toBe('');
      expect(r.revokedByKeyCreatedDisplay).toBe('');
    }

    // Control: the same rows and keys, shown to a viewer who may touch the org, are named.
    const shown = buildDismissalsView(rows, { keys, showKeyNames: true })!;
    expect(shown.active[0]!.actorKeyName).toBe('CI deploy');
    expect(shown.revoked[0]!.revokedByKeyName).toBe('Live key');
    expect(shown.revoked[0]!.revokedByKeyCreatedDisplay).not.toBe('');
  });
});

describe('dismissal dates in the viewer locale (HARD-05)', () => {
  const MARKED = '2026-03-01T10:00:00.000Z';
  const REVOKED = '2026-05-17T16:30:00.000Z';

  it('HARD-05 dismissed date renders in the requested locale', () => {
    const view = buildDismissalsView([row({ createdAt: MARKED })], { locale: 'de' })!;
    const de = new Date(MARKED).toLocaleString('de');
    expect(de).not.toBe(new Date(MARKED).toLocaleString('en')); // the instrument can tell them apart
    expect(view.active[0]!.createdAtDisplay).toBe(de);
  });

  it('HARD-05 revoked date renders in the requested locale', () => {
    const rows = [
      row({
        createdAt: MARKED, status: 'revoked', revokedBy: 'bob', revokedById: 'u-2', revokedAt: REVOKED,
        revokeComment: null,
      }),
    ];
    const view = buildDismissalsView(rows, { locale: 'it' })!;
    const it_ = new Date(REVOKED).toLocaleString('it');
    expect(it_).not.toBe(new Date(REVOKED).toLocaleString('en'));
    expect(view.revoked[0]!.revokedAtDisplay).toBe(it_);
    expect(view.revoked[0]!.createdAtDisplay).toBe(new Date(MARKED).toLocaleString('it'));
  });
});
