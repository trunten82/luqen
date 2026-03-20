[Docs](../README.md) > [Integrations](./) > Power Automate

# Power Automate Integration

Connect Power Automate to the Pally Compliance Service using a custom connector with OAuth2 client credentials authentication.

---

## What this enables

- Check pa11y scan results against compliance requirements
- Look up regulations by jurisdiction
- Receive webhook notifications when compliance rules change
- Trigger compliance checks as part of automated approval workflows

---

## Prerequisites

- Power Automate Premium license (custom connectors require Premium)
- Compliance service running and accessible from the internet (or via a data gateway)

---

## Step 1: Create an OAuth client

```bash
pally-compliance clients create \
  --name "power-automate" \
  --scope "read" \
  --grant client_credentials
```

Note the `client_id` and `client_secret`.

---

## Step 2: Create a custom connector

### Option A: Import from OpenAPI

1. In Power Automate: **Data** → **Custom connectors** → **New custom connector** → **Import an OpenAPI from URL**
2. Enter: `https://your-compliance-service.example.com/api/v1/openapi.json`
3. Name it: **Pally Compliance**

### Option B: Configure manually

Go to **New custom connector** → **Create from blank**, then:

**General tab:**
- Host: `your-compliance-service.example.com`
- Base URL: `/api/v1`
- Scheme: `HTTPS`

**Security tab:**
- Authentication type: **OAuth 2.0**
- Identity provider: **Generic OAuth 2**
- Client ID: `<your client_id>`
- Client Secret: `<your client_secret>`
- Authorization URL: `https://your-compliance-service.example.com/api/v1/oauth/authorize`
- Token URL: `https://your-compliance-service.example.com/api/v1/oauth/token`
- Refresh URL: `https://your-compliance-service.example.com/api/v1/oauth/token`
- Scope: `read`

### Define actions

**Check Compliance**
- Verb: POST, Path: `/compliance/check`
- Request body: `{ "jurisdictions": ["EU"], "issues": [...] }`

**List Regulations**
- Verb: GET, Path: `/regulations`
- Query params: `jurisdictionId`, `status`, `scope`

**Get Seed Status**
- Verb: GET, Path: `/seed/status`

---

## Step 3: Test the connector

In the custom connector wizard, **Test** tab:

1. Create a new connection using your client credentials
2. Test **GetSeedStatus** — should return `{ "jurisdictions": 58, ... }`
3. Test **CheckCompliance** with a sample request

---

## Example flow: Scan → Check compliance → Notify Teams

### Flow overview

```
HTTP trigger / Recurrence
  → HTTP: call pa11y webservice
  → Parse JSON: extract issues
  → Pally Compliance — Check Compliance
  → Condition: failing > 0
    → Yes: Post message to Teams (#accessibility-alerts)
    → No: Log success
```

### Compose notification

```
Compliance Check Results for @{triggerBody()?['url']}

Summary:
- Total Jurisdictions: @{body('Check_Compliance')?['summary']?['totalJurisdictions']}
- Passing: @{body('Check_Compliance')?['summary']?['passing']}
- Failing: @{body('Check_Compliance')?['summary']?['failing']}
- Mandatory Violations: @{body('Check_Compliance')?['summary']?['totalMandatoryViolations']}
```

---

## Webhook for real-time notifications

When compliance rules change, the service can POST to your flow.

### Step 1: Create a flow with HTTP trigger

Note the HTTP POST URL from the trigger.

### Step 2: Register the webhook

```bash
TOKEN=$(curl -s -X POST https://your-compliance-service.example.com/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"client_credentials","client_id":"ADMIN_CLIENT_ID","client_secret":"ADMIN_SECRET","scope":"admin"}' \
  | jq -r '.access_token')

curl -X POST https://your-compliance-service.example.com/api/v1/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://prod-xx.westus.logic.azure.com:443/workflows/YOUR_FLOW_URL",
    "secret": "your-webhook-secret",
    "events": ["regulation.created", "regulation.updated", "update.approved"]
  }'
```

### Step 3: Verify signature in Azure Functions

```javascript
const crypto = require('crypto');

module.exports = async function (context, req) {
  const signature = req.headers['x-webhook-signature'];
  const body = JSON.stringify(req.body);
  const secret = process.env.WEBHOOK_SECRET;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(body, 'utf-8')
    .digest('hex');

  if (signature !== expected) {
    context.res = { status: 401, body: 'Invalid signature' };
    return;
  }

  context.res = { status: 200, body: { received: true } };
};
```

---

## Troubleshooting

**401 Unauthorized:** Verify client credentials and that the client has `read` scope.

**Connection test fails:** Ensure the compliance service is accessible from Power Automate data centers. For on-premises services, set up an On-Premises Data Gateway.

**"Could not retrieve swagger" error:** Verify the OpenAPI JSON is accessible at `/api/v1/openapi.json`.

---

*See also: [integrations/n8n.md](n8n.md) | [integrations/api-reference.md](api-reference.md) | [compliance/README.md](../compliance/README.md)*
