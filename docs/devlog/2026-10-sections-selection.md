# Devlog — Sections, selection and schedule formulas (v1.3.0)

Date: 2026-10-25
Scope: the smaller improvements list after v1.2, plus middle-button pan and field-viewer
section planes requested by the client.

## What was built

- **Navigation.** Middle and right buttons pan, the wheel zooms towards the cursor.
- **Section planes** (ADR 012). Place on any face (normal snapped to an axis within 3°),
  drag the arrow, any number of planes cutting together, flip, switch off, slider, hide
  handles, axis planes through the model centre, plan of storey. Stored in views (old
  single-plane views convert) and written to and read from BCF viewpoints, all planes at
  any angle. Picks on cut-away parts are ignored.
- **Box selection.** Shift+drag; window or crossing by drag direction; Ctrl adds. Element
  bounds are computed once per model; hidden, fully transparent and fully cut elements and
  those behind the camera are skipped.
- **Drag and drop.** Files dropped on the window are copied into the project (or used in
  place), IFC files imported and the last shown; without a project the file's folder
  becomes one.
- **Default look.** A starred view (migration 008) is applied whenever a model opens.
- **Schedules.** Formula columns with letters or `[names]`; drag to reorder (letters in
  formulas are rewritten to follow); rename by double-click; units from the IFC unit
  assignment instead of the millimetre guess.

## Checks (debug build, sample duplex model, 308 elements)

| Check | Result |
|---|---|
| Middle-button drag | orbit target moved; no orbit |
| Place on face, then drag the arrow 150 px | plane snapped to X, moved 6.0 m |
| Shift+drag window / crossing over the same area | 168 / 214 elements |
| Drop an outside IFC and a .ini file | IFC copied, imported (48 elements) and shown; .ini skipped with a warning |
| Default view, then reopen the model | 57 coloured walls and the plane restored |
| `[Volume] / [Area] * 1000` on the "127mm Slab on Grade" | 127 |
| Formula referring to a missing column | reported as "Bad: 'Q' is not a column letter (A–E)" |

## Open items

- Section caps (filled cut faces) need a stencil pass.
- A one-click section box around the selection would add six planes.
- Large-model performance (200 MB+) still waits for a client model of that size.
