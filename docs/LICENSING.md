[Docs](README.md) > Licensing

# Licensing

## Luqen Ecosystem License

All packages in this monorepo are published under the **MIT License**.

| Package | License |
|---|---|
| `@luqen/core` | MIT |
| `@luqen/compliance` | MIT |
| `@luqen/dashboard` | MIT |
| `@luqen/monitor` | MIT |

The full license text is in [`LICENSE`](../LICENSE) at the repository root.

---

## Key Dependency Licenses

The table below covers direct runtime dependencies across all four packages.
All of them are MIT-licensed and fully compatible with MIT distribution.

| Package | License | Notes |
|---|---|---|
| `fastify` | MIT | HTTP framework (compliance, dashboard) |
| `@fastify/cors` | MIT | CORS plugin |
| `@fastify/csrf-protection` | MIT | CSRF token verification (dashboard) |
| `@fastify/formbody` | MIT | Form-body parser |
| `@fastify/helmet` | MIT | Security HTTP headers (dashboard) |
| `@fastify/rate-limit` | MIT | Rate-limiting plugin |
| `@fastify/secure-session` | MIT | Session management |
| `@fastify/static` | MIT | Static file serving |
| `@fastify/swagger` | MIT | OpenAPI plugin |
| `@fastify/swagger-ui` | MIT | Swagger UI plugin |
| `@fastify/view` | MIT | Template rendering |
| `bcrypt` | MIT | Password hashing |
| `better-sqlite3` | MIT | Embedded SQLite driver |
| `cheerio` | MIT | HTML parsing / scraping |
| `commander` | MIT | CLI argument parsing |
| `exceljs` | MIT | Excel/CSV export |
| `graphql` | MIT | GraphQL language runtime |
| `handlebars` | MIT | HTML template engine |
| `ioredis` | MIT | Redis client |
| `jose` | MIT | JWT / JWK cryptography |
| `mercurius` | MIT | GraphQL adapter for Fastify |
| `nodemailer` | MIT-0 | Email sending (SMTP) |
| `pdfkit` | MIT | PDF document generation |
| `tar` | ISC | Tarball handling for plugin installation |
| `xml2js` | MIT | XML parsing |
| `robots-parser` | MIT | robots.txt parsing |
| `zod` | MIT | Schema validation |
| `@modelcontextprotocol/sdk` | MIT | MCP server/client SDK |
| `pa11y` | LGPL-3.0 | Accessibility scanner (used as a library — LGPL permits this without copyleft obligations) |
| `axe-core` | MPL-2.0 | Accessibility test runner (used as a library — MPL file-level copyleft does not propagate) |

All of the above are compatible with MIT when used as libraries (linked/imported, not
modified and redistributed). All other transitive runtime dependencies resolve to MIT,
ISC, Apache-2.0, or BSD variants — all of which are permissive and compatible with MIT
distribution.

---

## Runtime Dependencies

The following table lists all key runtime dependencies with their pinned versions
(from `package.json`), licenses, and official source URLs.

### @luqen/core

