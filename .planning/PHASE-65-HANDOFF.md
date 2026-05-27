# Phase 65 — Sidebar restructure + page-header partial · handoff

Branch: **`wip/phase-65-sidebar-restructure`**
Base: `master` @ `58f2b18` (post-API-keys parity)
Status: **WIP — code drafted, not built, not deployed**

## Why this exists

`/impeccable audit` of the sidebar + the full-brand UX audit (this session) flagged the sidebar's 27-item flat list + section-label sprawl as the highest-leverage IA debt in the dashboard. Score 15/20 on the audit; IA was the bottleneck pulling it down.

Audit memo: see this session's chat transcript ("Brand UX debt ledger — synthesized" section). Roadmap planned six phases (65-70); this branch is **Phase 65 only**.

## What this branch contains

| File | State | What changed |
|---|---|---|
| `src/views/partials/sidebar.hbs` | **rewritten** | 27 → 13 visible items, 3 groups (Scan / Compliance / Brand) + `<details>` "More" disclosure for admin chrome. Drops Fleet duplicate (handled by scope chip on `/fleet`). Merges Brand guidelines + System brand into one item. Renames "Public badges" → "Shareable badges". Compliance group now wraps monitor + sources + proposals + change-history (audit's S7 fix). Identity & access cluster collapses to one item pointing at `/admin/api-keys`. |
| `src/views/partials/page-header.hbs` | **extended** | Backward-compat with existing `title/subtitle/actionUrl/actionLabel` callers. Adds `backHref/backLabel/crumbs/scopeChip/scopeVariant` for cross-page nav. Adopted from `fleet-detail.hbs`. |
| `src/views/partials/identity-access-tabs.hbs` | **new** | Pivot strip between api-keys / oauth-keys / clients / service-connections / users / webhooks. Required because the sidebar consolidation retired their individual entries. |
| `src/static/style.css` | **appended** | `.page-header__back`, `.page-header__crumbs`, `.page-header__chip[--admin/--warning]` styles. Honour DESIGN.md token mapping (with safe fallbacks for phantom-token references). |
| `src/i18n/locales/en.json` | **extended** | New keys in `nav.*`: `scanGroup`, `complianceGroup`, `brandGroup`, `moreAdmin`, `identityAccess`, `repositories`, `gitHosts`, `gitCredentials`, `shareableBadges`, `llmConfig`, `notifications`, `brandOverview`. In `common.*`: `backTo`, `scopeAdmin`, `scopeOrg`, `more`, `breadcrumb`. |

## What's missing (next session has to do this)

1. **Locale parity** — `fr.json` / `de.json` / `es.json` / `it.json` / `pt.json` need the same new keys. `{{t "nav.scanGroup"}}` in non-English UI will fall through to the raw key. Estimated 5-10 minutes if you have translations ready, or pass through machine translation.

2. **Include `identity-access-tabs.hbs` in 6 page templates** — at the top of:
   - `views/admin/api-keys.hbs`
   - `views/admin/oauth-keys.hbs`
   - `views/admin/clients.hbs`
   - `views/admin/service-connections.hbs`
   - `views/admin/users.hbs`
   - `views/admin/webhooks.hbs`

   One-line each: `{{> identity-access-tabs}}` immediately after the `page-header` block.

3. **`isAdminPath` boolean in layout context** — the new sidebar uses `{{#if isAdminPath}}open{{/if}}` on the `<details>` so the "More" disclosure auto-opens when the user is on any `/admin/*` route. Set it in `src/views/layouts/main.hbs` or upstream in the layout-decorator middleware that already populates `currentPath` / `user` / `orgContext`.

   ```
   isAdminPath = /^\/admin\//.test(currentPath)
   ```

4. **Add CSS for `.ia-tabs` + `.ia-tabs__tab` + `.sidebar__more` + `.sidebar__more-chevron` + `.sidebar__section-label--summary`** — the new sidebar references these classes but `style.css` doesn't define them yet. Pattern guidance:
   - `.ia-tabs` — horizontal flex row of tab links, 1px bottom border, gap `--space-2`, tabs use `--text-secondary`; `.is-active` flips to `--text-primary` + 2px bottom border in `--id-accent`. Mirror the existing `.tabs` pattern in style.css.
   - `.sidebar__more > summary` — strip the default marker (`list-style: none` + `::-webkit-details-marker { display: none }`), align section label baseline with sibling labels, animate the chevron rotation on `[open]`.

5. **Build + test + deploy** — `npm run build -w packages/dashboard`, then `timeout 180 npx vitest run` to confirm nothing's broken (especially any route tests that snapshot sidebar HTML). Then on lxc-luqen: pull + build + restart.

6. **OpenAPI snapshot** — likely unchanged (no new HTTP routes), but `tools/lint-compose.py` style runs on every push; verify CI is green.

7. **Smoke checks**:
   - `/fleet` renders fine with the new sidebar.
   - `/admin/api-keys` shows the new `ia-tabs` strip at the top and the 5 sibling tabs reach all the right pages.
   - Hit `/admin/oauth-keys` directly — verify sidebar's "Identity & access" entry highlights as active (the new sidebar's combined `is-active` regex covers it).
   - On a non-admin user, verify the "More" `<details>` doesn't render at all (gated by `(or perm.usersManageAny perm.adminTeams perm.adminRoles perm.adminOrg perm.adminPlugins perm.reposManage perm.adminSystem perm.llmView perm.auditView)`).
   - On an admin user landing on `/admin/audit-log`, verify "More" is auto-expanded (needs `isAdminPath`).

## How to resume

```bash
cd /root/luqen
git checkout wip/phase-65-sidebar-restructure
# Do the seven items above, commit incrementally, then:
git checkout master
git merge --no-ff wip/phase-65-sidebar-restructure
git push origin master
# Deploy as usual.
```

If the user wants to abandon Phase 65 entirely, the branch can be deleted (`git branch -D wip/phase-65-sidebar-restructure`) — master is unaffected.

## Audit deliverables NOT in this branch (the other 5 phases)

The full UX audit identified 5 more phases (66 Card-as-layout purge, 67 Identity & Access cohesion, 68 Reference data onboarding, 69 Notifications rebuild, 70 Hero-metric purge). None of those have any code in this branch. They're tracked in the chat transcript's "Prioritized fix roadmap" table.
