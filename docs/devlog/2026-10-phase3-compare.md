# Devlog — Revision comparison (v0.3.0)

Date: 2026-10-24
Phase: 3 of the roadmap in `docs/PLAN.md` (revision comparison)

## What was built

**Diff engine.** `crates/kp-diff` compares two revisions of the same file from the
project database, without geometry. Elements are matched by GlobalId and classified as
added, removed or modified; a modified element lists every identity field and
`pset/property` that differs, with old and new values formatted with their units.
Numeric values are compared under a tolerance so float noise from re-export is ignored.
Results are summarised (counts overall and per IFC type) and stored per revision pair in
`diff_result` / `diff_item`, so a comparison is computed once and read afterwards. ADR 005
records why the diff runs on stored semantics rather than on meshes or STEP text.

**Store.** `kp-store::diff` adds the property-fact reader (one flat row per property of a
revision) and the diff result tables' read, write and lookup. Writing a new result for a
pair replaces the old one inside a transaction.

**Desktop.** A Compare section in the rail: pick a file with two or more revisions, pick
the two revisions (the last two are preselected), compare. The results show four counters
that double as filters, unchanged and total element counts, a per-type table (click a row
to filter), a text filter, and the item list; a modified item expands to its field-level
changes. "By change" colours the loaded revision green/amber/red/grey through the same
legend mechanism as colour by type or status; "load rev N" brings either revision into the
viewer. Items select and frame their element when it is in the loaded revision. The list
is capped at 500 rows with a hint to narrow or export; CSV export writes one line per
changed field through the native save dialog. "issue" on any row creates a review issue
titled after the element and change, with the element linked, the current view attached
as a viewpoint and a `revision change` label, and switches to the Review section.

## Measurements (debug build, 22.5 MB Revit export, 6,900 elements, 70,000 properties)

| Step | Time |
|---|---|
| Import of the second revision | 2.0 s |
| Compare (cold, including storing the result) | 790 ms |
| Compare (stored result) | 126 ms |
| Load the newer revision into the viewer | 1.4 s |

The acceptance target is two 200 MB revisions in under 30 s. Cost is linear in elements
and properties, which puts a 200 MB file around 8 s; this has not been measured on a real
file of that size yet (no such sample on this machine) and stays an open item.

## Test method

The second revision was made by editing a copy of the sample: one column renamed and its
length quantity changed, one beam added, two beams removed, and one `Reference` property
value edited. The comparison reported exactly those: 1 added, 2 removed, the column with
two field changes, and 3,693 beams modified — the edited property sits in two property
sets that the Revit export shares across every beam of that type, so each of them really
did change. That case is what the by-type table and the type filter are for.

## Problems met

- A zustand selector that filtered the item list returned a new array each render; React
  treated it as a changed snapshot and the panel re-rendered until the tree unmounted.
  The filter now runs in `useMemo` over primitive selections.
- A test assumed SQLite hands out a new rowid after a delete; it reuses the highest one.
  The test now asserts what matters: one stored result per pair, with the items replaced.

## Open items

- Measure on a 200 MB file; add a bounding-box comparison once geometry caching exists.
- Fallback matching by name and position for files whose GlobalIds are regenerated.
- Side-by-side viewports (the plan lists them); the overlay colouring covers the
  review case and side-by-side waits for the viewer's multi-view work.
