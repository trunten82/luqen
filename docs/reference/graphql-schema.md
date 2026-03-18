# Luqen Dashboard GraphQL API

The Luqen dashboard exposes a GraphQL API alongside the existing REST API.
Both share the same authentication layer and permission model.

## Endpoints

| Path | Purpose |
|------|---------|
| `POST /graphql` | GraphQL query / mutation endpoint |
| `GET /graphiql` | Interactive GraphiQL playground (browser) |

## Authentication

GraphQL routes are protected by the same auth guard as the REST API.
Authenticate with **one** of the following:

* **Bearer token** -- `Authorization: Bearer <jwt>`
* **API Key** -- `X-API-Key: <key>`
* **Session cookie** -- same cookie used by the web UI

Unauthenticated requests receive a `401` response.

## Permission model

Resolvers enforce permissions identically to the REST endpoints:

| Query / Mutation | Required permission(s) |
|-----------------|----------------------|
| `scans`, `scan`, `scanIssues` | Authenticated (any role) |
| `assignments` | Authenticated |
| `trends` | `trends.view` |
| `complianceSummary` | Authenticated |
| `dashboardUsers` | Any of `users.*` |
| `teams`, `team` | Authenticated |
| `organizations` | Authenticated |
| `roles` | Authenticated |
| `auditLog` | `audit.view` |
| `health` | Authenticated |
| `createScan` | `scans.create` |
| `deleteScan` | `reports.delete` |
| `assignIssue`, `updateAssignment`, `deleteAssignment` | `issues.assign` |
| `createUser` | `users.create` |
| `deleteUser` | `users.delete` |
| `activateUser`, `deactivateUser` | `users.activate` |
| `resetPassword` | `users.reset_password` |

## Schema overview

### Types

* **Scan** -- accessibility scan record (id, siteUrl, status, standard, issue counts, etc.)
* **ScanConnection** -- paginated list of scans (`nodes`, `totalCount`, `pageInfo`)
* **Issue** -- a single accessibility issue from a scan report
* **IssueConnection** -- paginated list of issues
* **Assignment** -- issue assignment (assignee, status, notes)
* **TrendPoint** -- one data point for trend charts (scanId, date, issue counts)
* **ComplianceEntry** -- latest scan summary per site URL
* **DashboardUser** -- user account (id, username, role, active)
* **Team** / **TeamMember** -- teams and their members
* **Organization** -- multi-tenant organization
* **Role** -- role definition with permission list
* **AuditEntry** / **AuditConnection** -- audit log entries
* **HealthStatus** -- system health (status, version)

### Input types

* **CreateScanInput** -- `siteUrl` (required), `standard`, `jurisdictions`
* **AssignIssueInput** -- `scanId`, `issueFingerprint`, `severity`, `message`, and optional fields

## Example queries

### List recent scans

```graphql
query {
  scans(limit: 10) {
    totalCount
    nodes {
      id
      siteUrl
      status
      totalIssues
      createdAt
    }
    pageInfo {
      hasNextPage
    }
  }
}
```

### Get a single scan with its issues

```graphql
query ($scanId: ID!) {
  scan(id: $scanId) {
    id
    siteUrl
    status
    errors
    warnings
    notices
  }
  scanIssues(scanId: $scanId, severity: "error", limit: 20) {
    totalCount
    nodes {
      code
      message
      selector
      wcagCriterion
      pageUrl
    }
  }
}
```

### Trend data for a site

```graphql
query {
  trends(siteUrl: "https://example.com") {
    completedAt
    totalIssues
    errors
    warnings
    notices
  }
}
```

### Create a scan

```graphql
mutation {
  createScan(input: { siteUrl: "https://example.com", standard: "WCAG2AA" }) {
    id
    status
    createdAt
  }
}
```

### Assign an issue

```graphql
mutation {
  assignIssue(input: {
    scanId: "abc-123"
    issueFingerprint: "fp-xyz"
    severity: "error"
    message: "Image missing alt text"
    assignedTo: "alice"
  }) {
    id
    status
    assignedTo
  }
}
```

### Query audit log

```graphql
query {
  auditLog(action: "user.create", limit: 5) {
    totalCount
    nodes {
      timestamp
      actor
      action
      resourceType
      details
    }
  }
}
```

## GraphiQL playground

When the dashboard is running, open `/graphiql` in a browser to explore the
schema interactively. You must be authenticated (e.g. logged in via the
dashboard UI or passing an API key header).
