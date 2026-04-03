# @luqen/llm Module — Phase 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the @luqen/llm standalone service with provider management, model registration, capability assignment, and Ollama + OpenAI adapters.

**Architecture:** Fastify microservice on port 4200, SQLite DB, OAuth2 auth (identical to compliance/branding pattern). Providers configured in DB via admin API. Each provider has models; each capability is assigned a model. Provider adapters are built-in.

**Tech Stack:** Fastify 5, better-sqlite3, jose (JWT), bcrypt, commander, vitest

**Spec:** docs/superpowers/specs/2026-04-03-llm-module-design.md

## 9 Tasks — see spec for full details

### Task 1: Package Scaffold
packages/llm/ — package.json, tsconfig.json, vitest.config.ts, version.ts, llm.config.json

### Task 2: Types and Config
src/types.ts (Provider, Model, CapabilityAssignment, CapabilityName, OAuthClient, LLMConfig)
src/config.ts (loadConfig from JSON + env overrides)

### Task 3: Auth (copy from compliance)
src/auth/oauth.ts, middleware.ts, scopes.ts — identical to compliance

### Task 4: Database Adapter
src/db/adapter.ts (interface), src/db/sqlite-adapter.ts (SQLite implementation)
Tables: providers, models, capability_assignments, oauth_clients
Tests: 10 tests covering CRUD, org-scoped fallback, cascade deletes

### Task 5: Provider Adapters
src/providers/types.ts (LLMProviderAdapter interface: connect, healthCheck, listModels, complete)
src/providers/ollama.ts, openai.ts
src/providers/registry.ts (factory by type string)

### Task 6: API Server + Routes
src/api/server.ts, routes/health.ts, routes/oauth.ts, routes/providers.ts, routes/models.ts, routes/capabilities.ts, routes/clients.ts
Endpoints: full CRUD for providers/models/capabilities, test connectivity, list remote models

### Task 7: CLI
src/cli.ts — serve, migrate, keygen commands (same pattern as compliance)

### Task 8: Register in Workspace + CI
Add to root package.json workspaces, add to CI workflow

### Task 9: E2E Verification
Start service, verify health, create provider, list models, assign capability
