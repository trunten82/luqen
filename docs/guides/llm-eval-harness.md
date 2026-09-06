# LLM scoring harness — `luqen-llm eval`

Status: **BUILT AND SEAM-TESTED, NEVER DIALLED AGAINST A REAL PROVIDER.** Shipped Phase 84
(scoring harness) and Phase 85 (pre-registered decision bars — the verdict layer, see below).
No trusted measurement of any model exists yet from this tool — that starts at Phase 86's
baseline, which is also the first real exercise of the verdict layer against real data.

## What this measures, and what it does not

`luqen-llm eval run` scores a whole labelled reference set (Phase 83) through a named
capability's REAL production execution function — `executeGenerateFix` or
`executeAnalyseVisual`, the literal functions the HTTP route and the MCP tools call, never a
re-implemented invocation loop. It produces:

- a per-item record: the item id, the parsed result, the raw model response, and a
  raw-response diagnostic (HARNESS-06) — so a maintainer can see whether the model actually
  asserted the verdict it appears to have given, not just what the parser produced from it
- an aggregate over the items that produced a result, with a per-item capability failure
  (an exhausted model, a missing fixture) counted SEPARATELY, never folded in as a
  zero-scoring item
- a `RunFunction` recording everything the result is a function of — harness version,
  capability, mode, model, provider type, a non-reversible endpoint fingerprint, temperature,
  prompt version, prompt source, reference-set name/version, item count, timestamp

**It does not judge.** There is no bar, no margin, no threshold and no pass/fail verdict
anywhere in its output. Phase 85 adds a verdict object that carries a `RunFunction` plus a
required statistical-power field; Phase 84 measures, Phase 85 judges.

> **CORRECTED (Phase 85).** The paragraph above was true of Phase 84 alone and is no longer
> true of this harness as a whole. `luqen-llm eval verdict` (and the library comparators
> `compareGenerateFix` / `compareAnalyseVisual` it wraps) now judge two written reports against
> a pre-registered decision bar. Left visible rather than silently rewritten, because a
> corrected claim is more trustworthy than one that quietly vanished. See **"The verdict
> layer"** below for exactly what a verdict outcome licenses, and what it does not.

## The two modes, and why replay is the default

| | replay (default) | live |
|---|---|---|
| Cost | free | spends money against a real provider |
| Determinism | deterministic — same fixtures in, same report out | not deterministic |
| Credentials | none | a provider API key, read from an environment variable |
| Network | none | real network calls |
| CI-safe | yes | never run in CI |

Replay mode answers every item from a **committed, hand-written fixture file** —
`packages/llm/tests/eval/fixtures/wcag-fixes.replay.json` and `image-alt.replay.json`. Each
file carries a `_synthetic` field, in the artifact itself, stating plainly that its responses
are hand-written and are NOT model output. **A green replay run means the harness runs. It
does not mean any model was measured.** The fixtures deliberately include a handful of
degraded response shapes — not-valid-JSON, valid-JSON-missing-key-fields, and
markdown-fenced — so the diagnostic and failure paths are exercised by every CI run, not
merely assumed to work.

Live mode is fully built and seam-tested (the CLI is proven, by mocking `providers/
registry.ts`'s `createAdapter`, to hand `executeGenerateFix`/`executeAnalyseVisual` the REAL
production adapter factory when live mode is selected — never a re-implemented dialing path).
**It has never been exercised against a real provider.** Its first real exercise is Phase 86's
baseline, which is where the spend decision belongs — not inside this phase's tasks.

## Commands

```bash
# generate-fix, replay mode (the default — no flags needed beyond --capability)
luqen-llm eval run --capability generate-fix

# analyse-visual, replay mode, writing the full report to a file
luqen-llm eval run --capability analyse-visual --out /tmp/analyse-visual-report.json

# live mode — every one of these four is required, plus the credential
# environment variable below. Never actually run without a deliberate,
# reviewed decision to spend money (Phase 86's job).
EVAL_HARNESS_API_KEY=sk-... luqen-llm eval run \
  --capability generate-fix \
  --mode live \
  --provider-type gemini \
  --endpoint https://generativelanguage.googleapis.com \
  --model-id gemini-3.7-flash \
  --i-acknowledge-spend

# compare two written reports — refuses if their run functions differ
luqen-llm eval compare --a report-a.json --b report-b.json
```

