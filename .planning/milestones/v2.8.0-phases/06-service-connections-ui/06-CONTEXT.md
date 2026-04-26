# Phase 06: Service Connections UI - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a **single new dashboard admin page** (`/admin/service-connections`) — visible only to global dashboard admins — that manages the three outbound service connections from the dashboard (compliance, branding, LLM). Each connection has a URL, OAuth client ID, and OAuth client secret. Credentials are stored in the dashboard DB encrypted at rest, and saving a change recreates the relevant service client at runtime without a server restart.

**In scope:**
- New DB table `service_connections` with encrypted secrets
- New admin route `/admin/service-connections` (GET list, POST update, POST test)
- `ServiceClientRegistry` indirection layer so clients can be hot-swapped at runtime
- Auto-import bootstrap: first boot after migration copies config values into the DB if the table is empty
- Test connection endpoint that validates candidate values BEFORE save (full OAuth + /health)
- Permission gating on `dashboard.admin` (global admin only)

**Out of scope (MUST NOT TOUCH):**
- `/admin/api-keys` — org-scoped API keys (stays exactly as-is)
- `/admin/clients` — inbound OAuth client registration (stays exactly as-is)
- Any per-org credential management — org admins retain full control of their own credentials
- Config file format itself (remains as bootstrap fallback)
- OAuth server implementation in compliance/branding/LLM services
- Migration away from `sessionSecret` as encryption key (reuse existing pattern)

</domain>

<decisions>
## Implementation Decisions

### Scope and Permissions
- **D-01:** Phase 06 is strictly system-level outbound connections (dashboard → compliance/branding/LLM). Org admins neither see nor touch this page.
- **D-02:** Only users with `dashboard.admin` permission can view or edit `/admin/service-connections`. All other roles receive 403.
- **D-03:** Exactly three fixed connection rows: `compliance`, `branding`, `llm` — no add/delete, only edit.

### Storage and Encryption
- **D-04:** New SQLite table `service_connections` with columns: `service_id TEXT PRIMARY KEY`, `url TEXT NOT NULL`, `client_id TEXT NOT NULL DEFAULT ''`, `client_secret_encrypted TEXT NOT NULL DEFAULT ''`, `updated_at TEXT NOT NULL`, `updated_by TEXT`.
- **D-05:** Secrets encrypted at rest using the existing `encryptSecret` / `decryptSecret` utilities in `packages/dashboard/src/plugins/crypto.ts`. Encryption key is `config.sessionSecret` — same pattern as git-credentials and plugin configs.
- **D-06:** `client_secret_encrypted` stores an empty string (not null) when no secret is set, so the column is NOT NULL and the decrypt path handles the empty case gracefully.

### Runtime Reload — Indirection Holder Pattern
- **D-07:** Introduce a new `ServiceClientRegistry` class in `packages/dashboard/src/services/service-client-registry.ts` that owns the three clients: `complianceTokenManager`, `brandingTokenManager`, `llmClient`.
- **D-08:** Routes call `registry.getComplianceTokenManager()` / `.getBrandingTokenManager()` / `.getLLMClient()` per-request. The registry returns the current live reference.
- **D-09:** On save, the route handler calls `registry.reload(serviceId)`, which:
  1. Reads the current (now updated) row from `service_connections`
  2. Decrypts the secret
  3. Constructs a new `ServiceTokenManager` or `LLMClient`
  4. Atomically swaps the internal reference
  5. Calls `.destroy()` on the old instance
- **D-10:** `server.ts` constructs the registry at startup and replaces the direct `serviceTokenManager` / `brandingTokenManager` / `llmClient` variables. All existing routes that receive these references are updated to receive the registry and call the getter per request (or receive a getter function).
- **D-11:** `onClose` hook calls `registry.destroyAll()`.

### Bootstrap and Precedence
- **D-12:** DB value always wins over config file when both are present.
- **D-13:** On server boot, after migrations run: if `service_connections` table is empty AND `config.complianceUrl` (or brandingUrl / llmUrl) is set, auto-insert rows from config values (encrypting the secrets on the way in). Log each imported row at INFO level. Set `updated_by = 'bootstrap-from-config'`.
- **D-14:** If a specific row is missing in DB after bootstrap (e.g., LLM not configured at first boot but added later), the registry falls back to the current config value for THAT service only — per-service fallback, not all-or-nothing.
- **D-15:** The config file itself is NOT rewritten by the UI. It remains as the frozen bootstrap snapshot.

### Admin Page UX
- **D-16:** Single page at `/admin/service-connections` showing the three rows in a table: service name, URL, client ID, status badge (OK / Error / Not configured), last tested timestamp, actions (Edit, Test).
- **D-17:** Edit opens an HTMX inline form (same pattern as existing admin pages) with fields: URL, Client ID, Client Secret.
- **D-18:** The Client Secret input renders as `<input type="password" placeholder="●●●●●●●● (last rotated YYYY-MM-DD)">`. Leaving it blank on save keeps the current value. Typing any value replaces it. Separate "Clear secret" button for the escape hatch.
- **D-19:** The stored secret is NEVER returned to the client — the GET endpoint returns only `{ serviceId, url, clientId, hasSecret: true/false, updatedAt }`.
- **D-20:** Test button sends the current form values (URL, clientId, clientSecret) to `POST /admin/service-connections/:id/test`. Tests the candidate values without saving — allows validation before commit. If the secret field is blank, the test uses the stored (decrypted) secret.
- **D-21:** Test endpoint performs: (a) full OAuth2 client_credentials token fetch against `{url}/oauth/token`, (b) a GET to `{url}/health`. Returns `{ ok: true, latencyMs }` or `{ ok: false, step: 'oauth'|'health', error: '...' }`. Timeout: 10 seconds.
- **D-22:** On successful save, the row re-renders with a green "Saved and clients reloaded" toast. Failed reload shows a red toast with the error and leaves the old client active.

