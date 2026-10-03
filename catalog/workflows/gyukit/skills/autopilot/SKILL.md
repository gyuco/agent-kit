---
name: autopilot
description: "Run the gyukit workflow autonomously until a goal is reached (e.g. \"all tests pass\", \"epic E01 done\"), looping coder → verify → reviewer → fixes, and stopping on goal or when progress stalls. Use when the user asks to work autonomously, \"until tests are green\", or to finish stories/epics without supervision."
---

# Autopilot

Work without asking for confirmation until the **goal** is met or a **stop condition** fires.

## 1. Set up
- Read `docs/workflow.md` → `commands`, `autopilot` limits, `goal` default.
- Goal = what the user said; otherwise `autopilot.default_goal`. Write it down precisely as checks that can be run, e.g.
  `goal: all ready stories of E01 are done AND "npm test" exits 0`.
- Scope = stories in the goal (default: all `ready` / `changes-requested` stories, by ID, respecting `depends_on`).
- Gates still apply: if the scope needs a PRD/architecture that isn't approved, **stop** and report — do not approve documents yourself.

## 2. Loop (one story at a time)
For the next story in scope:
1. **Code** — act as the `coder` agent (delegate to it if subagents exist): test-first, until its `verify` passes → `status: review`.
2. **Verify** — run the story's `verify` commands and the goal checks. Append the result to the story's *Run log* (iteration, command, pass/fail, 1-line summary).
3. **Review** — act as the `reviewer` agent (delegate if possible). `done` → next story. `changes-requested` → back to step 1 with the findings.

After every iteration evaluate **progress**: a story changed status forward, or fewer failing checks/tests, or fewer open blocker findings.

## 3. Stop conditions
Stop the loop when **any** is true:
- ✅ Goal met — all goal checks pass and every story in scope is `done`.
- ⛔ `autopilot.max_stalled_iterations` consecutive iterations without progress (default 5).
- ⛔ `autopilot.max_iterations` total iterations (default 30).
- ⛔ A decision is needed that changes requirements, architecture, adds a major dependency, or deletes data/user code → mark the story `blocked`.

## 4. Report
Write `docs/reports/autopilot-YYYY-MM-DD-HHMM.md`:
- goal and final state of each check
- stories done / blocked, iterations used
- for each blocked item: what was tried, the evidence (failing output), the decision needed with 2–3 options and your recommendation.

Then give the user a 5-line summary pointing to the report.

## Allowed autonomously
Small implementation decisions (record them in *Dev notes*), adding tests, fixing review findings, running project commands from `docs/workflow.md`.
If `autopilot.commit: true` and the repo uses git: one commit per done story, message `<story-id>: <title> (FR-x, FR-y)`.

## Never
Approve PRD/architecture, change acceptance criteria, weaken/skip/delete tests, disable checks, push, deploy, or touch secrets — even if that would reach the goal faster.
