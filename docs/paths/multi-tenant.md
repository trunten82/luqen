[Docs](../README.md) > [Paths](./) > Multi-Tenant Organizations

# Multi-Tenant Organizations

Isolate scans, compliance data, and users across multiple organizations within a single luqen deployment.

---

## Prerequisites

- Running luqen dashboard (see [Full Dashboard](full-dashboard.md))
- Admin access to the dashboard

---

## 1. Understanding the multi-tenancy model

A fresh luqen install stores all data under a built-in `system` organization. This acts as single-tenant mode — the org layer is invisible and everything works out of the box.

Multi-tenancy activates automatically when you create your first organization. From that point:

| Concept | Behaviour |
|---------|-----------|
| **Query-level isolation** | Every data table (scans, violations, compliance records) carries an `org_id` column. Queries are scoped to the current org automatically. |
| **Global (system) data** | Data created before multi-tenancy was enabled remains under `system`. It is visible to all orgs as read-only. |
| **Per-org data** | Data created within an org is private to that org. Other orgs cannot see it. |

---

## 2. Creating organizations

### Via dashboard UI

1. Log in as an admin
2. Go to **Settings > Organizations**
3. Click **Add Organization**
4. Enter a **name** (display name) and a **slug** (URL-safe identifier, e.g. `acme-corp`)
5. Click **Create**

Each organization receives a unique slug used for identification across the system.

### Via CLI

```bash
luqen-dashboard org create --name "Acme Corp" --slug acme-corp
```

---

## 3. Managing members

Only admins can manage organization membership.

### Adding users to an organization

1. Go to **Settings > Organizations** and select the organization
2. Click **Add Member**
3. Search for an existing user by email
4. Assign a role and click **Add**

### Roles

| Role | Capabilities |
|------|-------------|
| **admin** | Manage members, configure org settings, run scans, view data |
| **member** | Run scans, view data within the org |

### Multiple org membership

Users can belong to more than one organization. Their data access is always scoped to whichever org they are currently viewing.

---

## 4. Switching organizations

When a user belongs to two or more organizations, an **org switcher** appears in the dashboard sidebar.

1. Click the org switcher in the sidebar
2. Select the target organization
3. The dashboard reloads with data scoped to the selected org

Available options in the switcher:

| Option | Description |
|--------|-------------|
| **\<Org Name\>** | View scans and data belonging to that org |
| **System (Global)** | View system-wide data across all orgs (read-only for non-system data) |

Scans launched while an org is selected are automatically associated with that org.

---

## 5. Cross-service org context

The dashboard propagates org context to backend services so that isolation is enforced end-to-end.

| Mechanism | How it works |
|-----------|-------------|
| **Dashboard → Compliance service** | The dashboard passes an `X-Org-Id` header on every request to the compliance service. |
| **Compliance query scoping** | The compliance service reads `X-Org-Id` and automatically scopes all database queries to that org. |
| **Programmatic API access** | When using API keys, set the `X-Org-Id` header to scope requests to a specific org. |

Example — scoping an API request to an organization:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
     -H "X-Org-Id: acme-corp" \
     http://localhost:5000/api/scans
```

---

## 6. Deleting an organization

Deleting an organization is a destructive action. Only admins can perform it.

1. Go to **Settings > Organizations** and select the organization
2. Click **Delete Organization**
3. Confirm the deletion

What happens on deletion:

| Item | Outcome |
|------|---------|
| Org-specific scans and compliance data | Permanently deleted |
| Global (system) data | Unaffected |
| Org members | Reassigned to the `system` organization |

---

## Troubleshooting

**"No org switcher visible"** — the current user belongs to only one organization. Add the user to a second org to enable the switcher.

**"Cannot see data from another org"** — this is expected behaviour. Data is isolated per org. Switch to the correct org using the sidebar switcher.

**"X-Org-Id header ignored"** — ensure the API key has permissions for the target org. The user associated with the key must be a member of that org.

---

## Next steps

- [Full Dashboard guide](full-dashboard.md) — setup and administration
- [Enterprise SSO](enterprise-sso.md) — connect Azure Entra ID for single sign-on
- [CLI reference](../reference/cli-reference.md) — org management commands

---

*See also: [Authentication Modes](full-dashboard.md#authentication-modes) | [Managing Users](full-dashboard.md#managing-users)*
