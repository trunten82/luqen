# Pally Compliance Service — Design Specification (Milestone 1)

## Overview

The Compliance Service is a standalone accessibility compliance rule engine that maps WCAG technical issues to country-specific legal requirements. It stores regulations for 60+ jurisdictions, marks requirements as mandatory/recommended/optional, and provides a compliance check that annotates pa11y scan results with legal context and a per-jurisdiction pass/fail matrix.

It is an independent service consumed by pally-agent, Power Automate, n8n, or any HTTP/MCP/A2A client. It is **not** embedded in pally-agent — pally-agent is one of its clients.

**Milestone scope:** Database, rule engine, REST API with OAuth2, OpenAPI docs, MCP server, A2A agent, baseline seed data, CLI admin, pluggable DB adapters.

**Out of scope for this milestone:** Regulatory Monitor Agent, pally-agent integration, CI/CD pipelines, Kubernetes/serverless manifests. These are milestones 2 and 3.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│               @pally-agent/compliance                   │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  REST API     │  │  MCP Server  │  │  A2A Agent    │ │
│  │  /api/v1/...  │  │  (tools)     │  │  (agent card) │ │
│  │  OAuth2       │  │  stdio/SSE   │  │  tasks API    │ │
│  │  OpenAPI/Swagger│ │              │  │  discovery    │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘ │
│         │                 │                  │          │
│  ┌──────▼─────────────────▼──────────────────▼────────┐ │
│  │                   Core Engine                      │ │
│  │  ┌─────────┐ ┌──────────┐ ┌────────────────────┐  │ │
│  │  │ Matcher │ │ Checker  │ │ Update Proposals   │  │ │
│  │  │ (code→  │ │ (issues  │ │ (propose/approve/  │  │ │
│  │  │  WCAG)  │ │  →legal) │ │  reject changes)   │  │ │
│  │  └─────────┘ └──────────┘ └────────────────────┘  │ │
│  └────────────────────────┬───────────────────────────┘ │
│                           │                             │
│  ┌────────────────────────▼───────────────────────────┐ │
│  │              DB Adapter Interface                  │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │ │
│  │  │  SQLite  │  │ MongoDB  │  │   PostgreSQL     │ │ │
│  │  │ (default)│  │          │  │                  │ │ │
│  │  └──────────┘  └──────────┘  └──────────────────┘ │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Data Model

### Jurisdiction

Represents a country or supranational body.

