# 004 — Review data lives in BCF terms; viewer coordinates are converted at the edge

Status: Accepted
Date: 2026-10-24

## Context

Phase 2 adds issues, comments, viewpoints and element design status. Structural teams
exchange issues with other tools (BIMcollab, Solibri, Revit and Tekla plugins) through
BCF, and the plan's acceptance test is a BCF that round-trips with those tools. Two
representations compete: the viewer's (three.js, Y up, model moved to the origin by
web-ifc) and BCF's (IFC world coordinates, Z up, metres).

## Options

**Store viewer coordinates, convert on export.** Natural for the interface; every export
and import needs the model loaded to know the coordination offset, and viewpoints saved
against one import become wrong if the offset changes.

**Store BCF coordinates, convert when applying.** Export is a straight copy; a stored
viewpoint is meaningful without the model and across re-imports; applying needs the
loaded model's coordination matrix, which is exactly when a viewpoint is applied anyway.

## Decision

- Issues follow BCF topics (`issue` table: type, status, priority, labels, stage, due,
  assignee, authorship) and are keyed by their own guid; element links are IFC GlobalIds.
- Viewpoints are stored as JSON in BCF terms: perspective camera (view point, direction,
  up, field of view, aspect) in IFC world coordinates, components (selection, visibility
  exceptions, colouring) as GlobalIds, markup lines and clipping planes in IFC
  coordinates, snapshot as JPEG.
- `IfcFrame` in the viewer package owns the conversion: `viewer = N · C · ifc`, where
  `C` is web-ifc's coordination matrix (translation to origin) and `N` maps
  (x, y, z) → (x, z, −y). Capturing a viewpoint applies the inverse; applying one applies
  the forward map. Nothing else in the application knows about the axis swap.
- `crates/kp-bcf` is a pure codec: writes BCF 3.0, reads 2.1 and 3.0 by element name
  rather than schema position, keeps snapshots as bytes. The database mapping lives in
  the shell's `commands/review.rs`.
- Element design status (modelled → analysed → designed → checked → approved) is a
  project-level fact keyed by GlobalId, set in bulk from the current selection; it is not
  part of BCF and stays in the project database.

## Consequences

- Export needs no model loaded; import stores topics without touching geometry; the
  first "apply" after import positions the camera through the frame of whatever model is
  loaded, which is right when it is the same model and visibly wrong when it is not.
- The orthogonal camera is read but not produced; it is mapped onto the perspective
  camera when imported.
- Topic guids are the dedup key on import: a topic already present is skipped, never
  merged. Merging comments into existing topics is future work.
- Interoperability with other tools is asserted by the codec's tests and the archive
  layout, not yet by opening the file in those tools; that check is on the Phase 2 list.
