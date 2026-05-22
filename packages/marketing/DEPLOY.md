# Deploying luqen.dev

Marketing site is built with [Astro](https://astro.build), output is
static HTML/CSS/JS. The skeleton is in this workspace; what follows is
the operator's handoff document for getting it onto `luqen.dev`.

---

## 1. Pre-flight

Before pointing DNS, finish three blocking items:

1. **Real copy.** `src/pages/index.astro` carries the strategic
   placeholder from `PRODUCT.md`. Replace section bodies with your
   marketing voice. Keep the verdict-line footer; it's part of the brand.
2. **Self-hosted fonts.** Copy `inter-latin.woff2`,
   `plex-mono-latin-400.woff2`, and `plex-mono-latin-500.woff2` from
   `packages/dashboard/src/static/fonts/` to
   `packages/marketing/public/fonts/`, then add `@font-face` blocks at
   the top of `src/styles/tokens.css` (mirror the dashboard rules).
   Until this lands, the page falls back to `system-ui`.
3. **Logo.** `public/favicon.svg` ships; if you want a wordmark hero
   asset, drop an `.svg` into `public/` and reference it from
   `index.astro`.

---

## 2. Pick a host

| Host | Build hook | Cost | Notes |
|---|---|---|---|
| **Cloudflare Pages** (recommended) | GitHub action or Pages git integration | free | Free SSL, free DNS if you move the domain to Cloudflare; cache-purge on deploy is one click. |
| **Vercel** | `vercel.json` + Vercel git integration | free tier OK | Best DX if you may add a Node API later. Astro template auto-detected. |
| **Netlify** | `netlify.toml` + git integration | free tier OK | Similar to Vercel, slightly slower edge in EU. |
| **Static S3 + CloudFront** | `npm run build && aws s3 sync` | $1–5/mo | Full control, more wiring. Worth it only if everything else is on AWS already. |

Cloudflare Pages is the default recommendation: it costs nothing, sits
in front of a CDN, and Cloudflare's bot/abuse protection covers the
site without further config.

---

## 3. Cloudflare Pages — concrete steps

```
# 1. Push this repo to GitHub (already done — origin: trunten82/luqen).
# 2. In Cloudflare dashboard: Pages → "Create a project" → Connect to Git.
# 3. Select the luqen repo. Configure the build:
#       Project name:           luqen-www
#       Production branch:      master
#       Framework preset:       Astro
#       Build command:          npm install && npm run build -w packages/marketing
#       Build output directory: packages/marketing/dist
#       Root directory:         /
#       Node version:           22 (env var NODE_VERSION=22)
# 4. Deploy. First deploy will give you luqen-www.pages.dev.
# 5. Custom domains → add luqen.dev. Cloudflare provides DNS guidance.
```

DNS, assuming the domain stays at your current registrar:

```
luqen.dev          A     192.0.2.1         (Cloudflare anycast)
luqen.dev          AAAA  2001:db8::1       (Cloudflare anycast)
www.luqen.dev      CNAME luqen-www.pages.dev.
```

Cloudflare displays the actual A/AAAA values during onboarding; the
above are illustrative.

---

## 4. GitHub Actions (optional)

If you prefer to keep CI in GitHub and only push the built artifact to
the host, a workflow lands at `.github/workflows/marketing-deploy.yml`
(create this once a host is chosen). Skeleton:

```yaml
name: Deploy luqen.dev
on:
  push:
    branches: [master]
    paths: ['packages/marketing/**', 'PRODUCT.md', 'DESIGN.md']
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm install
      - run: npm run build -w packages/marketing
      - name: Upload artifact
        # Cloudflare Pages auto-detects pushes; this step is for
        # S3/Netlify/custom hosts.
        uses: cloudflare/pages-action@v1
        with:
          apiToken: $${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: $${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: luqen-www
          directory: packages/marketing/dist
```

Secrets needed: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Add
both at github.com/trunten82/luqen/settings/secrets/actions.

---

## 5. Post-launch

- Run `npm run build -w packages/marketing` locally and `npm run preview`
  to verify before pushing.
- Self-scan the live site with the production dashboard:
  `https://luqen.alessandrolanna.it/api/v1/scans` with a scan against
  `https://luqen.dev`. Aim for AAA, that's the brand commitment.
- Add the verdict-badge embeddable to the marketing footer once the
  first self-scan completes. The snippet is documented in the dashboard
  at `/api/v1/badge/<scanId>.svg`.

---

## 6. What does NOT belong here

- Application code. The marketing site never talks to the dashboard API
  beyond optional, public, anonymous endpoints (badge SVG, health).
- User data. No analytics that fingerprint or track; if you need
  analytics, prefer Cloudflare's own privacy-respecting Web Analytics
  (no cookies, GDPR-clean).
- Login or auth flows. Those live on the dashboard. The marketing site
  links to `https://luqen.alessandrolanna.it/login`.
