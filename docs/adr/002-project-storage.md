# 002 — A project is a folder with a `.kingpost/` directory

Status: Accepted
Date: 2026-10-24

## Context

Structural teams already keep models and drawings in project folders on shared drives and
in file-sync tools. The application needs somewhere to keep what it learns about those
files (elements, properties, issues, statuses, links) without taking the files hostage or
requiring a server.

## Options

**Central database in the user profile.** One SQLite file for all projects. Simple to find,
but a project cannot be moved, shared or archived with its data, and two people cannot work
on the same folder.

**Proprietary project file** (`.kpc` bundle). Portable, but opaque to ordinary tools and a
constant source of "which file is current" questions when models live next to it.

**A hidden directory inside the project folder.** Data travels with the folder, is visible
to anyone who looks, and works with any sync tool. Concurrency is left to the sync tool and
to SQLite's locking, which is adequate for the single-writer use that the desktop has.

## Decision

A project is any folder. The application writes only inside `<folder>/.kingpost/`:

- `project.json` — small manifest: `manifest_version`, `id`, `name`, `created_at`. Written
  atomically through a temporary file.
- `project.db` — SQLite database in WAL mode with foreign keys on; schema managed by
  numbered migrations recorded in SQLite's `user_version`.
- Later: `cache/` for geometry fragments, `bcf/` for issue files, `thumbnails/`.

The manifest is the source of truth for identity; the database `project` row follows it on
open. A manifest or database written by a newer build is refused rather than guessed at.

## Consequences

- Moving, zipping or syncing a folder moves the project. Deleting `.kingpost/` resets it.
- Database migrations are append-only (`crates/kp-store/migrations/`); shipped migrations
  are never edited.
- Multi-user editing of one folder is not supported in this phase. The future sync phase
  builds on a change log, not on sharing the SQLite file.
