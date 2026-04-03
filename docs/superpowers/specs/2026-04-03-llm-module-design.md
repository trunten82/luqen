# @luqen/llm Module Design Spec

**Date:** 2026-04-03
**Status:** Draft

## Overview

Standalone Fastify microservice (like compliance/branding) that owns all LLM provider configuration and exposes domain-specific AI capabilities to other Luqen services.

## Architecture

```
                    ┌─────────────────────────────────┐
                    │       @luqen/llm (port 4200)     │
                    │                                   │
                    │  Providers (DB-managed)            │
                    │  ├─ Ollama (local, multiple models)│
                    │  ├─ OpenAI (gpt-4o, gpt-4o-mini)  │
                    │  ├─ Anthropic (opus, sonnet, haiku)│
                    │  └─ Gemini (flash, pro)            │
                    │                                   │
                    │  Capabilities                      │
                    │  ├─ extract-requirements           │
                    │  ├─ generate-fix                   │
                    │  ├─ analyse-report                 │
                    │  └─ discover-branding              │
                    │                                   │
                    │  Capability → Provider mapping     │
                    │  (admin configures per capability) │
                    └──────┬────────┬────────┬──────────┘
                           │        │        │
                    ┌──────┘        │        └──────┐
                    │               │               │
              Dashboard        Compliance       Branding
              (port 5000)      (port 4000)      (port 4100)
```

## Data Model

### Providers Table
```sql
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,           -- "Office Ollama", "Production Claude"
  type TEXT NOT NULL,           -- "ollama" | "openai" | "anthropic" | "gemini"
  baseUrl TEXT,                 -- e.g. "http://192.168.3.119:11434"
  apiKey TEXT,                  -- encrypted at rest
  status TEXT DEFAULT 'active', -- "active" | "inactive" | "error"
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
```

### Models Table
```sql
CREATE TABLE models (
  id TEXT PRIMARY KEY,
  providerId TEXT NOT NULL REFERENCES providers(id),
  modelId TEXT NOT NULL,        -- "ministral-3:3b-cloud", "claude-sonnet-4-20250514"
  displayName TEXT,             -- "Ministral 3B Cloud", "Claude Sonnet"
  status TEXT DEFAULT 'active',
  capabilities TEXT,            -- JSON array: ["extract","fix","analyse","branding"]
  createdAt TEXT NOT NULL
);
```

### Capability Assignments Table
```sql
CREATE TABLE capability_assignments (
  capability TEXT NOT NULL,     -- "extract-requirements" | "generate-fix" | "analyse-report" | "discover-branding"
  modelId TEXT NOT NULL REFERENCES models(id),
  priority INTEGER DEFAULT 0,  -- lower = preferred (fallback chain)
  orgId TEXT DEFAULT 'system',  -- org-scoped overrides
  PRIMARY KEY (capability, modelId, orgId)
);
```

### Example Configuration

```
Provider: "Office Ollama"
  ├─ Model: ministral-3:3b-cloud  → assigned to: extract-requirements (fast, cheap)
  └─ Model: devstral-small-2:24b  → assigned to: generate-fix (needs reasoning)

Provider: "Anthropic Production"
  ├─ Model: claude-haiku-4-5      → assigned to: extract-requirements (fallback)
  └─ Model: claude-sonnet-4       → assigned to: analyse-report, discover-branding

Capability assignments:
  extract-requirements → ministral-3:3b-cloud (pri 0), claude-haiku (pri 1)
  generate-fix         → devstral-small-2:24b (pri 0)
  analyse-report       → claude-sonnet-4 (pri 0)
  discover-branding    → claude-sonnet-4 (pri 0)
```

## API Endpoints

### Provider Management
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/providers` | List all providers |
| `POST` | `/api/v1/providers` | Add provider (validates connection) |
| `PATCH` | `/api/v1/providers/:id` | Update provider config |
| `DELETE` | `/api/v1/providers/:id` | Remove provider |
| `POST` | `/api/v1/providers/:id/test` | Test provider connectivity |
| `GET` | `/api/v1/providers/:id/models` | Fetch available models from provider API |

### Model Management
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/models` | List all configured models |
| `POST` | `/api/v1/models` | Register a model under a provider |
| `DELETE` | `/api/v1/models/:id` | Remove model |

