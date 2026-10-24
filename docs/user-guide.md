# KingPost Connect — user guide

KingPost Connect is a desktop application for structural engineers: open IFC models,
review them element by element, compare revisions, overlay analysis models, link PDF
drawings to the model and run clash checks. Everything stays in a project folder on your
computer; the application makes no network connection unless you ask it to check for an
update.

## Projects

A project is a folder. Choose an empty folder to start one or a folder that already holds
a project to open it (Explorer, or `Ctrl+O`). The application keeps its data in a
`.kingpost` folder inside the project: the database, logs, thumbnails and a geometry cache.
Copy model and drawing files into the project folder; the Explorer lists them and watches
the folder for changes. Recently opened projects are listed on the welcome screen.

Supported files: IFC (2x3 and 4) for models, PDF for drawing sets, ETABS `.e2k`, SAP2000
`.s2k` and SAF `.xlsx` for analysis models.

## Models

**Import** reads an IFC file into the database as a revision: every element with its
storey, type, material and property sets. Importing the same file again after it changed
makes the next revision; earlier revisions stay. **Load** shows a revision in the viewer.
A revision opened once is cached and opens faster afterwards.

In the viewer: drag to orbit, right-drag or middle-drag to pan, wheel to zoom, `F` to fit.
Click an element to select it and see its properties in the inspector; `Ctrl+click` adds
to the selection. The model tree (Viewer section) lists storeys and types; isolate, hide and
show-all act on the selection. Section planes cut the model along an axis; "plan of
storey" places a cut just below a storey's top and looks down. Colour the model by type,
material, storey, design status, revision change or analysis link. Measure between two
points; draw markup lines; save named views with a thumbnail.

## Review

Issues follow the BCF standard, so they can be exchanged with other review tools. Create
an issue from a selection: it records the elements, the current view as a viewpoint with
a snapshot, and any markup lines. Issues carry status, priority, assignee, due date,
labels and comments. The dashboard counts open, closed and overdue issues.

Each element has a **design status** (modelled → analysed → designed → checked →
approved) set in bulk from the selection and shown in the inspector and as a colouring.

Export all issues as a BCF file for another tool, or import a BCF file; topics already
present are skipped.

## Compare

Pick a file with two or more revisions and two of its revisions. The comparison lists
elements added, removed and modified, with the exact fields and properties that changed,
counts per type, and a text filter. "By change" colours the loaded revision. Export the
list as CSV, or raise an issue on a change.

## Analysis

Import an ETABS, SAP2000 or SAF file; an IFC file that carries a structural analysis view
is picked up when imported. Show a model as a wireframe over the physical model: members
coloured by kind, nodes, supports, loads and surfaces, each layer switchable; the
physical model can be hidden. Click a member for its section, material, nodes, loads and
force diagram when results are present.

**Match with loaded model** pairs physical elements with analysis members (by name, then
by position within a tolerance) and reports section and material differences and what is
unmatched on each side. An offset corrects a shifted origin. Link or unlink by hand from
a selected element and member. "By link" colours the physical model by the result.

## Drawings

Import a PDF drawing set; each page becomes a sheet with its number and title read from
the title block (double-click to correct them). Search finds text on any sheet. Open a
sheet in the workspace: pan by dragging, zoom with the wheel.

**Link** a region of a sheet to the elements selected in the model (select first, then
draw). Double-click a region to jump to the model; the inspector's "On drawings" lists the
sheets an element appears on. Markups: rectangle, revision cloud and note.

Import a re-issued set to get the next revision; links follow the sheet numbers. **Compare
sheets** shows two revisions of each sheet overlaid: ink only in the older one blue, only
in the newer one red, changed areas boxed.

## Coordination

Make a clash test from two selections (set A, set B, or everything else), with a hard
contact rule or a clearance in millimetres, and run it on the loaded revision. Results are
grouped by the pair's types; each clash selects both elements and marks the point. Set a
status (new, active, reviewed, approved, resolved) and a note; raise an issue on a clash.
Re-running keeps statuses, resolves clashes that are gone and reopens ones that are back.

## Schedules

Pick a built-in schedule (steel members, concrete elements, reinforcement, foundations, all
elements by type) or start a new one, and it runs on the loaded revision: columns can be
element fields, any property of the revision, or derived quantities (count, length,
volume, area, mass). Group by any column, choose sum, count, average, minimum or maximum
per column, filter by type, storey or text, and sort by clicking a heading. Length, volume
and area come from the model's base quantities when it has them and are measured from the
geometry once otherwise; mass is volume times a density from the project's density table
(editable in the panel; common steel, concrete, timber, aluminium and masonry names have
defaults, and materials without one are listed). Click a row to select its elements in the
model. Save a schedule as a preset for the project; export as XLSX or CSV with totals.

## Settings and help

Settings (`Ctrl+,`): your name (recorded on everything you create), theme, update
checks, licence key, geometry cache and the diagnostics bundle. Help (`F1`) lists the
keyboard shortcuts. The command palette (`Ctrl+K`) reaches every action.

Without a licence key the application runs as an evaluation copy with every feature.
Paste a key from your vendor in Settings; it is checked on your computer.

If something goes wrong, Settings → "Save log bundle…" writes a zip with the logs and
project details for support. Nothing is sent automatically.
