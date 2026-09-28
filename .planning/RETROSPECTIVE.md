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
