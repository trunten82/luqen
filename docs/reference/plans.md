# Plans & pricing (Free / Pro / Agency)

> v3.5.0 Phase 82. The canonical feature matrix lives in code at
> `packages/dashboard/src/plan-matrix.ts` (the single platform-side source of
> truth) and is mirrored by the WordPress plugin's `Luqen_Entitlement::FEATURES`.
> Monetisation is **admin-controlled — there is no billing integration**; a plan
> is a per-organisation configuration value (`org_entitlements.plan`) an
> administrator sets.

## Feature matrix

| Capability | Surface | Free | Pro | Agency |
|---|---|:--:|:--:|:--:|
| Single-page accessibility scan | platform | ✓ | ✓ | ✓ |
| Per-post Gutenberg fixes | wordpress | ✓ | ✓ | ✓ |
| Basic issues list | platform | ✓ | ✓ | ✓ |
| Accessibility statement | platform | ✓ | ✓ | ✓ |
| Full-site & bulk scanning | wordpress | – | ✓ | ✓ |
| Scan / audit history | wordpress | – | ✓ | ✓ |
| Excel (xlsx) export | wordpress | – | ✓ | ✓ |
| Custom post type & WooCommerce scanning | wordpress | – | ✓ | ✓ |
| Multisite network bulk fixes | wordpress | – | ✓ | ✓ |
| VPAT / ACR + evidence pack + secure sharing | platform | – | ✓ | ✓ |
| Credit-metered AI fix suggestions | platform | – | ✓ | ✓ |
| Multi-client agency console | dashboard | – | – | ✓ |
| White-label / rebrandable client reports | dashboard | – | – | ✓ |
| Partner/resale seat (N client sites) | dashboard | – | – | ✓ |

## Pricing anchors

| Plan | Price | Note |
|---|---|---|
| Free | $0 | Always free — single-page scans, Gutenberg fixes, accessibility statement. |
| Pro | **TBD** | Placeholder pending the in-flight enterprise-pricing research. A WP-shelf comparable validated near ~$190/yr — **not** a published Luqen price. |
| Agency | **TBD** | Placeholder pending the in-flight enterprise-pricing research. A WP-shelf comparable validated near ~$2,250/yr per 25 sites — **not** a published Luqen price. |

> **TODO (blocked on the user's enterprise-pricing research):** set the published
> Pro and Agency price anchors. Do not invent published prices — the numbers above
> are competitor-comparable validation ranges only. Once research lands, update
> `PRICING_ANCHORS` in `plan-matrix.ts` and this table.

## How plans drive features

- **WordPress plugin** — `Luqen_Entitlement` resolves the tier (standalone admin-set,
  or derived from the connected org via `GET /api/v1/entitlement`) and gates the Pro
  surfaces (see Phase 79).
- **Dashboard / LLM** — AI fixes are credit-metered per org (Phase 80); the agency
  console + partner seat are the Agency tier (Phase 81). The per-org plan lives in
  `org_entitlements` and is surfaced to clients via `GET /api/v1/entitlement`.
