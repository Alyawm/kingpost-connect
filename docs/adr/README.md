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
| [007](007-drawings.md) | Sheets read and compared in the interface with pdf.js; links follow sheet numbers | Accepted |
| [008](008-clash-detection.md) | Clashes found on the loaded meshes in the interface and tracked by element pair | Accepted |
| [009](009-updates-licensing-diagnostics.md) | Updates only on request, licences checked offline, diagnostics stay local | Accepted |
| [010](010-schedules.md) | Schedules are definitions evaluated in Rust; geometry quantities come from the viewer once | Accepted |
| [011](011-element-appearance.md) | Appearance overrides painted in the merged meshes; see-through elements in companion meshes; views by GlobalId | Accepted |
| [012](012-section-planes.md) | Section planes as point and normal toward the removed side; handles drawn in a second pass | Accepted |
| [013](013-reference-models.md) | One main model with full features; reference models aligned by their IFC frames | Accepted |
| [014](014-sync-change-log.md) | Sync by a per-row change log recorded with triggers; shared folders as the first transport | Accepted |

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
