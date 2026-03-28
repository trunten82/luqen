# Proposals Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the proposals page into two flows — "Regulatory Updates" (acknowledge official changes with audit trail) and "Custom Proposals" (review/dismiss org-specific changes) — and fix the bug where acknowledging/approving doesn't apply changes to the DB.

**Architecture:** Tabbed UI on `/admin/proposals` with `?tab=updates` (default) and `?tab=custom`. The compliance API gets a new `/acknowledge` endpoint that sets `acknowledged_by/at/notes` columns and calls the existing `applyChange()` dispatcher. The dashboard writes audit log entries on each action. Legacy `/approve` and `/reject` endpoints are kept as aliases.

**Tech Stack:** TypeScript, Fastify, Handlebars, SQLite (better-sqlite3), HTMX

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/compliance/src/types.ts` | Modify | Add `acknowledged_by`, `acknowledged_at`, `notes` to `UpdateProposal`; add new status values |
| `packages/compliance/src/db/sqlite-adapter.ts` | Modify | ALTER TABLE migration for 3 new columns |
| `packages/compliance/src/db/adapter.ts` | No change | `updateUpdateProposal` already accepts `Partial<UpdateProposal>` |
| `packages/compliance/src/engine/proposals.ts` | Modify | Add `acknowledgeUpdate()` function; rename internals for clarity |
| `packages/compliance/src/api/routes/updates.ts` | Modify | Add `/acknowledge` endpoint, add `/review` + `/dismiss` aliases, accept `notes` body |
| `packages/dashboard/src/compliance-client.ts` | Modify | Add `acknowledgeProposal()`, rename `approveProposal` → `reviewProposal`, rename `rejectProposal` → `dismissProposal` |
| `packages/dashboard/src/routes/admin/proposals.ts` | Modify | Tab logic, new route handlers, audit log integration |
| `packages/dashboard/src/views/admin/proposals.hbs` | Rewrite | Tabbed layout with two distinct table views |
| `packages/dashboard/src/i18n/locales/en.json` | Modify | New i18n keys for tabs, acknowledge, review, dismiss |
| `packages/dashboard/src/i18n/locales/{it,de,fr,es,pt}.json` | Modify | Translations for new keys |
| `packages/dashboard/src/static/style.css` | Modify | Text overflow fix for proposal cards |
| `docs/reference/openapi-compliance.yaml` | Modify | New `/acknowledge` endpoint, deprecation notices |
| `docs/reference/openapi-dashboard.yaml` | Modify | Updated dashboard routes |

---

### Task 1: Schema & Type Updates (Compliance Package)

**Files:**
- Modify: `packages/compliance/src/types.ts:59-72`
- Modify: `packages/compliance/src/db/sqlite-adapter.ts:320-334`

- [ ] **Step 1: Update UpdateProposal type to include new fields and statuses**

In `packages/compliance/src/types.ts`, update the `UpdateProposal` interface:

```typescript
export interface UpdateProposal {
  readonly id: string;
  readonly source: string;
  readonly detectedAt: string;
  readonly type: 'new_regulation' | 'amendment' | 'repeal' | 'new_requirement' | 'new_jurisdiction';
  readonly affectedRegulationId?: string;
  readonly affectedJurisdictionId?: string;
  readonly summary: string;
  readonly proposedChanges: ProposedChange;
  readonly status: 'pending' | 'approved' | 'rejected' | 'acknowledged' | 'reviewed' | 'dismissed';
  readonly reviewedBy?: string;
  readonly reviewedAt?: string;
  readonly acknowledgedBy?: string;
  readonly acknowledgedAt?: string;
  readonly notes?: string;
  readonly createdAt: string;
}
```

- [ ] **Step 2: Add migration for new columns in SQLite adapter**

In `packages/compliance/src/db/sqlite-adapter.ts`, find the `initialize()` method's migration array and add after the existing table creation statements:

```typescript
// After the CREATE TABLE update_proposals block, add these migrations:
`ALTER TABLE update_proposals ADD COLUMN acknowledgedBy TEXT`,
`ALTER TABLE update_proposals ADD COLUMN acknowledgedAt TEXT`,
`ALTER TABLE update_proposals ADD COLUMN notes TEXT`,
```

These must be wrapped in try/catch or use `IF NOT EXISTS` pattern — SQLite's `ALTER TABLE ADD COLUMN` fails if the column already exists. Use the existing migration pattern in the file: wrap each ALTER in a try/catch that swallows "duplicate column" errors.

- [ ] **Step 3: Update the row mapping in SQLite adapter**

Find where `update_proposals` rows are mapped to `UpdateProposal` objects in the SQLite adapter (the `mapProposal` or inline mapping function). Add the three new fields:

```typescript
acknowledgedBy: row.acknowledgedBy as string | undefined,
acknowledgedAt: row.acknowledgedAt as string | undefined,
notes: row.notes as string | undefined,
```

- [ ] **Step 4: Run the compliance test suite to verify no regressions**

Run: `cd /root/luqen && npx vitest run --project compliance 2>&1 | tail -20`
Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/compliance/src/types.ts packages/compliance/src/db/sqlite-adapter.ts
git commit -m "feat: add acknowledged_by, acknowledged_at, notes columns to update_proposals"
```

