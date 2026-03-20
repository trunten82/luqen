[Docs](../README.md) > [Integrations](./) > n8n

# n8n Integration

Connect n8n to the Pally Compliance Service using HTTP Request nodes with OAuth2 authentication.

---

## Prerequisites

- n8n (self-hosted or cloud)
- Compliance service running and accessible from n8n

---

## Step 1: Create an OAuth client

```bash
pally-compliance clients create \
  --name "n8n" \
  --scope "read" \
  --grant client_credentials
```

Note the `client_id` and `client_secret`.

---

## Step 2: Create OAuth2 credentials in n8n

1. **Settings** → **Credentials** → **Add Credential** → search **OAuth2 API**
2. Configure:
   - **Credential Name:** Pally Compliance
   - **Grant Type:** Client Credentials
   - **Access Token URL:** `https://your-compliance-service.example.com/api/v1/oauth/token`
   - **Client ID:** `<your client_id>`
   - **Client Secret:** `<your client_secret>`
   - **Scope:** `read`
   - **Authentication:** Body
3. Click **Connect** to verify — n8n obtains a test token.

---

## Example workflow: Compliance check after pa11y scan

### Workflow overview

```
Webhook / Schedule → HTTP Request (pa11y results)
  → Code (extract issues)
  → HTTP Request (compliance check)
  → IF (has violations)
    → Yes: Slack notification
    → No: Log success
```

### Node 1: Trigger

- Type: **Schedule Trigger**
- Expression: `0 9 * * 1` (every Monday at 9am)

### Node 2: HTTP Request — pa11y results

- Method: GET
- URL: `http://pa11y-webservice:3000/results?url=https://example.com`

### Node 3: Code — Extract issues

```javascript
const pages = $input.all();
const paResults = pages[0].json;
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

return [{ json: { issues, issueCount: issues.length } }];
```

### Node 4: HTTP Request — Compliance check

- Method: POST
- URL: `https://your-compliance-service.example.com/api/v1/compliance/check`
- Authentication: **Predefined Credential Type** → **OAuth2 API** → select "Pally Compliance"
- Body (JSON):
  ```json
  {
    "jurisdictions": ["EU", "US", "UK"],
    "issues": "={{ $json.issues }}",
    "includeOptional": false
  }
  ```

### Node 5: IF — Check for violations

- Condition: `{{ $json.summary.failing }}` **greater than** `0`

### Node 6: Slack notification

```
⚠️ Compliance violations detected!

Jurisdictions failing: {{ $json.summary.failing }}/{{ $json.summary.totalJurisdictions }}
Mandatory violations: {{ $json.summary.totalMandatoryViolations }}
```

---

## Per-jurisdiction breakdown

Add this Code node after the compliance check to iterate failing jurisdictions:

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

---

## Webhook trigger for compliance rule changes

Register an n8n webhook to receive notifications when regulations are updated.

### Step 1: Create a Webhook trigger node in n8n

Note the URL: `https://your-n8n.example.com/webhook/compliance-rules-changed`

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
    "url": "https://your-n8n.example.com/webhook/compliance-rules-changed",
    "secret": "random-32-char-secret-here",
    "events": ["regulation.updated", "update.approved"]
  }'
```

### Step 3: Verify signature in n8n (Code node)

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

---

## Credential tips

- Store the compliance service URL in n8n **Environment Variables**, not hardcoded in nodes.
- Use n8n's credential store for client secrets.
- Create a separate OAuth client per n8n environment (dev, staging, prod).

---

*See also: [integrations/power-automate.md](power-automate.md) | [integrations/api-reference.md](api-reference.md) | [compliance/README.md](../compliance/README.md)*
