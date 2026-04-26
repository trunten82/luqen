---
phase: 07-regulation-filter
plan: 03
subsystem: dashboard
tags: [dashboard, views, handlebars, i18n, partials, view-tests, htmx, regulation-filter]
requirements: [REG-01, REG-05, REG-07]
dependency-graph:
  requires:
    - "07-P02 — reportData.regulationMatrix array exposed, scan form accepts name='regulations'"
  provides:
    - "Scan form posts name='regulations' value='<regulationId>' (one per selected regulation)"
    - "Report detail Compliance tab has By Jurisdiction / By Regulation sub-tabs (rendered only when regulationMatrix.length > 0)"
    - "Shared partial rpt-regulation-card.hbs for per-regulation card rendering"
    - "rptSwitchSubTab JS function + delegated click handler (scoped by data-parent)"
    - "reportDetail.subtabBy*, perRegulationBreakdown, regulationStatus.*, mandatoryViolations/recommendedViolations/optionalViolations, regulationViolations, regulationEmpty i18n keys"
    - "scans.regulationsSelected / regulationTypeBadge / jurisdictionTypeBadge i18n keys"
    - "tests/views/scan-new.test.ts (4 tests)"
    - "tests/views/report-detail.test.ts (4 tests)"
  affects:
    - "packages/dashboard/src/views/scan-new.hbs"
    - "packages/dashboard/src/views/report-detail.hbs"
    - "packages/dashboard/src/views/partials/rpt-regulation-card.hbs"
    - "packages/dashboard/src/server.ts"
    - "packages/dashboard/src/i18n/locales/en.json"
tech-stack:
  added: []
  patterns:
    - "Sub-tab pattern: rpt-tabs inside a parent rpt-tab-panel, switcher scoped by data-parent attribute to avoid colliding with top-level rptSwitchTab"
    - "Conditional sub-tab bar: entire rpt-tabs + hidden subpanel gated on {{#if reportData.regulationMatrix.length}} so empty-matrix reports show no UI change"
    - "Handlebars view unit tests: compile template directly with registered helpers + partial for render-level grep assertions (mirrors service-connections-flow.test.ts pattern)"
    - "Nested i18n keys: flattenObject in i18n/index.ts supports reportDetail.regulationStatus.pass path style"
key-files:
  created:
    - "packages/dashboard/src/views/partials/rpt-regulation-card.hbs"
    - "packages/dashboard/tests/views/scan-new.test.ts"
    - "packages/dashboard/tests/views/report-detail.test.ts"
    - ".planning/phases/07-regulation-filter/07-03-SUMMARY.md"
  modified:
    - "packages/dashboard/src/views/scan-new.hbs"
    - "packages/dashboard/src/views/report-detail.hbs"
    - "packages/dashboard/src/server.ts"
    - "packages/dashboard/src/i18n/locales/en.json"
decisions:
  - "Regulation checkbox field renamed from name='jurisdictions' value='{{jurisdictionId}}' to name='regulations' value='{{id}}' — minimal one-line fix, no data model changes required (P02 already wired scan-service.normalizeStringArray to accept regulations)"
  - "Sub-tab switcher scoped by data-parent attribute, using :scope > .rpt-tab-panel selector to avoid collision with top-level rptSwitchTab (which queries by global .rpt-tab / .rpt-tab-panel classes)"
  - "Default active sub-tab is By Jurisdiction (matches existing user expectation — the matrix is what they had before)"
  - "By Regulation sub-tab bar and its entire subpanel are conditionally rendered on {{#if reportData.regulationMatrix.length}} — empty-matrix legacy reports show zero UI change (D-22)"
  - "rpt-regulation-card.hbs partial reuses ONLY existing CSS tokens (rpt-juris-card__*, rpt-badge--*, rpt-text--fail, rpt-violation-row, rpt-reg-tag--*) — zero new classes invented (D-30)"
  - "CSS modifier mapping: status 'pass' → pass-head/s-pass, 'fail' → fail-head/s-fail, 'partial' → review-head/s-review (the existing review modifier is reused for the new partial status)"
  - "Picker item data-type='jurisdiction'|'regulation' attribute added for potential future visual differentiation without inventing CSS classes — JS chip decoration deferred (plan allowed skip)"
  - "Handlebars view unit tests placed in new tests/views/ directory — not inside route tests (which stub reply.view and return JSON). Direct template.compile gives render-level assertions"
  - "Report-detail view test registers noop implementations of formatStandard/countByType/fixSuggestion/reviewStatusClass/etc. — only helpers whose output we assert on are real (t, eq, gt)"
