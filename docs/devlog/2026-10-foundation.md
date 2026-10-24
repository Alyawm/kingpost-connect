# Devlog — Foundation (v0.0.1)

Date: 2026-10-24
Phase: 0 of the roadmap in `docs/PLAN.md`

## What was built

The repository went from a plan to a running application shell in one working session.

**Interface.** A Tauri 2 window hosting a React application laid out like an editor:
activity rail on the left (Explorer, Viewer, Review, Compare, Analysis, Drawings, with Lab at
the bottom), a side panel whose content follows the rail, the 3D workspace in the centre with
an output log beneath it, a properties inspector on the right and a status bar. Panels fold
with Ctrl+B / Ctrl+J / Ctrl+Alt+B, a command palette opens with Ctrl+K, and the theme
switches between dark (default) and light. Sections whose phase has not started show what
is planned for them, so the roadmap is visible inside the product.

**Viewport.** `packages/viewer` wraps three.js in a `SceneController` that renders only when
something changes (camera, resize, selection, content). Clicking selects a mesh and reports
its name and IFC type to the inspector. A sample two-bay portal frame is loaded at start so
the viewport is never empty.

**IFC load bench.** The Lab section loads an IFC file through `web-ifc`, converts every
placed geometry to three.js buffers, merges them per colour and reports parse time, geometry
time, triangle count, material count and JS heap. This is the instrument for the Phase 1
performance spike, deliberately kept simple and separate from any product path.

**Projects.** Two Rust crates: `kp-store` owns the SQLite database (WAL mode, foreign keys,
numbered migrations tracked in `user_version`; migration 001 creates every table from the
domain model in the plan) and `kp-project` owns the project folder (`.kingpost/project.json`
manifest written atomically, database beside it, refusal of files written by newer builds).
The shell exposes `project_create / open / close / current / is_project` commands; the
Explorer panel's "Open project folder…" uses the system folder picker and creates or opens
a project accordingly.

**Tooling.** pnpm and Cargo workspaces, strict TypeScript, ESLint + Prettier, Vitest, clippy
+ rustfmt, one `pnpm check` command that runs everything CI runs, and a GitHub Actions
workflow that runs on milestone tags only and builds NSIS/MSI installers into a draft
release. `scripts/setup-windows.ps1` installs the toolchain on a fresh Windows machine.

## Measurements

Machine: Intel Core i5-1135G7, Iris Xe graphics, 7.8 GB RAM, Windows 11 Home. Numbers from
the Lab bench in the browser preview (Chromium), warm runtime (`web-ifc` already initialised,
69 ms first time).

| File | Size | Schema | Products | Triangles | Parse | Geometry | Total | JS heap |
|---|---|---|---|---|---|---|---|---|
| duplex.ifc | 2.3 MB | IFC2X3 | 216 | 26,774 | 63 ms | 170 ms | 303 ms | 38 MB |
| AC20-FZK-Haus.ifc | 2.5 MB | IFC4 | 83 | 21,650 | 42 ms | 139 ms | 181 ms | 37 MB |
| Project structural model (private) | 22.5 MB | IFC2X3 | 6,505 | 204,431 | 181 ms | 582 ms | 763 ms | 88 MB |

The third file is a real structural model exported from Revit 2026 (Coordination View 2.0 with
the quantity take-off add-on view): 4,016 beams, 851 columns, 739 proxies, 20,766 property
sets and 6,048 element quantity sets. It is kept in `samples/private/` and is not committed.

What the numbers show so far: `web-ifc` initialisation is cheap; geometry conversion costs
about three times parsing; a 22 MB structural model loads well under a second and stays
under 100 MB of heap on an 8 GB laptop. Merging by colour reduced 6,505 products to three
draw calls, which is good for frame rate and useless for picking — the fragment design in
Phase 1 has to keep per-element identity while keeping draw calls low. The 200 MB+ case is
still unmeasured.

Quality gate at the tag: `pnpm typecheck`, `pnpm lint`, `pnpm test` (13 tests across three
packages) and the Rust gate (`cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`)
all pass on the development machine.

## Decisions recorded

- ADR 001 — desktop stack (Tauri, React, three.js, SQLite). Accepted.
- ADR 002 — a project is a folder with a `.kingpost/` directory. Accepted.
- ADR 003 — where IFC properties are parsed. Proposed; decided by the Phase 1 spike.

## What was harder than expected

- pnpm 12 renamed the build-approval setting (`allowBuilds` replaces
  `onlyBuiltDependencies`); the install fails loudly until it is set.
- `web-ifc` locates its WASM by file name, so the production build keeps `.wasm` assets
  unhashed under `wasm/` (see `apps/desktop/vite.config.ts`).
- A fresh Windows machine needs Visual Studio Build Tools before Rust can link anything or
  compile the bundled SQLite; the setup script handles it but it is the slowest step.

## Next

1. Obtain the real structural models (steel, RC, one large) and an analysis export.
2. Phase 1 spike per ADR 003: run the bench on the large model, add the Rust tokenizer
   pass, decide the property pipeline, record the numbers here.
3. Start Phase 1: file browser, IFC import into SQLite, model tree, sections, measure,
   saved views.
