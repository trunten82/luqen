# Prompt Templates Guide

> Authoring and overriding LLM prompt templates in Luqen — locked sections,
> fence markers, the validator, and the override workflow.

This guide is for org admins and power users who want to customise the
prompts that drive Luqen's AI capabilities. End users rarely need to read
this; they interact with the [agent companion](./agent-companion.md) and
report-detail flows that consume these templates.

## Overview

Luqen's `@luqen/llm` service ships a default prompt template for every AI
capability:

| Capability / prompt id | What it drives |
|---|---|
| `extract-requirements` | Pulling WCAG requirements out of regulation pages |
| `generate-fix` | AI fix suggestions on report-detail issues |
| `analyse-report` | Executive summary on a scan report |
| `discover-branding` | Auto-detection of brand colours, fonts, logo |
| `agent-system` | The system prompt that frames every dashboard agent turn |

The defaults live in `packages/llm/src/prompts/` (one file per
capability). Org admins can override any of them — except `agent-system`,
which is system-only — through the dashboard at `/admin/llm` →
**Prompts** tab. Overrides are stored per-org and merged at runtime: the
service serves `org_id`'s override if present, otherwise the system
default.

Why locked sections exist: defaults contain fragments that the capability
engine **must** see verbatim — JSON output schemas, runtime variable
injection (`{{wcagCriterion}}`, `{{htmlContext}}`, etc.), agent safety
guardrails. The validator enforces those fragments are preserved when an
admin saves an override. The rest of the template — tone, examples,
prose framing — is freely editable.

## Locked sections

A **locked section** is a contiguous block of template content that an
override must reproduce byte-for-byte. The validator rejects any save
that:

- **Drops** a locked section that exists in the default
- **Modifies** the bytes inside a locked section
- **Renames** a locked section (treated as missing)
- **Reorders** locked sections relative to the default

Extra locked sections in an override that are not in the default are
ignored — admins can add their own scaffolding.

In the dashboard's split-region prompt editor (`/admin/llm` → **Prompts**)
locked sections render as read-only cards interleaved with editable
textareas, so what you can and can't change is visible at a glance. The
section name appears in the card header alongside a tooltip explaining
why it is locked (e.g. "This section defines the required JSON response
schema. The capability engine cannot parse responses without it.").

## Fence markers

Locked sections are demarcated with HTML-comment fence markers — chosen
because Markdown renderers strip them, the LLM tokenises them as comments
(low semantic noise), and they're safe to embed in any prompt body.

**Exact syntax:**

```
<!-- LOCKED:section-name -->
...content...
<!-- /LOCKED -->
```

Rules:

- The opening fence carries a **kebab-case name** matching
  `[a-z0-9][a-z0-9-]*[a-z0-9]` (or a single char). Names are
  case-sensitive and must be unique within a template.
- The closing fence is the literal `<!-- /LOCKED -->` — no name on close.
- Whitespace inside the fence comments is significant: `<!-- LOCKED:foo -->`
  exactly, not `<!--LOCKED:foo-->`.
- Blocks may not nest. Open + close counts must balance — if they don't,
  the parser falls back to treating the whole template as one editable
  segment (graceful, no save error from the parser; the validator will
  still flag the missing locked sections).

The two reserved section names you'll see most often (with built-in
explanations exposed by the API):

- `output-format` — the JSON response schema the capability engine
  parses against
- `variable-injection` — runtime substitutions like `{{wcagCriterion}}`,
  `{{htmlContext}}`, `${context.regulationId}`

Capability authors add others (`rbac`, `confirmation`, `honesty` for the
agent system prompt, etc.). Each gets its own kebab-case name and
appears in the editor with its tooltip.

## The validator

Validation runs **server-side at save time** — there is no separate CLI
target. The PUT endpoint is:

```
PUT /api/v1/prompts/:capability    # @luqen/llm
```

It requires the `admin` OAuth scope. Body:

```json
{
  "template": "...full template text...",
  "orgId": "<org-uuid>"
}
```

Outcomes:

- **200 OK** — override saved; response echoes `{ capability, orgId,
  template, isOverride: true, updatedAt }`.
- **400 Bad Request** — body shape wrong, capability id invalid, or
  `agent-system` with `orgId` set (not allowed).
