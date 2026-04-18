/**
 * Unit tests for filterResourcesByPermissions + filterResourcesByScope
 * (Phase 30 D-12 — RBAC filter for MCP Resources).
 *
 * Mirror of the existing tool-filter tests in src/mcp/__tests__/tool-filter.test.ts.
 * See .planning/phases/30-dashboard-mcp-external-clients/30-01-PLAN.md Task 1.
 */

import { describe, it, expect } from 'vitest';
import {
  filterResourcesByPermissions,
  filterResourcesByScope,
  type ResourceMetadata,
} from '../../src/mcp/index.js';

const FIXTURES: readonly ResourceMetadata[] = [
  { uriScheme: 'scan', requiredPermission: 'reports.view' },
  { uriScheme: 'brand', requiredPermission: 'branding.view' },
  { uriScheme: 'audit', requiredPermission: 'admin.system' },
  { uriScheme: 'public' }, // no requiredPermission — visible to all
];

describe('filterResourcesByPermissions', () => {
  it('includes resources without requiredPermission regardless of effective perms', () => {
    const result = filterResourcesByPermissions(FIXTURES, new Set());
    expect(result).toEqual(['public']);
  });

  it('includes resources whose requiredPermission is in effective perms', () => {
    const result = filterResourcesByPermissions(FIXTURES, new Set(['reports.view']));
    expect(result).toEqual(['scan', 'public']);
  });

  it('returns multiple matches when multiple perms granted', () => {
    const result = filterResourcesByPermissions(
      FIXTURES,
      new Set(['reports.view', 'branding.view', 'admin.system']),
    );
    expect(result).toEqual(['scan', 'brand', 'audit', 'public']);
  });

  it('returns only public entries for empty perm set', () => {
    const result = filterResourcesByPermissions(FIXTURES, new Set());
    expect(result).toEqual(['public']);
  });

  it('returns empty array when input is empty', () => {
    const result = filterResourcesByPermissions([], new Set(['reports.view']));
    expect(result).toEqual([]);
  });
});

describe('filterResourcesByScope', () => {
  it('admin scope sees all resources', () => {
    expect(filterResourcesByScope(FIXTURES, ['admin'])).toEqual([
      'scan',
      'brand',
      'audit',
      'public',
    ]);
  });

  it('write scope sees read-tier + public but NOT admin.system (Phase 30.1 — admin.system is admin-only)', () => {
    // Phase 30.1 contract: admin.system is admin-only — never granted below `admin` scope.
    // Locked in .planning/phases/30.1-mcp-oauth-scope-gate/30.1-CONTEXT.md (OQ-1 resolution).
    const result = filterResourcesByScope(FIXTURES, ['write']);
    expect(result).toEqual(['scan', 'brand', 'public']);
    expect(result).not.toContain('audit');
  });

  it('read scope sees read-tier + public but NOT admin.system', () => {
    const result = filterResourcesByScope(FIXTURES, ['read']);
    expect(result).toEqual(['scan', 'brand', 'public']);
    expect(result).not.toContain('audit');
  });

  it('no scope sees only public', () => {
    expect(filterResourcesByScope(FIXTURES, [])).toEqual(['public']);
  });

  it('returns empty array when input is empty', () => {
    expect(filterResourcesByScope([], ['admin'])).toEqual([]);
  });
});
