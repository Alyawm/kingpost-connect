# 003 — Where IFC properties are parsed

Status: Proposed — to be decided by the Phase 1 performance spike
Date: 2026-10-24

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

**C. Split by concern: `web-ifc` in a worker for geometry only; a lightweight Rust STEP
tokenizer for entities, property sets, quantities and the spatial tree.** Each side reads
the file once for what it is good at. Costs: two code paths that must agree on
`GlobalId` and express IDs.

## Decision

Deferred to the Phase 1 spike. The Lab panel (`apps/desktop/src/features/lab`) loads real
models through the plain `web-ifc` path and reports parse time, geometry time, triangle
count and heap use. The spike adds a Rust tokenizer pass over the same files and records
property counts and time. Decision criteria, in order:

1. Import time for the largest real model available (target: under 60 s cold).
2. Peak memory within an 8 GB laptop.
3. Lines of code that have to understand IFC in two places.

## Consequences

Until this is decided, `crates/kp-ifc` does not exist and the interface's IFC loading is
explicitly a measurement bench, not a product path. The record is updated with the chosen
option and the measured numbers at the end of the spike.
