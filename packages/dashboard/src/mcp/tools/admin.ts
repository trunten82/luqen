/**
 * registerAdminTools — Dashboard MCP admin tools (Phase 30, MCPT-04).
 *
 * 13 tools covering users (4), orgs (4), service-connections (5). Every
 * handler carries an explicit classification comment of the form
 * "orgId: ctx.orgId (org-scoped — <rationale>)" on the line immediately
 * above each async handler so the Task 2 classification regex lands on
 * exactly 13 matches. Service-connection secrets are NEVER returned on
 * read paths (D-06): all of list/get/post-write responses are mapped
 * through redactConnection, which strips clientSecret entirely (the key
 * itself is excluded — belt-and-braces). Writes accept plaintext
 * clientSecret in inputSchema; the update handler uses blank-to-keep
 * semantics by passing clientSecret: null when omitted (the repository
 * preserves the existing encrypted blob).
 *
 * No delete tools (D-05 / D-08) — Phase 32 ships dashboard-native
 * confirmation modals (APER-02) alongside delete_user / delete_org /
 * delete_service_connection. Phase 30 stays stateless: no two-phase
 * confirmation tokens.
 *
 * Coercion note: numeric inputSchema fields use z.coerce.number() so that
 * LLM-produced string numerics are accepted without a type-validation error
 * (fix: mcp-limit-string-coercion).
 *
 * Phase 31.2 D-09 drift guard: every entry in DASHBOARD_ADMIN_TOOL_METADATA
 * MUST declare a valid requiredPermission. Enforced by
 * tests/mcp/tool-metadata-drift.test.ts — any future admin tool added
 * without a permission (or with a typo'd permission id) breaks CI.
 */

import { z } from 'zod';
import { getCurrentToolContext } from '@luqen/core/mcp';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolMetadata } from '@luqen/core/mcp';
import type { StorageAdapter } from '../../db/index.js';
import type {
  ServiceConnection,
  ServiceConnectionsRepository,
  ServiceId,
} from '../../db/service-connections-repository.js';
import { testServiceConnection } from '../../services/service-connection-tester.js';

export const ADMIN_TOOL_NAMES = [
  'dashboard_list_users',
  'dashboard_get_user',
  'dashboard_create_user',
  'dashboard_update_user',
  'dashboard_list_orgs',
  'dashboard_get_org',
  'dashboard_create_org',
  'dashboard_update_org',
  'dashboard_list_service_connections',
  'dashboard_get_service_connection',
  'dashboard_create_service_connection',
  'dashboard_update_service_connection',
  'dashboard_test_service_connection',
] as const;

export const DASHBOARD_ADMIN_TOOL_METADATA: readonly ToolMetadata[] = [
  { name: 'dashboard_list_users', requiredPermission: 'admin.users' },
  { name: 'dashboard_get_user', requiredPermission: 'admin.users' },
  { name: 'dashboard_create_user', requiredPermission: 'admin.users' },
  { name: 'dashboard_update_user', requiredPermission: 'admin.users' },
  // D-07 dual-permission tools — filter manifest uses admin.org as the lower-tier
  // gate so both admin.org-only and admin.system-holding callers see the tool;
  // each handler branches on ctx.permissions.has('admin.system') for cross-org
  // scope. admin role users hold both permissions via resolveEffectivePermissions
  // (permissions.ts), so this stays a safe lower bound.
  { name: 'dashboard_list_orgs', requiredPermission: 'admin.org' },
  { name: 'dashboard_get_org', requiredPermission: 'admin.org' },
  { name: 'dashboard_create_org', requiredPermission: 'admin.system' }, // D-07: system-wide only
  { name: 'dashboard_update_org', requiredPermission: 'admin.org' },
  { name: 'dashboard_list_service_connections', requiredPermission: 'admin.system' },
  { name: 'dashboard_get_service_connection', requiredPermission: 'admin.system' },
  { name: 'dashboard_create_service_connection', requiredPermission: 'admin.system' },
  { name: 'dashboard_update_service_connection', requiredPermission: 'admin.system' },
  { name: 'dashboard_test_service_connection', requiredPermission: 'admin.system' },
];

