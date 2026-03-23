# Manual Browser Tests

Minimal set of tests that **require user input** via the browser UI.
Everything else is covered by automated integration tests.

## Prerequisites

- Dashboard running at http://localhost:5000
- Compliance service running at http://localhost:4000
- Pa11y webservice at http://localhost:3000

---

## Tests Requiring User Input (7 tests)

### 1. First-Time Setup
- [ ] Open http://localhost:5000 in a fresh browser
- [ ] Verify the API key is shown on first visit (solo mode)
- [ ] Copy the API key — confirm it works in subsequent requests

### 2. Team Mode Login
- [ ] Create a user via CLI: `node dist/cli.js user create --username testuser --password "Test123!@#" --role admin`
- [ ] Open /login — verify team mode login form appears
- [ ] Enter credentials, submit — verify redirect to dashboard
- [ ] Verify username appears in top-right corner

### 3. Run a Scan (UI)
- [ ] Click "New Scan" button
- [ ] Enter URL: `https://example.com`
- [ ] Select standard: WCAG 2.1 AA
- [ ] Click "Start Scan"
- [ ] Verify SSE progress events appear (pages discovered, scanning, complete)
- [ ] Verify report page loads with issues table

### 4. Change Password
- [ ] Go to /account
- [ ] Enter current password, new password, confirm
- [ ] Submit — verify "Password changed successfully"
- [ ] Logout, login with new password — verify success

### 5. Switch Language
- [ ] Go to /account
- [ ] Change locale to Italian (it)
- [ ] Verify UI labels change
- [ ] Change back to English

### 6. Organization Switching
- [ ] Create an org via admin panel
- [ ] Add yourself as a member
- [ ] Use org switcher in header
- [ ] Verify scans are scoped to the selected org

### 7. SSO Login (if Entra configured)
- [ ] Configure auth-entra plugin with Azure credentials
- [ ] Click "Sign in with Microsoft"
- [ ] Complete Azure login flow
- [ ] Verify redirect back to dashboard with correct user/groups

---

## Tests Automated (NOT requiring browser)

These are ALL covered by integration tests — do NOT retest manually:

- API authentication (API key, session validation)
- Scan creation, polling, completion via API
- Report viewing via API
- CSV/Excel/PDF export
- Schedule CRUD
- Assignment/team/role management
- Jurisdiction/regulation management
- Plugin install/configure/activate
- Redis queue and pub/sub
- SMTP connection test and email sending
- Compliance API integration (OAuth, jurisdictions, compliance check)
- Data API pagination, filtering, org isolation
- Rate limiting
- SSRF blocking
- RBAC permission enforcement
- Multi-tenancy data segregation
