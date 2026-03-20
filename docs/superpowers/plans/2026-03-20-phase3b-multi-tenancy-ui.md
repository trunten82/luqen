# Phase 3b: Multi-Tenancy — UI & Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the user-facing org management UI, org switcher, session org context, and wire the dashboard→compliance service to pass X-Org-Id headers — making multi-tenancy usable end-to-end.

**Architecture:** Admin pages for org CRUD following the existing HTMX modal pattern. Org context stored in session, accessible via `request.session.get('currentOrgId')`. The compliance-client.ts passes X-Org-Id header on all requests. Sidebar gets an org selector when the user belongs to multiple orgs.

**Tech Stack:** TypeScript, Fastify, Handlebars, HTMX, better-sqlite3, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/routes/admin/organizations.ts` | Create | Org CRUD routes + member management |
| `src/views/admin/organizations.hbs` | Create | Org list page |
| `src/views/admin/organization-form.hbs` | Create | Create/edit org modal |
| `src/views/admin/organization-members.hbs` | Create | Member list + add/remove |
| `src/views/partials/sidebar.hbs` | Modify | Add org switcher + Organizations link |
| `src/views/layouts/main.hbs` | Modify | Add org context to layout data |
| `src/compliance-client.ts` | Modify | Pass X-Org-Id header on all requests |
| `src/server.ts` | Modify | Register org routes, extract orgId from session, pass OrgDb |
| `src/auth/middleware.ts` | Modify | Add currentOrgId to AuthUser type |
| `src/routes/admin/dashboard-users.ts` | Modify | Pass orgs context for member assignment |
| `tests/routes/organizations.test.ts` | Create | Tests for org CRUD routes |
| `tests/routes/org-integration.test.ts` | Create | Tests for org-scoped data filtering |

---

## Task 1: Session Org Context & AuthUser Extension

**Files:**
- Modify: `packages/dashboard/src/auth/middleware.ts`
- Modify: `packages/dashboard/src/auth/auth-service.ts`
- Modify: `packages/dashboard/src/server.ts`

- [ ] Add `currentOrgId?: string` to AuthUser interface in middleware.ts
- [ ] In server.ts, after auth guard runs, extract currentOrgId from session and attach to request.user
- [ ] Add org switch route: `POST /orgs/switch` that sets session currentOrgId and redirects
- [ ] Ensure all route handlers have access to currentOrgId via request.user
- [ ] Run dashboard tests to verify no breakage
- [ ] Commit: `feat: add session org context and org switch endpoint`

---

## Task 2: Compliance Client — X-Org-Id Header

**Files:**
- Modify: `packages/dashboard/src/compliance-client.ts`

- [ ] Update `apiFetch()` to accept optional `orgId` parameter
- [ ] When orgId is provided and not 'system', add `'X-Org-Id': orgId` to headers
- [ ] Update all exported functions to accept and pass orgId
- [ ] Update route handlers that call compliance-client to pass request.user.currentOrgId
- [ ] Run dashboard tests to verify no breakage
- [ ] Commit: `feat: pass X-Org-Id header to compliance service from dashboard`

---

## Task 3: Organization Management Routes

**Files:**
- Create: `packages/dashboard/src/routes/admin/organizations.ts`
- Create: `packages/dashboard/tests/routes/organizations.test.ts`

- [ ] Write tests for org CRUD:
  - GET /admin/organizations — returns org list page
  - GET /admin/organizations/new — returns form modal
  - POST /admin/organizations — creates org (name, slug)
  - POST /admin/organizations/:id/delete — deletes org
  - GET /admin/organizations/:id/members — returns members page
  - POST /admin/organizations/:id/members — adds member
  - POST /admin/organizations/:id/members/:userId/remove — removes member
- [ ] Run tests to verify they fail
- [ ] Implement routes following the dashboard-users.ts pattern:
  - Admin-only (adminGuard preHandler)
  - HTML responses for HTMX targets
  - OOB toast notifications
  - Modal pattern for create form
- [ ] Run tests to verify they pass
- [ ] Run all dashboard tests
- [ ] Commit: `feat: add organization management routes`

---

## Task 4: Organization Management Views

**Files:**
- Create: `packages/dashboard/src/views/admin/organizations.hbs`
- Create: `packages/dashboard/src/views/admin/organization-form.hbs`
- Create: `packages/dashboard/src/views/admin/organization-members.hbs`

- [ ] Create organizations.hbs following admin/dashboard-users.hbs pattern:
  - Table with columns: Name, Slug, Members, Created, Actions
  - Add Organization button targeting modal
  - Delete with hx-confirm
- [ ] Create organization-form.hbs modal:
  - Fields: Name (text), Slug (text, auto-generated from name via JS)
  - Submit creates org
- [ ] Create organization-members.hbs:
  - Table: Username, Role, Joined, Actions (Remove)
  - Add Member button (select from dashboard users)
  - Role selector (admin, member)
- [ ] Register routes in server.ts
- [ ] Commit: `feat: add organization management views`

---

## Task 5: Sidebar — Org Switcher & Navigation

**Files:**
- Modify: `packages/dashboard/src/views/partials/sidebar.hbs`
- Modify: `packages/dashboard/src/views/layouts/main.hbs`
- Modify: `packages/dashboard/src/server.ts`

- [ ] Add "Organizations" link to sidebar admin section (after Plugins)
- [ ] Add org switcher dropdown to sidebar (below logo, above Overview):
  - Only visible when user belongs to 2+ orgs
  - Shows current org name with dropdown arrow
  - Dropdown lists all user orgs, each as a form POST to /orgs/switch
  - Include "System (Global)" option
- [ ] Pass `userOrgs` and `currentOrg` to all template contexts in server.ts
- [ ] Commit: `feat: add org switcher and organizations link to sidebar`

---

## Task 6: Org-Scoped Data Filtering in Routes

**Files:**
- Modify: `packages/dashboard/src/routes/home.ts` (or equivalent scan list route)
- Modify: admin routes that call compliance service
- Create: `packages/dashboard/tests/routes/org-integration.test.ts`

- [ ] Write tests verifying scan list filters by currentOrgId
- [ ] Update scan list/create routes to pass orgId from session
- [ ] Update admin routes (jurisdictions, regulations, etc.) to pass orgId to compliance client
- [ ] Run all tests
- [ ] Commit: `feat: apply org-scoped filtering to dashboard routes`

---

## Task 7: Full Verification & Changelog

- [ ] Build all workspaces: `npm run build --workspaces`
- [ ] Run all tests: `npm test --workspaces`
- [ ] Update CHANGELOG.md with Phase 3b additions under v0.10.0
- [ ] Commit: `docs: update v0.10.0 changelog with multi-tenancy UI`
