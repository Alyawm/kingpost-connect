# Architecture decision records

Each file records one decision that shapes the codebase: the situation that forced it,
the options that were on the table, what was chosen and what that costs. Records are
numbered in the order they were made and are never rewritten; a reversed decision gets a
new record that supersedes the old one.

Read them in order to understand why the code looks the way it does.

| # | Title | Status |
|---|---|---|
| [001](001-desktop-stack.md) | Desktop stack: Tauri, React, three.js, SQLite | Accepted |
| [002](002-project-storage.md) | A project is a folder with a `.kingpost/` directory | Accepted |
| [003](003-ifc-property-pipeline.md) | Where IFC properties are parsed: Rust reader for semantics, web-ifc for geometry | Accepted |
| [004](004-review-data-and-bcf.md) | Review data in BCF terms; viewer coordinates converted at the edge | Accepted |
| [005](005-revision-comparison.md) | Revisions compared by GlobalId on stored semantics, not geometry | Accepted |
| [006](006-analysis-models.md) | One analysis model shape for every source; linking by axis, not by geometry | Accepted |

## Template

```markdown
# NNN — Title

Status: Proposed | Accepted | Superseded by NNN
Date: YYYY-MM-DD

## Context
What situation and constraints forced a decision.

## Options
What was considered, with the material trade-offs.

## Decision
What was chosen, stated plainly.

## Consequences
What becomes easier, what becomes harder, what must be revisited and when.
```
