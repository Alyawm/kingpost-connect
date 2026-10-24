# 006 — One analysis model shape for every source; linking by axis, not by geometry

Status: Accepted
Date: 2026-10-24

## Context

Phase 4 brings the engineer's analysis model next to the physical one. The sources differ
in every way that matters: SAF is a workbook of tables in SI units; ETABS writes a text
file where a line is instantiated once per storey and columns run to the storey below;
SAP2000 writes `Key=Value` tables with results per station; IFC's structural view places
topology items through the same placement chain as the physical model. The plan's
acceptance test is an ETABS building overlaying its IFC within tolerance with section
mismatches reported.

Two questions had to be settled: what the application stores and draws, and how a
physical element is paired with an analysis member when neither file knows about the
other.

## Options

**Model shape**
1. **One normalised model** (nodes, members, surfaces, supports, materials, sections, load
   cases, combinations, loads, member forces) that each reader fills, stored as one JSON
   document per revision.
2. Keep each source's own tables and teach the viewer and the matcher all four.
3. Convert everything to IFC structural entities and reuse the IFC pipeline.

**Pairing**
1. **Axis matching**: the interface measures each physical element's axis from its mesh
   (the two ends of its longest bounding-box dimension, in IFC world metres); the matcher
   pairs it with the nearest member axis within a tolerance, one to one, after exact name
   matches, and compares sections and materials by the numbers in their names.
2. Geometric containment: test whether the member line lies inside the element's mesh.
   Exact but needs the meshes on the Rust side, which the design keeps in the WebView.
3. Names only. Fails for every real export: authoring tools and analysis programs number
   members independently.

## Decision

Model shape 1 and pairing 1.

- `crates/kp-analysis` defines `AnalysisModel` and four readers. Coordinates stay in the
  source's unit with Z up; `Units::length_to_m` scales at the point of use. ETABS storey
  instances become real nodes (`point@storey`) and members (`line@storey`); SAP2000
  stations are turned into fractions of the member length so the interface can draw force
  diagrams without geometry; IFC placements are resolved with a small rotation-and-
  translation type rather than a matrix library.
- The stored form is one JSON document in `analysis_model` keyed by revision, so an
  analysis file gets revisions like any other file, and an IFC import that carries a
  structural view attaches the model to its own revision.
- Matching runs in Rust on axes the interface supplies. Sections agree when the sizes in
  the physical section name (for example `800 x 700mm`) all appear, within 2 % or 2 mm, in
  the analysis section's name or dimensions (`B800X700`, or `D 0.8 B 0.7`); steel names
  may carry a mass per metre on one side only. Materials agree on a shared leading number
  (`C30/37` against `C30`). The report (links, unmatched on both sides, mismatch counts)
  is stored per revision pair and edited in place for manual links.

## Consequences

- Adding a source means one reader into the common shape; the viewer, the panel and the
  matcher do not change. Result tables (ETABS exports them separately, as CSV or
  workbooks) can be read into `results` later by the same rule.
- The matcher sees elements as straight axes. Curved or very short members, and elements
  whose longest bounding-box dimension is not their axis (a squat column wider than tall)
  need the tolerance raised or a manual link; the report makes both visible.
- Numbers-in-names is a heuristic. It is right for the common naming of concrete sizes
  and standard steel sections and says "not comparable" rather than guessing when either
  side has no numbers; a mismatch is a prompt to look, not a verdict.
- Units are taken from the files (`UNITS` in ETABS, `CurrUnits` in SAP2000, SI in SAF,
  `IfcSIUnit` in IFC). A file that lies about its units overlays in the wrong place; the
  offset and the unmatched counts show it immediately, and the offset fields correct a
  shifted origin without re-exporting.