---

### Task 2: Engine — Acknowledge & Review Functions (Compliance Package)

**Files:**
- Modify: `packages/compliance/src/engine/proposals.ts`

- [ ] **Step 1: Add `acknowledgeUpdate` function**

Add this function to `packages/compliance/src/engine/proposals.ts` after the existing `approveUpdate`:

```typescript
export async function acknowledgeUpdate(
  db: DbAdapter,
  proposalId: string,
  acknowledgedBy: string,
  notes?: string,
): Promise<UpdateProposal> {
  const proposal = await db.getUpdateProposal(proposalId);
  if (proposal == null) {
    throw new Error(`UpdateProposal not found: ${proposalId}`);
  }

  await applyChange(db, proposal.proposedChanges);

  const now = new Date().toISOString();
  return db.updateUpdateProposal(proposalId, {
    status: 'acknowledged',
    acknowledgedBy,
    acknowledgedAt: now,
    notes: notes ?? undefined,
  });
}
```

- [ ] **Step 2: Add `reviewUpdate` function (replaces approveUpdate behavior with new status)**

Add below `acknowledgeUpdate`:

```typescript
export async function reviewUpdate(
  db: DbAdapter,
  proposalId: string,
  reviewedBy: string,
  notes?: string,
): Promise<UpdateProposal> {
  const proposal = await db.getUpdateProposal(proposalId);
  if (proposal == null) {
    throw new Error(`UpdateProposal not found: ${proposalId}`);
  }

  await applyChange(db, proposal.proposedChanges);

  const now = new Date().toISOString();
  return db.updateUpdateProposal(proposalId, {
    status: 'reviewed',
    reviewedBy,
    reviewedAt: now,
    notes: notes ?? undefined,
  });
}
```

- [ ] **Step 3: Add `dismissUpdate` function (replaces rejectUpdate behavior with new status)**

Add below `reviewUpdate`:

```typescript
export async function dismissUpdate(
  db: DbAdapter,
  proposalId: string,
  reviewedBy: string,
  notes?: string,
): Promise<UpdateProposal> {
  const proposal = await db.getUpdateProposal(proposalId);
  if (proposal == null) {
    throw new Error(`UpdateProposal not found: ${proposalId}`);
  }

  const now = new Date().toISOString();
  return db.updateUpdateProposal(proposalId, {
    status: 'dismissed',
    reviewedBy,
    reviewedAt: now,
    notes: notes ?? undefined,
  });
}
```

- [ ] **Step 4: Update the import/export to include new functions**

