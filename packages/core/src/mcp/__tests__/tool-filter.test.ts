import { describe, it, expect } from 'vitest';
import { filterToolsByPermissions, filterToolsByScope } from '../tool-filter.js';
import type { ToolMetadata } from '../types.js';

const TOOLS: readonly ToolMetadata[] = [
  { name: 'health_check' }, // no requiredPermission — D-04: visible to all
  { name: 'compliance_check', requiredPermission: 'compliance.view' },
  { name: 'compliance_list_jurisdictions', requiredPermission: 'compliance.view' },
  { name: 'compliance_propose_update', requiredPermission: 'compliance.manage' },
  { name: 'compliance_seed', requiredPermission: 'compliance.manage', destructive: true },
  { name: 'reports_view', requiredPermission: 'reports.view' },
  { name: 'reports_delete', requiredPermission: 'reports.delete' },
  { name: 'admin_system', requiredPermission: 'admin.system' },
];

describe('filterToolsByPermissions', () => {
  it('Test 1: empty perms returns only tools with undefined requiredPermission (D-04)', () => {
    const result = filterToolsByPermissions(TOOLS, new Set<string>());
    expect(result).toEqual(['health_check']);
  });

  it("Test 2: perms={'compliance.view'} returns view-annotated tools plus unannotated, excludes manage-annotated", () => {
    const result = filterToolsByPermissions(TOOLS, new Set<string>(['compliance.view']));
    expect(result).toContain('health_check');
    expect(result).toContain('compliance_check');
    expect(result).toContain('compliance_list_jurisdictions');
    expect(result).not.toContain('compliance_propose_update');
    expect(result).not.toContain('compliance_seed');
    expect(result).not.toContain('admin_system');
  });

  it('returns all permitted tool names when caller has full admin permission set', () => {
    const allPerms = new Set<string>([
      'compliance.view',
      'compliance.manage',
      'reports.view',
      'reports.delete',
      'admin.system',
    ]);
    const result = filterToolsByPermissions(TOOLS, allPerms);
    expect(result.length).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(result).toContain(t.name);
    }
  });
});

describe('filterToolsByScope', () => {
  it("Test 3: scopes=['admin'] returns every tool name", () => {
    const result = filterToolsByScope(TOOLS, ['admin']);
    expect(result.length).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(result).toContain(t.name);
    }
  });

  it("Test 4: scopes=['read'] returns unannotated + *.view tools, excludes *.manage", () => {
    const result = filterToolsByScope(TOOLS, ['read']);
    expect(result).toContain('health_check');
    expect(result).toContain('compliance_check');
    expect(result).toContain('compliance_list_jurisdictions');
    expect(result).toContain('reports_view');
    expect(result).not.toContain('compliance_propose_update');
    expect(result).not.toContain('compliance_seed');
    expect(result).not.toContain('reports_delete');
    expect(result).not.toContain('admin_system');
  });

  it("scopes=['write'] returns *.view + *.manage-annotated tools and delete/admin tools", () => {
    const result = filterToolsByScope(TOOLS, ['write']);
    expect(result).toContain('health_check');
    expect(result).toContain('compliance_check');
    expect(result).toContain('compliance_propose_update');
    expect(result).toContain('compliance_seed');
    expect(result).toContain('reports_delete');
    expect(result).toContain('admin_system');
  });

  it('empty scopes still returns only unannotated tools', () => {
    const result = filterToolsByScope(TOOLS, []);
    expect(result).toEqual(['health_check']);
  });
});
