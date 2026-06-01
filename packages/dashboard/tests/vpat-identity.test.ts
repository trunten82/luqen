import { describe, it, expect } from 'vitest';
import { resolveReportIdentity } from '../src/services/vpat-identity.js';
import type { ReportIdentityRecord } from '../src/db/interfaces/report-identity-repository.js';

function rec(over: Partial<ReportIdentityRecord> = {}): ReportIdentityRecord {
  return {
    orgId: 'org-1',
    entityName: 'Acme Corporation',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

describe('resolveReportIdentity', () => {
  it('builds a full identity block from a complete record + logo', () => {
    const id = resolveReportIdentity(
      rec({
        contactEmail: 'a11y@acme.test',
        postalAddress: '1 Main St, Anytown',
        preparedBy: 'Acme Accessibility Office',
      }),
      '/uploads/org-1/branding-images/logo.png',
    );
    expect(id).not.toBeNull();
    expect(id?.entityName).toBe('Acme Corporation');
    expect(id?.contactEmail).toBe('a11y@acme.test');
    expect(id?.postalAddress).toBe('1 Main St, Anytown');
    expect(id?.preparedBy).toBe('Acme Accessibility Office');
    expect(id?.logoPath).toBe('/uploads/org-1/branding-images/logo.png');
  });

  it('returns null for a null/undefined record (backward-compat — renders as today)', () => {
    expect(resolveReportIdentity(null, '/uploads/x.png')).toBeNull();
    expect(resolveReportIdentity(undefined, null)).toBeNull();
  });

  it('treats a blank/whitespace-only entity name as unset (null)', () => {
    expect(resolveReportIdentity(rec({ entityName: '   ' }), null)).toBeNull();
    expect(resolveReportIdentity(rec({ entityName: '' }), null)).toBeNull();
    expect(resolveReportIdentity(rec({ entityName: undefined }), null)).toBeNull();
  });

  it('omits optional fields when blank and trims the entity name', () => {
    const id = resolveReportIdentity(
      rec({ entityName: '  Acme  ', contactEmail: '  ', postalAddress: '', preparedBy: undefined }),
      null,
    );
    expect(id?.entityName).toBe('Acme');
    expect(id?.contactEmail).toBeUndefined();
    expect(id?.postalAddress).toBeUndefined();
    expect(id?.preparedBy).toBeUndefined();
    expect(id?.logoPath).toBeUndefined();
  });

  it('includes the logo only when a truthy path is supplied', () => {
    expect(resolveReportIdentity(rec(), '')?.logoPath).toBeUndefined();
    expect(resolveReportIdentity(rec(), null)?.logoPath).toBeUndefined();
    expect(resolveReportIdentity(rec(), '/uploads/l.png')?.logoPath).toBe('/uploads/l.png');
  });
});
