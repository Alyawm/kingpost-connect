# Devlog — Element appearance and views (v1.2.0)

Date: 2026-10-25
Scope: client request after v1.1 — recolour and fade elements, colour and hide explorer
groups, keep it all in saved views.

## What was built

**Appearance overrides in the viewer.** `IfcModel.setAppearance` takes a colour and/or
opacity per element. Colours paint into the merged meshes' vertex colours (order:
selection, override, colour-by tint, base). Elements below full opacity move to a
companion mesh per material that shares positions and normals, has RGBA colours, and is
drawn after opaque geometry without depth writes; picking resolves through either index.
Only elements whose look changed are repainted. See ADR 011.

**Selection bar.** While elements are selected: Appearance (16 swatches, custom colour,
transparency 0–95 % with steps), hide `H`, isolate `I`, ghost the rest `G`, fit, reset,
clear `Esc`; `Shift+H` shows all. All are also in the command palette.

**Model tree.** Group by storey › type, type › type name or material › type (remembered
per machine). Each group and element row has a colour/transparency popover and a hide
toggle that stays visible while hidden; a swatch shows a group's colour (a multi-colour
dot when mixed, a stripe for transparency only). Double-click or "sel" selects a group.

**Views.** Visibility payload version 2: hidden elements (or the visible set when most is
hidden) and overrides grouped by look, all by GlobalId, plus the old express-id list for
earlier builds. Views can be updated in place (`view_update`), renamed inline; "Default
view" resets everything; the applied view is highlighted; cards show what a view changes.

## Measurements (debug build, 22.5 MB Revit export, 6,921 elements)

| Step | Result |
|---|---|
| Colour 851 columns | 3 ms |
| 295 slabs to 30 % opacity (two companion meshes created) | 11 ms |
| Ghost everything except 876 beams (5,930 overrides) | 24 ms |
| One further colour edit with 5,930 overrides present | 2 ms |
| Save view with those overrides and 304 hidden | 120 ms, 154 KB payload |
| Apply the view | 13 ms |
| Apply the same view on revision 1 (other express ids) | 5,929 of 5,930 overrides and 303 of 304 hidden matched; the missing element is not in revision 1 |

## Problems met

- Group indicators vanished for storeys whose geometry was ghosted but which also hold
  elements without geometry (opacity "mixed"); mixed opacity now shows the stripe.
- A stale `tauri`/`tauri_macros` build artefact on this machine (application control
  policy) blocked the dev build; cleaning the two packages fixed it. CI is unaffected.

## Open items

- Transparency is sorted per mesh; overlapping see-through elements of one material can
  blend out of order.
- Overrides persist only through views; a per-project default look could follow.