### i18n and Design System
- **D-23:** All UI copy uses `{{t}}` i18n keys under `admin.serviceConnections.*` — no hardcoded English. Matches the v2.7.0 Phase 5 discipline.
- **D-24:** Use existing Emerald design tokens and existing CSS classes from `style.css`. No new CSS classes.
- **D-25:** Form layout mirrors the existing `/admin/llm` and `/admin/clients` pages for consistency.

### Audit and Observability
- **D-26:** Every save writes an entry to the existing `audit_log` table with `action='service_connection.update'`, `resource=serviceId`, `actor=userId`. Secret values are never logged.
- **D-27:** Client reload success and failure are logged at INFO and ERROR respectively, including the service ID and latency.

### Claude's Discretion
- Exact Handlebars partial structure and HTMX targets — follow existing admin page conventions.
- Internal Zod schema shapes for the request/response contracts.
- Error message wording (within i18n key discipline).
- Whether to expose a small helper view-model in the route handler or inline it — Claude chooses based on line count.
- Whether the registry uses private fields + getters or a Map<ServiceId, Client> internally.
- Unit vs integration test split — target 80%+ coverage, prefer integration tests that exercise the full save → reload path.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Artifacts
- `.planning/PROJECT.md` — milestone v2.8.0 goals, constraints, and architecture overview
- `.planning/REQUIREMENTS.md` — SVC-01 through SVC-08 requirement definitions
- `.planning/ROADMAP.md` — Phase 06 goal and success criteria

### Existing Encryption Pattern (reuse verbatim)
- `packages/dashboard/src/plugins/crypto.ts` — `encryptSecret` / `decryptSecret` helpers keyed on `sessionSecret`
- `packages/dashboard/src/routes/git-credentials.ts` — reference example of encrypt-on-save, decrypt-on-use pattern with blank-to-keep UX
- `packages/dashboard/src/plugins/manager.ts` — reference example of `encryptConfig` / `decryptConfig` / `maskSecrets` usage

### Existing Service Client Wiring (to refactor behind the registry)
- `packages/dashboard/src/server.ts` lines ~155–170 — current `ServiceTokenManager` and `brandingTokenManager` construction at startup
- `packages/dashboard/src/server.ts` line ~648 — current `createLLMClient` construction
- `packages/dashboard/src/auth/service-token.ts` — `ServiceTokenManager` class (used for compliance + branding OAuth)
- `packages/dashboard/src/llm-client.ts` — `createLLMClient` factory and `LLMClient` class
- `packages/dashboard/src/compliance-client.ts` — compliance client wrapper (inspect for reference patterns)

### Admin Page Conventions (mirror these)
- `packages/dashboard/src/routes/admin/clients.ts` — most structurally similar existing admin route (client credentials management for inbound OAuth)
- `packages/dashboard/src/routes/admin/llm.ts` — tabs + HTMX partial pattern
- `packages/dashboard/src/views/admin/clients.hbs` — table + edit form layout to mirror
- `packages/dashboard/src/static/style.css` — Emerald design tokens and existing classes to reuse

### Config and DB
- `packages/dashboard/src/config.ts` — current shape of `complianceUrl/Id/Secret`, `brandingUrl/Id/Secret`, `llmUrl/Id/Secret` (bootstrap source)
- `packages/dashboard/src/db/sqlite/migrations.ts` — migration pattern for CREATE TABLE additions (add new migration at the end)

### i18n
- `packages/dashboard/src/i18n/locales/en.json` — add `admin.serviceConnections.*` keys

### RBAC
- `packages/dashboard/src/permissions.ts` — verify `dashboard.admin` permission key; no new permission introduced

### Audit Log
- Existing `audit_log` table in migrations.ts — schema for writing audit entries

</canonical_refs>

<specifics>
## Specific Ideas

- Reuse the `blank-to-keep` secret input pattern from `routes/git-credentials.ts` verbatim — users already know this interaction.
- Status badge semantics on the list view: **OK** (last test within 24h succeeded), **Error** (last test failed), **Untested** (no test since last save), **Not configured** (row has no URL or no client credentials).
- The registry's `reload(serviceId)` must be exception-safe: if the new client constructor throws, the old client stays active and the save endpoint returns 500 with the error reason. The DB row is still updated (user can try again), but the in-memory client is not swapped until a valid client can be built.
- Migration number: add the new migration as the next sequential number in `migrations.ts` — do not squash into an existing migration.
- Test endpoint timeout is 10 seconds to fit within typical HTTP timeouts but still allow slow local OAuth handshakes.

</specifics>

<deferred>
## Deferred Ideas

- **Per-environment profiles (dev/staging/prod switchable in UI)** — defer; single active config per instance is fine for v2.8.
- **Service connection audit log page** — the save action writes to `audit_log`, but a dedicated UI viewer is out of scope.
- **Config file write-back from UI** — explicitly not done; config file remains a frozen snapshot.
- **Hot reload of non-service config keys** (session secret, redis URL, etc.) — out of scope for this phase.
- **Multi-instance coordination** (propagating reload across horizontally-scaled dashboards) — out of scope; single-instance only for v2.8.
- **Custom encryption key separate from `sessionSecret`** — deferred; reuse existing pattern to minimise surface area.

</deferred>

---

*Phase: 06-service-connections-ui*
*Context gathered: 2026-04-05 via /gsd:discuss-phase*
