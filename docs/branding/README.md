# Luqen Branding Service

`@luqen/branding` is a standalone brand compliance engine that classifies accessibility issues as brand-related or unexpected. It stores color palettes, font families, and CSS selector patterns per organization, assigns them to sites, and matches scan issues against those guidelines to distinguish issues caused by deliberate brand choices from genuine accessibility problems.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Quick Start](#quick-start)
4. [Configuration Reference](#configuration-reference)
5. [CLI Reference](#cli-reference)
6. [API Reference](#api-reference)
7. [Dashboard Integration](#dashboard-integration)
8. [Report Integration](#report-integration)
9. [Brand Image Upload](#brand-image-upload)
10. [Scan Retag](#scan-retag)
11. [Matching Strategies](#matching-strategies)
12. [Template Format](#template-format)
13. [Multi-Brand Multi-Site Model](#multi-brand-multi-site-model)
14. [REST API Endpoints](#rest-api-endpoints)
15. [GraphQL API](#graphql-api)
16. [Docker Compose](#docker-compose)

---

## Overview

### What it does

An accessibility scan produces issues like "insufficient colour contrast ratio". Without brand context, every such issue looks the same. With brand guidelines loaded, the system can tell you:

- Is this contrast failure using the brand's approved color pair, or an off-brand color?
- Is this font issue affecting an approved brand typeface, or a rogue one?
- Does this element's selector match a known brand component?

The branding service answers these questions by annotating each issue with a `brandingMatch` result — matched guideline, matched strategy, and human-readable detail — or null when the issue does not match any brand guideline.

### Why it matters

Brand teams and accessibility teams often work in parallel. A brand might knowingly ship a color combination that fails WCAG contrast because the brand identity takes precedence and a legal exception has been sought. Surfacing which issues are brand-related versus unexpected helps teams:

- Prioritize remediation — focus on unexpected issues first
- Separate brand-driven exceptions from engineering regressions
- Produce compliance reports that distinguish approved divergences from new problems
- Give brand teams visibility into the accessibility impact of their guidelines

---

## Architecture

The branding service is a standalone Fastify microservice, architecturally identical to the compliance service:

```
Dashboard (port 5000)
  │
  │  OAuth client_credentials
  ▼
Branding Service (port 4100)
  │
  ├── SQLite database  (branding.db)
  ├── JWT key pair     (keys/private.pem, keys/public.pem)
  └── REST API         /api/v1/*
```

The dashboard connects to the branding service at startup using OAuth client credentials configured in `branding.config.json`. When a scan completes, the dashboard calls `POST /api/v1/match` to enrich issues with branding context before storing them.

The branding service has its own:
- SQLite database (separate from the dashboard and compliance databases)
- OAuth server (issues its own JWTs; does not share tokens with compliance)
- CLI (`luqen-branding`) for server management and OAuth client administration

---

## Quick Start

### Prerequisites

- Node.js 20 or later
- npm 10 or later

### Install from source

```bash
# From the monorepo root
npm install

# Build the branding package
cd packages/branding
npm run build
```

### Generate JWT keys

```bash
luqen-branding keys generate
# Key pair generated:
#   ./keys/private.pem
#   ./keys/public.pem
```

### Create an OAuth client for the dashboard

```bash
luqen-branding clients create --name dashboard --scope "read write"
# Client created:
#   client_id:     dashboard
#   client_secret: <generated-secret>
```

Copy the `client_id` and `client_secret` into `branding.config.json`.

### Start the service

```bash
luqen-branding serve
# Branding service listening on http://localhost:4100
```

### Create your first guideline

```bash
# Obtain a token
TOKEN=$(curl -s -X POST http://localhost:4100/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "dashboard",
    "client_secret": "your-secret",
    "scope": "write"
  }' | jq -r '.access_token')

# Create a guideline
curl -X POST http://localhost:4100/api/v1/guidelines \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Brand",
    "orgId": "my-org",
    "description": "Primary brand guidelines"
  }'
```

---

## Configuration Reference

### branding.config.json

```json
{
  "port": 4100,
  "dbPath": "./data/branding.db",
  "keysDir": "./keys",
  "tokenExpiry": "1h",
  "logLevel": "info"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | `4100` | HTTP port to listen on |
| `dbPath` | string | `./data/branding.db` | Path to the SQLite database file |
| `keysDir` | string | `./keys` | Directory containing `private.pem` and `public.pem` |
| `tokenExpiry` | string | `1h` | JWT token lifetime (e.g. `1h`, `30m`, `24h`) |
| `logLevel` | string | `info` | Logging verbosity: `trace`, `debug`, `info`, `warn`, `error` |

### Environment variables

All config fields can be overridden with environment variables using the `BRANDING_` prefix:

| Variable | Equivalent config field |
|----------|------------------------|
| `BRANDING_PORT` | `port` |
| `BRANDING_DB_PATH` | `dbPath` |
| `BRANDING_KEYS_DIR` | `keysDir` |
| `BRANDING_TOKEN_EXPIRY` | `tokenExpiry` |
| `BRANDING_LOG_LEVEL` | `logLevel` |

Environment variables take precedence over values in `branding.config.json`.

---

## CLI Reference

### luqen-branding serve

Start the Fastify REST server.

```bash
luqen-branding serve [options]
```

| Flag | Description |
|------|-------------|
| `--port <number>` | Port to listen on (default: `4100`) |
| `--config <path>` | Path to config file (default: `branding.config.json`) |

**Prerequisites:** JWT keys must be generated first with `luqen-branding keys generate`.

```bash
luqen-branding serve --port 4100
```

---

### luqen-branding keys generate

Generate an RS256 JWT key pair and save to the configured keys directory.

```bash
luqen-branding keys generate [options]
```

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to config file (default: `branding.config.json`) |

```bash
luqen-branding keys generate
# Key pair generated:
#   ./keys/private.pem
#   ./keys/public.pem
```

---

### luqen-branding clients create

Create a new OAuth2 client credential pair.

```bash
luqen-branding clients create --name <name> [options]
```

| Flag | Description |
|------|-------------|
| `--name <name>` | **(required)** Client name |
| `--scope <scopes>` | Space-separated scopes: `read`, `write`, `admin` (default: `read`) |
| `--config <path>` | Path to config file |

```bash
luqen-branding clients create --name dashboard --scope "read write"
# Client created:
#   client_id:     dashboard
#   client_secret: abc123secret
```

---

### luqen-branding clients list

List all registered OAuth2 clients.

```bash
luqen-branding clients list [options]
```

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to config file |

---

### luqen-branding clients revoke

Delete an OAuth2 client by client ID.

```bash
luqen-branding clients revoke <client-id> [options]
```

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to config file |

```bash
luqen-branding clients revoke dashboard
```

---

## API Reference

The branding service exposes a REST API on port 4100 (default). All endpoints except `/api/v1/health` and `/api/v1/oauth/token` require a Bearer JWT token.

Full interactive documentation is available at `http://localhost:4100/docs` (Swagger UI) when the service is running.

The machine-readable OpenAPI snapshot is at [`docs/reference/openapi/branding.json`](../reference/openapi/branding.json) (auto-generated by `scripts/snapshot-openapi.ts`).

### Authentication

Obtain a token before calling any protected endpoint:

```bash
curl -X POST http://localhost:4100/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_SECRET",
    "scope": "read"
  }'
# Response: { "access_token": "eyJ...", "token_type": "Bearer", "expires_in": 3600 }
```

Pass the token on all subsequent requests:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:4100/api/v1/guidelines
```

### Scope reference

| Scope | Access |
|-------|--------|
| `read` | GET all resources, POST /match, GET /templates |
| `write` | Create/update guidelines; add/remove colors, fonts, selectors, sites |
| `admin` | All write + delete guidelines, manage OAuth clients |

### Endpoint summary

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/api/v1/health` | none | Health check |
| `POST` | `/api/v1/oauth/token` | none | Obtain access token |
| `GET` | `/api/v1/guidelines` | `read` | List guidelines (`?orgId=`) |
| `POST` | `/api/v1/guidelines` | `write` | Create guideline |
| `GET` | `/api/v1/guidelines/{id}` | `read` | Get guideline with colors/fonts/selectors |
| `PUT` | `/api/v1/guidelines/{id}` | `write` | Update guideline name/description |
| `DELETE` | `/api/v1/guidelines/{id}` | `admin` | Delete guideline (cascades) |
| `POST` | `/api/v1/guidelines/{id}/colors` | `write` | Add color pair |
| `DELETE` | `/api/v1/guidelines/{id}/colors/{colorId}` | `write` | Remove color |
| `POST` | `/api/v1/guidelines/{id}/fonts` | `write` | Add font |
| `DELETE` | `/api/v1/guidelines/{id}/fonts/{fontId}` | `write` | Remove font |
| `POST` | `/api/v1/guidelines/{id}/selectors` | `write` | Add CSS selector |
| `DELETE` | `/api/v1/guidelines/{id}/selectors/{selectorId}` | `write` | Remove selector |
| `GET` | `/api/v1/guidelines/{id}/sites` | `read` | List site assignments |
| `POST` | `/api/v1/guidelines/{id}/sites` | `write` | Assign site |
| `DELETE` | `/api/v1/guidelines/{id}/sites` | `write` | Unassign site |
| `POST` | `/api/v1/match` | `read` | Match issues against branding |
| `GET` | `/api/v1/templates/csv` | `read` | Download CSV import template |
| `GET` | `/api/v1/templates/json` | `read` | Download JSON import template |

---

## Dashboard Integration

The dashboard integrates with the branding service automatically when configured. Add the following to `dashboard.config.json`:

```json
{
  "branding": {
    "url": "http://localhost:4100",
    "clientId": "dashboard",
    "clientSecret": "your-secret-here"
  }
}
```

When configured, the dashboard:

1. Obtains a token from `/api/v1/oauth/token` on startup using the configured client credentials.
2. After each scan completes, calls `POST /api/v1/match` with the scan issues, site URL, and org ID.
3. Stores the `brandingMatch` annotation on each issue record.
4. Surfaces brand-related vs unexpected issue counts in the scan report and trends views.

If the branding service is unreachable at startup, the dashboard logs a warning and continues — branding enrichment is non-blocking.

### Report integration

When branding enrichment is active, each scan report gains:

- **Filter bar** — All / Unexpected / Brand-Related toggle to isolate issues by brand classification.
- **Brand badge** — an inline badge on each matched issue showing which guideline matched and the matching detail (e.g. `Brand Red (#CC0000 / #FFFFFF, ΔE=2.3)`).
- **Dual KPI cards** — overall compliance rate alongside the rate excluding brand-related issues, so teams see both the full picture and the non-brand baseline.
- **Brand KPI card** — guideline name, version reference, and count of brand-related issues in the current scan.

Filter pill counts update live as the brand filter is applied or cleared. The filter state is preserved across page navigations within the same report session.

---

## Brand Image Upload

Each branding guideline can have an associated brand image (e.g. a logo or brand mark). Images are uploaded via the dashboard admin UI or via the dashboard REST API.

### Storage path

Images are stored on disk at:

```
<uploadsDir>/<orgId>/branding-images/<slug>-<guidelineId>.<ext>
```

The `<slug>` is the guideline name lowercased with non-alphanumeric characters replaced by hyphens. The `uploadsDir` defaults to `./uploads` and is configured by the `DASHBOARD_UPLOADS_DIR` environment variable or the `uploadsDir` field in `dashboard.config.json`.

Example path for an org named `campari`, guideline named `Aperol Brand`, ID `abc-123`:

```
uploads/campari/branding-images/aperol-brand-abc-123.png
```

The stored path `/uploads/{orgId}/branding-images/{filename}` is persisted as `imagePath` on the guideline record and is served by the dashboard's static file handler.

### Upload endpoint

```
POST /admin/branding-guidelines/:id/image
```

Requires the `branding.manage` permission. Accepts a multipart file upload (image files only). Returns an HTML partial for HTMX swap updating the brand image preview area.

### API (REST)

Brand images are uploaded through the dashboard admin routes (see [REST API Endpoints](#rest-api-endpoints) below). The `imagePath` field is returned on the guideline object from all guideline endpoints once an image is uploaded.

---

## Scan Retag

When a branding guideline is assigned to a site, modified (colors, fonts, or selectors added or removed), or toggled active, the dashboard automatically re-runs branding matching on all existing completed scans for the affected site(s). This keeps historical scan data consistent with the current guideline configuration.

### What triggers a retag

| Action | Scans retagged |
|--------|---------------|
| Assign guideline to site | All completed scans for that site |
| Add or remove a color | All completed scans for all sites assigned to the guideline |
| Add or remove a font | All completed scans for all sites assigned to the guideline |
| Add or remove a selector | All completed scans for all sites assigned to the guideline |
| Toggle guideline active | All completed scans for all sites assigned to the guideline (activate only) |
| Manual retag via API | All completed scans for the specified site |

### What a retag does

1. Resolves the active guideline for the site.
2. Loads all completed scan reports for the site.
3. Re-runs the branding matcher against each scan's issues.
4. Replaces stale `brandMatch` annotations on issues with fresh results.
5. Updates the `branding` summary block in the JSON report (`guidelineId`, `guidelineName`, `guidelineVersion`, `brandRelatedCount`).
6. Persists the updated report and updates `brandingGuidelineId`, `brandingGuidelineVersion`, and `brandRelatedCount` on the scan record.

Retag operations are non-fatal — individual scan failures are skipped and the operation continues.

### Manual retag via REST API

```bash
POST /api/v1/branding/retag
Content-Type: application/json

{ "siteUrl": "https://www.campari.com" }
```

Response:

```json
{ "data": { "retagged": 12 } }
```

### Manual retag via GraphQL

```graphql
mutation {
  retagBrandingScans(siteUrl: "https://www.campari.com") {
    retagged
  }
}
```

---

## Matching Strategies

The matcher applies three independent strategies to each issue. An issue is classified as brand-related if any strategy matches.

### 1. Color-pair matching

Extracts foreground and background color values from the issue's CSS context. Computes perceptual distance (Delta-E CIE76) between the extracted pair and each brand color pair in the applicable guidelines.

- **Match threshold:** Delta-E ≤ 5.0 (perceptually similar)
- **Typical use:** Contrast ratio failures (`WCAG2AA.Principle1.Guideline1_4.1_4_3`)
- **Detail returned:** `"Brand Red (#CC0000 / #FFFFFF, ΔE=2.3)"`

### 2. Font matching

Extracts the `font-family` value from the issue's CSS context and normalizes it (lowercase, strip quotes and fallbacks). Compares against each brand font's family name using normalized exact match.

- **Match:** exact match after normalization
- **Typical use:** Font-related contrast or readability issues
- **Detail returned:** `"Helvetica Neue"`

### 3. Selector matching

Compares the issue's CSS selector string against each brand selector pattern using:
- **Substring match:** the issue selector contains the pattern anywhere
- **Prefix match:** the issue selector starts with the pattern

Patterns are matched case-sensitively.

- **Typical use:** Issues on known brand components (`.brand-header`, `#nav-main`)
- **Detail returned:** `".brand-header"`

### Strategy precedence

All three strategies are evaluated independently. When multiple strategies match, the first match in the order (color, font, selector) is reported. The response `summary.byStrategy` object shows how many issues matched via each strategy.

---

## Template Format

Use templates to bulk-import guidelines via the dashboard UI or the REST API. Download them from the running service:

```bash
# CSV template
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4100/api/v1/templates/csv -o branding-template.csv

# JSON template
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4100/api/v1/templates/json -o branding-template.json
```

### CSV format

The CSV template has one row per color, font, or selector entry. A guideline is identified by `name` + `orgId`. Multiple rows with the same name/orgId are merged into one guideline.

```csv
name,orgId,description,type,foreground,background,colorLabel,colorRole,fontFamily,fontVariants,fontRole,selectorPattern,selectorDescription,siteUrl
Campari Main,campari,Primary brand,color,#CC0000,#FFFFFF,Brand Red,primary,,,,,
Campari Main,campari,,font,,,,,,Helvetica Neue,"400,700",body,,
Campari Main,campari,,selector,,,,,,,,,.brand-header,Top nav bar,
Campari Main,campari,,site,,,,,,,,,,,https://www.campari.com
```

| Column | Description |
|--------|-------------|
| `name` | Guideline name (required) |
| `orgId` | Organization ID (required) |
| `description` | Guideline description (optional, first row only) |
| `type` | Row type: `color`, `font`, `selector`, or `site` |
| `foreground` | Hex foreground color (type=color) |
| `background` | Hex background color (type=color) |
| `colorLabel` | Human label for the color pair (optional) |
| `colorRole` | Semantic role: primary, secondary, cta (optional) |
| `fontFamily` | CSS font-family name (type=font) |
| `fontVariants` | Comma-separated weights/styles (type=font, optional) |
| `fontRole` | Semantic role: heading, body, caption (optional) |
| `selectorPattern` | CSS selector pattern (type=selector) |
| `selectorDescription` | Human description of the component (optional) |
| `siteUrl` | Site URL to assign (type=site) |

### JSON format

The JSON template represents a complete import payload. Download the template from the service to see the exact structure:

```json
{
  "guidelines": [
    {
      "name": "Campari Main",
      "orgId": "campari",
      "description": "Primary brand guidelines",
      "colors": [
        { "foreground": "#CC0000", "background": "#FFFFFF", "label": "Brand Red", "role": "primary" }
      ],
      "fonts": [
        { "family": "Helvetica Neue", "variants": ["400", "700"], "role": "body" }
      ],
      "selectors": [
        { "pattern": ".brand-header", "description": "Top navigation bar" }
      ],
      "sites": [
        "https://www.campari.com"
      ]
    }
  ]
}
```

---

## Multi-Brand Multi-Site Model

A single branding service instance supports multiple organizations, each with multiple guidelines, each assigned to multiple sites.

### Data model

```
Organization (orgId)
  └── Guideline (name, description)
        ├── Colors   (foreground/background hex pairs)
        ├── Fonts    (family name + variants)
        ├── Selectors (CSS selector patterns)
        └── Sites    (site URLs assigned to this guideline)
```

A site can be assigned to multiple guidelines (e.g. a global brand guideline plus a regional variant). When matching, all guidelines assigned to the site are evaluated and the first match across all guidelines is returned.

### Campari Group example

Campari Group manages dozens of brands across multiple markets. Each brand has its own color palette, typography, and component structure. A typical setup might be:

```
org: campari
  ├── guideline: Campari Group Global
  │     colors:   #CC0000/#FFFFFF (Brand Red), #000000/#FFFFFF (Black)
  │     fonts:    Helvetica Neue (heading), Georgia (body)
  │     selectors: .campari-*, #main-nav
  │     sites:    www.campari.com, www.camparigroup.com
  │
  ├── guideline: Aperol Brand
  │     colors:   #F26522/#FFFFFF (Aperol Orange)
  │     fonts:    Montserrat (heading)
  │     selectors: .aperol-*, .brand-aperol
  │     sites:    www.aperol.com
  │
  └── guideline: Wild Turkey Brand
        colors:   #8B4513/#FFF8DC (Bourbon Brown)
        fonts:    Playfair Display (heading)
        selectors: .wt-*, .wild-turkey
        sites:    www.wildturkey.com
```

When the dashboard scans `www.aperol.com` and detects contrast issues, the branding service matches them against the Aperol Brand guideline. Failures that match Aperol Orange are flagged as brand-related; failures using unexpected colors are flagged as unexpected — surfacing real remediation work versus known brand decisions.

---

## REST API Endpoints

The dashboard exposes branding management endpoints at `http://localhost:5000/api/v1/branding/*`. These endpoints require a logged-in session with the appropriate permission (`branding.view` for reads, `branding.manage` for writes).

All endpoints are rate limited to **60 requests per minute**.

### Guidelines

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| `GET` | `/api/v1/branding/guidelines` | `branding.view` | List guidelines for the current org |
| `GET` | `/api/v1/branding/guidelines/:id` | `branding.view` | Get guideline with colors, fonts, and selectors |
| `POST` | `/api/v1/branding/guidelines` | `branding.manage` | Create a guideline |
| `DELETE` | `/api/v1/branding/guidelines/:id` | `branding.manage` | Delete a guideline (cascades) |

### Colors, Fonts, and Selectors

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| `POST` | `/api/v1/branding/guidelines/:id/colors` | `branding.manage` | Add a color |
| `DELETE` | `/api/v1/branding/guidelines/:id/colors/:colorId` | `branding.manage` | Remove a color |
| `POST` | `/api/v1/branding/guidelines/:id/fonts` | `branding.manage` | Add a font |
| `DELETE` | `/api/v1/branding/guidelines/:id/fonts/:fontId` | `branding.manage` | Remove a font |
| `POST` | `/api/v1/branding/guidelines/:id/selectors` | `branding.manage` | Add a CSS selector pattern |
| `DELETE` | `/api/v1/branding/guidelines/:id/selectors/:selectorId` | `branding.manage` | Remove a selector |

### Site Assignments

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| `POST` | `/api/v1/branding/guidelines/:id/sites` | `branding.manage` | Assign a site URL to a guideline |
| `DELETE` | `/api/v1/branding/guidelines/:id/sites` | `branding.manage` | Unassign a site (body: `{ "siteUrl": "..." }`) |
| `GET` | `/api/v1/branding/sites?siteUrl=...` | `branding.view` | Get the guideline assigned to a site URL |

### Image Upload

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| `POST` | `/admin/branding-guidelines/:id/image` | `branding.manage` | Upload a brand image (multipart/form-data) |

Images are stored at `/uploads/{orgId}/branding-images/{filename}` and served as static files.

### Scan Retag

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| `POST` | `/api/v1/branding/retag` | `branding.manage` | Retag completed scans for a site (body: `{ "siteUrl": "..." }`) |

---

## GraphQL API

The dashboard GraphQL endpoint at `http://localhost:5000/graphql` exposes full branding read/write access.

### Types

```graphql
type BrandColor {
  id: ID!
  name: String!
  hexValue: String!
  usage: String
  context: String
}

type BrandFont {
  id: ID!
  family: String!
  weights: [String!]
  usage: String
  context: String
}

type BrandSelector {
  id: ID!
  pattern: String!
  description: String
}

type BrandGuideline {
  id: ID!
  orgId: String!
  name: String!
  description: String
  version: Int!
  active: Boolean!
  imagePath: String
  createdAt: String!
  updatedAt: String!
  colors: [BrandColor!]!
  fonts: [BrandFont!]!
  selectors: [BrandSelector!]!
  sites: [String!]!
}

type RetagResult {
  retagged: Int!
}
```

### Queries

```graphql
# List all guidelines for the current org
query {
  brandingGuidelines {
    id name description version active imagePath
    colors { id name hexValue usage }
    fonts { id family weights usage }
    selectors { id pattern description }
    sites
  }
}

# Get a single guideline by ID
query {
  brandingGuideline(id: "abc-123") {
    id name version active imagePath colors { name hexValue } sites
  }
}

# Get the guideline assigned to a site URL
query {
  brandingGuidelineForSite(siteUrl: "https://www.campari.com") {
    id name colors { name hexValue } fonts { family }
  }
}
```

### Mutations

```graphql
# Create a guideline
mutation {
  createBrandingGuideline(input: { name: "Aperol Brand", description: "Primary palette" }) {
    id name active
  }
}

# Toggle active/inactive
mutation {
  toggleBrandingGuideline(id: "abc-123") { id active }
}

# Delete a guideline
mutation {
  deleteBrandingGuideline(id: "abc-123")
}

# Add / remove colors
mutation { addBrandColor(guidelineId: "abc-123", input: { name: "Aperol Orange", hexValue: "#F26522", usage: "primary" }) { id } }
mutation { removeBrandColor(id: "color-456") }

# Add / remove fonts
mutation { addBrandFont(guidelineId: "abc-123", input: { family: "Montserrat", weights: ["400","700"], usage: "heading" }) { id } }
mutation { removeBrandFont(id: "font-789") }

# Add / remove selectors
mutation { addBrandSelector(guidelineId: "abc-123", input: { pattern: ".aperol-header", description: "Top navigation" }) { id } }
mutation { removeBrandSelector(id: "sel-012") }

# Assign / unassign sites
mutation { assignBrandingToSite(guidelineId: "abc-123", siteUrl: "https://www.aperol.com") }
mutation { unassignBrandingFromSite(siteUrl: "https://www.aperol.com") }

# Retag scans
mutation {
  retagBrandingScans(siteUrl: "https://www.campari.com") {
    retagged
  }
}
```

---

## Docker Compose

The `docker-compose.yml` in the monorepo root defines three services: `compliance`, `branding`, and `dashboard`. The branding service and dashboard service are wired together automatically via the `DASHBOARD_BRANDING_URL` environment variable.

### Services

| Service | Port | Description |
|---------|------|-------------|
| `compliance` | 4000 | Standalone compliance engine |
| `branding` | 4100 | Standalone branding service |
| `dashboard` | 5000 | Main UI; depends on both services |

### Volumes

| Volume | Mounted at | Contents |
|--------|-----------|---------|
| `branding-data` | `/app/packages/branding` | Branding SQLite database (`branding.db`) and JWT keys |
| `dashboard-uploads` | `/app/uploads` | Uploaded files including brand images at `uploads/{orgId}/branding-images/` |
| `dashboard-data` | `/app/data` | Dashboard SQLite database |

### Branding service startup

The branding service auto-generates JWT keys on first start:

```yaml
command: >
  sh -c "cd packages/branding &&
    node dist/cli.js keys generate 2>/dev/null || true &&
    node dist/cli.js serve --port 4100"
```

The `|| true` ensures a clean restart does not fail if keys already exist.

### Dashboard wiring

```yaml
environment:
  - DASHBOARD_BRANDING_URL=http://branding:4100
depends_on:
  branding:
    condition: service_healthy
```

The dashboard will not start until the branding service passes its health check (`GET /api/v1/health`). If the branding service becomes unavailable after startup, branding enrichment is silently skipped — the dashboard remains operational.

### Overriding ports

Use environment variables to change the default ports:

```bash
BRANDING_PORT=4200 docker compose up
```

---

*See also: [openapi/branding.json](../reference/openapi/branding.json) | [compliance/README.md](../compliance/README.md) | [reference/api-reference.md](../reference/api-reference.md)*
