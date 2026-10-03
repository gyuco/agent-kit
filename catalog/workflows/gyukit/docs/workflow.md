---
# Project settings read by every agent. Fill in the commands for this project.
commands:
  test: ""        # e.g. npm test | pytest | go test ./...
  lint: ""        # optional
  build: ""       # optional
autopilot:
  default_goal: "all ready stories done and the test command passes"
  max_stalled_iterations: 5   # stop after N consecutive iterations without progress
  max_iterations: 30          # hard cap per run
  commit: false               # true: one git commit per done story
---

# Workflow

## Status lifecycle
| Document | Statuses |
|---|---|
| PRD, architecture | `draft` → `approved` (only the user approves) |
| Epic | `planned` → `in-progress` → `done` |
| Story | `ready` → `in-progress` → `review` → `done` · also `changes-requested`, `blocked` |

## Paths
- `docs/PRD.md` — requirements (analyst)
- `docs/architecture.md`, `docs/adr/` — design and decisions (architect)
- `docs/epics/`, `docs/stories/` — plan (planner); start from `_template.md`
- `docs/reports/` — autopilot reports

## Choosing a path
- New product / significant feature → full flow.
- Bugfix, small tweak, local refactor → quick path (`quick-change`).
- "Keep going until …" → `autopilot`.
