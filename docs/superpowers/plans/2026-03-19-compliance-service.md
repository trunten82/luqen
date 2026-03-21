# Compliance Service Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone accessibility compliance rule engine service with REST API (OAuth2, OpenAPI), MCP server, A2A agent, pluggable DB, and 60+ jurisdiction baseline data.

**Architecture:** Fastify server exposing REST (OAuth2 + OpenAPI), MCP (stdio), and A2A (agent card + tasks) interfaces over a core compliance engine with pluggable database adapters.

**Tech Stack:** TypeScript (strict), Fastify, jose, bcrypt, better-sqlite3, mongodb, pg, zod, @modelcontextprotocol/sdk, commander, vitest

**Spec:** `docs/superpowers/specs/2026-03-19-compliance-service-design.md`

---

## File Structure

```
luqen/
├── package.json                          # Updated: npm workspaces
├── packages/
│   ├── core/                             # Existing luqen code (moved)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── src/
│   │   └── tests/
│   └── compliance/                       # NEW: compliance service
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── src/
│       │   ├── types.ts                  # All shared interfaces
│       │   ├── config.ts                 # Config loading, env var overrides
│       │   ├── db/
│       │   │   ├── adapter.ts            # DbAdapter interface
│       │   │   ├── sqlite-adapter.ts     # SQLite implementation
│       │   │   ├── mongodb-adapter.ts    # MongoDB implementation
│       │   │   └── postgres-adapter.ts   # PostgreSQL implementation
│       │   ├── engine/
│       │   │   ├── matcher.ts            # Pa11y code to WCAG criterion extraction
│       │   │   ├── checker.ts            # Compliance check algorithm
│       │   │   ├── crud.ts               # CRUD operations for entities
│       │   │   ├── proposals.ts          # Update proposal workflow
│       │   │   └── webhooks.ts           # Webhook dispatch
│       │   ├── auth/
│       │   │   ├── oauth.ts              # OAuth2 token signing/verification
│       │   │   ├── middleware.ts          # Auth middleware for Fastify
│       │   │   └── scopes.ts             # Scope definitions and checks
│       │   ├── api/
│       │   │   ├── server.ts             # Fastify server setup + OpenAPI
│       │   │   ├── routes/
│       │   │   │   ├── jurisdictions.ts  # Jurisdiction CRUD routes
│       │   │   │   ├── regulations.ts    # Regulation CRUD routes
│       │   │   │   ├── requirements.ts   # Requirement CRUD routes
│       │   │   │   ├── compliance.ts     # Compliance check route
│       │   │   │   ├── updates.ts        # Update proposal routes
│       │   │   │   ├── sources.ts        # Monitored source routes
│       │   │   │   ├── webhooks.ts       # Webhook management routes
│       │   │   │   ├── seed.ts           # Seed routes
│       │   │   │   ├── oauth.ts          # OAuth2 endpoints
│       │   │   │   └── health.ts         # Health check
│       │   │   ├── pagination.ts         # Pagination middleware
│       │   │   └── rate-limit.ts         # Rate limiting middleware
│       │   ├── mcp/
│       │   │   └── server.ts             # MCP server with 11 tools
│       │   ├── a2a/
│       │   │   ├── agent-card.ts         # Agent card definition
│       │   │   └── tasks.ts              # A2A task endpoints + SSE
│       │   ├── seed/
│       │   │   ├── baseline.json         # Baseline seed data
│       │   │   └── loader.ts             # Seed data loader
│       │   └── cli.ts                    # CLI entry point
│       └── tests/
│           ├── types.test.ts
│           ├── config.test.ts
│           ├── db/
│           │   ├── sqlite-adapter.test.ts
│           │   └── adapter-contract.test.ts
│           ├── engine/
│           │   ├── matcher.test.ts
│           │   ├── checker.test.ts
│           │   ├── crud.test.ts
│           │   ├── proposals.test.ts
│           │   └── webhooks.test.ts
│           ├── auth/
│           │   ├── oauth.test.ts
│           │   ├── middleware.test.ts
│           │   └── scopes.test.ts
│           ├── api/
│           │   ├── server.test.ts
│           │   ├── jurisdictions.test.ts
│           │   ├── regulations.test.ts
│           │   ├── requirements.test.ts
│           │   ├── compliance.test.ts
│           │   ├── updates.test.ts
│           │   ├── sources.test.ts
│           │   ├── webhooks.test.ts
│           │   ├── seed.test.ts
│           │   ├── oauth.test.ts
│           │   ├── health.test.ts
│           │   ├── pagination.test.ts
│           │   └── rate-limit.test.ts
│           ├── mcp/
│           │   └── server.test.ts
│           ├── a2a/
│           │   ├── agent-card.test.ts
│           │   └── tasks.test.ts
│           ├── seed/
│           │   └── loader.test.ts
│           └── cli.test.ts
```

---

## Wave 0 -- Monorepo Setup

### Task 0.1: Convert to npm workspaces and scaffold compliance package

**Files:**
- Modify: `/root/luqen/package.json`
- Create: `/root/luqen/packages/core/package.json`
- Create: `/root/luqen/packages/core/tsconfig.json`
- Create: `/root/luqen/packages/core/vitest.config.ts`
- Create: `/root/luqen/packages/compliance/package.json`
- Create: `/root/luqen/packages/compliance/tsconfig.json`
- Create: `/root/luqen/packages/compliance/vitest.config.ts`
- Move: `/root/luqen/src/` to `/root/luqen/packages/core/src/`
- Move: `/root/luqen/tests/` to `/root/luqen/packages/core/tests/`

- [ ] **Step 1: Create packages directories and move existing code**

```bash
cd /root/luqen
mkdir -p packages/core packages/compliance/src packages/compliance/tests
cp -r src packages/core/
cp -r tests packages/core/
cp tsconfig.json packages/core/tsconfig.json
cp vitest.config.ts packages/core/vitest.config.ts
```

- [ ] **Step 2: Create packages/core/package.json**