### Capability Assignment
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/capabilities` | List capabilities with assigned models |
| `PUT` | `/api/v1/capabilities/:name/assign` | Assign model to capability (with priority + orgId) |
| `DELETE` | `/api/v1/capabilities/:name/assign/:modelId` | Remove assignment |

### Capability Endpoints (consumed by other services)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/extract-requirements` | OAuth2 | Parse regulation text → WCAG requirements |
| `POST` | `/api/v1/generate-fix` | OAuth2 | Issue + HTML context → code fix suggestion |
| `POST` | `/api/v1/analyse-report` | OAuth2 | Scan results → executive summary + patterns |
| `POST` | `/api/v1/discover-branding` | OAuth2 | URL → extracted brand identity (colors, fonts, logo) |

### Health & Status
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health + provider status summary |
| `GET` | `/api/v1/status` | Detailed status: providers, models, capability coverage |

## Capability Details

### extract-requirements (moves from compliance)
- **Input:** `{ content: string, regulationId: string, regulationName: string, jurisdictionId?: string }`
- **Output:** `{ wcagVersion, wcagLevel, criteria: [{criterion, obligation, notes}], confidence }`
- **Prompt:** Regulation analyst prompt (already exists in LLM plugins)
- **Fallback without LLM module:** Seed data used as-is, manual CRUD in compliance admin

### generate-fix
- **Input:** `{ issue: { code, message, selector, context }, html: string, wcagCriterion: string, wcagTitle: string }`
- **Output:** `{ title, description, fixedHtml, explanation, effort: "low"|"medium"|"high", confidence }`
- **Prompt:** Accessibility remediation expert with HTML context
- **Fallback without LLM module:** Existing 50 hardcoded patterns in fix-suggestions.ts

### analyse-report
- **Input:** `{ summary: {...}, issues: [...], compliance: {...}, pageCount: number }`
- **Output:** `{ executiveSummary, keyFindings: string[], patterns: [{pattern, affectedCount, rootCause}], priorities: [{action, impact, effort}] }`
- **Prompt:** Accessibility audit analyst with compliance context
- **Fallback without LLM module:** Statistical summary (counts, groupings) — no AI insights

### discover-branding
- **Input:** `{ url: string, orgId?: string }`
- **Output:** `{ colors: [{hex, role, usage}], fonts: [{family, usage}], logo?: { url, altText }, name?: string, confidence }`
- **Prompt:** Brand identity analyst — fetches page, analyses CSS/HTML
- **Fallback without LLM module:** Manual brand guideline creation in branding admin

## Provider Adapters (built-in, not plugins)

Each adapter implements:
```typescript
interface LLMProviderAdapter {
  readonly type: string;
  connect(config: ProviderConfig): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;
  listModels(): Promise<Array<{ id: string; name: string }>>;
  complete(prompt: string, options: {
    model: string;
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
  }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }>;
}
```

### Built-in adapters:
- **OllamaAdapter** — `POST /api/generate` or `/api/chat`, `GET /api/tags`
- **OpenAIAdapter** — `POST /v1/chat/completions`, `GET /v1/models` (also Azure OpenAI compatible)
- **AnthropicAdapter** — `POST /v1/messages` with `x-api-key` + `anthropic-version`
- **GeminiAdapter** — `POST /v1beta/models/:model:generateContent`

## Integration with Other Services

### Dashboard Integration
- Dashboard config adds `llmUrl` (like `complianceUrl`, `brandingUrl`)
- ServiceTokenManager pattern for OAuth2 tokens
- Dashboard admin pages: `/admin/llm/providers`, `/admin/llm/models`, `/admin/llm/capabilities`
- Fix suggestions route checks LLM module availability, enhances hardcoded patterns
- Report detail page shows AI summary tab (if available)
- Sources page upload form calls LLM module instead of dashboard plugin

