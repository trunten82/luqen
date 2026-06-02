import { describe, it, expect, vi } from 'vitest';
import { mapVisionFindingToIssue, buildVisionAnalyzer } from '../../src/scanner/vision-pass.js';
import type { VisualContext } from '@luqen/core';
import type { LLMClient } from '../../src/llm-client.js';

const CTX: VisualContext = {
  screenshot: { mediaType: 'image/png', data: 'PNGB64' },
  headingOutline: 'HEADING <h1>: "Title"\nCANDIDATE <div> (28px weight:700): "Fake Heading"',
  images: [],
};

function clientWith(analyseVisual: LLMClient['analyseVisual']): LLMClient {
  return { analyseVisual } as unknown as LLMClient;
}

describe('mapVisionFindingToIssue', () => {
  it('maps dotted criterion to underscore code and confidence to type', () => {
    const issue = mapVisionFindingToIssue(
      { description: 'Styled div used as a heading', wcagCriterion: '1.3.1', confidence: 'high' },
      'document',
      'ctx',
    );
    expect(issue.code).toBe('1_3_1');
    expect(issue.type).toBe('error');
    expect(issue.runner).toBe('vision');
  });

  it('low confidence → notice', () => {
    const issue = mapVisionFindingToIssue(
      { description: 'maybe', wcagCriterion: '1.3.1', confidence: 'low' },
      'document',
      'ctx',
    );
    expect(issue.type).toBe('notice');
  });
});

describe('buildVisionAnalyzer', () => {
  it('calls analyse-visual with the screenshot + heading outline and maps issue findings', async () => {
    const analyseVisual = vi.fn().mockResolvedValue({
      verdict: 'issue',
      findings: [{ description: 'Styled div heading', wcagCriterion: '1.3.1', confidence: 'high' }],
    });
    const analyzer = buildVisionAnalyzer(clientWith(analyseVisual), 'org-1');
    const issues = await analyzer(CTX, 'https://x.test/');

    expect(analyseVisual).toHaveBeenCalledWith(
      expect.objectContaining({ check: 'heading-semantics', image: CTX.screenshot, context: CTX.headingOutline, orgId: 'org-1' }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('1_3_1');
    expect(issues[0].runner).toBe('vision');
  });

  it('returns [] on a pass verdict', async () => {
    const analyzer = buildVisionAnalyzer(
      clientWith(vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] })),
      undefined,
    );
    expect(await analyzer(CTX, 'u')).toEqual([]);
  });

  it('degrades to [] when analyse-visual throws (no vision model / 503)', async () => {
    const analyzer = buildVisionAnalyzer(
      clientWith(vi.fn().mockRejectedValue(new Error('HTTP 503'))),
      'org-1',
    );
    expect(await analyzer(CTX, 'u')).toEqual([]);
  });

  it('skips the call entirely when the heading outline is empty', async () => {
    const analyseVisual = vi.fn();
    const analyzer = buildVisionAnalyzer(clientWith(analyseVisual), 'org-1');
    const empty: VisualContext = { ...CTX, headingOutline: '', images: [] };
    expect(await analyzer(empty, 'u')).toEqual([]);
    expect(analyseVisual).not.toHaveBeenCalled();
  });
});

const imgWithBytes = (selector: string, alt: string | null) => ({
  selector,
  src: 'https://x.test/a.png',
  alt,
  role: null,
  surroundingText: 'around the image',
  bytes: { mediaType: 'image/png' as const, data: 'IMGB64' },
});

