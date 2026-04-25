[Docs](../README.md) > [Deployment](./) > Installer Env Vars

# Installer Environment Variables

Authoritative list of every environment variable the Luqen installer
scripts (`install.sh`, `install.command`, `install.ps1`) read or set.
Sorted alphabetically. Sourced from
[`.planning/phases/40-documentation-sweep/40-03-DELTA.md`](../../.planning/phases/40-documentation-sweep/40-03-DELTA.md)
and the patched installer scripts.

Last reviewed for **v3.1.0** (Phase 40 / DOC-03) — head migration 061.

| Env Var | Default | Required? | Purpose | Introduced In |
|---------|---------|-----------|---------|---------------|
| `BRANDING_API_KEY` | (generated) | No | Static API key for the branding service. Falls back to OAuth client credentials. | v2.7.0 |
| `BRANDING_PORT` | `4100` | No | Port the branding service listens on. | v2.7.0 |
| `BRANDING_PUBLIC_URL` | `http://localhost:${BRANDING_PORT}` | Yes (production) | External URL the branding service advertises. Used by the dashboard for inter-service auth and MCP discovery. | v3.0.0 (Phase 29) |
| `COMPLIANCE_API_KEY` | (generated) | No | Static API key for the compliance service. | v2.0 |
| `COMPLIANCE_LLM_CLIENT_ID` | (generated) | No | OAuth client id used by the compliance service to call the LLM service. | v2.7.0 |
| `COMPLIANCE_LLM_CLIENT_SECRET` | (generated) | No | OAuth client secret matching `COMPLIANCE_LLM_CLIENT_ID`. | v2.7.0 |
| `COMPLIANCE_LLM_URL` | `${LLM_PUBLIC_URL}` | No | LLM service URL the compliance service should call. Falls back to local default. | v2.7.0 |
| `COMPLIANCE_PORT` | `4000` | No | Port the compliance service listens on. | v2.0 |
| `COMPLIANCE_PUBLIC_URL` | `http://localhost:${COMPLIANCE_PORT}` | Yes (production) | External URL the compliance service advertises. | v3.0.0 (Phase 29) |
| `DASHBOARD_COMPLIANCE_CLIENT_ID` | (generated) | No | OAuth client id used by the dashboard to call compliance. | v2.0 |
| `DASHBOARD_COMPLIANCE_CLIENT_SECRET` | (generated) | No | OAuth client secret. | v2.0 |
| `DASHBOARD_COMPLIANCE_URL` | `${COMPLIANCE_PUBLIC_URL}` | No | Compliance URL the dashboard should call. | v2.0 |
| `DASHBOARD_JWKS_URI` | `${DASHBOARD_PUBLIC_URL}/oauth/.well-known/jwks.json` | Yes (when MCP enabled) | JWKS endpoint for verifying RS256 access tokens. Aliased by `DASHBOARD_JWKS_URL`. | v3.0.0 (Phase 31.1) |
| `DASHBOARD_JWKS_URL` | `${DASHBOARD_PUBLIC_URL}/oauth/.well-known/jwks.json` | Yes (when MCP enabled) | Alias of `DASHBOARD_JWKS_URI`. Older code paths read this name. | v3.0.0 (Phase 31.1) |
| `DASHBOARD_JWT_PUBLIC_KEY` | (empty) | No | PEM-encoded RS256 public key, alternative to JWKS. Literal `\n` sequences are converted to real newlines for single-line env form. Use only if your environment cannot reach the JWKS endpoint. | v3.0.0 (Phase 28) |
| `DASHBOARD_PORT` | `5000` | No | Port the dashboard listens on. | v2.0 |
| `DASHBOARD_PUBLIC_URL` | `http://localhost:${DASHBOARD_PORT}` | Yes (production) | External URL the dashboard advertises (OAuth issuer, MCP discovery, share-link permalinks). MUST match what external clients hit. | v3.0.0 (Phase 30) |
| `DASHBOARD_SESSION_SECRET` | (generated) | Yes | 64-hex-char secret for session cookie signing. Auto-generated if absent. | v2.0 |
| `DASHBOARD_WEBSERVICE_URL` | (unset) | No | Optional external pa11y webservice URL. Falls back to the built-in pa11y library. | v2.0 |
| `DASHBOARD_WEBSERVICE_URLS` | (unset) | No | Comma-separated list of pa11y URLs for horizontal scaling. | v2.10.0 |
| `LLM_API_KEY` | (generated) | No | Static API key for the LLM service. | v2.7.0 |
| `LLM_PORT` | `4200` | No | Port the LLM service listens on. | v2.7.0 |
| `LLM_PUBLIC_URL` | `http://localhost:${LLM_PORT}` | Yes (production) | External URL the LLM service advertises. | v3.0.0 (Phase 29) |
| `NODE_ENV` | `production` | No | Set by every systemd / launchd / NSSM unit the installer creates. | v2.0 |
| `OAUTH_KEY_MAX_AGE_DAYS` | `90` | No | Maximum age before an OAuth signing key is rotated by the dashboard's bootstrap sweep. Increase or decrease per security policy. | v3.0.0 (Phase 31.1) |
| `OLLAMA_BASE_URL` | (LLM service default) | No | Ollama daemon URL. Only meaningful if the LLM service is configured to use the Ollama provider. | LLM follow-up |
| `LUQEN_INSTALL_DIR` | `${HOME}/luqen` | No | Override target directory for `install.command`. | v3.1.0 (DOC-03) |
| `LUQEN_INSTALL_REEXEC` | (set by installer) | No | Internal flag used by `install.sh` and `install.command` to detect re-execution from `curl | bash` form. Do not set manually. | v2.7.0 |

## Notes

- All ports may be overridden via the wizard or CLI flags.
- All `*_PUBLIC_URL` values default to `http://localhost:<port>` for
  development. Set explicit hostnames for production so OAuth issuer
  metadata and share-link permalinks resolve correctly off-localhost.
- `DASHBOARD_JWT_PUBLIC_KEY` is mutually exclusive with `DASHBOARD_JWKS_URI`
  in normal use — pick one. JWKS is preferred (auto-rotates with the
  signing key sweep).
- For Docker installs the same variables live in the generated
  `${INSTALL_DIR}/.env` file rather than systemd / launchd unit files.

## Related documentation

- [Installer changelog](./installer-changelog.md) — per-version delta of
  what each Luqen release added to the installer surface.
- [Installation guide](../getting-started/installation.md) — end-to-end
  install walkthrough.
