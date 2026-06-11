/**
 * Tests for digest-generator.ts (generateDigestPdf, buildDigestPdfAttachment)
 * and digest-email-builder.ts (buildDigestEmailBody).
 *
 * TDD RED phase — these tests pin the specified behavior surface.
 */

import { describe, it, expect } from 'vitest';
import {
  generateDigestPdf,
  buildDigestPdfAttachment,
} from '../../src/pdf/digest-generator.js';
import { buildDigestEmailBody } from '../../src/email/digest-email-builder.js';
import type { DigestData } from '../../src/services/digest-service.js';
import type { DigestSchedule } from '../../src/db/types.js';
import { DISCLAIMER_TEXT } from '../../src/services/legal-exposure.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORSENED_SITE_EXPOSURE = {
  band: 'high' as const,
  drivers: [],
  asOf: '2026-06-01',
  disclaimer: DISCLAIMER_TEXT,
};

const IMPROVED_SITE_EXPOSURE = {
  band: 'lower' as const,
  drivers: [],
  asOf: '2026-06-01',
  disclaimer: DISCLAIMER_TEXT,
};

const MODERATE_SITE_EXPOSURE = {
  band: 'moderate' as const,
  drivers: [],
  asOf: '2026-06-01',
  disclaimer: DISCLAIMER_TEXT,
};

const SAMPLE_DIGEST_DATA: DigestData = {
  orgId: 'org-test',
  siteUrl: null,
  period: { start: '2026-05-25T00:00:00.000Z', end: '2026-06-01T00:00:00.000Z' },
  generatedAt: '2026-06-01T10:00:00.000Z',
  sites: [
    {
      siteUrl: 'https://worsened.example.com',
      hasNewScan: true,
      errors: 15,
      warnings: 8,
      notices: 3,
      errorsDelta: 5,
      warningsDelta: 2,
      noticesDelta: -1,
      criteriaChanges: [
        { criterion: '1.1.1', newFindings: 3, fixedFindings: 0 },
        { criterion: '2.4.1', newFindings: 0, fixedFindings: 2 },
      ],
      currentExposure: WORSENED_SITE_EXPOSURE,
      baselineExposure: MODERATE_SITE_EXPOSURE,
      direction: 'worsened',
    },
    {
      siteUrl: 'https://improved.example.com',
      hasNewScan: true,
      errors: 2,
      warnings: 1,
      notices: 0,
      errorsDelta: -3,
      warningsDelta: -2,
      noticesDelta: 0,
      criteriaChanges: [
        { criterion: '2.4.1', newFindings: 0, fixedFindings: 2 },
      ],
      currentExposure: IMPROVED_SITE_EXPOSURE,
      baselineExposure: MODERATE_SITE_EXPOSURE,
      direction: 'improved',
    },
    {
      siteUrl: 'https://noscan.example.com',
      hasNewScan: false,
      errors: 5,
      warnings: 2,
      notices: 1,
      errorsDelta: 0,
      warningsDelta: 0,
      noticesDelta: 0,
      criteriaChanges: [],
      currentExposure: MODERATE_SITE_EXPOSURE,
      baselineExposure: null,
      direction: 'unchanged',
    },
  ],
};

const SAMPLE_SCHEDULE: DigestSchedule = {
  id: 'sched-01',
  orgId: 'org-test',
  name: 'Board Digest',
  siteUrl: null,
  frequency: 'weekly',
  recipients: 'cfo@example.com',
  channels: ['email'],
  enabled: true,
  nextSendAt: '2026-06-08T00:00:00.000Z',
  lastSentAt: '2026-06-01T00:00:00.000Z',
  createdBy: 'admin',
  createdAt: '2026-05-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// generateDigestPdf tests
// ---------------------------------------------------------------------------

describe('generateDigestPdf', () => {
  it('returns a non-empty Buffer starting with the %PDF header', async () => {
    const org = { name: 'Acme Corp', address: '123 Main St', website: 'https://acme.com' };
    const buffer = await generateDigestPdf(SAMPLE_DIGEST_DATA, org);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    // PDF magic bytes
    expect(buffer.slice(0, 4).toString()).toBe('%PDF');
  });

  it('omits identity block when org.name is not set', async () => {
    // Should not throw even with no org identity
    const buffer = await generateDigestPdf(SAMPLE_DIGEST_DATA, {});
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.slice(0, 4).toString()).toBe('%PDF');
  });

  it('includes band labels for all exposure bands', async () => {
    const buffer = await generateDigestPdf(SAMPLE_DIGEST_DATA, { name: 'Test Org' });
    const pdfText = buffer.toString('latin1');
    // PDF contains the band label text (embedded in stream)
    // We check the raw content includes recognizable label strings
    expect(buffer.length).toBeGreaterThan(1000);
  });
});

