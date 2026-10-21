# Retrospective

## Milestone: v3.7.0 — AI output quality: eval harness + labelled reference sets

**Shipped:** 2026-09-07 (gap-closed and archived 2026-09-28)
**Phases:** 4 (83-86) | **Plans:** 15 | **Quick tasks:** 1 (260928-863)

### What Was Built
- Provenance-attributed reference sets with poison items; a loader that refuses unattributed items.
- A scoring harness that was watched scoring poison down before any green result was trusted.
- Decision bars pre-registered alone in bf7ea66d, an ancestor of every commit that can judge.
- Live baselines of the production pins, now consumable by `eval verdict --replication`.

### What Worked
- Pre-registration as an ordering guarantee, checkable from git ancestry rather than asserted.
- Labelling every figure measured / computed / concluded: it is what let the Phase 86 verifier catch
  "Measured power" on a number computed under an assumed variance.
- Handing the verifier claims to USE, not facts to assume: it contradicted three of them usefully.

### What Was Inefficient
- The milestone was reported verified without checking that EVERY phase carried a verification record;
  Phase 86 had none, and the gap it would have found (the CLI never consumed the measurement) sat in
  production for three weeks.
- A handoff between plans with no third artifact recording it: 86-01 handed the wiring to 86-03, which
  never picked it up; 86-04 noticed and handed it to 86-05, which dropped it.

### Patterns Established
- A fix that wires a measurement into a verdict must re-check what the verdict's licence text now
  claims — wiring `--replication` alone would have made the qualifier over-claim a false-PASS clause.
- Break-tests with pre-declared red sets; a mutation that reddens nothing is a finding (break-test E
  exposed a clause no test could watch — fixed with a dedicated watcher).

### Key Lessons
- Verify the SET, not the members you remember.
- Tool exit codes are not evidence: `gsd-sdk query audit-open acknowledge` exits 0 while doing nothing.
- A pre-registered bar can turn out to sit inside the instrument's own noise; the answer is disclosure
  and a NEW pre-registered bar, never moving the old one.

## Milestone: v3.8.0 — Mark as false positive

**Shipped:** 2026-10-13 · **Phases:** 3 (87-89) · **Plans:** 35 + quick 261013-dr7

### What Was Built
Per-org dismissal store with history/audit; dismissals applied on every count, export, ACR and bypass surface and on later scans;
mark/revoke UI with preview and a Dismissed section in 6 locales; dark launch, owner review on a prod test org, then Owner/Admin grant.

### What Worked
- Dark launch + read-back instrument: the permission's reach was measured on prod copies before and after the grant.
- Owner decisions recorded verbatim with their channel; the grant waited for a direct OK.

### What Was Inefficient
- An executor reported green while an e2e test was red (89-04): per-plan verification ran a subset, not the suite.
- The phase's own code review found a CRITICAL pre-existing role-shadowing bug only at the end; the read-back instrument could not see it.

### Key Lessons
- A "lift the dark filter" change widens every pre-existing path to the permission; review those paths before the lift, not after.
- Read-back instruments must check reserved-name shadowing independently of their allow flags.

## Milestone: v3.9.0 — Dismissal follow-through

**Shipped:** 2026-10-21
**Phases:** 3 | **Plans:** 57 (+ 1 quick task)

### What Was Built
- GraphQL `createScan` starts real scans through the shared scan-start path (Phase 90).
- Dismissal and permission hardening across scan start/delete, CSRF, role scope, API-key attribution, sessions, MCP tokens, consent and trusted proxies (Phase 91, four PRs plus a verification-found closure).
- A false-positive dismissal guide, every procedure executed cold by a non-author agent (Phase 92).

### What Worked
- A code-review gate before every PR ship: every PR's review found live defects that tests and deliberate breaks had missed.
- Bounding the re-review loop with an explicit ship rule. Only withdrawn-action execution, cross-user or cross-org access, active data loss or a crash on a normal path blocks; everything else is recorded for later.
- Phase verification after shipping found one remaining gap (brand drilldown selectors) that every review had missed.
- Cold reads with per-dispatch nonces: three RED reads each found real wrong steps, and the confirmation read came back green.

### What Was Inefficient
- PR4 needed seven gap plans (91-22b..h). Edit and retry kept yielding one more interacting path per review round.
- Several guard checks could not fail until a break run showed it (docs lint placeholders, label coverage, ownership counts).
- Owner-question status was reported from plan text instead of the recorded answers, which needed a retraction.

### Patterns Established
- Break every new guard and read the red set by test NAME; declared red set must equal observed.
- Production gates read a backup copy of the database, never the live file, and print counts only.
- Docs are verified by the reader who will execute them, not by the author.

### Key Lessons
- A defaults-only deploy behind a CDN can make every client look like the CDN edge. Measure the audit address against real egress after deploy.
- Check the answers section before listing a question as open.
