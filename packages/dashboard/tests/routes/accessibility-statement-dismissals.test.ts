/**
 * Phase 88 Plan 07: the accessibility statement applies the scan org's active
 * dismissals through its OWN buildVpat call (the eighth ACR path) and discloses
 * them per criterion in a dedicated section (FP-07, D-10, D-11). Counts only.
 *
 * Drives the REAL public + admin routes with the REAL store (Plan 01 drivers).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import handlebars from 'handlebars';

process.env['TZ'] ??= 'UTC';

import {
  createSurfaceContext,
  makeServer,
  registerViewHelpers,
  type SurfaceContext,
} from '../golden/drivers/render-drivers.js';
import { driveStatementHtml } from '../golden/drivers/acr-export-drivers.js';
import { accessibilityStatementRoutes } from '../../src/routes/accessibility-statement.js';
import { buildAccessibilityStatement } from '../../src/services/accessibility-statement-service.js';
import type { VpatReport, VpatRow } from '../../src/services/vpat-service.js';
import type { AccessibilityStatementRecord } from '../../src/db/interfaces/accessibility-statement-repository.js';
import {
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  FABRIKAM_SITE,
  REASON_TOKEN,
  seedSurfaceDismissal,
} from '../helpers/dismissal-surface-fixture.js';

let ctx: SurfaceContext;

beforeEach(async () => {
  registerViewHelpers();
  ctx = await createSurfaceContext();
});

afterEach(async () => {
  await ctx.cleanup();
});

async function dismiss(match: { readonly code: string; readonly selector: string }): Promise<void> {
  await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match });
}

const DISMISSED_HEADING = 'Automated findings dismissed after review';

/** The dismissed-findings section: from its heading to the next <h2>, or '' when absent. */
function dismissedSection(html: string): string {
  const start = html.indexOf(DISMISSED_HEADING);
  if (start === -1) return '';
  const next = html.indexOf('<h2', start);
  return html.slice(start, next === -1 ? undefined : next);
}

/** The text of every known-limitation block (<div class="limitation">). */
function limitationBlocks(html: string): string[] {
  return html.match(/<div class="limitation">[\s\S]*?<\/div>/g) ?? [];
}

function configRecord(): AccessibilityStatementRecord {
  return {
    orgId: 'org-1',
    enabled: true,
    wcagVersion: '2.1',
    wcagLevel: 'AA',
    updatedAt: '2026-05-30T00:00:00.000Z',
    entityName: 'Fabrikam',
    siteUrl: FABRIKAM_SITE,
  };
}

function plainVpat(rows: VpatRow[]): VpatReport {
  return {
    siteUrl: FABRIKAM_SITE,
    standard: 'WCAG2AA',
    level: 'AA',
    generatedAt: '2026-10-01',
    tablesByLevel: [{ level: 'A', rows }],
    summary: { supports: 1, partial: 0, doesNotSupport: 0, notApplicable: 0, notEvaluated: 0, total: rows.length },
    legalFramings: [],
    includeFunctionalPerformance: false,
    functionalPerformanceHeading: '',
  } as unknown as VpatReport;
}

describe('public accessibility statement applies the scan org active dismissals', () => {
  it('accessibility statement discloses dismissed findings per criterion', async () => {
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const html = await driveStatementHtml(ctx);

    const section = dismissedSection(html);
    expect(section).not.toBe('');
    const entries = section.match(/<li>[\s\S]*?<\/li>/g) ?? [];
    expect(entries).toHaveLength(2);
    const contrast = entries.find((e) => e.includes('(WCAG 1.4.3)'));
    const alt = entries.find((e) => e.includes('(WCAG 1.1.1)'));
    expect(contrast).toContain('3 automated finding(s) dismissed as false positives after review');
    expect(alt).toContain('1 automated finding(s) dismissed as false positives after review');

    // Counts only: neither the reason nor the actor is on a public document.
    expect(html).not.toContain(REASON_TOKEN);
    expect(html).not.toContain('fabrikam-admin');
  });

  it('accessibility statement no longer lists a fully dismissed criterion as a limitation', async () => {
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const html = await driveStatementHtml(ctx);

    const limitations = limitationBlocks(html);
    // 1.4.3 keeps failing through the same-code sibling; 1.1.1 lost its only finding (D-10).
    expect(limitations.some((l) => l.includes('(WCAG 1.4.3)'))).toBe(true);
    expect(limitations.some((l) => l.includes('(WCAG 1.1.1)'))).toBe(false);
  });

  it('accessibility statement carries no disclosure when the only dismissals are another org or another site', async () => {
    // createSurfaceContext already seeded Northwind-on-the-same-URL and Fabrikam-on-another-site.
    const html = await driveStatementHtml(ctx);
    expect(html).not.toContain(DISMISSED_HEADING);
    expect(html).not.toContain(REASON_TOKEN);
  });
});

