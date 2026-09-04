# LLM model selection — measured evidence and the pending pin change

Status: **RECOMMENDATION READY, NOT APPLIED.** Measured 2026-09-04 against live production.
The change requires an admin `PUT` to the running LLM service that the operator has not yet
authorised — the exact call is at the bottom of this document.

## How model selection actually works here

There is no model name in any config file. The pin lives as rows in the LLM service's own
database (`capability_assignments`), one or more per capability, ordered by `priority`
(lowest first), scoped by `org_id`. `org_id = ''` is the **universal fallback** and is what
every real scan uses — `org_id = 'system'` rows are INERT for real work.

Read the live state with `GET /api/v1/capabilities` (scope `read`).

### Live assignments as of 2026-09-04

| capability | primary | fallback |
|---|---|---|
| extract-requirements | gemini-2.5-flash | gpt-oss:120b-cloud |
| generate-fix | gemini-2.5-flash | gpt-oss:120b-cloud |
| analyse-report | gpt-oss:120b-cloud | gemini-2.5-flash |
| discover-branding | gemini-2.5-flash | gpt-oss:120b-cloud |
| **agent-conversation** | gemini-2.5-flash | **NONE** |
| **generate-notification-content** | gemini-2.5-flash | **NONE** |
| analyse-visual | gemini-2.5-flash | gemini-2.5-pro |

**Two capabilities have no fallback.** If their primary misbehaves there is nothing behind it —
the companion simply stops working. Treat any change to those two as higher-risk than the others
and rehearse the restore before making it.

## What was measured

Method: production prompt builders and production call options (temperature 0.2, **no**
`maxOutputTokens` — production sets none), called directly against the Gemini API so that no
live configuration was touched.

### generate-fix — 4 real WCAG violations from a live scan, 3 reps each

| | gemini-2.5-flash | gemini-3.7-flash |
|---|---|---|
| median latency | 9,033 ms | **2,485 ms** |
| total tokens/call | 1,939–3,709 | **640–761** |
| empty/unparseable | 0/12 | 0/12 |
| fix quality | baseline | equal or better on 4/4 |

On 1.4.3 contrast 2.5-flash ignored the tool's own recommended colour; 3.7-flash applied it. On
an empty-anchor case 2.5-flash copied a literal truncation marker (`fa fa-al...`) out of the
input context into its "fix", producing output that is not applicable. There was no case where
2.5-flash was better. **n=4 — a signal, not a proof.**

### analyse-visual (alt-text, WCAG 1.1.1) — 4 real web images with their real page context

| image (ground-truth alt) | 2.5-flash | 3.7-flash | 3.5-flash-lite |
|---|---|---|---|
| category icon (`alt=""`) | decorative, pass | decorative, pass | decorative, pass |
| sound icon (`Listen to this article`) | informational | informational | informational |
| wiki-letter icon (`alt="[icon]"`) | **issue** | **issue** | **issue** |
| sound icon (`Spoken Wikipedia icon`) | informational, pass | issue, decorative | informational, pass |

| | 2.5-flash | 3.7-flash | 3.5-flash-lite |
|---|---|---|---|
| median latency | 3,334 ms | 2,975 ms | **889 ms** |
| median total tokens | 1,657 | 2,347 | 1,927 |
| thinking tokens | 371–1,998 | 229–547 | **0 on all four** |

All three correctly flagged the known-bad `alt="[icon]"`.

### Cost: the per-token figure inverts per call, and only for text

Published rates are per 1M tokens: 2.5-flash $0.30/$2.50, 3.7-flash $0.75/$3.75. On that basis
3.7-flash looks 2.5x more expensive. **Per call on text workloads it is cheaper**, because
2.5-flash spends far more on thinking and thinking bills as output — roughly $0.0070/call vs
$0.0026/call on generate-fix.

**This does NOT generalise to vision.** On analyse-visual 3.7-flash used *more* total tokens than
2.5-flash (2,347 vs 1,657). A per-call cost advantage measured on one capability is not a
property of the model — check it per workload.

## Recommendation

1. **Text capabilities → `gemini-3.7-flash`**: extract-requirements, generate-fix,
   discover-branding, analyse-report, generate-notification-content, agent-conversation.
   Equal-or-better output, ~3.6x faster, cheaper per call, and ~8x fewer thinking tokens — which
   directly mitigates the companion truncation defect (see below).
2. **`analyse-visual` → STAY on `gemini-2.5-flash`.** Four 20px icons is not an evidence base for
   a capability whose output feeds a VPAT/ACR conformance document. 3.7-flash diverged on 1 of 4,
   in the conservative direction, but "safely wrong" is still unmeasured. This needs a labelled
   eval set with photographs, charts and complex images before anything moves.
3. **`gemini-3.5-flash-lite` is the candidate wherever latency matters and depth does not** —
   zero thinking tokens, 3.7x faster than 2.5-flash, priced identically to it, and it matched
   2.5-flash on every verdict tested. Include it in the analyse-visual eval when that happens.

## Why the truncation defect is not an argument for switching

`agent-conversation` passed `maxTokens: 2048`, and on a thinking model the thought tokens come
out of that same budget — 2.5-flash was measured using 1,400–3,200 of it on real questions,
leaving almost nothing for the answer, so replies were cut off mid-word. The Gemini adapter
already emits `finishReason: 'length'` when this happens and nothing downstream consumed it, so
truncation was invisible end to end. **That is a bug and it is fixed on its own merits.** A model
with cheaper thinking makes it rarer; it does not make it correct.

## The exact change that remains

Requires scope `admin` on the LLM service. Record the current values first — a rollback point is
a set of VALUES, never an offset:

```bash
# 1. RECORD (rollback point)
GET  /api/v1/capabilities            # scope: read

# 2. Register the model row once, under the Gemini provider
POST /api/v1/models                  # scope: admin
     { "providerId": "<gemini provider id>", "modelId": "gemini-3.7-flash",
       "displayName": "gemini-3.7-flash" }

# 3. Repoint each TEXT capability (repeat per capability; NOT analyse-visual)
PUT  /api/v1/capabilities/<name>/assign      # scope: admin
     { "modelId": "<new model row id>", "priority": 10, "orgId": "" }

# 4. ROLLBACK — the same call with the recorded original values
PUT  /api/v1/capabilities/<name>/assign
     { "modelId": "2bf50150-3fb0-40cc-a179-a9f401b129e5", "priority": 10, "orgId": "" }
```

**Before changing either no-fallback capability, RUN the rollback — do not merely know it.**
Rehearse on `agent-conversation` itself (not on a capability that degrades gracefully, which
would prove nothing), swap to an already-registered model row (so the rehearsal tests the restore
path alone and not row creation), and verify the companion answers *before* the change as well as
after — otherwise an already-broken companion reads as "the swap broke it".

As of 2026-09-04 this rehearsal has **not been run**: the harness permission classifier declined
the live-config write. No pin has been moved, and none should be until the rehearsal has actually
been executed and passed.
