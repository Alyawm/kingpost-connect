# 005 — Revisions are compared by GlobalId on stored semantics, not on geometry

Status: Accepted
Date: 2026-10-24

## Context

Phase 3 needs to answer "what changed between two issues of this model?" quickly and
reliably for files of a few hundred megabytes. Every import already writes a revision
into the project database (ADR 002, ADR 003): one row per element with its type, name,
tag, storey, type name and material, and one row per property or quantity. Geometry
is not stored; web-ifc produces it in the WebView when a revision is loaded.

Engineers want the answer at the level they work at: which members were added or
removed, which sections, materials or quantities changed, and on which storey. They
also want to raise an issue on a change and to send the list to someone without the
application.

## Options

1. **Diff the database rows by GlobalId.** Elements are matched by their IFC GlobalId,
   which authoring tools keep stable across exports. Identity fields and the property
   map are compared field by field. Runs in Rust on data that is already indexed; no
   geometry is needed, so neither revision has to be loaded in the viewer.
2. **Diff the geometry.** Load both revisions, compare bounding boxes, volumes and
   positions per element. Catches moved and reshaped members whose properties did not
   change, but needs both meshes in memory (twice the viewer's cost), is slow on large
   files and gives noisy results on tolerance.
3. **Diff the STEP files textually.** Cheap but meaningless: express ids are renumbered
   on every export and attribute order carries no engineering meaning.

## Decision

Option 1. `crates/kp-diff` compares two revisions of the same file:

- matched by `GlobalId`; an id present only in the newer revision is **added**, only in
  the older **removed**, in both with any differing field **modified**;
- fields compared: IFC type, name, tag, type name, material, storey, and every
  `pset/property` pair, with numeric values compared under a tolerance of 1e-6 so
  re-exported floats do not register as changes;
- each modified item records the exact fields with their old and new values, so the UI
  and the CSV export can show "UB 406x178x54 → UB 406x178x60" rather than "changed";
- the result is stored (`diff_result`, `diff_item`, unique per revision pair) so
  reopening a comparison is a read, and recomputed on demand.

The desktop app shows the diff as a filterable list with per-type counts, colours the
loaded revision by change, exports CSV, and creates review issues from changes using the
Phase 2 data model unchanged.

## Consequences

- Comparison is independent of the viewer and of file size in memory: 7,000 elements
  with 70,000 properties compare in under a second on a laptop; the cost grows linearly
  with the number of elements and properties.
- A model whose GlobalIds are regenerated on export (some tools do this when a file is
  re-created rather than re-exported) will show everything as removed and added. The
  panel makes this visible in the summary; a name/position fallback match is a possible
  later addition and would sit inside `compare_sets` without touching storage.
- Pure geometric changes (a member moved without any property changing) are not
  detected. Base quantities (length, volume, area) usually change with geometry, which
  covers most structural cases. A bounding-box comparison can be added when geometry
  caching lands (Phase 1 open item), reusing the same `DiffItem` shape with a
  `geometry` field.
- Properties shared through a common property set (Revit type properties, for example)
  are reported on every element that uses them. That is correct for the engineer's
  question, but can produce thousands of modified items from one edit; the by-type table
  and the type filter exist for this case.
