# LLM scoring harness — `luqen-llm eval`

Status: **BUILT AND SEAM-TESTED, NEVER DIALLED AGAINST A REAL PROVIDER.** Shipped Phase 84
(scoring harness). No trusted measurement of any model exists yet from this tool — that starts
at Phase 86's baseline.

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

## Standing statement

Live mode has not been dialled. No live model call has ever been made by this harness. No
trusted measurement of any model's actual performance exists anywhere in this milestone yet —
Phase 86's baseline is the first one, and it is a deliberate, reviewed decision to spend
money, not a side effect of running this tool.
