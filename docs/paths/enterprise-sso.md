[Docs](../README.md) > [Paths](./) > Enterprise SSO

# Enterprise SSO — Azure Entra ID

Connect the dashboard to Azure Entra ID (formerly Azure AD) for single sign-on via OIDC/MSAL.

---

## Prerequisites

- Running pally-agent dashboard (see [Full Dashboard](full-dashboard.md))
- Admin access to the dashboard
- An Azure Entra ID tenant with permission to register applications

---

## 1. Register an application in Azure Entra ID

1. Go to **Azure Portal > Microsoft Entra ID > App registrations > New registration**
2. Name: `pally-agent-dashboard`
3. Supported account types: choose your tenant model (single-tenant or multi-tenant)
4. Redirect URI: `http://localhost:5000/auth/sso/callback` (adjust host/port for production)
5. Click **Register**

Note the following values from the app overview page:

| Value | Where to find it |
|-------|------------------|
| **Tenant ID** | Overview > Directory (tenant) ID |
| **Client ID** | Overview > Application (client) ID |

6. Go to **Certificates & secrets > New client secret**
7. Copy the secret **Value** (shown only once)

---

## 2. Install the Entra plugin

### Via dashboard UI

1. Log in as an admin
2. Go to **Settings > Plugins**
3. Find **Azure Entra ID** in the Plugin Registry tab
4. Click **Install**

### Via CLI

```bash
pally-dashboard plugin install @pally-agent/plugin-auth-entra
```

---

## 3. Configure the plugin

### Via dashboard UI

1. Click the installed **Azure Entra ID** plugin
2. Fill in the configuration fields:

| Field | Value |
|-------|-------|
| Tenant ID | Your Azure tenant ID |
| Client ID | The application (client) ID from step 1 |
| Client Secret | The client secret value from step 1 |
| Redirect URI | `http://localhost:5000/auth/sso/callback` |

3. Click **Save**

### Via CLI

```bash
pally-dashboard plugin configure <plugin-id> \
  --set tenantId=YOUR_TENANT_ID \
        clientId=YOUR_CLIENT_ID \
        clientSecret=YOUR_CLIENT_SECRET \
        redirectUri=http://localhost:5000/auth/sso/callback
```

Secret fields (client secret) are encrypted with AES-256-GCM before storage.

---

## 4. Activate the plugin

### Via dashboard UI

Click **Activate** on the plugin card. The system runs a health check to confirm connectivity to the Entra ID tenant.

### Via CLI

```bash
pally-dashboard plugin activate <plugin-id>
```

---

## 5. Test SSO login

1. Open the dashboard login page (`http://localhost:5000/login`)
2. A **Sign in with Azure Entra ID** button appears alongside the standard login form
3. Click the button — you are redirected to Microsoft's login page
4. Authenticate with your Entra ID credentials
5. On successful authentication, you are redirected back to the dashboard and logged in

Users authenticated via SSO are matched by email address. If no dashboard user exists for the email, one is created automatically with the `user` role. Admins can promote SSO users to `admin` from the user management page.

---

## Production considerations

- Use HTTPS for the redirect URI in production
- Set the redirect URI to match your public dashboard URL exactly
- Restrict the Azure app registration to your tenant unless multi-tenant access is intended
- Rotate the client secret before it expires (Azure default: 6 months)

---

## Troubleshooting

**"SSO button not visible"** — the Entra plugin is not installed or not activated. Check **Settings > Plugins**.

**"Redirect URI mismatch"** — the redirect URI configured in the plugin must exactly match one of the redirect URIs registered in Azure. Check both locations.

**"User not authorized"** — the SSO user's email does not have a dashboard account and auto-provisioning may be disabled. Create the user manually or enable auto-provisioning in plugin settings.

---

## Next steps

- [Full Dashboard guide](full-dashboard.md) — setup and administration
- [Dashboard configuration](../reference/dashboard-config.md) — environment variables and config file
- [CLI reference](../reference/cli-reference.md) — plugin management commands

---

*See also: [Authentication Modes](full-dashboard.md#authentication-modes) | [Managing Plugins](full-dashboard.md#managing-plugins)*
