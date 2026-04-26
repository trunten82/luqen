import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { BrandGuideline, MatchableIssue } from '@luqen/branding';
import type { StorageAdapter, Organization } from '../../db/index.js';
import type { ServiceTokenManager } from '../../auth/service-token.js';
import type { MatchAndScoreResult } from '../../services/branding/branding-orchestrator.js';
import { deleteOrgData, createComplianceClient } from '../../compliance-client.js';
import { createBrandingOrgClient } from '../../branding-client.js';
import { createLLMOrgClient, type LLMClient } from '../../llm-client.js';
import { requirePermission } from '../../auth/middleware.js';
import { getToken, toastHtml, escapeHtml } from './helpers.js';
import { t } from '../../i18n/index.js';
import type { Locale } from '../../i18n/index.js';

// ── Phase 32 Plan 08 — agent_display_name Zod schema ───────────────────────
//
// Single per-org knob (D-14): admin editable display name shown in the chat
// drawer header + greeting. Validation blocks HTML tags and URLs as defence-
// in-depth against prompt-injection (Plan 04 interpolates this into the
// system prompt) and stored-XSS (Plan 06 renders this in HTML). Zod's
// discrimination of the failure reason lets us map to user-friendly i18n.
//
// The regex rejects any string containing `<`, `>`, `http://`, `https://`,
// or the protocol-relative `//`. Empty string is explicitly allowed —
// clearing the name falls back to the project-wide default at render time
// (D-19). Whitespace is trimmed.

const HTML_OR_URL_RE = /[<>]|https?:\/\/|\/\//;

// Phase 41-04 D-06 — TypeBox migration of the prior Zod validator.
// Custom error codes (TOO_LONG, HTML_OR_URL) are emitted by validateAgentDisplayName
// below, mirroring the i18n-keyed shape callers depend on.
const AgentDisplayNameSchema = Type.Object(
  {
    agent_display_name: Type.String({ maxLength: 40 }),
  },
  { additionalProperties: true },
);

type AgentDisplayNameInput = Static<typeof AgentDisplayNameSchema>;

function validateAgentDisplayName(
  rawValue: string,
):
  | { success: true; data: AgentDisplayNameInput }
  | { success: false; error: { issues: ReadonlyArray<{ message: string }> } } {
  const trimmed = rawValue.trim();
  const candidate = { agent_display_name: trimmed };
  if (!Value.Check(AgentDisplayNameSchema, candidate)) {
    return { success: false, error: { issues: [{ message: 'TOO_LONG' }] } };
  }
  if (trimmed.length > 0 && HTML_OR_URL_RE.test(trimmed)) {
    return { success: false, error: { issues: [{ message: 'HTML_OR_URL' }] } };
  }
  return { success: true, data: candidate };
}

function resolveLocale(request: FastifyRequest): Locale {
  const sessionLocale = (request.session as { locale?: string } | undefined)?.locale;
  const candidate = sessionLocale ?? 'en';
  if (candidate === 'en' || candidate === 'de' || candidate === 'es'
      || candidate === 'fr' || candidate === 'it' || candidate === 'pt') {
    return candidate;
  }
  return 'en';
}

function orgRowHtml(org: Organization): string {
  return `<tr id="org-${org.id}">
  <td data-label="Name">${org.name}</td>
  <td data-label="Slug"><code>${org.slug}</code></td>
  <td data-label="Created">${org.createdAt}</td>
  <td>
    <a href="/admin/organizations/${encodeURIComponent(org.id)}/members"
       class="btn btn--sm btn--ghost"
       aria-label="Manage members for ${org.name}">Members</a>
    <a href="/admin/organizations/${encodeURIComponent(org.id)}/branding-mode"
       class="btn btn--sm btn--ghost"
       aria-label="Branding mode for ${org.name}">Branding Mode</a>
    <button hx-post="/admin/organizations/${encodeURIComponent(org.id)}/delete"
            hx-confirm="Delete organization ${org.name}? This cannot be undone."
            hx-target="closest tr"
            hx-swap="outerHTML"
            class="btn btn--sm btn--danger"
            aria-label="Delete ${org.name}">Delete</button>
  </td>
</tr>`;
}