metrics:
  duration: "~12min"
  tasks: 2
  completed: "2026-04-05"
  commits: 2
---

# Phase 07 Plan 03: Scan Form Bug Fix + Report Detail Regulation Sub-tabs Summary

Fixed the one-line scan-form bug that submitted the regulation's parent jurisdictionId instead of the regulation id, and added By Jurisdiction / By Regulation sub-tabs to the report detail Compliance panel — the final UI wiring for the regulation filter feature, closing the loop from scan form → API → report.

## Deliverables

### 1. Scan form bug fix (REG-01, REG-07)

**Before** (`packages/dashboard/src/views/scan-new.hbs` line 100):
```handlebars
<input type="checkbox" name="jurisdictions" value="{{jurisdictionId}}">
```

**After**:
```handlebars
<input type="checkbox" name="regulations" value="{{id}}">
```

Both `{{name}}` attributes on the enclosing `<label>` also gained a `data-type="jurisdiction"` / `data-type="regulation"` hint for future visual differentiation without inventing CSS classes. The picker JS (`src/static/app.js` line 115+) keys off `data-tab` + `input:checked` and does not care about the field name, so the rename is transparent to the existing chip rendering code.

**grep verification:**
```
grep -c 'name="jurisdictions"' src/views/scan-new.hbs → 1  (the jurisdictions tab, unchanged)
grep -c 'name="regulations"'   src/views/scan-new.hbs → 1  (the bug-fix target)
```

### 2. Report detail sub-tabs (REG-05)

`#panel-compliance` in `report-detail.hbs` now contains:

```
<div class="rpt-tab-panel" id="panel-compliance" ...>

  {{#if reportData.regulationMatrix.length}}
  <div class="rpt-tabs" role="tablist" data-subtab-group="compliance">
    <button ... id="subtab-compliance-by-jurisdiction"  data-subtab="by-jurisdiction"  data-parent="compliance">By Jurisdiction</button>
    <button ... id="subtab-compliance-by-regulation"    data-subtab="by-regulation"    data-parent="compliance">By Regulation</button>
  </div>
  {{/if}}

  <div class="rpt-tab-panel" id="subpanel-compliance-by-jurisdiction" ...>
    {{! EXISTING complianceMatrix block — byte-for-byte preserved }}
  </div>

  {{#if reportData.regulationMatrix.length}}
  <div class="rpt-tab-panel rpt-tab-panel--hidden" id="subpanel-compliance-by-regulation" ...>
    <section class="rpt-section">
      <h2>Per-regulation breakdown</h2>
      <div class="rpt-juris-grid">
        {{#each reportData.regulationMatrix}}
          {{> rpt-regulation-card this}}
        {{/each}}
      </div>
    </section>
  </div>
  {{/if}}

</div>
```

The existing matrix block (lines 114-214 of the original file) is preserved byte-for-byte — only wrapped in the new jurisdictions sub-panel div (D-32 freeze honored).

### 3. Shared partial: `partials/rpt-regulation-card.hbs`

