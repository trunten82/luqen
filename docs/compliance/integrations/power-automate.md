# Power Automate Integration

Connect Power Automate to the Pally Compliance Service using a custom connector with OAuth2 client credentials authentication.

## Overview

This integration enables Power Automate flows to:
- Check pa11y scan results against compliance requirements
- Look up regulations by jurisdiction
- Receive webhook notifications when compliance rules change
- Trigger compliance checks as part of automated approval workflows

## Prerequisites

- Power Automate Premium license (custom connectors require Premium)
- The compliance service running and accessible from the internet (or via a data gateway)
- An OAuth client created for Power Automate

## Step 1: Create an OAuth client

On the compliance service:

```bash
pally-compliance clients create \
  --name "power-automate" \
  --scope "read" \
  --grant client_credentials
```

Note the `client_id` and `client_secret`.

## Step 2: Create a custom connector

### Import the OpenAPI definition

1. In Power Automate, go to **Data** → **Custom connectors** → **New custom connector** → **Import an OpenAPI from URL**
2. Enter: `https://your-compliance-service.example.com/api/v1/openapi.json`
3. Name it: **Pally Compliance**

### Or configure manually

Go to **New custom connector** → **Create from blank**, then configure:

**General tab:**
- Host: `your-compliance-service.example.com`
- Base URL: `/api/v1`
- Scheme: `HTTPS`

**Security tab:**
- Authentication type: **OAuth 2.0**
- Identity provider: **Generic OAuth 2**
- Client ID: `<your client_id>`
- Client Secret: `<your client_secret>` (stored securely in Power Automate)
- Authorization URL: `https://your-compliance-service.example.com/api/v1/oauth/authorize`
- Token URL: `https://your-compliance-service.example.com/api/v1/oauth/token`
- Refresh URL: `https://your-compliance-service.example.com/api/v1/oauth/token`
- Scope: `read`

### Define actions

Add these actions to the connector:

#### Action: Check Compliance

- **Summary:** Check accessibility issues against jurisdictions
- **Operation ID:** `CheckCompliance`
- **Verb:** POST
- **Path:** `/compliance/check`
- **Request body schema:**
  ```json
  {
    "type": "object",
    "required": ["jurisdictions", "issues"],
    "properties": {
      "jurisdictions": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Jurisdiction IDs (e.g. EU, US, UK)"
      },
      "issues": {
        "type": "array",
        "description": "Pa11y issues array"
      },
      "sectors": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Filter by sector"
      }
    }
  }
  ```

#### Action: List Regulations

- **Summary:** List regulations by jurisdiction
- **Operation ID:** `ListRegulations`
- **Verb:** GET
- **Path:** `/regulations`
- **Query parameters:** `jurisdictionId`, `status`, `scope`

#### Action: Get Seed Status

- **Summary:** Check if baseline data is loaded
- **Operation ID:** `GetSeedStatus`
- **Verb:** GET
- **Path:** `/seed/status`

## Step 3: Test the connector

In the custom connector wizard, go to the **Test** tab:
1. Create a new connection using your client credentials
2. Test the **GetSeedStatus** action — should return `{ "jurisdictions": 8, ... }`
3. Test **CheckCompliance** with a sample request

## Example flow: Scan website → Check compliance → Notify Teams

### Flow trigger

**When an HTTP request is received** (or **Recurrence** for scheduled scans)

### Step 1: Call pa11y webservice

Action: **HTTP**
- Method: GET
- URI: `http://your-pa11y-service/results?url=https://example.com`

### Step 2: Extract issues

Action: **Parse JSON**
- Content: `@{body('HTTP')}`
- Schema: (paste pa11y response schema)

### Step 3: Check compliance

Action: **Pally Compliance — Check Compliance**
- jurisdictions: `["EU", "US", "UK"]`
- issues: `@{body('Parse_JSON')?['results']?[0]?['issues']}`
- sectors: `[]`

### Step 4: Compose notification message

Action: **Compose**
- Inputs:
  ```
  Compliance Check Results for @{triggerBody()?['url']}

  Summary:
  - Total Jurisdictions: @{body('Check_Compliance')?['summary']?['totalJurisdictions']}
  - Passing: @{body('Check_Compliance')?['summary']?['passing']}
  - Failing: @{body('Check_Compliance')?['summary']?['failing']}
  - Mandatory Violations: @{body('Check_Compliance')?['summary']?['totalMandatoryViolations']}
  ```

### Step 5: Condition — check if failing

Action: **Condition**
- Condition: `@{body('Check_Compliance')?['summary']?['failing']}` **is greater than** `0`

### If yes — Send Teams notification

Action: **Post message in a chat or channel** (Microsoft Teams)
- Team: Your team
- Channel: `#accessibility-alerts`
- Message: `@{outputs('Compose')}`
- Importance: **Urgent** (if mandatory violations)

### If no — Log success

Action: **Create item** (SharePoint) or any logging action

## Step 4: Set up webhook for real-time notifications

Register a webhook to receive notifications when compliance rules change:

### Create a flow with HTTP trigger

1. Create a new flow with trigger: **When an HTTP request is received**
2. Copy the HTTP POST URL from the trigger
3. Register the webhook on the compliance service:

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

### Verify signature in the flow

Add a **Run script** step (Power Automate Premium) or use Azure Functions to verify the HMAC-SHA256 signature before processing:

```javascript
// Signature verification in Azure Functions (called from Power Automate)
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

  // Process the webhook payload
  context.res = { status: 200, body: { received: true } };
};
```

## Connector sharing

To share the connector with your team:

1. In Power Automate, go to **Custom connectors**
2. Click **Share** on the Pally Compliance connector
3. Add team members or share with the entire organization

Each user who runs a flow with this connector needs to create their own connection (using the shared client credentials or their own).

## Troubleshooting

**401 Unauthorized:** Verify the client credentials are correct and the client has `read` scope.

**Connection test fails:** Ensure the compliance service is accessible from the Power Automate data center. If it is on-premises, set up an On-Premises Data Gateway.

**"Could not retrieve swagger" error:** Verify the OpenAPI JSON is accessible at `/api/v1/openapi.json` and is valid OpenAPI 3.1.
