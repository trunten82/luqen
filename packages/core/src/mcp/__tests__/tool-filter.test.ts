import { describe, it, expect } from 'vitest';
import {
  filterToolsByPermissions,
  filterToolsByRbac,
  filterToolsByScope,
  filterResourcesByPermissions,
  filterResourcesByScope,
} from '../tool-filter.js';
import type { ResourceMetadata, ToolMetadata } from '../types.js';

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

// Phase 30.1 regression fixture — covers the two tools that previously leaked
// into scope=read because of the suffix-rule bug (scans.create was treated as
// read-tier, admin.users was treated as read-tier).
const PHASE_30_1_TOOLS: readonly ToolMetadata[] = [
  { name: 'dashboard_scan_site', requiredPermission: 'scans.create', destructive: true },
  { name: 'dashboard_create_user', requiredPermission: 'admin.users' },
  { name: 'dashboard_update_org', requiredPermission: 'admin.org' },
  { name: 'dashboard_create_org', requiredPermission: 'admin.system' },
  { name: 'dashboard_list_reports', requiredPermission: 'reports.view' },
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

describe('filterToolsByScope — Phase 30.1 rewritten rules', () => {
  it("Test 3: scopes=['admin'] returns every tool name", () => {
    const result = filterToolsByScope(TOOLS, ['admin']);
    expect(result.length).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(result).toContain(t.name);
    }
  });

  it("Test 4: scopes=['read'] returns unannotated + *.view tools, excludes *.manage / *.delete / admin.*", () => {
    const result = filterToolsByScope(TOOLS, ['read']);
    // Read-tier: unannotated + .view
    expect(result).toContain('health_check');
    expect(result).toContain('compliance_check');
    expect(result).toContain('compliance_list_jurisdictions');
    expect(result).toContain('reports_view');
    // Write-tier: excluded under read scope
    expect(result).not.toContain('compliance_propose_update'); // .manage
    expect(result).not.toContain('compliance_seed');           // .manage
    expect(result).not.toContain('reports_delete');            // .delete
    // Admin-only: excluded under read scope
    expect(result).not.toContain('admin_system');              // admin.system
  });

  it("scopes=['write'] returns read-tier + *.create/.update/.manage/.delete/admin.users/admin.org — excludes admin.system", () => {
    const result = filterToolsByScope(TOOLS, ['write']);
    expect(result).toContain('health_check');
    expect(result).toContain('compliance_check');
    expect(result).toContain('compliance_list_jurisdictions');
    expect(result).toContain('reports_view');
    expect(result).toContain('compliance_propose_update'); // .manage
    expect(result).toContain('compliance_seed');           // .manage
    expect(result).toContain('reports_delete');            // .delete
    // Phase 30.1 contract: admin.system is admin-only — NOT surfaced by write scope.
    expect(result).not.toContain('admin_system');
  });

  it('empty scopes still returns only unannotated tools', () => {
    const result = filterToolsByScope(TOOLS, []);
    expect(result).toEqual(['health_check']);
  });

  // ---- Phase 30.1 regression fixtures ----

  it('Test 5 (regression): scope=read does NOT surface dashboard_scan_site (scans.create is write-tier)', () => {
    const result = filterToolsByScope(PHASE_30_1_TOOLS, ['read']);
    expect(result).not.toContain('dashboard_scan_site');
  });

  it('Test 5b (regression): scope=write DOES surface dashboard_scan_site', () => {
    const result = filterToolsByScope(PHASE_30_1_TOOLS, ['write']);
    expect(result).toContain('dashboard_scan_site');
  });

  it('Test 5c (regression): scope=admin DOES surface dashboard_scan_site', () => {
    const result = filterToolsByScope(PHASE_30_1_TOOLS, ['admin']);
    expect(result).toContain('dashboard_scan_site');
  });

  it('Test 6 (regression): scope=read does NOT surface dashboard_create_user (admin.users is write-tier, NOT read-tier)', () => {
    const result = filterToolsByScope(PHASE_30_1_TOOLS, ['read']);
    expect(result).not.toContain('dashboard_create_user');
  });

  it('Test 6b (regression): scope=write DOES surface dashboard_create_user', () => {
    const result = filterToolsByScope(PHASE_30_1_TOOLS, ['write']);
    expect(result).toContain('dashboard_create_user');
  });

  it('Test 7 (regression): admin.system tools are admin-only even under write scope', () => {
    const write = filterToolsByScope(PHASE_30_1_TOOLS, ['write']);
    expect(write).not.toContain('dashboard_create_org'); // admin.system
    const admin = filterToolsByScope(PHASE_30_1_TOOLS, ['admin']);
    expect(admin).toContain('dashboard_create_org');
  });

  it('Test 7b (regression): admin.org tools are surfaced by write scope, excluded by read scope', () => {
    const read = filterToolsByScope(PHASE_30_1_TOOLS, ['read']);
    expect(read).not.toContain('dashboard_update_org');
    const write = filterToolsByScope(PHASE_30_1_TOOLS, ['write']);
    expect(write).toContain('dashboard_update_org');
  });

  // ---- Phase 31.2 D-14 lock-in: admin.* scope values are a no-op post-31.2 ----

  it('Test 6 (D-14 lock-in): admin.* scope values are no-ops alongside read/write', () => {
    // Pre-31.2 tokens may still carry legacy admin.* scope values. Post-31.2
    // scopes_supported narrows to ['read','write'], but the scope-filter must
    // treat legacy admin.* strings as no-ops — tool visibility tracks RBAC
    // (filterToolsByRbac is authoritative at the http-plugin composition).
    // Invariant: visible tools for ['admin.system','admin.org','admin.users',
    // 'read','write'] == visible tools for ['read','write'].
    const legacy = filterToolsByScope(TOOLS, [
      'admin.system',
      'admin.org',
      'admin.users',
      'read',
      'write',
    ]);
    const baseline = filterToolsByScope(TOOLS, ['read', 'write']);
    expect([...legacy].sort()).toEqual([...baseline].sort());
    // admin.system-gated tools MUST NOT surface just because the legacy
    // admin.system scope value was present — RBAC is authoritative now.
    expect(legacy).not.toContain('admin_system');
  });
});