The existing `approveUpdate` and `rejectUpdate` stay as-is for backward compatibility. Just ensure the new functions are exported.

- [ ] **Step 5: Run compliance tests**

Run: `cd /root/luqen && npx vitest run --project compliance 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/compliance/src/engine/proposals.ts
git commit -m "feat: add acknowledgeUpdate, reviewUpdate, dismissUpdate engine functions"
```

---

### Task 3: Compliance API — New Endpoints

**Files:**
- Modify: `packages/compliance/src/api/routes/updates.ts`

- [ ] **Step 1: Add import for new engine functions**

Update the import at the top of `packages/compliance/src/api/routes/updates.ts`:

```typescript
import { proposeUpdate, approveUpdate, rejectUpdate, acknowledgeUpdate, reviewUpdate, dismissUpdate } from '../../engine/proposals.js';
```

- [ ] **Step 2: Add PATCH /api/v1/updates/:id/acknowledge endpoint**

Add after the existing `/reject` endpoint:

```typescript
  // PATCH /api/v1/updates/:id/acknowledge
  app.patch('/api/v1/updates/:id/acknowledge', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const reviewer = (request as AuthRequest).tokenPayload?.sub ?? 'system';
      const body = (request.body ?? {}) as { notes?: string };
      const proposal = await acknowledgeUpdate(db, id, reviewer, body.notes);
      await reply.send(proposal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      const statusCode = message.includes('not found') ? 404 : 400;
      await reply.status(statusCode).send({ error: message, statusCode });
    }
  });
```

- [ ] **Step 3: Add PATCH /api/v1/updates/:id/review endpoint**

```typescript
  // PATCH /api/v1/updates/:id/review
  app.patch('/api/v1/updates/:id/review', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const reviewer = (request as AuthRequest).tokenPayload?.sub ?? 'system';
      const body = (request.body ?? {}) as { notes?: string };
      const proposal = await reviewUpdate(db, id, reviewer, body.notes);
      await reply.send(proposal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      const statusCode = message.includes('not found') ? 404 : 400;
      await reply.status(statusCode).send({ error: message, statusCode });
    }
  });
```

- [ ] **Step 4: Add PATCH /api/v1/updates/:id/dismiss endpoint**

```typescript
  // PATCH /api/v1/updates/:id/dismiss
  app.patch('/api/v1/updates/:id/dismiss', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const reviewer = (request as AuthRequest).tokenPayload?.sub ?? 'system';
      const body = (request.body ?? {}) as { notes?: string };
      const proposal = await dismissUpdate(db, id, reviewer, body.notes);
      await reply.send(proposal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      const statusCode = message.includes('not found') ? 404 : 400;
      await reply.status(statusCode).send({ error: message, statusCode });
    }
  });
```

- [ ] **Step 5: Run compliance tests**

Run: `cd /root/luqen && npx vitest run --project compliance 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/compliance/src/api/routes/updates.ts
git commit -m "feat: add /acknowledge, /review, /dismiss API endpoints for proposals"
```

---

### Task 4: Dashboard Compliance Client Updates

**Files:**
- Modify: `packages/dashboard/src/compliance-client.ts`

- [ ] **Step 1: Add `acknowledgeProposal` function**

Add after the existing `rejectProposal` function in `packages/dashboard/src/compliance-client.ts`:

```typescript
export async function acknowledgeProposal(
  baseUrl: string,
  token: string,
  id: string,
  notes?: string,
  orgId?: string,
): Promise<UpdateProposal> {
  return apiFetch<UpdateProposal>(`${baseUrl}/api/v1/updates/${encodeURIComponent(id)}/acknowledge`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ notes }),
  }, orgId);
}
```

- [ ] **Step 2: Add `reviewProposal` function**

