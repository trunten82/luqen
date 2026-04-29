/*
 * Phase 45 Plan 01 — agent-tool-renderers.js JSDOM unit tests.
 *
 * Loads src/static/agent-tool-renderers.js into a fresh JSDOM realm via
 * `new win.Function(...)` (same pattern used by agent-history.test.ts).
 * Asserts:
 *   - The 5 expected toolName → renderer mappings are registered.
 *   - Each renderer produces the expected DOM shape for a representative
 *     happy-path payload (AGENT-05 scan card, AGENT-06 regulations table
 *     and proposals diff).
 *   - When a renderer is invoked with a malformed payload it throws (so
 *     agent.js can fall back to the JSON <pre> render path).
 *   - createElement/textContent only — the rendered subtree must contain
 *     no <script> elements regardless of input strings.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERER_PATH = resolve(
  __dirname,
  '..',
  '..',
  'src',
  'static',
  'agent-tool-renderers.js',
);
const RENDERER_SOURCE = readFileSync(RENDERER_PATH, 'utf8');

interface RendererFn {
  (result: unknown, container: HTMLElement): void;
}

interface RendererGlobals {
  toolRenderers: Record<string, RendererFn>;
  toolRendererFns: {
    renderScanCard: RendererFn;
    renderRegulationsTable: RendererFn;
    renderProposalsDiff: RendererFn;
  };
}

interface Harness {
  dom: JSDOM;
  container: HTMLElement;
  globals: RendererGlobals;
}

function buildHarness(): Harness {
  const dom = new JSDOM('<!doctype html><html><body><div id="msgs"></div></body></html>', {
    url: 'http://localhost/',
  });
  const win = dom.window as unknown as Window & typeof globalThis;
  // Mirror the loader pattern from agent-history.test.ts — execute the IIFE
  // body in the JSDOM realm via a per-window Function constructor so the
  // module's `window` reference resolves to the JSDOM window (not the
  // outer Node global).
  const fn = new (win as unknown as { Function: FunctionConstructor }).Function('window', 'document', RENDERER_SOURCE);
  fn.call(win, win, win.document);
  const winAny = dom.window as unknown as { __luqenAgent: RendererGlobals };
  const container = dom.window.document.getElementById('msgs') as HTMLElement;
  return { dom, container, globals: winAny.__luqenAgent };
}

describe('Phase 45-01 — agent-tool-renderers.js', () => {
  let h: Harness;
  beforeEach(() => { h = buildHarness(); });
  afterEach(() => { h.dom.window.close(); });

  it('registers exactly the 5 expected toolName → renderer mappings', () => {
    const { toolRenderers } = h.globals;
    expect(typeof toolRenderers.dashboard_scan_site).toBe('function');
    expect(typeof toolRenderers.dashboard_get_scan).toBe('function');
    expect(typeof toolRenderers.dashboard_list_regulations).toBe('function');
    expect(typeof toolRenderers.dashboard_get_regulation).toBe('function');
    expect(typeof toolRenderers.dashboard_list_proposals).toBe('function');
    expect(toolRenderers.dashboard_scan_site).toBe(toolRenderers.dashboard_get_scan);
    expect(toolRenderers.dashboard_list_regulations).toBe(toolRenderers.dashboard_get_regulation);
  });

  it('renderScanCard produces a card with site, score, top-3 issues, and report link', () => {
    const result = {
      scanId: 's-123',
      url: 'https://example.com',
      status: 'completed',
      report: {
        score: 87,
        issues: [
          { code: 'WCAG2AA.Principle1.1_1_1', count: 4 },
          { code: 'WCAG2AA.Principle1.4_3_3', count: 2 },
          { code: 'WCAG2AA.Principle2.4_4_4', count: 1 },
          { code: 'WCAG2AA.Principle3.3_3_3', count: 1 },
        ],
      },
    };
    h.globals.toolRendererFns.renderScanCard(result, h.container);
    const card = h.container.querySelector('.tool-result-card--scan');
    expect(card).not.toBeNull();
    expect(card!.querySelector('.tool-result-card__site')!.textContent).toBe('https://example.com');
    expect(card!.querySelector('.tool-result-card__score')!.textContent).toBe('87/100');
    const lis = card!.querySelectorAll('.tool-result-card__issues li');
    expect(lis.length).toBe(3);
    expect(lis[0]!.textContent).toContain('1.1_1_1');
    expect(lis[0]!.textContent).toContain('(4)');
    const link = card!.querySelector('.tool-result-card__link') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/reports/s-123');
    const raw = card!.querySelector('.tool-result-card__raw pre');
    expect(raw!.textContent).toContain('s-123');
  });

  it('renderScanCard refuses javascript: scheme report URLs', () => {
    const result = {
      scanId: 's-x',
      url: 'https://example.com',
      reportUrl: 'javascript:alert(1)',
    };
    h.globals.toolRendererFns.renderScanCard(result, h.container);
    const link = h.container.querySelector('.tool-result-card__link');
    if (link) expect(link.getAttribute('href')).toBe('/reports/s-x');
  });

  it('renderRegulationsTable produces a 3-column table with up to 10 rows + "+N more"', () => {
    const rows = Array.from({ length: 14 }).map((_, i) => ({
      id: `REG-${i}`,
      name: `Regulation ${i}`,
      jurisdictionId: i % 2 === 0 ? 'EU' : 'US',
    }));
    h.globals.toolRendererFns.renderRegulationsTable({ data: rows }, h.container);
    const table = h.container.querySelector('.tool-result-table');
    expect(table).not.toBeNull();
    const headers = table!.querySelectorAll('thead th');
    expect(headers.length).toBe(3);
    expect(headers[0]!.textContent).toBe('ID');
    expect(headers[2]!.textContent).toBe('Jurisdiction');
    const bodyRows = table!.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(10);
    expect(bodyRows[0]!.querySelectorAll('td')[0]!.textContent).toBe('REG-0');
    const more = h.container.querySelector('.tool-result-card__more');
    expect(more!.textContent).toBe('+4 more');
  });

  it('renderRegulationsTable accepts a single regulation object (dashboard_get_regulation)', () => {
    h.globals.toolRendererFns.renderRegulationsTable(
      { id: 'EU-EAA', name: 'European Accessibility Act', jurisdictionId: 'EU' },
      h.container,
    );
    expect(h.container.querySelectorAll('tbody tr').length).toBe(1);
    expect(h.container.querySelector('tbody tr td')!.textContent).toBe('EU-EAA');
  });

  it('renderProposalsDiff produces added/removed/modified columns per proposal', () => {
    const proposals = [
      {
        id: 'p-1',
        affectedRegulationId: 'EU-EAA',
        summary: 'Add SC 1.4.11',
        detectedAt: '2026-04-01',
        proposedChanges: {
          after: {
            diff: {
              added: [{ wcagCriterion: '1.4.11' }, '2.5.5'],
              removed: ['9.9.9'],
              modified: [{ wcagCriterion: '1.4.3' }],
            },
          },
        },
      },
    ];
    h.globals.toolRendererFns.renderProposalsDiff({ proposals }, h.container);
    const card = h.container.querySelector('.tool-result-card--proposals');
    expect(card).not.toBeNull();
    const proposal = card!.querySelector('.tool-result-proposal');
    expect(proposal!.querySelector('.tool-result-proposal__header')!.textContent)
      .toContain('EU-EAA');
    expect(proposal!.querySelector('.tool-result-proposal__header')!.textContent)
      .toContain('Add SC 1.4.11');
    expect(proposal!.querySelectorAll('.tool-result-proposal__added li').length).toBe(2);
    expect(proposal!.querySelectorAll('.tool-result-proposal__removed li').length).toBe(1);
    expect(proposal!.querySelectorAll('.tool-result-proposal__modified li').length).toBe(1);
  });

  it('renderers throw on empty/garbage payloads so agent.js can fall back', () => {
    const fns = h.globals.toolRendererFns;
    expect(() => fns.renderScanCard(null as unknown, h.container)).toThrow();
    expect(() => fns.renderRegulationsTable({ data: [] }, h.container)).toThrow();
    expect(() => fns.renderRegulationsTable(null as unknown, h.container)).toThrow();
    expect(() => fns.renderProposalsDiff({ proposals: [] }, h.container)).toThrow();
    expect(() => fns.renderProposalsDiff(null as unknown, h.container)).toThrow();
  });

  it('rendered DOM never contains <script> regardless of attacker-controlled strings', () => {
    h.globals.toolRendererFns.renderRegulationsTable(
      {
        data: [
          { id: '<script>alert(1)</script>', name: '<img onerror=alert(1)>', jurisdictionId: 'EU' },
        ],
      },
      h.container,
    );
    expect(h.container.querySelector('script')).toBeNull();
    expect(h.container.querySelector('img')).toBeNull();
    expect(h.container.querySelector('tbody tr td')!.textContent).toBe('<script>alert(1)</script>');
  });
});
