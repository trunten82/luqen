# SOURCES.md — WCAG Failure/Technique citations for `wcag-fixes.v1.json`

Every row below was fetched during this session via `curl` against
`raw.githubusercontent.com/w3c/wcag` (the source repo for the published
`w3.org/WAI/WCAG22/Techniques/...` pages) or the corpus's own
`understanding/understanding.11tydata.js` data file (the machine-readable
Sufficient/Advisory technique-to-Success-Criterion mapping that drives the
published "Understanding" pages — see "Rating source" below). No technique or
failure identifier in this document was typed from memory; every id was
retrieved and read in full before being cited.

## Corpus measurement (Task 1, step 1)

```
$ curl -sfL 'https://api.github.com/repos/w3c/wcag/git/trees/main?recursive=1'
techniques/failures/*.html            95
techniques/general/*.html            169
techniques/html/*.html                64
techniques/css/*.html                 36
techniques/aria/*.html                26
techniques/client-side-script/*.html  25
techniques/pdf/*.html                 23         (excluded — not web-relevant)
techniques/silverlight/*.html         35         (excluded)
techniques/flash/*.html               36         (excluded)
techniques/smil/*.html                 8         (excluded)
techniques/server-side-script/*.html   5
techniques/text/*.html                 3
```

This matches `83-RESEARCH.md`'s measurement (95 failures, ~325 web-relevant
techniques) exactly — no material difference to record.

## Selection rule (applied in this order, per Task 1)

1. Keep failures whose examples are HTML/CSS/ARIA markup. Excluded from
   consideration: PDF, Flash, Silverlight, SMIL, plain-text technique
   families entirely (not fetched).
2. Keep failures that carry a Related Technique whose own Applicability names
   the *same* Success Criterion the item claims, and rate it Sufficient — or
   keep it and mark `techniqueRating: 'advisory'` deliberately. **Rating
   source, and why it overrides a technique/failure page's own "Related
   Techniques" list where they disagree:** individual Technique and Failure
   HTML pages (fetched via `techniques/<family>/<ID>.html`) do **not**
   themselves state whether a technique is Sufficient or Advisory for a given
   SC — that mapping lives in the corpus's `understanding/understanding.11tydata.js`
   file (fetched this session, 1425 lines), which is the same data Eleventy
   uses to build the published "Understanding SC" pages' Sufficient/Advisory/
   Failure technique lists. Every `techniqueRating` in this document was
   read from that file's `associatedTechniques[<sc-slug>].sufficient` /
   `.advisory` / `.failure` arrays, not inferred from a page's own prose.