```typescript
interface Jurisdiction {
  readonly id: string;              // e.g. "EU", "US", "DE", "UK"
  readonly name: string;            // e.g. "European Union"
  readonly type: 'supranational' | 'country' | 'state';
  readonly parentId?: string;       // e.g. "DE" → parent "EU"
  readonly iso3166?: string;        // ISO country code
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

Inheritance: when checking compliance for "DE" (Germany), the engine also includes all EU-level regulations via `parentId`.

### Regulation

A specific law, directive, or standard.

```typescript
interface Regulation {
  readonly id: string;              // e.g. "eu-eaa", "us-508", "uk-equality-act"
  readonly jurisdictionId: string;
  readonly name: string;            // e.g. "European Accessibility Act"
  readonly shortName: string;       // e.g. "EAA"
  readonly reference: string;       // e.g. "Directive (EU) 2019/882"
  readonly url: string;             // link to official text
  readonly enforcementDate: string; // ISO 8601
  readonly status: 'active' | 'draft' | 'repealed';
  readonly scope: 'public' | 'private' | 'all';
  readonly sectors: readonly string[];  // e.g. ["e-commerce", "banking"]
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

### Requirement

Maps a regulation to specific WCAG success criteria.

```typescript
interface Requirement {
  readonly id: string;              // auto-generated
  readonly regulationId: string;
  readonly wcagVersion: '2.0' | '2.1' | '2.2';
  readonly wcagLevel: 'A' | 'AA' | 'AAA';
  readonly wcagCriterion: string;   // e.g. "1.1.1" (specific) or "*" (all criteria at level)
  readonly obligation: 'mandatory' | 'recommended' | 'optional';
  readonly notes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

When `wcagCriterion` is `"*"`, it means the regulation requires ALL criteria at the specified level **and all levels below it** (e.g. EU EAA requires WCAG 2.1 AA, which implicitly includes all A-level criteria). A `"*"` requirement at level AA matches issues from both `WCAG2A` and `WCAG2AA` codes. A `"*"` at level AAA matches all three levels.

### UpdateProposal

A proposed change to the rule database, pending human review.

```typescript
interface UpdateProposal {
  readonly id: string;
  readonly source: string;          // URL or description of where change was detected
  readonly detectedAt: string;
  readonly type: 'new_regulation' | 'amendment' | 'repeal' | 'new_requirement' | 'new_jurisdiction';
  readonly affectedRegulationId?: string;
  readonly affectedJurisdictionId?: string;
  readonly summary: string;         // human-readable description of the change
  readonly proposedChanges: ProposedChange;            // structured diff
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly reviewedBy?: string;
  readonly reviewedAt?: string;
  readonly createdAt: string;
}
```

### ProposedChange

The structured diff format used in update proposals. When approved, the engine applies this deterministically.

```typescript
interface ProposedChange {
  readonly action: 'create' | 'update' | 'delete';
  readonly entityType: 'jurisdiction' | 'regulation' | 'requirement';
  readonly entityId?: string;              // required for update/delete
  readonly before?: Record<string, unknown>; // current state (for update/delete)
  readonly after?: Record<string, unknown>;  // new state (for create/update)
}
```

The `approve` endpoint reads `action` and `entityType` to dispatch to the correct CRUD operation. For `update`, only fields present in `after` are changed. For `create`, `after` must contain all required fields for the entity type. For `delete`, only `entityId` is needed.

### Webhook

Registered webhook for event notifications.

```typescript
interface Webhook {
  readonly id: string;
  readonly url: string;               // POST target URL
  readonly secret: string;            // shared secret for HMAC-SHA256 signature
  readonly events: readonly string[]; // e.g. ["update.proposed", "regulation.created"]
  readonly active: boolean;
  readonly createdAt: string;
}
```

Webhook delivery: POST to `url` with JSON body and `X-Webhook-Signature` header containing `sha256=<hex>` where the hex value is `HMAC-SHA256(body, secret)`. The receiver must verify the signature matches before trusting the payload. Delivery retries 3 times with exponential backoff on 5xx or timeout.

### MonitoredSource

A legal source URL to check for changes.

```typescript
interface MonitoredSource {
  readonly id: string;
  readonly name: string;            // e.g. "W3C WAI Policies"
  readonly url: string;
  readonly type: 'html' | 'rss' | 'api';
  readonly schedule: 'daily' | 'weekly' | 'monthly';
  readonly lastCheckedAt?: string;
  readonly lastContentHash?: string; // SHA-256 of last fetched content
  readonly createdAt: string;
}
```

### OAuthClient

Registered OAuth2 clients.

```typescript
interface OAuthClient {
  readonly id: string;              // client_id
  readonly name: string;
  readonly secretHash: string;      // bcrypt hash of client_secret
  readonly scopes: readonly string[];
  readonly grantTypes: readonly ('client_credentials' | 'authorization_code')[];
  readonly redirectUris?: readonly string[];
  readonly createdAt: string;
}
```

### User

For Authorization Code flow (admin UI).

```typescript
interface User {
  readonly id: string;
  readonly username: string;
  readonly passwordHash: string;    // bcrypt
  readonly role: 'admin' | 'editor' | 'viewer';
  readonly createdAt: string;
}
```

## WCAG Criterion Mapping

Pa11y issue codes follow the pattern: `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37`

The matcher extracts the WCAG success criterion from this code:
- `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37` → criterion `1.1.1`
- `WCAG2AA.Principle1.Guideline1_3.1_3_1.H44.NonExistent` → criterion `1.3.1`
- `WCAG2AA.Principle3.Guideline3_1.3_1_1.H57.2` → criterion `3.1.1`

Extraction rule: the code segment after `Guideline` contains the criterion as `X_Y_Z` → `X.Y.Z`. The segment matching pattern `/(\d+_\d+_\d+)/` captures the criterion.

The matcher also extracts the WCAG level from the prefix: `WCAG2A` → A, `WCAG2AA` → AA, `WCAG2AAA` → AAA.

## REST API

Base path: `/api/v1`

### Pagination

All list endpoints support pagination via query parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `limit` | `50` | Max items per page (max 200) |
| `offset` | `0` | Number of items to skip |

Response envelope for list endpoints:

```typescript
interface PaginatedResponse<T> {
  readonly data: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}
```

### Jurisdictions

| Method | Path | Auth Scope | Description |
|--------|------|------------|-------------|
| `GET` | `/jurisdictions` | `read` | List all. Filters: `?type=country&parentId=EU` |
| `GET` | `/jurisdictions/:id` | `read` | Single jurisdiction with regulations count |
| `POST` | `/jurisdictions` | `write` | Create |
| `PATCH` | `/jurisdictions/:id` | `write` | Update |
| `DELETE` | `/jurisdictions/:id` | `admin` | Remove (cascades to regulations/requirements) |

### Regulations

| Method | Path | Auth Scope | Description |
|--------|------|------------|-------------|
| `GET` | `/regulations` | `read` | List. Filters: `?jurisdictionId=EU&status=active&scope=all` |
| `GET` | `/regulations/:id` | `read` | Single regulation with requirements |
| `POST` | `/regulations` | `write` | Create |
| `PATCH` | `/regulations/:id` | `write` | Update |
| `DELETE` | `/regulations/:id` | `admin` | Remove (cascades to requirements) |

### Requirements

| Method | Path | Auth Scope | Description |
|--------|------|------------|-------------|
| `GET` | `/requirements` | `read` | List. Filters: `?regulationId=eu-eaa&wcagCriterion=1.1.1&obligation=mandatory` |
| `GET` | `/requirements/:id` | `read` | Single requirement with regulation metadata |
| `POST` | `/requirements` | `write` | Create |
| `PATCH` | `/requirements/:id` | `write` | Update |
| `DELETE` | `/requirements/:id` | `admin` | Remove |
| `POST` | `/requirements/bulk` | `admin` | Bulk import (array of requirements) |

### Compliance Check

| Method | Path | Auth Scope | Description |
|--------|------|------------|-------------|
| `POST` | `/compliance/check` | `read` | Core endpoint — check issues against jurisdictions |

**Request:**

```typescript
interface ComplianceCheckRequest {
  readonly jurisdictions: readonly string[];   // ["EU", "US", "UK"]
  readonly issues: readonly {
    readonly code: string;          // pa11y issue code
    readonly type: string;          // "error" | "warning" | "notice"
    readonly message: string;
    readonly selector: string;
    readonly context: string;
    readonly url?: string;          // page URL (for per-page grouping)
  }[];
  readonly includeOptional?: boolean;  // include optional requirements (default: false)
  readonly sectors?: readonly string[];  // filter regulations by sector
}
```

**Response:**

```typescript
interface ComplianceCheckResponse {
  readonly matrix: Record<string, JurisdictionResult>;
  readonly annotatedIssues: readonly AnnotatedIssue[];
  readonly summary: {
    readonly totalJurisdictions: number;
    readonly passing: number;
    readonly failing: number;
    readonly totalMandatoryViolations: number;
    readonly totalOptionalViolations: number;
  };
}

interface JurisdictionResult {
  readonly jurisdictionId: string;
  readonly jurisdictionName: string;
  readonly status: 'pass' | 'fail';
  readonly mandatoryViolations: number;
  readonly recommendedViolations: number;
  readonly optionalViolations: number;
  readonly regulations: readonly RegulationResult[];
}

interface RegulationResult {
  readonly regulationId: string;
  readonly regulationName: string;
  readonly shortName: string;
  readonly status: 'pass' | 'fail';
  readonly enforcementDate: string;
  readonly scope: string;
  readonly violations: readonly {
    readonly wcagCriterion: string;
    readonly obligation: 'mandatory' | 'recommended' | 'optional';
    readonly issueCount: number;
  }[];
}

interface AnnotatedIssue {
  readonly code: string;
  readonly wcagCriterion: string;
  readonly wcagLevel: string;
  readonly originalIssue: Record<string, unknown>;
  readonly regulations: readonly {
    readonly regulationId: string;
    readonly regulationName: string;
    readonly shortName: string;
    readonly jurisdictionId: string;
    readonly obligation: 'mandatory' | 'recommended' | 'optional';
    readonly enforcementDate: string;
  }[];
}
```

### Update Proposals

| Method | Path | Auth Scope | Description |
|--------|------|------------|-------------|
| `POST` | `/updates/propose` | `write` | Submit a proposed change |
| `GET` | `/updates` | `read` | List all proposals. Filter: `?status=pending\|approved\|rejected` |
| `GET` | `/updates/:id` | `read` | Single proposal with full diff |
| `PATCH` | `/updates/:id/approve` | `admin` | Approve and apply |
| `PATCH` | `/updates/:id/reject` | `admin` | Reject |

### Monitored Sources

| Method | Path | Auth Scope | Description |
|--------|------|------------|-------------|
| `GET` | `/sources` | `read` | List monitored sources |
| `POST` | `/sources` | `admin` | Add a source |
| `DELETE` | `/sources/:id` | `admin` | Remove |
| `POST` | `/sources/scan` | `admin` | Trigger a scan of all sources. Synchronous. Returns `{ scanned: number, proposalsCreated: number, proposals: UpdateProposal[] }`. For each source, fetches content, computes SHA-256, compares to `lastContentHash`. If changed, creates an `UpdateProposal` with `type: "amendment"` and the raw content diff in `proposedChanges`. |

### Seed

| Method | Path | Auth Scope | Description |
|--------|------|------------|-------------|
| `POST` | `/seed` | `admin` | Load baseline dataset (idempotent) |
| `GET` | `/seed/status` | `read` | Check if baseline is loaded + counts |

### OAuth2

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/oauth/token` | none | Token endpoint (client_credentials or authorization_code) |
| `GET` | `/oauth/authorize` | none | Authorization endpoint (PKCE flow) |
| `POST` | `/oauth/revoke` | bearer | Revoke a token |

### Meta (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/openapi.json` | OpenAPI 3.1 spec |
| `GET` | `/docs` | Swagger UI |

### Webhooks

| Method | Path | Auth Scope | Description |
|--------|------|------------|-------------|
| `GET` | `/webhooks` | `admin` | List registered webhooks |
| `POST` | `/webhooks` | `admin` | Register a webhook |
| `DELETE` | `/webhooks/:id` | `admin` | Remove |

**Webhook events:** `update.proposed`, `update.approved`, `update.rejected`, `source.scanned`, `regulation.created`, `regulation.updated`

**Webhook payload:**
```typescript
interface WebhookPayload {
  readonly event: string;
  readonly timestamp: string;
  readonly data: Record<string, unknown>;
}
```

Webhooks are called with `POST` to the registered URL, with the payload as JSON body and an `X-Webhook-Signature` header (HMAC-SHA256 of the body using a shared secret set at registration).

## OAuth2 Implementation

### Client Credentials Flow (service-to-service)

```
Client                          Compliance Service
  │                                    │
  │ POST /api/v1/oauth/token           │
  │ grant_type=client_credentials      │
  │ client_id=xxx                      │
  │ client_secret=yyy                  │
  │ scope=read                         │
  │───────────────────────────────────▶│
  │                                    │
  │ { access_token, token_type,        │
  │   expires_in, scope }              │
  │◀───────────────────────────────────│
  │                                    │
  │ GET /api/v1/regulations            │
  │ Authorization: Bearer <token>      │
  │───────────────────────────────────▶│
```

### Authorization Code + PKCE Flow (interactive)

```
Browser                         Compliance Service
  │                                    │
  │ GET /api/v1/oauth/authorize        │
  │ ?response_type=code                │
  │ &client_id=xxx                     │
  │ &redirect_uri=http://...           │
  │ &code_challenge=yyy                │
  │ &code_challenge_method=S256        │
  │───────────────────────────────────▶│
  │                                    │
  │ Login page → user authenticates    │
  │◀───────────────────────────────────│
  │                                    │
  │ Redirect to redirect_uri?code=zzz  │
  │◀───────────────────────────────────│
  │                                    │
  │ POST /api/v1/oauth/token           │
  │ grant_type=authorization_code      │
  │ code=zzz                           │
  │ code_verifier=original_verifier    │
  │───────────────────────────────────▶│
  │                                    │
  │ { access_token, refresh_token }    │
  │◀───────────────────────────────────│
```

**Token format:** JWT containing `sub` (client_id or user_id), `scopes`, `exp`, `iat`. Signed with RS256 (asymmetric key pair, public key available at `GET /api/v1/oauth/jwks`).

**Scopes:**

| Scope | Access |
|-------|--------|
| `read` | GET endpoints, `POST /compliance/check` |
| `write` | Create/update jurisdictions, regulations, requirements, propose updates |
| `admin` | Approve/reject updates, manage clients/users, seed, manage sources/webhooks, delete |

**Token expiry:** access tokens 1 hour (configurable), refresh tokens 30 days.

**Rate limiting:** per client_id, configurable. Default: 100 req/min for `read`, 20 req/min for `write`/`admin`. Returns `429` with `Retry-After` header.

## MCP Server Tools

The compliance service also runs as an MCP server (stdio transport) for use by Claude Code and LLM agents.

| Tool | Description | Maps to |
|------|-------------|---------|
| `compliance_check` | Check pa11y issues against jurisdictions | `POST /compliance/check` |
| `compliance_list_jurisdictions` | List jurisdictions with filters | `GET /jurisdictions` |
| `compliance_list_regulations` | List regulations with filters | `GET /regulations` |
| `compliance_list_requirements` | List requirements with filters | `GET /requirements` |
| `compliance_get_regulation` | Get single regulation with requirements | `GET /regulations/:id` |
| `compliance_propose_update` | Submit a proposed rule change | `POST /updates/propose` |
| `compliance_get_pending` | List pending update proposals | `GET /updates/pending` |
| `compliance_approve_update` | Approve a proposal | `PATCH /updates/:id/approve` |
| `compliance_list_sources` | List monitored legal sources | `GET /sources` |
| `compliance_add_source` | Add a monitored legal source | `POST /sources` |
| `compliance_seed` | Load baseline dataset | `POST /seed` |

MCP tools accept the same parameters as their REST equivalents.

**MCP Authentication:** When running as an MCP server (stdio transport), auth is handled via environment variables set by the MCP client:

| Env Variable | Purpose |
|---|---|
| `COMPLIANCE_MCP_CLIENT_ID` | OAuth2 client_id for MCP session |
| `COMPLIANCE_MCP_CLIENT_SECRET` | OAuth2 client_secret for MCP session |
| `COMPLIANCE_MCP_SCOPES` | Space-separated scopes (default: `read write`) |

On startup, the MCP server exchanges these credentials for an access token via the OAuth2 client_credentials flow (calling its own token endpoint internally). If the env vars are not set, the MCP server runs in **local mode** with full admin access (suitable for single-user Claude Code setups). The MCP tool count is 11 (the split of `compliance_manage_sources` into `list` and `add` adds one).

## A2A Agent

The compliance service publishes an A2A agent card at `/.well-known/agent.json`:

```json
{
  "name": "pally-compliance",
  "description": "Accessibility compliance rule engine — check WCAG issues against 60+ country-specific legal requirements, manage regulations, and monitor legal changes",
  "url": "http://localhost:4000",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "authentication": {
    "schemes": ["oauth2"],
    "tokenEndpoint": "/api/v1/oauth/token"
  },
  "skills": [
    {
      "id": "compliance-check",
      "description": "Check accessibility issues against jurisdiction requirements and return compliance matrix"
    },
    {
      "id": "regulation-lookup",
      "description": "Look up regulations and requirements by jurisdiction, sector, or WCAG criterion"
    },
    {
      "id": "update-management",
      "description": "Propose, review, approve, or reject updates to compliance rules"
    },
    {
      "id": "source-monitoring",
      "description": "Manage monitored legal sources and trigger scans for changes"
    }
  ]
}
```

**A2A Task Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/a2a/tasks` | Submit a task (skill + input) |
| `GET` | `/a2a/tasks/:id` | Get task status and result |
| `GET` | `/a2a/tasks/:id/stream` | SSE stream for task progress |
| `GET` | `/a2a/agents` | List known peer agents |

A2A tasks map to the same skill implementations as MCP tools. The A2A layer adds task lifecycle (submitted → working → completed/failed) and SSE streaming.

**OAuth2 between agents:** When pally-agent calls the compliance service via A2A, it authenticates using the client_credentials flow. The agent's `client_id`/`client_secret` are configured in its config file.

## Database Adapter Interface

```typescript
interface DbAdapter {
  // Jurisdictions
  listJurisdictions(filters?: JurisdictionFilters): Promise<Jurisdiction[]>;
  getJurisdiction(id: string): Promise<Jurisdiction | null>;
  createJurisdiction(data: CreateJurisdictionInput): Promise<Jurisdiction>;
  updateJurisdiction(id: string, data: Partial<CreateJurisdictionInput>): Promise<Jurisdiction>;
  deleteJurisdiction(id: string): Promise<void>;