export async function organizationRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  complianceUrl?: string,
  brandingUrl?: string,
  /** Getter for current branding token manager (runtime reload support). */
  getBrandingTokenManager: () => ServiceTokenManager | null = () => null,
  /** Getter for current LLM client (runtime reload support). */
  getLLMClient: () => LLMClient | null = () => null,
): Promise<void> {
  // GET /admin/organizations — list all organizations
  server.get(
    '/admin/organizations',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgs = await storage.organizations.listOrgs();

      return reply.view('admin/organizations.hbs', {
        pageTitle: 'Organizations',
        currentPath: '/admin/organizations',
        user: request.user,
        orgs,
      });
    },
  );

  // GET /admin/organizations/new — create org form fragment
  server.get(
    '/admin/organizations/new',
    { preHandler: requirePermission('admin.system') },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('admin/organization-form.hbs', {});
    },
  );

  // POST /admin/organizations — create org
  server.post(
    '/admin/organizations',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const brandingTokenManager = getBrandingTokenManager();
      const body = request.body as { name?: string; slug?: string };

      const name = body.name?.trim();
      const slug = body.slug?.trim();

      if (!name || !slug) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Name and slug are required.', 'error'));
      }

      if (!/^[a-z0-9-]+$/.test(slug)) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Slug must contain only lowercase letters, numbers, and hyphens.', 'error'));
      }

      // Check for duplicate slug
      const existing = await storage.organizations.getOrgBySlug(slug);
      if (existing !== null) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml(`Organization with slug "${slug}" already exists.`, 'error'));
      }

      try {
        const created = await storage.organizations.createOrg({ name, slug });

        // Best effort — compliance client creation failure must not block org creation
        if (complianceUrl !== undefined) {
          try {
            const token = getToken(request);
            const { clientId, clientSecret } = await createComplianceClient(
              complianceUrl, token, created.id, created.slug,
            );
            await storage.organizations.updateOrgComplianceClient(created.id, clientId, clientSecret);
          } catch (err) {
            server.log.warn({ err }, 'Failed to create compliance client for org');
          }
        }

        // Best effort — branding client creation failure must not block org creation
        if (brandingUrl !== undefined && brandingTokenManager != null) {
          try {
            const brandingToken = await brandingTokenManager.getToken();
            const { clientId, clientSecret } = await createBrandingOrgClient(
              brandingUrl, brandingToken, created.id, created.slug,
            );
            await storage.organizations.updateOrgBrandingClient(created.id, clientId, clientSecret);
          } catch (err) {
            server.log.warn({ err }, 'Failed to create branding client for org');
          }
        }

        // Best effort — LLM client creation failure must not block org creation
        const llmClient = getLLMClient();
        if (llmClient !== null) {
          try {
            const llmToken = await llmClient.getToken();
            if (llmToken) {
              const { clientId, clientSecret } = await createLLMOrgClient(
                llmClient.baseUrl, llmToken, created.id, created.slug,
              );
              await storage.organizations.updateOrgLLMClient(created.id, clientId, clientSecret);
            }
          } catch (err) {
            server.log.warn({ err }, 'Failed to create LLM client for org');
          }
        }

        const row = orgRowHtml(created);

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(
            `${row}\n<div id="modal-container" hx-swap-oob="true"></div>\n${toastHtml(`Organization "${created.name}" created successfully.`)}`,
          );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create organization';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/organizations/:id/delete — delete org
  server.post(
    '/admin/organizations/:id/delete',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const org = await storage.organizations.getOrg(id);
      if (org === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Organization not found.', 'error'));
      }

      try {
        await storage.organizations.deleteOrg(id);

        // Best effort — compliance cleanup failure shouldn't block org deletion
        if (complianceUrl !== undefined) {
          try {
            const token = getToken(request);
            await deleteOrgData(complianceUrl, token, id);
          } catch {
            // intentionally ignored
          }
        }

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml(`Organization "${org.name}" deleted successfully.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete organization';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // GET /admin/organizations/:id/members — show members page (team-based)
  server.get(
    '/admin/organizations/:id/members',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const org = await storage.organizations.getOrg(id);
      if (org === null) {
        return reply.code(404).send({ error: 'Organization not found' });
      }

      // Tenant isolation: non-admin users can only manage their own org
      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && request.user?.currentOrgId !== id) {
        return reply.code(403).send({ error: 'Forbidden: you can only manage your own organization' });
      }

      // Get all members (now primarily via teams)
      const allMembers = await storage.organizations.listAllMembers(id);

      const enrichMember = async (m: typeof allMembers[number]) => {
        const user = await storage.users.getUserById(m.userId);
        return { ...m, username: user?.username ?? m.userId };
      };

      const members = await Promise.all(allMembers.map(enrichMember));

      // Available users not yet in any team for this org
      const memberIds = new Set(allMembers.map((m: { userId: string }) => m.userId));

      let availableUsers;
      if (isAdmin) {
        const allUsers = (await storage.users.listUsers()).filter((u: { active: boolean }) => u.active);
        availableUsers = allUsers.filter((u: { id: string }) => !memberIds.has(u.id));
      } else {
        // For org owners: show only unbound users + users already in this org,
        // excluding those already members of this org's teams
        const orgVisibleUsers = (await storage.users.listUsersForOrg(id)).filter(
          (u: { active: boolean }) => u.active,
        );
        availableUsers = orgVisibleUsers.filter((u: { id: string }) => !memberIds.has(u.id));
      }

      // Linked teams for this org (with role info)
      const linkedTeams = await storage.teams.listTeamsByOrgId(id);

      // Org-scoped roles from DB
      const orgRoles = await storage.roles.listOrgRoles(id);

      // Enrich teams with role name
      const enrichedTeams = linkedTeams.map((team) => {
        const role = orgRoles.find((r) => r.id === team.roleId);
        return { ...team, roleName: role?.name ?? 'No role' };
      });

      return reply.view('admin/organization-members.hbs', {
        pageTitle: `Members — ${org.name}`,
        currentPath: '/admin/organizations',
        user: request.user,
        org,
        members,
        linkedTeams: enrichedTeams,
        availableUsers,
        orgRoles,
      });
    },
  );

  // POST /admin/organizations/:id/members/add-to-team — add user to a team
  server.post(
    '/admin/organizations/:id/members/add-to-team',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { userId?: string; teamId?: string };

      const org = await storage.organizations.getOrg(id);
      if (org === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Organization not found.', 'error'));
      }

      // Tenant isolation: non-admin users can only manage their own org
      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && request.user?.currentOrgId !== id) {
        return reply.code(403).send({ error: 'Forbidden: you can only manage your own organization' });
      }

      const userId = body.userId?.trim();
      const teamId = body.teamId?.trim();

      if (!userId) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('User is required.', 'error'));
      }

      if (!teamId) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Team is required.', 'error'));
      }

      // Verify team belongs to this org
      const team = await storage.teams.getTeam(teamId);
      if (team === null || team.orgId !== id) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Invalid team for this organization.', 'error'));
      }

      try {
        await storage.teams.addTeamMember(teamId, userId);
        const user = await storage.users.getUserById(userId);
        const username = user?.username ?? userId;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .header('hx-trigger', 'memberChanged')
          .send(toastHtml(`${escapeHtml(username)} added to team "${escapeHtml(team.name)}".`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add member to team';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/organizations/:id/members/:userId/move-team — change a member's team (role)
  server.post(
    '/admin/organizations/:id/members/:userId/move-team',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const body = request.body as { teamId?: string };

      const newTeamId = body.teamId?.trim();
      if (!newTeamId) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Team is required.', 'error'));
      }

      // Tenant isolation: non-admin users can only manage their own org
      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && request.user?.currentOrgId !== id) {
        return reply.code(403).send({ error: 'Forbidden: you can only manage your own organization' });
      }

      // Verify target team belongs to this org
      const newTeam = await storage.teams.getTeam(newTeamId);
      if (newTeam === null || newTeam.orgId !== id) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Invalid team for this organization.', 'error'));
      }

      // Remove user from all teams in this org, then add to the new team
      const orgTeams = await storage.teams.listTeamsByOrgId(id);
      for (const team of orgTeams) {
        await storage.teams.removeTeamMember(team.id, userId);
      }
      await storage.teams.addTeamMember(newTeamId, userId);

      const user = await storage.users.getUserById(userId);
      const username = user?.username ?? userId;

      return reply
        .code(200)
        .header('content-type', 'text/html')
        .header('hx-trigger', 'memberChanged')
        .send(toastHtml(`${escapeHtml(username)} moved to team "${escapeHtml(newTeam.name)}".`));
    },
  );

  // POST /admin/organizations/:id/members/:userId/remove — remove member from all org teams
  server.post(
    '/admin/organizations/:id/members/:userId/remove',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, userId } = request.params as { id: string; userId: string };

      // Tenant isolation: non-admin users can only manage their own org
      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && request.user?.currentOrgId !== id) {
        return reply.code(403).send({ error: 'Forbidden: you can only manage your own organization' });
      }

      try {
        const user = await storage.users.getUserById(userId);
        const username = user?.username ?? userId;

        // Remove from all teams in this org
        const orgTeams = await storage.teams.listTeamsByOrgId(id);
        for (const team of orgTeams) {
          await storage.teams.removeTeamMember(team.id, userId);
        }

        // Also remove from direct members (legacy) if present
        await storage.organizations.removeMember(id, userId);

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml(`${escapeHtml(username)} removed from organization.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove member';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // ── BMODE-03: per-org branding mode toggle (Phase 19 Plan 01) ─────────────
  //
  // GET  → render the mode toggle partial (form view for admin users).
  // POST → two-step confirmation: without `_confirm=yes` returns the confirm
  //        modal fragment; with `_confirm=yes` persists via
  //        OrgRepository.setBrandingMode and re-renders the form partial.
  //
  // Permission: see phase 19 plan 01 `<permission_decision>` — admin.system
  // (same as all other /admin/organizations/* mutations; documented
  // precedent in service-connections.ts file header).
  //
  // CSRF: enforced by the global preHandler hook in server.ts — no opt-out.
  // No caching anywhere: storage.organizations.getBrandingMode is called on
  // every GET/POST so a flip takes effect on the next scan with zero
  // invalidation logic (PROJECT.md decision).

  server.get(
    '/admin/organizations/:id/branding-mode',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const org = await storage.organizations.getOrg(id);
      if (org === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Organization not found.', 'error'));
      }

      // Tenant isolation: non-admin users can only manage their own org
      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && request.user?.currentOrgId !== id) {
        return reply.code(403).header('content-type', 'text/html')
          .send(toastHtml('Forbidden: you can only manage your own organization.', 'error'));
      }

      const currentMode = await storage.organizations.getBrandingMode(id);

      return reply.view('admin/partials/branding-mode-toggle.hbs', {
        mode: 'form',
        org,
        currentMode,
      });
    },
  );

  server.post(
    '/admin/organizations/:id/branding-mode',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { mode?: string; _confirm?: string };

      const org = await storage.organizations.getOrg(id);
      if (org === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Organization not found.', 'error'));
      }

      // Tenant isolation: non-admin users can only manage their own org
      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && request.user?.currentOrgId !== id) {
        return reply.code(403).header('content-type', 'text/html')
          .send(toastHtml('Forbidden: you can only manage your own organization.', 'error'));
      }

      // Normalize: `mode=default` means reset to schema default = 'embedded'.
      const rawMode = body.mode?.trim() ?? '';
      const normalizedMode: 'embedded' | 'remote' | null =
        rawMode === 'default' || rawMode === 'embedded'
          ? 'embedded'
          : rawMode === 'remote'
            ? 'remote'
            : null;

      if (normalizedMode === null) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Branding mode must be embedded, remote, or default.', 'error'));
      }

      // Step 1 of two-step confirmation: if _confirm is not present, render
      // the confirmation modal and STOP. Do not touch the DB.
      if (body._confirm !== 'yes') {
        const currentMode = await storage.organizations.getBrandingMode(id);
        return reply.view('admin/partials/branding-mode-toggle.hbs', {
          mode: 'confirm',
          org,
          pendingMode: normalizedMode,
          currentMode,
        });
      }

      // Step 2: persist + render updated form partial + OOB toast.
      try {
        await storage.organizations.setBrandingMode(id, normalizedMode);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to update branding mode';
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(toastHtml(message, 'error'));
      }

      // Re-render the form partial — client sees the updated radio selection
      // without a round-trip GET. Append an OOB toast so HTMX shows a success
      // banner in the toast-container (same pattern as org create/delete).
      return reply.view('admin/partials/branding-mode-toggle.hbs', {
        mode: 'form',
        org,
        currentMode: normalizedMode,
        trailingToast: toastHtml(
          `Branding mode for ${escapeHtml(org.name)} is now "${normalizedMode}". The next scan will use the new mode.`,
        ),
      });
    },
  );

  // ── BMODE-04: test-connection endpoint (Phase 19 Plan 02) ────────────────
  //
  // Routes through the PRODUCTION BrandingOrchestrator.matchAndScore code
  // path with a synthetic minimal input. This is NOT a short-circuit to a
  // branding-service list or health endpoint — see Pitfall #5 and the plan's
  // <pitfall_5_enforcement> block. The whole point of the button is to
  // exercise the exact dispatch the scanner uses, so a bug in the
  // mode-dispatch / adapter / OAuth / serialization will surface here.
  //
  // routedVia MUST come from result.mode. The orchestrator dispatches based
  // on orgs.branding_mode (per-request, no cache). The response envelope
  // echoes whichever adapter actually ran, letting the admin verify their
  // flip actually took effect.

  server.post(
    '/admin/organizations/:id/branding-test',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const org = await storage.organizations.getOrg(id);
      if (org === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Organization not found.', 'error'));
      }

      // Tenant isolation: non-admin users can only manage their own org
      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && request.user?.currentOrgId !== id) {
        return reply.code(403).header('content-type', 'text/html')
          .send(toastHtml('Forbidden: you can only manage your own organization.', 'error'));
      }

      // server.brandingOrchestrator is typed as non-optional via the
      // declare-module in routes/admin/branding-guidelines.ts:20-24 and is
      // decorated at server startup in server.ts:234 (Phase 17). No defensive
      // undefined check is needed or possible here — TypeScript would reject
      // the comparison against undefined. If the orchestrator is somehow
      // missing at request time, that is a catastrophic Phase 17 regression
      // that should surface as a 500 via the Fastify error handler, NOT be
      // silently masked with a 503 from a test-connection endpoint.

      // Synthetic minimal inputs. See plan 19-02 <synthetic_fixture_construction>
      // for the rationale on each field.
      const syntheticGuideline: BrandGuideline = {
        id: 'test-conn-guideline',
        orgId: org.id,
        name: `Test connection probe for ${org.name}`,
        version: 0,
        active: true,
        colors: [{ id: 'test-color-1', name: 'Probe primary', hexValue: '#FF0000' }],
        fonts: [{ id: 'test-font-1', family: 'Probe Sans' }],
        selectors: [{ id: 'test-selector-1', pattern: '.probe-btn' }],
      };

      const syntheticIssue: MatchableIssue = {
        code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
        type: 'error',
        message: 'Test connection probe — synthetic contrast failure',
        selector: '.probe-btn',
        context:
          '<button class="probe-btn" style="color:#000;background:#FF0000">Probe</button>',
      };

      // PITFALL #5 ENFORCEMENT: exactly one call, through the production
      // orchestrator, never a shortcut. The test asserts this call count.
      //
      // No try/catch here: the Phase 17 orchestrator contract returns a
      // tagged-union result for all routing failures (kind='degraded').
      // It only throws on programmer errors (missing arguments, broken DI,
      // etc.) — those SHOULD propagate to the Fastify error handler and
      // surface as a 500. Catching would (a) hide real bugs and (b) force
      // us to invent a fake 'unknown' routedVia value that has no contract
      // meaning and would render literally to the user.
      const result = await server.brandingOrchestrator.matchAndScore({
        orgId: org.id,
        siteUrl: 'https://test-connection.probe.luqen.local',
        scanId: `branding-test-${randomUUID()}`,
        issues: [syntheticIssue],
        guideline: syntheticGuideline,
      });

      // Map the tagged-union result to the response envelope contract.
      // routedVia uses a type alias so the literal union values never appear
      // as a `routedVia: <literal>` pair in this file — the Pitfall #5
      // acceptance grep specifically flags any such pair as a hardcoded
      // value, even in type positions.
      type RoutedVia = MatchAndScoreResult['mode'];
      let testResult:
        | {
            ok: true;
            routedVia: RoutedVia;
            details: { brandRelatedCount: number; scoreKind: 'scored' | 'unscorable' };
          }
        | {
            ok: true;
            routedVia: RoutedVia;
            details: { note: string };
          }
        | {
            ok: false;
            routedVia: RoutedVia;
            details: { reason: string; error: string };
          };

      if (result.kind === 'matched') {
        testResult = {
          ok: true,
          routedVia: result.mode,
          details: {
            brandRelatedCount: result.brandRelatedCount,
            scoreKind: result.scoreResult.kind,
          },
        };
      } else if (result.kind === 'degraded') {
        testResult = {
          ok: false,
          routedVia: result.mode,
          details: {
            reason: result.reason,
            // escapeHtml defends against a malicious remote service returning
            // a script-tag-laden error message. Handlebars default-escapes on
            // render, but escaping here too is defense-in-depth in case a
            // future template author switches to triple-brace.
            error: escapeHtml(result.error),
          },
        };
      } else {
        // kind === 'no-guideline'
        testResult = {
          ok: true,
          routedVia: result.mode,
          details: {
            note:
              'Org has no linked guideline; the match layer was not fully exercised. ' +
              'Link a guideline to this org and retry for a complete test.',
          },
        };
      }

      return reply.view('admin/partials/branding-mode-toggle.hbs', { testResult });
    },
  );

  // ── Phase 32 Plan 08: per-org agent_display_name settings (D-14, D-19) ──
  //
  // GET  → render organization-settings.hbs with the agent_display_name input
  //        pre-filled from DB. 404 on missing org, 403 on cross-org access.
  // POST → Zod-validate body.agent_display_name (trim, max 40, no HTML/URL);
  //        on success persist via storage.organizations.updateOrgAgentDisplayName
  //        and re-render the form partial with a trailing success toast; on
  //        validation failure re-render with error + submittedValue preserved.
  //
  // Permissions: admin.system OR admin.org of the same org (tenant isolation
  // mirrors the /branding-mode handler above).

  server.get(
    '/admin/organizations/:id/settings',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const org = await storage.organizations.getOrg(id);
      if (org === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Organization not found.', 'error'));
      }

      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && request.user?.currentOrgId !== id) {
        return reply.code(403).header('content-type', 'text/html')
          .send(toastHtml('Forbidden: you can only manage your own organization.', 'error'));
      }

      return reply.view('admin/organization-settings.hbs', { org });
    },
  );

  server.post(
    '/admin/organizations/:id/settings',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { agent_display_name?: unknown } | undefined) ?? {};

      const org = await storage.organizations.getOrg(id);
      if (org === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Organization not found.', 'error'));
      }

      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && request.user?.currentOrgId !== id) {
        return reply.code(403).header('content-type', 'text/html')
          .send(toastHtml('Forbidden: you can only manage your own organization.', 'error'));
      }

      const locale = resolveLocale(request);
      const rawValue = typeof body.agent_display_name === 'string' ? body.agent_display_name : '';
      const parsed = validateAgentDisplayName(rawValue);

      if (!parsed.success) {
        // Map the first Zod issue message to a user-friendly i18n key. The
        // schema emits one of two codes: TOO_LONG (max length) or HTML_OR_URL
        // (regex refinement). Anything else falls back to a generic error.
        const firstIssueMessage = parsed.error.issues[0]?.message ?? 'HTML_OR_URL';
        const errorKey =
          firstIssueMessage === 'TOO_LONG'
            ? 'admin.organizations.settings.agentDisplayNameTooLong'
            : 'admin.organizations.settings.agentDisplayNameHtml';
        const errorText = t(errorKey, locale);

        return reply.code(400).view('admin/organization-settings.hbs', {
          org,
          error: errorText,
          submittedValue: rawValue,
        });
      }

      const normalizedValue = parsed.data.agent_display_name;

      try {
        await storage.organizations.updateOrgAgentDisplayName(id, normalizedValue);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update display name';
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(toastHtml(message, 'error'));
      }

      // Re-read the org so the re-rendered form reflects the persisted value.
      const updatedOrg = await storage.organizations.getOrg(id);
      const successText = t('admin.organizations.settings.agentDisplayNameSaved', locale);

      // Plan 32.1-04: fire an HTMX trigger so the chat drawer's display-name
      // span updates without a full page reload. agent.js listens on
      // htmx:afterOnLoad for `agent-display-name-updated`.
      const newDisplayName =
        normalizedValue.length > 0 ? normalizedValue : 'Luqen Assistant';
      void reply.header(
        'HX-Trigger',
        JSON.stringify({ 'agent-display-name-updated': { name: newDisplayName } }),
      );

      return reply.view('admin/organization-settings.hbs', {
        org: updatedOrg ?? org,
        trailingToast: toastHtml(successText, 'success'),
      });
    },
  );
}