describe('statement view', () => {
  it('statement view carries no disclosure key when nothing is dismissed', () => {
    const row: VpatRow = {
      criterion: '1.1.1',
      title: 'Non-text Content',
      level: 'A',
      version: '2.1',
      url: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html',
      conformance: 'Supports',
      remarks: '',
    };
    const view = buildAccessibilityStatement(configRecord(), plainVpat([row]), { generatedAt: '2026-10-01' });
    expect(Object.prototype.hasOwnProperty.call(view, 'dismissedDisclosures')).toBe(false);
  });

  it('statement view lists every criterion with a dismissed count and nothing else', () => {
    const base: VpatRow = {
      criterion: '1.1.1',
      title: 'Non-text Content',
      level: 'A',
      version: '2.1',
      url: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html',
      conformance: 'Supports',
      remarks: '',
    };
    const rows: VpatRow[] = [
      { ...base, dismissedCount: 1 },
      { ...base, criterion: '1.4.3', title: 'Contrast (Minimum)', conformance: 'Does Not Support', dismissedCount: 3 },
      { ...base, criterion: '2.4.4', title: 'Link Purpose (In Context)' },
    ];
    const view = buildAccessibilityStatement(configRecord(), plainVpat(rows), { generatedAt: '2026-10-01' });
    expect(view.dismissedDisclosures).toEqual([
      { criterion: '1.1.1', title: 'Non-text Content', count: 1 },
      { criterion: '1.4.3', title: 'Contrast (Minimum)', count: 3 },
    ]);
  });
});

describe('admin accessibility statement preview', () => {
  async function previewOf(): Promise<{ dismissedDisclosures?: ReadonlyArray<unknown> }> {
    await ctx.storage.accessibilityStatements.upsert(
      ctx.orgs.fabrikamOrgId,
      { enabled: true, wcagVersion: '2.1', wcagLevel: 'AA', entityName: 'Fabrikam', siteUrl: FABRIKAM_SITE },
      'fabrikam-admin',
    );
    const server = await makeServer(ctx, async (s) => {
      // The shared Fabrikam identity lacks the statement permission; grant it after the shared hook.
      s.addHook('preHandler', async (request) => {
        (request as unknown as Record<string, unknown>)['permissions'] = new Set(['admin.org']);
      });
      await accessibilityStatementRoutes(s, ctx.storage);
    });
    try {
      const res = await server.inject({ method: 'GET', url: '/admin/accessibility-statement' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { data: { preview: { dismissedDisclosures?: ReadonlyArray<unknown> } } };
      return body.data.preview;
    } finally {
      await server.close();
    }
  }

  it('accessibility statement preview counts criteria with dismissed findings', async () => {
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const preview = await previewOf();
    expect(preview.dismissedDisclosures).toHaveLength(2);
    // The preview carries counts only: no reason, no actor.
    expect(JSON.stringify(preview)).not.toContain(REASON_TOKEN);
    expect(JSON.stringify(preview)).not.toContain('fabrikam-admin');
  });

  it('accessibility statement preview has no disclosure key with zero dismissals', async () => {
    const preview = await previewOf();
    expect(Object.prototype.hasOwnProperty.call(preview, 'dismissedDisclosures')).toBe(false);
  });
});

describe('admin preview template and locales', () => {
  const adminTemplate = readFileSync(
    join(import.meta.dirname, '..', '..', 'src', 'views', 'admin', 'accessibility-statement.hbs'),
    'utf-8',
  );

  /** Render only the preview <aside> with the real translator. */
  function renderPreview(preview: Record<string, unknown>): string {
    const aside = adminTemplate.match(/<aside[\s\S]*?<\/aside>/);
    if (aside === null) throw new Error('no preview <aside> in the admin statement template');
    return handlebars.compile(aside[0])({ preview }, { data: { root: { locale: 'en' } } });
  }

  const basePreview = {
    entityName: 'Fabrikam',
    standardLabel: 'WCAG 2.1 level AA',
    conformanceStatus: 'partially-conformant',
    hasAssessment: true,
    assessmentDate: '2026-10-01',
    knownLimitations: [],
    notEvaluatedCount: 4,
  };

  it('accessibility statement preview renders the dismissed-criteria count only when there is one', () => {
    const withDismissals = renderPreview({
      ...basePreview,
      dismissedDisclosures: [
        { criterion: '1.1.1', title: 'Non-text Content', count: 1 },
        { criterion: '1.4.3', title: 'Contrast (Minimum)', count: 3 },
      ],
    });
    expect(withDismissals).toMatch(/Criteria with dismissed findings:\s*<strong>2<\/strong>/);
    expect(renderPreview(basePreview)).not.toContain('dismissed findings');
  });

  const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'pt'] as const;
  const KEYS: ReadonlyArray<readonly [string, string]> = [
    ['public', 'dismissedHeading'],
    ['public', 'dismissedItem'],
    ['admin', 'previewDismissed'],
  ];

  it('statement dismissal keys exist in every locale', () => {
    for (const locale of LOCALES) {
      const file = join(import.meta.dirname, '..', '..', 'src', 'i18n', 'locales', `${locale}.json`);
      const block = (JSON.parse(readFileSync(file, 'utf-8')) as {
        a11yStatement: Record<string, Record<string, string>>;
      }).a11yStatement;
      for (const [section, key] of KEYS) {
        const value = block[section]?.[key];
        expect(typeof value === 'string' && value.trim() !== '', `${locale} a11yStatement.${section}.${key}`).toBe(true);
      }
      // The count placeholder must survive translation (double-brace).
      expect(block['public']?.['dismissedItem'], `${locale} dismissedItem placeholder`).toContain('{{count}}');
    }
  });
});