export interface RegisterAdminToolsOptions {
  readonly storage: StorageAdapter;
  readonly serviceConnections: ServiceConnectionsRepository;
}

function resolveOrgId(): string {
  const ctx = getCurrentToolContext();
  return ctx?.orgId ?? 'system';
}

function errorEnvelope(msg: string): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: msg }) }],
    isError: true,
  };
}

function okEnvelope(payload: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Strip the password hash (and any plaintext password placeholder) from a
 * user record before returning it via MCP. Defensive: even if the repository
 * row shape evolves, the destructured keys are filtered out by name.
 */
function stripPasswordHash(user: Record<string, unknown>): Record<string, unknown> {
  const { passwordHash: _ph, password: _pw, ...safe } = user;
  return safe;
}

/**
 * Map a ServiceConnection row through to the redacted shape returned by MCP
 * tools. The decrypted clientSecret is NEVER included; only a hasSecret
 * boolean and a secretPreview ('xxxx...last4' or null) are exposed (D-06).
 * The clientSecret KEY itself is also omitted — even key-name leakage is
 * avoided as defense-in-depth against future serializer regressions.
 */
function redactConnection(conn: ServiceConnection): Record<string, unknown> {
  const preview =
    conn.clientSecret !== '' && conn.clientSecret.length >= 4
      ? `xxxx...${conn.clientSecret.slice(-4)}`
      : null;
  return {
    serviceId: conn.serviceId,
    url: conn.url,
    clientId: conn.clientId,
    hasSecret: conn.hasSecret,
    secretPreview: preview,
    updatedAt: conn.updatedAt,
    updatedBy: conn.updatedBy,
    source: conn.source,
  };
}

/**
 * Replace any bareword of ≥20 alphanumeric/dash/underscore characters with
 * '[redacted]'. Catches OAuth tokens, encrypted blobs, and long secret
 * candidates that might surface in error messages from upstream HTTP clients.
 * Mirrors the scrub() helper inside service-connection-tester.ts but operates
 * by length-heuristic since the candidate secret is not always known here.
 */
function scrubError(err: unknown): string {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  return msg.replace(/\b[A-Za-z0-9_-]{20,}\b/g, '[redacted]');
}

export function registerAdminTools(
  server: McpServer,
  opts: RegisterAdminToolsOptions,
): void {
  const { storage, serviceConnections } = opts;

  // ======================================================================
  // USERS (4 tools — admin.users)
  // ======================================================================

  server.registerTool(
    'dashboard_list_users',
    {
      description:
        "List dashboard users. The top-level `role` field is the user's GLOBAL/system role (e.g. admin, user, viewer). Each user also carries `orgs: [{id, name, orgRole}, ...]` — `orgRole` is the user's role WITHIN that specific org (typically 'admin' for org owners) and is the authoritative answer for 'what role does X have in org Y'. Empty orgs[] means no org membership (common for global admins).\n\n" +
        "USAGE PATTERNS:\n" +
        "- 'Users in MY org' (caller-scoped, default): omit orgScope. Returns members of the caller's own org. Global admins (no caller org) get an error directing them to use orgScope='all'.\n" +
        "- 'Users in a SPECIFIC org by name or ID' (e.g. Concorsando): pass orgScope='all' AND filter the results client-side by user.orgs[].name or user.orgs[].id. When reporting the user's role in that org, use user.orgs[].orgRole (NOT the top-level user.role). Do NOT pass an orgId in orgScope — the only legal values are 'caller-org' and 'all'.\n" +
        "- 'All users in the system': pass orgScope='all'.\n\n" +
        "The response always echoes the resolved scope ('caller-org:<orgId>' or 'all'). When scope='all', meta.notice reminds you to derive org membership from user.orgs[]. Password hashes are never returned.",
      inputSchema: z.object({
        orgScope: z
          .enum(['caller-org', 'all'])
          .optional()
          .describe(
            "Defaults to caller-org. Global admins (no caller org context) MUST pass 'all'.",
          ),
      }),
    },
    // orgId: ctx.orgId (org-scoped — caller-org scope hits listUsersForOrg(ctx.orgId); all scope still requires admin.users permission)
    async (args) => {
      const orgId = resolveOrgId();
      const scope = args.orgScope ?? 'caller-org';
      // Global admins have empty orgId — caller-org would silently return [] which the
      // model has historically misinterpreted. Force explicit 'all' selection instead.
      if (scope === 'caller-org' && orgId === '') {
        return errorEnvelope(
          "No caller org context (global admin). Pass orgScope='all' for a system-wide list.",
        );
      }
      const rows =
        scope === 'all'
          ? await storage.users.listUsers()
          : await storage.users.listUsersForOrg(orgId);
      const resolvedScope = scope === 'all' ? 'all' : `caller-org:${orgId}`;
      // Annotate each user with their org memberships so callers can answer
      // "users in org X" questions without inventing memberships. Without this,
      // models given a flat user list have historically relabeled scope='all'
      // results as a single specific org's users.
      // Pre-build a {orgId → {userId → orgRole}} map. dashboard_users.role is
      // the global/system role; org_members.role is the org-scoped role and is
      // what callers care about when answering "what role does X have in org Y".
      const userOrgs: Record<string, Array<{ id: string; name: string }>> = {};
      const orgIdsTouched = new Set<string>();
      for (const u of rows) {
        const uid = (u as unknown as { id: string }).id;
        const orgs = await storage.organizations.getUserOrgs(uid);
        userOrgs[uid] = orgs.map((o) => ({ id: o.id, name: o.name }));
        for (const o of orgs) orgIdsTouched.add(o.id);
      }
      const orgRoleMap: Record<string, Record<string, string>> = {};
      for (const oid of orgIdsTouched) {
        const members = await storage.organizations.listMembers(oid);
        const byUser: Record<string, string> = {};
        for (const m of members) byUser[m.userId] = m.role;
        orgRoleMap[oid] = byUser;
      }
      const enriched = rows.map((u) => {
        const safe = stripPasswordHash(u as unknown as Record<string, unknown>);
        const uid = (u as unknown as { id: string }).id;
        const orgsForUser = userOrgs[uid] ?? [];
        const orgsWithRole = orgsForUser.map((o) => ({
          id: o.id,
          name: o.name,
          orgRole: orgRoleMap[o.id]?.[uid] ?? null,
        }));
        return { ...safe, orgs: orgsWithRole };
      });
      return okEnvelope({
        data: enriched,
        meta: {
          count: enriched.length,
          scope: resolvedScope,
          notice:
            scope === 'all'
              ? 'scope=all returned every user in the system; check each user.orgs[] to determine org membership before claiming a user belongs to a specific org'
              : undefined,
        },
      });
    },
  );

  server.registerTool(
    'dashboard_get_user',
    {
      description:
        'Get a dashboard user by ID. Password hash is never returned.',
      inputSchema: z.object({
        userId: z.string().describe('User ID'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — caller identity logged for audit; target userId is not org-constrained at the repo layer)
    async (args) => {
      const _orgId = resolveOrgId();
      void _orgId;
      const user = await storage.users.getUserById(args.userId);
      if (user === null) return errorEnvelope(`User "${args.userId}" not found`);
      return okEnvelope(stripPasswordHash(user as unknown as Record<string, unknown>));
    },
  );

  server.registerTool(
    'dashboard_create_user',
    {
      description:
        'Create a dashboard user. Password is write-only; response never echoes it.',
      inputSchema: z.object({
        username: z.string().min(1).describe('Username — unique'),
        password: z
          .string()
          .min(8)
          .describe('Initial password — at least 8 characters'),
        role: z.string().describe('Role (e.g. admin, member)'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — caller's orgId captured for audit; the new user is created at the system level)
    async (args) => {
      const _orgId = resolveOrgId();
      void _orgId;
      const user = await storage.users.createUser(
        args.username,
        args.password,
        args.role,
      );
      return okEnvelope(
        stripPasswordHash(user as unknown as Record<string, unknown>),
      );
    },
  );

  server.registerTool(
    'dashboard_update_user',
    {
      description:
        "Update a dashboard user's role or active status. Password changes go through a dedicated reset flow (not exposed via MCP in Phase 30).",
      inputSchema: z.object({
        userId: z.string().describe('User ID'),
        role: z
          .string()
          .optional()
          .describe('New role — omit to leave unchanged'),
        active: z
          .boolean()
          .optional()
          .describe('true=activate, false=deactivate — omit to leave unchanged'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — caller identity captured for audit; target userId is not org-constrained at the repo layer)
    async (args) => {
      const _orgId = resolveOrgId();
      void _orgId;
      if (args.role !== undefined) {
        await storage.users.updateUserRole(args.userId, args.role);
      }
      if (args.active === true) {
        await storage.users.activateUser(args.userId);
      } else if (args.active === false) {
        await storage.users.deactivateUser(args.userId);
      }
      const updated = await storage.users.getUserById(args.userId);
      if (updated === null)
        return errorEnvelope(`User "${args.userId}" not found after update`);
      return okEnvelope(
        stripPasswordHash(updated as unknown as Record<string, unknown>),
      );
    },
  );

  // ======================================================================
  // ORGS (4 tools — D-07 dual-permission for list/get/update)
  // ======================================================================

  server.registerTool(
    'dashboard_list_orgs',
    {
      description:
        'List organizations. Callers with admin.system see all orgs; callers with only admin.org see only their own org (D-07 dual-permission).',
      inputSchema: z.object({}),
    },
    // orgId: ctx.orgId (org-scoped — admin.system branch returns all orgs; admin.org-only branch returns only the caller's own org)
    async () => {
      const ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const perms = ctx?.permissions ?? new Set<string>();
      if (perms.has('admin.system')) {
        const rows = await storage.organizations.listOrgs();
        return okEnvelope({ data: rows, meta: { count: rows.length } });
      }
      const own = await storage.organizations.getOrg(orgId);
      const rows = own === null ? [] : [own];
      return okEnvelope({ data: rows, meta: { count: rows.length } });
    },
  );

  server.registerTool(
    'dashboard_get_org',
    {
      description:
        'Get an organization by ID. Callers with admin.system may target any org; callers with only admin.org may target only their own org (D-07 dual-permission).',
      inputSchema: z.object({
        targetOrgId: z
          .string()
          .describe(
            "The org ID to inspect — NOT the caller's own org (that comes from JWT)",
          ),
      }),
    },
    // orgId: ctx.orgId (org-scoped — admin.system may target any org; admin.org-only callers are guarded to their own orgId)
    async (args) => {
      const ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const perms = ctx?.permissions ?? new Set<string>();
      if (!perms.has('admin.system') && args.targetOrgId !== orgId) {
        return errorEnvelope(
          'Forbidden: admin.org callers may only read their own org',
        );
      }
      const org = await storage.organizations.getOrg(args.targetOrgId);
      if (org === null) return errorEnvelope(`Org "${args.targetOrgId}" not found`);
      return okEnvelope(org);
    },
  );

  server.registerTool(
    'dashboard_create_org',
    {
      description:
        'Create a new organization. Requires admin.system permission.',
      inputSchema: z.object({
        name: z.string().min(1).describe('Display name'),
        slug: z.string().min(1).describe('URL-safe slug (unique)'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — caller identity captured for audit; the new org is independent of the caller's org)
    async (args) => {
      const _orgId = resolveOrgId();
      void _orgId;
      const org = await storage.organizations.createOrg({
        name: args.name,
        slug: args.slug,
      });
      return okEnvelope(org);
    },
  );

  server.registerTool(
    'dashboard_update_org',
    {
      description:
        "Update an organization's branding mode or brand score target. Callers with admin.system may target any org; callers with only admin.org may target only their own org (D-07 dual-permission).",
      inputSchema: z.object({
        targetOrgId: z
          .string()
          .describe("The org ID to update — NOT the caller's own org"),
        brandingMode: z
          .enum(['embedded', 'remote'])
          .optional()
          .describe('Branding routing mode'),
        brandScoreTarget: z
          .coerce
          .number()
          .int()
          .min(0)
          .max(100)
          .nullable()
          .optional()
          .describe('Brand score target percentage, or null to clear'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — admin.system may target any org; admin.org-only callers are guarded to their own orgId)
    async (args) => {
      const ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const perms = ctx?.permissions ?? new Set<string>();
      if (!perms.has('admin.system') && args.targetOrgId !== orgId) {
        return errorEnvelope(
          'Forbidden: admin.org callers may only update their own org',
        );
      }
      const org = await storage.organizations.getOrg(args.targetOrgId);
      if (org === null) return errorEnvelope(`Org "${args.targetOrgId}" not found`);
      if (args.brandingMode !== undefined) {
        await storage.organizations.setBrandingMode(args.targetOrgId, args.brandingMode);
      }
      if (args.brandScoreTarget !== undefined) {
        await storage.organizations.setBrandScoreTarget(
          args.targetOrgId,
          args.brandScoreTarget,
        );
      }
      const updated = await storage.organizations.getOrg(args.targetOrgId);
      return okEnvelope(updated);
    },
  );

  // ======================================================================
  // SERVICE CONNECTIONS (5 tools — admin.system)
  // ======================================================================

  server.registerTool(
    'dashboard_list_service_connections',
    {
      description:
        'List all outbound service connections (compliance, branding, llm). Secrets are NEVER returned — responses include hasSecret + secretPreview (xxxx...last4 or null), never the encrypted blob and never the plaintext.',
      inputSchema: z.object({}),
    },
    // orgId: ctx.orgId (org-scoped — caller identity captured for audit; service-connections themselves are system-wide)
    async () => {
      const _orgId = resolveOrgId();
      void _orgId;
      const rows = await serviceConnections.list();
      return okEnvelope({
        data: rows.map(redactConnection),
        meta: { count: rows.length },
      });
    },
  );

  server.registerTool(
    'dashboard_get_service_connection',
    {
      description:
        'Get a single service connection. Secret is never returned — only hasSecret + secretPreview.',
      inputSchema: z.object({
        serviceId: z
          .enum(['compliance', 'branding', 'llm'])
          .describe('Target service'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — caller identity captured for audit; service-connections themselves are system-wide)
    async (args) => {
      const _orgId = resolveOrgId();
      void _orgId;
      const conn = await serviceConnections.get(args.serviceId);
      if (conn === null)
        return errorEnvelope(
          `Service connection "${args.serviceId}" not configured`,
        );
      return okEnvelope(redactConnection(conn));
    },
  );

  server.registerTool(
    'dashboard_create_service_connection',
    {
      description:
        'Create or upsert a service connection. Supply clientSecret in the call; the response returns a redacted copy (xxxx...last4) — secrets are never echoed back. Use dashboard_test_service_connection afterwards to verify connectivity.',
      inputSchema: z.object({
        serviceId: z
          .enum(['compliance', 'branding', 'llm'])
          .describe('Target service'),
        url: z
          .string()
          .url()
          .describe('Base URL (e.g. http://host:port)'),
        clientId: z.string().describe('OAuth2 client ID'),
        clientSecret: z
          .string()
          .describe(
            'OAuth2 client secret — encrypted at rest, never returned on reads',
          ),
      }),
    },
    // orgId: ctx.orgId (org-scoped — caller identity captured as updatedBy; service-connections themselves are system-wide)
    async (args) => {
      const ctx = getCurrentToolContext();
      const saved = await serviceConnections.upsert({
        serviceId: args.serviceId,
        url: args.url,
        clientId: args.clientId,
        clientSecret: args.clientSecret,
        updatedBy: ctx?.userId ?? 'mcp',
      });
      return okEnvelope(redactConnection(saved));
    },
  );

  server.registerTool(
    'dashboard_update_service_connection',
    {
      description:
        'Update fields on an existing service connection. Omitting clientSecret preserves the existing secret (blank-to-keep semantics) — supply a new secret only when rotating. Response is redacted (xxxx...last4).',
      inputSchema: z.object({
        serviceId: z
          .enum(['compliance', 'branding', 'llm'])
          .describe('Target service'),
        url: z.string().url().optional().describe('New base URL'),
        clientId: z.string().optional().describe('New client ID'),
        clientSecret: z
          .string()
          .optional()
          .describe('New secret (omit to keep existing)'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — caller identity captured as updatedBy; service-connections themselves are system-wide)
    async (args) => {
      const ctx = getCurrentToolContext();
      const existing = await serviceConnections.get(args.serviceId);
      if (existing === null)
        return errorEnvelope(
          `Service connection "${args.serviceId}" not configured — use dashboard_create_service_connection first`,
        );
      const saved = await serviceConnections.upsert({
        serviceId: args.serviceId,
        url: args.url ?? existing.url,
        clientId: args.clientId ?? existing.clientId,
        clientSecret: args.clientSecret ?? null, // null = preserve existing encrypted blob
        updatedBy: ctx?.userId ?? 'mcp',
      });
      return okEnvelope(redactConnection(saved));
    },
  );

  server.registerTool(
    'dashboard_test_service_connection',
    {
      description:
        'Run a live OAuth2 + /health probe against a service connection. Provide serviceId to test the stored config, or url+clientId+clientSecret to test candidate values without persisting. Error messages are scrubbed of long secret-like tokens before being returned.',
      inputSchema: z.object({
        serviceId: z
          .enum(['compliance', 'branding', 'llm'])
          .optional()
          .describe('Test the stored config for this service'),
        url: z
          .string()
          .url()
          .optional()
          .describe('Candidate URL (for untested config)'),
        clientId: z.string().optional().describe('Candidate client ID'),
        clientSecret: z.string().optional().describe('Candidate client secret'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — caller identity captured for audit; service-connections themselves are system-wide)
    async (args) => {
      const _orgId = resolveOrgId();
      void _orgId;
      try {
        let input: { url: string; clientId: string; clientSecret: string };
        if (args.serviceId !== undefined) {
          const conn = await serviceConnections.get(args.serviceId as ServiceId);
          if (conn === null)
            return errorEnvelope(
              `Service connection "${args.serviceId}" not configured`,
            );
          if (!conn.hasSecret)
            return errorEnvelope('Stored connection has no secret configured');
          input = {
            url: conn.url,
            clientId: conn.clientId,
            clientSecret: conn.clientSecret,
          };
        } else if (
          args.url !== undefined &&
          args.clientId !== undefined &&
          args.clientSecret !== undefined
        ) {
          input = {
            url: args.url,
            clientId: args.clientId,
            clientSecret: args.clientSecret,
          };
        } else {
          return errorEnvelope(
            'Provide either serviceId or {url, clientId, clientSecret}',
          );
        }
        const result = await testServiceConnection(input);
        return okEnvelope(result);
      } catch (err) {
        return errorEnvelope(scrubError(err));
      }
    },
  );
}
