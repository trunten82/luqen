import { describe, it, expect } from 'vitest';
import { buildVpatEvidenceGroups } from '../../src/services/vpat-evidence.js';
import type { VpatReport } from '../../src/services/vpat-service.js';
import type { ManualTestEvidenceRecord } from '../../src/db/types.js';

function makeEvidence(
  partial: { criterionId: string; fileName: string } & Partial<ManualTestEvidenceRecord>,
): ManualTestEvidenceRecord {
  return {
    id: `mte-${partial.criterionId}-${partial.fileName}`,
    scanId: 'scan-1',
    criterionId: partial.criterionId,
    filePath: `/uploads/org-1/evidence/${partial.fileName}`,
    fileName: partial.fileName,
    mimeType: 'image/png',
    fileSize: 1234,
    uploadedBy: 'tester',
    uploadedAt: '2026-06-01T10:00:00.000Z',
    orgId: 'org-1',
    ...partial,
  };
}

// Minimal VPAT shape — buildVpatEvidenceGroups only reads tablesByLevel for titles.
function makeVpat(rows: Array<{ criterion: string; title: string }>): Pick<VpatReport, 'tablesByLevel'> {
  return {
    tablesByLevel: [
      {
        level: 'A',
        rows: rows.map((r) => ({
          criterion: r.criterion,
          title: r.title,
          level: 'A',
          version: '2.1',
          url: 'https://example.com',
          conformance: 'Supports',
          remarks: '',
        })),
      },
    ],
  } as unknown as Pick<VpatReport, 'tablesByLevel'>;
}

describe('buildVpatEvidenceGroups', () => {
  it('returns an empty array when there is no evidence', () => {
    expect(buildVpatEvidenceGroups([], makeVpat([{ criterion: '1.1.1', title: 'Non-text Content' }]))).toEqual([]);
  });

  it('groups evidence by criterion and resolves the title from the VPAT rows', () => {
    const groups = buildVpatEvidenceGroups(
      [
        makeEvidence({ criterionId: '1.1.1', fileName: 'a.png' }),
        makeEvidence({ criterionId: '1.1.1', fileName: 'b.png' }),
        makeEvidence({ criterionId: '1.4.3', fileName: 'contrast.pdf', mimeType: 'application/pdf' }),
      ],
      makeVpat([
        { criterion: '1.1.1', title: 'Non-text Content' },
        { criterion: '1.4.3', title: 'Contrast (Minimum)' },
      ]),
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ criterion: '1.1.1', title: 'Non-text Content' });
    expect(groups[0].items.map((i) => i.fileName)).toEqual(['a.png', 'b.png']);
    expect(groups[1]).toMatchObject({ criterion: '1.4.3', title: 'Contrast (Minimum)' });
  });

  it('flags image MIME types as isImage and non-images as not', () => {
    const groups = buildVpatEvidenceGroups(
      [
        makeEvidence({ criterionId: '1.1.1', fileName: 'shot.png', mimeType: 'image/png' }),
        makeEvidence({ criterionId: '1.1.1', fileName: 'shot.webp', mimeType: 'image/webp' }),
        makeEvidence({ criterionId: '1.1.1', fileName: 'transcript.pdf', mimeType: 'application/pdf' }),
        makeEvidence({ criterionId: '1.1.1', fileName: 'unknown.bin', mimeType: null }),
      ],
      makeVpat([{ criterion: '1.1.1', title: 'Non-text Content' }]),
    );
    const byName = new Map(groups[0].items.map((i) => [i.fileName, i.isImage]));
    expect(byName.get('shot.png')).toBe(true);
    expect(byName.get('shot.webp')).toBe(true);
    expect(byName.get('transcript.pdf')).toBe(false);
    expect(byName.get('unknown.bin')).toBe(false);
  });

  it('sorts groups by criterion id numerically (1.2.1 before 1.10.1)', () => {
    const groups = buildVpatEvidenceGroups(
      [
        makeEvidence({ criterionId: '1.10.1', fileName: 'z.png' }),
        makeEvidence({ criterionId: '1.2.1', fileName: 'a.png' }),
      ],
      makeVpat([
        { criterion: '1.2.1', title: 'Audio-only' },
        { criterion: '1.10.1', title: 'Reflow' },
      ]),
    );
    expect(groups.map((g) => g.criterion)).toEqual(['1.2.1', '1.10.1']);
  });

  it('falls back to an empty title when the criterion is not in the VPAT rows', () => {
    const groups = buildVpatEvidenceGroups(
      [makeEvidence({ criterionId: '9.9.9', fileName: 'orphan.png' })],
      makeVpat([{ criterion: '1.1.1', title: 'Non-text Content' }]),
    );
    expect(groups[0]).toMatchObject({ criterion: '9.9.9', title: '' });
  });
});
