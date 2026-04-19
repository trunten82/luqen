import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listClients,
  createClient,
  revokeClient,
} from '../../compliance-client.js';
import {
  listBrandingClients,
  createBrandingClient,
  revokeBrandingClient,
} from '../../branding-client.js';
import type { LLMClient } from '../../llm-client.js';
import type { StorageAdapter } from '../../db/index.js';
import type { ServiceTokenManager } from '../../auth/service-token.js';
import { requirePermission } from '../../auth/middleware.js';
import { getToken, getOrgId, toastHtml, escapeHtml } from './helpers.js';

export async function clientRoutes(
  server: FastifyInstance,
  baseUrl: string,
  storage?: StorageAdapter,
  brandingUrl?: string,
  /** Getter for current branding token manager (runtime reload support). */
  getBrandingTokenManager: () => ServiceTokenManager | null = () => null,
  /** Getter for current LLM client (runtime reload support). */
  getLLMClient: () => LLMClient | null = () => null,
): Promise<void> {
  // GET /admin/clients — list OAuth clients
  // Phase 31.2 D-19: admin.system sees all DCR rows; admin.org sees only
  // own-org rows (via findByOrg); regular users are blocked. `compliance.view`
  // (too permissive, granted to many roles) is removed.
  server.get(
    '/admin/clients',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const brandingTokenManager = getBrandingTokenManager();
      const llmClient = getLLMClient();
      let complianceClients: Awaited<ReturnType<typeof listClients>> = [];
      let brandingClients: Awaited<ReturnType<typeof listBrandingClients>> = [];
      let error: string | undefined;

      const token = getToken(request);
      const orgId = getOrgId(request);

      try {
        complianceClients = await listClients(baseUrl, token, orgId);
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to load compliance OAuth clients';
      }

      if (brandingUrl != null && brandingTokenManager != null) {
        try {
          const brandingToken = await brandingTokenManager.getToken();
          brandingClients = await listBrandingClients(brandingUrl, brandingToken, orgId);
        } catch {
          // Non-fatal — branding service may be unavailable
        }
      }

      let llmClients: Array<{ id: string; name: string; scopes: string[]; grantTypes: string[]; orgId: string; createdAt: string }> = [];
      if (llmClient != null) {
        try {
          llmClients = await llmClient.listOAuthClients();
        } catch { /* non-fatal */ }
      }

      const currentOrgId = orgId ?? 'system';
      const isGlobalAdmin = request.user?.role === 'admin' && (currentOrgId === 'system' || !currentOrgId);

      // Phase 31.1 Plan 04 Task 2: Dynamic-Client-Registered (DCR) OAuth
      // clients from oauth_clients_v2 (Plan 01). Admins see every DCR
      // client; non-admins see only the ones they personally registered
      // (registered_by_user_id == request.user.id). Per D-15, unlimited
      // parallel active clients per user — admin has a revoke button
      // per DCR client to kill rogue registrations quickly
      // (T-31.1-04-05 mitigation).
      let dcrClients: Array<{
        service: string;
        id: string;
        name: string;
        clientId: string;
        orgId: string;
        createdAtDisplay: string;
        scopesDisplay: string;
        grantTypesDisplay: string;
        isSystem: boolean;
        orgDisplayName: string;
        canRevoke: boolean;
        revokedAtDisplay: string | null;
        kind: 'DCR';
      }> = [];
      if (storage != null) {
        // Phase 31.2 D-19: admin.system sees all; admin.org sees own-org only.
        // Rows with registered_by_user_id IS NULL are admin.system-only
        // (pre-D-18 orphans).
        const allDcr = isGlobalAdmin
          ? await storage.oauthClients.listAll()
          : await storage.oauthClients.findByOrg(currentOrgId);

        dcrClients = await Promise.all(allDcr.map(async (c) => {
          // D-24: resolve Org column display. findByOrg rows already carry
          // registrantOrgName via the JOIN; listAll rows don't — fall back
          // to getUserOrgs lookup, then '—' for NULL-registrant orphans.
          let orgDisplay: string;
          if (c.registrantOrgName !== undefined) {
            orgDisplay = c.registrantOrgName;
          } else if (c.registeredByUserId !== null) {
            const orgs = await storage.organizations.getUserOrgs(c.registeredByUserId);
            orgDisplay = orgs[0]?.name ?? '—';
          } else {
            orgDisplay = '—';
          }
          return {
            service: 'Dashboard (DCR)',
            id: c.id,
            name: c.clientName,
            clientId: c.clientId,
            orgId: c.registeredByUserId ?? 'system',
            createdAtDisplay: new Date(c.createdAt).toLocaleString(),
            scopesDisplay: c.scope,
            grantTypesDisplay: c.grantTypes.join(', '),
            isSystem: false,
            orgDisplayName: orgDisplay,
            canRevoke: c.revokedAt === null && (isGlobalAdmin || c.registeredByUserId !== null),
            revokedAtDisplay: c.revokedAt !== null ? new Date(c.revokedAt).toLocaleString() : null,
            kind: 'DCR' as const,
          };
        }));
      }

      // Resolve org names for display
      const allOrgs = storage ? await storage.organizations.listOrgs() : [];
      const orgNameMap = new Map(allOrgs.map((o: { id: string; name: string }) => [o.id, o.name]));

      const complianceFormatted = complianceClients.map((c) => ({
        ...c,
        service: 'Compliance',
        createdAtDisplay: new Date(c.createdAt).toLocaleString(),
        scopesDisplay: c.scopes.join(', '),
        grantTypesDisplay: c.grantTypes.join(', '),
        isSystem: c.orgId === 'system',
        orgDisplayName: c.orgId === 'system' ? 'System' : (orgNameMap.get(c.orgId) ?? c.orgId),
        canRevoke: isGlobalAdmin || (c.orgId !== 'system' && c.orgId === currentOrgId),
        kind: 'Admin' as const,
      }));

      const brandingFormatted = brandingClients.map((c) => ({
        ...c,
        clientId: c.id,
        service: 'Branding',
        createdAtDisplay: new Date(c.createdAt).toLocaleString(),
        scopesDisplay: c.scopes.join(', '),
        grantTypesDisplay: c.grantTypes.join(', '),
        isSystem: c.orgId === 'system',
        orgDisplayName: c.orgId === 'system' ? 'System' : (orgNameMap.get(c.orgId) ?? c.orgId),
        canRevoke: isGlobalAdmin || (c.orgId !== 'system' && c.orgId === currentOrgId),
        kind: 'Admin' as const,
      }));

      const llmFormatted = llmClients.map((c) => ({
        ...c,
        clientId: c.id,
        service: 'LLM',
        createdAtDisplay: new Date(c.createdAt).toLocaleString(),
        scopesDisplay: Array.isArray(c.scopes) ? c.scopes.join(', ') : String(c.scopes),
        grantTypesDisplay: Array.isArray(c.grantTypes) ? c.grantTypes.join(', ') : String(c.grantTypes),
        isSystem: c.orgId === 'system',
        orgDisplayName: c.orgId === 'system' ? 'System' : (orgNameMap.get(c.orgId) ?? c.orgId),
        canRevoke: isGlobalAdmin || (c.orgId !== 'system' && c.orgId === currentOrgId),
        kind: 'Admin' as const,
      }));

      const formatted = [
        ...complianceFormatted,
        ...brandingFormatted,
        ...llmFormatted,
        ...dcrClients,
      ];

      return reply.view('admin/clients.hbs', {
        pageTitle: 'OAuth Clients',
        currentPath: '/admin/clients',
        user: request.user,
        clients: formatted,
        isGlobalAdmin,
        // Phase 31.2 D-24: Org column is shown to admin.system only
        // (admin.org viewers are implicitly org-scoped, so redundant).
        showOrgColumn: isGlobalAdmin,
        hasBranding: brandingUrl != null,
        hasLlm: llmClient != null,
        error,
      });
    },
  );

  // GET /admin/clients/new — modal form fragment
  server.get(
    '/admin/clients/new',
    { preHandler: requirePermission('admin.system', 'compliance.view') },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const llmClient = getLLMClient();
      return reply.view('admin/client-form.hbs', {
        isNew: true,
        formClient: { name: '', scopes: '', grantTypes: 'client_credentials', service: 'compliance' },
        availableGrantTypes: ['client_credentials', 'password', 'authorization_code', 'refresh_token'],
        availableServices: [
          { value: 'compliance', label: 'Compliance' },
          ...(brandingUrl != null ? [{ value: 'branding', label: 'Branding' }] : []),
          ...(llmClient != null ? [{ value: 'llm', label: 'LLM' }] : []),
        ],
      });
    },
  );

  // POST /admin/clients — create OAuth client
  server.post(
    '/admin/clients',
    { preHandler: requirePermission('admin.system', 'compliance.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const brandingTokenManager = getBrandingTokenManager();
      const llmClient = getLLMClient();
      const body = request.body as {
        name?: string;
        scopes?: string;
        grantTypes?: string | string[];
        service?: string;
      };

      if (!body.name?.trim()) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Client name is required.', 'error'));
      }

      const scopes = (body.scopes ?? '')
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const grantTypes = Array.isArray(body.grantTypes)
        ? body.grantTypes
        : body.grantTypes !== undefined
        ? [body.grantTypes]
        : ['client_credentials'];

      const service = body.service === 'branding' ? 'branding' : body.service === 'llm' ? 'llm' : 'compliance';

      try {
        let createdClientId: string;
        let createdSecret: string;
        let createdName: string;
        let createdAt: string;

        if (service === 'llm' && llmClient != null) {
          const created = await llmClient.createOAuthClient(
            body.name.trim(), scopes, grantTypes, getOrgId(request),
          );
          createdClientId = created.id ?? created.clientId;
          createdSecret = created.clientSecret;
          createdName = created.name ?? body.name.trim();
          createdAt = created.createdAt ?? new Date().toISOString();
        } else if (service === 'branding' && brandingUrl != null && brandingTokenManager != null) {
          const brandingToken = await brandingTokenManager.getToken();
          const created = await createBrandingClient(
            brandingUrl, brandingToken, body.name.trim(), scopes, grantTypes, getOrgId(request),
          );
          createdClientId = created.id;
          createdSecret = created.secret;
          createdName = created.name;
          createdAt = created.createdAt;
        } else {
          const created = await createClient(baseUrl, getToken(request), {
            name: body.name.trim(),
            scopes,
            grantTypes,
          }, getOrgId(request));
          createdClientId = created.clientId;
          createdSecret = created.secret;
          createdName = created.name;
          createdAt = created.createdAt;
        }

        const serviceLabel = service === 'llm' ? 'LLM' : service === 'branding' ? 'Branding' : 'Compliance';

        // Secret is shown once in a modal dialog; no inline JS handlers needed
        const secretModal = `<div id="modal-container" hx-swap-oob="true">
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="secret-modal-title">
    <div class="modal">
      <h2 id="secret-modal-title">Client Secret — Copy Now</h2>
      <p class="text--warning">This secret will only be shown once. Copy it now and store it securely.</p>
      <div class="secret-box">
        <code id="client-secret-display">${escapeHtml(createdSecret)}</code>
      </div>
      <p><strong>Client ID:</strong> <code>${escapeHtml(createdClientId)}</code></p>
      <p><strong>Name:</strong> ${escapeHtml(createdName)}</p>
      <p><strong>Service:</strong> ${escapeHtml(serviceLabel)}</p>
      <button class="btn btn--primary close-modal-btn" aria-label="Close — I have copied the secret">
        I have copied the secret
      </button>
    </div>
  </div>
</div>`;

        const revokeUrl = service === 'llm'
          ? `/admin/clients/${encodeURIComponent(createdClientId)}/revoke-llm`
          : service === 'branding'
          ? `/admin/clients/${encodeURIComponent(createdClientId)}/revoke-branding`
          : `/admin/clients/${encodeURIComponent(createdClientId)}/revoke`;

        const row = `<tr id="client-${escapeHtml(createdClientId || '')}">
  <td data-label="Name">${escapeHtml(createdName)}</td>
  <td data-label="Client ID"><code>${escapeHtml(createdClientId)}</code></td>
  <td data-label="Scopes">${escapeHtml(scopes.join(', '))}</td>
  <td data-label="Service"><span class="badge badge--neutral">${escapeHtml(serviceLabel)}</span></td>
  <td data-label="Created">${new Date(createdAt).toLocaleString()}</td>
  <td>
    <button hx-post="${revokeUrl}"
            hx-confirm="Revoke client ${escapeHtml(createdName)}? This cannot be undone."
            hx-target="closest tr"
            hx-swap="outerHTML swap:500ms"
            class="btn btn--sm btn--danger"
            aria-label="Revoke ${escapeHtml(createdName)}">Revoke</button>
  </td>
</tr>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${row}\n${secretModal}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create OAuth client';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/clients/:id/revoke — revoke compliance OAuth client
  server.post(
    '/admin/clients/:id/revoke',
    { preHandler: requirePermission('admin.system', 'compliance.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        await revokeClient(baseUrl, getToken(request), id);
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('OAuth client revoked successfully.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to revoke client';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/clients/:id/revoke-branding — revoke branding OAuth client
  server.post(
    '/admin/clients/:id/revoke-branding',
    { preHandler: requirePermission('admin.system', 'branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const brandingTokenManager = getBrandingTokenManager();
      const { id } = request.params as { id: string };

      if (brandingUrl == null || brandingTokenManager == null) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Branding service not configured.', 'error'));
      }

      try {
        const brandingToken = await brandingTokenManager.getToken();
        await revokeBrandingClient(brandingUrl, brandingToken, id);
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Branding OAuth client revoked successfully.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to revoke branding client';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/clients/dcr/:clientId/revoke — revoke DCR-registered OAuth client.
  // Phase 31.2 D-20/D-21: admin.system may revoke any DCR client; admin.org
  // may revoke only clients whose registrant is in their active org.
  // Rows with registered_by_user_id IS NULL are admin.system-only. Cross-org
  // attempts 403 and write `agent_audit_log` entry tool_name =
  // 'admin.clients.cross_org_revoke_attempt' for forensic tracking.
  server.post(
    '/admin/clients/dcr/:clientId/revoke',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { clientId } = request.params as { clientId: string };
      if (storage == null) {
        return reply
          .code(503)
          .header('content-type', 'text/html')
          .send(toastHtml('Storage adapter not available.', 'error'));
      }
      const client = await storage.oauthClients.findByClientId(clientId);
      if (client === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('DCR client not found.', 'error'));
      }

      const viewer = request.user;
      const viewerOrgId = getOrgId(request) ?? 'system';
      const isSystemAdmin = viewer?.role === 'admin';

      // Phase 31.2 D-20/D-21: admin.system revokes anything; admin.org
      // must be in the same org as the registrant. NULL-registrant rows
      // are admin.system-only (treated as cross-org for admin.org).
      let authorised = false;
      if (isSystemAdmin) {
        authorised = true;
      } else if (client.registeredByUserId !== null) {
        const orgClients = await storage.oauthClients.findByOrg(viewerOrgId);
        authorised = orgClients.some((c) => c.clientId === clientId);
      }

      if (!authorised) {
        // D-21: forensic log of cross-org revoke attempts (no de-dup).
        await storage.agentAudit.append({
          userId: viewer?.id ?? 'unknown',
          orgId: viewerOrgId,
          toolName: 'admin.clients.cross_org_revoke_attempt',
          argsJson: JSON.stringify({
            clientId,
            registeredByUserId: client.registeredByUserId,
          }),
          outcome: 'denied',
          outcomeDetail: `${clientId}:${viewer?.id ?? 'unknown'}:${viewerOrgId}:${client.registeredByUserId ?? 'null'}`,
          latencyMs: 0,
        });
        return reply
          .code(403)
          .header('content-type', 'text/html')
          .send(toastHtml('Forbidden — you can only revoke DCR clients registered in your org.', 'error'));
      }

      await storage.oauthClients.revoke(clientId);
      return reply.redirect(
        `/admin/clients?toast=${encodeURIComponent('DCR client revoked')}`,
        302,
      );
    },
  );

  // POST /admin/clients/:id/revoke-llm — revoke LLM OAuth client
  server.post(
    '/admin/clients/:id/revoke-llm',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const llmClient = getLLMClient();
      const { id } = request.params as { id: string };

      if (llmClient == null) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('LLM service not configured.', 'error'));
      }

      try {
        await llmClient.deleteOAuthClient(id);
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('LLM OAuth client revoked successfully.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to revoke LLM client';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}