```typescript
export async function reviewProposal(
  baseUrl: string,
  token: string,
  id: string,
  notes?: string,
  orgId?: string,
): Promise<UpdateProposal> {
  return apiFetch<UpdateProposal>(`${baseUrl}/api/v1/updates/${encodeURIComponent(id)}/review`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ notes }),
  }, orgId);
}
```

- [ ] **Step 3: Add `dismissProposal` function**

```typescript
export async function dismissProposal(
  baseUrl: string,
  token: string,
  id: string,
  notes?: string,
  orgId?: string,
): Promise<UpdateProposal> {
  return apiFetch<UpdateProposal>(`${baseUrl}/api/v1/updates/${encodeURIComponent(id)}/dismiss`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ notes }),
  }, orgId);
}
```

- [ ] **Step 4: Update UpdateProposal interface**

Update the `UpdateProposal` interface in the compliance client to include the new fields:

```typescript
export interface UpdateProposal {
  readonly id: string;
  readonly status: string;
  readonly source: string;
  readonly type: string;
  readonly summary: string;
  readonly detectedAt: string;
  readonly orgId?: string;
  readonly acknowledgedBy?: string;
  readonly acknowledgedAt?: string;
  readonly notes?: string;
}
```

- [ ] **Step 5: Build to verify no TypeScript errors**

