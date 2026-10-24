# Devlog — Private beta (v0.2.0-beta)

Date: 2026-10-24
Phase: 2 of the roadmap in `docs/PLAN.md` (structural review workflow)

## What was built

**Issues as BCF topics.** The `issue` table was extended (migration 003) with the fields
BCF carries — type, labels, stage, modification authorship — and gained `issue_viewpoint`.
Issues point at elements by IFC GlobalId, so they survive re-imports. The shell exposes
create/update/delete, comments, viewpoints, statuses and BCF export/import as commands;
`kp-store::review` holds the SQL with tests for counts, partial patches (an explicit `null`
clears a field, an absent field leaves it alone) and cascade deletes.

**BCF codec.** `crates/kp-bcf` writes 3.0 archives (`bcf.version`, `extensions.xml`,
`project.bcfp`, one folder per topic with `markup.bcf`, viewpoint files and snapshots) and
reads 2.1 and 3.0 by element name, so the different nesting of comments and viewpoints
between the versions does not matter. Tests write a full archive, read it back and compare
every field, check the archive layout, and read a hand-written 2.1 archive.

**Coordinates.** `IfcFrame` maps viewer space to IFC world space from web-ifc's coordination
matrix and the Y-up axis swap. Viewpoints are captured and stored in IFC coordinates and
converted back when applied, so a viewpoint survives re-import and is what other tools
expect. ADR 004 records the choice.

**Interface.** The Review section: author field, dashboard (open/closed/overdue, design-status
coverage bar with "colour by status"), status pipeline buttons for the selection, new-issue
form (links the selection, attaches the current view with snapshot), issue list with filters
and search, issue detail with editable fields, linked elements ("Select in 3D"), viewpoint
cards and comments with optional viewpoints. Multi-select by Ctrl+click in viewport and
tree; the inspector shows the element's status; a markup tool draws lines that travel with
viewpoints.

## Verified in the running application

Against the project model (6,922 elements): three ground-floor beams were multi-selected and
set to *designed*; the legend read `designed: 3`; an issue was created from the selection
with a viewpoint (3 linked elements, 1 viewpoint); a comment added a second viewpoint; after
moving to a top view and clearing the selection, applying the first viewpoint restored the
camera to the same position (to the centimetre) and the three-element selection; the
project exported to `issues-export.bcf` (1 topic, 2 viewpoints with snapshots, 1 comment)
and importing the same file skipped the existing topic. The archive's `markup.bcf` and
`viewpoint.bcfv` were inspected by hand: camera at (−69.0, −29.1, 12.8) with up (0, 0, 1),
GlobalIds in the selection, comment linked to its viewpoint guid.

## What was harder than expected

- Snapshots came back blank: WebView2 clears a WebGL canvas's buffer before `drawImage`
  can read it unless `preserveDrawingBuffer` is set. Rendering on demand keeps the cost
  invisible.
- BCF 2.1 and 3.0 share element names but not nesting, and case-insensitive matching
  made `<ViewPoint>`, the `<Viewpoint>` file-name element inside it, and a comment's
  `<Viewpoint Guid/>` link look alike. References are now recognised by shape (a guid and
  a file name), labels by both forms.
- The sandboxed shell on this machine refuses to run freshly built executables; Rust
  tests run in the developer's own terminal.

## Open items

- Open the exported BCF in BIMcollab or Solibri to confirm round-trip (no licence here).
- Markups beyond straight lines (clouds, text); comment merging on import; orthogonal
  camera export.
- Phase 1 leftovers still queued: geometry cache for warm opens, box selection,
  transparency, drag-and-drop import, the 200 MB+ measurement.

## Next

Phase 3 — revision comparison: import a new revision, diff by GlobalId (added, removed,
modified properties and geometry), side-by-side and overlay views, issues from changes.
