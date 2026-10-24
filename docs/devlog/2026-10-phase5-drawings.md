# Devlog — Drawings (v0.5.0)

Date: 2026-10-24
Phase: 5 of the roadmap in `docs/PLAN.md` (drawings ↔ model)

## What was built

**Sheets.** A PDF in the project is imported as a revision like any other file. The
interface opens it with pdf.js, and for every page reads the size, the text runs with
their positions, and a thumbnail, guesses the sheet number and title from the title block
(ADR 007), and registers the pages with the shell. Sheets are stored per revision with
their page text, so search covers numbers, titles and everything written on the sheet.
Numbers and titles stay editable from the index (double-click).

**Sheet viewer.** The workspace switches from the 3D viewport to a sheet without
unloading the model: the viewport is kept mounted underneath. The page is rendered at the
current zoom (re-rendered after a short pause when zooming), panned by dragging, zoomed
with the wheel; links and markups are drawn over it in page fractions, so they are right
at every zoom and on reprints at another paper size.

**Links.** The link tool draws a region and ties it to the elements selected in the
model (one link per element, labelled with the element's name) or to a saved view.
Double-clicking a region, or "open" on it, selects the element in 3D and switches back
to the model. The inspector's "On drawings" section lists the sheets an element appears
on and opens one zoomed to the region. When a new revision of the set is imported, the
previous revision's links are copied onto the sheets with the same number.

**Markups.** Rectangles, revision clouds and notes, per sheet, with author and time.

**Comparison.** Two revisions are paired by sheet number (page when there is none), each
pair rendered at the same width and compared pixel by pixel: ink only in the older
revision shows blue, only in the newer red, shared ink dark. Changed blocks of a grid are
merged into boxed areas and counted; the toolbar steps through the pairs and switches
between the overlay and either revision alone.

## Measurements (debug build)

The sample set is three A3 sheets written by `scripts/make-sample-drawings.mjs`;
revision B deepens one beam and adds a note.

| Step | Result |
|---|---|
| Import revision A (render, text, thumbnails, title-block reading, store) | 518 ms |
| Sheet numbers and titles read from the title block | 3 of 3 correct |
| Import revision B with links carried forward | 191 ms, 1 link carried |
| Compare a pair of sheets at workspace width | about 2.5 s including both renders |
| Changed areas found on the framing plan | 2 (the beam size and the note), none elsewhere on the sheet |

## Problems met

- pdf.js needs `DOMMatrix` at import time, which the test environment lacks, so every
  interface test failed once the drawings store existed. The library now loads on first
  use.
- The text runs of a title block come in drawing order, not reading order; the page
  text is assembled top-to-bottom, left-to-right with line breaks, which is what search
  and the excerpt need.
- The initial schema's sheet tables keyed sheets by file. A re-issued set must be a new
  revision for comparison, so migration 005 re-creates them per revision.

## Open items

- Issues raised from sheet markups (the review data model already fits: a markup's
  sheet and region in the description, the linked elements from the region's links).
- A vector overlay (same-position line matching) to cut false changes from re-rendering
  noise on scanned or heavily hatched sheets; the pixel pass is enough for CAD exports.
- Scanned drawing sets carry no text: numbers and titles must be typed, and search finds
  nothing on them until OCR is considered.
- Rotated pages and sheets with the title block elsewhere than the bottom-right corner
  get no guessed number; the fields are editable.
