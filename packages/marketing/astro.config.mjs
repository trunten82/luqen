import { defineConfig } from 'astro/config';

// luqen.dev — marketing site.
// Static build only; deploys to a CDN (Vercel/Netlify/Cloudflare Pages).
// Decoupled from the dashboard so marketing iterations don't block product
// deploys and vice-versa.
export default defineConfig({
  site: 'https://luqen.dev',
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    server: {
      fs: { allow: ['..', '../..'] },
    },
  },
});