```json
{
  "name": "@luqen/core",
  "version": "0.1.0",
  "description": "Accessibility testing agent using pa11y webservice",
  "type": "module",
  "main": "dist/cli.js",
  "bin": {
    "luqen": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc && cp src/reporter/report.hbs dist/reporter/report.hbs",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "tsc --noEmit"
  },
  "license": "MIT",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.1",
    "cheerio": "^1.2.0",
    "commander": "^14.0.3",
    "handlebars": "^4.7.8",
    "robots-parser": "^3.0.1",
    "xml2js": "^0.6.2",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^25.5.0",
    "@types/xml2js": "^0.4.14",
    "@vitest/coverage-v8": "^4.1.0",
    "typescript": "^5.9.3",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 3: Update root package.json for workspaces**

```json
{
  "name": "luqen",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "packages/core",
    "packages/compliance"
  ],
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces",
    "test:coverage": "npm run test:coverage --workspaces",
    "lint": "npm run lint --workspaces"
  },
  "license": "MIT"
}
```

- [ ] **Step 4: Create packages/compliance/package.json**

```json
{
  "name": "@luqen/compliance",
  "version": "0.1.0",
  "description": "Accessibility compliance rule engine service",
  "type": "module",
  "main": "dist/cli.js",
  "bin": {
    "luqen-compliance": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "tsc --noEmit",
    "start": "node dist/cli.js serve"
  },
  "license": "MIT",
  "dependencies": {
    "@fastify/cors": "^10.0.0",
    "@fastify/rate-limit": "^10.0.0",
    "@fastify/swagger": "^9.0.0",
    "@fastify/swagger-ui": "^5.0.0",
    "@modelcontextprotocol/sdk": "^1.27.1",
    "bcrypt": "^5.1.1",
    "better-sqlite3": "^11.0.0",
    "commander": "^14.0.3",
    "fastify": "^5.0.0",
    "jose": "^6.0.0",
    "mongodb": "^6.0.0",
    "pg": "^8.13.0",
    "zod": "^4.3.6",
    "zod-to-json-schema": "^3.24.0"
  },
  "devDependencies": {
    "@types/bcrypt": "^5.0.2",
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^25.5.0",
    "@types/pg": "^8.11.0",
    "@vitest/coverage-v8": "^4.1.0",
    "typescript": "^5.9.3",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 5: Create packages/compliance/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 6: Create packages/compliance/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: '.',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts', 'src/cli.ts'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
```

- [ ] **Step 7: Install dependencies and verify builds**

```bash
cd /root/luqen
npm install
cd packages/core && npx vitest run && cd ../..
```

- [ ] **Step 8: Remove old root-level src/tests (now in packages/core)**

```bash
cd /root/luqen
rm -rf src tests tsconfig.json vitest.config.ts
```

- [ ] **Step 9: Commit**

```bash
cd /root/luqen
git add -A
git commit -m "chore: convert to npm workspaces monorepo, scaffold compliance package"
```

---

## Wave 1 -- Foundation (parallel tasks)

### Task 1.1: Types and Interfaces

**Files:**
- Create: `packages/compliance/src/types.ts`
- Create: `packages/compliance/tests/types.test.ts`

- [ ] **Step 1: Write test**

Create `packages/compliance/tests/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type {
  Jurisdiction,
  Regulation,
  Requirement,
  UpdateProposal,
  ProposedChange,
  Webhook,
  MonitoredSource,
  OAuthClient,
  User,
  ComplianceCheckRequest,
  ComplianceCheckResponse,
  JurisdictionResult,
  RegulationResult,
  AnnotatedIssue,
  PaginatedResponse,
  WebhookPayload,
  JurisdictionFilters,
  RegulationFilters,
  RequirementFilters,
  CreateJurisdictionInput,
  CreateRegulationInput,
  CreateRequirementInput,
  CreateUpdateProposalInput,
  CreateSourceInput,
  CreateClientInput,
  CreateUserInput,
  CreateWebhookInput,
  RequirementWithRegulation,
  ComplianceConfig,
} from '../src/types.js';

describe('Types', () => {
  it('Jurisdiction satisfies the interface contract', () => {
    const j: Jurisdiction = {
      id: 'EU',
      name: 'European Union',
      type: 'supranational',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    expect(j.id).toBe('EU');
    expect(j.type).toBe('supranational');
  });

  it('Jurisdiction with parentId satisfies the interface', () => {
    const j: Jurisdiction = {
      id: 'DE',
      name: 'Germany',
      type: 'country',
      parentId: 'EU',
      iso3166: 'DE',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    expect(j.parentId).toBe('EU');
  });

  it('Regulation satisfies the interface contract', () => {
    const r: Regulation = {
      id: 'eu-eaa',
      jurisdictionId: 'EU',
      name: 'European Accessibility Act',
      shortName: 'EAA',
      reference: 'Directive (EU) 2019/882',
      url: 'https://example.com',
      enforcementDate: '2025-06-28',
      status: 'active',
      scope: 'all',
      sectors: ['e-commerce', 'banking'],
      description: 'Requires accessible products and services',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    expect(r.status).toBe('active');
    expect(r.sectors).toContain('banking');
  });

  it('Requirement satisfies the interface contract', () => {
    const req: Requirement = {
      id: 'req-1',
      regulationId: 'eu-eaa',
      wcagVersion: '2.1',
      wcagLevel: 'AA',
      wcagCriterion: '*',
      obligation: 'mandatory',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    expect(req.wcagCriterion).toBe('*');
  });

  it('UpdateProposal satisfies the interface contract', () => {
    const p: UpdateProposal = {
      id: 'prop-1',
      source: 'https://example.com/news',
      detectedAt: '2026-01-01T00:00:00Z',
      type: 'new_regulation',
      summary: 'New regulation detected',
      proposedChanges: {
        action: 'create',
        entityType: 'regulation',
        after: { name: 'New Reg' },
      },
      status: 'pending',
      createdAt: '2026-01-01T00:00:00Z',
    };
    expect(p.status).toBe('pending');
  });

  it('ComplianceCheckRequest satisfies the interface contract', () => {
    const req: ComplianceCheckRequest = {
      jurisdictions: ['EU', 'US'],
      issues: [
        {
          code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
          type: 'error',
          message: 'Missing alt text',
          selector: 'img',
          context: '<img src="test.png">',
        },
      ],
    };
    expect(req.jurisdictions).toHaveLength(2);
  });

  it('PaginatedResponse satisfies the interface contract', () => {
    const res: PaginatedResponse<Jurisdiction> = {
      data: [],
      total: 0,
      limit: 50,
      offset: 0,
    };
    expect(res.total).toBe(0);
  });

  it('ComplianceConfig satisfies the interface contract', () => {
    const cfg: ComplianceConfig = {
      port: 4000,
      host: '0.0.0.0',
      dbAdapter: 'sqlite',
      dbPath: './compliance.db',
      jwtKeyPair: {
        publicKeyPath: './keys/public.pem',
        privateKeyPath: './keys/private.pem',
      },
      tokenExpiry: '1h',
      refreshTokenExpiry: '30d',
      rateLimit: { read: 100, write: 20, windowMs: 60000 },
      cors: { origin: ['http://localhost:3000'], credentials: true },
      a2a: { enabled: true, peers: [] },
    };
    expect(cfg.port).toBe(4000);
  });

  it('RequirementWithRegulation extends Requirement with regulation data', () => {
    const rwr: RequirementWithRegulation = {
      id: 'req-1',
      regulationId: 'eu-eaa',
      wcagVersion: '2.1',
      wcagLevel: 'AA',
      wcagCriterion: '*',
      obligation: 'mandatory',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      regulationName: 'European Accessibility Act',
      regulationShortName: 'EAA',
      jurisdictionId: 'EU',
      enforcementDate: '2025-06-28',
    };
    expect(rwr.regulationName).toBe('European Accessibility Act');
  });
});
```

- [ ] **Step 2: Run test -- expect FAIL (module not found)**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/types.test.ts
```

- [ ] **Step 3: Implement types**

Create `packages/compliance/src/types.ts`:

```typescript
// === Core domain entities ===

export interface Jurisdiction {
  readonly id: string;
  readonly name: string;
  readonly type: 'supranational' | 'country' | 'state';
  readonly parentId?: string;
  readonly iso3166?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Regulation {
  readonly id: string;
  readonly jurisdictionId: string;
  readonly name: string;
  readonly shortName: string;
  readonly reference: string;
  readonly url: string;
  readonly enforcementDate: string;
  readonly status: 'active' | 'draft' | 'repealed';
  readonly scope: 'public' | 'private' | 'all';
  readonly sectors: readonly string[];
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Requirement {
  readonly id: string;
  readonly regulationId: string;
  readonly wcagVersion: '2.0' | '2.1' | '2.2';
  readonly wcagLevel: 'A' | 'AA' | 'AAA';
  readonly wcagCriterion: string;
  readonly obligation: 'mandatory' | 'recommended' | 'optional';
  readonly notes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RequirementWithRegulation extends Requirement {
  readonly regulationName: string;
  readonly regulationShortName: string;
  readonly jurisdictionId: string;
  readonly enforcementDate: string;
}

export interface ProposedChange {
  readonly action: 'create' | 'update' | 'delete';
  readonly entityType: 'jurisdiction' | 'regulation' | 'requirement';
  readonly entityId?: string;
  readonly before?: Record<string, unknown>;
  readonly after?: Record<string, unknown>;
}

export interface UpdateProposal {
  readonly id: string;
  readonly source: string;
  readonly detectedAt: string;
  readonly type: 'new_regulation' | 'amendment' | 'repeal' | 'new_requirement' | 'new_jurisdiction';
  readonly affectedRegulationId?: string;
  readonly affectedJurisdictionId?: string;
  readonly summary: string;
  readonly proposedChanges: ProposedChange;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly reviewedBy?: string;
  readonly reviewedAt?: string;
  readonly createdAt: string;
}

export interface Webhook {
  readonly id: string;
  readonly url: string;
  readonly secret: string;
  readonly events: readonly string[];
  readonly active: boolean;
  readonly createdAt: string;
}

export interface MonitoredSource {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly type: 'html' | 'rss' | 'api';
  readonly schedule: 'daily' | 'weekly' | 'monthly';
  readonly lastCheckedAt?: string;
  readonly lastContentHash?: string;
  readonly createdAt: string;
}

export interface OAuthClient {
  readonly id: string;
  readonly name: string;
  readonly secretHash: string;
  readonly scopes: readonly string[];
  readonly grantTypes: readonly ('client_credentials' | 'authorization_code')[];
  readonly redirectUris?: readonly string[];
  readonly createdAt: string;
}

export interface User {
  readonly id: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly role: 'admin' | 'editor' | 'viewer';
  readonly createdAt: string;
}

// === API request/response types ===

export interface ComplianceCheckRequest {
  readonly jurisdictions: readonly string[];
  readonly issues: readonly {
    readonly code: string;
    readonly type: string;
    readonly message: string;
    readonly selector: string;
    readonly context: string;
    readonly url?: string;
  }[];
  readonly includeOptional?: boolean;
  readonly sectors?: readonly string[];
}

export interface JurisdictionResult {
  readonly jurisdictionId: string;
  readonly jurisdictionName: string;
  readonly status: 'pass' | 'fail';
  readonly mandatoryViolations: number;
  readonly recommendedViolations: number;
  readonly optionalViolations: number;
  readonly regulations: readonly RegulationResult[];
}

export interface RegulationResult {
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

export interface AnnotatedIssue {
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

export interface ComplianceCheckResponse {
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

export interface PaginatedResponse<T> {
  readonly data: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface WebhookPayload {
  readonly event: string;
  readonly timestamp: string;
  readonly data: Record<string, unknown>;
}

// === Filter types ===

export interface JurisdictionFilters {
  readonly type?: 'supranational' | 'country' | 'state';
  readonly parentId?: string;
}

export interface RegulationFilters {
  readonly jurisdictionId?: string;
  readonly status?: 'active' | 'draft' | 'repealed';
  readonly scope?: 'public' | 'private' | 'all';
}

export interface RequirementFilters {
  readonly regulationId?: string;
  readonly wcagCriterion?: string;
  readonly obligation?: 'mandatory' | 'recommended' | 'optional';
}

// === Input types (for create operations) ===

export interface CreateJurisdictionInput {
  readonly id: string;
  readonly name: string;
  readonly type: 'supranational' | 'country' | 'state';
  readonly parentId?: string;
  readonly iso3166?: string;
}

export interface CreateRegulationInput {
  readonly id: string;
  readonly jurisdictionId: string;
  readonly name: string;
  readonly shortName: string;
  readonly reference: string;
  readonly url: string;
  readonly enforcementDate: string;
  readonly status: 'active' | 'draft' | 'repealed';
  readonly scope: 'public' | 'private' | 'all';
  readonly sectors: readonly string[];
  readonly description: string;
}

export interface CreateRequirementInput {
  readonly regulationId: string;
  readonly wcagVersion: '2.0' | '2.1' | '2.2';
  readonly wcagLevel: 'A' | 'AA' | 'AAA';
  readonly wcagCriterion: string;
  readonly obligation: 'mandatory' | 'recommended' | 'optional';
  readonly notes?: string;
}

export interface CreateUpdateProposalInput {
  readonly source: string;
  readonly type: 'new_regulation' | 'amendment' | 'repeal' | 'new_requirement' | 'new_jurisdiction';
  readonly affectedRegulationId?: string;
  readonly affectedJurisdictionId?: string;
  readonly summary: string;
  readonly proposedChanges: ProposedChange;
}

export interface CreateSourceInput {
  readonly name: string;
  readonly url: string;
  readonly type: 'html' | 'rss' | 'api';
  readonly schedule: 'daily' | 'weekly' | 'monthly';
}

export interface CreateClientInput {
  readonly name: string;
  readonly scopes: readonly string[];
  readonly grantTypes: readonly ('client_credentials' | 'authorization_code')[];
  readonly redirectUris?: readonly string[];
}

export interface CreateUserInput {
  readonly username: string;
  readonly password: string;
  readonly role: 'admin' | 'editor' | 'viewer';
}

export interface CreateWebhookInput {
  readonly url: string;
  readonly secret: string;
  readonly events: readonly string[];
}

// === Configuration ===

export interface ComplianceConfig {
  readonly port: number;
  readonly host: string;
  readonly dbAdapter: 'sqlite' | 'mongodb' | 'postgres';
  readonly dbPath?: string;
  readonly dbUrl?: string;
  readonly jwtKeyPair: {
    readonly publicKeyPath: string;
    readonly privateKeyPath: string;
  };
  readonly tokenExpiry: string;
  readonly refreshTokenExpiry: string;
  readonly rateLimit: {
    readonly read: number;
    readonly write: number;
    readonly windowMs: number;
  };
  readonly cors: {
    readonly origin: readonly string[];
    readonly credentials: boolean;
  };
  readonly a2a: {
    readonly enabled: boolean;
    readonly peers: readonly string[];
  };
}

// === Seed data shape ===

export interface BaselineSeedData {
  readonly version: string;
  readonly generatedAt: string;
  readonly jurisdictions: readonly CreateJurisdictionInput[];
  readonly regulations: readonly CreateRegulationInput[];
  readonly requirements: readonly CreateRequirementInput[];
}
```

- [ ] **Step 4: Run test -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/types.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/types.ts packages/compliance/tests/types.test.ts
git commit -m "feat(compliance): add all TypeScript interfaces and domain types"
```

---

### Task 1.2: Config Module

**Files:**
- Create: `packages/compliance/src/config.ts`
- Create: `packages/compliance/tests/config.test.ts`

- [ ] **Step 1: Write test**

Create `packages/compliance/tests/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, DEFAULT_CONFIG } from '../src/config.js';

describe('Config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns default config when no file or env vars exist', () => {
    const config = loadConfig('/nonexistent/path/compliance.config.json');
    expect(config.port).toBe(4000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.dbAdapter).toBe('sqlite');
    expect(config.dbPath).toBe('./compliance.db');
    expect(config.tokenExpiry).toBe('1h');
    expect(config.refreshTokenExpiry).toBe('30d');
    expect(config.rateLimit.read).toBe(100);
    expect(config.rateLimit.write).toBe(20);
    expect(config.rateLimit.windowMs).toBe(60000);
  });

  it('overrides port from COMPLIANCE_PORT env var', () => {
    process.env.COMPLIANCE_PORT = '5000';
    const config = loadConfig('/nonexistent/path');
    expect(config.port).toBe(5000);
  });

  it('overrides dbAdapter from COMPLIANCE_DB_ADAPTER env var', () => {
    process.env.COMPLIANCE_DB_ADAPTER = 'mongodb';
    const config = loadConfig('/nonexistent/path');
    expect(config.dbAdapter).toBe('mongodb');
  });

  it('overrides dbPath from COMPLIANCE_DB_PATH env var', () => {
    process.env.COMPLIANCE_DB_PATH = '/tmp/test.db';
    const config = loadConfig('/nonexistent/path');
    expect(config.dbPath).toBe('/tmp/test.db');
  });

  it('overrides dbUrl from COMPLIANCE_DB_URL env var', () => {
    process.env.COMPLIANCE_DB_URL = 'mongodb://localhost:27017/compliance';
    const config = loadConfig('/nonexistent/path');
    expect(config.dbUrl).toBe('mongodb://localhost:27017/compliance');
  });

  it('overrides JWT key paths from env vars', () => {
    process.env.COMPLIANCE_JWT_PRIVATE_KEY = '/keys/priv.pem';
    process.env.COMPLIANCE_JWT_PUBLIC_KEY = '/keys/pub.pem';
    const config = loadConfig('/nonexistent/path');
    expect(config.jwtKeyPair.privateKeyPath).toBe('/keys/priv.pem');
    expect(config.jwtKeyPair.publicKeyPath).toBe('/keys/pub.pem');
  });

  it('overrides CORS origin from COMPLIANCE_CORS_ORIGIN (comma-separated)', () => {
    process.env.COMPLIANCE_CORS_ORIGIN = 'http://a.com,http://b.com';
    const config = loadConfig('/nonexistent/path');
    expect(config.cors.origin).toEqual(['http://a.com', 'http://b.com']);
  });

  it('DEFAULT_CONFIG is immutable (frozen)', () => {
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/config.test.ts
```

- [ ] **Step 3: Implement config**

Create `packages/compliance/src/config.ts`:

```typescript
import { readFileSync } from 'node:fs';
import type { ComplianceConfig } from './types.js';

export const DEFAULT_CONFIG: Readonly<ComplianceConfig> = Object.freeze({
  port: 4000,
  host: '0.0.0.0',
  dbAdapter: 'sqlite' as const,
  dbPath: './compliance.db',
  jwtKeyPair: Object.freeze({
    publicKeyPath: './keys/public.pem',
    privateKeyPath: './keys/private.pem',
  }),
  tokenExpiry: '1h',
  refreshTokenExpiry: '30d',
  rateLimit: Object.freeze({ read: 100, write: 20, windowMs: 60000 }),
  cors: Object.freeze({
    origin: ['http://localhost:3000'] as readonly string[],
    credentials: true,
  }),
  a2a: Object.freeze({ enabled: true, peers: [] as readonly string[] }),
});

function readConfigFile(path: string): Partial<ComplianceConfig> {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Partial<ComplianceConfig>;
  } catch {
    return {};
  }
}

function applyEnvOverrides(config: ComplianceConfig): ComplianceConfig {
  const env = process.env;

  return {
    ...config,
    port: env.COMPLIANCE_PORT
      ? parseInt(env.COMPLIANCE_PORT, 10)
      : config.port,
    dbAdapter: (env.COMPLIANCE_DB_ADAPTER as ComplianceConfig['dbAdapter'])
      ?? config.dbAdapter,
    dbPath: env.COMPLIANCE_DB_PATH ?? config.dbPath,
    dbUrl: env.COMPLIANCE_DB_URL ?? config.dbUrl,
    host: env.COMPLIANCE_HOST ?? config.host,
    jwtKeyPair: {
      privateKeyPath: env.COMPLIANCE_JWT_PRIVATE_KEY
        ?? config.jwtKeyPair.privateKeyPath,
      publicKeyPath: env.COMPLIANCE_JWT_PUBLIC_KEY
        ?? config.jwtKeyPair.publicKeyPath,
    },
    cors: env.COMPLIANCE_CORS_ORIGIN
      ? {
          ...config.cors,
          origin: env.COMPLIANCE_CORS_ORIGIN.split(',').map(s => s.trim()),
        }
      : config.cors,
  };
}

export function loadConfig(
  configPath: string = 'compliance.config.json',
): ComplianceConfig {
  const fileConfig = readConfigFile(configPath);
  const merged: ComplianceConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    rateLimit: {
      ...DEFAULT_CONFIG.rateLimit,
      ...(fileConfig.rateLimit ?? {}),
    },
    cors: { ...DEFAULT_CONFIG.cors, ...(fileConfig.cors ?? {}) },
    a2a: { ...DEFAULT_CONFIG.a2a, ...(fileConfig.a2a ?? {}) },
    jwtKeyPair: {
      ...DEFAULT_CONFIG.jwtKeyPair,
      ...(fileConfig.jwtKeyPair ?? {}),
    },
  };
  return applyEnvOverrides(merged);
}
```

- [ ] **Step 4: Run test -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/config.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/config.ts packages/compliance/tests/config.test.ts
git commit -m "feat(compliance): add config module with env var overrides"
```

---

### Task 1.3: WCAG Criterion Matcher

**Files:**
- Create: `packages/compliance/src/engine/matcher.ts`
- Create: `packages/compliance/tests/engine/matcher.test.ts`

- [ ] **Step 1: Write test**

Create `packages/compliance/tests/engine/matcher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  extractCriterion,
  extractLevel,
  parseIssueCode,
} from '../../src/engine/matcher.js';

describe('Matcher', () => {
  describe('extractCriterion', () => {
    it('extracts 1.1.1 from WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', () => {
      expect(
        extractCriterion('WCAG2AA.Principle1.Guideline1_1.1_1_1.H37'),
      ).toBe('1.1.1');
    });

    it('extracts 1.3.1 from WCAG2AA.Principle1.Guideline1_3.1_3_1.H44.NonExistent', () => {
      expect(
        extractCriterion(
          'WCAG2AA.Principle1.Guideline1_3.1_3_1.H44.NonExistent',
        ),
      ).toBe('1.3.1');
    });

    it('extracts 3.1.1 from WCAG2AA.Principle3.Guideline3_1.3_1_1.H57.2', () => {
      expect(
        extractCriterion('WCAG2AA.Principle3.Guideline3_1.3_1_1.H57.2'),
      ).toBe('3.1.1');
    });

    it('extracts 2.4.7 from WCAG2AA.Principle2.Guideline2_4.2_4_7.G149', () => {
      expect(
        extractCriterion('WCAG2AA.Principle2.Guideline2_4.2_4_7.G149'),
      ).toBe('2.4.7');
    });

    it('extracts 4.1.2 from WCAG2A.Principle4.Guideline4_1.4_1_2.H91.InputText.Name', () => {
      expect(
        extractCriterion(
          'WCAG2A.Principle4.Guideline4_1.4_1_2.H91.InputText.Name',
        ),
      ).toBe('4.1.2');
    });

    it('returns null for unparseable code', () => {
      expect(extractCriterion('not-a-wcag-code')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractCriterion('')).toBeNull();
    });
  });

  describe('extractLevel', () => {
    it('extracts A from WCAG2A prefix', () => {
      expect(
        extractLevel('WCAG2A.Principle4.Guideline4_1.4_1_2.H91'),
      ).toBe('A');
    });

    it('extracts AA from WCAG2AA prefix', () => {
      expect(
        extractLevel('WCAG2AA.Principle1.Guideline1_1.1_1_1.H37'),
      ).toBe('AA');
    });

    it('extracts AAA from WCAG2AAA prefix', () => {
      expect(
        extractLevel('WCAG2AAA.Principle1.Guideline1_4.1_4_6.G17'),
      ).toBe('AAA');
    });

    it('returns null for unparseable code', () => {
      expect(extractLevel('not-a-wcag-code')).toBeNull();
    });
  });

  describe('parseIssueCode', () => {
    it('returns both criterion and level', () => {
      const result = parseIssueCode(
        'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
      );
      expect(result).toEqual({ criterion: '1.1.1', level: 'AA' });
    });

    it('returns null for unparseable code', () => {
      expect(parseIssueCode('garbage')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/engine/matcher.test.ts
```

- [ ] **Step 3: Implement matcher**

Create `packages/compliance/src/engine/matcher.ts`:

```typescript
export interface ParsedIssueCode {
  readonly criterion: string;
  readonly level: 'A' | 'AA' | 'AAA';
}

const CRITERION_PATTERN = /(\d+_\d+_\d+)/;
const LEVEL_PATTERN = /^WCAG2(AAA|AA|A)\./;

export function extractCriterion(code: string): string | null {
  const match = CRITERION_PATTERN.exec(code);
  if (!match) return null;
  return match[1].replace(/_/g, '.');
}

export function extractLevel(
  code: string,
): 'A' | 'AA' | 'AAA' | null {
  const match = LEVEL_PATTERN.exec(code);
  if (!match) return null;
  return match[1] as 'A' | 'AA' | 'AAA';
}

export function parseIssueCode(code: string): ParsedIssueCode | null {
  const criterion = extractCriterion(code);
  const level = extractLevel(code);
  if (!criterion || !level) return null;
  return { criterion, level };
}
```

- [ ] **Step 4: Run test -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/engine/matcher.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/engine/matcher.ts packages/compliance/tests/engine/matcher.test.ts
git commit -m "feat(compliance): add WCAG criterion matcher (pa11y code parser)"
```

---

### Task 1.4: DB Adapter Interface + SQLite Implementation

**Files:**
- Create: `packages/compliance/src/db/adapter.ts`
- Create: `packages/compliance/src/db/sqlite-adapter.ts`
- Create: `packages/compliance/tests/db/sqlite-adapter.test.ts`

- [ ] **Step 1: Write test**

Create `packages/compliance/tests/db/sqlite-adapter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../../src/db/adapter.js';

describe('SqliteAdapter', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  // --- Jurisdictions ---

  describe('jurisdictions', () => {
    it('creates and retrieves a jurisdiction', async () => {
      const j = await db.createJurisdiction({
        id: 'EU',
        name: 'European Union',
        type: 'supranational',
      });
      expect(j.id).toBe('EU');
      expect(j.name).toBe('European Union');
      expect(j.type).toBe('supranational');
      expect(j.createdAt).toBeTruthy();

      const fetched = await db.getJurisdiction('EU');
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('European Union');
    });

    it('returns null for non-existent jurisdiction', async () => {
      const fetched = await db.getJurisdiction('XX');
      expect(fetched).toBeNull();
    });

    it('lists jurisdictions with filters', async () => {
      await db.createJurisdiction({
        id: 'EU',
        name: 'European Union',
        type: 'supranational',
      });
      await db.createJurisdiction({
        id: 'DE',
        name: 'Germany',
        type: 'country',
        parentId: 'EU',
      });
      await db.createJurisdiction({
        id: 'US',
        name: 'United States',
        type: 'country',
      });

      const all = await db.listJurisdictions();
      expect(all).toHaveLength(3);

      const countries = await db.listJurisdictions({ type: 'country' });
      expect(countries).toHaveLength(2);

      const euChildren = await db.listJurisdictions({ parentId: 'EU' });
      expect(euChildren).toHaveLength(1);
      expect(euChildren[0].id).toBe('DE');
    });

    it('updates a jurisdiction', async () => {
      await db.createJurisdiction({
        id: 'EU',
        name: 'European Union',
        type: 'supranational',
      });
      const updated = await db.updateJurisdiction('EU', {
        name: 'EU Updated',
      });
      expect(updated.name).toBe('EU Updated');
      expect(updated.type).toBe('supranational');
    });

    it('deletes a jurisdiction', async () => {
      await db.createJurisdiction({
        id: 'EU',
        name: 'European Union',
        type: 'supranational',
      });
      await db.deleteJurisdiction('EU');
      const fetched = await db.getJurisdiction('EU');
      expect(fetched).toBeNull();
    });
  });

  // --- Regulations ---

  describe('regulations', () => {
    beforeEach(async () => {
      await db.createJurisdiction({
        id: 'EU',
        name: 'European Union',
        type: 'supranational',
      });
    });

    it('creates and retrieves a regulation', async () => {
      const r = await db.createRegulation({
        id: 'eu-eaa',
        jurisdictionId: 'EU',
        name: 'European Accessibility Act',
        shortName: 'EAA',
        reference: 'Directive (EU) 2019/882',
        url: 'https://example.com',
        enforcementDate: '2025-06-28',
        status: 'active',
        scope: 'all',
        sectors: ['e-commerce', 'banking'],
        description: 'Accessible products',
      });
      expect(r.id).toBe('eu-eaa');
      expect(r.sectors).toEqual(['e-commerce', 'banking']);

      const fetched = await db.getRegulation('eu-eaa');
      expect(fetched).not.toBeNull();
      expect(fetched!.shortName).toBe('EAA');
    });

    it('lists regulations with filters', async () => {
      await db.createRegulation({
        id: 'eu-eaa',
        jurisdictionId: 'EU',
        name: 'EAA',
        shortName: 'EAA',
        reference: 'ref',
        url: 'url',
        enforcementDate: '2025-06-28',
        status: 'active',
        scope: 'all',
        sectors: [],
        description: 'desc',
      });
      await db.createRegulation({
        id: 'eu-wad',
        jurisdictionId: 'EU',
        name: 'WAD',
        shortName: 'WAD',
        reference: 'ref',
        url: 'url',
        enforcementDate: '2016-12-22',
        status: 'active',
        scope: 'public',
        sectors: [],
        description: 'desc',
      });

      const all = await db.listRegulations();
      expect(all).toHaveLength(2);

      const publicOnly = await db.listRegulations({ scope: 'public' });
      expect(publicOnly).toHaveLength(1);
      expect(publicOnly[0].id).toBe('eu-wad');
    });

    it('updates a regulation', async () => {
      await db.createRegulation({
        id: 'eu-eaa',
        jurisdictionId: 'EU',
        name: 'EAA',
        shortName: 'EAA',
        reference: 'ref',
        url: 'url',
        enforcementDate: '2025-06-28',
        status: 'active',
        scope: 'all',
        sectors: [],
        description: 'desc',
      });
      const updated = await db.updateRegulation('eu-eaa', {
        status: 'repealed',
      });
      expect(updated.status).toBe('repealed');
      expect(updated.name).toBe('EAA');
    });

    it('deletes a regulation', async () => {
      await db.createRegulation({
        id: 'eu-eaa',
        jurisdictionId: 'EU',
        name: 'EAA',
        shortName: 'EAA',
        reference: 'ref',
        url: 'url',
        enforcementDate: '2025-06-28',
        status: 'active',
        scope: 'all',
        sectors: [],
        description: 'desc',
      });
      await db.deleteRegulation('eu-eaa');
      expect(await db.getRegulation('eu-eaa')).toBeNull();
    });
  });

  // --- Requirements ---

  describe('requirements', () => {
    beforeEach(async () => {
      await db.createJurisdiction({
        id: 'EU',
        name: 'European Union',
        type: 'supranational',
      });
      await db.createRegulation({
        id: 'eu-eaa',
        jurisdictionId: 'EU',
        name: 'EAA',
        shortName: 'EAA',
        reference: 'ref',
        url: 'url',
        enforcementDate: '2025-06-28',
        status: 'active',
        scope: 'all',
        sectors: [],
        description: 'desc',
      });
    });

    it('creates and lists requirements', async () => {
      const req = await db.createRequirement({
        regulationId: 'eu-eaa',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '*',
        obligation: 'mandatory',
      });
      expect(req.id).toBeTruthy();
      expect(req.wcagCriterion).toBe('*');

      const all = await db.listRequirements();
      expect(all).toHaveLength(1);
    });

    it('lists requirements with filters', async () => {
      await db.createRequirement({
        regulationId: 'eu-eaa',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '*',
        obligation: 'mandatory',
      });
      await db.createRequirement({
        regulationId: 'eu-eaa',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '1.1.1',
        obligation: 'recommended',
      });

      const mandatory = await db.listRequirements({
        obligation: 'mandatory',
      });
      expect(mandatory).toHaveLength(1);

      const byCriterion = await db.listRequirements({
        wcagCriterion: '1.1.1',
      });
      expect(byCriterion).toHaveLength(1);
    });

    it('bulk creates requirements', async () => {
      const results = await db.bulkCreateRequirements([
        {
          regulationId: 'eu-eaa',
          wcagVersion: '2.1',
          wcagLevel: 'AA',
          wcagCriterion: '*',
          obligation: 'mandatory',
        },
        {
          regulationId: 'eu-eaa',
          wcagVersion: '2.1',
          wcagLevel: 'A',
          wcagCriterion: '1.1.1',
          obligation: 'recommended',
        },
      ]);
      expect(results).toHaveLength(2);
    });

    it('updates a requirement', async () => {
      const req = await db.createRequirement({
        regulationId: 'eu-eaa',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '*',
        obligation: 'mandatory',
      });
      const updated = await db.updateRequirement(req.id, {
        obligation: 'recommended',
      });
      expect(updated.obligation).toBe('recommended');
    });

    it('deletes a requirement', async () => {
      const req = await db.createRequirement({
        regulationId: 'eu-eaa',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '*',
        obligation: 'mandatory',
      });
      await db.deleteRequirement(req.id);
      const all = await db.listRequirements();
      expect(all).toHaveLength(0);
    });
  });

  // --- findRequirementsByCriteria ---

  describe('findRequirementsByCriteria', () => {
    beforeEach(async () => {
      await db.createJurisdiction({
        id: 'EU',
        name: 'European Union',
        type: 'supranational',
      });
      await db.createJurisdiction({
        id: 'US',
        name: 'United States',
        type: 'country',
      });
      await db.createRegulation({
        id: 'eu-eaa',
        jurisdictionId: 'EU',
        name: 'EAA',
        shortName: 'EAA',
        reference: 'ref',
        url: 'url',
        enforcementDate: '2025-06-28',
        status: 'active',
        scope: 'all',
        sectors: [],
        description: 'desc',
      });
      await db.createRegulation({
        id: 'us-508',
        jurisdictionId: 'US',
        name: 'Section 508',
        shortName: 'Section 508',
        reference: 'ref',
        url: 'url',
        enforcementDate: '1998-08-07',
        status: 'active',
        scope: 'public',
        sectors: [],
        description: 'desc',
      });
      await db.createRequirement({
        regulationId: 'eu-eaa',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '*',
        obligation: 'mandatory',
      });
      await db.createRequirement({
        regulationId: 'us-508',
        wcagVersion: '2.0',
        wcagLevel: 'AA',
        wcagCriterion: '1.1.1',
        obligation: 'mandatory',
      });
    });

    it('finds requirements by jurisdiction and criteria', async () => {
      const results = await db.findRequirementsByCriteria(
        ['EU'],
        ['1.1.1'],
      );
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].regulationName).toBeTruthy();
      expect(results[0].jurisdictionId).toBe('EU');
    });

    it('finds wildcard requirements', async () => {
      const results = await db.findRequirementsByCriteria(
        ['EU'],
        ['2.4.7'],
      );
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('finds requirements across multiple jurisdictions', async () => {
      const results = await db.findRequirementsByCriteria(
        ['EU', 'US'],
        ['1.1.1'],
      );
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  // --- Update proposals ---

  describe('update proposals', () => {
    it('creates and lists proposals', async () => {
      const p = await db.createUpdateProposal({
        source: 'https://example.com',
        type: 'new_regulation',
        summary: 'New law',
        proposedChanges: {
          action: 'create',
          entityType: 'regulation',
          after: { name: 'New' },
        },
      });
      expect(p.id).toBeTruthy();
      expect(p.status).toBe('pending');

      const all = await db.listUpdateProposals();
      expect(all).toHaveLength(1);
    });

    it('filters proposals by status', async () => {
      await db.createUpdateProposal({
        source: 'src',
        type: 'amendment',
        summary: 'Change',
        proposedChanges: {
          action: 'update',
          entityType: 'regulation',
          entityId: 'x',
          after: {},
        },
      });
      const pending = await db.listUpdateProposals({ status: 'pending' });
      expect(pending).toHaveLength(1);
      const approved = await db.listUpdateProposals({
        status: 'approved',
      });
      expect(approved).toHaveLength(0);
    });

    it('updates a proposal status', async () => {
      const p = await db.createUpdateProposal({
        source: 'src',
        type: 'amendment',
        summary: 'Change',
        proposedChanges: {
          action: 'update',
          entityType: 'regulation',
          entityId: 'x',
          after: {},
        },
      });
      const updated = await db.updateUpdateProposal(p.id, {
        status: 'approved',
        reviewedBy: 'admin',
        reviewedAt: new Date().toISOString(),
      });
      expect(updated.status).toBe('approved');
    });
  });

  // --- Sources ---

  describe('monitored sources', () => {
    it('creates, lists, and deletes sources', async () => {
      const s = await db.createSource({
        name: 'W3C',
        url: 'https://w3.org',
        type: 'html',
        schedule: 'weekly',
      });
      expect(s.id).toBeTruthy();

      const all = await db.listSources();
      expect(all).toHaveLength(1);

      await db.deleteSource(s.id);
      expect(await db.listSources()).toHaveLength(0);
    });

    it('updates last checked timestamp and hash', async () => {
      const s = await db.createSource({
        name: 'W3C',
        url: 'https://w3.org',
        type: 'html',
        schedule: 'weekly',
      });
      await db.updateSourceLastChecked(s.id, 'abc123hash');
      const updated = (await db.listSources())[0];
      expect(updated.lastContentHash).toBe('abc123hash');
      expect(updated.lastCheckedAt).toBeTruthy();
    });
  });

  // --- OAuth clients ---

  describe('OAuth clients', () => {
    it('creates and retrieves a client', async () => {
      const c = await db.createClient({
        name: 'test-app',
        scopes: ['read'],
        grantTypes: ['client_credentials'],
      });
      expect(c.id).toBeTruthy();
      expect(c.secret).toBeTruthy();
      expect(c.secretHash).toBeTruthy();

      const fetched = await db.getClientById(c.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('test-app');
    });

    it('lists and deletes clients', async () => {
      await db.createClient({
        name: 'a',
        scopes: ['read'],
        grantTypes: ['client_credentials'],
      });
      await db.createClient({
        name: 'b',
        scopes: ['read', 'write'],
        grantTypes: ['client_credentials'],
      });

      const all = await db.listClients();
      expect(all).toHaveLength(2);

      await db.deleteClient(all[0].id);
      expect(await db.listClients()).toHaveLength(1);
    });
  });

  // --- Users ---

  describe('users', () => {
    it('creates and retrieves a user by username', async () => {
      const u = await db.createUser({
        username: 'admin',
        password: 'secret123',
        role: 'admin',
      });
      expect(u.id).toBeTruthy();
      expect(u.passwordHash).toBeTruthy();
      expect(u.passwordHash).not.toBe('secret123');

      const fetched = await db.getUserByUsername('admin');
      expect(fetched).not.toBeNull();
      expect(fetched!.role).toBe('admin');
    });

    it('returns null for non-existent user', async () => {
      expect(await db.getUserByUsername('nobody')).toBeNull();
    });
  });

  // --- Webhooks ---

  describe('webhooks', () => {
    it('creates, lists, and deletes webhooks', async () => {
      const w = await db.createWebhook({
        url: 'https://example.com/hook',
        secret: 'shh',
        events: ['update.proposed'],
      });
      expect(w.id).toBeTruthy();
      expect(w.active).toBe(true);

      const all = await db.listWebhooks();
      expect(all).toHaveLength(1);

      await db.deleteWebhook(w.id);
      expect(await db.listWebhooks()).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run test -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/db/sqlite-adapter.test.ts
```

- [ ] **Step 3: Implement DB adapter interface**

Create `packages/compliance/src/db/adapter.ts`:

```typescript
import type {
  Jurisdiction, Regulation, Requirement, RequirementWithRegulation,
  UpdateProposal, MonitoredSource, OAuthClient, User, Webhook,
  JurisdictionFilters, RegulationFilters, RequirementFilters,
  CreateJurisdictionInput, CreateRegulationInput, CreateRequirementInput,
  CreateUpdateProposalInput, CreateSourceInput, CreateClientInput,
  CreateUserInput, CreateWebhookInput,
} from '../types.js';

export interface DbAdapter {
  // Jurisdictions
  listJurisdictions(filters?: JurisdictionFilters): Promise<Jurisdiction[]>;
  getJurisdiction(id: string): Promise<Jurisdiction | null>;
  createJurisdiction(data: CreateJurisdictionInput): Promise<Jurisdiction>;
  updateJurisdiction(
    id: string,
    data: Partial<CreateJurisdictionInput>,
  ): Promise<Jurisdiction>;
  deleteJurisdiction(id: string): Promise<void>;

  // Regulations
  listRegulations(filters?: RegulationFilters): Promise<Regulation[]>;
  getRegulation(id: string): Promise<Regulation | null>;
  createRegulation(data: CreateRegulationInput): Promise<Regulation>;
  updateRegulation(
    id: string,
    data: Partial<CreateRegulationInput>,
  ): Promise<Regulation>;
  deleteRegulation(id: string): Promise<void>;

  // Requirements
  listRequirements(filters?: RequirementFilters): Promise<Requirement[]>;
  createRequirement(data: CreateRequirementInput): Promise<Requirement>;
  updateRequirement(
    id: string,
    data: Partial<CreateRequirementInput>,
  ): Promise<Requirement>;
  deleteRequirement(id: string): Promise<void>;
  bulkCreateRequirements(
    data: readonly CreateRequirementInput[],
  ): Promise<Requirement[]>;

  // Requirements by criterion (used by compliance checker)
  findRequirementsByCriteria(
    jurisdictionIds: readonly string[],
    wcagCriteria: readonly string[],
  ): Promise<RequirementWithRegulation[]>;

  // Update proposals
  listUpdateProposals(
    filters?: { status?: string },
  ): Promise<UpdateProposal[]>;
  getUpdateProposal(id: string): Promise<UpdateProposal | null>;
  createUpdateProposal(
    data: CreateUpdateProposalInput,
  ): Promise<UpdateProposal>;
  updateUpdateProposal(
    id: string,
    data: Partial<UpdateProposal>,
  ): Promise<UpdateProposal>;

  // Monitored sources
  listSources(): Promise<MonitoredSource[]>;
  createSource(data: CreateSourceInput): Promise<MonitoredSource>;
  deleteSource(id: string): Promise<void>;
  updateSourceLastChecked(
    id: string,
    contentHash: string,
  ): Promise<void>;

  // OAuth clients
  getClientById(clientId: string): Promise<OAuthClient | null>;
  createClient(
    data: CreateClientInput,
  ): Promise<OAuthClient & { secret: string }>;
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
  initialize(): Promise<void>;
  close(): Promise<void>;
}
```

- [ ] **Step 4: Implement SQLite adapter**

Create `packages/compliance/src/db/sqlite-adapter.ts`:

The implementing agent should create a class `SqliteAdapter implements DbAdapter` that:
- Accepts a `dbPath` string (`:memory:` for tests)
- Uses `better-sqlite3` with WAL mode and foreign keys enabled
- Creates all tables in `initialize()` with proper constraints and foreign keys
- Stores `sectors`, `scopes`, `grantTypes`, `events`, `proposedChanges`, `redirectUris` as JSON strings (parsed on read)
- Uses `randomUUID()` for auto-generated IDs
- Uses `bcrypt` (`hashSync`/`genSaltSync`) for password and client secret hashing
- `createClient()` returns the plaintext secret alongside the hashed version
- `findRequirementsByCriteria()` JOINs requirements with regulations, filtering by jurisdiction and criteria (including wildcard `*`)
- All methods return immutable-shaped objects matching the interfaces

Table schemas:
- `jurisdictions`: id TEXT PK, name, type, parentId (FK self), iso3166, createdAt, updatedAt
- `regulations`: id TEXT PK, jurisdictionId (FK), name, shortName, reference, url, enforcementDate, status, scope, sectors (JSON), description, createdAt, updatedAt
- `requirements`: id TEXT PK, regulationId (FK), wcagVersion, wcagLevel, wcagCriterion, obligation, notes, createdAt, updatedAt
- `update_proposals`: id TEXT PK, source, detectedAt, type, affectedRegulationId, affectedJurisdictionId, summary, proposedChanges (JSON), status, reviewedBy, reviewedAt, createdAt
- `monitored_sources`: id TEXT PK, name, url, type, schedule, lastCheckedAt, lastContentHash, createdAt
- `oauth_clients`: id TEXT PK, name, secretHash, scopes (JSON), grantTypes (JSON), redirectUris (JSON nullable), createdAt
- `users`: id TEXT PK, username UNIQUE, passwordHash, role, createdAt
- `webhooks`: id TEXT PK, url, secret, events (JSON), active INTEGER, createdAt

- [ ] **Step 5: Run test -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/db/sqlite-adapter.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/db/adapter.ts packages/compliance/src/db/sqlite-adapter.ts packages/compliance/tests/db/sqlite-adapter.test.ts
git commit -m "feat(compliance): add DB adapter interface and SQLite implementation"
```

---

### Task 1.5: OAuth2 Token Signing and Verification

**Files:**
- Create: `packages/compliance/src/auth/oauth.ts`
- Create: `packages/compliance/src/auth/scopes.ts`
- Create: `packages/compliance/tests/auth/oauth.test.ts`
- Create: `packages/compliance/tests/auth/scopes.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/compliance/tests/auth/scopes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  SCOPES,
  hasScope,
  scopeCoversEndpoint,
} from '../../src/auth/scopes.js';

describe('Scopes', () => {
  it('defines read, write, admin scopes', () => {
    expect(SCOPES).toContain('read');
    expect(SCOPES).toContain('write');
    expect(SCOPES).toContain('admin');
  });

  it('hasScope returns true when scope is present', () => {
    expect(hasScope(['read', 'write'], 'read')).toBe(true);
  });

  it('hasScope returns false when scope is missing', () => {
    expect(hasScope(['read'], 'admin')).toBe(false);
  });

  it('admin scope grants access to read/write/admin endpoints', () => {
    expect(scopeCoversEndpoint(['admin'], 'read')).toBe(true);
    expect(scopeCoversEndpoint(['admin'], 'write')).toBe(true);
    expect(scopeCoversEndpoint(['admin'], 'admin')).toBe(true);
  });

  it('write scope grants access to read and write but not admin', () => {
    expect(scopeCoversEndpoint(['write'], 'read')).toBe(true);
    expect(scopeCoversEndpoint(['write'], 'write')).toBe(true);
    expect(scopeCoversEndpoint(['write'], 'admin')).toBe(false);
  });

  it('read scope grants access to read only', () => {
    expect(scopeCoversEndpoint(['read'], 'read')).toBe(true);
    expect(scopeCoversEndpoint(['read'], 'write')).toBe(false);
    expect(scopeCoversEndpoint(['read'], 'admin')).toBe(false);
  });
});
```

Create `packages/compliance/tests/auth/oauth.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, exportSPKI, exportPKCS8 } from 'jose';
import {
  createTokenSigner,
  createTokenVerifier,
  type TokenPayload,
} from '../../src/auth/oauth.js';

describe('OAuth token signing and verification', () => {
  let privateKeyPem: string;
  let publicKeyPem: string;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    privateKeyPem = await exportPKCS8(privateKey);
    publicKeyPem = await exportSPKI(publicKey);
  });

  it('signs and verifies a token with valid claims', async () => {
    const sign = await createTokenSigner(privateKeyPem);
    const verify = await createTokenVerifier(publicKeyPem);

    const token = await sign({
      sub: 'client-123',
      scopes: ['read', 'write'],
      expiresIn: '1h',
    });

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');

    const payload = await verify(token);
    expect(payload.sub).toBe('client-123');
    expect(payload.scopes).toEqual(['read', 'write']);
  });

  it('rejects an expired token', async () => {
    const sign = await createTokenSigner(privateKeyPem);
    const verify = await createTokenVerifier(publicKeyPem);

    const token = await sign({
      sub: 'client-123',
      scopes: ['read'],
      expiresIn: '0s',
    });

    // Wait a moment for expiry
    await new Promise((r) => setTimeout(r, 1100));
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects a tampered token', async () => {
    const sign = await createTokenSigner(privateKeyPem);
    const verify = await createTokenVerifier(publicKeyPem);

    const token = await sign({
      sub: 'client-123',
      scopes: ['read'],
      expiresIn: '1h',
    });

    const tampered = token.slice(0, -5) + 'XXXXX';
    await expect(verify(tampered)).rejects.toThrow();
  });

  it('rejects a token signed with a different key', async () => {
    const { privateKey: otherKey } = await generateKeyPair('RS256');
    const otherPem = await exportPKCS8(otherKey);

    const signOther = await createTokenSigner(otherPem);
    const verify = await createTokenVerifier(publicKeyPem);

    const token = await signOther({
      sub: 'hacker',
      scopes: ['admin'],
      expiresIn: '1h',
    });

    await expect(verify(token)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/auth/
```

- [ ] **Step 3: Implement scopes**

Create `packages/compliance/src/auth/scopes.ts`:

```typescript
export const SCOPES = ['read', 'write', 'admin'] as const;
export type Scope = (typeof SCOPES)[number];

const SCOPE_HIERARCHY: Record<Scope, readonly Scope[]> = {
  admin: ['read', 'write', 'admin'],
  write: ['read', 'write'],
  read: ['read'],
};

export function hasScope(
  tokenScopes: readonly string[],
  required: string,
): boolean {
  return tokenScopes.includes(required);
}

export function scopeCoversEndpoint(
  tokenScopes: readonly string[],
  requiredScope: Scope,
): boolean {
  for (const scope of tokenScopes) {
    const covered = SCOPE_HIERARCHY[scope as Scope];
    if (covered && covered.includes(requiredScope)) {
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Implement OAuth token utilities**

Create `packages/compliance/src/auth/oauth.ts`:

```typescript
import {
  importPKCS8,
  importSPKI,
  SignJWT,
  jwtVerify,
  type JWTPayload,
} from 'jose';

export interface TokenPayload {
  readonly sub: string;
  readonly scopes: readonly string[];
  readonly iat?: number;
  readonly exp?: number;
}

export interface SignTokenInput {
  readonly sub: string;
  readonly scopes: readonly string[];
  readonly expiresIn: string;
}

export type TokenSigner = (input: SignTokenInput) => Promise<string>;
export type TokenVerifier = (token: string) => Promise<TokenPayload>;

export async function createTokenSigner(
  privateKeyPem: string,
): Promise<TokenSigner> {
  const privateKey = await importPKCS8(privateKeyPem, 'RS256');

  return async (input: SignTokenInput): Promise<string> => {
    const jwt = new SignJWT(
      { scopes: input.scopes } as unknown as JWTPayload,
    )
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(input.sub)
      .setIssuedAt()
      .setExpirationTime(input.expiresIn);

    return jwt.sign(privateKey);
  };
}

export async function createTokenVerifier(
  publicKeyPem: string,
): Promise<TokenVerifier> {
  const publicKey = await importSPKI(publicKeyPem, 'RS256');

  return async (token: string): Promise<TokenPayload> => {
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['RS256'],
    });
    return {
      sub: payload.sub!,
      scopes: (payload as Record<string, unknown>).scopes as string[],
      iat: payload.iat,
      exp: payload.exp,
    };
  };
}
```

- [ ] **Step 5: Run tests -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/auth/
```

- [ ] **Step 6: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/auth/ packages/compliance/tests/auth/
git commit -m "feat(compliance): add OAuth2 token signing/verification and scope system"
```

---

## Wave 2 -- Core Engine (parallel tasks, depends on Wave 1)

### Task 2.1: Compliance Checker Algorithm

**Files:**
- Create: `packages/compliance/src/engine/checker.ts`
- Create: `packages/compliance/tests/engine/checker.test.ts`

- [ ] **Step 1: Write test**

Create `packages/compliance/tests/engine/checker.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkCompliance } from '../../src/engine/checker.js';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../../src/db/adapter.js';

describe('Compliance Checker', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();

    // Seed test data
    await db.createJurisdiction({
      id: 'EU', name: 'European Union', type: 'supranational',
    });
    await db.createJurisdiction({
      id: 'DE', name: 'Germany', type: 'country', parentId: 'EU',
    });
    await db.createJurisdiction({
      id: 'US', name: 'United States', type: 'country',
    });

    await db.createRegulation({
      id: 'eu-eaa', jurisdictionId: 'EU',
      name: 'European Accessibility Act', shortName: 'EAA',
      reference: 'ref', url: 'url', enforcementDate: '2025-06-28',
      status: 'active', scope: 'all',
      sectors: ['e-commerce', 'banking'], description: 'desc',
    });
    await db.createRegulation({
      id: 'us-508', jurisdictionId: 'US', name: 'Section 508',
      shortName: 'Section 508', reference: 'ref', url: 'url',
      enforcementDate: '1998-08-07', status: 'active', scope: 'public',
      sectors: ['government'], description: 'desc',
    });

    // EU EAA: all WCAG 2.1 AA mandatory (wildcard)
    await db.createRequirement({
      regulationId: 'eu-eaa', wcagVersion: '2.1', wcagLevel: 'AA',
      wcagCriterion: '*', obligation: 'mandatory',
    });
    // US 508: specific criterion
    await db.createRequirement({
      regulationId: 'us-508', wcagVersion: '2.0', wcagLevel: 'AA',
      wcagCriterion: '1.1.1', obligation: 'mandatory',
    });
    // US 508: optional requirement
    await db.createRequirement({
      regulationId: 'us-508', wcagVersion: '2.0', wcagLevel: 'AAA',
      wcagCriterion: '1.4.6', obligation: 'optional',
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns pass when no issues match mandatory requirements', async () => {
    const result = await checkCompliance(db, {
      jurisdictions: ['US'],
      issues: [{
        code: 'WCAG2AAA.Principle1.Guideline1_4.1_4_6.G17',
        type: 'error', message: 'Contrast', selector: 'p', context: '<p>',
      }],
    });
    expect(result.matrix['US'].status).toBe('pass');
    expect(result.matrix['US'].mandatoryViolations).toBe(0);
  });

  it('returns fail when mandatory issues are found', async () => {
    const result = await checkCompliance(db, {
      jurisdictions: ['EU'],
      issues: [{
        code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
        type: 'error', message: 'Missing alt', selector: 'img',
        context: '<img>',
      }],
    });
    expect(result.matrix['EU'].status).toBe('fail');
    expect(result.matrix['EU'].mandatoryViolations).toBe(1);
  });

  it('handles jurisdiction inheritance (DE includes EU)', async () => {
    const result = await checkCompliance(db, {
      jurisdictions: ['DE'],
      issues: [{
        code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
        type: 'error', message: 'Missing alt', selector: 'img',
        context: '<img>',
      }],
    });
    expect(result.matrix['DE'].status).toBe('fail');
  });

  it('handles wildcard requirement matching WCAG2A and WCAG2AA codes', async () => {
    const result = await checkCompliance(db, {
      jurisdictions: ['EU'],
      issues: [
        {
          code: 'WCAG2A.Principle4.Guideline4_1.4_1_2.H91.InputText.Name',
          type: 'error', message: 'Missing name', selector: 'input',
          context: '<input>',
        },
        {
          code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
          type: 'error', message: 'Missing alt', selector: 'img',
          context: '<img>',
        },
      ],
    });
    expect(result.matrix['EU'].mandatoryViolations).toBe(2);
  });

  it('includes optional violations when includeOptional is true', async () => {
    const result = await checkCompliance(db, {
      jurisdictions: ['US'],
      issues: [{
        code: 'WCAG2AAA.Principle1.Guideline1_4.1_4_6.G17',
        type: 'error', message: 'Contrast', selector: 'p', context: '<p>',
      }],
      includeOptional: true,
    });
    expect(result.matrix['US'].optionalViolations).toBe(1);
    expect(result.annotatedIssues).toHaveLength(1);
  });

  it('excludes optional violations by default', async () => {
    const result = await checkCompliance(db, {
      jurisdictions: ['US'],
      issues: [{
        code: 'WCAG2AAA.Principle1.Guideline1_4.1_4_6.G17',
        type: 'error', message: 'Contrast', selector: 'p', context: '<p>',
      }],
    });
    expect(result.annotatedIssues).toHaveLength(0);
  });

  it('filters by sectors', async () => {
    const result = await checkCompliance(db, {
      jurisdictions: ['EU'],
      issues: [{
        code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
        type: 'error', message: 'Missing alt', selector: 'img',
        context: '<img>',
      }],
      sectors: ['government'],
    });
    // EAA sectors are e-commerce/banking, not government
    expect(result.matrix['EU'].status).toBe('pass');
  });

  it('produces correct summary counts', async () => {
    const result = await checkCompliance(db, {
      jurisdictions: ['EU', 'US'],
      issues: [{
        code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
        type: 'error', message: 'Missing alt', selector: 'img',
        context: '<img>',
      }],
    });
    expect(result.summary.totalJurisdictions).toBe(2);
    expect(result.summary.failing).toBeGreaterThanOrEqual(1);
    expect(result.summary.totalMandatoryViolations).toBeGreaterThanOrEqual(1);
  });

  it('annotates issues with regulation metadata', async () => {
    const result = await checkCompliance(db, {
      jurisdictions: ['EU'],
      issues: [{
        code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
        type: 'error', message: 'Missing alt', selector: 'img',
        context: '<img>',
      }],
    });
    expect(result.annotatedIssues).toHaveLength(1);
    const annotated = result.annotatedIssues[0];
    expect(annotated.wcagCriterion).toBe('1.1.1');
    expect(annotated.wcagLevel).toBe('AA');
    expect(annotated.regulations).toHaveLength(1);
    expect(annotated.regulations[0].regulationId).toBe('eu-eaa');
    expect(annotated.regulations[0].obligation).toBe('mandatory');
  });

  it('returns empty result for unknown jurisdictions', async () => {
    const result = await checkCompliance(db, {
      jurisdictions: ['XX'],
      issues: [{
        code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
        type: 'error', message: 'Missing alt', selector: 'img',
        context: '<img>',
      }],
    });
    expect(result.summary.totalJurisdictions).toBe(1);
    expect(result.matrix['XX'].status).toBe('pass');
  });

  it('handles empty issues array', async () => {
    const result = await checkCompliance(db, {
      jurisdictions: ['EU'],
      issues: [],
    });
    expect(result.matrix['EU'].status).toBe('pass');
    expect(result.annotatedIssues).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/engine/checker.test.ts
```

- [ ] **Step 3: Implement checker**

Create `packages/compliance/src/engine/checker.ts`:

The implementing agent should create a function `checkCompliance(db: DbAdapter, request: ComplianceCheckRequest): Promise<ComplianceCheckResponse>` that follows the algorithm from the spec:

1. Parse each issue code using `parseIssueCode()` to extract criterion and level
2. Resolve jurisdiction hierarchy: for each requested jurisdiction, walk up `parentId` chain to include parent jurisdictions
3. Query requirements via `db.findRequirementsByCriteria()` with all resolved jurisdiction IDs and unique criteria
4. Filter by sectors if specified (check regulation's sectors array)
5. Filter out optional requirements unless `includeOptional` is true
6. For wildcard requirements (`wcagCriterion: "*"`), match based on level hierarchy: AA wildcard matches A and AA level issues, AAA matches all three
7. Build annotated issues: for each issue, find matching requirements and attach regulation metadata
8. Build jurisdiction matrix: for each requested jurisdiction, group violations by regulation, count mandatory/recommended/optional, set status to 'fail' if any mandatory violations
9. Return `{ matrix, annotatedIssues, summary }`

- [ ] **Step 4: Run test -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/engine/checker.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/engine/checker.ts packages/compliance/tests/engine/checker.test.ts
git commit -m "feat(compliance): add compliance checker algorithm with jurisdiction inheritance"
```

---

### Task 2.2: CRUD Operations

**Files:**
- Create: `packages/compliance/src/engine/crud.ts`
- Create: `packages/compliance/tests/engine/crud.test.ts`

- [ ] **Step 1: Write test**

Create `packages/compliance/tests/engine/crud.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../../src/db/adapter.js';
import {
  createJurisdiction, getJurisdiction, listJurisdictions,
  updateJurisdiction, deleteJurisdiction,
  createRegulation, getRegulation, listRegulations,
  updateRegulation, deleteRegulation,
  createRequirement, listRequirements, updateRequirement,
  deleteRequirement, bulkCreateRequirements,
} from '../../src/engine/crud.js';

describe('CRUD Operations', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Jurisdictions', () => {
    it('creates a jurisdiction with validation', async () => {
      const result = await createJurisdiction(db, {
        id: 'EU', name: 'European Union', type: 'supranational',
      });
      expect(result.id).toBe('EU');
    });

    it('rejects empty id', async () => {
      await expect(createJurisdiction(db, {
        id: '', name: 'Test', type: 'country',
      })).rejects.toThrow();
    });

    it('rejects empty name', async () => {
      await expect(createJurisdiction(db, {
        id: 'XX', name: '', type: 'country',
      })).rejects.toThrow();
    });

    it('gets, lists, updates, deletes jurisdictions', async () => {
      await createJurisdiction(db, {
        id: 'EU', name: 'European Union', type: 'supranational',
      });
      expect(await getJurisdiction(db, 'EU')).not.toBeNull();
      expect(await getJurisdiction(db, 'XX')).toBeNull();

      await createJurisdiction(db, {
        id: 'DE', name: 'Germany', type: 'country', parentId: 'EU',
      });
      const countries = await listJurisdictions(db, { type: 'country' });
      expect(countries).toHaveLength(1);

      const updated = await updateJurisdiction(db, 'EU', {
        name: 'EU Updated',
      });
      expect(updated.name).toBe('EU Updated');

      await expect(
        updateJurisdiction(db, 'XX', { name: 'Test' }),
      ).rejects.toThrow();

      await deleteJurisdiction(db, 'EU');
      expect(await getJurisdiction(db, 'EU')).toBeNull();
    });
  });

  describe('Regulations', () => {
    beforeEach(async () => {
      await createJurisdiction(db, {
        id: 'EU', name: 'European Union', type: 'supranational',
      });
    });

    const validRegulation = {
      id: 'eu-eaa', jurisdictionId: 'EU', name: 'EAA', shortName: 'EAA',
      reference: 'ref', url: 'https://example.com',
      enforcementDate: '2025-06-28', status: 'active' as const,
      scope: 'all' as const, sectors: ['e-commerce'], description: 'desc',
    };

    it('creates a regulation with validation', async () => {
      const result = await createRegulation(db, validRegulation);
      expect(result.id).toBe('eu-eaa');
    });

    it('rejects empty id', async () => {
      await expect(
        createRegulation(db, { ...validRegulation, id: '' }),
      ).rejects.toThrow();
    });

    it('gets, lists, updates, deletes regulations', async () => {
      await createRegulation(db, validRegulation);
      expect(await getRegulation(db, 'eu-eaa')).not.toBeNull();
      expect(await listRegulations(db)).toHaveLength(1);
      const updated = await updateRegulation(db, 'eu-eaa', {
        status: 'repealed',
      });
      expect(updated.status).toBe('repealed');
      await deleteRegulation(db, 'eu-eaa');
      expect(await getRegulation(db, 'eu-eaa')).toBeNull();
    });
  });

  describe('Requirements', () => {
    beforeEach(async () => {
      await createJurisdiction(db, {
        id: 'EU', name: 'European Union', type: 'supranational',
      });
      await createRegulation(db, {
        id: 'eu-eaa', jurisdictionId: 'EU', name: 'EAA', shortName: 'EAA',
        reference: 'ref', url: 'url', enforcementDate: '2025-06-28',
        status: 'active', scope: 'all', sectors: [], description: 'desc',
      });
    });

    const validReq = {
      regulationId: 'eu-eaa', wcagVersion: '2.1' as const,
      wcagLevel: 'AA' as const, wcagCriterion: '*',
      obligation: 'mandatory' as const,
    };

    it('creates, lists, updates, deletes requirements', async () => {
      const req = await createRequirement(db, validReq);
      expect(req.id).toBeTruthy();
      expect(await listRequirements(db)).toHaveLength(1);
      const updated = await updateRequirement(db, req.id, {
        obligation: 'recommended',
      });
      expect(updated.obligation).toBe('recommended');
      await deleteRequirement(db, req.id);
      expect(await listRequirements(db)).toHaveLength(0);
    });

    it('bulk creates requirements', async () => {
      const results = await bulkCreateRequirements(db, [
        validReq,
        { ...validReq, wcagCriterion: '1.1.1' },
      ]);
      expect(results).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Run test -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/engine/crud.test.ts
```

- [ ] **Step 3: Implement CRUD**

Create `packages/compliance/src/engine/crud.ts`:

The implementing agent should create thin wrapper functions around `DbAdapter` methods that add input validation (non-empty id, non-empty name, non-empty regulationId). Each function takes `db: DbAdapter` as its first argument. Functions to export:
- `createJurisdiction`, `getJurisdiction`, `listJurisdictions`, `updateJurisdiction`, `deleteJurisdiction`
- `createRegulation`, `getRegulation`, `listRegulations`, `updateRegulation`, `deleteRegulation`
- `createRequirement`, `listRequirements`, `updateRequirement`, `deleteRequirement`, `bulkCreateRequirements`

Validation: throw `Error` with descriptive message for empty required fields.

- [ ] **Step 4: Run test -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/engine/crud.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/engine/crud.ts packages/compliance/tests/engine/crud.test.ts
git commit -m "feat(compliance): add validated CRUD operations for all entities"
```

---

### Task 2.3: Update Proposal Workflow

**Files:**
- Create: `packages/compliance/src/engine/proposals.ts`
- Create: `packages/compliance/tests/engine/proposals.test.ts`

- [ ] **Step 1: Write test**

Create `packages/compliance/tests/engine/proposals.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../../src/db/adapter.js';
import {
  proposeUpdate, approveProposal, rejectProposal,
  listProposals, getProposal,
} from '../../src/engine/proposals.js';

describe('Update Proposal Workflow', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
    await db.createJurisdiction({
      id: 'EU', name: 'European Union', type: 'supranational',
    });
    await db.createRegulation({
      id: 'eu-eaa', jurisdictionId: 'EU', name: 'EAA', shortName: 'EAA',
      reference: 'ref', url: 'url', enforcementDate: '2025-06-28',
      status: 'active', scope: 'all', sectors: [], description: 'desc',
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates a pending proposal', async () => {
    const p = await proposeUpdate(db, {
      source: 'https://example.com', type: 'amendment',
      affectedRegulationId: 'eu-eaa', summary: 'Name change',
      proposedChanges: {
        action: 'update', entityType: 'regulation', entityId: 'eu-eaa',
        before: { name: 'EAA' }, after: { name: 'EAA v2' },
      },
    });
    expect(p.status).toBe('pending');
    expect(p.id).toBeTruthy();
  });

  it('lists proposals filtered by status', async () => {
    await proposeUpdate(db, {
      source: 'src', type: 'amendment', summary: 'Change',
      proposedChanges: {
        action: 'update', entityType: 'regulation',
        entityId: 'eu-eaa', after: {},
      },
    });
    expect(await listProposals(db, 'pending')).toHaveLength(1);
    expect(await listProposals(db, 'approved')).toHaveLength(0);
  });

  it('approves a proposal and applies update changes', async () => {
    const p = await proposeUpdate(db, {
      source: 'src', type: 'amendment',
      affectedRegulationId: 'eu-eaa', summary: 'Update name',
      proposedChanges: {
        action: 'update', entityType: 'regulation', entityId: 'eu-eaa',
        before: { name: 'EAA' }, after: { name: 'EAA Updated' },
      },
    });
    const approved = await approveProposal(db, p.id, 'admin-user');
    expect(approved.status).toBe('approved');
    expect(approved.reviewedBy).toBe('admin-user');
    const reg = await db.getRegulation('eu-eaa');
    expect(reg!.name).toBe('EAA Updated');
  });

  it('approves a proposal with create action', async () => {
    const p = await proposeUpdate(db, {
      source: 'src', type: 'new_jurisdiction', summary: 'Add JP',
      proposedChanges: {
        action: 'create', entityType: 'jurisdiction',
        after: { id: 'JP', name: 'Japan', type: 'country' },
      },
    });
    await approveProposal(db, p.id, 'admin');
    const jp = await db.getJurisdiction('JP');
    expect(jp).not.toBeNull();
    expect(jp!.name).toBe('Japan');
  });

  it('approves a proposal with delete action', async () => {
    const p = await proposeUpdate(db, {
      source: 'src', type: 'repeal', summary: 'Repeal EAA',
      proposedChanges: {
        action: 'delete', entityType: 'regulation', entityId: 'eu-eaa',
      },
    });
    await approveProposal(db, p.id, 'admin');
    expect(await db.getRegulation('eu-eaa')).toBeNull();
  });

  it('rejects a proposal', async () => {
    const p = await proposeUpdate(db, {
      source: 'src', type: 'amendment', summary: 'Bad change',
      proposedChanges: {
        action: 'update', entityType: 'regulation',
        entityId: 'eu-eaa', after: {},
      },
    });
    const rejected = await rejectProposal(db, p.id, 'admin-user');
    expect(rejected.status).toBe('rejected');
  });

  it('throws when approving non-existent proposal', async () => {
    await expect(
      approveProposal(db, 'nonexistent', 'admin'),
    ).rejects.toThrow();
  });

  it('throws when approving already approved proposal', async () => {
    const p = await proposeUpdate(db, {
      source: 'src', type: 'new_jurisdiction', summary: 'Add JP',
      proposedChanges: {
        action: 'create', entityType: 'jurisdiction',
        after: { id: 'JP', name: 'Japan', type: 'country' },
      },
    });
    await approveProposal(db, p.id, 'admin');
    await expect(
      approveProposal(db, p.id, 'admin'),
    ).rejects.toThrow();
  });

  it('only updates specified fields in after (partial update)', async () => {
    const p = await proposeUpdate(db, {
      source: 'src', type: 'amendment', summary: 'Change status only',
      proposedChanges: {
        action: 'update', entityType: 'regulation', entityId: 'eu-eaa',
        after: { status: 'repealed' },
      },
    });
    await approveProposal(db, p.id, 'admin');
    const reg = await db.getRegulation('eu-eaa');
    expect(reg!.status).toBe('repealed');
    expect(reg!.name).toBe('EAA'); // unchanged
    expect(reg!.shortName).toBe('EAA'); // unchanged
  });
});
```

- [ ] **Step 2: Run test -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/engine/proposals.test.ts
```

- [ ] **Step 3: Implement proposals**

Create `packages/compliance/src/engine/proposals.ts`:

The implementing agent should create functions:
- `proposeUpdate(db, data)` -- creates a pending proposal
- `listProposals(db, status?)` -- lists proposals filtered by status
- `getProposal(db, id)` -- gets a single proposal
- `approveProposal(db, id, reviewedBy)` -- validates the proposal is pending, then dispatches to the correct CRUD operation based on `action` and `entityType`, then updates the proposal status to approved
- `rejectProposal(db, id, reviewedBy)` -- validates the proposal is pending, then updates the proposal status to rejected

For `approveProposal`, dispatch logic:
- `action: 'create'` + `entityType: 'jurisdiction'` calls `db.createJurisdiction(after)`
- `action: 'create'` + `entityType: 'regulation'` calls `db.createRegulation(after)`
- `action: 'create'` + `entityType: 'requirement'` calls `db.createRequirement(after)`
- `action: 'update'` calls `db.update[EntityType](entityId, after)` -- partial update
- `action: 'delete'` calls `db.delete[EntityType](entityId)`

Throw if proposal not found or not pending.

- [ ] **Step 4: Run test -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/engine/proposals.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/engine/proposals.ts packages/compliance/tests/engine/proposals.test.ts
git commit -m "feat(compliance): add update proposal workflow with approve/reject/apply"
```

---

### Task 2.4: Baseline Seed Data + Loader

**Files:**
- Create: `packages/compliance/src/seed/baseline.json`
- Create: `packages/compliance/src/seed/loader.ts`
- Create: `packages/compliance/tests/seed/loader.test.ts`

- [ ] **Step 1: Write test**

Create `packages/compliance/tests/seed/loader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../../src/db/adapter.js';
import { loadBaseline, getSeedStatus } from '../../src/seed/loader.js';

describe('Seed Loader', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  it('loads baseline data into an empty database', async () => {
    const result = await loadBaseline(db);
    expect(result.jurisdictions).toBeGreaterThanOrEqual(8);
    expect(result.regulations).toBeGreaterThanOrEqual(8);
    expect(result.requirements).toBeGreaterThanOrEqual(8);
  });

  it('is idempotent -- second load does not create duplicates', async () => {
    const first = await loadBaseline(db);
    const second = await loadBaseline(db);
    expect(second.jurisdictions).toBe(first.jurisdictions);
    expect(second.regulations).toBe(first.regulations);
  });

  it('getSeedStatus returns counts', async () => {
    await loadBaseline(db);
    const status = await getSeedStatus(db);
    expect(status.seeded).toBe(true);
    expect(status.jurisdictions).toBeGreaterThanOrEqual(8);
    expect(status.regulations).toBeGreaterThanOrEqual(8);
    expect(status.requirements).toBeGreaterThanOrEqual(8);
  });

  it('getSeedStatus returns not seeded for empty db', async () => {
    const status = await getSeedStatus(db);
    expect(status.seeded).toBe(false);
    expect(status.jurisdictions).toBe(0);
  });

  it('baseline includes EU, US, UK, DE, FR, AU, CA, JP', async () => {
    await loadBaseline(db);
    const ids = ['EU', 'US', 'UK', 'DE', 'FR', 'AU', 'CA', 'JP'];
    for (const id of ids) {
      const j = await db.getJurisdiction(id);
      expect(j, `Expected jurisdiction ${id} to exist`).not.toBeNull();
    }
  });

  it('EU member states have parentId set to EU', async () => {
    await loadBaseline(db);
    const de = await db.getJurisdiction('DE');
    expect(de!.parentId).toBe('EU');
    const fr = await db.getJurisdiction('FR');
    expect(fr!.parentId).toBe('EU');
  });
});
```

- [ ] **Step 2: Run test -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/seed/loader.test.ts
```

- [ ] **Step 3: Create baseline.json**

Create `packages/compliance/src/seed/baseline.json` with the initial seed dataset covering 11 jurisdictions (EU, US, UK, DE, FR, IT, ES, NL, AU, CA, JP) and their key regulations:

| Jurisdiction | Regulations |
|---|---|
| EU | European Accessibility Act (EAA), Web Accessibility Directive (WAD) |
| US | Section 508, ADA |
| UK | Equality Act 2010, PSBAR |
| DE | BFSG |
| FR | RGAA |
| AU | DDA |
| CA | AODA |
| JP | JIS X 8341-3 |

Each regulation gets a wildcard requirement (`wcagCriterion: "*"`) at the appropriate WCAG version/level as mandatory.

> **Note:** This is the initial seed dataset. The full 60+ jurisdiction dataset will be expanded after the core engine is proven. Additional jurisdictions to add: IE, AT, BE, PT, SE, FI, DK, NO, CH, PL, CZ, RO, GR, BG, HR, SK, SI, LT, LV, EE, LU, CY, MT, IN, KR, NZ, SG, IL, BR, MX, ZA, KE, NG, AE, SA, and US states (CA-AB1757, NY, IL, CO, etc.).

- [ ] **Step 4: Implement loader**

Create `packages/compliance/src/seed/loader.ts`:

The implementing agent should create:
- `loadBaseline(db, baselinePath?)` -- reads `baseline.json`, upserts jurisdictions (insert or update by ID), upserts regulations, deduplicates requirements by `regulationId:wcagCriterion:wcagLevel` key. Returns `{ jurisdictions, regulations, requirements }` counts.
- `getSeedStatus(db)` -- returns `{ seeded: boolean, jurisdictions: number, regulations: number, requirements: number }` by querying list methods.

The loader should use `import.meta.url` to resolve the default baseline.json path relative to the module.

- [ ] **Step 5: Run test -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/seed/loader.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/seed/ packages/compliance/tests/seed/
git commit -m "feat(compliance): add baseline seed data (11 jurisdictions) and loader"
```

---

### Task 2.5: Webhook Dispatch

**Files:**
- Create: `packages/compliance/src/engine/webhooks.ts`
- Create: `packages/compliance/tests/engine/webhooks.test.ts`

- [ ] **Step 1: Write test**

Create `packages/compliance/tests/engine/webhooks.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../../src/db/adapter.js';
import {
  dispatchWebhookEvent, computeSignature, verifySignature,
} from '../../src/engine/webhooks.js';

describe('Webhook Dispatch', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  it('computeSignature produces sha256= prefixed hex', () => {
    const sig = computeSignature('{"test":true}', 'secret123');
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('verifySignature returns true for valid signature', () => {
    const body = '{"test":true}';
    const secret = 'secret123';
    const sig = computeSignature(body, secret);
    expect(verifySignature(body, secret, sig)).toBe(true);
  });

  it('verifySignature returns false for invalid signature', () => {
    expect(
      verifySignature('body', 'secret', 'sha256=invalid'),
    ).toBe(false);
  });

  it('dispatchWebhookEvent sends to matching webhooks', async () => {
    await db.createWebhook({
      url: 'https://example.com/hook',
      secret: 'test-secret',
      events: ['update.proposed'],
    });
    await db.createWebhook({
      url: 'https://other.com/hook',
      secret: 'other-secret',
      events: ['regulation.created'],
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await dispatchWebhookEvent(
      db, 'update.proposed', { id: 'test' },
    );
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://example.com/hook');
    const options = callArgs[1];
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['X-Webhook-Signature']).toMatch(/^sha256=/);

    vi.unstubAllGlobals();
  });

  it('handles fetch failures gracefully', async () => {
    await db.createWebhook({
      url: 'https://example.com/hook',
      secret: 'test-secret',
      events: ['update.proposed'],
    });

    const mockFetch = vi.fn().mockRejectedValue(
      new Error('Network error'),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await dispatchWebhookEvent(
      db, 'update.proposed', { id: 'test' },
    );
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/engine/webhooks.test.ts
```

- [ ] **Step 3: Implement webhook dispatch**

Create `packages/compliance/src/engine/webhooks.ts`:

The implementing agent should create:
- `computeSignature(body: string, secret: string): string` -- HMAC-SHA256, returns `sha256=<hex>`
- `verifySignature(body: string, secret: string, signature: string): boolean` -- timing-safe comparison
- `dispatchWebhookEvent(db, event, data): Promise<{ sent, failed }>` -- lists webhooks, filters by matching event, POSTs to each matching webhook with JSON body and `X-Webhook-Signature` header, retries up to 3 times with exponential backoff on 5xx/timeout

- [ ] **Step 4: Run test -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/engine/webhooks.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/engine/webhooks.ts packages/compliance/tests/engine/webhooks.test.ts
git commit -m "feat(compliance): add webhook dispatch with HMAC-SHA256 signatures"
```

---

## Wave 3 -- API Layer (parallel tasks, depends on Wave 2)

### Task 3.1: Fastify Server Setup with OpenAPI + Health

**Files:**
- Create: `packages/compliance/src/api/server.ts`
- Create: `packages/compliance/src/api/routes/health.ts`
- Create: `packages/compliance/tests/api/server.test.ts`
- Create: `packages/compliance/tests/api/health.test.ts`

- [ ] **Step 1: Write tests**

The tests should verify:
- `GET /api/v1/health` returns `{ status: 'ok' }` with 200, no auth required
- `GET /api/v1/openapi.json` returns valid OpenAPI 3.1 spec
- `GET /api/v1/docs/` returns Swagger UI HTML

Test setup: create an in-memory SQLite adapter, create server with `{ db }`, use `app.inject()`.

- [ ] **Step 2: Run tests -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/api/server.test.ts tests/api/health.test.ts
```

- [ ] **Step 3: Implement server and health route**

Create `packages/compliance/src/api/routes/health.ts` -- simple GET handler returning `{ status: 'ok' }`.

Create `packages/compliance/src/api/server.ts` with:
- Fastify instance with `@fastify/cors`, `@fastify/swagger` (OpenAPI 3.1), `@fastify/swagger-ui`
- Server options: `{ db, host?, port?, publicKeyPem?, privateKeyPem?, rateLimit? }`
- Routes registered under `/api/v1` prefix
- OpenAPI spec exposed at `GET /api/v1/openapi.json`
- Swagger UI at `/api/v1/docs`
- DB instance decorated on the app for route access

- [ ] **Step 4: Run tests -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/api/server.test.ts tests/api/health.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/api/ packages/compliance/tests/api/
git commit -m "feat(compliance): add Fastify server with OpenAPI and health endpoint"
```

---

### Task 3.2: Auth Middleware

**Files:**
- Create: `packages/compliance/src/auth/middleware.ts`
- Create: `packages/compliance/tests/auth/middleware.test.ts`

- [ ] **Step 1: Write test**

Tests should verify:
- Unprotected routes (health, openapi, docs, oauth/token, agent.json) are accessible without auth
- Protected routes return 401 without token
- Protected routes return 200 with valid token and correct scope
- Protected routes return 403 when scope is insufficient (e.g., read-only token on POST)
- Invalid/tampered tokens return 401

Test setup: generate RS256 key pair, create tokens with specific scopes, register a test route.

- [ ] **Step 2: Run test -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/auth/middleware.test.ts
```

- [ ] **Step 3: Implement auth middleware**

Create `packages/compliance/src/auth/middleware.ts`:

- `createAuthHook(publicKeyPem?)` -- returns a Fastify `onRequest` hook that:
  - Skips auth for unprotected routes (health, docs, openapi, oauth/token, agent.json)
  - If no publicKeyPem configured, runs in local mode with admin access
  - Otherwise extracts Bearer token, verifies with `createTokenVerifier`, sets `request.tokenPayload`
  - Returns 401 on missing/invalid token
- `requireScope(scope: Scope)` -- returns a Fastify preHandler that checks `request.tokenPayload.scopes` via `scopeCoversEndpoint`, returns 403 if insufficient

- [ ] **Step 4: Update server.ts to wire auth middleware and register a basic jurisdiction route for testing**

- [ ] **Step 5: Run test -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/auth/middleware.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/auth/middleware.ts packages/compliance/tests/auth/middleware.test.ts packages/compliance/src/api/server.ts
git commit -m "feat(compliance): add OAuth2 auth middleware with scope enforcement"
```

---

### Task 3.3: REST CRUD Routes + Pagination

**Files:**
- Create: `packages/compliance/src/api/routes/jurisdictions.ts`
- Create: `packages/compliance/src/api/routes/regulations.ts`
- Create: `packages/compliance/src/api/routes/requirements.ts`
- Create: `packages/compliance/src/api/pagination.ts`
- Create: `packages/compliance/tests/api/jurisdictions.test.ts`
- Create: `packages/compliance/tests/api/regulations.test.ts`
- Create: `packages/compliance/tests/api/requirements.test.ts`
- Create: `packages/compliance/tests/api/pagination.test.ts`

- [ ] **Step 1: Write tests**

Pagination test should verify: default limit=50/offset=0, custom values, max limit cap at 200, negative value defaults, `paginate()` function slicing.

Jurisdiction routes test should verify: POST creates (201, write scope), GET lists with pagination (200, read scope), GET /:id returns single (200/404), PATCH updates (200, write scope), DELETE requires admin scope (403 for write, 204 for admin), query filters (type, parentId).

Regulation and requirement route tests follow the same pattern. Requirements test should also verify `POST /requirements/bulk` with admin scope.

- [ ] **Step 2: Run tests -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/api/jurisdictions.test.ts tests/api/pagination.test.ts
```

- [ ] **Step 3: Implement pagination utility**

Create `packages/compliance/src/api/pagination.ts`:
- `parsePagination(query)` -- parse limit/offset from query string, defaults 50/0, max 200
- `paginate(items, limit, offset)` -- returns `PaginatedResponse<T>` envelope

- [ ] **Step 4: Implement CRUD routes**

Create route files for jurisdictions, regulations, requirements. Each route:
- Uses `requireScope` preHandler for appropriate scope (read for GET, write for POST/PATCH, admin for DELETE)
- Uses `parsePagination` + `paginate` for list endpoints
- Returns 404 for get-by-id when not found
- Returns 201 for create, 200 for update, 204 for delete
- `POST /requirements/bulk` accepts array body, requires admin scope

- [ ] **Step 5: Register all routes in server.ts**

- [ ] **Step 6: Run all tests -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/api/
```

- [ ] **Step 7: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/api/ packages/compliance/tests/api/
git commit -m "feat(compliance): add CRUD REST routes with pagination and scope guards"
```

---

### Task 3.4: Compliance Check + Update/Source/Webhook/Seed Routes

**Files:**
- Create: `packages/compliance/src/api/routes/compliance.ts`
- Create: `packages/compliance/src/api/routes/updates.ts`
- Create: `packages/compliance/src/api/routes/sources.ts`
- Create: `packages/compliance/src/api/routes/webhooks.ts`
- Create: `packages/compliance/src/api/routes/seed.ts`
- Create: `packages/compliance/tests/api/compliance.test.ts`
- Create: `packages/compliance/tests/api/updates.test.ts`
- Create: `packages/compliance/tests/api/sources.test.ts`
- Create: `packages/compliance/tests/api/webhooks.test.ts`
- Create: `packages/compliance/tests/api/seed.test.ts`

- [ ] **Step 1: Write tests**

Compliance check test: POST with seeded data, verify matrix/annotated issues/summary. Test sectors filter. Test 400 for missing jurisdictions field.

Update routes test: POST /updates/propose (write), GET /updates (read), GET /updates/:id (read), PATCH /:id/approve (admin), PATCH /:id/reject (admin).

Source routes test: GET /sources (read), POST /sources (admin), DELETE /sources/:id (admin).

Webhook routes test: GET /webhooks (admin), POST /webhooks (admin), DELETE /webhooks/:id (admin).

Seed routes test: POST /seed (admin, verify idempotent), GET /seed/status (read, verify counts).

- [ ] **Step 2: Run tests -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/api/
```

- [ ] **Step 3: Implement all route files**

Each route file follows the established pattern:
- `compliance.ts`: `POST /compliance/check` -- validate request (require `jurisdictions` array), call `checkCompliance()`, return result. Uses `read` scope.
- `updates.ts`: propose (write), list (read), get (read), approve (admin, call `approveProposal()`), reject (admin, call `rejectProposal()`). Dispatch webhook events on propose/approve/reject.
- `sources.ts`: list (read), create (admin), delete (admin). Source scan endpoint: `POST /sources/scan` (admin) -- iterate sources, fetch content, compute SHA-256 hash, compare to lastContentHash, create update proposal if changed.
- `webhooks.ts`: list (admin), create (admin), delete (admin).
- `seed.ts`: `POST /seed` (admin) calls `loadBaseline()`, `GET /seed/status` (read) calls `getSeedStatus()`.

- [ ] **Step 4: Register all routes in server.ts**

- [ ] **Step 5: Run tests -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/api/
```

- [ ] **Step 6: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/api/routes/ packages/compliance/tests/api/
git commit -m "feat(compliance): add compliance check, updates, sources, webhooks, seed routes"
```

---

### Task 3.5: OAuth2 Token Endpoint + Rate Limiting

**Files:**
- Create: `packages/compliance/src/api/routes/oauth.ts`
- Create: `packages/compliance/src/api/rate-limit.ts`
- Create: `packages/compliance/tests/api/oauth.test.ts`
- Create: `packages/compliance/tests/api/rate-limit.test.ts`

- [ ] **Step 1: Write tests**

OAuth test: POST /oauth/token with valid client_credentials grant returns access_token. Reject invalid credentials (401). Reject unsupported grant type (400). Token obtained can access protected routes.

Rate limit test: Configure low rate limit (5 req/min), send requests up to limit (200s), next request returns 429.

- [ ] **Step 2: Run tests -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/api/oauth.test.ts tests/api/rate-limit.test.ts
```

- [ ] **Step 3: Implement OAuth token endpoint**

Create `packages/compliance/src/api/routes/oauth.ts`:
- `POST /oauth/token` (no auth required): parse form body for `grant_type`, `client_id`, `client_secret`, `scope`
- For `client_credentials`: look up client by ID, verify secret with bcrypt, check requested scopes are subset of client's scopes, sign JWT with private key, return `{ access_token, token_type: 'Bearer', expires_in, scope }`
- Return 401 for invalid credentials, 400 for unsupported grant type

- [ ] **Step 4: Implement rate limiting**

Create `packages/compliance/src/api/rate-limit.ts`:
- Use `@fastify/rate-limit` plugin
- Configure per-client rate limits based on config
- Key function: extract `sub` from token payload or fall back to IP

- [ ] **Step 5: Update server.ts to register OAuth routes and rate limiting**

Server options should accept `privateKeyPem` and `rateLimit` config.

- [ ] **Step 6: Run tests -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/api/oauth.test.ts tests/api/rate-limit.test.ts
```

- [ ] **Step 7: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/api/ packages/compliance/tests/api/
git commit -m "feat(compliance): add OAuth2 token endpoint and rate limiting"
```

---

## Wave 4 -- Protocol Layer (parallel tasks, depends on Wave 3)

### Task 4.1: MCP Server with 11 Tools

**Files:**
- Create: `packages/compliance/src/mcp/server.ts`
- Create: `packages/compliance/tests/mcp/server.test.ts`

- [ ] **Step 1: Write test**

Test should:
- Create in-memory SQLite, seed baseline data
- Create MCP server, connect via InMemoryTransport
- Verify `listTools()` returns exactly 11 tools with correct names
- Call `compliance_check` tool and verify matrix is returned
- Call `compliance_list_jurisdictions` and verify data
- Call `compliance_seed` and verify idempotency

Tool names: `compliance_check`, `compliance_list_jurisdictions`, `compliance_list_regulations`, `compliance_list_requirements`, `compliance_get_regulation`, `compliance_propose_update`, `compliance_get_pending`, `compliance_approve_update`, `compliance_list_sources`, `compliance_add_source`, `compliance_seed`.

- [ ] **Step 2: Run test -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/mcp/server.test.ts
```

- [ ] **Step 3: Implement MCP server**

Create `packages/compliance/src/mcp/server.ts`:

Use `@modelcontextprotocol/sdk/server` `McpServer` class. Register 11 tools, each with:
- Name matching the spec
- Description
- Input schema (via zod-to-json-schema)
- Handler that calls the appropriate engine/CRUD function and returns JSON text content

Each tool handler catches errors and returns them as error text content.

- [ ] **Step 4: Run test -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/mcp/server.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/mcp/ packages/compliance/tests/mcp/
git commit -m "feat(compliance): add MCP server with 11 compliance tools"
```

---

### Task 4.2: A2A Agent Card + Task Endpoints

**Files:**
- Create: `packages/compliance/src/a2a/agent-card.ts`
- Create: `packages/compliance/src/a2a/tasks.ts`
- Create: `packages/compliance/tests/a2a/agent-card.test.ts`
- Create: `packages/compliance/tests/a2a/tasks.test.ts`

- [ ] **Step 1: Write tests**

Agent card test: `GET /.well-known/agent.json` returns valid card with name `luqen-compliance`, version `1.0.0`, 4 skills, streaming capability.

Tasks test: `POST /a2a/tasks` with `compliance-check` skill executes and returns completed task with result. `GET /a2a/tasks/:id` returns task status. Unknown skill returns 400.

- [ ] **Step 2: Run tests -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/a2a/
```

- [ ] **Step 3: Implement agent card and task endpoints**

`agent-card.ts`: `getAgentCard(baseUrl)` returns the agent card object per the spec.

`tasks.ts`: Fastify routes:
- `GET /.well-known/agent.json` -- returns agent card, no auth
- `POST /a2a/tasks` -- accepts `{ skill, input }`, executes the skill, stores task in in-memory Map, returns `{ id, status: 'completed', result }`
- `GET /a2a/tasks/:id` -- returns task by ID from Map
- `GET /a2a/tasks/:id/stream` -- SSE stream (basic implementation)
- `GET /a2a/agents` -- returns empty array (peer discovery placeholder)

Skill dispatch: `compliance-check` calls `checkCompliance()`, `regulation-lookup` calls `listRegulations()`, `update-management` calls `proposeUpdate()` or `listProposals()`, `source-monitoring` calls `db.listSources()`.

- [ ] **Step 4: Register A2A routes in server.ts**

- [ ] **Step 5: Run tests -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/a2a/
```

- [ ] **Step 6: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/a2a/ packages/compliance/tests/a2a/
git commit -m "feat(compliance): add A2A agent card and task endpoints"
```

---

### Task 4.3: CLI

**Files:**
- Create: `packages/compliance/src/cli.ts`
- Create: `packages/compliance/tests/cli.test.ts`

- [ ] **Step 1: Write test**

Test should verify `createCli()` returns a commander program with commands: `serve`, `seed`, `clients` (with create/list/revoke subcommands), `users` (with create subcommand), `keys` (with generate subcommand), `mcp`.

- [ ] **Step 2: Run test -- expect FAIL**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/cli.test.ts
```

- [ ] **Step 3: Implement CLI**

Create `packages/compliance/src/cli.ts` with commander:

```
#!/usr/bin/env node
```

Commands:
- `serve` -- `--port`, `--host`, `--config`: creates DB adapter, creates server, starts listening
- `seed` -- `--config`: creates DB adapter, calls `loadBaseline()`
- `clients create` -- `--name`, `--scope`, `--grant`: creates DB adapter, calls `db.createClient()`, prints client_id and secret
- `clients list` -- lists all clients
- `clients revoke <id>` -- deletes client
- `users create` -- `--username`, `--role`: creates user (reads password from stdin)
- `users list` -- lists all users
- `keys generate` -- generates RS256 key pair using `jose.generateKeyPair()`, writes PEM files to `./keys/`
- `mcp` -- creates DB adapter, creates MCP server, connects to stdio transport

Export `createCli()` function for testability. At bottom: `createCli().parse()`.

- [ ] **Step 4: Run test -- expect PASS**

```bash
cd /root/luqen/packages/compliance && npx vitest run tests/cli.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/cli.ts packages/compliance/tests/cli.test.ts
git commit -m "feat(compliance): add CLI with serve, seed, clients, users, keys, mcp commands"
```

---

## Wave 5 -- Additional DB Adapters (parallel tasks, depends on Wave 1)

### Task 5.1: Shared Adapter Contract Tests

**Files:**
- Create: `packages/compliance/tests/db/adapter-contract.test.ts`

- [ ] **Step 1: Write contract test**

Create a parameterized test file that:
- Reads `DB_ADAPTER` env var (default: `sqlite`)
- Creates the appropriate adapter instance
- Tests all DbAdapter methods: create/get/list/update/delete for each entity type
- Tests `findRequirementsByCriteria` with joined data
- Tests lifecycle (initialize/close)

This test is the single source of truth for adapter correctness. All adapters must pass it.

- [ ] **Step 2: Run with SQLite**

```bash
cd /root/luqen/packages/compliance && DB_ADAPTER=sqlite npx vitest run tests/db/adapter-contract.test.ts
```

- [ ] **Step 3: Commit**

```bash
cd /root/luqen
git add packages/compliance/tests/db/adapter-contract.test.ts
git commit -m "test(compliance): add shared DB adapter contract test suite"
```

---

### Task 5.2: MongoDB Adapter

**Files:**
- Create: `packages/compliance/src/db/mongodb-adapter.ts`

- [ ] **Step 1: Implement MongoDB adapter**

Create `MongoAdapter implements DbAdapter`:
- Constructor accepts MongoDB connection string
- Uses `mongodb` native driver with collections per entity type
- Stores arrays natively (no JSON serialization)
- Uses `$in` operator for `findRequirementsByCriteria` with `$lookup` aggregation for joining with regulations
- Uses `randomUUID()` for IDs, `bcrypt` for hashing
- `initialize()` creates collections and indexes
- `close()` closes the MongoClient

- [ ] **Step 2: Run contract tests (requires MongoDB instance)**

```bash
cd /root/luqen/packages/compliance && DB_ADAPTER=mongodb COMPLIANCE_DB_URL=mongodb://localhost:27017/compliance-test npx vitest run tests/db/adapter-contract.test.ts
```

- [ ] **Step 3: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/db/mongodb-adapter.ts
git commit -m "feat(compliance): add MongoDB adapter"
```

---

### Task 5.3: PostgreSQL Adapter

**Files:**
- Create: `packages/compliance/src/db/postgres-adapter.ts`

- [ ] **Step 1: Implement PostgreSQL adapter**

Create `PostgresAdapter implements DbAdapter`:
- Constructor accepts PostgreSQL connection string
- Uses `pg` driver with connection pool
- Creates tables with `CREATE TABLE IF NOT EXISTS` (PostgreSQL types, JSONB for arrays/objects)
- Uses `$1`, `$2` parameterized queries
- Uses `randomUUID()` for IDs, `bcrypt` for hashing
- `initialize()` creates tables and indexes
- `close()` closes the pool

- [ ] **Step 2: Run contract tests (requires PostgreSQL instance)**

```bash
cd /root/luqen/packages/compliance && DB_ADAPTER=postgres COMPLIANCE_DB_URL=postgresql://localhost:5432/compliance-test npx vitest run tests/db/adapter-contract.test.ts
```

- [ ] **Step 3: Commit**

```bash
cd /root/luqen
git add packages/compliance/src/db/postgres-adapter.ts
git commit -m "feat(compliance): add PostgreSQL adapter"
```

---

## Wave 6 -- Documentation (parallel tasks, depends on Wave 4)

### Task 6.1: Product Documentation

**Files:**
- Create: `docs/compliance/README.md`

- [ ] **Step 1: Write comprehensive product documentation**

Sections to include (write based on actual built code):
1. Overview -- what, why, ecosystem fit
2. Getting Started -- prerequisites, installation, first-run walkthrough
3. Configuration -- all config fields, env vars, precedence order
4. Authentication -- OAuth2 setup, creating clients, obtaining tokens, scope reference
5. REST API Reference -- every endpoint with curl examples
6. Compliance Check Guide -- example request/response, reading the matrix
7. Data Model -- entity relationships
8. MCP Server -- Claude Code config, all 11 tools with examples
9. A2A Agent -- discovery, task flow, peer auth
10. Database Adapters -- switching between SQLite/MongoDB/PostgreSQL
11. Baseline Data -- jurisdiction list, seeding, verification
12. Update Proposals -- workflow, propose/approve examples
13. Monitored Sources -- adding, scanning
14. Webhooks -- registering, events, signature verification
15. Troubleshooting -- common errors
16. API Types Reference -- key interfaces as tables

- [ ] **Step 2: Commit**

```bash
cd /root/luqen
git add docs/compliance/README.md
git commit -m "docs(compliance): add comprehensive product documentation"
```

---

### Task 6.2: Installation Guides

**Files:**
- Create: `docs/compliance/installation/docker.md`
- Create: `docs/compliance/installation/bare-metal.md`
- Create: `docs/compliance/installation/kubernetes.md`
- Create: `docs/compliance/installation/cloud.md`
- Create: `docs/compliance/installation/all-in-one.md`

- [ ] **Step 1: Write installation guides**

- `docker.md`: Dockerfile, docker-compose.yml with DB options, volume mounts, env vars
- `bare-metal.md`: Node.js prerequisites, npm install, key generation, systemd service
- `kubernetes.md`: Architecture overview, ConfigMap/Secret structure (full manifests in milestone 3)
- `cloud.md`: AWS (ECS/Lambda) and Azure (Container Apps/Functions) overview
- `all-in-one.md`: Running alongside luqen in single process

- [ ] **Step 2: Commit**

```bash
cd /root/luqen
git add docs/compliance/installation/
git commit -m "docs(compliance): add installation guides"
```

---

### Task 6.3: Integration Guides + Updated Skill

**Files:**
- Create: `docs/compliance/integrations/luqen.md`
- Create: `docs/compliance/integrations/power-automate.md`
- Create: `docs/compliance/integrations/n8n.md`
- Create: `docs/compliance/integrations/claude-code.md`
- Create: `docs/compliance/integrations/ci-cd.md`

- [ ] **Step 1: Write integration guides**

- `luqen.md`: A2A connection config, OAuth client setup, enriched reports
- `power-automate.md`: Custom connector, OAuth2 config, example flows
- `n8n.md`: HTTP Request node, OAuth2 credentials, example workflows
- `claude-code.md`: MCP config in .claude.json, tool examples, conversations
- `ci-cd.md`: GitHub Actions/Azure DevOps examples, exit codes, JSON output

- [ ] **Step 2: Update Claude Code skill file**

Update luqen skill to include all 11 compliance MCP tools and workflow examples.

- [ ] **Step 3: Commit**

```bash
cd /root/luqen
git add docs/compliance/integrations/
git commit -m "docs(compliance): add integration guides and update skill"
```

---

## Wave 7 -- Build Verification (after all waves)

### Task 7.1: Full Test Suite and Build Verification

- [ ] **Step 1: Run full compliance test suite**

```bash
cd /root/luqen/packages/compliance && npx vitest run
```

- [ ] **Step 2: Run coverage check (80%+ required)**

```bash
cd /root/luqen/packages/compliance && npx vitest run --coverage
```

- [ ] **Step 3: Run TypeScript type check**

```bash
cd /root/luqen/packages/compliance && npx tsc --noEmit
```

- [ ] **Step 4: Run core package tests**

```bash
cd /root/luqen/packages/core && npx vitest run
```

- [ ] **Step 5: Verify workspaces build from root**

```bash
cd /root/luqen && npm run test && npm run build
```

- [ ] **Step 6: Verify CLI commands work**

```bash
cd /root/luqen/packages/compliance
npx tsx src/cli.ts keys generate
npx tsx src/cli.ts seed
npx tsx src/cli.ts clients create --name test --scope read --grant client_credentials
npx tsx src/cli.ts clients list
```

- [ ] **Step 7: Commit any final fixes**

```bash
cd /root/luqen
git add -A
git commit -m "chore(compliance): final build verification fixes"
```

---

## Dependency Graph

```
Wave 0 (Monorepo Setup)
  |
  +-- Wave 1 (parallel)
  |     +-- Task 1.1: Types
  |     +-- Task 1.2: Config
  |     +-- Task 1.3: Matcher
  |     +-- Task 1.4: DB Adapter + SQLite
  |     +-- Task 1.5: OAuth tokens
  |
  +-- Wave 2 (parallel, after Wave 1)
  |     +-- Task 2.1: Compliance Checker
  |     +-- Task 2.2: CRUD Operations
  |     +-- Task 2.3: Update Proposals
  |     +-- Task 2.4: Seed Data + Loader
  |     +-- Task 2.5: Webhook Dispatch
  |
  +-- Wave 3 (parallel, after Wave 2)
  |     +-- Task 3.1: Server + OpenAPI
  |     +-- Task 3.2: Auth Middleware
  |     +-- Task 3.3: CRUD Routes + Pagination
  |     +-- Task 3.4: Compliance/Updates/Sources/Webhooks/Seed Routes
  |     +-- Task 3.5: OAuth Endpoints + Rate Limiting
  |
  +-- Wave 4 (parallel, after Wave 3)
  |     +-- Task 4.1: MCP Server (11 tools)
  |     +-- Task 4.2: A2A Agent
  |     +-- Task 4.3: CLI
  |
  +-- Wave 5 (parallel, after Wave 1)
  |     +-- Task 5.1: Contract Tests
  |     +-- Task 5.2: MongoDB Adapter
  |     +-- Task 5.3: PostgreSQL Adapter
  |
  +-- Wave 6 (parallel, after Wave 4)
  |     +-- Task 6.1: Product Docs
  |     +-- Task 6.2: Installation Guides
  |     +-- Task 6.3: Integration Guides
  |
  +-- Wave 7 (after all)
        +-- Task 7.1: Full Verification
```
