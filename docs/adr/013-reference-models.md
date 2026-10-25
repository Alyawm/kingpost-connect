# 013 — One main model; reference models aligned by their IFC frames

Status: Accepted
Date: 2026-10-25

## Context

Coordination needs several models in one view: architecture, structure and services, or
two revisions. Every feature so far (tree, inspector, hide and colour, schedules, review,
compare, clash) is built around one loaded revision whose elements are addressed by
express id, and express ids repeat between files.

## Options

1. **Every model equal.** All stores keyed by (model, express id). The right end state,
   but it touches every feature at once.
2. **One main model plus reference models.** The main model keeps every feature unchanged;
   reference models are shown, styled and picked, and can be promoted to main.
3. Merge models into one at load time. Breaks revision identity and the database.

## Decision

Option 2. Each model is loaded with web-ifc's coordinate-to-origin; its `IfcFrame` records
the viewer ↔ IFC transform, so a reference model is placed with
`main.toViewer · reference.toIfc` and models exported separately line up. Picks carry the
model's key; a reference pick shows that element's properties. "Make main" swaps roles
without reloading geometry. Saved views record the reference revisions and their look.
Clash tests resolve GlobalIds across all loaded models through one combined key
(slot × 2³² + express id), so set B can be a whole reference model.

## Consequences

- Features that act on the selection (hide, colour, schedules, issues) act on the main
  model only; reference models are styled as a whole. Moving to option 1 later replaces
  the express-id keys with (model, id) pairs without changing the viewer.
- Models must share IFC world coordinates; files exported in different local systems need
  their survey points fixed at export.
