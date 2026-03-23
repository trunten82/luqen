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
| `@fastify/rate-limit` | MIT | Rate-limiting plugin |
| `@fastify/swagger` | MIT | OpenAPI plugin |
| `@fastify/swagger-ui` | MIT | Swagger UI plugin |
| `@fastify/formbody` | MIT | Form-body parser |
| `@fastify/secure-session` | MIT | Session management |
| `@fastify/static` | MIT | Static file serving |
| `@fastify/view` | MIT | Template rendering |
| `handlebars` | MIT | HTML template engine |
| `better-sqlite3` | MIT | Embedded SQLite driver |
| `jose` | MIT | JWT / JWK cryptography |
| `bcrypt` | MIT | Password hashing |
| `ioredis` | MIT | Redis client |
| `commander` | MIT | CLI argument parsing |
| `zod` | MIT | Schema validation |
| `cheerio` | MIT | HTML parsing / scraping |
| `xml2js` | MIT | XML parsing |
| `robots-parser` | MIT | robots.txt parsing |
| `@modelcontextprotocol/sdk` | MIT | MCP server/client SDK |
| `mongodb` | Apache-2.0 | Optional MongoDB adapter |
| `pg` | MIT | Optional PostgreSQL adapter |
| `pa11y` | LGPL-3.0 | Accessibility scanner (used as a library — LGPL permits this without copyleft obligations) |
| `axe-core` | MPL-2.0 | Accessibility test runner (used as a library — MPL file-level copyleft does not propagate) |
| `pdfkit` | MIT | PDF document generation |

All of the above are compatible with MIT when used as libraries (linked/imported, not
modified and redistributed). All other transitive runtime dependencies resolve to MIT,
ISC, Apache-2.0, or BSD variants — all of which are permissive and compatible with MIT
distribution.

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
