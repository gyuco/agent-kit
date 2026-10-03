---
name: speckit-tasks
description: "Break a plan into ordered, test-first tasks in specs/NNN-feature/tasks.md, marking tasks that can run in parallel with [P]."
---

Generate `tasks.md`: numbered `T001…`, tests before implementation, each task naming the files it touches. Mark independent tasks `[P]`. Group by user scenario so each group is shippable.
