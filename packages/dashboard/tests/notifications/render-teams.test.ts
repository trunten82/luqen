import { describe, it, expect } from 'vitest';
import { renderTeams } from '../../src/notifications/render-teams.js';
import type { NotificationTemplate } from '../../src/db/types.js';

function tpl(subject: string, body: string): NotificationTemplate {
  return {
    id: 't', eventType: 'scan.complete', channel: 'teams',
    scope: 'system', orgId: null,
    subjectTemplate: subject, bodyTemplate: body,
    voice: null, signature: null, llmEnabled: false, version: 1,
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z',
    updatedBy: null,
  };
}

describe('renderTeams', () => {
  it('builds an Adaptive Card 1.5 with TextBlock body', () => {
    const r = renderTeams(
      tpl('Scan: {{siteUrl}}', '{"text":"Found {{count}} issues on {{siteUrl}}"}'),
      { siteUrl: 'x.com', count: 5 },
      null,
    );
    expect(r.adaptiveCard.type).toBe('AdaptiveCard');
    expect(r.adaptiveCard.version).toBe('1.5');
    const textBlocks = r.adaptiveCard.body.filter((b) => b.type === 'TextBlock');
    expect(textBlocks.length).toBeGreaterThanOrEqual(1);
    const lastText = textBlocks[textBlocks.length - 1];
    if (lastText.type === 'TextBlock') {
      expect(lastText.text).toBe('Found 5 issues on x.com');
    }
  });

  it('falls back to raw body when JSON does not parse', () => {
    const r = renderTeams(tpl('s', 'plain text {{x}}'), { x: 'value' }, null);
    const last = r.adaptiveCard.body[r.adaptiveCard.body.length - 1];
    if (last.type === 'TextBlock') {
      expect(last.text).toBe('plain text value');
    }
  });

  it('includes Image element + logoUrl when brand logoSource is http(s)', () => {
    const r = renderTeams(tpl('s', '{"text":"x"}'), {}, {
      orgId: 'o',
      colors: { primary: '#fff' },
      logoSource: 'https://cdn/logo.png',
    });
    expect(r.logoUrl).toBe('https://cdn/logo.png');
    const img = r.adaptiveCard.body.find((b) => b.type === 'Image');
    expect(img).toBeDefined();
  });

  it('omits Image when brand has no http logo', () => {
    const r = renderTeams(tpl('s', '{"text":"x"}'), {}, {
      orgId: 'o',
      colors: { primary: '#fff' },
      logoSource: '/local/logo.png',
    });
    expect(r.logoUrl).toBeUndefined();
    const img = r.adaptiveCard.body.find((b) => b.type === 'Image');
    expect(img).toBeUndefined();
  });

  it('adds Action.OpenUrl entries for known URL keys', () => {
    const r = renderTeams(
      tpl('s', '{"text":"go"}'),
      { reportUrl: 'https://luqen.test/r/1' },
      null,
    );
    expect(r.adaptiveCard.actions).toBeDefined();
    expect(r.adaptiveCard.actions?.[0].type).toBe('Action.OpenUrl');
    expect(r.adaptiveCard.actions?.[0].url).toBe('https://luqen.test/r/1');
  });
});
