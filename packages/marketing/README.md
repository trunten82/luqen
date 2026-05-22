# @luqen/marketing — luqen.dev

Static marketing site for Luqen, built with [Astro](https://astro.build).
Decoupled from the dashboard product so marketing iterations don't block
product deploys and vice-versa.

## Status

**Skeleton.** Tokens are wired to mirror the dashboard identity, one
landing page (`src/pages/index.astro`) carries placeholder copy that
states the product purpose from `PRODUCT.md`. Production launch needs:

- Real copy from marketing.
- Hosting decision (Vercel / Netlify / Cloudflare Pages).
- Domain (`luqen.dev`) DNS pointing to the chosen host.
- Self-hosted font files (currently the page falls back to system-ui;
  copy the Inter / Plex Mono woff2 files from
  `packages/dashboard/src/static/fonts/` once the build pipeline is in
  place).

## Develop

```bash
cd packages/marketing
npm install
npm run dev      # http://localhost:4321
npm run build    # → dist/
npm run preview
```

## Design

`src/styles/tokens.css` mirrors the dashboard's identity tokens
(oxblood + citron, OKLCH neutrals, the spacing scale). Marketing pages
may break the dashboard's "restraint" rule in service of brand
expression — but the absolute bans in `/PRODUCT.md` still apply.
