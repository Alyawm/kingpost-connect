# 003 — Where IFC properties are parsed

Status: Accepted
Date: 2026-10-24 (proposed and decided the same day, after measurement)

## Context

Geometry is needed in the web view (three.js); properties, quantities and the spatial tree
are needed in SQLite for search, schedules, diffs and issues. IFC files for real projects
run from tens of megabytes to over a gigabyte. The same file must not be parsed twice if
it can be avoided, and import must not freeze the interface.

## Options

**A. Parse in the interface with `web-ifc` (WASM) inside a Web Worker; stream properties to
Rust over IPC for storage.** One parser, already needed for geometry. Costs: IPC volume for
property-heavy models; WASM memory ceiling (4 GB) in the worker.

**B. Parse in Rust with a STEP/IFC parser; send geometry to the view as binary buffers.**
Properties go straight into SQLite with no IPC; Rust threads and memory. Costs: Rust IFC
geometry is less mature than `web-ifc`; may still need `web-ifc` for geometry, which means
two parsers reading the same file.

**C. Split by concern: `web-ifc` in the interface for geometry only; a Rust STEP reader for
entities, property sets, quantities, spatial structure, types and materials.** Each side
reads the file once for what it is good at. Costs: two code paths that must agree on
express ids.

## Measurements

Project structural model, 22.5 MB IFC2X3 from Revit 2026, on an i5-1135G7 laptop:

| Path | What | Time |
|---|---|---|
| `web-ifc` (browser, warm runtime) | parse + geometry for 6,505 products, 204k triangles | 763 ms |
| `kp-ifc` scan | index 369,325 entities across 95 types | 62 ms |
| `kp-ifc` extract | 6,906 products, 16 spatial, 20,766 psets, 6,048 quantity sets → 69,927 property rows | 108 ms |
| `kp-store` write | all rows in one transaction | 344 ms |

Reproduce with `cargo run -p kp-ifc --release --example bench -- <file>` and the Lab panel.

## Decision

Option C. `crates/kp-ifc` reads the STEP file without an EXPRESS schema: it recognises
rooted entities by shape (22-character GlobalId, owner-history slot) and classifies types
by name, so IFC2X3, IFC4 and IFC4X3 files all work and unknown product types degrade to
plain products. It writes elements and properties into the project database through
`kp-store`. The interface loads geometry with `web-ifc` from the same file and keys every
mesh range by express id, which is how the two sides meet.

## Consequences

- Import of a 22 MB model costs about half a second in Rust and under a second in the
  view, in parallel; the interface stays responsive because the Rust side runs on a worker
  thread.
- The reader is the only place that understands IFC semantics; geometry conversion knows
  nothing about properties. Adding a property kind or a material form touches one crate.
- Both sides read the file from disk independently. For the 300 MB case this is acceptable
  on an SSD; a geometry cache for warm opens is the next performance step, not a second
  parser.
- Rooted-by-shape detection is a heuristic; a type that places something other than the
  GlobalId first would be missed. No such type exists in the published schemas.
