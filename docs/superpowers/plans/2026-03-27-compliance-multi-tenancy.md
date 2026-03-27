# Compliance Multi-Tenancy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add tenant isolation to the compliance service so org-scoped data is properly segregated, and dashboard orgs auto-create compliance tenants with OAuth clients.

**Architecture:** The compliance DB already has `org_id` columns. Main changes: (1) OAuth scope `tenant:<id>` for org-scoped clients, (2) JWT carries org context, (3) compliance checker uses org context, (4) dashboard creates compliance tenant + client on org creation, (5) write protection for system data.

**Tech Stack:** TypeScript, Fastify, SQLite, JWT (RS256), Vitest

**Parallelization:** Tasks 1-3 are independent (compliance package). Task 4 depends on Task 1. Task 5 depends on all.

---

### Task 1: Add tenant scope type to OAuth and JWT

**Files:**
- Modify: `packages/compliance/src/auth/scopes.ts`
- Modify: `packages/compliance/src/auth/middleware.ts`
- Modify: `packages/compliance/src/api/routes/oauth.ts`

**Changes:**
1. In `scopes.ts`, add a `parseTenantScope` function that extracts tenant_id from scope string `tenant:<id>`
2. In `oauth.ts`, when creating JWT for client_credentials grant, if client has `org_id != 'system'`, include `orgId` in the JWT payload
3. In `middleware.ts`, after JWT verification, extract `orgId` from token payload and set `request.orgId` — this removes the API-key-only restriction on org context
4. Keep X-Org-Id header support for API key auth as fallback

### Task 2: Protect system data from tenant writes

**Files:**
- Modify: `packages/compliance/src/api/routes/jurisdictions.ts`
- Modify: `packages/compliance/src/api/routes/regulations.ts`
- Modify: `packages/compliance/src/api/routes/sources.ts`

**Changes:**
1. On POST/PATCH/DELETE routes, if the request has a non-system orgId, only allow operations on data with matching org_id
2. Block modification of system data (org_id = NULL or 'system') by tenant-scoped requests
3. POST routes: force org_id to the request's orgId (tenant can't create system-level data)

### Task 3: Pass org context to compliance checker

**Files:**
- Modify: `packages/compliance/src/engine/checker.ts`
- Modify: `packages/compliance/src/api/routes/compliance.ts`

**Changes:**
1. `checkCompliance()` receives `orgId` parameter
2. Queries filter requirements by orgId (using existing IN ('system', orgId) pattern)
3. Compliance check route passes orgId from request context

### Task 4: Dashboard auto-creates compliance tenant on org creation

**Files:**
- Modify: `packages/dashboard/src/db/sqlite/repositories/org-repository.ts`
- Modify: `packages/dashboard/src/compliance-client.ts`
- Modify: `packages/dashboard/src/db/sqlite/migrations.ts` (migration 028)

**Changes:**
1. Add `compliance_client_id` and `compliance_tenant_id` columns to organizations table (migration 028)
2. In `createOrg()`, after creating roles, call compliance API to create a tenant-scoped OAuth client
3. Store the client credentials in the org record
4. Add `createComplianceClient(baseUrl, adminToken, orgId, orgName)` to compliance-client.ts

### Task 5: Dashboard uses org's compliance client for API calls

**Files:**
- Modify: `packages/dashboard/src/compliance-client.ts`
- Modify: `packages/dashboard/src/server.ts`

**Changes:**
1. When making compliance API calls in org context, use the org's compliance client credentials instead of the system admin client
2. The service token manager needs to support per-org tokens
3. Compliance pages pass org context to all API calls

---

## Parallelization

```
Start ──┬── Task 1 (OAuth tenant scope) ──┬── Task 4 (dashboard org creation) ──┐
        ├── Task 2 (system data protection)├──────────────────────────────────────├── Task 5 (verify)
        └── Task 3 (checker org context) ──┘                                    ┘
```
