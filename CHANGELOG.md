# Changelog

All notable changes to KingPost Connect. The format follows Keep a Changelog; versions
follow semantic versioning. Milestone tags match the headings below.

## [1.5.0] — 2026-10-25 — Several models and measuring

### Added
- Reference models: add more revisions to the view, aligned in IFC world coordinates;
  show, hide, colour, fade, fit, remove or make main; properties of picked reference
  elements; reference models kept in saved views; clash tests between the main model and
  a reference model.
- Measuring: snapping to corners, midpoints, edges and faces with a marker and a cursor
  tip; ortho (button or Shift); modes for distance, angle, perpendicular to a face, edge
  length and point coordinates; live preview while measuring; a list with delete per
  measurement and clear all; Esc and Backspace shortcuts.

### Changed
- Measurement labels keep the same size on screen at any zoom.

## [1.4.0] — 2026-10-25 — Viewer experience

### Added
- Element edge lines (outlines and creases), built in the background after a model opens;
  they hide and fade with their elements. Toggle in the viewport toolbar, remembered.
- Undo and redo for hiding, colours, transparency and section planes (Ctrl+Z, Ctrl+Y).
- Navigation modes: orbit, pan, and walk (mouse look, W A S D, Q/E, Shift).
- Orientation cube in the viewport corner; click a face for that view.
- Focus mode that hides the panels.
- Size of the selection (width × depth × height) in the selection bar.
- Views presentation: play the saved views one after another.