describe('buildVisionAnalyzer — alt-text (Phase 84 C#1)', () => {
  it('runs an alt-text check per image that has captured bytes and maps issue findings to 1.1.1 with the image selector', async () => {
    const analyseVisual = vi.fn(async (input: { check: string }) => {
      if (input.check === 'heading-semantics') return { verdict: 'pass', findings: [] };
      return {
        verdict: 'issue',
        findings: [{ description: 'Alt text does not describe the chart', wcagCriterion: '1.1.1', confidence: 'medium' as const }],
        suggestedAlt: 'Bar chart of quarterly revenue',
      };
    });
    const ctx: VisualContext = { ...CTX, headingOutline: '', images: [imgWithBytes('img:nth-of-type(1)', 'logo')] };
    const analyzer = buildVisionAnalyzer(clientWith(analyseVisual as unknown as LLMClient['analyseVisual']), 'org-1');
    const issues = await analyzer(ctx, 'https://x.test/');

    const altCall = analyseVisual.mock.calls.find((c) => c[0].check === 'alt-text');
    expect(altCall).toBeDefined();
    expect(altCall?.[0]).toMatchObject({ check: 'alt-text', image: { mediaType: 'image/png', data: 'IMGB64' }, orgId: 'org-1' });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('1_1_1');
    expect(issues[0].selector).toBe('img:nth-of-type(1)');
    expect(issues[0].runner).toBe('vision');
    // The suggested alt is surfaced to the remediator.
    expect(issues[0].message).toContain('Bar chart of quarterly revenue');
  });

  it('does not run alt-text for images without captured bytes', async () => {
    const analyseVisual = vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] });
    const noBytes = { selector: 'img', src: 's', alt: 'x', role: null, surroundingText: '' };
    const ctx: VisualContext = { ...CTX, headingOutline: '', images: [noBytes] };
    const analyzer = buildVisionAnalyzer(clientWith(analyseVisual), 'org-1');
    expect(await analyzer(ctx, 'u')).toEqual([]);
    expect(analyseVisual).not.toHaveBeenCalled();
  });

  it('caps the number of per-image alt-text calls', async () => {
    const analyseVisual = vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] });
    const many = Array.from({ length: 12 }, (_v, i) => imgWithBytes(`img:nth-of-type(${i + 1})`, null));
    const ctx: VisualContext = { ...CTX, headingOutline: '', images: many };
    const analyzer = buildVisionAnalyzer(clientWith(analyseVisual), 'org-1');
    await analyzer(ctx, 'u');
    const altCalls = analyseVisual.mock.calls.filter((c) => c[0].check === 'alt-text');
    expect(altCalls.length).toBeLessThanOrEqual(5);
  });

  it('a single failing alt-text call does not sink the whole pass', async () => {
    const analyseVisual = vi.fn(async (input: { check: string }) => {
      if (input.check === 'alt-text') throw new Error('HTTP 503');
      return { verdict: 'pass', findings: [] };
    });
    const ctx: VisualContext = { ...CTX, headingOutline: '', images: [imgWithBytes('img', null)] };
    const analyzer = buildVisionAnalyzer(clientWith(analyseVisual as unknown as LLMClient['analyseVisual']), 'org-1');
    expect(await analyzer(ctx, 'u')).toEqual([]);
  });
});

