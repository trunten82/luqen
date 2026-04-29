import { describe, it, expect } from 'vitest';
import { renderEmail } from '../../src/notifications/render-email.js';
import { LogoCache } from '../../src/notifications/logo-cache.js';
import type { NotificationTemplate } from '../../src/db/types.js';
import type { BrandContext } from '../../src/notifications/brand-context.js';

function tpl(subject: string, body: string): NotificationTemplate {
  return {
    id: 't',
    eventType: 'scan.complete',
    channel: 'email',
    scope: 'system',
    orgId: null,
    subjectTemplate: subject,
    bodyTemplate: body,
    voice: null,
    signature: null,
    llmEnabled: false,
    version: 1,
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z',
    updatedBy: null,
  };
}

describe('renderEmail', () => {
  it('produces subject, html, plaintext, brandColor with no brand', async () => {
    const r = await renderEmail(
      tpl('Scan complete: {{site}}', '<p>Found {{count}} issues.</p>'),
      { site: 'example.com', count: 3 },
      null,
    );
    expect(r.subject).toBe('Scan complete: example.com');
    expect(r.html).toContain('Found 3 issues.');
    expect(r.html).toContain('<!DOCTYPE html>');
    expect(r.plaintext).toContain('Found 3 issues.');
    expect(r.plaintext).not.toContain('<p>');
    expect(r.brandColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(r.logoAttachment).toBeUndefined();
  });

  it('uses brand primary color in CTA', async () => {
    const brand: BrandContext = {
      orgId: 'org-1',
      colors: { primary: '#ff5500' },
    };
    const r = await renderEmail(
      tpl('Hi', '<a class="luqen-cta" href="x">Go</a>'),
      {},
      brand,
    );
    expect(r.brandColor).toBe('#ff5500');
    expect(r.html).toContain('#ff5500');
  });

  it('strips script tags and on* handlers from admin-authored HTML', async () => {
    const r = await renderEmail(
      tpl('s', '<p onclick="alert(1)">hi</p><script>steal()</script>'),
      {},
      null,
    );
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('onclick');
    expect(r.html).toContain('hi');
  });

  it('escapes plain (non-HTML) bodies', async () => {
    // Body has no HTML tags — wrapped paragraph escapes the angle brackets.
    const r = await renderEmail(tpl('s', 'plain text & ampersand'), {}, null);
    expect(r.html).toContain('plain text &amp; ampersand');
  });

  it('embeds logo as CID attachment when brand provides logoSource and cache resolves', async () => {
    const fakeFetch = (async () =>
      new Response(Buffer.from('PNGDATA'), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })) as unknown as typeof fetch;
    const cache = new LogoCache({ fetchImpl: fakeFetch });
    const brand: BrandContext = {
      orgId: 'org-2',
      logoSource: 'https://cdn.example.com/logo.png',
      colors: { primary: '#123456' },
    };
    const r = await renderEmail(tpl('s', '<p>hi</p>'), {}, brand, { logoCache: cache });
    expect(r.logoAttachment).toBeDefined();
    expect(r.logoAttachment?.cid).toBe('luqen-org-logo');
    expect(r.logoAttachment?.contentType).toBe('image/png');
    expect(r.logoCid).toBe('luqen-org-logo');
    expect(r.html).toContain('cid:luqen-org-logo');
  });

  it('omits logo silently when cache returns null', async () => {
    const fakeFetch = (async () =>
      new Response('not found', { status: 404 })) as unknown as typeof fetch;
    const cache = new LogoCache({ fetchImpl: fakeFetch });
    const brand: BrandContext = {
      orgId: 'org-3',
      logoSource: 'https://broken/logo.png',
      colors: { primary: '#000000' },
    };
    const r = await renderEmail(tpl('s', '<p>x</p>'), {}, brand, { logoCache: cache });
    expect(r.logoAttachment).toBeUndefined();
    expect(r.html).not.toContain('cid:');
  });
});