  // Regulations
  listRegulations(filters?: RegulationFilters): Promise<Regulation[]>;
  getRegulation(id: string): Promise<Regulation | null>;
  createRegulation(data: CreateRegulationInput): Promise<Regulation>;
  updateRegulation(id: string, data: Partial<CreateRegulationInput>): Promise<Regulation>;
  deleteRegulation(id: string): Promise<void>;

  // Requirements
  listRequirements(filters?: RequirementFilters): Promise<Requirement[]>;
  createRequirement(data: CreateRequirementInput): Promise<Requirement>;
  updateRequirement(id: string, data: Partial<CreateRequirementInput>): Promise<Requirement>;
  deleteRequirement(id: string): Promise<void>;
  bulkCreateRequirements(data: readonly CreateRequirementInput[]): Promise<Requirement[]>;

  // Requirements by criterion (used by compliance checker)
  findRequirementsByCriteria(
    jurisdictionIds: readonly string[],
    wcagCriteria: readonly string[],
  ): Promise<RequirementWithRegulation[]>;

  // Update proposals
  listUpdateProposals(filters?: { status?: string }): Promise<UpdateProposal[]>;
  getUpdateProposal(id: string): Promise<UpdateProposal | null>;
  createUpdateProposal(data: CreateUpdateProposalInput): Promise<UpdateProposal>;
  updateUpdateProposal(id: string, data: Partial<UpdateProposal>): Promise<UpdateProposal>;

