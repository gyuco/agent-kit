---
name: openspec-propose
description: "Start a change in the OpenSpec lite flow: create openspec/changes/<change>/ with proposal.md, tasks.md and spec deltas. Use before changing behaviour in an existing codebase."
---

1. Read `openspec/project.md` and the relevant `openspec/specs/<capability>/spec.md`.
2. Create `openspec/changes/<verb-slug>/` with:
   - `proposal.md` — why, what changes, impact.
   - `specs/<capability>/spec.md` — **delta only**: sections `## ADDED`, `## MODIFIED`, `## REMOVED` requirements, each with at least one `#### Scenario:` (Given/When/Then).
   - `tasks.md` — checklist, tests first.
3. Ask the user to approve the proposal before implementing.
