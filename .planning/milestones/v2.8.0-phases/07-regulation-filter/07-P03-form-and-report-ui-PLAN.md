---
phase: 07-regulation-filter
plan: 03
type: execute
wave: 3
depends_on:
  - 07-02
files_modified:
  - packages/dashboard/src/views/scan-new.hbs
  - packages/dashboard/src/views/report-detail.hbs
  - packages/dashboard/src/views/partials/rpt-regulation-card.hbs
  - packages/dashboard/src/i18n/locales/en.json
  - packages/dashboard/tests/views/scan-new.test.ts
  - packages/dashboard/tests/views/report-detail.test.ts
autonomous: true
requirements:
  - REG-01
  - REG-05
  - REG-07
must_haves:
  truths:
    - "Selecting a regulation checkbox on the scan form submits name='regulations' value='<regulationId>' (not its parent jurisdictionId)"
    - "Only one line in scan-new.hbs uses name='jurisdictions' (the jurisdictions tab)"
    - "Report detail Compliance tab panel shows two sub-tabs: 'By Jurisdiction' (default active) and 'By Regulation'"
    - "By Regulation sub-tab is hidden entirely when regulationMatrix is empty"
    - "By Regulation sub-tab renders one card per regulation with shortName, home jurisdiction, status badge, violation counts"
    - "All new UI copy uses {{t}} i18n keys — zero hardcoded English"
    - "No new CSS classes invented — existing rpt-tab/rpt-juris-card tokens reused"
  artifacts:
    - path: "packages/dashboard/src/views/scan-new.hbs"
      provides: "Bug fix: regulation checkbox submits correct field/value"
      contains: "name=\"regulations\""
    - path: "packages/dashboard/src/views/report-detail.hbs"
      provides: "Sub-tabs inside #panel-compliance"
      contains: "rptSwitchSubTab"
    - path: "packages/dashboard/src/views/partials/rpt-regulation-card.hbs"
      provides: "Shared partial for per-regulation card rendering"
    - path: "packages/dashboard/src/i18n/locales/en.json"
      provides: "New reportDetail.* and scans.* keys"
  key_links:
    - from: "scan-new.hbs regulation tab checkbox"
      to: "POST /scans body.regulations"
      via: "form field name rename"
      pattern: "name=\"regulations\" value=\"{{id}}\""
    - from: "report-detail.hbs panel-compliance"
      to: "reportData.regulationMatrix"
      via: "conditional each loop over rpt-regulation-card partial"
      pattern: "regulationMatrix"
---

<objective>
Fix the one-line scan-form bug so selecting a regulation actually submits the regulation id (not its parent jurisdiction id). Add sub-tabs inside the report detail Compliance panel so users can toggle between "By Jurisdiction" (existing, unchanged, default) and "By Regulation" (new). Extract per-regulation rendering into a shared partial. Add i18n keys for every new string.

Purpose: Ships REG-01 (actual regulation selection works), REG-07 (regulations grouped by jurisdiction in the picker — already structured, just label correctly), and REG-05 (per-regulation breakdown in the report).

Output: 3 view files, 1 i18n file, snapshot/render tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/07-regulation-filter/07-CONTEXT.md
@.planning/phases/07-regulation-filter/07-02-SUMMARY.md

@packages/dashboard/src/views/scan-new.hbs
@packages/dashboard/src/views/report-detail.hbs
@packages/dashboard/src/i18n/locales/en.json

<interfaces>
From P02, the report route now provides:
```typescript
reportData.regulationMatrix: RegulationMatrixEntry[]  // array (possibly empty), safe for {{#each}}
reportData.scan.regulations: string[]
```

Each `RegulationMatrixEntry`:
```
{ regulationId, regulationName, shortName, jurisdictionId, status: 'pass'|'fail'|'partial',
  mandatoryViolations, recommendedViolations, optionalViolations, violatedRequirements: [...] }
```

Existing scan-new.hbs lines 84-108 — picker structure with jurisdictions + regulations tabs.
BUG at line 100: `<input type="checkbox" name="jurisdictions" value="{{jurisdictionId}}">` — wrong field name AND wrong value field.

