## Workflow: BMAD lite
Agile team of personas, all in `docs/`:
1. **bmad-analyst** → `docs/brief.md` → 2. **bmad-pm** → `docs/prd.md` (epics + story titles) → 3. **bmad-architect** → `docs/architecture.md`
4. Loop per story: **bmad-sm** drafts the *next* story only → user approves → **bmad-dev** implements test-first → **bmad-qa** gate.
Each step starts only when the previous document is `approved` by the user. Stories embed their own context: developers read the story, not the whole PRD.
