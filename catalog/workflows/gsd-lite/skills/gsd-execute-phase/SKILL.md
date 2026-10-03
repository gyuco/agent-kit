---
name: gsd-execute-phase
description: "Execute a GSD lite phase plan by plan, ideally each in a fresh context/subagent, committing per plan."
---

For each plan in `PLAN.md`: start from a clean context (subagent if available), implement, run its verification, commit `phase NN plan K: …`. Write `SUMMARY.md` and update `STATE.md`.