Existing report-detail.hbs:
- Top-level tabs bar at lines 101-109, uses CSS classes `rpt-tab`, `rpt-tab--active`, `rpt-tab-panel`, `rpt-tab-panel--hidden`
- Compliance panel at lines 112-216 (#panel-compliance)
- Top-level tab switcher JS at lines 612-631 (`rptSwitchTab` function)
- Existing partial pattern: grep for `{{> ` in the views directory to find how partials are registered
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix scan form regulation checkbox + i18n keys (REG-01, REG-07)</name>
  <files>
    packages/dashboard/src/views/scan-new.hbs
    packages/dashboard/src/i18n/locales/en.json
    packages/dashboard/tests/views/scan-new.test.ts
  </files>
  <read_first>
    - packages/dashboard/src/views/scan-new.hbs lines 79-108 (full picker block)
    - packages/dashboard/src/static/app.js or equivalent — search for `pickerSearch` and `pickerTab` handlers to confirm the rename doesn't break JS (the handlers key off `data-tab` and input type, NOT the field name)
    - packages/dashboard/src/i18n/locales/en.json — inspect the `scans` and `common` namespaces to place new keys consistently
    - .planning/phases/07-regulation-filter/07-CONTEXT.md decisions D-16, D-17, D-18, D-19, D-30
  </read_first>
  <acceptance_criteria>
    - `grep -n 'name="regulations" value="{{id}}"' packages/dashboard/src/views/scan-new.hbs` returns exactly one match
    - `grep -cE 'name="jurisdictions"' packages/dashboard/src/views/scan-new.hbs` returns exactly 1 (the jurisdictions tab — line ~93; the previous buggy line 100 is gone)
    - `grep -n 'regulationsSelected\|regulationCheckboxLabel' packages/dashboard/src/i18n/locales/en.json` returns matches under the `scans` namespace
    - Zero hardcoded English in the new/modified hbs block: `grep -nE '>[A-Z][a-z]+ [a-z]+<' packages/dashboard/src/views/scan-new.hbs` returns only matches that were present before (no new ones introduced)
    - `cd packages/dashboard && npx vitest run tests/views/scan-new.test.ts` exits 0
  </acceptance_criteria>
  <action>
    1. In `packages/dashboard/src/views/scan-new.hbs` at line 100 replace:
       ```handlebars
       <input type="checkbox" name="jurisdictions" value="{{jurisdictionId}}">
       ```
       with:
       ```handlebars
       <input type="checkbox" name="regulations" value="{{id}}">
       ```
       This is the core bug fix (D-16). The `{{id}}` refers to the regulation's own id (confirmed by reading the `{{#each regulations}}` loop context at line 98).

    2. Add an optional `data-type` attribute to each picker item for D-17 visual differentiation (without inventing new CSS classes):
       - Line 92 `<label class="picker__item" data-tab="jurisdictions" data-name="{{name}}">` → add `data-type="jurisdiction"`
       - Line 99 `<label class="picker__item" data-tab="regulations" data-name="{{name}} {{shortName}}" style="display:none">` → add `data-type="regulation"`
       The selected-chips JS (in static/app.js) can read `data-type` and append a tiny text marker like `[R]` or `[J]` to the chip using ONLY existing spans and Emerald color tokens via inline `style="color:var(--color-text-muted)"` on a nested `<span>`. If the picker JS doesn't currently produce chips per item, skip the JS change and rely on the i18n label difference alone. Do NOT add new CSS classes.

    3. Add to `packages/dashboard/src/i18n/locales/en.json` under the `scans` namespace (maintain alphabetical or existing ordering):
       ```json
       "regulationsSelected": "Selected regulations",
       "regulationTypeBadge": "R",
       "jurisdictionTypeBadge": "J",
       "errorJurisdictionOrRegulationRequired": "Select at least one jurisdiction or regulation"
       ```
       (`errorJurisdictionOrRegulationRequired` may already have been added in P02 — if present, do not duplicate.)

    4. Add `packages/dashboard/tests/views/scan-new.test.ts` (or extend if exists) with a test that:
       - Renders the template with a fixture `{ jurisdictions: [{id:'EU',name:'EU'}], regulations: [{id:'ADA',name:'ADA',shortName:'ADA',jurisdictionId:'US'}] }`
       - Asserts the rendered HTML contains exactly one `name="regulations" value="ADA"` checkbox
       - Asserts the rendered HTML contains exactly one `name="jurisdictions" value="EU"` checkbox
       - Asserts NO occurrence of `name="jurisdictions" value="US"` (the old bug)
  </action>
  <verify>
    <automated>cd /root/luqen/packages/dashboard && npx vitest run tests/views/scan-new.test.ts && grep -c 'name="jurisdictions"' src/views/scan-new.hbs</automated>
  </verify>
  <done>
    - Exactly one `name="jurisdictions"` in scan-new.hbs (the jurisdictions tab)
    - Exactly one `name="regulations" value="{{id}}"` in scan-new.hbs
    - New i18n keys present in en.json
    - scan-new.test.ts passes with assertions for both checkbox types
  </done>
</task>

<task type="auto">
  <name>Task 2: Report detail sub-tabs + shared regulation card partial (REG-05)</name>
  <files>
    packages/dashboard/src/views/report-detail.hbs
    packages/dashboard/src/views/partials/rpt-regulation-card.hbs
    packages/dashboard/src/i18n/locales/en.json
    packages/dashboard/tests/views/report-detail.test.ts
  </files>
  <read_first>
    - packages/dashboard/src/views/report-detail.hbs lines 100-216 (tabs bar + panel-compliance full contents)
    - packages/dashboard/src/views/report-detail.hbs lines 612-640 (rptSwitchTab function — mirror its shape for rptSwitchSubTab)
    - packages/dashboard/src/views/partials/ directory — check how partials are registered (Handlebars partial registration is typically in the server bootstrap; grep `registerPartial` under packages/dashboard/src)
    - packages/dashboard/src/i18n/locales/en.json — `reportDetail.*` namespace existing keys for consistent naming
    - .planning/phases/07-regulation-filter/07-CONTEXT.md decisions D-20, D-21, D-22, D-23, D-24, D-30
  </read_first>
  <acceptance_criteria>
    - `grep -n 'rptSwitchSubTab\|rpt-subtab\|data-subtab' packages/dashboard/src/views/report-detail.hbs` returns at least 3 matches
    - `grep -n '{{#if reportData.regulationMatrix.length}}' packages/dashboard/src/views/report-detail.hbs` returns at least one match (hide whole sub-tab bar when empty, D-22)
    - `grep -n '{{> rpt-regulation-card' packages/dashboard/src/views/report-detail.hbs` returns at least one match
    - File `packages/dashboard/src/views/partials/rpt-regulation-card.hbs` exists
    - `grep -n 'subtabByJurisdiction\|subtabByRegulation\|regulationStatus\|regulationViolations' packages/dashboard/src/i18n/locales/en.json` returns all four under `reportDetail`
    - New hbs template has zero hardcoded English: every user-facing string uses `{{t "..."}}`
    - No new CSS class names invented: `grep -oE 'class="[^"]*"' packages/dashboard/src/views/partials/rpt-regulation-card.hbs | grep -v 'rpt-\|picker-\|card\|btn\|form-\|text-\|mb-\|alert'` returns empty
    - `cd packages/dashboard && npx vitest run tests/views/report-detail.test.ts` exits 0
  </acceptance_criteria>
  <action>
    1. Create `packages/dashboard/src/views/partials/rpt-regulation-card.hbs` with the per-regulation card rendering. Reuse ONLY existing CSS classes from report-detail.hbs (`rpt-juris-card`, `rpt-juris-card__head`, `rpt-juris-card__body`, `rpt-juris-card__name`, `rpt-juris-card__id`, `rpt-juris-card__viol`, `rpt-badge`, `rpt-badge--pass`, `rpt-badge--fail`, `rpt-text--fail`, etc.):
       ```handlebars
       <div class="rpt-juris-card">
         <div class="rpt-juris-card__head rpt-juris-card__head--{{status}}">
           <div>
             <div class="rpt-juris-card__name">{{shortName}}</div>
             <div class="rpt-juris-card__id">{{regulationName}} — {{jurisdictionId}}</div>
           </div>
           <div class="rpt-juris-card__status rpt-juris-card__status--{{status}}">
             {{#if (eq status "pass")}}{{t "reportDetail.regulationStatus.pass"}}{{/if}}
             {{#if (eq status "fail")}}{{t "reportDetail.regulationStatus.fail"}}{{/if}}
             {{#if (eq status "partial")}}{{t "reportDetail.regulationStatus.partial"}}{{/if}}
           </div>
         </div>
         <div class="rpt-juris-card__body">
           <div class="rpt-juris-card__viol">
             {{t "reportDetail.mandatoryViolations"}}: <strong class="rpt-text--fail">{{mandatoryViolations}}</strong>
           </div>
           {{#if recommendedViolations}}
           <div class="rpt-juris-card__viol">
             {{t "reportDetail.recommendedViolations"}}: <strong>{{recommendedViolations}}</strong>
           </div>
           {{/if}}
           {{#if optionalViolations}}
           <div class="rpt-juris-card__viol">
             {{t "reportDetail.optionalViolations"}}: <strong>{{optionalViolations}}</strong>
           </div>
           {{/if}}
           {{#if violatedRequirements.length}}
           <div class="rpt-juris-card__violations">
             <h4 class="rpt-juris-card__heading">{{t "reportDetail.regulationViolations"}}</h4>
             {{#each violatedRequirements}}
             <div class="rpt-violation-row">
               <span class="rpt-violation-criterion">{{wcagCriterion}}</span>
               <span class="rpt-reg-tag rpt-reg-tag--{{obligation}}">{{obligation}}</span>
               <span class="rpt-text--muted">{{issueCount}}</span>
             </div>
             {{/each}}
           </div>
           {{/if}}
         </div>
       </div>
       ```
       Verify `mandatoryViolations`, `recommendedViolations`, `optionalViolations` translation keys exist in en.json or add them. If `rpt-juris-card__heading` does not exist as a class, use `rpt-juris-card__viol` or omit the `<h4>` and use an existing class.

    2. Register the partial. Search for the existing partial registration in the dashboard server (`grep -rn 'registerPartial' packages/dashboard/src`). Add the new partial to the same registration list keyed as `'rpt-regulation-card'`.

    3. In `packages/dashboard/src/views/report-detail.hbs` modify the `#panel-compliance` div (lines 112-216). Wrap the existing matrix block in a sub-tab structure:
       ```handlebars
       <div class="rpt-tab-panel" id="panel-compliance" role="tabpanel" aria-labelledby="tab-compliance">

         {{#if reportData.regulationMatrix.length}}
         <div class="rpt-tabs" role="tablist" data-subtab-group="compliance">
           <button type="button" role="tab"
             class="rpt-tab rpt-tab--active"
             id="subtab-compliance-by-jurisdiction"
             aria-controls="subpanel-compliance-by-jurisdiction"
             aria-selected="true"
             data-action="rptSwitchSubTab"
             data-subtab="by-jurisdiction"
             data-parent="compliance">{{t "reportDetail.subtabByJurisdiction"}}</button>
           <button type="button" role="tab"
             class="rpt-tab"
             id="subtab-compliance-by-regulation"
             aria-controls="subpanel-compliance-by-regulation"
             aria-selected="false"
             data-action="rptSwitchSubTab"
             data-subtab="by-regulation"
             data-parent="compliance">{{t "reportDetail.subtabByRegulation"}}</button>
         </div>
         {{/if}}

         <div class="rpt-tab-panel" id="subpanel-compliance-by-jurisdiction" role="tabpanel" aria-labelledby="subtab-compliance-by-jurisdiction">
           {{! EXISTING matrix block — unchanged from lines 114-214 — paste as-is }}
         </div>

         {{#if reportData.regulationMatrix.length}}
         <div class="rpt-tab-panel rpt-tab-panel--hidden" id="subpanel-compliance-by-regulation" role="tabpanel" aria-labelledby="subtab-compliance-by-regulation">
           <section class="rpt-section" aria-labelledby="regulation-heading">
             <div class="rpt-section__header rpt-section__header--dark">
               <h2 id="regulation-heading" class="rpt-section__title">{{t "reportDetail.perRegulationBreakdown"}}</h2>
             </div>
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
       IMPORTANT: preserve the existing matrix block's inner contents byte-for-byte (D-32 freeze). Only wrap it in the new sub-panel div.

    4. Add the sub-tab switcher JS to the existing `<script>` block near line 612. Scope by `data-parent` so it can't collide with the top-level `rptSwitchTab`:
       ```javascript
       function rptSwitchSubTab(subtab, parent) {
         var parentPanel = document.getElementById('panel-' + parent);
         if (!parentPanel) return;
         var tabs = parentPanel.querySelectorAll('[data-action="rptSwitchSubTab"][data-parent="' + parent + '"]');
         var panels = parentPanel.querySelectorAll(':scope > .rpt-tab-panel');
         tabs.forEach(function(t) {
           var isActive = t.getAttribute('data-subtab') === subtab;
           t.classList.toggle('rpt-tab--active', isActive);
           t.setAttribute('aria-selected', isActive ? 'true' : 'false');
         });
         panels.forEach(function(p) {
           var isActive = p.id === 'subpanel-' + parent + '-' + subtab;
           p.classList.toggle('rpt-tab-panel--hidden', !isActive);
         });
       }
       ```
       Wire click handlers: add a delegated listener near the existing one that calls `rptSwitchSubTab(el.dataset.subtab, el.dataset.parent)` for any `[data-action="rptSwitchSubTab"]`.

    5. Add to `packages/dashboard/src/i18n/locales/en.json` under `reportDetail`:
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
       Preserve existing `reportDetail.*` keys.

    6. Add/extend `packages/dashboard/tests/views/report-detail.test.ts`:
       - Test 1: render with `reportData.regulationMatrix = []` — HTML does NOT contain `subtab-compliance-by-regulation`, sub-tab bar absent
       - Test 2: render with `reportData.regulationMatrix = [{regulationId:'ADA',shortName:'ADA',regulationName:'ADA',jurisdictionId:'US-FED',status:'fail',mandatoryViolations:3,recommendedViolations:0,optionalViolations:0,violatedRequirements:[{wcagCriterion:'1.1.1',obligation:'mandatory',issueCount:3}]}]` — HTML contains `subtab-compliance-by-jurisdiction`, `subtab-compliance-by-regulation`, the regulation card with shortName "ADA", criterion "1.1.1", and mandatoryViolations count "3"
       - Test 3: default active sub-tab is "By Jurisdiction" (assert `rpt-tab--active` is on `subtab-compliance-by-jurisdiction`, NOT on `subtab-compliance-by-regulation`)
  </action>
  <verify>
    <automated>cd /root/luqen/packages/dashboard && npx vitest run tests/views/report-detail.test.ts tests/views/scan-new.test.ts</automated>
  </verify>
  <done>
    - `packages/dashboard/src/views/partials/rpt-regulation-card.hbs` exists and is registered as a partial
    - `grep -n 'rptSwitchSubTab' packages/dashboard/src/views/report-detail.hbs` returns at least 2 matches (function + invocation/data-action)
    - `grep -n 'subpanel-compliance-by-jurisdiction\|subpanel-compliance-by-regulation' packages/dashboard/src/views/report-detail.hbs` returns 2+ matches
    - i18n keys all added under `reportDetail`
    - All 3 tests pass
    - Existing `panel-compliance` matrix block content unchanged (D-32)
  </done>
</task>

</tasks>

<verification>
- Scan form bug fixed: regulation checkbox submits `name="regulations" value="<regulationId>"`
- Report detail Compliance panel shows sub-tabs only when `regulationMatrix` is non-empty
- Default sub-tab is By Jurisdiction (matches existing user expectation)
- All new strings use `{{t}}` — zero hardcoded English
- No new CSS classes invented — reused existing rpt-* tokens
- View tests pass
</verification>

<success_criteria>
- `grep -c 'name="jurisdictions"' packages/dashboard/src/views/scan-new.hbs` returns exactly 1
- `grep -c 'name="regulations"' packages/dashboard/src/views/scan-new.hbs` returns at least 1
- Report detail template renders sub-tabs when `regulationMatrix.length > 0`
- Report detail template renders one card per regulation via the `rpt-regulation-card` partial
- All i18n keys defined
</success_criteria>

<output>
After completion, create `.planning/phases/07-regulation-filter/07-03-SUMMARY.md` capturing:
- Before/after snippet of the fixed scan-new.hbs line 100
- Structure of the new sub-tab bar (screenshots of the rendered HTML fragment)
- Full list of new i18n keys added in this phase
</output>
