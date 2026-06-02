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
    const empty: VisualContext = { ...CTX, headingOutline: '' };
    expect(await analyzer(empty, 'u')).toEqual([]);
    expect(analyseVisual).not.toHaveBeenCalled();
  });
});
