import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import type { StorageAdapter } from '../../db/adapter.js';
import { requirePermission } from '../../auth/middleware.js';
import { toastHtml, escapeHtml } from './helpers.js';
import { retagScansForSite, retagAllSitesForGuideline } from '../../services/branding-retag.js';
import type { LLMClient } from '../../llm-client.js';

const pump = promisify(pipeline);

export async function brandingGuidelineRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  /** Getter for current LLM client (runtime reload support). */
  getLLMClient: () => LLMClient | null,
  uploadsDir?: string,
): Promise<void> {
  // ── Template downloads ───────────────────────────────────────────────────
  // (registered before :id routes to avoid parameter capture)

  server.get(
    '/admin/branding-guidelines/templates/csv',
    { preHandler: requirePermission('branding.view') },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const { GuidelineParser } = await import('@luqen/branding');
      const csv = GuidelineParser.generateCSVTemplate();
      return reply
        .header('content-type', 'text/csv')
        .header('content-disposition', 'attachment; filename="branding-template.csv"')
        .send(csv);
    },
  );

  server.get(
    '/admin/branding-guidelines/templates/json',
    { preHandler: requirePermission('branding.view') },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const { GuidelineParser } = await import('@luqen/branding');
      const json = GuidelineParser.generateJSONTemplate();
      return reply
        .header('content-type', 'application/json')
        .header('content-disposition', 'attachment; filename="branding-template.json"')
        .send(json);
    },
  );

  // ── Template upload ──────────────────────────────────────────────────────

  server.post(
    '/admin/branding-guidelines/upload',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        content?: string;
        format?: 'csv' | 'json';
        name?: string;
      };

      const content = body.content?.trim();
      const format = body.format?.trim();
      const nameOverride = body.name?.trim();

      if (!content || !format) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Content and format are required.', 'error'));
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      const { GuidelineParser } = await import('@luqen/branding');
      const parser = new GuidelineParser();

      try {
        let parsedName = nameOverride ?? 'Imported Guideline';
        let parsedDescription: string | undefined;
        let colors: ReadonlyArray<{ name: string; hex: string; usage?: string; context?: string }> = [];
        let fonts: ReadonlyArray<{ family: string; weights?: readonly string[]; usage?: string; context?: string }> = [];
        let selectors: ReadonlyArray<{ pattern: string; description?: string }> = [];

        if (format === 'csv') {
          const result = await parser.parseCSV(content);
          colors = result.colors;
          fonts = result.fonts;
          selectors = result.selectors;
        } else {
          const result = await parser.parseJSON(content);
          parsedName = nameOverride ?? result.name;
          parsedDescription = result.description;
          colors = result.colors;
          fonts = result.fonts;
          selectors = result.selectors;
        }

        const guidelineId = randomUUID();
        const guideline = await storage.branding.createGuideline({
          id: guidelineId,
          orgId,
          name: parsedName,
          description: parsedDescription,
          createdBy: request.user?.id,
        });

        for (const c of colors) {
          await storage.branding.addColor(guidelineId, {
            id: randomUUID(),
            name: c.name,
            hexValue: c.hex,
            usage: c.usage,
            context: c.context,
          });
        }

        for (const f of fonts) {
          await storage.branding.addFont(guidelineId, {
            id: randomUUID(),
            family: f.family,
            weights: f.weights as string[] | undefined,
            usage: f.usage,
            context: f.context,
          });
        }

        for (const s of selectors) {
          await storage.branding.addSelector(guidelineId, {
            id: randomUUID(),
            pattern: s.pattern,
            description: s.description,
          });
        }

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml(`Guideline "${escapeHtml(guideline.name)}" imported successfully.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to parse file';
        return reply.code(400).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // ── Create form (modal) ──────────────────────────────────────────────────

  server.get(
    '/admin/branding-guidelines/new',
    { preHandler: requirePermission('branding.manage') },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('admin/branding-guideline-form.hbs', {});
    },
  );

  // ── List page ────────────────────────────────────────────────────────────

  server.get(
    '/admin/branding-guidelines',
    { preHandler: requirePermission('branding.view') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId ?? 'system';
      const isGlobalAdmin = request.user?.role === 'admin';

      // Tab selection — URL-driven, no client state. (08-P03)
      const rawTab = (request.query as { tab?: unknown } | undefined)?.tab;
      const tab: 'mine' | 'system' = rawTab === 'system' ? 'system' : 'mine';
      const systemLibraryActive = tab === 'system';

      // Global admin sees all guidelines across orgs; org users see their own
      const guidelines = isGlobalAdmin
        ? await storage.branding.listAllGuidelines()
        : await storage.branding.listGuidelines(orgId);

      // Resolve org names for display
      const allOrgs = isGlobalAdmin ? await storage.organizations.listOrgs() : [];
      const orgNameMap = new Map(allOrgs.map((o: { id: string; name: string }) => [o.id, o.name]));

      const enriched = guidelines.map((g) => ({
        ...g,
        orgDisplayName: isGlobalAdmin
          ? (orgNameMap.get(g.orgId) ?? g.orgId)
          : undefined,
      }));

      // Always fetch system guidelines for the tab counter badge;
      // enrich with site assignments so the row template can show them.
      const systemGuidelinesRaw = await storage.branding.listSystemGuidelines();
      const systemGuidelines = await Promise.all(
        systemGuidelinesRaw.map(async (g) => ({
          ...g,
          sites: await storage.branding.getSiteAssignments(g.id),
        })),
      );

      return reply.view('admin/branding-guidelines.hbs', {
        pageTitle: 'Branding Guidelines',
        currentPath: '/admin/branding-guidelines',
        user: request.user,
        guidelines: enriched,
        isGlobalAdmin,
        tab,
        systemLibraryActive,
        systemGuidelines,
      });
    },
  );

  // ── Clone system guideline into org ─────────────────────────────────────
  // (08-P03) SYS-03: POST /admin/branding-guidelines/system/:id/clone
  // Creates an org-owned independent copy of a system-scoped guideline and
  // HX-Redirects to the clone's edit page so the user can rename it.

  server.post(
    '/admin/branding-guidelines/system/:id/clone',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string } | undefined;
      const orgId = request.user?.currentOrgId ?? 'system';
      const cloneName = body?.name?.trim() || undefined;

      // Guard: source must exist and be system-scoped. An org-owned row
      // must never be clonable through this endpoint.
      const source = await storage.branding.getGuideline(id);
      if (source === null || source.orgId !== 'system') {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('System guideline not found.', 'error'));
      }

      try {
        const clone = await storage.branding.cloneSystemGuideline(id, orgId, cloneName ? { name: cloneName } : undefined);
        return reply
          .header('HX-Redirect', `/admin/branding-guidelines/${clone.id}`)
          .code(204)
          .send();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to clone system guideline';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // ── Create ───────────────────────────────────────────────────────────────

  server.post(
    '/admin/branding-guidelines',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { name?: string; description?: string };
      const name = body.name?.trim();
      const description = body.description?.trim();

      if (!name) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Name is required.', 'error'));
      }

      const orgId = request.user?.currentOrgId ?? 'system';

      try {
        const guideline = await storage.branding.createGuideline({
          id: randomUUID(),
          orgId,
          name,
          description,
          createdBy: request.user?.id,
        });

        return reply
          .code(200)
          .header('HX-Redirect', `/admin/branding-guidelines/${guideline.id}`)
          .header('content-type', 'text/html')
          .send(toastHtml(`Guideline "${escapeHtml(guideline.name)}" created.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create guideline';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // ── Detail page ──────────────────────────────────────────────────────────

  server.get(
    '/admin/branding-guidelines/:id',
    { preHandler: requirePermission('branding.view') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const llmClient = getLLMClient();
      const { id } = request.params as { id: string };

      const guideline = await storage.branding.getGuideline(id);
      if (guideline === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Guideline not found.', 'error'));
      }

      const [colors, fonts, selectors, sites] = await Promise.all([
        storage.branding.listColors(id),
        storage.branding.listFonts(id),
        storage.branding.listSelectors(id),
        storage.branding.getSiteAssignments(id),
      ]);

      return reply.view('admin/branding-guideline-detail.hbs', {
        pageTitle: `Branding — ${guideline.name}`,
        currentPath: '/admin/branding-guidelines',
        user: request.user,
        guideline,
        colors,
        fonts,
        selectors,
        sites: sites.map((url) => ({ siteUrl: url })),
        llmEnabled: llmClient !== null,
      });
    },
  );

  // ── Update name/description (detail page) ────────────────────────────────

  server.post(
    '/admin/branding-guidelines/:id',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { name?: unknown; description?: unknown };

      const update: { name?: string; description?: string } = {};
      if (typeof body.name === 'string' && body.name.trim() !== '') {
        update.name = body.name.trim();
      }
      if (typeof body.description === 'string') {
        update.description = body.description.trim();
      }

      if (update.name === undefined && update.description === undefined) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Nothing to update.', 'error'));
      }

      const guideline = await storage.branding.getGuideline(id);
      if (guideline === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Guideline not found.', 'error'));
      }

      await storage.branding.updateGuideline(id, update);
      return reply
        .header('HX-Redirect', `/admin/branding-guidelines/${id}`)
        .code(204)
        .send();
    },
  );

  // ── Toggle active (list page) ────────────────────────────────────────────

  server.post(
    '/admin/branding-guidelines/:id/toggle-active',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const guideline = await storage.branding.getGuideline(id);
      if (guideline === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Guideline not found.', 'error'));
      }

      try {
        const updated = await storage.branding.updateGuideline(id, { active: !guideline.active });
        const status = updated.active ? 'activated' : 'deactivated';
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .header('HX-Redirect', '/admin/branding-guidelines')
          .send(toastHtml(`Guideline "${escapeHtml(updated.name)}" ${status}.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to toggle guideline';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // ── Delete ───────────────────────────────────────────────────────────────

  server.post(
    '/admin/branding-guidelines/:id/delete',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const guideline = await storage.branding.getGuideline(id);
      if (guideline === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Guideline not found.', 'error'));
      }

      try {
        await storage.branding.deleteGuideline(id);
        const isHtmx = request.headers['hx-request'] === 'true';
        if (isHtmx) {
          return reply
            .code(200)
            .header('content-type', 'text/html')
            .header('HX-Redirect', '/admin/branding-guidelines')
            .send(toastHtml(`Guideline "${escapeHtml(guideline.name)}" deleted.`));
        }
        return reply.redirect('/admin/branding-guidelines');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete guideline';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // ── Toggle active ────────────────────────────────────────────────────────

  server.post(
    '/admin/branding-guidelines/:id/toggle',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const guideline = await storage.branding.getGuideline(id);
      if (guideline === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Guideline not found.', 'error'));
      }

      try {
        const updated = await storage.branding.updateGuideline(id, { active: !guideline.active });
        const status = updated.active ? 'activated' : 'deactivated';

        // Retag assigned sites when activating
        let retagCount = 0;
        if (updated.active) {
          const orgId = request.user?.currentOrgId ?? 'system';
          try {
            const { totalRetagged } = await retagAllSitesForGuideline(storage, id, orgId);
            retagCount = totalRetagged;
          } catch { /* non-fatal */ }
        }

        const csrfToken = typeof reply.generateCsrf === 'function' ? reply.generateCsrf() : '';

        // Return the updated status area partial for HTMX swap
        const badgeClass = updated.active ? 'badge--success' : 'badge--neutral';
        const badgeText = updated.active ? 'Active' : 'Inactive';
        const toggleText = updated.active ? 'Deactivate' : 'Activate';

        const html = `<div id="branding-status-area" class="flex flex-wrap items-center gap-sm mt-sm">
  <span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span>
  <button hx-post="/admin/branding-guidelines/${escapeHtml(id)}/toggle"
          hx-target="#branding-status-area"
          hx-swap="outerHTML"
          class="btn btn--sm btn--ghost">
    <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
    ${escapeHtml(toggleText)}
  </button>
  <button hx-post="/admin/branding-guidelines/${escapeHtml(id)}/delete"
          hx-confirm="Delete guideline &quot;${escapeHtml(updated.name)}&quot;? This cannot be undone."
          class="btn btn--sm btn--danger">
    <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
    Delete
  </button>
</div>
${toastHtml(`Guideline "${escapeHtml(updated.name)}" ${status}.${retagCount > 0 ? ` ${retagCount} scan(s) retagged.` : ''}`)}`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(html);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to toggle guideline';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // ── Discover Branding ────────────────────────────────────────────────────

  server.post(
    '/admin/branding-guidelines/:id/discover-branding',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const llmClient = getLLMClient();
      const { id } = request.params as { id: string };

      const guideline = await storage.branding.getGuideline(id);
      if (guideline === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Guideline not found.', 'error'));
      }

      if (llmClient === null) {
        return reply
          .code(503)
          .header('content-type', 'text/html')
          .send(toastHtml('LLM service is not configured.', 'error'));
      }

      const body = request.body as { url?: string };
      const url = body.url?.trim();

      if (!url || !/^https?:\/\//i.test(url)) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('A valid URL starting with http:// or https:// is required.', 'error'));
      }

      try {
        const result = await llmClient.discoverBranding({ url, orgId: guideline.orgId });

        if (result.colors.length === 0 && result.fonts.length === 0 && !result.logoUrl) {
          return reply
            .code(200)
            .header('content-type', 'text/html')
            .send(toastHtml('No brand signals detected — try a different URL.'));
        }

        const discoveryContext = `Discovered from ${url}`;
        for (const color of result.colors) {
          await storage.branding.addColor(id, {
            id: randomUUID(),
            name: color.name,
            hexValue: color.hex,
            usage: color.usage,
            context: discoveryContext,
          });
        }

        for (const font of result.fonts) {
          await storage.branding.addFont(id, {
            id: randomUUID(),
            family: font.family,
            usage: font.usage,
            context: discoveryContext,
          });
        }

        // Update the guideline description if the LLM extracted one
        if (result.description && result.description.trim().length > 0) {
          try {
            await storage.branding.updateGuideline(id, { description: result.description.trim() });
          } catch {
            // non-fatal
          }
        }

        // Download and save the logo if one was detected
        let logoSaved = false;
        if (result.logoUrl && /^https?:\/\//i.test(result.logoUrl)) {
          try {
            const logoResponse = await fetch(result.logoUrl);
            if (logoResponse.ok) {
              const contentType = logoResponse.headers.get('content-type') ?? '';
              if (contentType.startsWith('image/')) {
                const buffer = Buffer.from(await logoResponse.arrayBuffer());
                const urlPath = new URL(result.logoUrl).pathname;
                const rawExt = urlPath.split('.').pop() ?? 'png';
                const ext = rawExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 5) || 'png';
                const slug = guideline.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                const filename = `${slug}-${id}.${ext}`;
                const dir = join(uploadsDir ?? './uploads', guideline.orgId, 'branding-images');
                await mkdir(dir, { recursive: true });
                await writeFile(join(dir, filename), buffer);
                const imagePath = `/uploads/${guideline.orgId}/branding-images/${filename}`;
                await storage.branding.updateGuideline(id, { imagePath });
                logoSaved = true;
              }
            }
          } catch {
            // non-fatal — logo download failure shouldn't block the whole flow
          }
        }

        const parts: string[] = [];
        if (result.colors.length > 0) parts.push(`${result.colors.length} color(s)`);
        if (result.fonts.length > 0) parts.push(`${result.fonts.length} font(s)`);
        if (logoSaved) parts.push('logo');
        const summary = parts.join(', ');

        // Retag assigned sites after discover enriched the guideline
        if (result.colors.length > 0 || result.fonts.length > 0) {
          try {
            await retagAllSitesForGuideline(storage, id, guideline.orgId);
          } catch { /* non-fatal */ }
        }

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .header('HX-Refresh', 'true')
          .send(toastHtml(`Brand discovery complete. Discovered ${summary}. Note: AI-generated results — please validate.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Brand discovery failed';
        return reply.code(502).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // ── Color CRUD ───────────────────────────────────────────────────────────

  server.post(
    '/admin/branding-guidelines/:id/colors',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        hexValue?: string;
        usage?: string;
        context?: string;
      };

      const name = body.name?.trim();
      const hexValue = body.hexValue?.trim();

      if (!name || !hexValue) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Color name and hex value are required.', 'error'));
      }

      if (!/^#[0-9a-fA-F]{3,8}$/.test(hexValue)) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Invalid hex color value.', 'error'));
      }

      try {
        await storage.branding.addColor(id, {
          id: randomUUID(),
          name,
          hexValue,
          usage: body.usage?.trim(),
          context: body.context?.trim(),
        });

        // Retag assigned sites after modifying guideline
        const orgId = request.user?.currentOrgId ?? 'system';
        try {
          await retagAllSitesForGuideline(storage, id, orgId);
        } catch { /* non-fatal */ }

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml(`Color "${escapeHtml(name)}" added.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add color';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  server.post(
    '/admin/branding-guidelines/:id/colors/:colorId/delete',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, colorId } = request.params as { id: string; colorId: string };

      try {
        await storage.branding.removeColor(colorId);

        // Retag assigned sites after modifying guideline
        const orgId = request.user?.currentOrgId ?? 'system';
        try {
          await retagAllSitesForGuideline(storage, id, orgId);
        } catch { /* non-fatal */ }

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Color removed.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove color';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // ── Font CRUD ────────────────────────────────────────────────────────────

  server.post(
    '/admin/branding-guidelines/:id/fonts',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        family?: string;
        weights?: string;
        usage?: string;
        context?: string;
      };

      const family = body.family?.trim();

      if (!family) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Font family is required.', 'error'));
      }

      const weights = body.weights
        ? body.weights.split(',').map((w) => w.trim()).filter(Boolean)
        : undefined;

      try {
        await storage.branding.addFont(id, {
          id: randomUUID(),
          family,
          weights,
          usage: body.usage?.trim(),
          context: body.context?.trim(),
        });

        // Retag assigned sites after modifying guideline
        const orgId = request.user?.currentOrgId ?? 'system';
        try {
          await retagAllSitesForGuideline(storage, id, orgId);
        } catch { /* non-fatal */ }

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml(`Font "${escapeHtml(family)}" added.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add font';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  server.post(
    '/admin/branding-guidelines/:id/fonts/:fontId/delete',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, fontId } = request.params as { id: string; fontId: string };

      try {
        await storage.branding.removeFont(fontId);

        // Retag assigned sites after modifying guideline
        const orgId = request.user?.currentOrgId ?? 'system';
        try {
          await retagAllSitesForGuideline(storage, id, orgId);
        } catch { /* non-fatal */ }

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Font removed.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove font';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // ── Selector CRUD ────────────────────────────────────────────────────────

  server.post(
    '/admin/branding-guidelines/:id/selectors',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { pattern?: string; description?: string };

      const pattern = body.pattern?.trim();

      if (!pattern) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Selector pattern is required.', 'error'));
      }

      try {
        await storage.branding.addSelector(id, {
          id: randomUUID(),
          pattern,
          description: body.description?.trim(),
        });

        // Retag assigned sites after modifying guideline
        const orgId = request.user?.currentOrgId ?? 'system';
        try {
          await retagAllSitesForGuideline(storage, id, orgId);
        } catch { /* non-fatal */ }

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml(`Selector "${escapeHtml(pattern)}" added.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add selector';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  server.post(
    '/admin/branding-guidelines/:id/selectors/:selectorId/delete',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, selectorId } = request.params as { id: string; selectorId: string };

      try {
        await storage.branding.removeSelector(selectorId);

        // Retag assigned sites after modifying guideline
        const orgId = request.user?.currentOrgId ?? 'system';
        try {
          await retagAllSitesForGuideline(storage, id, orgId);
        } catch { /* non-fatal */ }

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Selector removed.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove selector';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // ── Site assignment ──────────────────────────────────────────────────────

  server.post(
    '/admin/branding-guidelines/:id/sites',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { siteUrl?: string };
      const siteUrl = body.siteUrl?.trim();

      if (!siteUrl) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Site URL is required.', 'error'));
      }

      const orgId = request.user?.currentOrgId ?? 'system';

      try {
        await storage.branding.assignToSite(id, siteUrl, orgId);

        // Retag existing completed scans for this site
        let retagCount = 0;
        try {
          const { retagged } = await retagScansForSite(storage, siteUrl, orgId);
          retagCount = retagged;
        } catch { /* non-fatal */ }

        const fromSystemLibrary = (request.query as { from?: string })?.from === 'system-library';
        const retagMsg = retagCount > 0 ? ` ${retagCount} existing scan(s) retagged.` : '';
        if (fromSystemLibrary) {
          return reply
            .header('HX-Redirect', '/admin/branding-guidelines?tab=system')
            .code(204)
            .send();
        }
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml(`Site "${escapeHtml(siteUrl)}" assigned.${retagMsg}`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to assign site';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  server.post(
    '/admin/branding-guidelines/:id/sites/unassign',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { siteUrl?: string };
      const siteUrl = body.siteUrl?.trim();

      if (!siteUrl) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Site URL is required.', 'error'));
      }

      const orgId = request.user?.currentOrgId ?? 'system';

      try {
        await storage.branding.unassignFromSite(siteUrl, orgId);
        const fromSystemLibrary = (request.query as { from?: string })?.from === 'system-library';
        if (fromSystemLibrary) {
          return reply
            .header('HX-Redirect', '/admin/branding-guidelines?tab=system')
            .code(204)
            .send();
        }
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml(`Site "${escapeHtml(siteUrl)}" unassigned.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to unassign site';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // ── Image upload ─────────────────────────────────────────────────────────

  server.post(
    '/admin/branding-guidelines/:id/image',
    { preHandler: requirePermission('branding.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const guideline = await storage.branding.getGuideline(id);
      if (guideline === null) {
        return reply.code(404).header('content-type', 'text/html').send(toastHtml('Guideline not found.', 'error'));
      }

      const data = await request.file();
      if (data === undefined) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('No file uploaded.', 'error'));
      }

      if (!data.mimetype.startsWith('image/')) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Only image files are allowed.', 'error'));
      }

      const rawExt = data.filename.split('.').pop() ?? 'png';
      const ext = rawExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'png';
      const slug = guideline.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const filename = `${slug}-${id}.${ext}`;
      const orgId = guideline.orgId;
      const dir = join(uploadsDir ?? './uploads', orgId, 'branding-images');

      try {
        await mkdir(dir, { recursive: true });
        const filepath = join(dir, filename);
        const writeStream = createWriteStream(filepath);
        await pump(data.file, writeStream);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save image';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }

      const imagePath = `/uploads/${orgId}/branding-images/${filename}`;

      try {
        await storage.branding.updateGuideline(id, { imagePath });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update guideline';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }

      const cacheBust = Date.now();
      const imageHtml = `<div id="brand-image-area">
  <img src="${imagePath}?v=${cacheBust}" alt="${escapeHtml(guideline.name)} brand logo" width="64" height="64" style="width:64px;height:64px;max-width:64px;max-height:64px;border-radius:var(--radius-md);object-fit:contain;background:var(--bg-secondary);">
  ${toastHtml('Brand image uploaded.')}
</div>`;

      return reply.code(200).header('content-type', 'text/html').send(imageHtml);
    },
  );
}
