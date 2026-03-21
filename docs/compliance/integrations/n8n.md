# n8n Integration

Connect n8n to the Luqen Compliance Service using HTTP Request nodes with OAuth2 authentication.

## Prerequisites

- n8n (self-hosted or cloud)
- Compliance service running and accessible from n8n
- OAuth client created for n8n

## Step 1: Create an OAuth client

On the compliance service:

```bash
luqen-compliance clients create \
  --name "n8n" \
  --scope "read" \
  --grant client_credentials
```

Note the `client_id` and `client_secret`.

## Step 2: Create OAuth2 credentials in n8n

1. In n8n, go to **Settings** → **Credentials** → **Add Credential**
2. Search for **OAuth2 API**
3. Configure:
   - **Credential Name:** Luqen Compliance
   - **Grant Type:** Client Credentials
   - **Access Token URL:** `https://your-compliance-service.example.com/api/v1/oauth/token`
   - **Client ID:** `<your client_id>`
   - **Client Secret:** `<your client_secret>`
   - **Scope:** `read`
   - **Authentication:** Body

4. Click **Connect** to verify — n8n will obtain a test token.

## Step 3: Example workflow — check compliance after pa11y scan

### Workflow overview

```
Webhook trigger → HTTP Request (pa11y scan results) →
Code (extract issues) → HTTP Request (compliance check) →
IF (has violations) → Slack/Email notification
```

### Node 1: Trigger

Type: **Webhook** or **Schedule Trigger**

For scheduled checks:
- Trigger Type: **Cron**
- Expression: `0 9 * * 1` (every Monday at 9am)

### Node 2: HTTP Request — Get pa11y results

- Node type: **HTTP Request**
- Method: GET
- URL: `http://pa11y-webservice:3000/results?url=https://example.com`
- Response Format: JSON

### Node 3: Code — Extract pa11y issues

- Node type: **Code**
- Language: JavaScript

```javascript
// Extract issues from pa11y webservice response
const pages = $input.all();
const paResults = pages[0].json;

// pa11y webservice returns array of results per page
const issues = [];
for (const page of paResults) {
  if (page.results && page.results.issues) {
    for (const issue of page.results.issues) {
      issues.push({
        code: issue.code,
        type: issue.type,
        message: issue.message,
        selector: issue.selector,
        context: issue.context,
        url: page.url,
      });
    }
  }
}

return [{
  json: {
    issues,
    issueCount: issues.length,
  }
}];
```

### Node 4: HTTP Request — Compliance check

- Node type: **HTTP Request**
- Method: POST
- URL: `https://your-compliance-service.example.com/api/v1/compliance/check`
- Authentication: **Predefined Credential Type** → **OAuth2 API** → select "Luqen Compliance"
- Content Type: JSON
- Body (JSON):
  ```json
  {
    "jurisdictions": ["EU", "US", "UK"],
    "issues": "={{ $json.issues }}",
    "includeOptional": false
  }
  ```

### Node 5: IF — Check for violations

- Node type: **IF**
- Condition: `{{ $json.summary.failing }}` **greater than** `0`

### Node 6a (true): Slack notification

- Node type: **Slack**
- Resource: Message
- Operation: Post
- Channel: `#accessibility-alerts`
- Text:
  ```
  ⚠️ Compliance violations detected!

  Jurisdictions failing: {{ $json.summary.failing }}/{{ $json.summary.totalJurisdictions }}
  Mandatory violations: {{ $json.summary.totalMandatoryViolations }}

  Check the full report: https://your-dashboard.example.com/compliance
  ```

### Node 6b (false): Success log

- Node type: **Set** or logging node
- Note that the check passed cleanly

## Step 4: More complex workflow — per-jurisdiction breakdown

Add this node after the compliance check to create one Slack message per failing jurisdiction:

### Node: Split Out — iterate jurisdictions

- Node type: **Code**

```javascript
const complianceResult = $input.first().json;
const failingJurisdictions = [];

for (const [jurisdictionId, result] of Object.entries(complianceResult.matrix)) {
  if (result.status === 'fail') {
    failingJurisdictions.push({
      jurisdictionId,
      jurisdictionName: result.jurisdictionName,
      mandatoryViolations: result.mandatoryViolations,
      regulations: result.regulations
        .filter(r => r.status === 'fail')
        .map(r => `${r.shortName} (${r.violations.length} violations)`)
        .join(', '),
    });
  }
}

return failingJurisdictions.map(j => ({ json: j }));
```

### Node: Slack — one message per jurisdiction

This node now runs once per failing jurisdiction:
```
⚠️ {{ $json.jurisdictionName }} ({{ $json.jurisdictionId }}): FAILING

Mandatory violations: {{ $json.mandatoryViolations }}
Affected regulations: {{ $json.regulations }}
```

## Step 5: Workflow to list regulations

A simple workflow to look up regulations for a jurisdiction:

### HTTP Request node

- Method: GET
- URL: `https://your-compliance-service.example.com/api/v1/regulations`
- Authentication: OAuth2 API (Luqen Compliance)
- Query Parameters:
  - `jurisdictionId`: `EU`
  - `status`: `active`

### Code node — format results

```javascript
const response = $input.first().json;

return response.data.map(reg => ({
  json: {
    id: reg.id,
    name: reg.name,
    shortName: reg.shortName,
    enforcementDate: reg.enforcementDate,
    scope: reg.scope,
    sectors: reg.sectors.join(', '),
  }
}));
```

## Credential management tips

- Store the compliance service URL in n8n's **Environment Variables** rather than hardcoding it in nodes.
- Use n8n's built-in credential store for client secrets — never paste secrets directly in node configurations.
- Create a separate OAuth client per n8n environment (dev, staging, prod) to track usage separately.

## Webhook trigger for compliance rule changes

To trigger an n8n workflow when compliance rules change:

### Step 1: Create a Webhook trigger node in n8n

- Note the webhook URL: `https://your-n8n.example.com/webhook/compliance-rules-changed`

### Step 2: Register the webhook on the compliance service

```bash
TOKEN=$(curl -s -X POST https://your-compliance-service.example.com/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"client_credentials","client_id":"ADMIN_CLIENT_ID","client_secret":"ADMIN_SECRET","scope":"admin"}' \
  | jq -r '.access_token')

curl -X POST https://your-compliance-service.example.com/api/v1/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-n8n.example.com/webhook/compliance-rules-changed",
    "secret": "random-32-char-secret-here",
    "events": ["regulation.updated", "update.approved"]
  }'
```

### Step 3: Verify signature in n8n

Add a **Code** node before your processing nodes:

```javascript
const crypto = require('crypto');

const signature = $input.first().headers['x-webhook-signature'];
const body = JSON.stringify($input.first().json);
const secret = 'your-webhook-secret'; // use n8n credential instead

const expected = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(body, 'utf-8')
  .digest('hex');

if (signature !== expected) {
  throw new Error('Invalid webhook signature');
}

return $input.all();
```
