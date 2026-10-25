# 011 — Appearance overrides in the merged meshes; views by GlobalId

Status: Accepted
Date: 2026-10-25

## Context

Users want to recolour and fade elements, alone or as explorer groups, and keep those
looks in saved views. The viewer merges a model into one mesh per material (ADR 001,
phase 1) so a 7,000-element model draws in a few dozen calls. Colours are painted per
vertex; hiding rewrites the index buffer. Transparency does not fit either: the merged
meshes are opaque and write depth, and per-vertex alpha in an opaque mesh is ignored.

Saved views stored hidden elements by express id, which only holds within one revision.

## Options

1. **One mesh per element when it gets an override.** Simple, but a group recolour of
   thousands of elements would add thousands of draw calls.
2. **Make every merged mesh transparent with RGBA vertex colours.** One code path, but
   opaque geometry would lose depth writes and sort badly; the whole model would look
   wrong to make a few elements see-through.
3. **Colour in the existing colour attribute; see-through elements moved to a companion
   mesh per material** that shares positions and normals, has its own RGBA colours and an
   index of just those elements, drawn after opaque geometry without depth writes.

For views: keep express ids, or record GlobalIds.

## Decision

Option 3. Colour overrides sit between selection and colour-by tints in the paint order
(selection, override, tint, base). An element with opacity below 1 leaves the opaque
index and joins its bucket's companion index; picking maps faces back through whichever
index was hit. Only elements whose look changed are repainted, so small edits stay cheap
after "ghost others" puts an override on every element.

Views record hidden elements and overrides by GlobalId (grouped by look, or the visible
set when most is hidden), and still write the old express-id list for earlier builds.

## Consequences

- Draw calls grow by at most one per material, and only for materials with see-through
  elements. Memory grows by four bytes per vertex for those materials.
- Transparency is sorted per mesh, not per triangle; overlapping see-through elements in
  one material can blend in the wrong order. Acceptable for "fade the rest" use.
- Overrides are session state of the loaded revision; they persist only through views.
  A per-project default look can be added later without changing the viewer.
- A view now applies across revisions of the same model, reporting elements that are gone.
