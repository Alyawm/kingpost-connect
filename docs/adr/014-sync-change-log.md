# 014 — Sync by a per-row change log recorded with triggers; shared folders as the first transport

Status: Accepted
Date: 2026-10-26

## Context

Phase 9 of the plan asks for sharing a project between people and computers. Until now a
project lived in one folder on one machine; colleagues exchanged BCF files. Engineers
already have somewhere they all can reach — a OneDrive or SharePoint library, Dropbox,
Google Drive, a network share — and many firms will not run a server for a desktop tool.
The shared content is the review work: issues, comments, viewpoints, element statuses,
saved views, notes, links, drawing links and markups, clash tests and their reviews,
presets and densities. Everything else (elements, properties, sheets, comparisons,
analysis models) is rebuilt from the model and drawing files, which must travel too.

## Options

**What to exchange**
1. **A log of row changes**: every insert, update and delete on a shared table, with the
   whole row, ordered by a hybrid logical clock; the newest change per row wins.
2. The database file itself, copied by the cloud drive. SQLite files under a sync client
   are a classic way to lose data: two writers, half-uploaded pages, conflict copies.
3. BCF files written on every change. Covers issues only, and merging BCF is its own
   problem.

**How changes are recorded**
1. **Temporary triggers** installed by every connection when the store opens, generated
   from the table's columns. Feature code that writes its own SQL (several crates do) is
   covered without knowing sync exists; triggers are rebuilt each time, so a later
   migration that adds a column needs nothing more.
2. Explicit calls in every store function. Easy to miss one; nothing catches it.

**How copies meet**
1. **A shared folder**, each copy writing only inside its own device folder plus
   write-once content-addressed blobs. No two writers on any file, so cloud drives never
   make conflict copies; files are written under a temporary name and renamed.
2. A sync server. Needed for accounts and sharing by invitation, but a later step, using
   the same change format.

## Decision

Options 1, 1 and 1, with the server to follow on the same log.

- `change_log` (migration 010) holds local and received changes. A received change is
  applied only if its clock is newer than every change known for that row, so applying
  is idempotent and order-independent. Received rows are written with
  `INSERT ... ON CONFLICT DO UPDATE` (never `REPLACE`, which would cascade-delete
  children), with the triggers switched off by a connection-level flag.
- The clock is wall-clock milliseconds, a counter and the device id, and moves past every
  received change. Ties break on the change id.
- A device id belongs to one database file on one machine and user: a copied folder, or
  the same folder opened by someone else, gets a new one.
- Columns that only make sense locally are not sent: a clash test's last run and
  revision, a clash's last-seen time. An update is recorded only if a shared column
  changed, so re-running a clash test that finds the same clashes records nothing.
- Drawing links and markups refer to a local sheet number; they travel with a key of the
  file path, the file's SHA-256 and the page, and wait until that sheet exists here.
- Two copies can create "the same" row under different ids (an issue imported from the
  same BCF file, a clash found by both). Tables with a natural key (issue `bcf_guid`;
  clash test and element pair) update the existing row instead of failing.
- What cannot be applied yet (a comment before its issue, a markup before its drawing, a
  table from a newer version) is kept in `sync_pending` and retried after every sync and
  import.
- Files: the latest revision of each shared file is published as a blob named by its hash
  with a notice (path, kind, when it was imported). A receiving copy writes it into the
  project when the path is free or holds a version it has already imported and that is
  older; a file changed and not imported on both sides is kept twice
  (`frame (from Sam).ifc`). A notice counts as handled only once a revision with that hash
  exists, so an interrupted import is offered again.
- Joining: a copy is created from the shared folder with the same project id, so copies
  recognise each other.

## Consequences

- Sync works with whatever the firm already has, offline in between, with no server and
  no account. The application still makes no network connection of its own.
- Last writer wins per row: two people editing the same issue title at the same time keep
  the later edit. Comments, notes and markups are separate rows, so they never collide.
  A machine with a wrong clock wins more often than it should.
- Received change files are remembered one by one rather than by position, because cloud
  drives deliver files out of order.
- Only the current content of each file can be published, so a markup on an older drawing
  revision that one copy never had stays waiting there, with that reason shown.
- The log and the shared folder only grow. Compaction (a snapshot per device and pruning
  of rows superseded everywhere) is left for when a real project needs it.
- The first sync of an existing project sends everything it holds; on the 6,921-element
  sample with its clash results that was 6,949 rows (4.6 MB) in 1.6 s.
