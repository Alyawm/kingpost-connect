# Devlog — Quantities and schedules (v1.1.0)

Date: 2026-10-24
Phase: 8 of the roadmap in `docs/PLAN.md` (optional; taken on)

## What was built

**Definitions and evaluation.** `crates/kp-quantity` describes a schedule as columns
(element fields, properties by pset and name or by name alone, derived quantities), group
levels, per-column aggregates, a filter (types, storeys, text, physical elements only)
and a sort. Evaluation runs in Rust over the stored elements and properties of a revision
and returns one flat row list: group headers with counts, element rows, subtotals for
nested groups and a total. Group values sort naturally ("Level 2" before "Level 10").
Five presets are built in; definitions can be saved per project (migration 007 lets the
preset table hold any kind).

**Derived quantities.** Length, volume and area read the model's base quantities first
(`Qto_*` sets, millimetres recognised and converted) and fall back to measurements the
viewer takes once per revision from the meshes: volume by the divergence theorem,
surface area, bounding box and its longest side. They are stored in `geometry_ref`. Mass
is a weight property when the model has one, else volume × density from the project's
density table, then from built-in densities by material name; materials that match
nothing are listed on the result and can be added from the panel.

**Interface.** A Schedules section with presets and saved definitions, an editor
(columns from fields, derived quantities or the revision's property catalogue; grouping
toggles; aggregates; filters), the density table, and a virtualised grid in the workspace
with collapsible groups, sort by heading, selection of a row's elements in the model, and
export to XLSX (bold group and total rows, numeric cells, frozen header) or CSV.

## Measurements (debug build, 22.5 MB Revit export, 6,921 elements)

| Step | Result |
|---|---|
| Measure geometry quantities for the revision (once) | 745 ms |
| "Concrete elements" (5,354 elements, two group levels) | 2.4 s, 5,459 rows |
| "All elements by type" (6,921 elements) | 1.4 s, 6,937 rows; XLSX and CSV exports of all rows |
| Measured volume against the model's NetVolume on five beams | identical to three decimals |
| Steel tonnage on the test fixture (UB 406x178x54, 6 m, NetVolume 0.0414 m³) | 325 kg derived against 324 kg from the section tables, within 1 % |

Clicking the "BEAM" group row selected its 4,015 elements in the model.

## Problems met

- The Rust `Default` for the filter set `physical_only` to false while the serde default
  said true, so the "all elements" preset listed the project, site, storeys and openings.
  The default is now written out.
- Measured length (longest box side) runs 40 mm over the model's own beam length where a
  beam reaches into a column; the base quantity wins when present, which is the rule.
- The sample model is concrete, so the steel check rests on the fixture; a steel export
  from the client would make it a model check.

## Open items

- A per-model length unit instead of the "over 50 means millimetres" rule.
- Formulas between columns (for example mass per metre), and column reordering by drag.
- Reinforcement needs a model with `IfcReinforcingBar`; the preset is untested on data.
