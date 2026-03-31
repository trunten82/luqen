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
8. [Matching Strategies](#matching-strategies)
9. [Template Format](#template-format)
10. [Multi-Brand Multi-Site Model](#multi-brand-multi-site-model)

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

The machine-readable OpenAPI 3.0 spec is at [`docs/reference/openapi-branding.yaml`](../reference/openapi-branding.yaml).

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

*See also: [openapi-branding.yaml](../reference/openapi-branding.yaml) | [compliance/README.md](../compliance/README.md) | [reference/api-reference.md](../reference/api-reference.md)*