Run: `cd /root/luqen && npx tsc -p packages/dashboard/tsconfig.json --noEmit 2>&1 | tail -20`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/compliance-client.ts
git commit -m "feat: add acknowledgeProposal, reviewProposal, dismissProposal to compliance client"
```

---

### Task 5: Dashboard Route Handlers — Proposals Redesign

**Files:**
- Modify: `packages/dashboard/src/routes/admin/proposals.ts`
- Modify: `packages/dashboard/src/server.ts` (pass `storage` to `proposalRoutes`)

- [ ] **Step 1: Update server.ts to pass storage to proposalRoutes**

In `packages/dashboard/src/server.ts`, find line ~560:
```typescript
await proposalRoutes(server, config.complianceUrl);
```
Change to:
```typescript
await proposalRoutes(server, config.complianceUrl, storage);
```

- [ ] **Step 2: Rewrite proposals.ts with tab support, new actions, and audit logging**

Replace the entire content of `packages/dashboard/src/routes/admin/proposals.ts`:

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../../db/index.js';
import {
  listUpdateProposals,
  approveProposal,
  rejectProposal,
  acknowledgeProposal,
  reviewProposal,
  dismissProposal,
} from '../../compliance-client.js';
import { requirePermission } from '../../auth/middleware.js';
import { getToken, getOrgId, toastHtml } from './helpers.js';

export async function proposalRoutes(
  server: FastifyInstance,
  baseUrl: string,
  storage: StorageAdapter,
): Promise<void> {
  // GET /admin/proposals — tabbed view: regulatory updates vs custom proposals
  server.get(
    '/admin/proposals',
    { preHandler: requirePermission('admin.system', 'compliance.view') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { status?: string; tab?: string };
      const tab = query.tab === 'custom' ? 'custom' : 'updates';
      const statusFilter = query.status;

      let officialProposals: Awaited<ReturnType<typeof listUpdateProposals>> = [];
      let customProposals: Awaited<ReturnType<typeof listUpdateProposals>> = [];
      let error: string | undefined;

      try {
        const allProposals = await listUpdateProposals(baseUrl, getToken(request), statusFilter, getOrgId(request));
        officialProposals = allProposals.filter((p) => !p.orgId || p.orgId === 'system');
        customProposals = allProposals.filter((p) => p.orgId && p.orgId !== 'system');
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to load proposals';
      }

      const formatProposal = (p: (typeof officialProposals)[0]) => ({
        ...p,
        detectedAtDisplay: new Date(p.detectedAt).toLocaleString('en-GB'),
        isPending: p.status === 'pending',
        isAcknowledged: p.status === 'acknowledged',
        isReviewed: p.status === 'reviewed',
        isDismissed: p.status === 'dismissed',
      });

      return reply.view('admin/proposals.hbs', {
        pageTitle: tab === 'updates' ? 'Regulatory Updates' : 'Custom Proposals',
        currentPath: '/admin/proposals',
        user: request.user,
        tab,
        officialProposals: officialProposals.map(formatProposal),
        customProposals: customProposals.map(formatProposal),
        officialCount: officialProposals.filter((p) => p.status === 'pending').length,
        customCount: customProposals.filter((p) => p.status === 'pending').length,
        statusFilter: statusFilter ?? '',
        error,
      });
    },
  );

  // POST /admin/proposals/:id/acknowledge — acknowledge official regulatory change
  server.post(
    '/admin/proposals/:id/acknowledge',
    { preHandler: requirePermission('admin.system', 'compliance.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { notes?: string };

      try {
        await acknowledgeProposal(baseUrl, getToken(request), id, body.notes, getOrgId(request));

        void storage.audit.log({
          actor: request.user?.username ?? 'unknown',
          actorId: request.user?.id,
          action: 'proposal.acknowledge',
          resourceType: 'update_proposal',
          resourceId: id,
          details: { notes: body.notes },
          ipAddress: request.ip,
          orgId: getOrgId(request),
        });

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Regulatory change acknowledged — data updated.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to acknowledge';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/proposals/:id/review — review and apply custom proposal
  server.post(
    '/admin/proposals/:id/review',
    { preHandler: requirePermission('admin.system', 'compliance.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { notes?: string };

      try {
        await reviewProposal(baseUrl, getToken(request), id, body.notes, getOrgId(request));

        void storage.audit.log({
          actor: request.user?.username ?? 'unknown',
          actorId: request.user?.id,
          action: 'proposal.review',
          resourceType: 'update_proposal',
          resourceId: id,
          details: { notes: body.notes },
          ipAddress: request.ip,
          orgId: getOrgId(request),
        });

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Proposal reviewed — regulatory data updated.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to review proposal';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/proposals/:id/dismiss — dismiss custom proposal without applying
  server.post(
    '/admin/proposals/:id/dismiss',
    { preHandler: requirePermission('admin.system', 'compliance.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { notes?: string };

      try {
        await dismissProposal(baseUrl, getToken(request), id, body.notes, getOrgId(request));

        void storage.audit.log({
          actor: request.user?.username ?? 'unknown',
          actorId: request.user?.id,
          action: 'proposal.dismiss',
          resourceType: 'update_proposal',
          resourceId: id,
          details: { notes: body.notes },
          ipAddress: request.ip,
          orgId: getOrgId(request),
        });

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Proposal dismissed.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to dismiss proposal';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // Legacy aliases — keep /approve and /reject working for one release cycle
  server.post(
    '/admin/proposals/:id/approve',
    { preHandler: requirePermission('admin.system', 'compliance.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      try {
        await approveProposal(baseUrl, getToken(request), id, getOrgId(request));
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Proposal approved — regulatory data updated.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to approve proposal';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  server.post(
    '/admin/proposals/:id/reject',
    { preHandler: requirePermission('admin.system', 'compliance.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      try {
        await rejectProposal(baseUrl, getToken(request), id, getOrgId(request));
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Proposal dismissed.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to reject proposal';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}
```

- [ ] **Step 3: Build to verify no TypeScript errors**

Run: `cd /root/luqen && npx tsc -p packages/dashboard/tsconfig.json --noEmit 2>&1 | tail -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/routes/admin/proposals.ts packages/dashboard/src/server.ts
git commit -m "feat: proposals route handlers — tabbed view, acknowledge/review/dismiss with audit"
```

---

### Task 6: Proposals Template — Tabbed UI

**Files:**
- Rewrite: `packages/dashboard/src/views/admin/proposals.hbs`

- [ ] **Step 1: Rewrite the proposals template with tabs**

Replace the entire content of `packages/dashboard/src/views/admin/proposals.hbs`:

