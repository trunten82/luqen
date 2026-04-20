/**
 * Phase 32 Plan 04 Task 1 (RED) — destructive-hint metadata tests.
 *
 * Tests 16-19 of plan 32-04. Pins D-28: every destructive tool has a
 * confirmationTemplate so the browser can render a human-readable
 * confirmation dialog. An explicit allowlist prevents accidental
 * additions / removals from DASHBOARD_TOOL_METADATA.
 */

import { describe, it, expect } from 'vitest';
import type { ToolMetadata } from '@luqen/core/mcp';
import { DASHBOARD_TOOL_METADATA } from '../../src/mcp/metadata.js';

/**
 * Explicit allowlist of destructive tool names in DASHBOARD_TOOL_METADATA.
 *
 * Updating this list is an intentional act — adding or removing a destructive
 * tool changes the user-visible confirmation surface (APER-02 / D-28). If
 * this test fails, reconcile the metadata with the allowlist AND update the
 * UI copy + i18n keys.
 */
const EXPECTED_DESTRUCTIVE_TOOLS: readonly string[] = [
  'dashboard_scan_site',
];

describe('DASHBOARD_TOOL_METADATA — destructive-hint integrity (D-28)', () => {
  it('Test 16: destructive-tool set matches the expected allowlist', () => {
    const actual = DASHBOARD_TOOL_METADATA.filter((t) => t.destructive === true)
      .map((t) => t.name)
      .sort();
    const expected = [...EXPECTED_DESTRUCTIVE_TOOLS].sort();
    expect(actual).toEqual(expected);
  });

  it('Test 17: every destructive tool has a confirmationTemplate', () => {
    const missing = DASHBOARD_TOOL_METADATA.filter(
      (t) =>
        t.destructive === true &&
        typeof t.confirmationTemplate !== 'function',
    ).map((t) => t.name);
    expect(
      missing,
      `Destructive tools missing confirmationTemplate: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('Test 18: confirmationTemplate renders a non-empty string interpolating an arg', () => {
    const tool = DASHBOARD_TOOL_METADATA.find(
      (t) => t.name === 'dashboard_scan_site',
    );
    expect(tool).toBeDefined();
    expect(typeof tool?.confirmationTemplate).toBe('function');
    const rendered = tool!.confirmationTemplate!({ siteUrl: 'https://example.com' });
    expect(typeof rendered).toBe('string');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.toLowerCase()).toContain('example.com');
  });

  it('Test 19: ToolMetadata.confirmationTemplate is OPTIONAL (non-destructive tools)', () => {
    // Type-level test: constructing a minimal ToolMetadata WITHOUT
    // confirmationTemplate must type-check. This line compiling is the
    // assertion; the runtime expect is a smoke.
    const nonDestructive: ToolMetadata = { name: 'x', destructive: false };
    expect(nonDestructive.name).toBe('x');
    expect(nonDestructive.confirmationTemplate).toBeUndefined();
  });
});
