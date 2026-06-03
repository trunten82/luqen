/**
 * ACR wording-management admin routes.
 *
 *  - GET  /admin/acr-wording             per-locale wording editor (auth)
 *  - POST /admin/acr-wording             save one string override (auth, CSRF)
 *  - POST /admin/acr-wording/reset       reset one string to standard (auth, CSRF)
 *  - POST /admin/acr-wording/import      bulk-apply a JSON of {key:text} (auth, CSRF)
 *  - GET  /admin/acr-wording/export.json download the current strings as a template
 *
 * Every ACR string defaults to the localized STANDARD wording (app i18n). An
 * org may override any string per locale with custom or officially-translated
 * wording; overrides carry provenance (source) and translation metadata
 * (translatedBy/translatedAt/notes). Mirrors the report-identity admin pattern.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../db/adapter.js';
import { requirePermission } from '../auth/middleware.js';
import { HtmlPageSchema } from '../api/schemas/envelope.js';
import { t, SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from '../i18n/index.js';
import {
  ACR_WORDING_KEYS,
  resolveAcrStrings,
  type AcrWordingSource,
} from '../services/acr-wording.js';
import type { AcrWordingInput } from '../db/interfaces/acr-wording-repository.js';

const VALID_SOURCES: ReadonlySet<string> = new Set(['vpat-standard', 'translated-from-english', 'custom']);

function resolveLocale(value: string | undefined): Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value ?? '') ? (value as Locale) : 'en';
}

function orgOf(request: FastifyRequest): string {
  return (request.user as { currentOrgId?: string } | undefined)?.currentOrgId ?? 'system';
}

export async function acrWordingRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // ── Admin: view + edit per-locale wording ────────────────────────────────
  server.get(
    '/admin/acr-wording',
    { preHandler: requirePermission('admin.system', 'admin.org'), schema: { ...HtmlPageSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = orgOf(request);
      const query = request.query as { locale?: string; saved?: string; imported?: string };
      const locale = resolveLocale(query.locale);
      const supported = storage.acrWording !== undefined;

      const overrides = supported ? await storage.acrWording!.listForOrg(orgId, locale) : [];
      const resolved = resolveAcrStrings({ locale, t: t as never, overrides });
      const ovByKey = new Map(overrides.map((o) => [o.key, o]));

      const sourceLabelKey: Record<string, string> = {
        standard: 'acrWording.admin.sourceStandard',
        'vpat-standard': 'acrWording.admin.sourceVpat',
        'translated-from-english': 'acrWording.admin.sourceTranslated',
        custom: 'acrWording.admin.sourceCustom',
      };
      const rows = ACR_WORDING_KEYS.map((k) => {
        const r = resolved[k.key];
        const ov = ovByKey.get(k.key);
        return {
          key: k.key,
          text: r.text,
          standardText: t(k.i18nKey, locale),
          source: r.source,
          sourceLabelKey: sourceLabelKey[r.source] ?? 'acrWording.admin.sourceCustom',
          isCustom: r.source === 'custom',
          reviewed: r.reviewed,
          isOverride: ov !== undefined,
          translatedBy: ov?.translatedBy ?? '',
          translatedAt: ov?.translatedAt ?? '',
          notes: ov?.notes ?? '',
        };
      });
      const exportJson = JSON.stringify(
        Object.fromEntries(rows.map((r) => [r.key, r.text])),
        null,
        2,
      );

      return reply.view('admin/acr-wording.hbs', {
        user: request.user,
        currentPath: '/admin/acr-wording',
        supported,
        locale,
        locales: SUPPORTED_LOCALES.map((l) => ({ code: l, label: LOCALE_LABELS[l], active: l === locale })),
        rows,
        exportJson,
        anyUnreviewed: rows.some((r) => !r.reviewed),
        saved: query.saved === '1',
        imported: query.imported,
        csrfToken: (request as unknown as { csrfToken?: () => string }).csrfToken?.() ?? '',
      });
    },
  );

  // ── Admin: save one override ─────────────────────────────────────────────
  server.post(
    '/admin/acr-wording',
    { preHandler: requirePermission('admin.system', 'admin.org'), schema: { ...HtmlPageSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as Record<string, string | undefined>;
      const locale = resolveLocale(body.locale);
      if (storage.acrWording === undefined) return reply.redirect(`/admin/acr-wording?locale=${locale}`);

      const key = (body.key ?? '').trim();
      const known = ACR_WORDING_KEYS.some((k) => k.key === key);
      if (key && known && (body.text ?? '').trim() !== '') {
        const source: AcrWordingSource = VALID_SOURCES.has(body.source ?? '')
          ? (body.source as AcrWordingSource)
          : 'custom';
        const input: AcrWordingInput = {
          key,
          locale,
          text: body.text!.trim(),
          source,
          // A human edit is treated as reviewed; an explicit "needs review" box can unset it.
          reviewed: body.reviewed !== '0',
          translatedBy: (request.user as { id?: string } | undefined)?.id ?? null,
          translatedAt: new Date().toISOString().slice(0, 10),
          ...(body.notes?.trim() ? { notes: body.notes.trim() } : {}),
        };
        await storage.acrWording.upsert(orgOf(request), input, (request.user as { id?: string }).id);
      }
      return reply.redirect(`/admin/acr-wording?locale=${locale}&saved=1`);
    },
  );

  // ── Admin: reset one string to standard wording ──────────────────────────
  server.post(
    '/admin/acr-wording/reset',
    { preHandler: requirePermission('admin.system', 'admin.org'), schema: { ...HtmlPageSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as Record<string, string | undefined>;
      const locale = resolveLocale(body.locale);
      const key = (body.key ?? '').trim();
      if (storage.acrWording !== undefined && key) {
        await storage.acrWording.remove(orgOf(request), key, locale);
      }
      return reply.redirect(`/admin/acr-wording?locale=${locale}&saved=1`);
    },
  );

  // ── Admin: bulk-import a JSON of {key: text} for a locale ─────────────────
  server.post(
    '/admin/acr-wording/import',
    { preHandler: requirePermission('admin.system', 'admin.org'), schema: { ...HtmlPageSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as Record<string, string | undefined>;
      const locale = resolveLocale(body.locale);
      if (storage.acrWording === undefined) return reply.redirect(`/admin/acr-wording?locale=${locale}`);

      let count = 0;
      try {
        const parsed = JSON.parse(body.payload ?? '{}') as Record<string, unknown>;
        const known = new Set(ACR_WORDING_KEYS.map((k) => k.key));
        const source: AcrWordingSource = VALID_SOURCES.has(body.source ?? '')
          ? (body.source as AcrWordingSource)
          : 'custom';
        const today = new Date().toISOString().slice(0, 10);
        const actor = (request.user as { id?: string } | undefined)?.id ?? null;
        const rows: AcrWordingInput[] = [];
        for (const [key, value] of Object.entries(parsed)) {
          if (!known.has(key) || typeof value !== 'string' || value.trim() === '') continue;
          // Skip strings left identical to the standard wording (no override needed).
          if (value === t(ACR_WORDING_KEYS.find((k) => k.key === key)!.i18nKey, locale)) continue;
          rows.push({ key, locale, text: value, source, reviewed: true, translatedBy: actor, translatedAt: today });
        }
        count = await storage.acrWording.bulkUpsert(orgOf(request), rows, actor ?? undefined);
      } catch {
        return reply.redirect(`/admin/acr-wording?locale=${locale}&imported=error`);
      }
      return reply.redirect(`/admin/acr-wording?locale=${locale}&imported=${count}`);
    },
  );

  // ── Admin: download the current strings for a locale as a JSON template ───
  server.get(
    '/admin/acr-wording/export.json',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = orgOf(request);
      const locale = resolveLocale((request.query as { locale?: string }).locale);
      const overrides = storage.acrWording ? await storage.acrWording.listForOrg(orgId, locale) : [];
      const resolved = resolveAcrStrings({ locale, t: t as never, overrides });
      const out = Object.fromEntries(ACR_WORDING_KEYS.map((k) => [k.key, resolved[k.key].text]));
      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="acr-wording-${locale}.json"`)
        .send(JSON.stringify(out, null, 2));
    },
  );
}