The printed summary always shows `False-PASS` and `False-ISSUE` as two separate lines for
`analyse-visual` — the two error directions are never fused into one figure, because a
false-PASS (a real violation reported as conformant) costs more than a false-ISSUE. The same
separation holds in the serialised report's `aggregate` object.

## Live mode's four requirements, and why each exists

| Flag / variable | Why it is required, not optional |
|---|---|
| `--provider-type` | The harness never reads a model's provider from the production database — the database is never opened at all (see below) |
| `--endpoint` | Same reason; also becomes the run's non-reversible `endpointFingerprint`, never the raw URL, in the persisted report |
| `--model-id` | The provider-native model id under test — never inferred from the current production pin |
| `--i-acknowledge-spend` | A live run over both sets is roughly thirty non-deterministic paid model calls; this flag exists so that never happens by accident |
| `EVAL_HARNESS_API_KEY` (environment variable) | The credential — read ONLY from here, never from a CLI argument, which would land in shell history and process listings |

Omitting any one of these refuses the run, before any adapter is built and before any network
call is attempted, and names exactly what is missing.

## The harness can never open the production database

The `eval` command group exposes **no `--db` option anywhere**, unlike every other command
group in this CLI. The run database is always an isolated, single-model, in-memory
(`:memory:`) SQLite instance — nothing to mistype, nothing to accidentally point at
`llm.db`. `SqliteAdapter.initialize()` executes schema DDL and `ALTER TABLE` statements on
whatever file it opens; a harness run must never be able to do that to the production file
(T-84-10).

## Every `RunFunction` field

| Field | Meaning |
|---|---|
| `harnessVersion` | This module's scoring-semantics version, combined with the package version |
| `capability` | `generate-fix` or `analyse-visual` |
| `mode` | `replay` or `live` — two runs in different modes are never comparable |
| `modelId` | Provider-native model id (e.g. `gemini-3.7-flash`), never the display name |
| `modelDisplayName` | The registered display name |
| `providerType` | `ollama \| openai \| anthropic \| gemini` |
| `endpointFingerprint` | A non-reversible short hash of the provider's base URL — never the URL itself, since this repository is public |
| `temperature` | Read from the SAME exported constant the capability's own call site uses — proven, not merely declared, to be the value the adapter receives |
| `promptVersion` | A hash of the ACTUALLY APPLIED prompt template (the shipped default, or an org's override) — computed, because no version concept existed in this codebase before Phase 84 |
| `promptSource` | `default` or `override` |
| `setName` / `setVersion` | The Phase 83 reference set and its version |
| `itemCount` | How many items the set contained for this run |
| `timestamp` | The only field two runs may differ on and still be comparable |

`luqen-llm eval compare` refuses two reports whose `RunFunction` differs on ANY field except
`timestamp`, and names every differing field — not just the first.

## Why false-PASS and false-ISSUE are never combined

`analyse-visual` classifies every scored item into one of four outcomes: `correct`,
`false-pass`, `false-issue`, `uncertain`. A false-PASS — the model reporting `pass` on a real
violation — is the expensive error: it can put an unfounded conformance claim into a VPAT/ACR
document someone relies on legally. A false-ISSUE — flagging an already-correct image — is
cheap by comparison. Fusing the two into a single "wrong" count, or a single accuracy
percentage, would hide exactly the asymmetry this harness exists to surface. `uncertain` is
kept as its own fourth outcome (never folded into either error bucket), because the model's
own `uncertain` verdict is neither a correct answer nor either kind of mistake.

## `capabilities/analyse-visual.ts:58-61` — measured, named, and deliberately left unpatched

> **CORRECTED (86-04).** This section's own file:line locator had drifted to
> `analyse-visual.ts:51-53` — stale relative to the shipped file, which now carries this logic at
> `capabilities/analyse-visual.ts:58-61` — from unrelated line-number movement in later phases.
> Caught by this plan's claim-by-claim check (see `86-04-SUMMARY.md`); the underlying behaviour
> description below was, and remains, accurate.

A response that parses as valid JSON but carries no `verdict` field and no `findings` does
**not** fall back to `uncertain`. The parser computes `verdict = findings.length > 0 ? 'issue'
: 'pass'` — so an empty, lazy or truncated model reply silently becomes a **manufactured
`pass`**, indistinguishable at the parsed layer from a genuine considered pass.

This phase deliberately does **not** fix it. `git diff --stat
packages/llm/src/capabilities/` is empty for every plan in Phase 84. Changing the production
default now would tune the exact thing this milestone exists to measure honestly — Phase 86
must baseline the CURRENT production behaviour, manufactured passes included. If this
behaviour is ever changed, that is its own decision made AFTER a baseline exists, not before.

The harness's raw-response diagnostic (`diagnoseRawResponse`, HARNESS-06) is what makes this
bug visible rather than silent: it inspects the raw text directly — never the parsed
output — and reports whether a `verdict` was actually asserted, independent of what the
parser produced. `tests/eval/fixtures/image-alt.replay.json`'s
`informative-telephone-icon` entry is a committed, CI-run reproduction of this exact defect,
arriving through the harness's full pipeline (not only through 84-03's direct scorer test).

