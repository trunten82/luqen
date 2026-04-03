# @luqen/dashboard

Web dashboard for viewing and managing luqen accessibility scan results.

## Key Features

- **GraphQL API** — Query scans, issues, compliance data, users, teams, and more via `/graphql`. Interactive GraphiQL playground at `/graphiql`.
- **Multi-language UI (i18n)** — Dashboard available in 6 languages (EN, IT, ES, FR, DE, PT) with a sidebar language switcher.
- **Pluggable StorageAdapter** — modular data layer with 14 domain repositories; SQLite built-in, PostgreSQL and MongoDB adapters planned as plugins
- HTMX-powered server-rendered UI with no JavaScript build step
- Role-based access control with granular permissions
- Plugin system for auth, notifications, and storage
- Multi-tenancy with org-level data isolation
- Real-time scan progress via Server-Sent Events
- PDF and CSV report export

## Install

```bash
npm install @luqen/dashboard
```

## Usage

```bash
npx luqen-dashboard serve
```

## Dynamic Plugin Configuration

Plugins can declare `dynamic-select` config fields whose options are fetched from the plugin's own API at runtime rather than hardcoded in the manifest. This is used by all four LLM plugins (v1.1.0+) for model selection.

### Manifest schema

```json
{
  "key": "model",
  "label": "Model",
  "type": "dynamic-select",
  "dependsOn": ["apiKey"],
  "description": "Select a model from the provider's API"
}
```

- `type: "dynamic-select"` tells the dashboard to render a dropdown with a refresh button
- `dependsOn` lists other config fields that must be set before options can be fetched (e.g., `apiKey` must be configured before querying available models)

### Plugin implementation

Plugins implement `getConfigOptions(fieldKey, currentConfig)` to return options:

```typescript
async getConfigOptions(fieldKey: string, currentConfig: Record<string, unknown>): Promise<Array<{ value: string; label: string }>> {
  if (fieldKey === 'model') {
    const models = await this.listModels(currentConfig.apiKey as string);
    return models.map(m => ({ value: m.id, label: m.name }));
  }
  return [];
}
```

### Dashboard endpoint

`GET /admin/plugins/:id/config-options?field=model` calls the plugin's `getConfigOptions` and returns the options array. The dashboard UI uses this to populate the dynamic dropdown.

## LLM Bridge

The dashboard bridges the compliance service and the active LLM plugin:

- **`POST /api/v1/llm/extract`** -- receives extraction requests from the compliance service's `DashboardLLMBridge`, routes them to the active LLM plugin, and returns structured JSON. Accepts an optional `pluginId` parameter to target a specific LLM plugin instead of the default active one.
- **`GET /api/v1/llm/plugins`** -- lists all active LLM plugins, used by the UI to populate the "LLM Provider" dropdown on the Upload Regulation form
- **Auto-registration** -- at startup, the dashboard generates an API key and calls `POST /api/v1/admin/register-llm` on the compliance service to register itself as the LLM provider
- **`POST /admin/sources/upload`** -- proxies regulation document uploads to the compliance service's `POST /api/v1/sources/upload` endpoint; powers the "Upload Regulation" form on the sources admin page. The form includes an "LLM Provider" dropdown allowing admins to choose which LLM plugin processes the extraction.
- **`POST /admin/sources/scan`** -- triggers a background scan of all monitored sources. Returns immediately with a "Source scan started in background" message instead of waiting for completion, preventing 504 gateway timeouts on large source sets.

### Source Intelligence API (API key auth)

These endpoints are accessible via API key (`Authorization: Bearer <key>`) for automation:

- **`POST /api/v1/sources/scan`** -- trigger async source scan. Returns `{"status":"started"}` immediately. Optional `?force=false` to only scan sources due per their schedule.
- **`POST /api/v1/sources/upload`** -- upload a regulation document for LLM extraction. Accepts JSON body: `{name, content, regulationId?, jurisdictionId?, pluginId?}`. Returns extracted requirements count, confidence, and the created proposal.
- **`GET /api/v1/llm/status`** -- check LLM availability: `{available: true, pluginCount: N}`

### Reseed + Scan

Reseed (`POST /admin/system/reseed`) automatically triggers a source scan after reloading baseline data, ensuring the monitor page shows current timestamps.

## Documentation

See the [main repository](https://github.com/trunten82/luqen) for full documentation.

## License

MIT