```handlebars
<section aria-label="{{t 'admin.proposals.pageTitle'}}">
  {{!-- Tab navigation --}}
  <div class="tabs mb-md">
    <a href="/admin/proposals?tab=updates"
       class="tab {{#if (eq tab 'updates')}}tab--active{{/if}}"
       aria-current="{{#if (eq tab 'updates')}}page{{/if}}">
      {{t "admin.proposals.tabUpdates"}}
      {{#if officialCount}}<span class="badge badge--warning badge--sm">{{officialCount}}</span>{{/if}}
    </a>
    <a href="/admin/proposals?tab=custom"
       class="tab {{#if (eq tab 'custom')}}tab--active{{/if}}"
       aria-current="{{#if (eq tab 'custom')}}page{{/if}}">
      {{t "admin.proposals.tabCustom"}}
      {{#if customCount}}<span class="badge badge--warning badge--sm">{{customCount}}</span>{{/if}}
    </a>
  </div>

  {{#if error}}
  <div class="alert alert--error mb-md" role="alert">
    <p>{{error}}</p>
  </div>
  {{/if}}

  <div id="proposal-messages"></div>

  {{!-- Regulatory Updates tab --}}
  {{#if (eq tab 'updates')}}
  <div class="table-wrapper" aria-live="polite" aria-atomic="false">
    <table class="data-table" aria-label="{{t 'admin.proposals.tabUpdates'}}">
      <thead>
        <tr>
          <th scope="col">{{t "admin.proposals.colSource"}}</th>
          <th scope="col">{{t "admin.proposals.colType"}}</th>
          <th scope="col">{{t "admin.proposals.colSummary"}}</th>
          <th scope="col">{{t "admin.proposals.colDetected"}}</th>
          <th scope="col">{{t "common.status"}}</th>
          <th scope="col">{{t "common.actions"}}</th>
        </tr>
      </thead>
      <tbody>
        {{#each officialProposals}}
        <tr id="proposal-{{id}}">
          <td data-label="Source" class="cell--wrap">{{source}}</td>
          <td data-label="Type"><span class="badge badge--info">{{type}}</span></td>
          <td data-label="Summary" class="cell--wrap">{{summary}}</td>
          <td data-label="Detected">{{detectedAtDisplay}}</td>
          <td data-label="Status">
            {{#if isPending}}
            <span class="badge badge--warning">{{t "admin.proposals.statusPending"}}</span>
            {{else}}
            <span class="badge badge--success">{{t "admin.proposals.statusAcknowledged"}}</span>
            {{/if}}
          </td>
          <td>
            {{#if isPending}}
            <div class="plugin-actions">
              <button type="button" class="btn btn--sm btn--primary"
                      hx-post="/admin/proposals/{{id}}/acknowledge"
                      hx-confirm="{{t 'admin.proposals.confirmAcknowledge'}}"
                      hx-target="#proposal-{{id}}"
                      hx-swap="delete swap:300ms"
                      hx-vals='{"notes":""}'
                      aria-label="{{t 'admin.proposals.acknowledge'}}: {{summary}}">{{t "admin.proposals.acknowledge"}}</button>
            </div>
            {{else}}
            <span class="text-sm text-muted">{{t "admin.proposals.statusAcknowledged"}}</span>
            {{/if}}
          </td>
        </tr>
        {{else}}
        <tr>
          <td colspan="6" class="table__empty">{{t "admin.proposals.noUpdates"}}</td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  </div>
  {{/if}}

  {{!-- Custom Proposals tab --}}
  {{#if (eq tab 'custom')}}
  <div class="table-wrapper" aria-live="polite" aria-atomic="false">
    <table class="data-table" aria-label="{{t 'admin.proposals.tabCustom'}}">
      <thead>
        <tr>
          <th scope="col">{{t "admin.proposals.colSource"}}</th>
          <th scope="col">{{t "admin.proposals.colType"}}</th>
          <th scope="col">{{t "admin.proposals.colSummary"}}</th>
          <th scope="col">{{t "admin.proposals.colDetected"}}</th>
          <th scope="col">{{t "common.status"}}</th>
          <th scope="col">{{t "common.actions"}}</th>
        </tr>
      </thead>
      <tbody>
        {{#each customProposals}}
        <tr id="proposal-{{id}}">
          <td data-label="Source" class="cell--wrap">{{source}}</td>
          <td data-label="Type"><span class="badge badge--info">{{type}}</span></td>
          <td data-label="Summary" class="cell--wrap">{{summary}}</td>
          <td data-label="Detected">{{detectedAtDisplay}}</td>
          <td data-label="Status">
            {{#if isPending}}
            <span class="badge badge--warning">{{t "admin.proposals.statusPending"}}</span>
            {{else if isReviewed}}
            <span class="badge badge--success">{{t "admin.proposals.statusReviewed"}}</span>
            {{else if isDismissed}}
            <span class="badge badge--error">{{t "admin.proposals.statusDismissed"}}</span>
            {{else}}
            <span class="badge">{{status}}</span>
            {{/if}}
          </td>
          <td>
            {{#if isPending}}
            <div class="plugin-actions">
              <button type="button" class="btn btn--sm btn--primary"
                      hx-post="/admin/proposals/{{id}}/review"
                      hx-confirm="{{t 'admin.proposals.confirmReview'}}"
                      hx-target="#proposal-{{id}}"
                      hx-swap="delete swap:300ms"
                      hx-vals='{"notes":""}'
                      aria-label="{{t 'admin.proposals.review'}}: {{summary}}">{{t "admin.proposals.review"}}</button>
              <button type="button" class="btn btn--sm btn--danger"
                      hx-post="/admin/proposals/{{id}}/dismiss"
                      hx-confirm="{{t 'admin.proposals.confirmDismiss'}}"
                      hx-target="#proposal-{{id}}"
                      hx-swap="delete swap:300ms"
                      hx-vals='{"notes":""}'
                      aria-label="{{t 'admin.proposals.dismiss'}}: {{summary}}">{{t "admin.proposals.dismiss"}}</button>
            </div>
            {{else}}
            <span class="text-sm text-muted">{{status}}</span>
            {{/if}}
          </td>
        </tr>
        {{else}}
        <tr>
          <td colspan="6" class="table__empty">{{t "admin.proposals.noCustom"}}</td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  </div>
  {{/if}}
</section>
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/src/views/admin/proposals.hbs
git commit -m "feat: proposals template — tabbed UI for regulatory updates vs custom proposals"
```

