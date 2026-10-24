# Devlog — Coordination basics (v0.6.0)

Date: 2026-10-24
Phase: 6 of the roadmap in `docs/PLAN.md` (coordination basics)

## What was built

**Clash engine** in the viewer package (ADR 008): per-element triangle soups from the
merged meshes, a small bounding-volume tree per element, a sorted box sweep as broad
phase, then tree-against-tree down to triangle pairs. Hard contact is an edge crossing a
face or coplanar overlap; clearance is the smallest triangle-to-triangle distance
(vertex-to-face and edge-to-edge) under the rule's gap. Runs are chunked and cancellable
and report progress. Unit tests use hand-built boxes: overlapping, touching, 0.3 m apart,
far away.

**Store.** Migration 006 adds `clash_test` (two element sets by GlobalId, a rule) and
`clash` (one row per element pair with status, note, first/last seen, resolved time).
Recording a run upserts the found pairs, reopens resolved ones that are back, and
resolves the rest; the test keeps its last run time and revision.

**Coordination section.** New test from the current selection (set A, set B, or "set B =
everything else"), hard or clearance with a gap in millimetres. Tests list with open and
total counts, run on the loaded revision with a progress bar and cancel. Results filtered
by status and grouped by the pair's IFC types; a clash selects both elements, frames
them and marks the point; statuses are set inline; "raise an issue" creates a review
issue on the pair with the current view and marks the clash reviewed.

## Measurements (debug build, 22.5 MB Revit export)

| Test | Pairs tested | Clashes | Time |
|---|---|---|---|
| Ground-floor slabs (54) vs ground-floor columns (48), hard | 54 | 50 | 273 ms |
| Re-run of the same test after approving one and raising an issue on another | 54 | 50, statuses kept (1 approved with note, 1 reviewed, 48 new) | 317 ms |
| All beams (4,015) vs all columns (851), 20 mm clearance | box-filtered | 6,874 (6,739 contacts, 135 within 20 mm) | 3.1 s |

A first attempt paired ground-floor beams with ground-floor columns and found nothing:
in this export the columns carry the storey they start on, so the "ground floor" columns
stand 50 m from the ground-floor beams. The engine was right; the sets were not. The
sanity check (slabs against columns) and the whole-model test settled it.

## Problems met

- `record_clash_run` took an `Fn` id generator; a counting closure in the test needs
  `FnMut`.
- `last_revision_id` is a foreign key; the test had to create real revisions.
- The first set capture used the storey filter above, which is a data quirk worth
  knowing for every Revit export: storeys of columns are where they start.

## Open items

- Run the engine in a worker for models an order of magnitude larger.
- Stored set rules (by type, storey, system) so a test re-targets itself on a new
  revision instead of carrying a GlobalId list.
- Penetration depth and a clash volume for hard contacts; a tolerance to ignore
  joints below a few millimetres of overlap.
- Clash report export (CSV) and a BCF export of selected clashes as topics.