## Where the break-test evidence lives

`packages/llm/tests/eval/break-test.test.ts` (84-03, HARNESS-05) scores all 7 committed
poison items — 3 in `wcag-fixes.v1.json`, 4 in `image-alt.v1.json` — directly through the
pure scorer, before any full-set green was ever produced. That evidence existing first, and
staying green, is a precondition Task 2 of this phase's plan (84-04) checks before running at
all.

## The verdict layer — what each outcome licenses (Phase 85)

**This instrument is a REGRESSION DETECTOR, not a parity certifier.** Read that sentence
first, because it is the one fact that makes every other number in this section make sense.
The FAIL direction works unconditionally: a candidate that is genuinely worse pushes the
statistical bound past the margin, or clears one more real violation on the false-PASS gate,
and is caught — the false-PASS count gate in particular is **deterministic and completely
unaffected by power**, because it is a count comparison, not a test. What this instrument
**declines** to do is certify that a candidate is near-parity with baseline, and **that
refusal is correct behaviour, not a failed run.** A reader who learns to treat `UNDERPOWERED`
as noise has lost the only thing standing between a green tick and a claim it cannot support.

This section must be understandable on its own. A maintainer who reads only this page, and
never a milestone closure report, should reach the same conclusions written here.

### Judging two reports

```bash
luqen-llm eval verdict --baseline baseline-report.json --candidate candidate-report.json

# write the full JSON verdict alongside the printed summary
luqen-llm eval verdict --baseline baseline-report.json --candidate candidate-report.json \
  --out verdict.json
```

`--baseline` and `--candidate` are two report files a maintainer already has (produced by
`luqen-llm eval run --out <path>`, above). The command reads the baseline report's
`runFunction.capability` field to decide which comparator to call, prints the outcome, the
power assessment, and every clause's licence text, and exits non-zero on FAIL. It takes **no
provider, no endpoint, no model, no live mode, no spend acknowledgement, and no database
option** — pinned by a committed test over its own option list — because judging two files
that already exist never needs to dial anything.

### The three outcomes, and what each licenses

Every licence sentence below is quoted from the committed pre-registration
(`packages/llm/tests/eval/bars/decision-bars.v1.json`), never re-composed here — two documents
phrasing the same guarantee slightly differently is how a caveat gets dropped.

- **PASS.** "Every clause (the false-PASS screening gate, and every non-inferiority clause in
  scope) is clear AND sufficient power was assessed. \[...\] a PASS here is the conjunction of
  narrower licences, not a stronger claim than any one of them."
- **FAIL.** "At least one clause FAILED — either an observed regression beyond a tolerated
  margin, or the false-PASS screening gate. See the failing clause's own licence sentence for
  the specific reason."
- **UNDERPOWERED.** "No clause FAILED, but at least one clause's power assessment was
  insufficient (observed variance exceeded the pre-registered assumption). UNDERPOWERED
  outranks PASS structurally (D-85-6) and can never be silently upgraded to PASS. At these n
  this is the EXPECTED verdict (A-9), not a fault."