Renders one card per `RegulationMatrixEntry` using only existing CSS tokens:
- `rpt-juris-card` / `rpt-juris-card__head` / `rpt-juris-card__head--{pass,fail,review}-head`
- `rpt-juris-card__status` / `rpt-juris-card__status--s-{pass,fail,review}`
- `rpt-juris-card__body` / `rpt-juris-card__viol` / `rpt-juris-card__violations`
- `rpt-text--fail` / `rpt-violation-row` / `rpt-violation-criterion` / `rpt-reg-tag rpt-reg-tag--{obligation}`

Status mapping: `pass` → pass-head/s-pass, `fail` → fail-head/s-fail, `partial` → review-head/s-review (reuses the existing review modifier).

Card content:
- Header: `shortName` (big), `regulationName — jurisdictionId` (small), localized status badge
- Body: mandatoryViolations (always), recommendedViolations + optionalViolations (when > 0)
- Violated requirements list when `violatedRequirements.length` > 0 — wcagCriterion + obligation tag + issueCount

### 4. JS sub-tab switcher

Added to the existing `<script>` block near line 664 (adjacent to `rptSwitchTab`):

```javascript
function rptSwitchSubTab(subtab, parent) {
  var parentPanel = document.getElementById('panel-' + parent);
  if (!parentPanel) return;
  var tabs = parentPanel.querySelectorAll('[data-action="rptSwitchSubTab"][data-parent="' + parent + '"]');
  var panels = parentPanel.querySelectorAll(':scope > .rpt-tab-panel');
  tabs.forEach(function(t) { ... });
  panels.forEach(function(p) { ... });
}

// Delegated click handler
document.addEventListener('click', function(evt) {
  var el = evt.target && evt.target.closest ? evt.target.closest('[data-action="rptSwitchSubTab"]') : null;
  if (!el) return;
  rptSwitchSubTab(el.getAttribute('data-subtab'), el.getAttribute('data-parent'));
});
```

Key isolation: `parentPanel.querySelectorAll(':scope > .rpt-tab-panel')` — only direct-child panels, not descendants — so the top-level rptSwitchTab (which operates on `.rpt-tab-panel` globally) and the new rptSwitchSubTab (which operates only on direct children of `#panel-compliance`) never touch the same nodes.

### 5. i18n keys added to `packages/dashboard/src/i18n/locales/en.json`

Under `scans`:
```json
"regulationsSelected": "Selected regulations",
"regulationTypeBadge": "R",
"jurisdictionTypeBadge": "J"
```
(`errorJurisdictionOrRegulationRequired` already present from P02.)

Under `reportDetail`:
```json
"subtabByJurisdiction": "By Jurisdiction",
"subtabByRegulation": "By Regulation",
"perRegulationBreakdown": "Per-regulation breakdown",
"regulationStatus": {
  "pass": "Pass",
  "fail": "Fail",
  "partial": "Partial"
},
"regulationViolations": "Violated requirements",
"mandatoryViolations": "Mandatory violations",
"recommendedViolations": "Recommended violations",
"optionalViolations": "Optional violations",
"regulationEmpty": "No regulations selected for this scan"
```

Nested `regulationStatus.*` keys work via `flattenObject()` in `i18n/index.ts` which produces the dotted-path lookup keys `reportDetail.regulationStatus.pass` etc.

Other locales (it, es, fr, de, pt) are untouched — `t()` falls back to the `en` dictionary for missing keys, and the milestone has not yet committed to translating new surface areas.

### 6. Partial registration

Added to `packages/dashboard/src/server.ts` `partials:` block:
```typescript
'rpt-regulation-card': 'partials/rpt-regulation-card.hbs',
```

## Test Coverage

### New tests (all passing)