---

### Task 7: i18n — All 6 Locales

**Files:**
- Modify: `packages/dashboard/src/i18n/locales/en.json`
- Modify: `packages/dashboard/src/i18n/locales/it.json`
- Modify: `packages/dashboard/src/i18n/locales/de.json`
- Modify: `packages/dashboard/src/i18n/locales/fr.json`
- Modify: `packages/dashboard/src/i18n/locales/es.json`
- Modify: `packages/dashboard/src/i18n/locales/pt.json`

- [ ] **Step 1: Update English locale**

Replace the `"proposals"` block in `en.json` with:

```json
"proposals": {
  "pageTitle": "Proposals",
  "tabUpdates": "Regulatory Updates",
  "tabCustom": "Custom Proposals",
  "allStatuses": "All Statuses",
  "statusPending": "Pending",
  "statusApproved": "Approved",
  "statusRejected": "Rejected",
  "statusAcknowledged": "Acknowledged",
  "statusReviewed": "Reviewed",
  "statusDismissed": "Dismissed",
  "colSource": "Source",
  "colType": "Type",
  "colSummary": "Summary",
  "colDetected": "Detected",
  "acknowledge": "Acknowledge",
  "review": "Review & Apply",
  "dismiss": "Dismiss",
  "approve": "Approve",
  "reject": "Reject",
  "confirmAcknowledge": "Acknowledge this regulatory change? The compliance data will be updated.",
  "confirmReview": "Apply this proposed change to compliance data?",
  "confirmDismiss": "Dismiss this proposal? No changes will be applied.",
  "confirmApprove": "Approve this proposal?",
  "confirmReject": "Reject this proposal?",
  "noUpdates": "No regulatory updates detected.",
  "noCustom": "No custom proposals.",
  "noProposals": "No proposals found."
}
```