`analyse-visual` reports this summary word as **one derived field beside, never instead of, its
two underlying clauses**: `falsePassGate` (the deterministic count comparison) and
`nonInferiorityClause` (the statistical clause on `correct`), each with its own outcome and its
own licence text. A single summary word standing alone is exactly the collapse this design
refuses — see the false-PASS gate's own licence below for why the two are kept separate.

**The false-PASS gate's PASS licence, reproduced verbatim** (it must never be paraphrased, and
no competing figure may be added beside it):

> "no observed increase across 7 opportunities; by rule of three this bounds the true
> false-PASS rate only below ~43%. It is a screen against visible regression, NOT evidence of
> parity."

That is the rule-of-three fact for the false-PASS gate, in the pre-registration's own words —
`image-alt.v1.json` has 13 items, of which only the 7 carrying `expectedVerdict: 'issue'` can
ever produce an observable false-PASS, and 7 opportunities is not enough for a tighter claim
than "below ~43%" no matter how the test is dressed up.

### UNDERPOWERED is the EXPECTED verdict at these sample sizes

Under the pre-registered discordance assumption (0.25, itself an ASSUMPTION and not a
measurement — see below), the probability this instrument certifies a candidate that is
**genuinely identical** to baseline is:

| Capability / clause | n | Power to certify a genuinely identical candidate |
|---|---|---|
| `generate-fix` | 17 | **10.3%** |
| `analyse-visual` `correct` clause | 13 | **17.6%** |
| `analyse-visual` false-PASS gate | 7 opportunities | deterministic — power does not apply |

`UNDERPOWERED` is therefore not the uncommon path for the PASS direction — **it is very nearly
the only one.** Phase 86's baseline returning `UNDERPOWERED` is the **expected** result and
must not be read as something having gone wrong. The milestone's core value was never "certify
parity"; it was "do not let a model swap silently degrade output" — detection is that job, and
it works. Certification was always the ambitious half, and 17, 13, and 7 items cannot buy it.

### The margin is not a budget

The certifying condition at the recorded margin (3 items, both capabilities) is **ZERO
baseline-better items**: the candidate must not lose a single item on the gating axis. "3
items" is a tolerated TRUE difference, and it licenses losing **none**. Reading "3 items" as
"we are allowed to lose three" is the natural misreading, available to every reader, and it
runs in the reassuring direction — the direction nobody re-checks.

In observed terms, computed directly from the committed bar file: at n=17, `U(0,17)=0.1616 <
3/17=0.1765` certifies, but `U(1,17)=0.2501` does **not** clear the same bound — so `b=0` is the
only observed baseline-better count that certifies. At n=13 the same is true: `U(0,13)=0.2058 <
3/13=0.2308` certifies, `U(1,13)=0.3163` does not. **Zero is the whole certifying set, at both
sample sizes.**

### No credit for improvements

"The bound ignores the candidate-better count entirely — the candidate is NEVER given credit
for items it improved. Conservative, intended, and a direct consequence of the one-parameter
construction that buys the method its validity and its monotonicity. A candidate that is
visibly better overall can still fail to certify." This is the instrument erring toward alarm
by design, not a bug to file later.

### The decision rule: what it is, what it costs, and why it is not the rule planning first proposed

The method is an exact one-sided 95 percent Clopper-Pearson upper confidence bound on the
**baseline-better rate alone** — never conditioned on how many items the candidate improved.
"The probability that this rule declares non-inferiority when the candidate is truly worse by
exactly the margin is bounded below 0.05 BY CONSTRUCTION" — the file's exact worst-case values
are **3.69%** at n=17/margin=3 and **3.30%** at n=13/margin=3, both safely under the 5 percent
ceiling the method guarantees.

What that validity costs is power, and the 10.3%/17.6% figures above are the price. The rule
this replaced — conditioning the bound on the observed discordant-pair split — was rejected for
being **anti-conservative**: it "would declare non-inferiority roughly 1 time in 4 against a
candidate truly worse by exactly the margin." A reader who reinvents that rule to buy back some
power is reinventing exactly the method this milestone rejected, for exactly the reason it was
rejected — recorded here so the next person who is tempted does not have to re-derive the
mistake to find out why it is a mistake.

