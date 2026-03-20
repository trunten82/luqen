# Licensing

## Pally Ecosystem License

All packages in this monorepo are published under the **MIT License**.

| Package | License |
|---|---|
| `@pally-agent/core` | MIT |
| `@pally-agent/compliance` | MIT |
| `@pally-agent/dashboard` | MIT |
| `@pally-agent/monitor` | MIT |

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

All other transitive runtime dependencies resolve to MIT, ISC, Apache-2.0, or BSD
variants — all of which are permissive and compatible with MIT distribution.

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
| MPL-2.0 | 3 | See note below |
| (MIT OR WTFPL) | 1 | Yes |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1 | Yes |

---

## Flagged License: MPL-2.0

**Packages:** `lightningcss@1.32.0`, `lightningcss-linux-x64-gnu@1.32.0`, `lightningcss-linux-x64-musl@1.32.0`

**Pull chain:** `@vitest/coverage-v8` → `vitest` → `vite` → `lightningcss`

**Assessment:** These packages are **devDependencies only** (test coverage tooling).
They are never bundled into, nor shipped with, any published package artifact.
Mozilla Public License 2.0 is a weak copyleft that applies only to modifications
of the MPL-licensed files themselves — it does not propagate to code that merely
uses or imports the library. Because `lightningcss` is used exclusively at
development time and is not distributed to end-users, there is **no copyleft
implication** for the MIT-licensed packages in this repo.

**No action required.** If you wish to be extra conservative, you can replace
`@vitest/coverage-v8` with `@vitest/coverage-istanbul`, which does not depend on
`lightningcss`.

---

## Conclusion

All packages in this monorepo can be **published freely under MIT with no
license implications**:

- Every runtime dependency is under a permissive license (MIT, Apache-2.0, ISC, BSD, BlueOak).
- The only copyleft dependency (`lightningcss` / MPL-2.0) is a transitive
  devDependency used exclusively in test coverage and is never distributed.
- No GPL, LGPL, AGPL, or other strong-copyleft licenses are present anywhere
  in the dependency tree.
