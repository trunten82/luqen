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

## `analyse-visual.ts:51-53` — measured, named, and deliberately left unpatched

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

No measurement of any model exists anywhere in this milestone yet. Phase 86's baseline is the
first one, and it is the first real exercise of both the harness (Phase 84) and the verdict
layer (Phase 85) together. In particular, every PASS licence sentence above names an unmeasured
quantity explicitly: "Run-to-run instability was not measured for this comparison. A PASS whose
noise floor is unknown licenses less than one whose noise floor is known." That quantity — the
same model and prompt run repeated, measuring its own non-determinism at fixed temperature, a
**different** quantity from the discordant-pair-rate assumption above — is exactly what Phase
86 supplies. Until it does, every PASS this instrument can produce carries that caveat.

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

Live mode has not been dialled. No live model call has ever been made by this harness. No
trusted measurement of any model's actual performance exists anywhere in this milestone yet —
Phase 86's baseline is the first one, and it is a deliberate, reviewed decision to spend
money, not a side effect of running this tool.
