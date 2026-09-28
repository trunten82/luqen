# Recorded baselines — v3.7.0, Phase 86

These are the **first trusted measurements** this milestone produced. Everything before them was
synthetic and labelled as such.

## What produced them

Run on **lxc-luqen** (production host) on **2026-09-07**, against the **live production pins**, using
the provider credential already present on that host. Spend authorised by the product owner,
2026-09-06, answered directly in session and recorded on the register.

The pins were read from the **live capability assignments on production**, not from a document:

| capability | primary pin | provider | fallback (not measured) |
|---|---|---|---|
| `generate-fix` | `gemini-2.5-flash` | gemini | `gpt-oss:120b-cloud` (local ollama) |
| `analyse-visual` | `gemini-2.5-flash` | gemini | `gemini-2.5-pro` |

Every report carries its full `RunFunction` — model id, prompt version, temperature, harness
version, set name and version, item count, and an endpoint **fingerprint** rather than a URL. That
is what makes *"has this baseline quietly stopped describing production?"* a question a reader
**runs** rather than remembers: compare a new run's `RunFunction` against these, and the runner
refuses to compare across a differing one.

## The results

| capability | repeats | items | run-to-run instability | ceiling | assumption |
|---|---|---|---|---|---|
| `generate-fix` | 3 | 17 | **0** | 0.25 | survives |
| `analyse-visual` | 3 | 13 | **0.2308** | 0.25 | survives, by 0.019 |

**`generate-fix`'s zero is measured, not degenerate.** The three repeats produced three *different*
raw responses (distinct sha256 over the concatenated `rawText`; 9653 / 10186 / 9388 chars), so the
model was genuinely called three times and wrote different prose each time — and all three scored
`exactMatch` 4/17. The prose varied; the scored outcome on the gating axis did not. A replay run's
zero would be zero *by construction* (a fixture adapter returns the same string every time); this
one is not, and the distinction is the whole reason the repeats are committed beside the figure.

**`analyse-visual` sits 0.019 under its ceiling.** Roughly 3 of 13 items change verdict between
identical runs. The pre-registered sample-size assumption survives, but only just — a small
increase would flip a future run to UNDERPOWERED, which is the designed behaviour and not a fault.

## What these do NOT license

The ceiling above is a **REUSE of a differently-named quantity's number** — the pre-registered 0.25
is a McNemar discordant-pair rate (D-85-5), adopted here because it can only ever *tighten* a
verdict, never loosen one. **It is NOT a pre-registered instability threshold.** A future milestone
wanting a real instability bar pre-registers one.

This instrument is a **regression detector, not a parity certifier** — see
`docs/guides/llm-eval-harness.md`. Power to certify a genuinely identical candidate is 0.103 (n=17)
and 0.176 (n=13), **COMPUTED under the ASSUMED 0.25** discordant-pair-rate ceiling pre-registered in
`decision-bars.v1.json` — an assumption, not a measurement — so UNDERPOWERED is the expected verdict
for most real comparisons.

**Measured on 2026-09-28 from the committed repeats (quick 260928-863):** for `generate-fix` the
self-discordance is **0**, and an identical candidate PASSed all 6 ordered self-comparisons of the
production pin against itself — for this capability the 0.25 assumption is conservative. In the
other direction, `analyse-visual`'s false-PASS count across the three identical runs was
**`falsePass = 0, 1, 2`**, which lets a production-identical candidate FAIL the pre-registered
false-PASS gate on noise alone (3 of 6 ordered self-comparisons FAILed on the gate, 2 PASSed, 1 was
UNDERPOWERED) — see `docs/guides/llm-eval-harness.md`'s false-PASS noise disclosure for the full
detail and why the v1 bar is not changed.

## Cost, and the prediction it was scored against

Pre-registered before the run: **$0.1501** for 90 calls, from `pricing.ts:69`
(`gemini-2.5-flash`, $0.0003/1k in, $0.0025/1k out) **read on 2026-09-06**. That row is a locally
cached copy of a vendor price with no freshness field and has been wrong by 8× once before — treat
any figure derived from it as decaying.

Actual, computed from the committed artifacts: **~$0.0607**, i.e. **0.40×** the prediction.

The assumption that moved was **not the one predicted**. Image tiling (input) was named as the
softest; it was not the driver. **Output length was**: 143 tokens/call actual against 700 predicted
for `generate-fix` (0.20×), and 111 against 300 for `analyse-visual` (0.37×). The direction was
called correctly — an over-estimate was judged likelier than an under-estimate — but the cause was
misattributed.

**Honest limit on that figure:** output tokens are measured from these artifacts; **input tokens are
still the pre-registered assumption**, because the harness writes its usage telemetry to an
ephemeral in-memory database that dies with the process (a deliberate T-84-02 mitigation, so a
baseline run cannot pollute production telemetry). So the actual is itself part-estimate, and is
labelled that way rather than presented as a billing measurement.