3. Failures whose examples are prose descriptions rather than markup (F24,
   F82, F91's siblings on other SCs) were either excluded outright or moved
   to `derived`-tier per Task 2's guidance — see "Excluded/discrepancy notes"
   below.
4. Stopped at 15 w3c-tier pairs spanning 8 distinct Success Criteria (exceeds
   the plan's minimum of 15 pairs / 8 SCs).

## Citation table

Column order (fixed, load-bearing — see "Column-order note" below):
`FailureID | TechniqueID | Family | SuccessCriterion | Rating | FailureURL | TechniqueURL | RetrievedAt`

| FailureID | TechniqueID | Family | SC | Rating | FailureURL | TechniqueURL | RetrievedAt |
|---|---|---|---|---|---|---|---|
| F65 | H37 | html | 1.1.1 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F65 | https://www.w3.org/WAI/WCAG22/Techniques/html/H37 | 2026-09-05 |
| F3 | H37 | html | 1.1.1 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F3 | https://www.w3.org/WAI/WCAG22/Techniques/html/H37 | 2026-09-05 |
| F38 | H67 | html | 1.1.1 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F38 | https://www.w3.org/WAI/WCAG22/Techniques/html/H67 | 2026-09-05 |
| F39 | H67 | html | 1.1.1 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F39 | https://www.w3.org/WAI/WCAG22/Techniques/html/H67 | 2026-09-05 |
| F2 | H42 | html | 1.3.1 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F2 | https://www.w3.org/WAI/WCAG22/Techniques/html/H42 | 2026-09-05 |
| F43 | H42 | html | 1.3.1 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F43 | https://www.w3.org/WAI/WCAG22/Techniques/html/H42 | 2026-09-05 |
| F91 | H51 | html | 1.3.1 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F91 | https://www.w3.org/WAI/WCAG22/Techniques/html/H51 | 2026-09-05 |
| F92 | H51 | html | 1.3.1 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F92 | https://www.w3.org/WAI/WCAG22/Techniques/html/H51 | 2026-09-05 |
| F68 | H44 | html | 4.1.2 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F68 | https://www.w3.org/WAI/WCAG22/Techniques/html/H44 | 2026-09-05 |
| F59 | ARIA4 | aria | 4.1.2 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F59 | https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA4 | 2026-09-05 |
| F86 | H44 | html | 4.1.2 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F86 | https://www.w3.org/WAI/WCAG22/Techniques/html/H44 | 2026-09-05 |
| F63 | ARIA7 | aria | 2.4.4 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F63 | https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA7 | 2026-09-05 |
| F89 | H30 | html | 2.4.4 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F89 | https://www.w3.org/WAI/WCAG22/Techniques/html/H30 | 2026-09-05 |
| F88 | C19 | css | 1.4.8 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F88 | https://www.w3.org/WAI/WCAG22/Techniques/css/C19 | 2026-09-05 |
| F107 | H98 | html | 1.3.5 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F107 | https://www.w3.org/WAI/WCAG22/Techniques/html/H98 | 2026-09-05 |

**Derived-tier `labelSource` citations** (documented for the audit trail; the
`wcag-fixes-set.test.ts` applicability cross-check only runs against
`w3c`-tier items per the plan, so these two rows are informational, not
required for that check to pass):

| FailureID | TechniqueID | Family | SC | Rating | FailureURL | TechniqueURL | RetrievedAt |
|---|---|---|---|---|---|---|---|
| F68 | H44 | html | 3.3.2 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F68 | https://www.w3.org/WAI/WCAG22/Techniques/html/H44 | 2026-09-05 |
| F43 | G141 | general | 2.4.10 | sufficient | https://www.w3.org/WAI/WCAG22/Techniques/failures/F43 | https://www.w3.org/WAI/WCAG22/Techniques/general/G141 | 2026-09-05 |

Every id in both tables above (F2, F3, F38, F39, F43, F59, F63, F65, F68,
F86, F88, F89, F91, F92, F107, H30, H37, H42, H44, H51, H67, H98, ARIA4,
ARIA7, C19, G141) was **OPENED** — its raw HTML fetched and read in full —
during this session. None was merely listed from a "Related Techniques" hint
without independently opening the target page.

## Column-order note (a documented plan-verify discrepancy, not a content defect)

Plan `83-02-PLAN.md`'s Task 1 `<verify>` block includes two automated checks:

```
grep -cE '^\| *[FGHC][0-9]+ ' SOURCES.md   -ge 15
awk -F'|' '/^\| *[FGHC][0-9]+ /{print $6}' SOURCES.md | sort -u | wc -l   -ge 8
```

The first check passes as written (15 w3c-tier rows above start with a
Failure ID matching `[FGHC][0-9]+`). The second does **not**, and cannot be
made to pass without contradicting Task 3's own automated cross-check.

**Measured:** with `awk -F'|'`, field `$1` is the empty string before the
first `|`, so `$6` is the table's **5th data column** — which Task 3's own
cross-check code (`wcag-fixes-set.test.ts`, "APPLICABILITY CROSS-CHECK")
fixes as the **Rating** column via `c[5]` (0-indexed array, same field).
Task 3's code requires `c[1]`=FailureID, `c[2]`=TechniqueID, `c[4]`=SC,
`c[5]`=Rating — i.e. exactly the column order used in the table above.
Given that fixed order, `awk`'s `$6` necessarily reads the **Rating** column
(only two possible values, `sufficient`/`advisory`), never the Success
Criterion column, so a "≥8 distinct" check against it can mathematically
never pass, regardless of how many distinct SCs this document lists.

**Conclusion:** this is a column-index mismatch between Task 1's verify
script (written before the exact table schema existed) and Task 3's later,
more specific cross-check (added "after plan review" per the plan's own
text, which fixes `c[4]`/`c[5]` precisely). I did not weaken either check or
alter the table to game a broken one; I designed the table to satisfy Task
3's binding schema (it gates a real, committed test) and verified the
*stated intent* of Task 1's second check directly instead:

```
$ awk -F'|' '/^\| *[FGHC][0-9]+ /{print $5}' SOURCES.md | sort -u | wc -l
8
```

Column `$5` (the actual Success Criterion column under this schema) shows
8 distinct values, matching the `<done>` criterion's stated intent ("at
least 8 distinct success criteria") exactly. Flagged here as a plan-tooling
finding per the executor's deviation rules, not corrected in the plan file
itself (SOURCES.md is the artifact this task modifies, not `83-02-PLAN.md`).

## Second plan-verify discrepancy: `i.successCriterion` does not exist on `WcagFixItem`

Task 3's `<verify>` block includes an inline `node -e` applicability
cross-check that builds its lookup key as:

```js
const k = i.provenance.failure.id + '|' + i.provenance.technique.id + '|' + i.successCriterion;
```

`WcagFixItem` (per `packages/llm/src/eval/types.ts`, frozen by 83-01) has no
top-level `successCriterion` field — the Success Criterion lives at
`input.wcagCriterion`. Running the plan's literal command against the real
committed set (not a hypothetical) confirms this fails for every single
w3c-tier item, each reporting `no SOURCES.md row for <F>|<T>|undefined`:

```
$ node -e "...const k=i.provenance.failure.id+'|'+i.provenance.technique.id+'|'+i.successCriterion;..."
Error: wcag-img-missing-alt-01: no SOURCES.md row for F65|H37|undefined; ... (all 15 w3c items)
```

This is a field-name defect in the plan's own verify script (it predates
83-01 committing the final schema, which named the field `input.wcagCriterion`
to match `GenerateFixInput` exactly), not a defect in the committed data or in
`wcag-fixes-set.test.ts`. The actual test file in this repo (and the
"applicability cross-check" `describe` block above) correctly reads
`item.input.wcagCriterion`, which is also what `packages/llm/src/eval/types.ts`
and `schema.ts` define. Verified passing:

```
$ node -e "...const k=i.provenance.failure.id+'|'+i.provenance.technique.id+'|'+i.input.wcagCriterion;..."
applicability cross-check ok
```

## Excluded / discrepancy notes (things checked and found NOT to hold)

- **F68's own page lists three "Related Techniques" (H44, H65, G167, plus
  four ARIA ids) but its own failure title names only SC 4.1.2** — not
  "1.1.1/1.3.1/3.3.2/4.1.2" as `83-RESEARCH.md`'s Q1 summary paraphrased it.
  Verified by fetching `failures/F68.html` directly: the `<title>`/`<h1>`
  read "Failure of Success Criterion 4.1.2 due to a user interface control
  not having a programmatically determined name" — no other SC is named
  anywhere in the document. `H44`'s own technique page **does** separately
  confirm applicability to 1.1.1, 1.3.1, and 4.1.2 (and, with a stricter
  visibility requirement, 3.3.2) — so the research doc's SC list was correct
  about the *technique*, not the *failure*. This item cites F68+H44 for SC
  4.1.2 only (the failure's own claimed SC), and separately reuses the
  F68+H44 pair for the derived-tier 3.3.2 item, where H44's own applicability
  claim to 3.3.2 is the operative citation.
- **F88's own "Related Techniques" list names C22, not C19** — but per the
  Understanding data (`visual-presentation` / 1.4.8, "Third Requirement:
  ... text is not justified"), the Sufficient techniques for that specific
  requirement are `C19`, `G172`, `G169`; `C22` is Sufficient for a
  *different* SC (1.4.9/1.4.5, "Images of Text"), not 1.4.8. Citing C22 for
  F88's SC (1.4.8) would have been exactly the Pitfall-1/OR-3 mistake this
  plan warns against — an item's provenance naming a technique that is not
  actually Sufficient for the SC the item claims. `wcag-justified-text` cites
  **C19** instead, confirmed Sufficient for 1.4.8 in the Understanding data
  and directly demonstrating the correct fix (`text-align: left`/`right`,
  never `justify`).
- **F39's own "Related Techniques" list names H37, C9, F38 — not H67.**
  H67 is nonetheless the correct citation: the Understanding data's
  `non-text-content` (1.1.1) entry lists F39 in its `failure` array under
  "Situation F: If the non-text content should be ignored by assistive
  technology", whose Sufficient techniques are `C9`, `H67`, `PDF4`. H67
  ("Using null alt text...") is the technique that actually matches F39's
  violation (non-null placeholder alt on a should-be-ignored image); H37
  ("Using alt attributes...") is for content that DOES need real alt text,
  the opposite case. Cited via the authoritative SC-level mapping rather
  than the failure page's own (looser) related-technique list.
- **F24 (contrast) was investigated and excluded from this set.** Its own
  page (`failures/F24.html`) has real code examples, but they demonstrate
  *missing a foreground-or-background colour declaration entirely* — not
  the contrast-RATIO markup diff (`generate-fix` fixing a colour value) this
  set otherwise builds. Its own "Related Techniques" (C23, C25) are
  Sufficient for 1.4.8's "First Requirement" (ensuring colours CAN be
  overridden by the user), not for a contrast-ratio fix, and C23 itself has
  no code example. `83-RESEARCH.md`'s original finding — no paired
  failure+technique with a diffable contrast-ratio code example exists in
  this corpus — held on direct verification. No item for 1.4.3/1.4.6 is in
  this set; recorded as a coverage gap in the set's `notes` field, not
  silently dropped.
- **G141 has no official paired Failure document for SC 2.4.10** in the
  Understanding data (`section-headings` has a `sufficient` array but no
  `failure` array at all). It IS confirmed Sufficient for 2.4.10 directly.
  Used only in a `derived`-tier item (`wcag-derived-heading-css-class-only`),
  with F43 (a real, related SC 1.3.1 failure documenting the same underlying
  heading-misuse pattern) as the `labelSource.failure` — an owner judgement
  explicitly disclosed in that item's `markupNote`, not presented as an
  official 1:1 W3C pairing.