### Checking the pre-registration yourself

Every verdict this instrument produces carries `decisionBarsVersion` and
`decisionBarsDigestSha256` — a raw-bytes sha256 of the exact bar file that judged it. Two
verdicts with different digests were judged against different bars (an edit happened between
them), and a verdict's digest should always be checked against the bar file actually sitting in
the repository before its outcome is trusted for anything consequential.

The pre-registration's own re-checkable invariant, quoted directly: "The commit that ADDS this
file must be an ancestor of the commit that adds any baseline or verdict artifact. This is
checkable by any future reader without trusting a claim in this file." The procedure:

```bash
# 1) Find the introducing commit
git log --diff-filter=A --format=%H --reverse -- packages/llm/tests/eval/bars/decision-bars.v1.json | head -1

# 2) For any candidate baseline/verdict artifact commit, confirm ancestry
git merge-base --is-ancestor <introducing-commit-sha> <candidate-commit-sha>
# exit 0 = the invariant holds; non-zero = the bar was edited or created
# AFTER a measurement, and must no longer be trusted as a pre-registration
```

### What Phase 86 supplies

Phase 86 splits into two parts. **Part A (86-01 through 86-04) is the mechanism: it is shipped,
merged, and exercised entirely on synthetic and replay data.** It supplies:

- **the second variance quantity, run-to-run instability** — defined and computed by
  `instability.ts`'s `computeRunToRunInstability` (86-01), the same model/prompt run repeated,
  never baseline-vs-candidate disagreement (see "Run-to-run instability" below);
- **the assumption check that consumes it** — `verdict.ts`'s `assessPower` (86-02) gained a
  THIRD, independent insufficiency reason, `run-to-run-instability-exceeds-ceiling`, checked
  against the same pre-registered discordant-pair-rate number, reused as a ceiling;
- **the licence qualifier** (`licence-qualifier.ts`, 86-02) — every PASS licence Phase 85
  pre-registered asserts, verbatim, that instability was not measured; the moment it IS measured
  for a given verdict, that clause would state something false if left unchanged. The bar file
  cannot be edited to fix a sentence that has become stale — it is pre-registered and
  digest-pinned — so `buildLicenceQualifier` marks the affected clauses SUPERSEDED on the
  verdict instead of editing the pre-registration;
- **the replication artifact and `eval baseline`** (`baseline.ts`, 86-03) — a discriminated
  union that makes a replay run structurally unwritable under a name that implies it measured a
  model, and a CLI command that repeats a reference set K times and reports the instability;
- **the pre-registration ancestry check** (`pre-registration-ancestry.ts`, 86-03) — implements
  the bar file's own `verificationProcedure` in code, refusing (never silently skipping or
  mis-answering) when run against a shallow clone.

**Part A measures no model.** Every piece above was built and tested against synthetic fixtures
and replay-mode reports — a fixture adapter returning committed strings, never a real provider.
A green result from any of it is evidence the mechanism works, never evidence about a model.

**Part B (86-05) is the live measurement** — actually repeating the CURRENT production pins
against a real provider, three times per capability, and committing the result as the first
recorded baseline this milestone will have. It requires a provider credential and a deliberate,
authorised decision to spend money, neither of which Part A's tasks can supply. Whether Part B
has run yet is a fact this document does not assume — see "Standing statement" below for how to
check it directly rather than trusting a sentence here.

Every PASS licence Phase 85 pre-registered still asserts, verbatim and as originally written,
that instability was not measured for a given comparison — that sentence remains literally true
of every verdict produced without a measured `RunToRunInstability` supplied to it. The licence
qualifier is how a FUTURE verdict, once instability IS measured for it, corrects that sentence
without ever editing the pre-registration itself.

### Run-to-run instability — the second variance quantity, defined in observed terms