// ---------------------------------------------------------------------------
// Phase 31.2 D-07: filterToolsByRbac — the RBAC half of defense-in-depth
// ---------------------------------------------------------------------------

const RBAC_TOOLS: readonly ToolMetadata[] = [
  { name: 'a', requiredPermission: 'x' },
  { name: 'b', requiredPermission: 'y' },
  { name: 'c' }, // requiredPermission field missing — unannotated
  { name: 'd', requiredPermission: undefined }, // explicit undefined
];

describe('filterToolsByRbac — Phase 31.2 D-07', () => {
  it('Test 1: tool whose requiredPermission is present passes through', () => {
    const result = filterToolsByRbac(
      [{ name: 'a', requiredPermission: 'x' }],
      new Set<string>(['x']),
    );
    expect(result).toEqual(['a']);
  });

  it('Test 2: tool whose requiredPermission is missing from perms is filtered out', () => {
    const result = filterToolsByRbac(
      [{ name: 'a', requiredPermission: 'x' }],
      new Set<string>(['y']),
    );
    expect(result).toEqual([]);
  });

  it('Test 3: explicit undefined requiredPermission passes through (mirrors filterToolsByPermissions)', () => {
    const result = filterToolsByRbac(
      [{ name: 'a', requiredPermission: undefined }],
      new Set<string>(),
    );
    expect(result).toEqual(['a']);
  });

  it('Test 4: missing requiredPermission field is equivalent to undefined — passes through', () => {
    const result = filterToolsByRbac([{ name: 'a' }], new Set<string>());
    expect(result).toEqual(['a']);
  });

  it('Test 5: mirrors filterToolsByPermissions on identical inputs (sanity)', () => {
    const permSets: readonly ReadonlySet<string>[] = [
      new Set<string>(),
      new Set<string>(['x']),
      new Set<string>(['y']),
      new Set<string>(['x', 'y']),
      new Set<string>(['z']),
    ];
    for (const perms of permSets) {
      expect(filterToolsByRbac(RBAC_TOOLS, perms)).toEqual(
        filterToolsByPermissions(RBAC_TOOLS, perms),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Resource filters — mirrored contract (Phase 30 D-12 + Phase 30.1 rewrite)
// ---------------------------------------------------------------------------

const RESOURCES: readonly ResourceMetadata[] = [
  { uriScheme: 'health' }, // no requiredPermission
  { uriScheme: 'scan', requiredPermission: 'reports.view' },
  { uriScheme: 'brand', requiredPermission: 'branding.view' },
  { uriScheme: 'brand_manage', requiredPermission: 'branding.manage' },
  { uriScheme: 'scan_trigger', requiredPermission: 'scans.create' },
  { uriScheme: 'users_admin', requiredPermission: 'admin.users' },
  { uriScheme: 'system_config', requiredPermission: 'admin.system' },
];

describe('filterResourcesByPermissions', () => {
  it('returns only unannotated resources when perms set is empty', () => {
    const result = filterResourcesByPermissions(RESOURCES, new Set<string>());
    expect(result).toEqual(['health']);
  });

  it('returns only resources whose requiredPermission is present', () => {
    const result = filterResourcesByPermissions(RESOURCES, new Set(['reports.view', 'branding.view']));
    expect(result).toContain('health');
    expect(result).toContain('scan');
    expect(result).toContain('brand');
    expect(result).not.toContain('brand_manage');
    expect(result).not.toContain('scan_trigger');
    expect(result).not.toContain('users_admin');
    expect(result).not.toContain('system_config');
  });
});

describe('filterResourcesByScope — Phase 30.1 rewritten rules', () => {
  it('scope=admin surfaces every resource', () => {
    const result = filterResourcesByScope(RESOURCES, ['admin']);
    expect(result.length).toBe(RESOURCES.length);
  });

  it('scope=read surfaces only unannotated + .view resources', () => {
    const result = filterResourcesByScope(RESOURCES, ['read']);
    expect(result).toContain('health');
    expect(result).toContain('scan');          // reports.view
    expect(result).toContain('brand');         // branding.view
    expect(result).not.toContain('brand_manage');   // .manage → write-tier
    expect(result).not.toContain('scan_trigger');   // .create → write-tier
    expect(result).not.toContain('users_admin');    // admin.users → write-tier
    expect(result).not.toContain('system_config');  // admin.system → admin-only
  });

  it('scope=write surfaces read-tier + .create/.update/.manage/.delete/admin.users/admin.org — NOT admin.system', () => {
    const result = filterResourcesByScope(RESOURCES, ['write']);
    expect(result).toContain('health');
    expect(result).toContain('scan');
    expect(result).toContain('brand');
    expect(result).toContain('brand_manage');      // .manage
    expect(result).toContain('scan_trigger');      // .create
    expect(result).toContain('users_admin');       // admin.users
    expect(result).not.toContain('system_config'); // admin.system → admin-only
  });

  it('empty scopes returns only unannotated resources', () => {
    const result = filterResourcesByScope(RESOURCES, []);
    expect(result).toEqual(['health']);
  });
});
