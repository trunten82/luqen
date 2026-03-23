# @luqen/dashboard

Web dashboard for viewing and managing luqen accessibility scan results.

## Key Features

- **GraphQL API** — Query scans, issues, compliance data, users, teams, and more via `/graphql`. Interactive GraphiQL playground at `/graphiql`.
- **Multi-language UI (i18n)** — Dashboard available in 6 languages (EN, IT, ES, FR, DE, PT) with a sidebar language switcher.
- **Pluggable StorageAdapter** — modular data layer with 14 domain repositories; SQLite built-in, PostgreSQL and MongoDB adapters planned as plugins
- HTMX-powered server-rendered UI with no JavaScript build step
- Role-based access control with granular permissions
- Plugin system for auth, notifications, and storage
- Multi-tenancy with org-level data isolation
- Real-time scan progress via Server-Sent Events
- PDF and CSV report export

## Install

```bash
npm install @luqen/dashboard
```

## Usage

```bash
npx luqen-dashboard serve
```

## Documentation

See the [main repository](https://github.com/trunten82/luqen) for full documentation.

## License

MIT
