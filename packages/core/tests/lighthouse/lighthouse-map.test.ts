/**
 * Fast (non-browser) unit tests for the Lighthouse audit → Issue mapper.
 *
 * Feeds a synthetic LHR-shaped `audits` map (no real browser / lighthouse run)
 * and asserts:
 *  - failing, attributable audits become Issues with the right WCAG criterion,
 *    runner='lighthouse', and one Issue per failing node (capped),
 *  - non-failures (notApplicable, informative, manual, passing) are skipped,
 *  - unknown audit ids are skipped (conservative attribution).
 */

import { describe, it, expect } from 'vitest';
import {
  mapLighthouseAudits,
  AUDIT_WCAG_MAP,
  MAX_NODES_PER_AUDIT,
  type LhAudit,
} from '../../src/lighthouse/map.js';

function node(selector: string, snippet: string) {
  return { node: { selector, snippet } };
}

describe('mapLighthouseAudits', () => {
  it('maps failing audits to Issues with the correct WCAG criterion and runner', () => {
    const audits: Record<string, LhAudit> = {
      'image-alt': {
        id: 'image-alt',
        title: 'Image elements do not have [alt] attributes',
        description: 'Informative elements should aim for short, descriptive alternate text.',
        score: 0,
        scoreDisplayMode: 'binary',
        details: { items: [node('img.logo', '<img class="logo">')] },
      },
      'document-title': {
        id: 'document-title',
        title: 'Document does not have a <title> element',
        score: 0,
        scoreDisplayMode: 'binary',
        details: { items: [] },
      },
    };

    const issues = mapLighthouseAudits(audits);
    expect(issues).toHaveLength(2);

    const imageIssue = issues.find((i) => i.code.includes('image-alt'));
    expect(imageIssue).toBeDefined();
    expect(imageIssue?.type).toBe('error');
    expect(imageIssue?.runner).toBe('lighthouse');
    expect(imageIssue?.selector).toBe('img.logo');
    expect(imageIssue?.context).toContain('<img');
    // Criterion 1.1.1 must be parseable from the code.
    expect(imageIssue?.code).toMatch(/1_1_1/);

    const titleIssue = issues.find((i) => i.code.includes('document-title'));
    expect(titleIssue?.code).toMatch(/2_4_2/);
    // No node detail → single page-level finding on html.
    expect(titleIssue?.selector).toBe('html');
  });

  it('skips notApplicable, informative, manual and passing audits', () => {
    const audits: Record<string, LhAudit> = {
      'color-contrast': {
        id: 'color-contrast',
        title: 'Background and foreground colors do not have sufficient contrast',
        // Passing — must be skipped even though it is attributable.
        score: 1,
        scoreDisplayMode: 'binary',
        details: { items: [node('p', '<p>')] },
      },
      'heading-order': {
        id: 'heading-order',
        title: 'Heading elements are not in a sequentially-descending order',
        score: null,
        scoreDisplayMode: 'notApplicable',
      },
      'logical-tab-order': {
        id: 'logical-tab-order',
        title: 'Logical tab order',
        score: null,
        scoreDisplayMode: 'manual',
      },
      'tap-targets': {
        id: 'tap-targets',
        title: 'Informative tap targets',
        score: null,
        scoreDisplayMode: 'informative',
      },
    };

    const issues = mapLighthouseAudits(audits);
    expect(issues).toHaveLength(0);
  });

  it('skips failing audits with no WCAG attribution', () => {
    const audits: Record<string, LhAudit> = {
      'some-unknown-future-audit': {
        id: 'some-unknown-future-audit',
        title: 'A new audit Luqen has not mapped yet',
        score: 0,
        scoreDisplayMode: 'binary',
        details: { items: [node('div', '<div>')] },
      },
    };
    expect(mapLighthouseAudits(audits)).toHaveLength(0);
  });

  it('caps the number of node-level Issues per audit', () => {
    const items = Array.from({ length: MAX_NODES_PER_AUDIT + 10 }, (_, i) =>
      node(`#el-${i}`, `<div id="el-${i}">`),
    );
    const audits: Record<string, LhAudit> = {
      'link-name': {
        id: 'link-name',
        title: 'Links do not have a discernible name',
        score: 0,
        scoreDisplayMode: 'binary',
        details: { items },
      },
    };
    const issues = mapLighthouseAudits(audits);
    expect(issues).toHaveLength(MAX_NODES_PER_AUDIT);
    expect(issues.every((i) => i.runner === 'lighthouse')).toBe(true);
    expect(issues[0]?.code).toMatch(/2_4_4/);
  });

  it('returns an empty list for undefined audits', () => {
    expect(mapLighthouseAudits(undefined)).toEqual([]);
  });

  it('every mapped criterion is parseable by the downstream regex', () => {
    const re = /(\d+)_(\d+)_(\d+)/;
    for (const criterion of Object.values(AUDIT_WCAG_MAP)) {
      expect(criterion).toMatch(re);
    }
  });
});
