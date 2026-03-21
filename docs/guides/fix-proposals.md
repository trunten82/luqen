[Docs](../README.md) > [Guides](../README.md#how-to-guides) > Fix Proposals Guide

# Fix Proposals Guide

How luqen generates and applies code fixes for accessibility issues.

---

## What fix proposals are

Fix proposals are auto-generated code diffs that resolve common accessibility violations. When luqen finds an issue it knows how to fix, it:

1. Maps the issue to a source file using the source mapper.
2. Locates the relevant HTML element in your code.
3. Generates an `oldText` / `newText` pair describing the change.
4. Assigns a confidence level (`high` or `low`) based on how reliably it matched the source.

---

## Supported fix rules

Luqen-agent includes built-in fix rules for these common issues:

| WCAG criterion | Issue | Fix applied |
|----------------|-------|-------------|
| **1.1.1** (H37) | Image missing `alt` attribute | Adds `alt=""` to `<img>` elements |
| **1.3.1 / 4.1.2** (H44) | Input missing label | Adds `aria-label` derived from the input's `name` attribute |
| **3.1.1** (H57) | HTML missing `lang` attribute | Adds `lang="en"` to `<html>` |

These rules handle the most frequently occurring WCAG violations. Issues not covered by a built-in rule are reported as "unfixable" — they require manual intervention.

---

## Source mapping

Before generating fix proposals, luqen maps browser-rendered HTML back to your source code.

### How it works

1. **Framework detection** — identifies the framework (React, Vue, Angular, plain HTML, etc.) by examining the repository structure.
2. **Routing strategy** — determines how URLs map to source files based on the framework's conventions.
3. **Element matching** — matches the CSS selector and HTML context from pa11y's output to a location in your source file.

### Configuring source maps

Use the `sourceMap` field in `.luqen.json` to define URL-to-file mappings:

```json
{
  "sourceMap": {
    "https://example.com/": "src/pages/index.html",
    "https://example.com/about": "src/pages/about.html",
    "https://example.com/*": "src/layouts/default.html"
  }
}
```

This is optional — luqen attempts automatic mapping first. Manual overrides are useful when the automatic mapper cannot determine the correct file (e.g., server-rendered templates, CMS-generated pages).

### Confidence levels

| Level | Meaning |
|-------|---------|
| **High** | The source file was confidently matched (framework detection succeeded, or a manual `sourceMap` entry exists). The fix is likely correct. |
| **Low** | The match is a best guess. Review the diff before applying. |

---

## Using fix proposals in the CLI

### Interactive mode

Run a scan and interactively apply fixes:

```bash
luqen fix https://example.com --repo ./my-project
```

Or apply fixes from an existing report:

```bash
luqen fix --from-report ./luqen-reports/report.json --repo ./my-project
```

The CLI presents each fix one at a time:

```
File: src/pages/index.html (line 42)
Issue: WCAG2AA.Principle1.Guideline1_1.1_1_1.H37
Description: Add alt="" attribute to image
Confidence: high
Apply fix? [y]es / [n]o / [s]how diff / [a]bort all:
```

Options:

| Key | Action |
|-----|--------|
| `y` | Apply the fix to the file |
| `n` | Skip this fix |
| `s` | Show a unified diff preview before deciding |
| `a` | Abort — skip all remaining fixes |

### Diff preview

When you press `s`, luqen shows the change in unified diff format:

```diff
--- src/pages/index.html
+++ src/pages/index.html
@@ -42,1 +42,1 @@
-<img src="logo.svg">
+<img alt="" src="logo.svg">
```

---

## MCP integration

When using luqen as an MCP server in Claude Code (or another MCP-compatible IDE), fix proposals are available through two tools:

### `luqen_propose_fixes`

Scans a URL or loads an existing report and returns all fix proposals as structured data. Your AI assistant can then review and explain each fix.

### `luqen_apply_fix`

Applies a specific fix proposal to the source file. The AI assistant can call this tool to make changes directly in your codebase.

### Typical MCP workflow

1. Ask your AI assistant: "Scan my site and propose accessibility fixes"
2. The assistant calls `luqen_scan` to run the scan
3. Then calls `luqen_propose_fixes` to generate fixes
4. Presents each fix with an explanation
5. You approve or reject each fix
6. The assistant calls `luqen_apply_fix` for approved fixes

For MCP setup instructions, see [QUICKSTART.md](../QUICKSTART.md#ide-integration).

---

## Limitations

### Issues that can be auto-fixed

- Missing attributes (`alt`, `lang`, `aria-label`) — these are structural problems with clear mechanical fixes.

### Issues that cannot be auto-fixed

| Issue type | Why |
|------------|-----|
| **Meaningful alt text** | Requires human judgement to write a useful description. The tool adds `alt=""` as a placeholder. |
| **Colour contrast** | Requires design decisions about which colour to change. |
| **Heading hierarchy** | Requires understanding of the page's content structure. |
| **Focus management** | Requires understanding of interaction design. |
| **ARIA roles and states** | Depends on the widget's intended behaviour. |
| **Reading order** | Requires understanding of visual layout vs. DOM order. |
| **Complex widgets** | Carousels, modals, and custom components need design-specific fixes. |

### Source mapping limitations

- **Server-rendered pages** — if the HTML is generated from templates (e.g., Handlebars, Jinja, ERB), the mapper may not find the template file. Use `sourceMap` overrides.
- **Single-page applications** — component-based frameworks (React, Vue) are supported, but deeply nested components may map to the wrong file.
- **CMS content** — content managed through a CMS cannot be fixed in source code. These issues must be resolved in the CMS editor.

---

## Dashboard fix proposals

The dashboard includes a **Fix Proposals** admin page (`/admin/proposals`) where administrators can view all auto-generated fix proposals across scans. This provides a centralised view of what can be automatically remediated.

---

*See also: [USER-GUIDE.md](../USER-GUIDE.md) | [scanning.md](scanning.md) | [reports.md](reports.md)*