### Compliance Integration
- Compliance config adds `llmUrl`
- Source scan calls LLM module's `/api/v1/extract-requirements` directly (no more DashboardLLMBridge)
- Auto-registers on LLM module at startup (or LLM module registers on compliance)

### Branding Integration
- Branding config adds `llmUrl`
- New endpoint: "Discover branding from URL" calls LLM module
- Results populate BrandGuideline fields

## Removal of Current LLM Plugin System

### What gets removed:
- `packages/dashboard/src/routes/api/llm.ts` — replaced by LLM module endpoints
- `packages/compliance/src/llm/dashboard-bridge.ts` — compliance calls LLM module directly
- LLM plugin auto-registration in dashboard server.ts
- LLM plugin entries in plugin-registry.json (4 plugins)
- `luqen-plugins/plugin-llm-*` (4 plugin packages) — deprecated
- `getActivePluginsByType('llm')` calls in dashboard

### What stays:
- Plugin system for auth, notification, storage, scanner, git-host
- `PluginInstance` base interface (unchanged)
- Plugin manager, registry, health checks (unchanged)

### Migration:
- Clean break — remove LLM plugin type, add LLM module config
- No backward compatibility needed (user confirmed)

## Package Structure

```
packages/llm/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts                    -- serve, migrate, provider commands
│   ├── config.ts                 -- load config (same pattern as compliance)
│   ├── version.ts
│   ├── db/
│   │   ├── adapter.ts            -- DbAdapter interface
│   │   └── sqlite-adapter.ts     -- SQLite implementation
│   ├── auth/
│   │   ├── oauth.ts              -- JWT sign/verify (same as compliance)
│   │   └── middleware.ts         -- requireScope
│   ├── providers/
│   │   ├── types.ts              -- LLMProviderAdapter interface
│   │   ├── ollama.ts
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   └── gemini.ts
│   ├── capabilities/
│   │   ├── types.ts              -- capability interfaces
│   │   ├── extract-requirements.ts
│   │   ├── generate-fix.ts
│   │   ├── analyse-report.ts
│   │   └── discover-branding.ts
│   ├── prompts/
│   │   ├── extract-requirements.ts
│   │   ├── generate-fix.ts
│   │   ├── analyse-report.ts
│   │   └── discover-branding.ts
│   └── api/
│       ├── server.ts
│       └── routes/
│           ├── health.ts
│           ├── providers.ts
│           ├── models.ts
│           ├── capabilities.ts
│           └── oauth.ts
├── tests/
│   ├── providers/
│   ├── capabilities/
│   └── api/
└── llm.config.json               -- default config
```

## Config File (llm.config.json)

```json
{
  "port": 4200,
  "host": "0.0.0.0",
  "dbPath": "./llm.db",
  "jwtKeyPair": {
    "publicKeyPath": "./keys/public.pem",
    "privateKeyPath": "./keys/private.pem"
  },
  "tokenExpiry": "1h",
  "cors": { "origin": ["http://localhost:5000"] }
}
```

## Systemd Service

```ini
[Unit]
Description=Luqen LLM Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/luqen/packages/llm
ExecStart=/usr/bin/node dist/cli.js serve
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Implementation Phases

### Phase 1: Foundation
- Package scaffold, DB schema, OAuth, CLI
- Provider adapters (Ollama + OpenAI)
- Provider management API (CRUD + test + list models)
- Model registration + capability assignment API
- Health endpoint

### Phase 2: Extract Requirements
- Move extraction logic from compliance LLM bridge
- Prompt templates + response parsers
- Compliance integration (direct call to LLM module)
- Dashboard admin pages for provider/model/capability config
- Remove old LLM plugin system

### Phase 3: Generate Fix
- Fix suggestion engine with HTML context
- Dashboard integration (enhance report detail page)
- Fallback to hardcoded patterns when LLM unavailable

### Phase 4: Analyse Report
- Report summarizer with compliance matrix context
- Dashboard integration (AI summary tab on reports)
- Pattern detection across scan history

### Phase 5: Discover Branding
- URL crawler + CSS/HTML analyser
- Brand identity extraction prompts
- Branding service integration
- Auto-populate guidelines from discovery
