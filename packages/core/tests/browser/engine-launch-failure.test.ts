import { describe, it, expect, vi } from 'vitest';

const { TRIED } = vi.hoisted(() => ({ TRIED: ['/fake/one', '/fake/two'] }));

vi.mock('../../src/browser/launch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/browser/launch.js')>();
  const { ChromiumNotFoundError } = await import('../../src/browser/resolve.js');
  return {
    ...actual,
    launchChromium: vi.fn().mockRejectedValue(new ChromiumNotFoundError(TRIED)),
  };
});

vi.mock('../../src/browser/resolve.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/browser/resolve.js')>();
  return {
    ...actual,
    resolveChromium: vi.fn().mockRejectedValue(new actual.ChromiumNotFoundError(TRIED)),
  };
});

// Closed local port — never an internet URL, so a break-test that lets a real
// browser launch cannot reach the network.
const CLOSED_URL = 'http://127.0.0.1:9/';

describe('engine launch failure (CHROMIUM-RESOLVE-1)', () => {
  it('F1: ibm reports a missing browser as an error naming the tried paths', async () => {
    const { runIbmChecks } = await import('../../src/ibm/index.js');
    const result = await runIbmChecks(CLOSED_URL);
    expect(result.pagesChecked).toBe(0);
    expect(result.errors[0].message).toContain('/fake/one');
  });

  it('F2: reflow reports a missing browser as an error naming the tried paths', async () => {
    const { runReflowChecks } = await import('../../src/reflow/index.js');
    const result = await runReflowChecks(CLOSED_URL);
    expect(result.pagesChecked).toBe(0);
    expect(result.errors[0].message).toContain('/fake/one');
  });

  it('F3: a11y-tree reports a missing browser as an error naming the tried paths', async () => {
    const { runA11yTreeChecks } = await import('../../src/a11y-tree/index.js');
    const result = await runA11yTreeChecks(CLOSED_URL);
    expect(result.pagesChecked).toBe(0);
    expect(result.errors[0].message).toContain('/fake/one');
  });

  it('F4: behavioral reports a missing browser as an error naming the tried paths', async () => {
    const { runBehavioralChecks } = await import('../../src/behavioral/index.js');
    const result = await runBehavioralChecks(CLOSED_URL);
    expect(result.pagesChecked).toBe(0);
    expect(result.errors[0].message).toContain('/fake/one');
  });

  it('F5: lighthouse reports a missing browser before loading chrome launcher', async () => {
    const { runLighthouseChecks } = await import('../../src/lighthouse/index.js');
    const result = await runLighthouseChecks(CLOSED_URL);
    expect(result.pagesChecked).toBe(0);
    expect(result.errors[0].message).toContain('/fake/one');
  });
});
