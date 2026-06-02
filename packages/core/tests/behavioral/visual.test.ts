/**
 * Integration tests for the visual-context capture (Phase 84 LLM-vision).
 *
 * Launches a real puppeteer browser against an in-process HTTP fixture so the
 * screenshot/heading/image capture exercises the real DOM + computed styles.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { withPage } from '../../src/behavioral/browser.js';
import { captureVisualContext } from '../../src/behavioral/visual.js';
import { runBehavioralChecks } from '../../src/behavioral/index.js';
import type { Issue } from '../../src/types.js';

const TEST_TIMEOUT = 30000;

const FIXTURE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Visual</title>
<style>
  .fake-heading { font-size: 28px; font-weight: 700; display: block; }
</style></head>
<body>
  <h1>Real Page Title</h1>
  <div class="fake-heading">Styled Div Heading</div>
  <p>Some body copy that is long enough not to be mistaken for a heading at all, really.</p>
  <figure>
    <img src="/chart.png" alt="">
    <figcaption>Quarterly revenue by region</figcaption>
  </figure>
  <img src="/logo.png" alt="Acme logo">
</body></html>`;

describe('captureVisualContext', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(FIXTURE);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('captures a non-empty PNG screenshot', async () => {
    const ctx = await withPage(baseUrl, {}, (page) => captureVisualContext(page));
    expect(ctx.screenshot.mediaType).toBe('image/png');
    expect(ctx.screenshot.data.length).toBeGreaterThan(100);
    // base64 sanity (no data: prefix)
    expect(ctx.screenshot.data.startsWith('data:')).toBe(false);
  }, TEST_TIMEOUT);

  it('lists the real heading and flags the styled-div candidate', async () => {
    const ctx = await withPage(baseUrl, {}, (page) => captureVisualContext(page));
    expect(ctx.headingOutline).toContain('Real Page Title');
    expect(ctx.headingOutline).toMatch(/HEADING <h1>/);
    expect(ctx.headingOutline).toContain('Styled Div Heading');
    expect(ctx.headingOutline).toMatch(/CANDIDATE <div>/);
  }, TEST_TIMEOUT);

  it('inventories images with alt + surrounding context', async () => {
    const ctx = await withPage(baseUrl, {}, (page) => captureVisualContext(page));
    expect(ctx.images.length).toBe(2);
    const chart = ctx.images.find((i) => i.src.includes('chart.png'));
    expect(chart).toBeDefined();
    expect(chart!.alt).toBe(''); // empty alt present
    expect(chart!.surroundingText).toContain('Quarterly revenue by region');
    const logo = ctx.images.find((i) => i.src.includes('logo.png'));
    expect(logo!.alt).toBe('Acme logo');
  }, TEST_TIMEOUT);

  it('runBehavioralChecks invokes onVisualContext and merges its issues', async () => {
    let receivedOutline = '';
    const visionIssue: Issue = {
      type: 'error',
      code: '1_3_1',
      message: 'Styled div used as a heading',
      selector: 'div.fake-heading',
      context: '<div class="fake-heading">Styled Div Heading</div>',
      runner: 'vision',
    };
    const result = await runBehavioralChecks(baseUrl, {
      onVisualContext: async (ctx, url) => {
        receivedOutline = ctx.headingOutline;
        expect(url).toBe(baseUrl);
        expect(ctx.screenshot.data.length).toBeGreaterThan(100);
        return [visionIssue];
      },
    });
    expect(receivedOutline).toContain('Styled Div Heading');
    const vision = result.issues.filter((i) => i.runner === 'vision');
    expect(vision).toHaveLength(1);
    expect(vision[0].code).toBe('1_3_1');
  }, TEST_TIMEOUT);

  it('records a non-fatal error when onVisualContext throws (other checks survive)', async () => {
    const result = await runBehavioralChecks(baseUrl, {
      onVisualContext: async () => {
        throw new Error('LLM unreachable');
      },
    });
    expect(result.pagesChecked).toBe(1);
    expect(result.errors.some((e) => e.message.includes('vision check failed'))).toBe(true);
  }, TEST_TIMEOUT);
});