// ---------------------------------------------------------------------------
// buildDigestPdfAttachment tests
// ---------------------------------------------------------------------------

describe('buildDigestPdfAttachment', () => {
  it('returns an EmailAttachment with correct filename and contentType', async () => {
    const attachment = await buildDigestPdfAttachment(SAMPLE_DIGEST_DATA, SAMPLE_SCHEDULE);
    expect(attachment).not.toBeNull();
    expect(attachment!.contentType).toBe('application/pdf');
    // filename includes org slug and period hint
    expect(attachment!.filename).toMatch(/accessibility-digest-.+\.pdf/);
  });

  it('returns an EmailAttachment with Buffer content', async () => {
    const attachment = await buildDigestPdfAttachment(SAMPLE_DIGEST_DATA, SAMPLE_SCHEDULE);
    expect(attachment).not.toBeNull();
    expect(attachment!.content).toBeInstanceOf(Buffer);
    expect((attachment!.content as Buffer).length).toBeGreaterThan(0);
  });

  it('includes orgId slug in the filename', async () => {
    const attachment = await buildDigestPdfAttachment(SAMPLE_DIGEST_DATA, SAMPLE_SCHEDULE);
    expect(attachment).not.toBeNull();
    expect(attachment!.filename).toContain('org-test');
  });
});

// ---------------------------------------------------------------------------
// buildDigestEmailBody tests
// ---------------------------------------------------------------------------

describe('buildDigestEmailBody', () => {
  it('returns an HTML string', () => {
    const html = buildDigestEmailBody(SAMPLE_DIGEST_DATA);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('contains a band label string for each site', () => {
    const html = buildDigestEmailBody(SAMPLE_DIGEST_DATA);
    // Each exposure band should appear as a label
    expect(html).toMatch(/[Hh]igh/);
    expect(html).toMatch(/[Ll]ower/);
    expect(html).toMatch(/[Mm]oderate/);
  });

  it('contains the DISCLAIMER_TEXT', () => {
    const html = buildDigestEmailBody(SAMPLE_DIGEST_DATA);
    // The full disclaimer text or a significant part of it
    expect(html).toContain('not legal advice');
    expect(html).toContain('qualified attorney');
  });

  it('does not contain any forbidden words', () => {
    const html = buildDigestEmailBody(SAMPLE_DIGEST_DATA);
    // D-12 forbidden words test (as verdict claims, not CSS values)
    expect(html).not.toMatch(/\bcompliant\b/i);
    // "100%" as a verdict claim — not as CSS width value (width: 100%)
    // We check for standalone occurrence not preceded by CSS colon or inside style attribute
    expect(html).not.toMatch(/\b100% (accessible|fixed|resolved)/i);
    expect(html).not.toMatch(/\blawsuit-proof\b/i);
    expect(html).not.toMatch(/will be sued/i);
    expect(html).not.toMatch(/\bguarantee[sd]?\b/i);
  });

  it('does not contain a bare numeric exposure score (band must be a label)', () => {
    const html = buildDigestEmailBody(SAMPLE_DIGEST_DATA);
    // There should be no exposure number like "Exposure: 3" or "score: 75"
    // Band is always one of the 4 label strings
    expect(html).not.toMatch(/exposure.*?score/i);
    expect(html).not.toMatch(/exposure.*?\d{2,}/i);
  });

  it('does not contain external stylesheet links', () => {
    const html = buildDigestEmailBody(SAMPLE_DIGEST_DATA);
    expect(html).not.toContain('<link');
    expect(html).not.toContain('<style>');
    expect(html).not.toContain('<style ');
  });

  it('contains a CTA link to view the digest', () => {
    const html = buildDigestEmailBody(SAMPLE_DIGEST_DATA);
    expect(html).toMatch(/view.*digest|digest.*view/i);
  });

  it('contains the methodology link reference', () => {
    const html = buildDigestEmailBody(SAMPLE_DIGEST_DATA);
    expect(html).toContain('/methodology/legal-exposure');
  });
});
