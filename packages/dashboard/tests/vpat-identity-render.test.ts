/**
 * Integration UAT for the per-org VPAT/ACR report identity. Exercises the REAL
 * paths end-to-end (no browser, deterministic):
 *   - buildVpat threads `identity` into the report + populates the attestation
 *     evaluator from `preparedBy`.
 *   - the REAL vpat.hbs renders the identity header/company block/logo (and
 *     renders NOTHING extra when identity is absent — backward-compat).
 *   - generateVpatPdf produces a non-empty ACR with + without identity.
 *   - the REAL SqliteStorageAdapter (migration 082) + resolveScanIdentity
 *     round-trip a stored identity and degrade to null when unset.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildVpat, type VpatScanInput, type VpatReport } from '../src/services/vpat-service.js';
import { generateVpatPdf, type PdfScanMeta } from '../src/pdf/generator.js';
import { resolveScanIdentity } from '../src/services/vpat-share-service.js';
import { buildAcrView } from '../src/services/acr-view.js';
import { renderAcrHtml } from '../src/services/acr-render.js';
import { loadTranslations, t } from '../src/i18n/index.js';
import { SqliteStorageAdapter } from '../src/db/sqlite/index.js';
import type { VpatIdentity } from '../src/services/vpat-identity.js';

const GEN_AT = '2026-06-01';

beforeAll(async () => {
  await loadTranslations();
});

function makeReport(): ReturnType<typeof import('../src/services/report-service.js').normalizeReportData> {
  return {
    summary: { pagesScanned: 2, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } },
    allIssueGroups: [
      {
        criterion: '1.1.1',
        title: 'Non-text Content',
        wcagUrl: 'https://example.com',
        count: 1, warningCount: 0, noticeCount: 0, errorCount: 1, pageCount: 1,
        regulations: [], components: [],
      },
    ],
    topActionItems: [], templateComponents: [], complianceMatrix: null, errors: [],
  } as unknown as ReturnType<typeof import('../src/services/report-service.js').normalizeReportData>;
}

const scanAA: VpatScanInput = { siteUrl: 'https://acme.example', standard: 'WCAG2AA' };
const scanMeta: PdfScanMeta = {
  siteUrl: 'https://acme.example', standard: 'WCAG2AA',
  jurisdictions: 'US', regulations: 'ADA', createdAtDisplay: GEN_AT,
};
const identity: VpatIdentity = {
  entityName: 'Acme Corporation, Inc.',
  contactEmail: 'a11y@acme.example',
  postalAddress: '1 Main St, Anytown',
  preparedBy: 'Acme Accessibility Office',
};

// Render the SINGLE-SOURCE shared ACR template the way the share/report routes
// do (buildAcrView → renderAcrHtml). `logoUrl` is the data URI / path the route
// would resolve for the org logo.
async function renderVpat(vpat: VpatReport, meta: PdfScanMeta, logoUrl?: string): Promise<string> {
  const view = buildAcrView(vpat, meta, { locale: 'en', t, ...(logoUrl ? { logoUrl } : {}) });
  return renderAcrHtml(view, { locale: 'en' });
}

describe('VPAT report identity — buildVpat threading', () => {
  it('attaches the identity and uses preparedBy as the attestation evaluator', () => {
    const vpat = buildVpat(makeReport(), scanAA, [], { generatedAt: GEN_AT, identity });
    expect(vpat.identity?.entityName).toBe('Acme Corporation, Inc.');
    expect(vpat.attestation.evaluator).toBe('Acme Accessibility Office');
  });

  it('renders no identity when none is supplied (backward-compat)', () => {
    const vpat = buildVpat(makeReport(), scanAA, [], { generatedAt: GEN_AT });
    expect(vpat.identity).toBeUndefined();
    expect(vpat.attestation.evaluator).toBeUndefined();
  });
});

describe('VPAT report identity — shared ACR template render', () => {
  it('renders the entity name, contact mailto, address, logo and evaluator row', async () => {
    const vpat = buildVpat(makeReport(), scanAA, [], {
      generatedAt: GEN_AT,
      identity: { ...identity, logoPath: '/uploads/org-1/branding-images/logo.png' },
    });
    // The route resolves the logo to a (data URI) src; here we pass the path.
    const html = await renderVpat(vpat, scanMeta, '/uploads/org-1/branding-images/logo.png');
    expect(html).toContain('Acme Corporation, Inc.');
    expect(html).toContain('mailto:a11y@acme.example');
    expect(html).toContain('1 Main St, Anytown');
    expect(html).toContain('<div class="acr__identity">');
    // Mustache escapes '/' → '&#x2F;' in attributes (browsers decode it).
    expect(html.replace(/&#x2F;/g, '/')).toContain('/uploads/org-1/branding-images/logo.png');
    // The attestation evaluator row renders the preparer org.
    expect(html).toContain('Acme Accessibility Office');
  });

  it('omits the identity block entirely when no identity is set', async () => {
    const vpat = buildVpat(makeReport(), scanAA, [], { generatedAt: GEN_AT });
    const html = await renderVpat(vpat, scanMeta);
    // The .acr__identity CSS rules are always inlined; assert the rendered
    // element + entity attribution are absent.
    expect(html).not.toContain('<div class="acr__identity">');
    expect(html).not.toContain('Acme Corporation');
  });
});

describe('VPAT report identity — PDF ACR', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  });

  it('embeds the logo + identity without throwing, and produces a PDF', async () => {
    const uploadsRoot = join(tmpdir(), `uat-uploads-${randomUUID()}`);
    dirs.push(uploadsRoot);
    const logoDir = join(uploadsRoot, 'org-1', 'branding-images');
    mkdirSync(logoDir, { recursive: true });
    // 1x1 PNG.
    writeFileSync(
      join(logoDir, 'logo.png'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'),
    );
    const vpat = buildVpat(makeReport(), scanAA, [], {
      generatedAt: GEN_AT,
      identity: { ...identity, logoPath: '/uploads/org-1/branding-images/logo.png' },
    });
    const pdf = await generateVpatPdf(scanMeta, vpat, { groups: [], uploadsRoot });
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 60000);

  it('produces a PDF with no identity set (backward-compat)', async () => {
    const vpat = buildVpat(makeReport(), scanAA, [], { generatedAt: GEN_AT });
    const pdf = await generateVpatPdf(scanMeta, vpat);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 60000);

  it('renders the explicit "Standards & laws evaluated against" section (HTML + PDF) for selected regulations', async () => {
    const usScan: VpatScanInput = {
      siteUrl: 'https://acme.example',
      standard: 'WCAG2AA',
      jurisdictions: ['US'],
      regulations: ['US-ADA', 'US-NY-NYC-LL12'],
    };
    const vpat = buildVpat(makeReport(), usScan, [], {
      generatedAt: GEN_AT,
      regulationDetails: new Map([
        ['US-ADA', {
          id: 'US-ADA',
          name: 'Americans with Disabilities Act',
          reference: '42 U.S.C. § 12101',
          description: 'The ADA prohibits discrimination against people with disabilities.',
          enforcementDate: '1990-07-26',
        }],
        ['US-NY-NYC-LL12', {
          id: 'US-NY-NYC-LL12',
          name: 'New York City Local Law 12 of 2023 — Website Accessibility',
          reference: 'NYC Admin Code § 23-802.1',
          description: 'Requires NYC agencies to meet WCAG 2.1 Level AA.',
        }],
      ]),
    });
    // HTML view renders a programmatic note per regulation: name, citation, description.
    const html = await renderVpat(vpat, scanMeta);
    expect(html).toContain('Standards &amp; laws evaluated against');
    expect(html).toContain('Americans with Disabilities Act');
    expect(html).toContain('US-ADA');
    expect(html).toContain('42 U.S.C.');
    expect(html).toContain('The ADA prohibits discrimination');
    expect(html).toContain('Local Law 12');
    expect(html).toContain('Requires NYC agencies to meet WCAG 2.1 Level AA.');
    // Section-level disclaimer present; curated per-law paragraphs retired.
    expect(html).toContain('do not constitute legal advice');
    // PDF render exercises the new branch without throwing.
    const pdf = await generateVpatPdf(
      { ...scanMeta, regulations: 'US-ADA, US-NY-NYC-LL12' },
      vpat,
    );
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 60000);
});

describe('VPAT report identity — storage round-trip (migration 082)', () => {
  const paths: string[] = [];
  afterEach(() => {
    for (const p of paths.splice(0)) if (existsSync(p)) rmSync(p, { force: true });
  });

  async function freshStorage(): Promise<SqliteStorageAdapter> {
    const dbPath = join(tmpdir(), `uat-identity-${randomUUID()}.db`);
    paths.push(dbPath);
    const storage = new SqliteStorageAdapter(dbPath);
    await storage.migrate();
    return storage;
  }

  it('upserts + reads a report identity, and resolveScanIdentity threads it', async () => {
    const storage = await freshStorage();
    expect(storage.reportIdentities).toBeDefined();
    const org = await storage.organizations.createOrg({ name: 'Acme', slug: `acme-${randomUUID().slice(0, 8)}` });
    await storage.reportIdentities!.upsert(org.id, {
      entityName: 'Acme Corporation, Inc.',
      contactEmail: 'a11y@acme.example',
      preparedBy: 'Acme Accessibility Office',
    });
    const scan = { id: 'scan-1', orgId: org.id, siteUrl: 'https://acme.example' };
    const resolved = await resolveScanIdentity(storage, scan as never);
    expect(resolved?.entityName).toBe('Acme Corporation, Inc.');
    expect(resolved?.preparedBy).toBe('Acme Accessibility Office');
    await storage.disconnect();
  });

  it('resolves to null for an org with no identity (report renders as today)', async () => {
    const storage = await freshStorage();
    const scan = { id: 'scan-2', orgId: 'org-none', siteUrl: 'https://none.example' };
    expect(await resolveScanIdentity(storage, scan as never)).toBeNull();
    await storage.disconnect();
  });
});
