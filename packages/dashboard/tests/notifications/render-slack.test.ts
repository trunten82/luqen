import { describe, it, expect } from 'vitest';
import { renderSlack } from '../../src/notifications/render-slack.js';
import type { NotificationTemplate } from '../../src/db/types.js';

function tpl(subject: string, body: string): NotificationTemplate {
  return {
    id: 't', eventType: 'scan.complete', channel: 'slack',
    scope: 'system', orgId: null,
    subjectTemplate: subject, bodyTemplate: body,
    voice: null, signature: null, llmEnabled: false, version: 1,
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z',
    updatedBy: null,
  };
}

describe('renderSlack', () => {
  it('produces a Block Kit array with section block for body', () => {
    const r = renderSlack(
      tpl('', '*Scan complete* — example.com'),
      { siteUrl: 'example.com' },
      null,
    );
    expect(Array.isArray(r.blocks)).toBe(true);
    const sections = r.blocks.filter((b) => b.type === 'section');
    expect(sections).toHaveLength(1);
    if (sections[0].type === 'section') {
      expect(sections[0].text.type).toBe('mrkdwn');
      expect(sections[0].text.text).toContain('Scan complete');
    }
  });

  it('emits header block when subject is non-empty', () => {
    const r = renderSlack(tpl('Big news', 'body'), {}, null);
    expect(r.blocks[0].type).toBe('header');
  });

  it('appends actions block when reportUrl is present', () => {
    const r = renderSlack(
      tpl('', '*Scan complete*'),
      { reportUrl: 'https://luqen.test/report/1' },
      null,
    );
    const action = r.blocks.find((b) => b.type === 'actions');
    expect(action).toBeDefined();
    if (action?.type === 'actions') {
      expect(action.elements[0].url).toBe('https://luqen.test/report/1');
      expect(action.elements[0].text.text).toBe('View report');
    }
  });

  it('passes through iconUrl only when brand logoSource is http(s)', () => {
    const httpBrand = renderSlack(tpl('s', 'b'), {}, {
      orgId: 'o',
      colors: { primary: '#fff' },
      logoSource: 'https://cdn/logo.png',
    });
    expect(httpBrand.iconUrl).toBe('https://cdn/logo.png');

    const fileBrand = renderSlack(tpl('s', 'b'), {}, {
      orgId: 'o',
      colors: { primary: '#fff' },
      logoSource: '/var/lib/luqen/logo.png',
    });
    expect(fileBrand.iconUrl).toBeUndefined();
  });

  it('expands tokens in body', () => {
    const r = renderSlack(
      tpl('', '*Scan* — {{siteUrl}} ({{issueCount}} issues)'),
      { siteUrl: 'a.com', issueCount: 7 },
      null,
    );
    const section = r.blocks.find((b) => b.type === 'section');
    if (section?.type === 'section') {
      expect(section.text.text).toBe('*Scan* — a.com (7 issues)');
    }
  });
});
