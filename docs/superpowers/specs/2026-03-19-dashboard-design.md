# Luqen — Design Specification

## Overview

The Luqen is a web application for browsing accessibility scan reports and managing the luqen ecosystem. It provides a visual interface for launching scans, viewing results, comparing reports, and administering the compliance service — all from a browser.

It is a new package at `packages/dashboard` in the luqen monorepo. It uses `@luqen/core` as a library for scanning (direct import, no webservice dependency) and calls the compliance service via its REST API for jurisdiction/regulation data and compliance checks.

**Key design decisions:**

- **Fastify + Handlebars + HTMX** — server-rendered HTML with HTMX for interactivity. No JavaScript build pipeline.
- **No SPA** — progressive enhancement via HTMX. Pages work without JS, HTMX adds interactivity.
- **Local SQLite** — scan records stored locally, reports written to disk.
- **Auth via compliance service** — OAuth2 password grant flow, JWT in secure cookies.
- **Self-auditing** — the dashboard must pass its own WCAG 2.1 AA accessibility audit using luqen against the EU jurisdiction.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  @luqen/dashboard                      │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │  Routes       │  │  Views       │  │  Static Assets    │ │
│  │  /login       │  │  Handlebars  │  │  htmx.min.js      │ │
│  │  /home        │  │  templates   │  │  htmx-sse.js      │ │
│  │  /scan/*      │  │  + partials  │  │  style.css         │ │
│  │  /reports/*   │  │              │  │                   │ │
│  │  /admin/*     │  │              │  │                   │ │
│  └──────┬───────┘  └──────────────┘  └───────────────────┘ │
│         │                                                   │
│  ┌──────▼───────────────────────────────────────────────┐   │
│  │                   Core Services                       │   │
│  │  ┌──────────┐  ┌──────────────┐  ┌────────────────┐  │   │
│  │  │ Auth     │  │ Scanner      │  │ Compliance     │  │   │
│  │  │ (JWT     │  │ Orchestrator │  │ Client         │  │   │
│  │  │  cookie, │  │ (@luqen│  │ (HTTP REST     │  │   │
│  │  │  roles)  │  │  /core)      │  │  to compliance │  │   │
│  │  └──────────┘  └──────────────┘  │  service)      │  │   │
│  │                                   └────────────────┘  │   │
│  │  ┌──────────────────────────────────────────────────┐ │   │
│  │  │ SQLite DB (scan records, local state)            │ │   │
│  │  └──────────────────────────────────────────────────┘ │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                             │
│  External Dependencies:                                      │
│  ┌─────────────────┐  ┌──────────────────────────────────┐  │
│  │ @luqen/core│  │ Compliance Service (REST API)    │  │
│  │ (workspace dep)  │  │ http://localhost:4000             │  │
│  └─────────────────┘  └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Request Flow

```
Browser                    Dashboard (Fastify)              Compliance Service
  │                              │                                │
  │  GET /reports                │                                │
  │─────────────────────────────▶│                                │
  │                              │  Verify JWT cookie             │
  │                              │  Query SQLite for scan records │
  │                              │  Render Handlebars template    │
  │  HTML response               │                                │
  │◀─────────────────────────────│                                │
  │                              │                                │
  │  POST /scan/new              │                                │
  │─────────────────────────────▶│                                │
  │                              │  Create ScanRecord (SQLite)    │
  │                              │  Spawn background scan         │
  │  302 → /scan/:id/progress    │  (luqen core)            │
  │◀─────────────────────────────│                                │
  │                              │                                │
  │  GET /scan/:id/progress      │                                │
  │  (SSE via HTMX)              │                                │
  │─────────────────────────────▶│                                │
  │  SSE: progress events        │                                │
  │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                                │
  │  SSE: scan complete          │                                │
  │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                                │
  │                              │  POST /api/v1/compliance/check │
  │                              │───────────────────────────────▶│
  │                              │  Compliance result             │
  │                              │◀───────────────────────────────│
  │                              │  Write reports to disk         │
  │                              │  Update ScanRecord             │
  │  SSE: redirect to report     │                                │
  │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                                │
```

## Data Model

### ScanRecord

Local scan history stored in SQLite.

```typescript
interface ScanRecord {
  readonly id: string;                    // UUID
  readonly siteUrl: string;              // target URL
  readonly status: 'queued' | 'running' | 'completed' | 'failed';
  readonly standard: string;             // e.g. "WCAG2AA"
  readonly jurisdictions: string[];      // e.g. ["EU", "US"]
  readonly createdBy: string;            // username from JWT
  readonly createdAt: string;            // ISO 8601
  readonly completedAt?: string;         // ISO 8601
  readonly pagesScanned?: number;
  readonly totalIssues?: number;
  readonly errors?: number;
  readonly warnings?: number;
  readonly notices?: number;
  readonly confirmedViolations?: number; // from compliance check
  readonly jsonReportPath?: string;      // path on disk
  readonly htmlReportPath?: string;      // path on disk
  readonly error?: string;               // error message if failed
}
```

**SQLite schema:**

```sql
CREATE TABLE scan_records (
  id TEXT PRIMARY KEY,
  site_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  standard TEXT NOT NULL DEFAULT 'WCAG2AA',
  jurisdictions TEXT NOT NULL DEFAULT '[]',  -- JSON array
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  pages_scanned INTEGER,
  total_issues INTEGER,
  errors INTEGER,
  warnings INTEGER,
  notices INTEGER,
  confirmed_violations INTEGER,
  json_report_path TEXT,
  html_report_path TEXT,
  error TEXT
);

CREATE INDEX idx_scan_records_status ON scan_records(status);
CREATE INDEX idx_scan_records_created_by ON scan_records(created_by);
CREATE INDEX idx_scan_records_site_url ON scan_records(site_url);
CREATE INDEX idx_scan_records_created_at ON scan_records(created_at);
```

## Authentication

### Auth Flow

The dashboard delegates authentication to the compliance service via the OAuth2 password grant.

```
Browser                    Dashboard                    Compliance Service
  │                           │                                │
  │  POST /login              │                                │
  │  username + password      │                                │
  │──────────────────────────▶│                                │
  │                           │  POST /api/v1/oauth/token      │
  │                           │  grant_type=password            │
  │                           │  username=xxx                   │
  │                           │  password=yyy                   │
  │                           │  client_id=dashboard            │
  │                           │  client_secret=zzz              │
  │                           │─────────────────────────────────▶│
  │                           │                                │
  │                           │  { access_token, refresh_token, │
  │                           │    expires_in, scope }          │
  │                           │◀─────────────────────────────────│
  │                           │                                │
  │                           │  Set httpOnly secure cookie     │
  │  302 → /home              │  with JWT                       │
  │◀──────────────────────────│                                │
```

**Password grant requirement:** The compliance service must add `password` to its supported `grantTypes`. The dashboard is registered as an OAuth client with `grantTypes: ['password']` and scopes matching the highest role level needed.

### JWT Verification

- The dashboard fetches the compliance service's public key from `GET /api/v1/oauth/jwks` on startup (cached, refreshed on verification failure).
- JWT is verified locally — no round-trip to the compliance service on every request.
- The JWT `sub` contains the user ID, and a custom `role` claim contains one of: `viewer`, `user`, `admin`.

### Cookie Configuration

```typescript
{
  httpOnly: true,
  secure: true,          // HTTPS only (configurable for dev)
  sameSite: 'strict',
  path: '/',
  maxAge: 3600,          // matches token expiry
  signed: true           // Fastify cookie signing with session secret
}
```

### Role-Based Access Control

| Role | Permissions |
|------|-------------|
| `viewer` | Browse reports, view home page, view report details, compare reports |
| `user` | All viewer permissions + create scans, delete own reports |
| `admin` | All user permissions + admin section (CRUD jurisdictions, regulations, requirements, proposals, sources, webhooks, users, OAuth clients, system health) |

### Middleware

```typescript
// Auth middleware applied to all routes except /login and /static/*
function requireAuth(request, reply): void;

// Role guard — returns 403 if user lacks required role
function requireRole(role: 'viewer' | 'user' | 'admin'): (request, reply) => void;
```

Route protection:

| Route Pattern | Required Role |
|---------------|---------------|
| `GET /login` | none |
| `GET /static/*` | none |
| `GET /home` | viewer |
| `GET /reports/*` | viewer |
| `GET /scan/new` | user |
| `POST /scan/new` | user |
| `GET /scan/:id/progress` | user |
| `DELETE /reports/:id` | user (own only) |
| `GET /admin/*` | admin |
| `POST /admin/*` | admin |
| `PUT /admin/*` | admin |
| `DELETE /admin/*` | admin |

## Pages

### User Section

#### Login (`GET /login`)

- Username and password form
- Error message display for invalid credentials
- Redirect to `/home` on success
- If already authenticated, redirect to `/home`

#### Home (`GET /home`)

- Summary statistics cards: total scans, scans this week, pages scanned, issues found
- Recent scans table (last 10), each linking to report or progress page
- Quick-launch form: URL input + "Scan Now" button (uses default settings)
- Status indicator for compliance service connectivity

#### New Scan (`GET /scan/new`, `POST /scan/new`)

- **URL input** — text field, validated as URL
- **Jurisdiction checkboxes** — fetched dynamically from compliance service `GET /api/v1/jurisdictions`. Rendered as checkbox group. Cached for 5 minutes.
- **WCAG standard dropdown** — options: WCAG2A, WCAG2AA, WCAG2AAA (default: WCAG2AA)
- **Concurrency slider** — range 1-10, default from config `maxConcurrentScans`
- Form submits `POST /scan/new`, server creates ScanRecord, spawns background scan, redirects to progress page

#### Scan Progress (`GET /scan/:id/progress`)

- Connects to SSE endpoint via HTMX `sse` extension
- Displays: current status, pages discovered, pages scanned, current URL being scanned
- Progress bar showing pages completed / total pages
- Live issue counter (errors, warnings, notices)
- Log area showing recent scan events
- On completion: auto-redirects to report viewer via SSE event
- On failure: displays error message with retry button

**SSE event format:**

```typescript
interface ScanProgressEvent {
  readonly type: 'discovery' | 'scan_start' | 'scan_complete' | 'scan_error' | 'compliance' | 'complete' | 'failed';
  readonly timestamp: string;
  readonly data: {
    readonly pagesDiscovered?: number;
    readonly pagesScanned?: number;
    readonly totalPages?: number;
    readonly currentUrl?: string;
    readonly issues?: { errors: number; warnings: number; notices: number };
    readonly confirmedViolations?: number;
    readonly reportUrl?: string;
    readonly error?: string;
  };
}
```

#### Reports List (`GET /reports`)

- Sortable table columns: site URL, status, standard, pages scanned, issues, confirmed violations, date
- Search by URL with live filtering (HTMX `hx-trigger="input changed delay:300ms"`)
- Pagination with offset/limit (HTMX `hx-get` for page navigation)
- Status filter dropdown (all, completed, failed, running)
- Delete button per row (own reports only, HTMX inline delete)
- Links to report viewer and compare

#### Report Viewer (`GET /reports/:id/view`)

- Serves the HTML report inline within the dashboard layout via an iframe or direct embed
- Download buttons for JSON and HTML report files
- Link to "Compare with previous scan" if a previous scan of the same URL exists
- Compliance summary section if jurisdictions were selected

#### Report Compare (`GET /reports/compare?a=:id&b=:id`)

- Side-by-side diff of two scans of the same site URL
- Summary cards showing delta: issues added, issues resolved, score change
- Table of issues present in scan A but not B (resolved) and vice versa (new)
- Only available for scans of the same site URL

### Admin Section

All admin pages are under `/admin/*` and require the `admin` role.

#### Jurisdictions (`GET /admin/jurisdictions`)

- CRUD table listing all jurisdictions from the compliance service
- Columns: ID, name, type, parent, regulations count
- Inline edit via HTMX (click to edit, save on blur/enter)
- Add new via modal form (HTMX `hx-get` loads form fragment into `#modal-container`)
- Delete with confirmation (`hx-confirm`)

#### Regulations (`GET /admin/regulations`)

- CRUD table filtered by jurisdiction dropdown
- Columns: ID, name, short name, jurisdiction, enforcement date, status, scope
- Inline edit, add via modal, delete with confirmation
- Same HTMX patterns as jurisdictions

#### Requirements (`GET /admin/requirements`)

- CRUD table filtered by regulation dropdown
- Columns: WCAG version, level, criterion, obligation, notes
- Add via modal, delete with confirmation

#### Update Proposals (`GET /admin/proposals`)

- List of pending proposals with status filter (pending, approved, rejected)
- Each row shows: source, type, summary, detected date, status
- Click to view full diff (structured before/after comparison)
- Approve and reject buttons with confirmation
- Approving applies the change via the compliance service API

#### Monitored Sources (`GET /admin/sources`)

- List of monitored legal sources
- Columns: name, URL, type, schedule, last checked
- Add new source via modal
- "Scan Now" button to trigger immediate scan of all sources
- Delete with confirmation

#### Webhooks (`GET /admin/webhooks`)

- List of registered webhooks
- Columns: URL, events, active status, created date
- Add new webhook via modal (URL, event selection checkboxes, secret)
- "Test" button to send a test delivery
- Delete with confirmation

#### Users (`GET /admin/users`)

- List of users from the compliance service
- Columns: username, role, created date, status
- Create new user via modal (username, password, role dropdown)
- Deactivate button (does not delete, marks inactive)

#### OAuth Clients (`GET /admin/clients`)

- List of OAuth clients
- Columns: name, client ID, scopes, grant types, created date
- Create new client via modal — **client secret shown once** in a copy-to-clipboard alert after creation
- Revoke button with confirmation

#### System Health (`GET /admin/system`)

- Service status cards: dashboard (always up), compliance service (ping health endpoint), webservice (if configured)
- Database stats: total scans, disk usage, SQLite file size
- Seed status from compliance service (`GET /api/v1/seed/status`)
- Configuration display (non-sensitive values only)
- Uptime, Node.js version, package version

## Scan Workflow

Detailed lifecycle from form submission to report completion.

### Step 1: Form Submission

User submits `POST /scan/new` with:
- `siteUrl` — validated URL
- `standard` — WCAG standard enum
- `jurisdictions[]` — array of jurisdiction IDs
- `concurrency` — number 1-10

### Step 2: Record Creation

Dashboard creates a `ScanRecord` in SQLite:
```typescript
{
  id: randomUUID(),
  siteUrl,
  status: 'queued',
  standard,
  jurisdictions,
  createdBy: request.user.username,
  createdAt: new Date().toISOString()
}
```

### Step 3: Background Scan

Dashboard spawns an async scan using `@luqen/core`:

```typescript
// Pseudocode — runs in background, not blocking the request
async function runScan(scanRecord: ScanRecord, emitter: EventEmitter): Promise<void> {
  updateStatus(scanRecord.id, 'running');

  const config = {
    siteUrl: scanRecord.siteUrl,
    standard: scanRecord.standard,
    concurrency: scanRecord.concurrency,
    onProgress: (event) => emitter.emit(`scan:${scanRecord.id}`, event)
  };

  const result = await luqenAgentCore.scan(config);

  // Write reports to disk
  const hostname = new URL(scanRecord.siteUrl).hostname;
  const jsonPath = path.join(reportsDir, `${hostname}-${scanRecord.id}.json`);
  const htmlPath = path.join(reportsDir, `${hostname}-${scanRecord.id}.html`);
  await writeFile(jsonPath, JSON.stringify(result.json));
  await writeFile(htmlPath, result.html);

  // Optional compliance check
  if (complianceUrl && scanRecord.jurisdictions.length > 0) {
    const complianceResult = await complianceClient.check({
      jurisdictions: scanRecord.jurisdictions,
      issues: result.issues
    });
    updateRecord(scanRecord.id, { confirmedViolations: complianceResult.summary.totalMandatoryViolations });
  }

  // Update record
  updateRecord(scanRecord.id, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    pagesScanned: result.pagesScanned,
    totalIssues: result.totalIssues,
    errors: result.errors,
    warnings: result.warnings,
    notices: result.notices,
    jsonReportPath: jsonPath,
    htmlReportPath: htmlPath
  });

  emitter.emit(`scan:${scanRecord.id}`, { type: 'complete', reportUrl: `/reports/${scanRecord.id}/view` });
}
```

### Step 4: Redirect

After creating the record and spawning the background scan, the server responds with `302` redirect to `GET /scan/:id/progress`.

### Step 5: SSE Progress

The progress page connects via SSE. The route handler:

```typescript
// GET /scan/:id/progress/events (SSE endpoint)
fastify.get('/scan/:id/progress/events', async (request, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const listener = (event: ScanProgressEvent) => {
    reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'complete' || event.type === 'failed') {
      reply.raw.end();
    }
  };

  emitter.on(`scan:${request.params.id}`, listener);
  request.raw.on('close', () => emitter.off(`scan:${request.params.id}`, listener));
});
```

### Step 6: Completion

On scan completion, the SSE sends a `complete` event with the report URL. The HTMX page handles this by redirecting the browser to the report viewer.

### Concurrency Limiting

A global semaphore limits concurrent scans to `maxConcurrentScans` (default: 2). If the limit is reached, new scans are queued with status `queued` and started when a slot frees up.

```typescript
class ScanQueue {
  private readonly maxConcurrent: number;
  private running: number = 0;
  private readonly queue: Array<() => Promise<void>> = [];

  async enqueue(scanFn: () => Promise<void>): Promise<void>;
}
```

## HTMX Patterns

All interactive elements use HTMX attributes on server-rendered HTML. No custom JavaScript.

### Inline Delete

```html
<tr id="scan-{{id}}">
  <td>{{siteUrl}}</td>
  <td>{{status}}</td>
  <td>
    <button hx-delete="/reports/{{id}}"
            hx-confirm="Delete this scan report?"
            hx-target="closest tr"
            hx-swap="outerHTML swap:500ms"
            aria-label="Delete scan for {{siteUrl}}">
      Delete
    </button>
  </td>
</tr>
```

### Live Search

```html
<input type="search"
       name="q"
       placeholder="Search by URL..."
       hx-get="/reports/search"
       hx-trigger="input changed delay:300ms"
       hx-target="#reports-table-body"
       hx-indicator="#search-spinner"
       aria-label="Search reports by URL"
       role="searchbox">
<span id="search-spinner" class="htmx-indicator" aria-hidden="true">Searching...</span>
```

### Pagination

```html
<nav aria-label="Reports pagination">
  {{#if hasPrev}}
  <a hx-get="/reports/table?offset={{prevOffset}}&limit={{limit}}"
     hx-target="#reports-table-body"
     hx-push-url="true"
     aria-label="Previous page">
    Previous
  </a>
  {{/if}}
  <span aria-current="page">Page {{currentPage}} of {{totalPages}}</span>
  {{#if hasNext}}
  <a hx-get="/reports/table?offset={{nextOffset}}&limit={{limit}}"
     hx-target="#reports-table-body"
     hx-push-url="true"
     aria-label="Next page">
    Next
  </a>
  {{/if}}
</nav>
```

### SSE Progress

```html
<div hx-ext="sse"
     sse-connect="/scan/{{id}}/progress/events"
     role="status"
     aria-live="polite"
     aria-label="Scan progress">

  <div sse-swap="scan_start" hx-swap="innerHTML">
    Waiting for scan to start...
  </div>

  <div sse-swap="scan_complete" hx-swap="innerHTML">
    <!-- Updated with page-level results as they complete -->
  </div>

  <div sse-swap="complete" hx-swap="none">
    <!-- Triggers redirect via response header -->
  </div>
</div>
```

### Modal Forms

```html
<!-- Trigger button -->
<button hx-get="/admin/jurisdictions/new"
        hx-target="#modal-container"
        hx-swap="innerHTML"
        aria-haspopup="dialog">
  Add Jurisdiction
</button>

<!-- Modal container -->
<div id="modal-container" role="dialog" aria-modal="true" aria-labelledby="modal-title">
  <!-- Fragment loaded by HTMX -->
</div>
```

### Toast Notifications

Server responses include out-of-band swap for toast messages:

```html
<!-- In the response body -->
<div id="toast" hx-swap-oob="true" role="alert" aria-live="assertive" class="toast toast--success">
  Jurisdiction created successfully.
</div>
```

### ARIA Live Regions

All HTMX swap targets that update dynamic content include ARIA live regions:

```html
<div id="reports-table-body" aria-live="polite" aria-atomic="false">
  <!-- Table rows updated by HTMX -->
</div>
```

## Compliance Client

HTTP client for the compliance service REST API.

```typescript
class ComplianceClient {
  constructor(private readonly baseUrl: string, private readonly clientId: string, private readonly clientSecret: string);

  // Token management — client_credentials flow for service-to-service calls
  private async getToken(): Promise<string>;

  // Jurisdictions
  async listJurisdictions(): Promise<Jurisdiction[]>;
  async createJurisdiction(data: CreateJurisdictionInput): Promise<Jurisdiction>;
  async updateJurisdiction(id: string, data: Partial<CreateJurisdictionInput>): Promise<Jurisdiction>;
  async deleteJurisdiction(id: string): Promise<void>;

  // Regulations
  async listRegulations(filters?: RegulationFilters): Promise<Regulation[]>;
  async createRegulation(data: CreateRegulationInput): Promise<Regulation>;
  async updateRegulation(id: string, data: Partial<CreateRegulationInput>): Promise<Regulation>;
  async deleteRegulation(id: string): Promise<void>;

  // Requirements
  async listRequirements(filters?: RequirementFilters): Promise<Requirement[]>;
  async createRequirement(data: CreateRequirementInput): Promise<Requirement>;
  async deleteRequirement(id: string): Promise<void>;

  // Compliance check
  async check(request: ComplianceCheckRequest): Promise<ComplianceCheckResponse>;

  // Update proposals
  async listProposals(status?: string): Promise<UpdateProposal[]>;
  async approveProposal(id: string): Promise<UpdateProposal>;
  async rejectProposal(id: string): Promise<UpdateProposal>;

  // Monitored sources
  async listSources(): Promise<MonitoredSource[]>;
  async createSource(data: CreateSourceInput): Promise<MonitoredSource>;
  async deleteSource(id: string): Promise<void>;
  async scanSources(): Promise<{ scanned: number; proposalsCreated: number }>;

  // Webhooks
  async listWebhooks(): Promise<Webhook[]>;
  async createWebhook(data: CreateWebhookInput): Promise<Webhook>;
  async deleteWebhook(id: string): Promise<void>;
  async testWebhook(id: string): Promise<void>;

  // Users
  async listUsers(): Promise<User[]>;
  async createUser(data: CreateUserInput): Promise<User>;
  async deactivateUser(id: string): Promise<void>;

  // OAuth clients
  async listClients(): Promise<OAuthClient[]>;
  async createClient(data: CreateClientInput): Promise<OAuthClient & { secret: string }>;
  async revokeClient(id: string): Promise<void>;

  // System
  async health(): Promise<{ status: string }>;
  async seedStatus(): Promise<{ seeded: boolean; jurisdictions: number; regulations: number; requirements: number }>;
}
```

The compliance client uses its own OAuth2 client credentials (separate from the user's session) for admin-level operations. For user-scoped operations, it forwards the user's JWT from the cookie.

## Accessibility

The dashboard must meet WCAG 2.1 AA. Since it is built by the luqen ecosystem, it must pass its own audit.

### Requirements

- **Semantic HTML** — use `<nav>`, `<main>`, `<header>`, `<footer>`, `<section>`, `<article>`, `<aside>` appropriately
- **Skip links** — "Skip to main content" link as the first focusable element
- **ARIA landmarks** — `role="banner"`, `role="navigation"`, `role="main"`, `role="contentinfo"` on all pages
- **Focus management** — focus moved to modal content on open, returned to trigger on close. Focus visible on all interactive elements.
- **Keyboard navigation** — all interactive elements reachable via Tab. Modal traps focus. Escape closes modals. Arrow keys for dropdowns.
- **Color** — never the sole indicator of state. Icons and text labels accompany all color-coded status indicators.
- **Contrast** — minimum 4.5:1 for normal text, 3:1 for large text (18px+ or 14px+ bold)
- **Form labels** — every input has an associated `<label>` with `for` attribute
- **Error messages** — associated with inputs via `aria-describedby`, announced via `aria-live="assertive"`
- **Tables** — use `<th scope="col">` and `<th scope="row">` headers. Caption via `<caption>` or `aria-label`.
- **Images** — all `<img>` tags have `alt` attributes. Decorative images use `alt=""` and `aria-hidden="true"`.
- **ARIA live regions** — all dynamically updated content areas (HTMX swap targets) marked with `aria-live="polite"` or `aria-live="assertive"` as appropriate
- **Reduced motion** — respect `prefers-reduced-motion` media query, disable CSS transitions/animations

### Acceptance Criterion

Zero confirmed violations when scanning the dashboard itself against the EU jurisdiction using luqen:

```bash
luqen scan http://localhost:5000 --compliance-url http://localhost:4000 --jurisdictions EU
```

## Configuration

### Config File (`dashboard.config.json`)

```json
{
  "port": 5000,
  "complianceUrl": "http://localhost:4000",
  "webserviceUrl": "http://localhost:3000",
  "reportsDir": "./reports",
  "dbPath": "./dashboard.db",
  "sessionSecret": "change-me-32-bytes-minimum-length",
  "maxConcurrentScans": 2,
  "complianceClientId": "",
  "complianceClientSecret": ""
}
```

### Environment Variable Overrides

| Variable | Overrides | Description |
|----------|-----------|-------------|
| `DASHBOARD_PORT` | `port` | Server port |
| `DASHBOARD_COMPLIANCE_URL` | `complianceUrl` | Compliance service base URL |
| `DASHBOARD_WEBSERVICE_URL` | `webserviceUrl` | Pa11y webservice URL (optional, used for system health) |
| `DASHBOARD_REPORTS_DIR` | `reportsDir` | Directory for report file storage |
| `DASHBOARD_DB_PATH` | `dbPath` | SQLite database file path |
| `DASHBOARD_SESSION_SECRET` | `sessionSecret` | Cookie signing secret (min 32 bytes) |
| `DASHBOARD_MAX_CONCURRENT_SCANS` | `maxConcurrentScans` | Max parallel scan limit |
| `DASHBOARD_COMPLIANCE_CLIENT_ID` | `complianceClientId` | OAuth2 client ID for compliance service |
| `DASHBOARD_COMPLIANCE_CLIENT_SECRET` | `complianceClientSecret` | OAuth2 client secret for compliance service |

**Precedence:** Environment variables > config file > defaults.

### Validation

On startup, the dashboard validates:
- `sessionSecret` is at least 32 bytes
- `reportsDir` exists and is writable (created if missing)
- `dbPath` parent directory exists and is writable
- `complianceUrl` is a valid URL (connectivity checked but not required for startup)

Missing or invalid required config causes a startup error with a clear message.

## CLI

```bash
# Start the server
luqen-dashboard serve                    # uses dashboard.config.json
luqen-dashboard serve --port 5000        # override port
luqen-dashboard serve --config /path/to/config.json

# Database migration
luqen-dashboard migrate                  # create/update SQLite schema
luqen-dashboard migrate --db-path ./dashboard.db
```

### `serve` Command

1. Load config (file + env overrides)
2. Validate config
3. Run SQLite migration (idempotent)
4. Initialize compliance client
5. Register Fastify plugins (view, static, formbody, secure-session)
6. Register routes
7. Start listening

### `migrate` Command

1. Load config
2. Open SQLite connection
3. Run schema creation (CREATE TABLE IF NOT EXISTS)
4. Report tables created/updated

## Package Structure

```
packages/dashboard/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── Dockerfile
├── src/
│   ├── server.ts                        # Fastify app factory
│   ├── config.ts                        # Config loading + validation
│   ├── cli.ts                           # Commander CLI entry point
│   ├── auth/
│   │   ├── middleware.ts                # JWT verification, role guards
│   │   └── session.ts                   # Cookie management
│   ├── db/
│   │   └── scans.ts                     # ScanRecord CRUD (better-sqlite3)
│   ├── scanner/
│   │   └── orchestrator.ts              # Background scan lifecycle + queue
│   ├── compliance-client.ts             # HTTP client for compliance service
│   ├── routes/
│   │   ├── auth.ts                      # GET /login, POST /login, POST /logout
│   │   ├── home.ts                      # GET /home
│   │   ├── scan.ts                      # GET /scan/new, POST /scan/new, GET /scan/:id/progress
│   │   ├── reports.ts                   # GET /reports, GET /reports/:id/view, GET /reports/compare, DELETE /reports/:id
│   │   └── admin/
│   │       ├── jurisdictions.ts         # CRUD jurisdictions
│   │       ├── regulations.ts           # CRUD regulations
│   │       ├── requirements.ts          # CRUD requirements
│   │       ├── proposals.ts             # List, approve, reject proposals
│   │       ├── sources.ts               # CRUD monitored sources
│   │       ├── webhooks.ts              # CRUD webhooks + test delivery
│   │       ├── users.ts                 # List, create, deactivate users
│   │       ├── clients.ts              # List, create, revoke OAuth clients
│   │       └── system.ts               # System health page
│   ├── views/
│   │   ├── layouts/
│   │   │   └── main.hbs                # Base layout (head, sidebar, main, footer)
│   │   ├── partials/
│   │   │   ├── sidebar.hbs             # Navigation sidebar (role-aware)
│   │   │   ├── pagination.hbs          # Reusable pagination controls
│   │   │   ├── scan-progress.hbs       # SSE progress fragment
│   │   │   ├── toast.hbs               # Toast notification fragment
│   │   │   └── modal.hbs               # Modal container fragment
│   │   ├── login.hbs
│   │   ├── home.hbs
│   │   ├── scan-new.hbs
│   │   ├── scan-progress.hbs
│   │   ├── reports-list.hbs
│   │   ├── report-view.hbs
│   │   ├── report-compare.hbs
│   │   └── admin/
│   │       ├── jurisdictions.hbs
│   │       ├── regulations.hbs
│   │       ├── requirements.hbs
│   │       ├── proposals.hbs
│   │       ├── proposal-detail.hbs
│   │       ├── sources.hbs
│   │       ├── webhooks.hbs
│   │       ├── users.hbs
│   │       ├── clients.hbs
│   │       └── system.hbs
│   └── static/
│       ├── htmx.min.js                  # Vendored HTMX (no CDN dependency)
│       ├── htmx-sse.js                  # HTMX SSE extension
│       └── style.css                    # Single CSS file
└── tests/
    ├── unit/
    │   ├── config.test.ts
    │   ├── scans-db.test.ts
    │   ├── orchestrator.test.ts
    │   ├── compliance-client.test.ts
    │   └── auth-middleware.test.ts
    ├── integration/
    │   ├── auth-routes.test.ts
    │   ├── scan-routes.test.ts
    │   ├── report-routes.test.ts
    │   └── admin-routes.test.ts
    └── e2e/
        ├── login-flow.test.ts
        ├── scan-flow.test.ts
        └── admin-flow.test.ts
```

## Dependencies

```json
{
  "dependencies": {
    "fastify": "^5.x",
    "@fastify/view": "^10.x",
    "@fastify/static": "^8.x",
    "@fastify/secure-session": "^8.x",
    "@fastify/formbody": "^8.x",
    "@fastify/cookie": "^11.x",
    "better-sqlite3": "^11.x",
    "handlebars": "^4.x",
    "commander": "^13.x",
    "jose": "^6.x",
    "@luqen/core": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^3.x",
    "typescript": "^5.x",
    "@types/better-sqlite3": "^7.x"
  }
}
```

## Responsive Design

### Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| Mobile | < 768px | Sidebar collapses to hamburger menu, single column, stacked cards |
| Tablet | 768px - 1024px | Sidebar collapsed by default, two-column cards |
| Desktop | > 1024px | Sidebar visible, full table layouts, multi-column cards |

### Dark Mode

Implemented via `prefers-color-scheme` media query in CSS. No toggle — follows system preference.

```css
:root {
  --bg-primary: #ffffff;
  --text-primary: #1a1a1a;
  --accent: #0056b3;
  /* ... */
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #1a1a2e;
    --text-primary: #e0e0e0;
    --accent: #4da6ff;
    /* ... */
  }
}
```

### Print Styles

Report view page includes print-specific CSS:
- Hide sidebar, header, footer, navigation
- Full-width report content
- Use serif font for readability
- Page breaks between major sections

```css
@media print {
  .sidebar, .header, .footer, nav { display: none; }
  main { width: 100%; margin: 0; padding: 0; }
  /* ... */
}
```

## Acceptance Criteria

1. **Login with valid credentials** — POST /login with correct username/password redirects to /home with session cookie set.
2. **Login with invalid credentials** — POST /login with wrong credentials shows error message on login page, no cookie set.
3. **Viewer cannot access /scan/new** — a viewer-role user requesting GET /scan/new receives 403 Forbidden.
4. **User can create new scan** — a user-role user can POST /scan/new, scan record created in SQLite with status "queued".
5. **Scan progress shows live SSE updates** — GET /scan/:id/progress/events returns SSE stream with discovery, scan_start, scan_complete events as scan progresses.
6. **Scan completion creates JSON + HTML reports** — after scan completes, both report files exist on disk at paths recorded in ScanRecord.
7. **Reports list shows all scans, sortable, searchable** — GET /reports returns paginated table, HTMX search filters by URL without full page reload.
8. **Report viewer shows HTML report inline** — GET /reports/:id/view renders the HTML report within the dashboard layout.
9. **User can delete own reports** — DELETE /reports/:id succeeds for reports created by the authenticated user, returns 403 for others' reports.
10. **Admin sees admin section in sidebar** — admin-role user sees admin navigation links; viewer and user roles do not.
11. **Admin can CRUD jurisdictions** — full create, read, update, delete cycle via /admin/jurisdictions with compliance service API calls.
12. **Admin can approve/reject proposals** — admin can view proposal diff and approve (change applied) or reject.
13. **Admin can create/revoke OAuth clients** — create shows secret once, revoke disables the client.
14. **Admin can create users with roles** — admin creates user with viewer/user/admin role via the compliance service.
15. **Non-admin gets 403 on admin routes** — viewer or user accessing /admin/* receives 403 Forbidden.
16. **Session expires after token expiry** — after JWT expiry, subsequent requests redirect to /login.
17. **HTMX search filters table without page reload** — typing in the search input triggers HTMX request, table body updates without navigation.
18. **SSE connection auto-reconnects on drop** — if SSE connection drops, HTMX reconnects automatically (built-in HTMX SSE behavior).
19. **Dashboard passes WCAG 2.1 AA self-audit** — scanning the dashboard with luqen against EU jurisdiction produces zero confirmed violations.
20. **Responsive layout works on mobile** — all pages render correctly at 375px viewport width with no horizontal scrolling.
21. **Dark mode via prefers-color-scheme** — switching system dark mode preference updates dashboard colors without reload.
22. **Print-friendly report view** — printing the report viewer page produces a clean report without navigation chrome.

## Non-Goals

- **Real-time collaboration** — no WebSocket-based multi-user editing or live cursors.
- **Multi-tenant deployment** — single-tenant only; all users share the same scan history.
- **Custom report templates** — reports use the standard luqen HTML template.
- **Email notifications** — use webhooks instead; email delivery is out of scope.
- **API for the dashboard itself** — the compliance service REST API covers programmatic access; the dashboard is a UI-only consumer.
