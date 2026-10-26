# Devlog — Sync through a shared folder (v1.9.0)

Date: 2026-10-26
Phase: 9 of the roadmap in `docs/PLAN.md` (cloud and sync), first part

## What was built

**Change log.** Migration 010 adds `change_log`, `sync_pending`, `sync_cursor`,
`sync_published` and `sync_meta`. Every connection installs temporary triggers on the
fourteen shared tables when the store opens; they record each insert, update and delete
with the whole row as JSON (blobs as hex, a drawing sheet as path, hash and page) and a
hybrid logical clock. `Store::apply_changes` applies received changes newest-per-row,
keeps what cannot be applied yet and retries it; `snapshot_unlogged` records content made
before sync was switched on. See ADR 014.

**Shared folder transport.** `crates/kp-sync` writes this copy's changes as numbered
JSON-lines files in its own device folder, publishes the latest revision of each model,
drawing and analysis file as a blob named by its hash, reads the other device folders,
copies received files into the project and reports them for import. Each copy writes only
its own files.

**Desktop.** A cloud button in the title bar shows the state (not set up, synced, syncing,
something waiting) and opens the Sync panel: choose the shared folder, sync now, automatic
sync on opening and every two minutes, the other copies with their user, computer and
last sync, what is waiting and why, change folder, stop syncing. Received files are
imported with the usual importers, then the review, notes, views, clash and drawing
panels reload. The Projects page has **Join shared project…**: pick the shared folder,
then an empty folder for your copy; the first sync fills it.

## Measurements (debug build, sample project: 22.5 MB Revit export, 6,921 elements)

| Step | Result |
|---|---|
| First sync of the existing project | 6,949 rows (6,924 of them clash results, 4.6 MB) and 5 files in 1.6 s |
| Join from an empty folder, first sync with imports | 10.2 s: 6,945 rows applied, 5 files copied and imported (IFC, ETABS, PDF with its 3 sheets) |
| Comment and status change made in the joined copy | arrived in the original on its next sync (3 rows) |
| Re-running a clash test with the same result | 0 rows recorded |

## Problems met

- Panels reloaded when the project id changed; a joined copy has the same id as the
  original, so switching between two copies on one machine kept the first copy's issues
  on screen. They now reload when the project folder changes.
- A reload during the first sync interrupted the imports, and the file notices had
  already been marked as handled, so one model and the drawing's sheets never arrived. A
  notice now counts as handled only once a revision with its hash exists.
- Every clash re-run touched each clash's last-seen time, which would have resent
  thousands of rows per run. Last-seen and last-run times are local now, and an update is
  recorded only if a shared column changed.
- Markups on an older drawing revision cannot be placed in a copy that only ever had the
  current one; they wait, with the reason shown in the Sync panel.

## Open items

- A sync server with accounts and sharing by invitation, on the same change format.
- A web viewer reusing the viewer package.
- Compaction of the shared folder and the log.
