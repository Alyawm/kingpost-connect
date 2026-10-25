# 012 — Section planes as point and normal; handles drawn in a second pass

Status: Accepted
Date: 2026-10-25

## Context

The viewer had one axis-aligned section plane driven by a slider. Users expect what field
viewers offer: click a face to place a plane on it, drag it, several at once, any angle.
Issues already exchange clipping planes in BCF, which allows many planes at any angle.

## Options

1. Keep axis and position per plane, add more of them. Simple, but no angled planes and
   a second representation next to BCF's.
2. **A point and a normal pointing to the removed side**, the BCF convention, for every
   plane. Angled planes come free; viewpoints convert one to one.
3. A section box object (six linked planes). Convenient for one use, awkward for single
   cuts; can be built from option 2 later.

For the handles: draw them in the model scene (they would be cut by the planes), give each
model material its own clipping list (touches every material, including see-through
companions), or render them in a second pass with clipping switched off.

## Decision

Option 2. Planes live in the view store as `{ point, normal, enabled }` and are applied as
the renderer's global clipping planes (all enabled planes cut, so several make a box).
Placing on a face uses the hit normal facing the camera, snapped to an axis within 3°, so
the plane starts on the face and cuts nothing until dragged inwards. Handles (translucent
rectangle sized to the model, outline, arrow) live in their own scene rendered after the
model with clipping off. Dragging projects the pointer ray onto the line along the normal.

Views store the plane list; the single-plane object written by earlier versions converts
on load. Picks behind a plane are ignored so cut-away parts cannot be selected.

## Consequences

- No section fill (caps) yet: cut solids show their inside faces. Caps need a stencil pass.
- Handles are rebuilt on every change; cheap for a few planes.
- A section box is a set of planes, not an object; a "box" command can add six at once.
