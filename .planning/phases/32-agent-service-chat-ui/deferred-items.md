## Pre-existing test failures found before Plan 32-04 execution (2026-04-20)

These 6 tests fail on master BEFORE any Plan 32-04 changes. Logged per Plan 32-04 SCOPE BOUNDARY — out of scope for this executor.

- tests/mcp/data-tools.test.ts (2 failures): 'caller with all three required permissions sees the 6 data tools' and 'caller with only scans.create sees dashboard_scan_site'. Reason: scope-filter requires write tier for .create permissions, test uses scopes:['read'] which only grants read-tier. Tests appear stale vs current scope-filter rules.
- tests/mcp/admin-tools.test.ts (3 failures): 'all 19 tools visible', 'admin.users only → 4 user tools', 'admin.system + admin.org → 9 tools'. Same scope-filter vs test expectation mismatch.
- tests/mcp/http.test.ts (1 failure): 'Case 4: valid Bearer + tools/list returns the 6 dashboard data tools'. Same root cause.

These tests are unrelated to Plan 32-04 changes and affect pre-existing MCP tool-list gating logic, not agent-service code. Recommend follow-up plan to update scope expectations (admin.users/admin.system are already classified as write-tier, but .view perms need read; the 'read' scope alone may be too restrictive for mixed-permission tests).
