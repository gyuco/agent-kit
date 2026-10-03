---
name: openspec-archive
description: "Archive a finished OpenSpec lite change: merge its spec deltas into openspec/specs and move the change to openspec/changes/archive/."
---

Gate: all tasks ticked and tests green.
Apply each delta to `openspec/specs/<capability>/spec.md` (add, replace, remove requirements), then move the change folder to `openspec/changes/archive/YYYY-MM-DD-<change>/`. Specs now describe current truth.
