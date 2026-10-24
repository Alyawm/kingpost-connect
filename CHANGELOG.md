# Changelog

All notable changes to KingPost Connect. The format follows Keep a Changelog; versions
follow semantic versioning. Milestone tags match the headings below.

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
