# Devlog — Internal alpha (v0.1.0-alpha)

Date: 2026-10-24
Phase: 1 of the roadmap in `docs/PLAN.md` (project + IFC viewer)

## What was built

**IFC reading in Rust.** `crates/kp-ifc` indexes a STEP file in one pass and decodes
attributes lazily. It recognises rooted entities by shape and classifies types by name, so
IFC2X3, IFC4 and IFC4X3 files work without an EXPRESS schema. It extracts elements with
their storey (through containment and aggregation, including elements placed in spaces),
type names, materials (through layer, profile and constituent sets), project units,
property sets and quantity sets. ADR 003 records the decision and the measurements.

**Import into the project database.** Migration 002 adds express ids, type names,
materials and revision metadata. Importing a file creates a revision; importing it again
creates the next one, which is what revision comparison in Phase 3 will diff. Files are
listed from the project folder with their revisions; a folder watcher refreshes the list
when models are dropped in.

**Viewer with element identity.** Geometry still merges into one mesh per colour, but
every element owns a range inside it: picking resolves to an express id, selection and
colouring paint a per-vertex colour attribute, hiding rewrites the index buffer. On top of
that: model tree by storey and type with filter, hide, isolate and fit; properties
inspector with every property set and quantity; section planes on any axis with a
one-click plan view of a storey; colour by type, material or storey with a legend; a
point-to-point measure tool; standard views; saved views with thumbnails.

**Developer workflow.** `KINGPOST_PROJECT` pre-opens a project; development builds expose
the stores on `window.kingpost`; the WebView2 remote-debugging recipe in CONTRIBUTING.md
lets a script drive the real window. Every feature above was exercised that way against
the project model before it was committed.

## Measurements

Project structural model: Revit 2026 export, IFC2X3, 22.5 MB, 369k entities, 6,906
products. Machine: i5-1135G7, Iris Xe, 7.8 GB RAM, Windows 11.

| Step | Where | Time |
|---|---|---|
| Scan + extract + store (release) | `cargo run -p kp-ifc --release --example bench` | 528 ms |
| Import through the application (debug build of the shell) | Explorer → Import | 1,839 ms |
| Load geometry + elements into the viewer | Explorer → Load | 1,321–1,479 ms |
| Duplex sample (2.3 MB, 280 products, 13,459 properties): import | Explorer → Import | 857 ms |

Rust reads 69,927 property rows in the time web-ifc takes to triangulate the same file;
the two run on different threads, so a 22 MB model is usable in about 1.5 seconds.

## Phase 1 acceptance, honestly

| Criterion | Status |
|---|---|
| Open/create project folders, file browser, import, revisions | Done |
| Viewer: orbit, fit, select, isolate/hide/show, sections, measure, colour by property, storey navigation | Done (box and multi-select, transparency, angle/area measure: not yet) |
| Model tree, properties inspector, search | Done (tree filter; database search is wired but has no panel yet) |
| Saved views | Done |
| 300 MB model under 60 s cold / 5 s warm | **Not measured**: no model of that size is available. Warm loads will need the geometry cache, which is not built. |
| All corpus files load without crash | Project model, Duplex, FZK-Haus and IfcOpenHouse load; AC20-FZK-Haus and IfcOpenHouse only through the Lab bench |

Remaining Phase 1 work moves ahead of Phase 2 in the next session: geometry cache for warm
opens, box/multi-select, transparency, drag-and-drop import, and a 200 MB+ model to measure.

## Decisions recorded

- ADR 003 accepted: Rust reader for semantics, web-ifc for geometry, express id as the join.

## What was harder than expected

- web-ifc already delivers Y-up geometry. An extra rotation in the loader laid every
  model on its side; it only became visible once plan cuts and the "Top" view existed,
  because an isometric view of a building lying down still looks like a building.
- Hot module reloading keeps the running `SceneController` instance, so a method added to
  the class is missing until the page reloads; a full reload also drops any remote
  debugging session. Scripted checks now reconnect on demand.
- pnpm 12 renamed the build-approval key to `allowBuilds`.

## Next

1. Geometry cache under `.kingpost/cache/` so a second open skips web-ifc.
2. Box selection and multi-select; transparency for context.
3. Phase 2: BCF issues, element design status, 3D markups.
