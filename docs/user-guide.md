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

## Window and Projects page

The title bar shows the open project and model; **Projects** opens the Projects page,
which is also what the application shows whenever no project is open (so it is the first
thing a new user sees). It lists pinned projects and recent ones with when each was last
opened; pin or remove a project from its card, search by name or folder, open a project
folder, start a new one in any folder, or open the sample project. Commands, help,
settings and the theme are on the right of the title bar.

Under the title bar the main toolbar holds the viewer tools, left to right: select and
box select; hide, show only, ghost the rest, show all and colour/transparency (for the
selection); fit all, fit selection and edge lines; measure, section, markup and clear;
new issue from the selection and save the view; undo and redo. On the right: orbit, pan
and walk, and focus mode (hide the panels).

## Sample project

On the welcome screen, **Try the sample project** creates a "KingPost Sample" folder in
your Documents with a small sample building, imports it and opens it in the viewer. The
frame shown when the application starts is only a picture; colour, transparency, hide
and views need a model loaded from a project like this one.

## Models

**Import** reads an IFC file into the database as a revision: every element with its
storey, type, material and property sets. Importing the same file again after it changed
makes the next revision; earlier revisions stay. **Load** shows a revision in the viewer.
A revision opened once is cached and opens faster afterwards.

**Drag and drop.** Drop IFC, PDF or analysis files onto the window to copy them into the
project; IFC files are imported and the last one is shown. A file already in the project
folder is used where it is; a newer copy with the same name replaces the old file, so its
import becomes the next revision. With no project open, the folder of the dropped file
becomes the project.

In the viewer: drag to orbit, middle-drag or right-drag to pan, wheel to zoom towards the
cursor, `F` to fit. Click an element to select it and see its properties in the inspector;
`Ctrl+click` adds to the selection. **Shift+drag** draws a selection box: left to right
takes elements entirely inside it, right to left also takes those it touches; hold `Ctrl`
as well to add to the selection. Colour the model by type, material, storey, design status,
revision change or analysis link. Measure between two points; draw markup lines.

**Several models at once.** With a model loaded, **+ Add** next to another revision in the
Explorer shows it with the main model, lined up in IFC world coordinates (architecture,
structure and services exported separately fall into place). The Models list in the Model
panel shows the main model and the reference models: hide or show each, give it one colour
or make it see-through, fit it, remove it, or make it the main model (the tree, properties,
schedules and review work on the main model). Clicking an element of a reference model
shows its properties. Saved views remember the reference models. In Coordination, "set B =
all of …" runs a clash test between the main model's set A and a reference model.

**Measuring.** The ruler opens the measure panel. Modes: **Distance** (two points, with the
X/Y/Z components), **Angle** (point, corner, point), **Perpendicular** (a face, then a
point: the distance square to that face), **Edge length** (one click on an edge) and
**Point** (coordinates and elevation in the model's own coordinates). Points snap to
corners (green), midpoints (cyan), edges (pink) and faces (orange); each snap can be
switched off. A tip next to the cursor says what it will snap to and shows the value as
you move. **Ortho** (or holding Shift) keeps distances along X, Y or Z. Every measurement
is listed with its own delete button; **Clear all measurements** removes them all; Esc
drops a measurement in progress and Backspace removes the last one.

**Viewport controls.** Top right: **Orbit**, **Pan** and **Walk** decide what a left drag
does. In Walk, drag to look around and move with `W A S D` or the arrow keys, `Q`/`E` for
down and up, `Shift` to go faster, the wheel to step forward. **Undo** and **Redo**
(`Ctrl+Z`, `Ctrl+Y`) step back through hiding, colours, transparency and section planes;
changes made in one go (a slider drag) are one step. The edge button draws element outlines
(on by default; drawn in the background after a model opens). The last button hides the
panels to focus on the model. The cube in the bottom corner turns with the view: click a
face to look from that side, or **Iso** for the standard view. Camera moves are animated
unless Windows is set to reduce motion.

**Section planes.** Use **Place on face** (or the scissors in the viewport toolbar) and
click any face: a plane is placed on it, facing out of the face, and nothing is cut yet.
Drag the plane's arrow into the model to cut. Add as many planes as needed; every enabled
plane cuts, so planes on several sides make a section box. In the Model panel each plane
can be switched off, flipped to keep the other side, moved with a slider, or removed; the
eye hides the plane handles. **+ Plan**, **+ X** and **+ Z** add planes through the model
centre, and "Plan view of storey" places a cut just below a storey's top and looks down.
Section planes are saved in views and in issue viewpoints (BCF).

**Colours and transparency.** With elements selected, a bar at the bottom of the viewport
shows how many are selected and their overall size (width × depth × height), and offers
Appearance (colour swatches, a custom colour, a transparency slider), Hide (`H`), Show
only (`I`), Ghost everything else (`G`), fit and reset. `Shift+H` shows everything again
and `Esc` clears the selection. A colour set here wins over "colour by"; the reset button
in the Model panel header returns every element to its original look.

**Model tree.** Group the tree by storey › type, type › type name, or material › type.
Every group and element row has a colour and transparency button and an eye to hide or
show it; a small swatch shows a group's colour. Double-click a group (or use "sel") to
select all of its elements.

**Views.** Save the current view by name: camera, section, colour-by mode, colours,
transparency and hidden elements, with a thumbnail. Click a view to return to it. Hover a
view to update it with what is on screen now, rename or delete it. Views remember elements
by their IFC GlobalId, so a view saved on one revision also applies to the next; elements
that no longer exist are reported in the output panel. "Default view" shows everything in
its original colours without a section. The star on a view makes it the project's default
look: it is applied whenever a model of the project is opened. **Play** shows the saved
views one after another, a few seconds each, like a presentation; **Stop** ends it.

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

Columns carry letters (A, B, C…). **+ Formula** adds a column computed from others, for
example `[Mass] / [Length]` for mass per metre or `C / D * 1000`; it understands `+ - * /`,
`^` and parentheses, and gives no value where an input is empty. Drag columns by their
handle to reorder them (letters in formulas follow their columns); double-click a column
name to rename it. Lengths, areas and volumes from the model's quantities are converted
using the units the IFC file declares (millimetres, feet and so on).

## Settings and help

Settings (`Ctrl+,`): your name (recorded on everything you create), theme, update
checks, licence key, geometry cache and the diagnostics bundle. Help (`F1`) lists the
keyboard shortcuts. The command palette (`Ctrl+K`) reaches every action.

Without a licence key the application runs as an evaluation copy with every feature.
Paste a key from your vendor in Settings; it is checked on your computer.

If something goes wrong, Settings → "Save log bundle…" writes a zip with the logs and
project details for support. Nothing is sent automatically.