  // Monitored sources
  listSources(): Promise<MonitoredSource[]>;
  createSource(data: CreateSourceInput): Promise<MonitoredSource>;
  deleteSource(id: string): Promise<void>;
  updateSourceLastChecked(id: string, contentHash: string): Promise<void>;

  // OAuth clients
  getClientById(clientId: string): Promise<OAuthClient | null>;
  createClient(data: CreateClientInput): Promise<OAuthClient & { secret: string }>;
  listClients(): Promise<OAuthClient[]>;
  deleteClient(id: string): Promise<void>;

  // Users
  getUserByUsername(username: string): Promise<User | null>;
  createUser(data: CreateUserInput): Promise<User>;

  // Webhooks
  listWebhooks(): Promise<Webhook[]>;
  createWebhook(data: CreateWebhookInput): Promise<Webhook>;
  deleteWebhook(id: string): Promise<void>;

  // Lifecycle
  initialize(): Promise<void>;  // Create tables/collections
  close(): Promise<void>;
}
```

**Filter types:**

```typescript
interface JurisdictionFilters {
  readonly type?: 'supranational' | 'country' | 'state';
  readonly parentId?: string;
}

interface RegulationFilters {
  readonly jurisdictionId?: string;
  readonly status?: 'active' | 'draft' | 'repealed';
  readonly scope?: 'public' | 'private' | 'all';
}

interface RequirementFilters {
  readonly regulationId?: string;
  readonly wcagCriterion?: string;
  readonly obligation?: 'mandatory' | 'recommended' | 'optional';
}
```

## Compliance Checker Algorithm

```
Input: jurisdictions[], issues[]

1. Extract unique WCAG criteria from issues:
   - Parse each issue.code → extract criterion (e.g. "1.1.1")
   - Deduplicate

2. Resolve jurisdiction hierarchy:
   - For each requested jurisdiction, also include parent jurisdictions
   - e.g. "DE" → ["DE", "EU"]
   - Deduplicate

3. Query requirements:
   - Find all requirements where jurisdictionId ∈ resolved_jurisdictions
     AND (wcagCriterion ∈ extracted_criteria OR wcagCriterion = "*")
   - Join with regulation and jurisdiction data

4. Build annotated issues:
   - For each issue, find matching requirements by criterion
   - Attach regulation metadata and obligation level

5. Build jurisdiction matrix:
   - For each requested jurisdiction (plus inherited):
     - Group violations by regulation
     - Count mandatory/recommended/optional violations
     - Status = "fail" if any mandatory violations, "pass" otherwise

6. Return: { matrix, annotatedIssues, summary }
```

## Baseline Seed Data

The service ships with a comprehensive JSON file covering 60+ jurisdictions. Data sourced from the W3C WAI policy database and official legal references.

**Structure of `seed/baseline.json`:**

```json
{
  "version": "1.0.0",
  "generatedAt": "2026-03-19",
  "jurisdictions": [
    { "id": "EU", "name": "European Union", "type": "supranational" },
    { "id": "US", "name": "United States", "type": "country" },
    { "id": "DE", "name": "Germany", "type": "country", "parentId": "EU" },
    ...
  ],
  "regulations": [
    {
      "id": "eu-eaa",
      "jurisdictionId": "EU",
      "name": "European Accessibility Act",
      "shortName": "EAA",
      "reference": "Directive (EU) 2019/882",
      "url": "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32019L0882",
      "enforcementDate": "2025-06-28",
      "status": "active",
      "scope": "all",
      "sectors": ["e-commerce", "banking", "transport", "e-books", "computing"],
      "description": "Requires accessible products and services in the EU internal market"
    },
    {
      "id": "eu-wad",
      "jurisdictionId": "EU",
      "name": "Web Accessibility Directive",
      "shortName": "WAD",
      "reference": "Directive (EU) 2016/2102",
      "url": "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016L2102",
      "enforcementDate": "2016-12-22",
      "status": "active",
      "scope": "public",
      "sectors": ["government"],
      "description": "Requires public sector websites and apps to meet accessibility standards"
    },
    {
      "id": "us-508",
      "jurisdictionId": "US",
      "name": "Section 508 of the Rehabilitation Act",
      "shortName": "Section 508",
      "reference": "29 U.S.C. § 794d",
      "url": "https://www.section508.gov/",
      "enforcementDate": "1998-08-07",
      "status": "active",
      "scope": "public",
      "sectors": ["government", "procurement"],
      "description": "Requires federal agencies to make electronic and information technology accessible"
    },
    {
      "id": "us-ada",
      "jurisdictionId": "US",
      "name": "Americans with Disabilities Act",
      "shortName": "ADA",
      "reference": "42 U.S.C. § 12101",
      "url": "https://www.ada.gov/",
      "enforcementDate": "1990-07-26",
      "status": "active",
      "scope": "all",
      "sectors": ["all"],
      "description": "Prohibits discrimination against individuals with disabilities in all areas of public life"
    },
    ...
  ],
  "requirements": [
    { "regulationId": "eu-eaa", "wcagVersion": "2.1", "wcagLevel": "AA", "wcagCriterion": "*", "obligation": "mandatory" },
    { "regulationId": "eu-wad", "wcagVersion": "2.1", "wcagLevel": "AA", "wcagCriterion": "*", "obligation": "mandatory" },
    { "regulationId": "us-508", "wcagVersion": "2.0", "wcagLevel": "AA", "wcagCriterion": "*", "obligation": "mandatory" },
    { "regulationId": "us-ada", "wcagVersion": "2.1", "wcagLevel": "AA", "wcagCriterion": "*", "obligation": "mandatory", "notes": "Per DOJ Title II rule (2024)" },
    ...
  ]
}
```

The seed endpoint is idempotent — running it multiple times does not create duplicates. It uses upsert logic based on entity IDs.

## Configuration

### Config File (`compliance.config.json`)

```json
{
  "port": 4000,
  "host": "0.0.0.0",
  "dbAdapter": "sqlite",
  "dbPath": "./compliance.db",
  "jwtKeyPair": {
    "publicKeyPath": "./keys/public.pem",
    "privateKeyPath": "./keys/private.pem"
  },
  "webhookSigningKey": "change-me-in-production",
  "tokenExpiry": "1h",
  "refreshTokenExpiry": "30d",
  "rateLimit": {
    "read": 100,
    "write": 20,
    "windowMs": 60000
  },
  "cors": {
    "origin": ["http://localhost:3000"],
    "credentials": true
  },
  "a2a": {
    "enabled": true,
    "peers": []
  }
}
```

**Environment variable overrides:**

| Variable | Overrides |
|----------|-----------|
| `COMPLIANCE_PORT` | `port` |
| `COMPLIANCE_DB_ADAPTER` | `dbAdapter` (sqlite, mongodb, postgres) |
| `COMPLIANCE_DB_URL` | Connection string (MongoDB/PostgreSQL) |
| `COMPLIANCE_DB_PATH` | `dbPath` (SQLite) |
| `COMPLIANCE_JWT_PRIVATE_KEY` | Path to RS256 private key PEM |
| `COMPLIANCE_JWT_PUBLIC_KEY` | Path to RS256 public key PEM |
| `COMPLIANCE_WEBHOOK_SECRET` | `webhookSigningKey` (fallback for per-webhook secrets) |
| `COMPLIANCE_CORS_ORIGIN` | `cors.origin` (comma-separated) |

### CLI

```bash
# Start the server
pally-compliance serve                           # REST + MCP + A2A
pally-compliance serve --port 4000

# Seed baseline data
pally-compliance seed

# Manage OAuth clients
pally-compliance clients create --name "pally-agent" --scope "read" --grant client_credentials
pally-compliance clients create --name "n8n" --scope "read write" --grant client_credentials
pally-compliance clients list
pally-compliance clients revoke <client-id>

# Manage users (for Authorization Code flow)
pally-compliance users create --username admin --role admin
pally-compliance users list

# Generate JWT key pair
pally-compliance keys generate

# Run as MCP server (stdio, for Claude Code)
pally-compliance mcp
```

## Tech Stack

- **Language:** TypeScript (strict mode, ESM)
- **HTTP framework:** Fastify
- **OAuth2:** Custom authorization server built on Fastify (note: `@fastify/oauth2` is an OAuth *client* helper, not a server — the authorization server endpoints are implemented directly using `jose` for JWT and `bcrypt` for secrets)
- **OpenAPI:** `@fastify/swagger` + `@fastify/swagger-ui`
- **MCP:** `@modelcontextprotocol/sdk`
- **SQLite:** `better-sqlite3`
- **MongoDB:** `mongodb` (native driver)
- **PostgreSQL:** `pg`
- **JWT:** `jose`
- **Password hashing:** `bcrypt`
- **Validation:** `zod` (shared with Fastify via `zod-to-json-schema`)
- **Testing:** `vitest`
- **CLI:** `commander`

## Acceptance Criteria

1. **Seed:** `POST /seed` loads the baseline dataset. `GET /seed/status` returns jurisdiction/regulation/requirement counts.
2. **CRUD Jurisdictions:** Create, read, update, delete jurisdictions with parent hierarchy.
3. **CRUD Regulations:** Create, read, update, delete regulations with jurisdiction filtering.
4. **CRUD Requirements:** Create, read, update, delete requirements. Bulk import via `POST /requirements/bulk`.
5. **Compliance check:** `POST /compliance/check` with EU+US jurisdictions and pa11y issues returns a matrix with pass/fail per jurisdiction and annotated issues with regulation metadata.
6. **Jurisdiction inheritance:** Checking compliance for "DE" includes EU-level regulations.
7. **Wildcard requirements:** A requirement with `wcagCriterion: "*"` matches all criteria at that level.
8. **OAuth2 client_credentials:** Create client via CLI, obtain token via `POST /oauth/token`, use token to access endpoints.
9. **OAuth2 scope enforcement:** A `read`-scoped token cannot access `POST /regulations`.
10. **Rate limiting:** Exceeding rate limit returns `429` with `Retry-After`.
11. **OpenAPI:** `GET /openapi.json` returns valid OpenAPI 3.1 spec. `GET /docs` renders Swagger UI.
12. **MCP tools:** All 11 MCP tools are registered and callable.
13. **A2A agent card:** `GET /.well-known/agent.json` returns valid agent card.
14. **A2A tasks:** `POST /a2a/tasks` with `compliance-check` skill executes and returns result.
15. **Update proposals:** Submit, list pending, approve (applies change), reject.
16. **Webhooks:** Register webhook, trigger event, verify POST received with signature.
17. **DB adapters:** SQLite works by default. MongoDB and PostgreSQL adapters pass a shared adapter contract test suite (a single test file parameterized by adapter type, run via `DB_ADAPTER=mongodb vitest run tests/db/adapter-contract.test.ts`).
18. **CLI:** `serve`, `seed`, `clients create/list/revoke`, `users create`, `keys generate`, `mcp` commands work.
19. **Health:** `GET /health` returns 200 without auth.
20. **Criterion extraction:** Pa11y code `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37` correctly maps to criterion `1.1.1`.
21. **includeOptional filter:** Compliance check with `includeOptional: false` (default) excludes optional-obligation violations from the matrix count and annotated issues. With `includeOptional: true`, they are included.
22. **sectors filter:** Compliance check with `sectors: ["banking"]` only matches regulations whose `sectors` array includes "banking".
23. **Pagination:** `GET /regulations?limit=5&offset=10` returns at most 5 items starting from offset 10, with correct `total` count.
24. **Webhook signature verification:** A webhook payload with a tampered body fails HMAC-SHA256 verification against the `X-Webhook-Signature` header.
25. **ProposedChange apply:** Approving an update proposal with `action: "update"` and `entityType: "regulation"` modifies only the fields in `after`, leaving other fields unchanged.
26. **Wildcard level inheritance:** A `wcagCriterion: "*"` requirement at level AA matches issues from both WCAG2A and WCAG2AA codes.

## Documentation Deliverables

The following documentation must be produced as part of this milestone:

### 1. Product Documentation (`docs/compliance/README.md`)

Comprehensive documentation covering:

- **Overview** — what the compliance service is, the problem it solves, how it fits in the pally ecosystem
- **Getting Started** — prerequisites, installation (npm, Docker, from source), first-run walkthrough
- **Configuration** — all config fields, env vars, precedence order, example configs
- **Authentication** — OAuth2 setup, creating clients, obtaining tokens, scope reference
- **REST API Reference** — every endpoint with request/response examples
- **Compliance Check Guide** — how to check issues, reading the matrix, understanding obligation levels
- **Data Model** — jurisdictions, regulations, requirements with relationship diagrams
- **MCP Server** — setup in Claude Code, all 11 tools with examples
- **A2A Agent** — agent card, task flow, peer discovery, inter-agent auth
- **Database Adapters** — SQLite (default), switching to MongoDB or PostgreSQL
- **Baseline Data** — what's included, how to seed, how to verify
- **Update Proposals** — workflow for proposing, reviewing, approving/rejecting changes
- **Monitored Sources** — adding sources, scanning for changes
- **Webhooks** — registering, event types, signature verification
- **Troubleshooting** — common errors and solutions
- **API Types Reference** — all TypeScript interfaces as reference tables

### 2. Installation Guides (`docs/compliance/installation/`)

Per-environment installation guides:

- `docker.md` — Docker Compose setup (single container, with DB options)
- `bare-metal.md` — Direct Node.js installation on Linux/macOS/Windows
- `kubernetes.md` — K8s deployment overview (manifest structure, not full manifests — those are milestone 3)
- `cloud.md` — AWS (Lambda/ECS) and Azure (Functions/Container Apps) overview
- `all-in-one.md` — All-in-one mode with pally-agent

### 3. Integration Guides (`docs/compliance/integrations/`)

- `pally-agent.md` — How pally-agent connects (config, A2A flow)
- `power-automate.md` — Power Automate custom connector setup, OAuth2 config, example flows
- `n8n.md` — n8n HTTP Request node setup, OAuth2 credentials, example workflows
- `claude-code.md` — MCP server config, skill usage, example conversations
- `ci-cd.md` — Using compliance checks in CI/CD pipelines (exit codes, JSON output)

### 4. Updated Claude Code Skill

Update `~/.claude/skills/pally-agent/SKILL.md` and `.claude/skills/pally-agent/SKILL.md` to include all compliance tools and workflows.

## Non-Goals (This Milestone)

- Regulatory Monitor Agent (milestone 3)
- Pally-agent integration / enriched reports (milestone 2)
- CI/CD pipelines (milestone 3)
- Kubernetes/serverless deployment manifests (milestone 3)
- Admin UI (future)
- Multi-tenancy (future)
