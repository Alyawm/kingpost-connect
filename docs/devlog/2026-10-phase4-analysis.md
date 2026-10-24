# Devlog — Analysis model viewing (v0.4.0)

Date: 2026-10-24
Phase: 4 of the roadmap in `docs/PLAN.md` (analysis model viewing)

## What was built

**Readers.** `crates/kp-analysis` reads four sources into one `AnalysisModel`
(ADR 006): ETABS `.e2k` (sections introduced by `$` lines; storey instances of lines
become members with real elevations, columns and braces running to the storey below),
SAP2000 `.s2k` (`TABLE:` blocks of `Key=Value` rows with `_` continuations; frame forces
per station turned into fractions of the member length), SAF workbooks (one sheet per
table, columns found by a normalised header so wording differences between exporters do
not matter), and the structural view of an IFC file (curve and surface members, point
connections with boundary conditions, load cases, combinations by factor, point and
linear actions; vertices placed through the `IfcLocalPlacement` chain with a small
rotation-plus-translation type). Each reader has a hand-written fixture and a test that
checks the engineering content, not just that parsing succeeds; the SAF fixture is
written with the xlsx writer at test time because a workbook cannot be hand-edited.

**Matching.** `link.rs` pairs physical elements with members. The interface measures each
beam, column, member and pile as an axis (the two ends of its longest bounding-box
dimension, in IFC world metres) and sends them to Rust. Names are matched first, then
every remaining pair within the tolerance is taken closest first, one to one, beams with
beams and columns with columns. Sections are compared by the sizes in their names and
dimensions within 2 % or 2 mm, materials by their grade number. The report stores links,
unmatched elements, unmatched members and mismatch counts per revision pair and is
edited in place for manual links.

**Store.** Migration 004 drops the placeholder analysis tables from 001 (never written
to) and stores a model as one JSON document per revision plus one link report per
revision pair. An IFC import that carries a structural view stores it against its own
revision in the same command.

**Viewer and panel.** `AnalysisLayer` draws members as vertex-coloured line segments
(beam / column / brace / other), nodes as screen-sized points, supports as cones, boxes
or discs, loads as arrows, surfaces as outlines with a translucent fan fill. Members are
pickable; a line hit wins over a mesh hit unless the mesh is clearly in front. The
Analysis section imports files, shows a model, toggles each layer and the physical model,
colours members by link status, searches members, shows a member's section, material,
nodes, loads and per-case force extremes with a diagram, runs the matcher with tolerance
and offset settings, shows counters that open the mismatch lists, colours the physical
model by link, and links or unlinks the selected element by hand.

## Measurements (debug build, 22.5 MB Revit export, 4,866 linear elements)

The test model is an ETABS file generated from the IFC's own member axes with 194 members
left out and 194 sections changed (see `samples/README.md`), so the expected answer is
known.

| Step | Result |
|---|---|
| Import `.e2k` (4,667 members, 11,288 nodes, 901 KB) and show it | 813 ms |
| Match 4,866 axes against 4,667 members (includes measuring the axes in the WebView) | 4.9 s |
| Links found | 3,764, all by position; median end distance 1 mm, 99th percentile 0.4 m |
| Section differences reported | 156, every one an altered section, no false reports |
| Material differences | 0 after the fix below (the IFC names no grade) |
| Unmatched elements | 1,102: the 194 left out, plus columns whose IFC extent does not follow the generated storey heights |

The columns are a property of the generated file, not of the matcher: a real ETABS
export carries its own storey heights. The report makes exactly that visible, which is
what the phase is for.

## Problems met

- ETABS keys are bare upper-case words, but so are many record names (`C800X800`), so the
  first pass took a section's name as a key and lost its `MATERIAL`. The tokenizer now
  keeps a quoted flag and only unquoted words can be keys.
- Merging a section's name sizes with its dimension sizes de-duplicated the list, so
  "800 x 800" became one number and was no longer comparable. Dimensions now add only
  sizes the name does not already carry.
- In the IFC reader a member end took the nearest connection at any distance, so a beam
  ended at the column's node 6 m away; and generated node names collided with the file's
  own `N1`. Ends now require the connection to sit at the end, and generated names skip
  taken ones.
- A physical material without a grade ("Concrete - Cast-in-Place Concrete") was
  reported as differing from `C30/37` on every element. It is now "not comparable".
- Clicking an analysis member through a dense building picks the solid in front of it,
  as it should; hiding the physical model (one toggle) picks the member.

## Open items

- Draw N/V/M diagrams in 3D along members; utilisation colouring needs design results.
- ETABS and SAP2000 result tables (exported as CSV or workbooks) into `results`.
- A spatial index for the matcher: 4.9 s is fine for one building and grows with
  elements × members.
- Curved members and members whose longest bounding-box dimension is not their axis.
