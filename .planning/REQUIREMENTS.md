# Requirements: Luqen — v3.7.0 AI output quality

**Defined:** 2026-09-05
**Core Value:** AI-powered accessibility compliance that adapts to each organization's jurisdiction, regulation, and brand context — with admins in control of the whole stack through the dashboard, not config files.

**Milestone framing.** Luqen has seven LLM capabilities in production and no evaluation
infrastructure for any of them. This milestone builds the instrument for the two whose output is
DURABLE — `generate-fix` (ships into someone's source code) and `analyse-visual` (feeds a VPAT/ACR
conformance document with legal weight). The other five degrade gracefully or are read once and
discarded, and are deliberately out of scope.

**The bars below were pre-registered on 2026-09-04, BEFORE any measurement exists. They must not be
rewritten once one does.** A bar edited after its result is not a bar.

## v3.7.0 Requirements

### Reference sets — the ground truth

- [x] **EVALSET-01**: A maintainer can load a versioned reference set of real WCAG violations, each item carrying the offending source snippet, the failing success criterion, and a known-good fix
- [x] **EVALSET-02**: Every reference item records attributed provenance — where the label came from, who stands behind it, and when — and the loader REFUSES an item that has none
- [x] **EVALSET-03**: A maintainer can load a versioned labelled image set spanning photographs, charts, decorative icons and complex graphics, each with attributed alt-text ground truth
- [x] **EVALSET-04**: Every image item carries its expected VPAT-relevant verdict (issue vs pass) as explicit data, so false-pass can be COUNTED rather than inferred from a score
- [x] **EVALSET-05**: Each set contains deliberately-wrong poison items — a bad fix, a wrong alt-text — flagged as such in the data, so the harness's own scoring can be watched to fail

### Scoring runner — the instrument

- [x] **HARNESS-01**: A maintainer runs the harness against any registered model for `generate-fix` and receives per-item and aggregate scores
- [x] **HARNESS-02**: A maintainer runs the harness against any registered model for `analyse-visual` and receives per-item and aggregate scores
- [x] **HARNESS-03**: The `analyse-visual` scorer reports false-PASS and false-ISSUE counts separately, never fused into one accuracy number — the two errors have different costs
- [x] **HARNESS-04**: Every run records what its result is a function of (model id, prompt version, temperature, harness version, set version, timestamp) and the runner REFUSES to compare two runs whose function differs
- [x] **HARNESS-05**: A maintainer can see the harness score the poison items DOWN, evidenced by a committed break-test whose recorded output shows the failure — no green is trusted before this
- [x] **HARNESS-06**: The raw model response is persisted per item, so an all-empty parse is distinguishable from a genuine low score (`parseGenerateFixResponse` and `parseAnalyseVisualResponse` never throw — they return empty strings)

### Baseline — what a candidate is measured against

- [ ] **BASELINE-01**: A recorded baseline for the CURRENT production pins of both capabilities exists and is committed BEFORE any candidate model is measured
- [ ] **BASELINE-02**: A maintainer can re-run the baseline unchanged and read the harness's own run-to-run variance, so a candidate's delta can be judged against noise rather than against zero

### Decision bars — pre-registered, encoded, and enforced

- [ ] **BARS-01**: The tolerated non-inferiority margin for text capabilities is recorded in the repo before any candidate measurement, together with the number of items required to detect it
- [ ] **BARS-02**: The `analyse-visual` bar — non-inferior AND zero increase in false-pass — is encoded in the runner, which emits PASS/FAIL against it rather than leaving a reader to judge
- [ ] **BARS-03**: Every verdict the runner emits carries a REQUIRED, non-omittable power field — the bar, the measured value, the variance assumption the sample size was derived from, and the observed variance — and a run whose observed variance exceeds that assumption reports UNDERPOWERED and can never report PASS. The report must be structurally incapable of omitting the field: a rule that lives only in a plan does not fire at the moment of use

## Future Requirements

Deferred, tracked, not in this roadmap.

- **EVALSET-F1**: Reference sets for the remaining five capabilities (`extract-requirements`, `analyse-report`, `discover-branding`, `agent-conversation`, `generate-notification-content`)
- **HARNESS-F1**: Continuous/scheduled regression runs of the harness against the live pins
- **HARNESS-F2**: Harness results surfaced in the dashboard `/admin/llm` capability tabs

## Out of Scope

| Feature | Reason |
|---------|--------|
| Applying the READY-BUT-UNAPPLIED pin change in `docs/guides/llm-model-selection.md` | Blocked on the live-config permission, and this milestone must NOT become the reason to apply it early |
| Moving `analyse-visual` off gemini-2.5-flash | Held on measured evidence (n=4 is not an evidence base for a conformance input) until this harness says otherwise; not re-litigable on latency |
| Evaluating the five non-durable capabilities | They degrade gracefully or are read once and discarded — the instrument is built where a wrong answer persists |
| A new eval framework or vendor dependency | Reuse the existing capability-execution engine and provider adapters — no new frameworks (project constraint) |
| Behavioral a11y testing beyond Pa11y | Ranked next and proposed as v3.8.0 — it ADDS a capability while this milestone protects ones already relied upon |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EVALSET-01 | Phase 83 | Complete |
| EVALSET-02 | Phase 83 | Complete |
| EVALSET-03 | Phase 83 | Complete |
| EVALSET-04 | Phase 83 | Complete |
| EVALSET-05 | Phase 83 | Complete |
| HARNESS-01 | Phase 84 | Complete |
| HARNESS-02 | Phase 84 | Complete |
| HARNESS-03 | Phase 84 | Complete |
| HARNESS-04 | Phase 84 | Complete |
| HARNESS-05 | Phase 84 | Complete |
| HARNESS-06 | Phase 84 | Complete |
| BARS-01 | Phase 85 | Pending |
| BARS-02 | Phase 85 | Pending |
| BARS-03 | Phase 85 | Pending |
| BASELINE-01 | Phase 86 | Pending |
| BASELINE-02 | Phase 86 | Pending |

> **EVALSET-04 and -05: RESOLVED to Complete on 2026-09-05, after 83-02 and 83-03 merged.**
> The correction below is kept rather than deleted — it is the evidence for why the check exists,
> and a recorded verdict is not overwritten. What changed is the FACT it was guarding, not the
> judgement: the populated sets now exist (wcag-fixes.v1.json 17 items / 3 poison; image-alt.v1.json
> 13 items / 4 poison including a false-PASS), so the condition the note demanded is met and
> verified independently in 83-VERIFICATION.md. Note that BOTH the 83-01 and 83-03 executors
> declined to mark these complete from inside an isolated worktree that could not see its siblings —
> that refusal was correct, and the readiness check belongs centrally, after the merge, which is
> where it was finally run.
>
> ORIGINAL CORRECTION, 2026-09-05, retained verbatim:
> **EVALSET-04 and -05 are IN PROGRESS, not Complete.** The 83-01 executor marked both complete;
> corrected here. Both are multi-plan in the roadmap (-04 → 83-01 + 83-03, -05 → 83-01 + 83-02 +
> 83-03). 83-01 delivered the MECHANISM — `expectedVerdict` as top-level data, poison items that
> load and round-trip — against a ONE-ITEM seed of each set. The populated sets, and the required
> minimum of 3 poison items per set including a false-PASS, are 83-02 and 83-03. Marking them
> complete now would let Phase 84 read a seeded schema as a populated set.

**Coverage:**
- v3.7.0 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-05*
*Roadmap created: 2026-09-05 — 4 phases (83-86), 16/16 requirements mapped, coarse granularity*
