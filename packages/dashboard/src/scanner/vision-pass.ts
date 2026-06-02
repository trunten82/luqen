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
 * full-page screenshot + heading outline, plus a per-image alt-text check (WCAG
 * 1.1.1) on the images whose rendered bytes were captured. Every call is
 * independently guarded — vision is additive, so any failure degrades to [].
 */

/**
 * Max images per page to run the alt-text vision check on. Each is a separate
 * LLM call, so this bounds cost; @luqen/core also caps how many image bytes it
 * captures (`visualImageBytes`).
 */
export const MAX_ALT_TEXT_IMAGES = 5;

export function buildVisionAnalyzer(
  client: LLMClient,
  orgId: string | undefined,
): (ctx: VisualContext, url: string) => Promise<readonly Issue[]> {
  const org = orgId !== undefined ? { orgId } : {};
  return async (ctx: VisualContext): Promise<readonly Issue[]> => {
    const issues: Issue[] = [];

    // --- heading-semantics (WCAG 1.3.1) — full-page screenshot + outline ---
    if (ctx.headingOutline && ctx.headingOutline.trim().length > 0) {
      try {
        const result = await client.analyseVisual({
          check: 'heading-semantics',
          image: ctx.screenshot,
          context: ctx.headingOutline,
          ...org,
        });
        if (result.verdict === 'issue' && Array.isArray(result.findings)) {
          for (const f of result.findings) {
            issues.push(mapVisionFindingToIssue(f, 'document', ctx.headingOutline.slice(0, 200)));
          }
        }
      } catch {
        // degrade silently — heading-semantics is additive.
      }
    }

    // --- alt-text (WCAG 1.1.1) — per image whose bytes were captured ---
    const withBytes = ctx.images.filter((img) => img.bytes !== undefined).slice(0, MAX_ALT_TEXT_IMAGES);
    for (const img of withBytes) {
      try {
        const context = [img.alt !== null ? `current alt: "${img.alt}"` : 'no alt attribute', img.surroundingText]
          .filter((s) => s.length > 0)
          .join(' — ');
        const result = await client.analyseVisual({
          check: 'alt-text',
          image: img.bytes!,
          context,
          ...org,
        });
        if (result.verdict !== 'issue' || !Array.isArray(result.findings)) continue;
        const suffix =
          typeof result.suggestedAlt === 'string' && result.suggestedAlt.length > 0
            ? ` — suggested alt: "${result.suggestedAlt}"`
            : '';
        for (const f of result.findings) {
          const issue = mapVisionFindingToIssue(
            { ...f, wcagCriterion: f.wcagCriterion || '1.1.1' },
            img.selector,
            img.surroundingText.slice(0, 200),
          );
          issues.push(suffix === '' ? issue : { ...issue, message: `${issue.message}${suffix}` });
        }
      } catch {
        // one image's failure must not sink the rest of the pass.
      }
    }

    return issues;
  };
}