**Definition, checkable by hand:** given K (>= 2) repeat reports of one IDENTICAL run function,
for each unordered pair of repeats count the items on which the two repeats DISAGREE on the
capability's gating boolean (`exactMatch` for `generate-fix`, `verdictOutcome === 'correct'` for
`analyse-visual`), divide by the shared item count, and report the MAXIMUM of those pairwise
rates as the run-to-run instability. The mean travels beside it as context, never as the gating
value — the maximum is used because every decision rule in this milestone errs toward alarm
(85-CONTEXT.md A-1), and a mean would let one unusually stable pair of repeats mask an unusually
unstable one.

**Name it beside the quantity it must never be confused with.** The McNemar DISCORDANT-PAIR RATE
(the assumption `varianceAssumption[capability].assumedValue` in the pre-registered bar, and the
FIRST of `assessPower`'s three insufficiency reasons, `discordance-exceeds-assumption`) measures
BASELINE-vs-CANDIDATE disagreement — two DIFFERENT experiments, each run once. RUN-TO-RUN
INSTABILITY measures the SAME model/prompt run REPEATED — one experiment's own non-determinism
at fixed temperature, with no baseline/candidate distinction at all. They are never the same
number, and nothing in this codebase ever compares one against the other directly — see the
shared-ceiling section below for the one place they meet, and note that meeting is a comparison
of instability against a REUSED number, never a comparison of the two quantities to each other.

### The shared ceiling: a reuse, not a pre-registered threshold

The measured run-to-run instability is checked against the SAME `0.25` number the pre-registered
bar already carries as `varianceAssumption[capability].assumedValue` for both capabilities — the
discordant-pair-rate assumption the sample sizes were sized under. **State this plainly, in
these words rather than a paraphrase: this ceiling is a REUSE of a differently-named quantity's
number, adopted because it can only tighten — NOT a pre-registered instability threshold. If a
future milestone wants a real instability bar, it pre-registers one; this is a conservative
stand-in until then.** No separate instability threshold was ever pre-registered, because Phase
85 correctly declined to invent a number for a quantity nobody had measured, and inventing one
now — after this phase exists to produce the first measurement — would be exactly the fitting
the milestone forbids. A reader must not come away believing an instability bar was
pre-registered when none was.

**Why the reuse is licensed without new consent, and its direction.** The pre-registered sample
size was chosen under an assumption that budgets `0.25` total disagreement between the two runs
being compared. If the instrument's own noise floor — the same model/prompt disagreeing with
itself — already exceeds that entire budget, the pre-registered `n` cannot detect the margin,
whatever the baseline-vs-candidate discordance turns out to be. This check can only ever ADD an
insufficiency reason and never remove one, so it can only make a verdict MORE conservative. A
correction that STRENGTHENS a bar needs no re-consent; one that WEAKENS it does — this sits on
the safe side of that line, which is why adding it did not itself require a new pre-registration.

**What a failed check licenses, and what it never does.** An assumption that does not survive
makes results UNDERPOWERED and NEVER relaxes the margin or `n` — recorded in the artifact's own
`sampleSizeAssumptionCheck.consequence` field, in this exact wording. UNDERPOWERED outranks PASS
structurally and can never be silently upgraded to it.

### The new input carries the same two disciplines the pre-registered one already does

**A-9, restated for this input:** at these sample sizes this instrument is a REGRESSION
DETECTOR, not a parity certifier — true of the instability check exactly as it is true of the
non-inferiority clause above. A measured instability that exceeds the ceiling makes UNDERPOWERED
more likely, not a sign that something broke; UNDERPOWERED at n=17/n=13 remains the EXPECTED
verdict shape, not a fault.

**A-7's shape, applied to the new number: the ceiling is not a budget.** An instability at or
just under the ceiling does not license a PASS on its own — the false-PASS gate and the
non-inferiority clause still have to clear independently. It merely fails to BLOCK a PASS the
other clauses have already earned. Reading "we came in under the ceiling" as itself a positive
signal is the same reassuring-direction misreading A-7 already warns against for the margin.

### The licence qualifier — correcting a pre-registered sentence without editing it

`packages/llm/src/eval/licence-qualifier.ts`'s `buildLicenceQualifier` is the SOLE constructor of
the `LicenceQualifier` field every verdict now carries. It exists because every PASS licence
Phase 85 pre-registered asserts, verbatim, that run-to-run instability was NOT measured for the
comparison — true when written, and false the moment a measurement is supplied to a verdict that
emits that clause unchanged, in the reassuring direction ("did anyone ever run the baseline?")
that nobody re-checks. The bar file cannot be edited to fix this: it is pre-registered and
digest-pinned, and a bar adjusted after the fact would destroy the guarantee the whole milestone
exists to provide. So the correction travels on the VERDICT instead:

- **`state: 'not-yet-measured'`** — the default, whenever the caller has not supplied a measured
  instability. The bar file's licence clauses stand as written; nothing is superseded.
- **`state: 'measured'`** — walks the loaded bar's `licenceStrings` object for every string
  containing the fragment `"Run-to-run instability was not measured for this comparison"`,
  ENUMERATED from the bar's own data rather than a hand-written list of three, so a fourth such
  clause added to the bar file tomorrow is found automatically. Records which clauses are
  SUPERSEDED, the observed value, and the ceiling it was checked against. Throws
  `LicenceQualifierNoSupersededClausesFoundError` if the walk finds zero clauses — a search that
  finds nothing and a search that cannot match print the same zero, and this module refuses to
  let that ambiguity stand for a field whose whole job is declaring what changed.

A verdict's `licenceQualifier.state` is cross-checked against its own
`power.runToRunInstability.state` on every parse (`assertLicenceQualifierMatchesInstabilityState`)
— a hand-edited or otherwise self-contradictory verdict document is refused rather than trusted.

### `luqen-llm eval baseline`, and why a replay replication's instability is zero by construction

`luqen-llm eval baseline --capability <name>` repeats a reference set K times (`--repeats`,
default 3, minimum 2) through the same `runHarness` `eval run` uses, and builds a
`BaselineReplicationArtifact` (`baseline.ts`, 86-03) over the resulting reports. Replay is the
default — free, deterministic, no credentials — and live mode re-proves `eval run`'s ENTIRE
four-flag-plus-environment-variable wall as a SECOND path to a real provider call: the same
`--provider-type`/`--endpoint`/`--model-id`/`--i-acknowledge-spend` flags plus
`EVAL_HARNESS_API_KEY`, refused before any adapter is built if any is missing. `eval baseline`
exposes no `--db` option, matching `eval run`.

The artifact is a DISCRIMINATED UNION with no exported path from one shape to the other:

- **`LiveBaselineReplicationArtifact`** — `mode: 'live'` (a literal type) plus a top-level
  `runFunction`, the artifact's own identity. This is the ONLY shape that may ever be read as a
  baseline of a real model. The writer, `serialiseLiveBaselineReplicationArtifact`, re-asserts
  `runFunction.mode === 'live'` at RUNTIME (the type does not survive a JSON boundary, and this
  artifact is exactly the kind of thing a later phase reads back off disk) and throws
  `BaselineArtifactRuntimeModeMismatchError` if it does not hold.
- **`SyntheticBaselineReplicationArtifact`** — `_synthetic: true` plus a `syntheticNote`, and
  deliberately NO top-level `runFunction` (the per-repeat run functions stay nested under
  `repeats`, where nothing can mistake them for the artifact's own identity).

**A REPLAY RUN IS NOT A BASELINE, and here is the precise reason.** A fixture adapter returns the
same string every time, so a replay replication's measured `instability.maximum` is EXACTLY ZERO
BY CONSTRUCTION — a number that measures the determinism of the fixture adapter, never of a
model, and reads exactly like a good result if nothing beside it says otherwise. `syntheticNote`
states this fact directly on the artifact, and the CLI's printed summary states it again as its
own labelled line, so a reader of either the file or the terminal output cannot mistake a
meaningless zero for a measured stability result. Every artifact shape — live and synthetic
alike — carries the same required `sampleSizeAssumptionCheck` field, computed by IMPORTING
`assessPower` rather than a second `value > ceiling` comparison written a second time.

### A worked example, computed by the shipped code

Three repeats, four items, `generate-fix`'s gating boolean (`exactMatch`):

| Item | Repeat 0 | Repeat 1 | Repeat 2 |
|---|---|---|---|
| item-0 | true | true | true |
| item-1 | true | false | true |
| item-2 | false | false | true |
| item-3 | false | false | false |

Pairwise disagreement counts, out of 4 items each:

| Pair | Disagreements | Rate |
|---|---|---|
| repeat 0 vs repeat 1 | 1 (item-1) | 0.25 |
| repeat 0 vs repeat 2 | 1 (item-2) | 0.25 |
| repeat 1 vs repeat 2 | 2 (item-1, item-2) | 0.50 |

Maximum = **0.50**, mean = 0.333 (context, never the gating value). Checked against the
pre-registered ceiling of `0.25` (both capabilities' `varianceAssumption[...].assumedValue` in
the committed bar), `0.50 > 0.25`: the assumption DOES NOT SURVIVE. `assessPower` reports
`sufficient: false` with the third reason (`run-to-run-instability-exceeds-ceiling`,
`observedRunToRunInstability: 0.5`, `assumedCeiling: 0.25`), and any comparison against this
baseline is UNDERPOWERED for that reason — the margin and `n` are unchanged either way.

These numbers were produced by calling `computeRunToRunInstability` (instability.ts) and
`assessPower` (verdict.ts) directly against three synthetic reports matching the table above, not
composed by hand and merely checked afterward — the exact invocation and its raw output are
recorded in `86-04-SUMMARY.md`'s claim-by-claim table.

### The root cause, so the limit is never mistaken for a defect

**The reference sets are sized for provenance quality, not statistical power.** 17 items
(`generate-fix`) and 13 items, 7 of them false-PASS opportunities (`analyse-visual`), are
enough to catch a large regression and not enough to certify near-parity. This was the right
call when Phase 83 made it — the sets exist to be trustworthy in what they measure, not to
maximise a sample size — and it is nobody's mistake. Growing the sets to buy real statistical
power is a future milestone's work. Phase 85's obligation was narrower and is met: make this
limit **visible in every verdict**, rather than let it be discovered later by someone reading a
green PASS and assuming it means more than it does.

## Standing statement

**No trusted measurement of any model's actual performance exists anywhere in this milestone.**
This is true independent of whether Phase 86 Part B (86-05) ever runs — check the re-checkable
invariant below rather than trusting this sentence to still be accurate by the time you read it.

**What Part A (86-01 through 86-04) delivered, and its limit.** The second variance quantity, its
assumption check, the licence qualifier, the discriminated-union replication artifact, `eval
baseline`, and the pre-registration ancestry check are all shipped and merged, and every one of
them has been exercised entirely against synthetic fixtures and replay-mode reports — a fixture
adapter returning committed strings, never a real provider. No green result from any of this,
including the worked example above, is evidence about any model. This is not a defect of the
instrument: it is the honest state of a mechanism proven correct on inputs it controls, and not
yet pointed at a real one.

**What is missing, and whose decision it is.** The live baseline run of the CURRENT production
pins (BASELINE-01) requires a provider credential (`EVAL_HARNESS_API_KEY`, read only from the
environment, never from a file or CLI argument) and a deliberate, authorised decision to spend
money against a real provider — both the product owner's to grant, and neither is something an
automated task can supply for itself. Phase 86 Part B (86-05) is that run; as of this commit it
has not been authorised. This is stated as neither a defect of the instrument nor as done — it is
simply what has, and has not, happened yet.

**The re-checkable invariant, so this section cannot go stale silently.** A snapshot like "the
live run has not happened yet" is a DISTANCE, not a STATE — it decays with the very next commit
that makes it false. Check the fact directly instead of trusting this prose:

```bash
# If this returns any commits, the live baseline has been recorded. Read
# packages/llm/tests/eval/baselines/README.md before trusting anything else
# in this document about whether a measurement of a model exists.
git log --oneline -- packages/llm/tests/eval/baselines/
```

An empty result means no live measurement of any model exists yet under this milestone, whatever
the prose above says by the time you read it. A non-empty result means Part B ran; 86-05's own
SUMMARY.md and the narrowed (never deleted) revision of this section it is required to write are
the record of what it found.