describe('buildVisionAnalyzer — evaluated-criteria sink (Phase 84 C#2)', () => {
  it("records '1.3.1' when heading-semantics returns a 'pass' verdict", async () => {
    const sink = new Set<string>();
    const analyzer = buildVisionAnalyzer(
      clientWith(vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] })),
      'org-1',
      sink,
    );
    await analyzer(CTX, 'u');
    expect(sink.has('1.3.1')).toBe(true);
  });

  it("records '1.3.1' when heading-semantics returns an 'issue' verdict", async () => {
    const sink = new Set<string>();
    const analyzer = buildVisionAnalyzer(
      clientWith(vi.fn().mockResolvedValue({
        verdict: 'issue',
        findings: [{ description: 'd', wcagCriterion: '1.3.1', confidence: 'high' }],
      })),
      'org-1',
      sink,
    );
    await analyzer(CTX, 'u');
    expect(sink.has('1.3.1')).toBe(true);
  });

  it("does NOT record '1.3.1' on an 'uncertain' verdict", async () => {
    const sink = new Set<string>();
    const analyzer = buildVisionAnalyzer(
      clientWith(vi.fn().mockResolvedValue({ verdict: 'uncertain', findings: [] })),
      'org-1',
      sink,
    );
    await analyzer(CTX, 'u');
    expect(sink.has('1.3.1')).toBe(false);
  });

  it("does NOT record '1.3.1' when analyse-visual throws", async () => {
    const sink = new Set<string>();
    const analyzer = buildVisionAnalyzer(
      clientWith(vi.fn().mockRejectedValue(new Error('HTTP 503'))),
      'org-1',
      sink,
    );
    await analyzer(CTX, 'u');
    expect(sink.has('1.3.1')).toBe(false);
  });

  it("does NOT record '1.3.1' when the heading outline is empty (call never runs)", async () => {
    const sink = new Set<string>();
    const analyzer = buildVisionAnalyzer(clientWith(vi.fn()), 'org-1', sink);
    await analyzer({ ...CTX, headingOutline: '', images: [] }, 'u');
    expect(sink.has('1.3.1')).toBe(false);
  });

  it("records '1.1.1' when an alt-text call returns definitively ('pass')", async () => {
    const sink = new Set<string>();
    const analyseVisual = vi.fn(async (input: { check: string }) => {
      if (input.check === 'heading-semantics') return { verdict: 'pass', findings: [] };
      return { verdict: 'pass', findings: [] };
    });
    const ctx: VisualContext = { ...CTX, headingOutline: '', images: [imgWithBytes('img', 'logo')] };
    const analyzer = buildVisionAnalyzer(clientWith(analyseVisual as unknown as LLMClient['analyseVisual']), 'org-1', sink);
    await analyzer(ctx, 'u');
    expect(sink.has('1.1.1')).toBe(true);
  });

  it("records '1.1.1' when an alt-text call returns an 'issue' verdict", async () => {
    const sink = new Set<string>();
    const analyseVisual = vi.fn(async (input: { check: string }) => {
      if (input.check === 'heading-semantics') return { verdict: 'pass', findings: [] };
      return { verdict: 'issue', findings: [{ description: 'd', wcagCriterion: '1.1.1', confidence: 'medium' }] };
    });
    const ctx: VisualContext = { ...CTX, headingOutline: '', images: [imgWithBytes('img', null)] };
    const analyzer = buildVisionAnalyzer(clientWith(analyseVisual as unknown as LLMClient['analyseVisual']), 'org-1', sink);
    await analyzer(ctx, 'u');
    expect(sink.has('1.1.1')).toBe(true);
  });

  it("does NOT record '1.1.1' when the alt-text call is 'uncertain' or throws", async () => {
    const sink = new Set<string>();
    const analyseVisual = vi.fn(async (input: { check: string }) => {
      if (input.check === 'heading-semantics') return { verdict: 'pass', findings: [] };
      if (input.check === 'alt-text') throw new Error('HTTP 503');
      return { verdict: 'pass', findings: [] };
    });
    const ctx: VisualContext = { ...CTX, headingOutline: '', images: [imgWithBytes('img', null)] };
    const analyzer = buildVisionAnalyzer(clientWith(analyseVisual as unknown as LLMClient['analyseVisual']), 'org-1', sink);
    await analyzer(ctx, 'u');
    expect(sink.has('1.1.1')).toBe(false);
  });

  it("does NOT record '1.1.1' when no images have captured bytes (call never runs)", async () => {
    const sink = new Set<string>();
    const noBytes = { selector: 'img', src: 's', alt: 'x', role: null, surroundingText: '' };
    const ctx: VisualContext = { ...CTX, headingOutline: '', images: [noBytes] };
    const analyzer = buildVisionAnalyzer(clientWith(vi.fn()), 'org-1', sink);
    await analyzer(ctx, 'u');
    expect(sink.has('1.1.1')).toBe(false);
  });

  it('is backward-compatible: omitting the sink keeps the existing Issue[] behavior', async () => {
    const analyzer = buildVisionAnalyzer(
      clientWith(vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] })),
      'org-1',
    );
    expect(await analyzer(CTX, 'u')).toEqual([]);
  });
});
