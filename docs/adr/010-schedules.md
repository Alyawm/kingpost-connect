# 010 — Schedules are definitions evaluated in Rust; geometry quantities come from the viewer once

Status: Accepted
Date: 2026-10-24

## Context

Phase 8 (optional in the plan, taken on) adds quantity schedules: steel tonnage, concrete
volumes by storey and grade, reinforcement, foundations, and whatever an engineer wants
to tabulate. Models from authoring tools often carry base quantities (`Qto_*` sets), but
not always, and never a mass; a schedule has to fill the gaps from the geometry and an
editable density table, and its totals have to match a hand check.

## Options

**Where the table is built**
1. **In Rust, from the stored elements and properties**, as a definition (columns, group
   levels, aggregates, filter) sent from the interface; the result comes back as a flat
   row list with group headers, subtotals and a total.
2. In the interface, from element rows fetched per revision. Fine for thousands of rows,
   but every export would need the same code twice and large models would ship their
   property tables over IPC on every change.

**Quantities the model does not carry**
1. **Measure once from the meshes in the viewer** (volume by the divergence theorem,
   surface area, bounding box and its longest side as the length) and store them in
   `geometry_ref`, keyed by element; schedules read a base quantity first and fall back
   to the stored measurement.
2. Measure in Rust from a geometry cache. No cache existed when the plan was written; one
   does now (ADR 009), but it holds merged meshes in viewer space and would need its own
   reader. Not worth a second implementation.

**Mass**
1. **Volume × density**, density from the project's table, then from a built-in list by
   material name (steel grades, concrete classes, timber, aluminium, masonry), with the
   materials that matched nothing listed on the result so the user can add them.
2. Only model-provided weights. Most models have none.

## Decision

Options 1, 1 and 1. `crates/kp-quantity` holds the definition types, the evaluator
(filter, group tree in natural order, aggregates, sort), the built-in presets and the CSV
and XLSX writers. Saved definitions go in the `preset` table (migration 007 opens its kind
to any value); densities in `material_density`. Base quantities named in millimetres are
read as metres when they exceed 50, which keeps the Revit exports honest without a
per-model unit setting. A weight property on an element wins over derivation.

## Consequences

- The acceptance check holds on the fixture: the beam carries NetVolume 0.0414 m³ and a
  UB 406x178x54 section over 6 m; 0.0414 × 7850 = 325 kg against the catalogue's 324 kg,
  within 1 %.
- Geometry measurements are exact for closed meshes and approximate for open ones; the
  schedule marks nothing as approximate because it cannot tell. The base quantity, when
  present, always wins.
- Densities by name are a heuristic; the missing list and the editable table are the
  correction. A material named `Concrete - Cast-in-Place Concrete` matches `concrete`.
- The grid is virtualised, so the "all elements" schedule on a 7,000-element model is a
  few thousand rows without trouble; grouping happens before rendering.