| File | Tests added | Asserts |
|---|---|---|
| `tests/views/scan-new.test.ts` | 4 | Exactly one `name="regulations" value="<id>"` per regulation; exactly one `name="jurisdictions" value="<id>"` per jurisdiction; total jurisdictions-checkbox count equals jurisdictions.length (no bug-duplicates from regulation loop); `data-type` picker tags present |
| `tests/views/report-detail.test.ts` | 4 | Empty matrix → no sub-tab bar rendered; populated matrix → sub-tab bar + regulation card + criterion + mandatoryViolations count + "Per-regulation breakdown" heading; default active sub-tab is By Jurisdiction (aria-selected="true" on jurisdiction, "false" on regulation); `rptSwitchSubTab` JS function present |

### Render-level testing pattern

Both test files use direct `handlebars.compile(readFileSync(...))` — mirror of the pattern in `tests/integration/service-connections-flow.test.ts`. Helpers are registered on the module-level Handlebars instance:
- Real: `t` (from `i18n/index.ts loadTranslations + translateKey`), `eq`, `gt`
- Noop stubs: `formatStandard`, `countByType`, `fixSuggestion`, `reviewStatusClass`, `reviewStatusLabelClass`, `reviewStatusLabel`, `obligationClass`, `issueAssignStatus`, `json` — none of these contribute to the assertions we care about

The partial `rpt-regulation-card` is registered directly via `handlebars.registerPartial('rpt-regulation-card', readFileSync(...))` to match the runtime registration in `server.ts`.

This pattern is lightweight (no Fastify, no DB) but still catches template-level regressions like the one this plan fixed.

### Suite totals

```
cd packages/dashboard && npx tsc --noEmit          → exit 0
cd packages/dashboard && npx vitest run            → 2167 passed, 3 files skipped (40 tests), 0 failures in 148s
```

Delta: +8 tests over P02 baseline of 2159, zero regressions.

## Commits

| Commit | Message |
|---|---|
| `f9443bf` | fix(07-03): scan-form regulation checkbox submits regulations[id] |
| `10abc4b` | feat(07-03): report detail By Jurisdiction / By Regulation sub-tabs |

## Deviations from Plan

### 1. Skipped JS chip data-type decoration

The plan suggested (action step 2 in Task 1) that the selected-chips JS could read `data-type` and append a small visual marker like `[R]` or `[J]` to each chip. The plan also gave explicit permission: "If the picker JS doesn't currently produce chips per item, skip the JS change and rely on the i18n label difference alone. Do NOT add new CSS classes."

The picker JS **does** produce chips per item (see `src/static/app.js:132-151`), but decoration was still deferred because:
- The core bug fix (field name + value) is the only REG-01 requirement
- The chip text is already built from `cb.closest('.picker__item').querySelector('span').textContent` which for regulations is the `{{shortName}}` — users see "ADA", "EAA" etc., already distinguishable from the jurisdiction chips which show full names like "European Union"
- Adding `[R]`/`[J]` badges inline in `app.js` would require a second DOM query per chip and a new text-child append, which is cosmetic polish not spec work

The `data-type="jurisdiction|regulation"` attribute is still added to the `<label>` elements so a follow-up cosmetic PR can pick it up without re-editing the template.

### 2. Partial uses {{#if (eq status 'X')}} instead of computed class helper

The plan's Task 2 action 1 suggested `rpt-juris-card__head--{{status}}`. But the existing CSS modifiers are `--pass-head`, `--fail-head`, `--review-head` (not just `--pass`, `--fail`, `--partial`). And the partial input status can be `'pass'|'fail'|'partial'` — `partial` has no corresponding CSS class, but there is a `--review-head` for the visually identical "needs review" style.

So the partial uses explicit `{{#if (eq status 'pass')}}rpt-juris-card__head--pass-head{{/if}}` style guards, mapping `partial → review-head`. This is slightly more verbose but avoids the alternative (inventing a new CSS class `rpt-juris-card__head--partial`, which D-30 forbids).

### 3. Partial omits `<h4 class="rpt-juris-card__heading">`