- **422 Unprocessable Entity** — locked-section validation failed. The
  body lists every violation:

  ```json
  {
    "error": "Cannot save: locked section 'output-format' was modified.",
    "violations": [
      {
        "name": "output-format",
        "reason": "modified",
        "explanation": "This section defines the required JSON response schema. The capability engine cannot parse responses without it."
      }
    ],
    "statusCode": 422
  }
  ```

  Reasons: `missing`, `modified`, `renamed` (reported as `missing`), or
  `reordered`.

The same byte-exact validator powers the dashboard editor's pre-save
client-side check, so admins see the violation banner before the request
hits the server.

To exercise the validator locally:

```bash
# Start the LLM service
cd packages/llm && npm run start

# Save an override (use a real Bearer with admin scope)
curl -X PUT http://localhost:4200/api/v1/prompts/generate-fix \
  -H "Authorization: Bearer ${LUQEN_BEARER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{ "template": "...", "orgId": "org_123" }'
```

The unit tests at `packages/llm/src/prompts/__tests__/segments.test.ts`
cover every parser + validator path.

## Override workflow

1. **Read the default.** Navigate to `/admin/llm` → **Prompts** and pick
   a capability tab. The editor pre-loads the default template with
   locked sections rendered as read-only cards.

2. **Pick a scope.** A scope selector at the top of the panel chooses
   between the system-wide default (admin.system only) and a specific
   org's override. Changing scope reloads the editor.

3. **Edit the editable segments.** Locked cards can't be modified;
   editable textareas between them carry your prose. The "Compare with
   default" link opens a side-by-side diff modal.

4. **Save.** The save button POSTs to `PUT /api/v1/prompts/:capability`
   with your scope and the assembled template.

5. **Validation feedback.** On 422, the editor shows the violation banner
   listing each broken locked section, its reason
   (`missing` / `modified` / `reordered`), and the built-in explanation.
   Fix and re-save.

6. **Active overrides take precedence immediately.** The next capability
   call from the affected org reads the new template — no service
   restart required. Other orgs keep using the default.

7. **Reset to default.** The **Reset to default** button on each prompt
   triggers a confirmation modal. Confirming sends
   `DELETE /api/v1/prompts/:capability?orgId=…`, which deletes the row;
   subsequent calls fall back to the default.

8. **Stale overrides.** When the system default is upgraded, existing
   overrides are checked against the new locked sections. Any override
   that no longer validates is flagged stale and the editor surfaces a
   **Migrate** button. Clicking it opens the editor pre-loaded with the
   stale text and the new defaults' locked cards inserted; resave to
   complete the migration.

## Examples

### Example 1: minimal valid template

A capability with one locked section enforcing a JSON output schema:

```
You are a WCAG accessibility analyst. Suggest a fix for the issue below.

<!-- LOCKED:output-format -->
Respond with valid JSON matching:
{
  "fix": "<short imperative description>",
  "snippet": "<corrected HTML/CSS>"
}
<!-- /LOCKED -->

## Issue
{{issueMessage}}

## HTML context
{{htmlContext}}
```

This template parses into three segments — editable preamble, the
`output-format` locked block (verbatim), editable trailer with runtime
variables. An override could rewrite the preamble and trailer freely; it
cannot touch the JSON schema between the fences.

### Example 2: override preserving one locked section

Default (system):

```
You are a regulation analyst.

<!-- LOCKED:variable-injection -->
## Regulation Context
- Regulation ID: ${context.regulationId}
- Regulation Name: ${context.regulationName}
<!-- /LOCKED -->

Extract the WCAG requirements.
```

Org override (saved at `PUT /api/v1/prompts/extract-requirements` with
the org's `orgId`):

```
You are a senior regulation analyst writing for a compliance team that
already understands WCAG vocabulary. Be terse; skip the basics.

<!-- LOCKED:variable-injection -->
## Regulation Context
- Regulation ID: ${context.regulationId}
- Regulation Name: ${context.regulationName}
<!-- /LOCKED -->

Extract the WCAG requirements. Where the regulation is silent on a
clause, infer the closest WCAG 2.2 Level AA mapping and flag it.
```

The validator passes: `variable-injection` is byte-identical and in the
same position; only the surrounding editable text changed. A subsequent
extraction call from this org now uses the override; other orgs keep
using the default.

If an admin tried to delete the variable-injection block, or change a
single character inside it, the save would 422 with
`{ "name": "variable-injection", "reason": "modified" }` and the editor
would refuse.

## See also

- [Agent companion guide](./agent-companion.md) — what the
  `agent-system` prompt drives
- [RBAC matrix](../reference/rbac-matrix.md) — `llm.manage` permission
  required for prompt editing
