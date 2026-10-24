# 008 — Clashes are found on the loaded meshes in the interface and tracked by element pair

Status: Accepted
Date: 2026-10-24

## Context

Phase 6 adds clash checks between two sets of elements: hard contact and clearance. The
geometry exists only in the WebView (web-ifc builds it there, ADR 003); the shell holds
the database. A clash must keep its status (reviewed, approved, resolved) across re-runs
and across revisions of the model, and an issue must be raisable from it.

## Options

**Where the geometry test runs**
1. **In the interface, on the loaded meshes**, with a bounding-volume tree per element and
   triangle tests, chunked so the window stays responsive.
2. In Rust, from a geometry cache written at import. There is no geometry cache yet
   (Phase 1 open item), and shipping triangles over IPC for every run costs more than the
   test itself on this size of model.
3. A third-party collision library in the WebView. The test needed here is small
   (box trees, triangle intersection and distance) and a dependency would bring its own
   geometry formats.

**Clash identity**
1. **The unordered element pair (GlobalIds) within a test.** A run upserts found pairs
   and marks the rest resolved; statuses and notes stay on the pair.
2. A fresh list per run. Statuses would have to be matched back by hand.

## Decision

Options 1 and 1.

- `packages/viewer/src/clash.ts`: each element becomes a triangle soup in world space (read
  from the full index, so hidden elements count) with a tree over its triangles. Pairs
  pass a box test inflated by the clearance, then tree against tree; a hard clash is two
  intersecting triangles (an edge crossing the other face, or coplanar overlap, so touching
  faces count), a clearance clash is two triangles closer than the clearance. The point
  reported is on or between the closest features. Batches yield to the event loop and a
  run can be cancelled.
- A clash test names two sets by GlobalId and a rule. Runs record what was found; the
  shell keeps one row per pair with a status (`new`, `active`, `reviewed`, `approved`,
  `resolved`), a note, when it was first and last seen, and the revision of the last run.
  A pair not found again is resolved; a resolved pair found again becomes active.
- Raising an issue from a clash selects both elements, captures the view and labels the
  issue `clash`; the clash becomes `reviewed`.

## Consequences

- Sets are element lists, so a test survives re-import: elements absent from the loaded
  revision are skipped and reported. Choosing sets by rule (every beam against every
  column) is a one-click capture in the panel, not a stored rule; stored rules can come
  later without changing the clash table.
- Cost is pairs × triangles. All beams against all columns of the sample model (4,015 ×
  851, 6,874 contacts) runs in about three seconds; models an order of magnitude larger
  will want the test in a worker, which the chunked design allows.
- Touching faces are hard contacts. In a model where beams end on column faces that is
  every joint, which is correct and noisy; the per-type grouping and the approved status
  with a note are how that noise is settled once.
- Penetration depth is not computed; a hard clash reports distance 0 and a point.