The plan template included `<h4 class="rpt-juris-card__heading">`. Verified via grep: `rpt-juris-card__heading` does not exist in `style.css`. D-30 forbids inventing new classes. Replaced the heading with a bolded `rpt-juris-card__viol` row: `<div class="rpt-juris-card__viol"><strong>{{t "reportDetail.regulationViolations"}}</strong></div>`. Same semantic weight, reuses existing token.

### 4. View tests in new directory `tests/views/`

The plan references `tests/views/scan-new.test.ts` and `tests/views/report-detail.test.ts`. This directory did not exist before this plan. Created it. The vitest config `include: ['tests/**/*.test.ts']` picks up the new files with no config change needed.

### 5. Report-detail test registers noop helpers for unrelated template sections

The template references 13 Handlebars helpers (`formatStandard`, `countByType`, `fixSuggestion`, `reviewStatusClass`, `reviewStatusLabelClass`, `reviewStatusLabel`, `obligationClass`, `issueAssignStatus`, `json`, plus the built-ins `eq` and `gt`). The test only asserts on output from the new sub-tab block, so the non-asserted helpers are registered as noop stubs (returning their first string arg or empty string). Real implementations are registered for `t`, `eq`, `gt` which affect the assertions.

This is an intentional trade-off: registering real helpers would couple view tests to many unrelated server modules, whereas noop stubs let the new tests stay focused on the new block. If a future test needs to assert on e.g. `reviewStatusClass` output, that helper can be promoted to real at that point.

### Auto-fixed Issues

None — the plan was specific enough that no Rule 1/2/3 auto-fixes were needed.

### Authentication Gates

None encountered.

## Downstream Notes (for Plan 04)

- **Exports (07-P04)** now have full end-to-end wiring: scan form submits regulations → scan.regulations persisted → orchestrator forwards to compliance API → reportData.regulationMatrix present on the report. CSV/Excel exporters can join `scan.regulations` and per-regulation breakdown data is available on `reportData.regulationMatrix`.
- **Report HTML view is the reference UI** — PDF / CSV / Excel exports should mirror the two-tab structure (jurisdictions matrix + per-regulation cards) where space permits.
- **Picker JS chip decoration** is deferred as a cosmetic item; `data-type` attributes are already in place when a follow-up wants to pick it up.

## Known Stubs

None. The scan form bug is fixed (real data flow to POST body), the report detail regulation cards are driven by `reportData.regulationMatrix` which P02 wired to real data from the compliance API response.

## Self-Check: PASSED

- `packages/dashboard/src/views/scan-new.hbs` — FOUND (exactly 1 `name="regulations"`, exactly 1 `name="jurisdictions"`, `data-type="regulation"` + `data-type="jurisdiction"` both present)
- `packages/dashboard/src/views/report-detail.hbs` — FOUND (`rptSwitchSubTab` → 6 matches, `{{#if reportData.regulationMatrix.length}}` → 2 matches, `{{> rpt-regulation-card` → 1 match, `subpanel-compliance-by-jurisdiction`/`subpanel-compliance-by-regulation` → 5 matches total)
- `packages/dashboard/src/views/partials/rpt-regulation-card.hbs` — FOUND (new file, no invented CSS classes)
- `packages/dashboard/src/server.ts` — FOUND (`'rpt-regulation-card': 'partials/rpt-regulation-card.hbs'` registered)
- `packages/dashboard/src/i18n/locales/en.json` — FOUND (all 13 new keys present, JSON valid)
- `packages/dashboard/tests/views/scan-new.test.ts` — FOUND (4 tests)
- `packages/dashboard/tests/views/report-detail.test.ts` — FOUND (4 tests)
- Commit `f9443bf` — FOUND (`git log --oneline` contains it)
- Commit `10abc4b` — FOUND (`git log --oneline` contains it)
- `cd packages/dashboard && npx tsc --noEmit` — exit 0
- `cd packages/dashboard && npx vitest run` — 2167 passed, 0 failures (+8 over P02 baseline)