| Package | Version | License | Source |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | ^1.27.1 | MIT | [npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) |
| `cheerio` | ^1.2.0 | MIT | [npm](https://www.npmjs.com/package/cheerio) |
| `commander` | ^14.0.3 | MIT | [npm](https://www.npmjs.com/package/commander) |
| `handlebars` | ^4.7.8 | MIT | [npm](https://www.npmjs.com/package/handlebars) |
| `pa11y` | ^9.1.1 | LGPL-3.0 | [npm](https://www.npmjs.com/package/pa11y) / [GitHub](https://github.com/pa11y/pa11y) |
| `robots-parser` | ^3.0.1 | MIT | [npm](https://www.npmjs.com/package/robots-parser) |
| `xml2js` | ^0.6.2 | MIT | [npm](https://www.npmjs.com/package/xml2js) |
| `zod` | ^4.3.6 | MIT | [npm](https://www.npmjs.com/package/zod) |

### @luqen/compliance

| Package | Version | License | Source |
|---|---|---|---|
| `@fastify/cors` | ^10.0.0 | MIT | [npm](https://www.npmjs.com/package/@fastify/cors) |
| `@fastify/rate-limit` | ^10.0.0 | MIT | [npm](https://www.npmjs.com/package/@fastify/rate-limit) |
| `@fastify/swagger` | ^9.0.0 | MIT | [npm](https://www.npmjs.com/package/@fastify/swagger) |
| `@fastify/swagger-ui` | ^5.0.0 | MIT | [npm](https://www.npmjs.com/package/@fastify/swagger-ui) |
| `@modelcontextprotocol/sdk` | ^1.27.1 | MIT | [npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) |
| `bcrypt` | ^6.0.0 | MIT | [npm](https://www.npmjs.com/package/bcrypt) |
| `better-sqlite3` | ^11.0.0 | MIT | [npm](https://www.npmjs.com/package/better-sqlite3) |
| `commander` | ^14.0.3 | MIT | [npm](https://www.npmjs.com/package/commander) |
| `fastify` | ^5.0.0 | MIT | [npm](https://www.npmjs.com/package/fastify) / [GitHub](https://github.com/fastify/fastify) |
| `ioredis` | ^5.10.1 | MIT | [npm](https://www.npmjs.com/package/ioredis) |
| `jose` | ^6.0.0 | MIT | [npm](https://www.npmjs.com/package/jose) |
| `zod` | ^4.3.6 | MIT | [npm](https://www.npmjs.com/package/zod) |

### @luqen/dashboard

| Package | Version | License | Source |
|---|---|---|---|
| `@fastify/csrf-protection` | ^7.1.0 | MIT | [npm](https://www.npmjs.com/package/@fastify/csrf-protection) |
| `@fastify/formbody` | ^8.0.0 | MIT | [npm](https://www.npmjs.com/package/@fastify/formbody) |
| `@fastify/helmet` | ^13.0.2 | MIT | [npm](https://www.npmjs.com/package/@fastify/helmet) |
| `@fastify/rate-limit` | ^10.3.0 | MIT | [npm](https://www.npmjs.com/package/@fastify/rate-limit) |
| `@fastify/secure-session` | ^8.0.0 | MIT | [npm](https://www.npmjs.com/package/@fastify/secure-session) |
| `@fastify/static` | ^8.0.0 | MIT | [npm](https://www.npmjs.com/package/@fastify/static) |
| `@fastify/view` | ^10.0.0 | MIT | [npm](https://www.npmjs.com/package/@fastify/view) |
| `bcrypt` | ^6.0.0 | MIT | [npm](https://www.npmjs.com/package/bcrypt) |
| `better-sqlite3` | ^11.0.0 | MIT | [npm](https://www.npmjs.com/package/better-sqlite3) |
| `commander` | ^14.0.3 | MIT | [npm](https://www.npmjs.com/package/commander) |
| `exceljs` | ^4.4.0 | MIT | [npm](https://www.npmjs.com/package/exceljs) |
| `fastify` | ^5.0.0 | MIT | [npm](https://www.npmjs.com/package/fastify) / [GitHub](https://github.com/fastify/fastify) |
| `graphql` | ^16.9.0 | MIT | [npm](https://www.npmjs.com/package/graphql) |
| `handlebars` | ^4.7.8 | MIT | [npm](https://www.npmjs.com/package/handlebars) |
| `ioredis` | ^5.10.1 | MIT | [npm](https://www.npmjs.com/package/ioredis) |
| `jose` | ^6.0.0 | MIT | [npm](https://www.npmjs.com/package/jose) |
| `mercurius` | ^16.8.0 | MIT | [npm](https://www.npmjs.com/package/mercurius) / [GitHub](https://github.com/mercurius-js/mercurius) |
| `nodemailer` | ^8.0.3 | MIT-0 | [npm](https://www.npmjs.com/package/nodemailer) / [GitHub](https://github.com/nodemailer/nodemailer) |
| `pdfkit` | ^0.18.0 | MIT | [npm](https://www.npmjs.com/package/pdfkit) / [GitHub](https://github.com/foliojs/pdfkit) |
| `tar` | ^7.5.12 | ISC | [npm](https://www.npmjs.com/package/tar) |
| `zod` | ^4.3.6 | MIT | [npm](https://www.npmjs.com/package/zod) |

### @luqen/monitor

| Package | Version | License | Source |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | ^1.27.1 | MIT | [npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) |
| `commander` | ^14.0.3 | MIT | [npm](https://www.npmjs.com/package/commander) |

### CDN Dependencies (loaded client-side)

| Package | Version | License | Source |
|---|---|---|---|
| `chart.js` | 4.x (CDN) | MIT | [npm](https://www.npmjs.com/package/chart.js) / [GitHub](https://github.com/chartjs/Chart.js) |

---

## License Compatibility Summary

| License family | Count (all deps) | Compatible with MIT? |
|---|---|---|
| MIT | 283 | Yes |
| Apache-2.0 | 23 | Yes — permissive, compatible with MIT |
| ISC | 19 | Yes — functionally equivalent to MIT |
| BSD-2-Clause | 13 | Yes — permissive |
| BSD-3-Clause | 10 | Yes — permissive |
| BlueOak-1.0.0 | 10 | Yes — permissive (more permissive than MIT) |
| LGPL-3.0 | 1 | Yes — used as a library (see note below) |
| MPL-2.0 | 4 | See note below |
| (MIT OR WTFPL) | 1 | Yes |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1 | Yes |

---

## Flagged License: LGPL-3.0

**Package:** `pa11y`

**Assessment:** pa11y is used as a library (imported via `require`/`import`).
The LGPL-3.0 permits use as a library without imposing copyleft obligations on
the consuming project — only modifications to pa11y's own source files would
need to be shared under LGPL. Luqen does not modify pa11y source code.

**No action required.**

---

## Flagged License: MPL-2.0

**Runtime package:** `axe-core`

**Assessment:** axe-core is used as a library by the pa11y `axe` runner. MPL-2.0
is a file-level copyleft — it applies only to modifications of the MPL-licensed
files themselves and does not propagate to code that imports or uses the library.
Luqen does not modify axe-core source code.

**Dev-only packages:** `lightningcss@1.32.0`, `lightningcss-linux-x64-gnu@1.32.0`, `lightningcss-linux-x64-musl@1.32.0`

**Pull chain:** `@vitest/coverage-v8` → `vitest` → `vite` → `lightningcss`

**Assessment:** These packages are **devDependencies only** (test coverage tooling).
They are never bundled into, nor shipped with, any published package artifact.

**No action required.** All MPL-2.0 dependencies are used unmodified as libraries,
which is fully compatible with MIT distribution.

---

## Conclusion

All packages in this monorepo can be **published freely under MIT with no
license implications**:

- Almost all runtime dependencies are under permissive licenses (MIT, Apache-2.0, ISC, BSD, BlueOak).
- `pa11y` (LGPL-3.0) and `axe-core` (MPL-2.0) are used as unmodified libraries,
  which is compatible with MIT distribution — no copyleft obligations propagate.
- Dev-only `lightningcss` (MPL-2.0) is never distributed to end-users.
- No GPL, AGPL, or other strong-copyleft licenses are present in the dependency tree.
