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
import { describe, it, expect, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import HandlebarsLib from 'handlebars';
import { buildVpat, type VpatScanInput } from '../src/services/vpat-service.js';
import { generateVpatPdf, type PdfScanMeta } from '../src/pdf/generator.js';
import { resolveScanIdentity } from '../src/services/vpat-share-service.js';
import { SqliteStorageAdapter } from '../src/db/sqlite/index.js';
import type { VpatIdentity } from '../src/services/vpat-identity.js';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));
const GEN_AT = '2026-06-01';

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

// Render vpat.hbs the way the share/report routes do, with the helpers it needs.
async function renderVpat(vpat: unknown, scan: unknown): Promise<string> {
  const hb = HandlebarsLib.create();
  const en = JSON.parse(await readFile(join(__dirname, '..', 'src', 'i18n', 'locales', 'en.json'), 'utf8'));
  hb.registerHelper('t', (key: string) =>
    String(key).split('.').reduce((o: unknown, k) => (o as Record<string, unknown> | undefined)?.[k], en) ?? key,
  );
  hb.registerHelper('formatStandard', (s: unknown) => String(s));
  hb.registerHelper('conformanceBadge', (c: string) => new hb.SafeString(`<span class="badge">${hb.escapeExpression(c)}</span>`));
  const tpl = hb.compile(await readFile(join(__dirname, '..', 'src', 'views', 'vpat.hbs'), 'utf8'));
  return tpl({ vpat, scan }, { data: { root: { locale: 'en' } } });
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

describe('VPAT report identity — vpat.hbs render', () => {
  it('renders the entity name, contact mailto, address and evaluator row', async () => {
    const vpat = buildVpat(makeReport(), scanAA, [], {
      generatedAt: GEN_AT,
      identity: { ...identity, logoPath: '/uploads/org-1/branding-images/logo.png' },
    });
    const html = await renderVpat(vpat, { siteUrl: scanAA.siteUrl });
    expect(html).toContain('Acme Corporation, Inc.');
    expect(html).toContain('mailto:a11y@acme.example');
    expect(html).toContain('1 Main St, Anytown');
    expect(html).toContain('report-identity__logo');
    expect(html).toContain('/uploads/org-1/branding-images/logo.png');
    // The attestation evaluator row renders the preparer org.
    expect(html).toContain('Acme Accessibility Office');
  });

  it('omits the identity block entirely when no identity is set', async () => {
    const vpat = buildVpat(makeReport(), scanAA, [], { generatedAt: GEN_AT });
    const html = await renderVpat(vpat, { siteUrl: scanAA.siteUrl });
    // The .report-identity CSS rules are always present; assert the rendered
    // block + entity attribution are absent.
    expect(html).not.toContain('<div class="report-identity">');
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
    const vpat = buildVpat(makeReport(), usScan, [], { generatedAt: GEN_AT });
    // HTML view enumerates each regulation by full name.
    const html = await renderVpat(vpat, { siteUrl: usScan.siteUrl });
    expect(html).toContain('Standards &amp; laws evaluated against');
    expect(html).toContain('Americans with Disabilities Act');
    expect(html).toContain('(US-ADA)');
    expect(html).toContain('Local Law 12');
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