### Changed
- Camera moves animate (respecting the system's reduced-motion setting).
- "Isolate" is called "Show only" in the selection bar and commands.
- The orientation cube replaces the Iso/Top/Front/Side buttons.

## [1.3.0] — 2026-10-25 — Sections, selection and schedule formulas

### Added
- Section planes like a field viewer: place a plane on any face, drag its arrow to cut,
  any number of planes (together a section box), flip, switch off, move with a slider,
  hide handles. Planes are kept in saved views and BCF viewpoints (all of them, at any
  angle).
- Box selection with Shift+drag (window left to right, crossing right to left, Ctrl adds).
- Drag and drop files onto the window: copied into the project, IFC imported and shown.
- A saved view can be the project's default look, applied when a model opens.
- Schedule formula columns (`[Mass] / [Length]`, column letters, `+ - * / ^`), column
  reordering by drag with formulas following their columns, renaming by double-click.

### Changed
- The middle mouse button pans; the wheel zooms towards the cursor.
- Schedule lengths, areas and volumes use the units declared in the IFC file; the "over 50
  means millimetres" rule remains only for models that declare none.
- Elements cut away by a section plane can no longer be picked through it.

## [1.2.1] — 2026-10-25 — Sample project

### Added
- "Try the sample project" on the welcome screen: creates a "KingPost Sample" folder in
  Documents with a bundled sample building, imports it and shows it, so the colour,
  transparency, hide and views tools can be tried straight after installing.
- Clicking the start-up demo frame explains that it is not an editable model and offers
  the sample project; a first-use tip says how to select elements once a model is loaded.

### Fixed
- The inspector kept showing a pick from the demo frame after a model was loaded.

## [1.2.0] — 2026-10-25 — Element appearance and views

### Added
- Colour and transparency per element: selection bar over the viewport with swatches, a
  custom colour, a transparency slider and reset; hide (`H`), isolate (`I`), ghost
  everything else (`G`), show all (`Shift+H`), clear selection (`Esc`).
- Model tree: group by storey › type, type › type name or material › type; colour,
  transparency and hide on every group and element row; select a whole group.
- Saved views keep colours, transparency and hidden elements by GlobalId, so they apply to
  later revisions; update a view with the current state, rename it inline, "Default view".

### Changed
- See-through elements are drawn by a companion mesh per material, sorted after opaque
  geometry, so they blend correctly and stay pickable.
- The geometry cache always stores every element, whatever is hidden when it is written.

## [1.1.2] — 2026-10-24 — Release build fix

### Fixed
- The Windows installer job stopped before building since 1.0.0 because the npm packages
  of the updater and process plugins were a minor version behind their Rust crates, which
  the Tauri CLI refuses. Both sides are now on the same minor versions and the crates are
  pinned to them. (1.1.1 guessed at the cause and did not help.)

## [1.1.1] — 2026-10-24 — Release build fix

### Fixed
- The Windows installer job failed on 1.0.1 and 1.1.0 at the bundling step. Updater
  artifacts are now enabled through a committed overlay configuration file passed only
  when the signing secret exists, instead of a quoted JSON argument, and the main
  configuration no longer requests them.

## [1.1.0] — 2026-10-24 — Quantities and schedules

The optional phase, taken on: schedules over the loaded model with totals and exports.

### Added
- `kp-quantity` crate: schedule definitions (element fields, properties, derived
  quantities), evaluation with filter, multi-level grouping in natural order, sum/count/
  average/min/max, sorting, totals; built-in presets (steel members, concrete elements,
  reinforcement, foundations, all elements by type); CSV and XLSX export with totals.
- Derived quantities: base quantities first, then length, volume and area measured from
  the element meshes once per revision and stored; mass as volume × density from an
  editable per-project density table with defaults by material name, and a list of the
  materials that matched nothing.
- Schedules section: presets and saved definitions, an editor for columns (fields,
  derived quantities, any property from the revision's catalogue), grouping, aggregates
  and filters (types, storeys, text), a virtualised grid in the workspace with
  collapsible groups and selection in the model, export through the save dialog, and the
  density table.
- Store: migration 007 (density table, presets of any kind); geometry quantities per
  element.

### Fixed
- 1.0.1 carried unformatted work in progress and failed its lint check, so it produced no
  installers; this release does.

## [1.0.1] — 2026-10-24 — Release build fix

### Fixed
- The release workflow failed when the updater signing secret was not set, because the
  build insists on signing updater artifacts once a public key is configured. Without the
  secret the installers are now built without updater artifacts; with it, both are built.

## [1.0.0] — 2026-10-24 — First release

The application is ready to install, update and support.

### Added
- Updates: checked only on request or with the opt-in start-up setting, signed artifacts
  from the latest published GitHub Release, installed only after confirmation.
- Licence keys checked offline (`kp-licence`): Ed25519-signed, installed from Settings;
  without one the application runs as an evaluation copy with every feature.
- Diagnostics: a daily log file in the project's data folder and a zip bundle written on
  request; nothing is sent anywhere.
- Geometry cache: a loaded revision's meshes are kept in the project's data folder and
  reused on the next load.
- Welcome screen with recent projects, a getting-started checklist, a Settings dialog
  (name, theme, updates, licence, cache, diagnostics) and a Help dialog with the shortcuts.
- Localisation scaffold with an English dictionary.
- Documentation: user guide and release process.

## [0.6.0] — 2026-10-24 — Coordination basics

Clash checks between selection sets, tracked across runs and revisions.

### Added
- Clash engine in the viewer: per-element triangle trees, hard contact (intersecting or
  touching triangles) and clearance (closest distance under a gap), chunked and
  cancellable, with progress.
- Store: migration 006 adds clash tests (two element sets and a rule) and clashes keyed by
  element pair with status, note and first/last seen; a run reopens what is back and
  resolves what is gone.
- Coordination section: tests from the current selection (set A, set B, or everything
  else), hard or clearance in millimetres, run on the loaded revision with progress and
  cancel, results filtered by status and grouped by the pair's IFC types, focus with a
  point marker, inline status changes, and an issue raised from a clash.

## [0.5.0] — 2026-10-24 — Drawings

PDF drawing sets next to the model, linked both ways, and compared issue by issue.

### Added
- Drawings section: import PDF sets as revisions; sheet index with thumbnails, numbers and
  titles read from the title block (editable); search over sheet numbers, titles and page
  text; open a sheet in the workspace with pan and zoom.
- Links: draw a region on a sheet to link it to the selected elements or a saved view;
  double-click a region to jump to the model; "On drawings" in the inspector lists the
  sheets an element appears on and opens them zoomed to the region. Links are carried
  onto the sheets of a re-imported set by sheet number.
- Markups on sheets: rectangles, revision clouds and notes, stored per sheet.
- Sheet comparison: two revisions paired by sheet number, rendered at the same size and
  compared pixel by pixel; old-only ink blue, new-only red, changed areas boxed and
  counted; sheet-by-sheet navigation.
- Store: migration 005 replaces the placeholder sheet tables with sheets per revision,
  links, markups and page text.

## [0.4.0] — 2026-10-24 — Analysis model viewing

Structural analysis models next to the physical model, with the two linked.

### Added
- `kp-analysis` crate: one `AnalysisModel` (nodes, members, surfaces, supports,
  materials, sections, load cases, combinations, point/line/surface loads, member forces)
  read from ETABS `.e2k`, SAP2000 `.s2k`, SAF workbooks and the structural view of an IFC
  file (`IfcStructuralCurveMember`, `IfcStructuralSurfaceMember`, point connections with
  boundary conditions, load cases and actions, placed through the placement chain).
- Matching of physical elements to analysis members: by name, then by nearest axis within
  a tolerance, one to one; section and material comparison by the sizes in their names
  and dimensions; report with unmatched elements and members; manual link and unlink.
- Store: analysis models as one document per revision (migration 004 replaces the unused
  placeholder tables from 001) and link reports per revision pair.
- Analysis section: import analysis files, show a model as a wireframe overlay (members
  coloured by kind, nodes, support glyphs, load arrows, translucent surfaces) with
  visibility toggles and a physical-model toggle; member search and detail with loads,
  per-case force extremes and a force diagram along the member; load cases, combinations
  and materials; tolerance and offset settings; match, counters that open the mismatch
  lists, "colour by link" on the physical model, link/unlink by hand.
- An IFC import that carries a structural analysis view stores it as an analysis model of
  the same revision.
- Viewer: analysis layer with member picking (lines win over the solids around them).

## [0.3.1] — 2026-10-24 — Release build fix

### Fixed
- The release workflow's check job failed on Linux for every milestone tag because one
  desktop test assumed Windows drive-letter paths; the test is now platform-independent.
  This is the first tag expected to produce installers.

## [0.3.0] — 2026-10-24 — Revision comparison

Compare two revisions of a model and act on the differences.

### Added
- `kp-diff` crate: compares two revisions by GlobalId into added, removed and modified
  elements, with the exact identity fields and `pset/property` values that changed;
  numeric tolerance; summary by IFC type; CSV writer; results stored per revision pair.
- `kp-store::diff`: property facts per revision and the `diff_result` / `diff_item`
  read, write and lookup.
- Compare section: file and revision pickers (last two revisions preselected), counters
  that filter, per-type table, text filter, expandable field changes per element,
  select-in-3D, "load rev N", recompute, CSV export through the save dialog.
- "Colour by change": the loaded revision tinted green / amber / red / grey from the
  current comparison, in the viewer legend like the other colour modes.
- "issue" on any changed element creates a review issue with the element linked, the
  current view as viewpoint and a `revision change` label.

## [0.2.0-beta] — 2026-10-24 — Private beta: review workflow

Issues, viewpoints and a design-status pipeline on top of the viewer, exchanged as BCF.

### Added
- Review section: dashboard (open, closed, overdue issues; design-status coverage across the
  loaded model), issue list with filters and search, new-issue form that links the current
  selection and attaches the current view as a viewpoint.
- Issue detail: status, priority, assignee, due date, description, labels; linked elements
  with "Select in 3D"; viewpoints with snapshots (apply on click, add current view);
  comments with optional viewpoint.
- Element design status (modelled → analysed → designed → checked → approved) set in bulk
  from the selection, shown in the inspector, and available as "Colour by status".
- Multi-selection: Ctrl+click in the viewport and the model tree.
- Markup lines drawn on the model, saved into viewpoints and exported as BCF lines.
- BCF 3.0 export of all issues and import of BCF 2.1/3.0 files (existing topics skipped by
  guid); `kp-bcf` crate with round-trip tests.
- Viewer ↔ IFC world coordinate frame (`IfcFrame`) built from web-ifc's coordination
  matrix, so viewpoints are stored and exchanged in IFC coordinates.

### Fixed
- Viewpoint and saved-view snapshots were blank in WebView2; the renderer now keeps its
  drawing buffer.

## [0.1.0-alpha] — 2026-10-24 — Internal alpha

First state a structural engineer can use: open a project folder, import IFC models,
look at them, find things, cut plans, measure and keep views.

### Added
- IFC reader in Rust (`kp-ifc`): elements, storeys, types, materials, units, property
  sets and quantities from IFC2X3/IFC4/IFC4X3 files; a bench example for timings.
- Import into the project database as revisions; Explorer lists files in the project
  folder with their revisions and refreshes on its own when files change.
- Viewer: per-element picking inside merged geometry, selection highlight, hide/isolate/
  show, model tree by storey and type with filter, properties inspector with property and
  quantity sets, section planes with a one-click plan view per storey, colour by type/
  material/storey with legend, point-to-point measure with Δx/Δy/Δz, standard views.
- Saved views with thumbnails (camera, hidden elements, colouring, section).
- Developer aids: `KINGPOST_PROJECT` pre-opens a project; `window.kingpost` exposes the
  stores in development builds.

### Fixed
- IFC geometry was rotated onto its side; web-ifc already delivers Y-up coordinates.
- Elements contained in spaces now report the space's storey.

## [0.0.1] — 2026-10-24 — Foundation

First buildable state of the repository; nothing here is a product feature yet.

### Added
- Tauri 2 desktop shell with a React interface: activity rail, side panel, 3D workspace,
  properties inspector, output panel, status bar, command palette (Ctrl+K) and keyboard
  shortcuts. Dark and light themes.
- 3D viewport on three.js with on-demand rendering, orbit/pan/zoom, click selection and a
  sample steel portal frame.
- IFC load bench (Lab section) using web-ifc: parses a file, merges geometry by colour and
  reports timings, triangle counts and heap use. A measurement tool for the Phase 1 spike.
- Project folders: create or open any folder as a project; the shell writes a manifest and a
  SQLite database under `.kingpost/`. Rust crates `kp-project` and `kp-store` with the full
  initial schema (migration 001) and tests.
- Repository tooling: pnpm + Cargo workspaces, TypeScript strict mode, ESLint, Prettier,
  Vitest, clippy and rustfmt, a `pnpm check` gate, and a GitHub Actions workflow that builds
  Windows installers into a draft release when a `v*` tag is pushed.
- Documentation: roadmap (`docs/PLAN.md`), decision records 001–003, developer guide
  (`CONTRIBUTING.md`), third-party notices, sample corpus notes and fetch script, Windows
  toolchain setup script.
