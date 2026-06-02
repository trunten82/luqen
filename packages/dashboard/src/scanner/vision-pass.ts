/**
 * LLM-vision pass (Phase 84) — dashboard side.
 *
 * Bridges @luqen/core's behavioral `onVisualContext` callback to the LLM
 * service's `analyse-visual` capability. Core captures the visual context (it
 * owns the browser page); this module turns that context into a vision-model
 * call and maps the verdict into core `Issue`s. It degrades to an empty result
 * on ANY error (no vision model configured → 503, timeout, network) so a scan
 * never fails because vision is unavailable.
 */

import type { Issue, VisualContext } from '@luqen/core';
import type { LLMClient } from '../llm-client.js';

type VisionFinding = {
  readonly description: string;
  readonly wcagCriterion: string;
  readonly confidence: 'low' | 'medium' | 'high';
};

/** WCAG criterion (dotted, e.g. "1.3.1") → behavioral Issue code ("1_3_1"). */
function toIssueCode(criterion: string): string {
  const m = criterion.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}_${m[2]}_${m[3]}` : criterion.replace(/\./g, '_');
}

function confidenceToType(c: VisionFinding['confidence']): Issue['type'] {
  if (c === 'high') return 'error';
  if (c === 'medium') return 'warning';
  return 'notice';
}

/** Map one vision finding to a core behavioral Issue (runner='vision'). */
export function mapVisionFindingToIssue(
  finding: VisionFinding,
  selector: string,
  context: string,
): Issue {
  return {
    type: confidenceToType(finding.confidence),
    code: toIssueCode(finding.wcagCriterion),
    message: finding.description,
    selector,
    context,
    runner: 'vision',
  };
}

/**
 * Build an `onVisualContext` analyzer bound to an LLM client + org. Runs the
 * heading-semantics check (accessibility-tree-vs-visual, WCAG 1.3.1) against the
 * full-page screenshot + heading outline. Returns [] on any failure.
 */
export function buildVisionAnalyzer(
  client: LLMClient,
  orgId: string | undefined,
): (ctx: VisualContext, url: string) => Promise<readonly Issue[]> {
  return async (ctx: VisualContext): Promise<readonly Issue[]> => {
    if (!ctx.headingOutline || ctx.headingOutline.trim().length === 0) {
      return [];
    }
    try {
      const result = await client.analyseVisual({
        check: 'heading-semantics',
        image: ctx.screenshot,
        context: ctx.headingOutline,
        ...(orgId !== undefined ? { orgId } : {}),
      });
      if (result.verdict !== 'issue' || !Array.isArray(result.findings)) {
        return [];
      }
      return result.findings.map((f) =>
        mapVisionFindingToIssue(f, 'document', ctx.headingOutline.slice(0, 200)),
      );
    } catch {
      // Vision is additive — degrade silently when unavailable.
      return [];
    }
  };
}
