# Phase 08: System Brand Guideline — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-05
**Phase:** 08-system-brand-guideline
**Areas discussed:** Data model scope (per-org vs per-site), consumption modes (link/clone/merge), admin UX placement, org UX placement, requirements rewrite

---

## Gray Area 1: Branding mode scope (per-org vs per-site)

**Original spec wording (SYS-02):** "Each org has a branding mode setting: 'use own', 'use system', or 'merge'"

| Option | Description | Selected |
|--------|-------------|----------|
| Per-org mode (as drafted in original spec) | Organizations table gets a `branding_mode` column; all sites in an org use the same mode. Simpler but limiting. | |
| Per-site assignment (user's position) | No per-org column. The mode is implicit in how a guideline is assigned to a site via `site_branding`. An org can have different modes on different sites. | ✓ |

**User's choice:** Per-site assignment. Literal reply: *"Brand is per site: I can have one branding guideline in my org for 3 sites, another branding guideline for 1 site and another for 6 sites. Keeping it at org level only is limiting. Each org should be capable of selecting a brand guideline they want to scan sites for."*

**Notes:** User immediately flagged the original SYS-02 wording as wrong. The reshape happened before I asked any gray-area questions. The entire phase spec was rewritten as a result. No per-org `branding_mode` column is introduced.

---

## Gray Area 2: System guideline count (single vs multiple)

**Original spec wording (SYS-01):** "a single system-wide brand guideline"

| Option | Description | Selected |
|--------|-------------|----------|
| Single system guideline (original spec) | One system guideline per instance. Matches "singular" language in SYS-01. | |
| Multiple system guidelines as a library | Dashboard admin maintains a library of templates (e.g., "Aperol", "Campari Classic", "Campari Gold"). Each org can consume any of them independently. | ✓ |

**User's choice:** Multiple. Literal reply: *"Multiple. Orgs can select a system guideline and edit it so that it becomes an org guideline, or they can import system guideline directly. System guideline should work as a template: either you take it as it is or you start from there and customise. Customised versions live only within the org itself."*

**Notes:** User also clarified the clone semantics in the same turn — "customised versions live only within the org itself" locks in the frozen-clone model (no live link after clone). The SYS-01 wording was amended from "a single" to "multiple".

---

## Gray Area 3: Consumption modes

**Original spec:** three modes — use own / use system / merge.

| Option | Description | Selected |
|--------|-------------|----------|
| Clone + Link (Recommended) | Org admins can either clone a system guideline into their org (customize freely, frozen copy) OR link a system guideline directly to a site (live, no edits). Drops merge — clone covers the customization case, link covers the as-is case. Simpler model, less code, fewer edge cases. | ✓ |
| Clone only | Orgs can only clone system guidelines. No direct linking. Every use of a system guideline produces an independent org copy. Simplest, but orgs that want to stay in sync with the parent brand must re-clone after every system update. | |
| Clone + Link + Merge (original spec) | Keep all three paths. Merge adds a live combo: org guideline primary, system guideline fallback for untouched fields. Most flexible, but adds a resolver layer to the matching pipeline and more UI surface. | |

**User's choice:** Clone + Link (Recommended).

**Notes:** Merge was dropped as overengineering. User's concrete example (Aperol + golden color → Aperol Summer) was a pure clone flow; they did not mention a merge-like use case. The phase scope shrank from 7 requirements to 6 as a result.

---

## Gray Area 4: Org admin UX — where to discover system guidelines

| Option | Description | Selected |
|--------|-------------|----------|
| System Library tab on org guidelines page (Recommended) | Extend the existing org `/admin/branding-guidelines` page with a "System Library" tab or section. Each system guideline shows with two buttons: "Link to site" and "Clone into org". Keeps the discovery in the same place where org admins already manage their branding — no new page to learn. | ✓ |
| Dedicated /admin/system-library page for orgs | New separate page just for browsing the system library. Clearer separation, but splits the org admin's mental model across two pages. | |
| Inline on the site assignment UI | When an org admin is assigning a guideline to a site, the picker lists both org guidelines and system guidelines with an import-on-use action. Most contextual but harder to discover out of context. | |

**User's choice:** System Library tab on org guidelines page.

**Notes:** Consistent with the "don't make users learn two pages" principle. Org admins already live on `/admin/branding-guidelines` when managing branding — adding a tab keeps all brand-related discovery in one place.

---

## Gray Area 5: Dashboard admin UX — where to manage system guidelines

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated /admin/system-brand-guidelines page (Recommended) | New admin page following the Phase 06 pattern (sidebar entry, admin.system gated). Listing + create/edit/delete CRUD. Clean separation from per-org guideline management, matches existing admin UX conventions. | ✓ |
| Scope toggle on /admin/branding-guidelines | Extend the existing branding-guidelines admin page with a scope switch (Org / System). One page handles both. Less code, but mixes org-scoped and system-scoped management in the same view — easier to edit the wrong thing. | |

**User's choice:** Dedicated `/admin/system-brand-guidelines` page.

**Notes:** Safety-first decision — separate pages prevent accidental cross-scope edits. Matches the Phase 06 precedent (service connections got their own dedicated page rather than being crammed into an existing admin screen).

---

## Requirements rewrite (confirmed)

User confirmed the rewritten SYS-01..SYS-06 in the reflection step (literal reply: *"1. Yes."* to "do you want me to update REQUIREMENTS.md and ROADMAP.md"). The new requirements were committed as part of this phase's context capture.

**Dropped from original spec:** SYS-07 ("orgs with no branding mode set default to use own") — no longer needed because there is no per-org branding mode; orgs with no system involvement continue to work exactly as today via the existing `site_branding` join.

**Requirement count:** 7 → 6.

---

## Claude's Discretion

Areas explicitly deferred to implementation judgment (captured in CONTEXT.md `<decisions>` as D-01..D-18 plus the `Claude's Discretion` subsection):

- Clone naming suffix (e.g., "(cloned)", "(copy)")
- "System Library" tab placement inside `/admin/branding-guidelines` (tab bar, section, panel)
- Thumbnail/preview rendering for system guidelines in the org library view
- Audit log hookup for system guideline mutations (extend if easy, defer otherwise)

---

## Deferred Ideas

- **Merge mode** (org primary + system fallback, live) — considered and explicitly dropped. Can come back as a future phase if a use case emerges.
- **Parent/child org hierarchy** — out of scope. Multiple system guidelines are the mechanism, not org hierarchy.
- **Live update notifications** — when a dashboard admin edits a linked system guideline, notify consuming orgs. Future improvement.
- **Clone drift detection** — surface "updated source available" hint on clones whose source has changed. Provenance metadata is stored, so a future phase can surface it without backfill.
- **Cross-instance export/import** — portability of system guidelines between dashboard instances. Not blocking v2.8.
