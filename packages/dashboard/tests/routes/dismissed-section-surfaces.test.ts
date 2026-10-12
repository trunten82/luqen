/**
 * Phase 89 Plan 05 — the Dismissed section and the reasons and actors in it exist ONLY on the
 * authenticated report page (D-09, FP-15, T-89-05-02).
 *
 * Each public or print surface is rendered through its REAL route with an ACTIVE dismissal
 * seeded (and a positive control that the dismissal is in force on that very surface), and its
 * output must contain neither the section marker nor the reviewer's reason. A guard checked
 * against an empty fixture would prove nothing: with no dismissal there is nothing to leak.
 */
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env['TZ'] ??= 'UTC';

import {
  createSurfaceContext,
  drivePrint,
  drivePublicReport,
  makeServer,
  registerViewHelpers,
  type SurfaceContext,
} from '../golden/drivers/render-drivers.js';
import { driveStatementHtml, drivePublicAcrHtml } from '../golden/drivers/acr-export-drivers.js';
import { shareRoutes } from '../../src/routes/share.js';
import {
  AFTER_BOTH,
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  REASON_TOKEN,
  seedSurfaceDismissal,
} from '../helpers/dismissal-surface-fixture.js';

let ctx: SurfaceContext;

beforeEach(async () => {
  registerViewHelpers();
  ctx = await createSurfaceContext();
  // Two ACTIVE dismissals of the dismissing org on this very site: the reason token is in the
  // store, so any leak path has something to leak.
  for (const match of [DISMISS_PARTIAL, DISMISS_WHOLE]) {
    await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match });
  }
});

afterEach(async () => {
  await ctx.cleanup();
});

/** The section's own markers: its id/class, its translated heading, and the reviewer's free text. */
function expectNoDismissedSection(html: string): void {
  expect(html).not.toContain('rpt-dismissed');
  expect(html).not.toContain('Dismissed findings');
  expect(html).not.toContain(REASON_TOKEN);
  expect(html).not.toContain('issueDismissals.');
}

function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

describe('the Dismissed section is absent from every public and print surface', () => {
  it('print view has no Dismissed section', async () => {
    const html = await drivePrint(ctx, ctx.scanId);
    // Positive control: the dismissals are in force on this surface (counts follow them).
    expect(visibleText(html)).toContain(`${AFTER_BOTH.total} Total Issues`);
    expectNoDismissedSection(html);
  });

  it('public report has no Dismissed section', async () => {
    const html = await drivePublicReport(ctx, ctx.scanId);
    expect(visibleText(html)).toContain(
      `Issues ${AFTER_BOTH.total} Errors ${AFTER_BOTH.errors} Warnings ${AFTER_BOTH.warnings} Notices ${AFTER_BOTH.notices}`,
    );
    expectNoDismissedSection(html);
  });

  it('token share has no Dismissed section', async () => {
    const share = await ctx.storage.reportShares.createShare({
      scanId: ctx.scanId,
      orgId: ctx.orgs.fabrikamOrgId,
    });
    const server = await makeServer(ctx, (s) =>
      shareRoutes(s, ctx.storage, join(ctx.store.reportsDir, 'uploads')),
    );
    try {
      const res = await server.inject({
        method: 'GET',
        url: `/share/${share.token}`,
        headers: { host: 'dashboard.example' },
      });
      expect(res.statusCode).toBe(200);
      const html = res.body.replace(/&#x2F;/g, '/');
      // Positive control: the counts-only disclosure of the dismissals IS on this page.
      expect(html).toMatch(/dismissed as (a )?false positives?/);
      expectNoDismissedSection(html);
    } finally {
      await server.close();
    }
  });

  it('public ACR has no Dismissed section', async () => {
    const html = await drivePublicAcrHtml(ctx, ctx.scanId);
    expect(html).toMatch(/dismissed as (a )?false positives?/);
    expectNoDismissedSection(html);
  });

  it('accessibility statement has no Dismissed section', async () => {
    const html = await driveStatementHtml(ctx);
    expect(html).toContain('dismissed as false positives after review');
    expectNoDismissedSection(html);
  });
});

describe('the authenticated report page is the only place the section exists', () => {
  it('the section source is in report-detail.hbs and in no other template', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const views = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'views');
    const carriers: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.hbs') && readFileSync(full, 'utf8').includes('rpt-dismissed')) carriers.push(full.slice(views.length + 1));
      }
    };
    walk(views);
    expect(carriers).toEqual(['report-detail.hbs']);
  });
});
