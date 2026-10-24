# 007 — Sheets are read and compared in the interface with pdf.js; links follow sheet numbers

Status: Accepted
Date: 2026-10-24

## Context

Phase 5 puts drawing sets next to the model: a sheet index with numbers and titles, text
search, markups, regions linked to elements and saved views, and a comparison of two
issues of the same set. The plan named `pdfium-render` for extraction on the Rust side
and pdf.js for display. Two questions decided the shape: where PDF work happens, and how
links survive a re-issued set.

## Options

**Where PDF work happens**
1. **pdf.js only, in the WebView.** Rendering, text extraction, thumbnails and the pixel
   comparison all run where the canvas is; the shell stores what the interface read.
2. pdfium on the Rust side for text and thumbnails, pdf.js for display. Two PDF engines,
   a native library to ship per platform, and two readings of the same page that can
   disagree.
3. pdfium for everything, images sent over IPC. Large transfers on every zoom.

**Link identity across revisions**
1. **Links belong to a sheet of a revision and are copied forward by sheet number** (page
   when there is no number) when a new revision is imported.
2. Links belong to a file and a page. A re-issued set with an inserted sheet shifts every
   page after it.
3. Links belong to a sheet number only, shared by all revisions. A region drawn on an old
   issue silently applies to a new one whose layout changed.

## Decision

Options 1 and 1.

- `apps/desktop/src/lib/pdf.ts` wraps pdf.js: render a page at a width, read the text runs
  with their positions, make a thumbnail, and compare two renderings pixel by pixel. The
  library loads on first use. The sheet number and title are guessed from the text runs in
  the bottom-right corner (a "Sheet No" label and the code next to it, else a code-like
  run; the most prominent line of capitals as the title) and stay editable.
- The shell stores sheets per revision (`sheet`), with the page text for search, and the
  interface registers them right after import. Links (`sheet_link`) and markups
  (`sheet_markup`) hang off a sheet; regions are rectangles in page fractions so they do
  not depend on zoom or resolution.
- Importing a new revision of a PDF copies the previous revision's links onto the sheets
  with the same number. The old revision keeps its own; both are listed on the element.
- Comparison renders the paired sheets of two revisions at the same width and shows ink
  only in the older one blue, only in the newer one red, shared ink dark, with changed
  blocks of a grid merged into boxed areas.

## Consequences

- No native PDF dependency. Text extraction quality is pdf.js's: drawings exported from
  CAD and BIM tools carry real text; scanned sheets have none and get no number, no title
  and no search hits until typed in by hand.
- The pixel comparison finds any visible change, including a moved title block or a
  re-drawn north arrow, and cannot tell what changed. Carried-forward links stay where
  they were drawn, so a sheet whose layout moved needs its links redrawn; the comparison
  shows exactly where.
- Page coordinates are fractions, so a region drawn on an A1 issue stays in place on an
  A3 reprint of the same layout.
- Thumbnails are stored as PNG in the database (a few tens of kilobytes per sheet).
