---
name: quick-change
description: "Fast path for small changes (bugfix, small tweak, refactor) that skips PRD and architecture — one quick story, implemented test-first and reviewed. Use when the request is small and doesn't change requirements or architecture."
---

# Quick change

## Is it quick?
Yes if **all** hold: no new component/service, no new dependency, no data-model or public-API change, no change to PRD requirements, fits one focused session.
Otherwise say so and use the full flow (analyst → architect → planner).

## Steps
1. **Plan** (planner role): create `docs/stories/Q-NNN-slug.md` from `docs/stories/_template.md` with `type: quick`, `status: ready`. For a bug, the first acceptance criterion reproduces it.
2. **Code** (coder role): failing test first (for a bug: a test that reproduces it), then the fix, then `verify`.
3. **Review** (reviewer role): checklist from the reviewer agent → `done` or `changes-requested`.

If during the work the change turns out not to be quick (touches architecture or requirements), stop, set `blocked`, and recommend the full flow.
