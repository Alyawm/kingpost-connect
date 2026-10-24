# Changelog

All notable changes to KingPost Connect. The format follows Keep a Changelog; versions
follow semantic versioning. Milestone tags match the headings below.

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