- [ ] **Step 2: Update Italian locale**

Replace the `"proposals"` block in `it.json` with the Italian translations matching the same key structure.

- [ ] **Step 3: Update German locale**

Replace the `"proposals"` block in `de.json`.

- [ ] **Step 4: Update French locale**

Replace the `"proposals"` block in `fr.json`.

- [ ] **Step 5: Update Spanish locale**

Replace the `"proposals"` block in `es.json`.

- [ ] **Step 6: Update Portuguese locale**

Replace the `"proposals"` block in `pt.json`.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/i18n/locales/*.json
git commit -m "feat: i18n — proposals redesign translations for all 6 locales"
```

---

### Task 8: CSS — Text Overflow Fix

**Files:**
- Modify: `packages/dashboard/src/static/style.css`

- [ ] **Step 1: Verify `.cell--wrap` class exists**

Search `style.css` for `cell--wrap`. If it exists, verify it has `word-break: break-word`. If it doesn't exist, add it:

```css
.cell--wrap {
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 300px;
}
```

This class is already used in the proposals template on the Source and Summary columns.

- [ ] **Step 2: Commit (only if CSS was changed)**

```bash
git add packages/dashboard/src/static/style.css
git commit -m "fix: text overflow in proposal table cells"
```

---

### Task 9: OpenAPI & Documentation Updates

**Files:**
- Modify: `docs/reference/openapi-compliance.yaml`
- Modify: `docs/reference/openapi-dashboard.yaml`

- [ ] **Step 1: Add /acknowledge endpoint to openapi-compliance.yaml**

Add the new endpoint definition for `PATCH /api/v1/updates/{id}/acknowledge` with request body schema (`{ notes?: string }`) and response schema. Add deprecation notices to the existing `/approve` and `/reject` endpoints with a note pointing to `/review` and `/dismiss`.

- [ ] **Step 2: Add /review and /dismiss endpoints to openapi-compliance.yaml**

Add endpoint definitions for `PATCH /api/v1/updates/{id}/review` and `PATCH /api/v1/updates/{id}/dismiss`.

- [ ] **Step 3: Update openapi-dashboard.yaml**

Add the new dashboard routes: `POST /admin/proposals/{id}/acknowledge`, `POST /admin/proposals/{id}/review`, `POST /admin/proposals/{id}/dismiss`. Update the `GET /admin/proposals` description to mention the `tab` query parameter.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/openapi-compliance.yaml docs/reference/openapi-dashboard.yaml
git commit -m "docs: update OpenAPI specs with proposals redesign endpoints"
```

---

### Task 10: Build, Test & Verify

- [ ] **Step 1: Build all packages**

Run: `cd /root/luqen && npm run build -w packages/core -w packages/compliance -w packages/dashboard -w packages/monitor 2>&1 | tail -20`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run full test suite**

Run: `cd /root/luqen && npx vitest run 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 3: Verify the proposals page renders in a browser**

Start the services locally and navigate to `/admin/proposals` — verify:
- Two tabs appear ("Regulatory Updates" and "Custom Proposals")
- Default tab is "Regulatory Updates"
- Switching tabs works via `?tab=custom`
- Acknowledge button appears for pending official proposals
- Review/Dismiss buttons appear for pending custom proposals
- Text doesn't overflow in table cells

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: proposals redesign — address review findings"
```
