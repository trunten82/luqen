import { describe, it, expect, vi, beforeAll } from 'vitest';

const { mockLaunchChromium, mockSafeCloseBrowser } = vi.hoisted(() => ({
  mockLaunchChromium: vi.fn(),
  mockSafeCloseBrowser: vi.fn(async (browser: unknown) => {
    const b = browser as { close?: () => Promise<void> } | undefined;
    if (b?.close) await b.close();
  }),
}));

vi.mock('@luqen/core', () => ({
  launchChromium: mockLaunchChromium,
  safeCloseBrowser: mockSafeCloseBrowser,
}));

import { generateAcrPdf } from '../../src/services/acr-render.js';
import { buildAcrView } from '../../src/services/acr-view.js';
import type { VpatReport } from '../../src/services/vpat-service.js';
import type { PdfScanMeta } from '../../src/pdf/generator.js';
import { loadTranslations, t } from '../../src/i18n/index.js';

beforeAll(async () => {
  await loadTranslations();
});

const scanMeta: PdfScanMeta = {
  siteUrl: 'https://shop.example.com/',
  standard: 'WCAG 2.1 Level AA',
  jurisdictions: 'US',
  regulations: 'US-ADA',
  createdAtDisplay: '2026-06-02',
};

function baseVpat(): VpatReport {
  return {
    siteUrl: 'https://shop.example.com/',
    standard: 'WCAG 2.1 Level AA',
    level: 'AA',
    generatedAt: '2026-06-02',
    tablesByLevel: [
      { level: 'A', rows: [
        { criterion: '1.1.1', title: 'Non-text Content', level: 'A', conformance: 'Does Not Support', remarks: '3 errors' },
      ] },
    ],
    summary: { supports: 1, partial: 0, doesNotSupport: 1, notApplicable: 0, notEvaluated: 0, total: 2 },
    section508: { functionalPerformance: [
      { id: '302.1', need: 'Without vision', conformance: 'Does Not Support', remarks: 'r', relatedCriteria: ['1.1.1'] },
    ] },
    evaluatedStandards: [
      { token: 'US-ADA', name: 'Americans with Disabilities Act', reference: '42 U.S.C. § 12101', enforcementDate: '1990-07-26', description: 'Prohibits discrimination.', url: '' },
    ],
    includeFunctionalPerformance: true,
    functionalPerformanceHeading: 'Section 508',
    remediation: null,
    attestation: {
      evaluationDate: '2026-06-02', pagesEvaluated: 1, methods: ['Automated scanning'],
      standardsLabel: 'WCAG 2.1 Level AA · ADA', manualTestingRecorded: false,
    },
  } as VpatReport;
}

function fakeBrowser() {
  const page = {
    setContent: vi.fn().mockResolvedValue(undefined),
    evaluateHandle: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  };
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
    __page: page,
  };
}

describe('generateAcrPdf — shared launcher (CHROMIUM-RESOLVE-1)', () => {
  it('AR1: acr pdf rendering launches through the shared core launcher', async () => {
    const browser = fakeBrowser();
    mockLaunchChromium.mockReset().mockResolvedValue(browser);
    mockSafeCloseBrowser.mockClear();

    const view = buildAcrView(baseVpat(), scanMeta, { locale: 'en', t });
    const result = await generateAcrPdf(view);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(mockLaunchChromium).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('AR2: acr pdf rendering surfaces a missing browser error', async () => {
    const err = new Error('No Chromium/Chrome executable could be resolved');
    mockLaunchChromium.mockReset().mockRejectedValue(err);

    const view = buildAcrView(baseVpat(), scanMeta, { locale: 'en', t });
    await expect(generateAcrPdf(view)).rejects.toBe(err);
  });
});
