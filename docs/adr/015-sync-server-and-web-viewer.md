# 015 — A self-hosted relay server on the same change log; the web viewer rebuilds state in the browser

Status: Accepted
Date: 2026-10-26

## Context

ADR 014 gave every copy of a project a change log and a first transport, the shared folder.
Phase 9 also asks for accounts, sharing by invitation and a web viewer. Firms differ: some
will never run a server, some want their own, few want project data on a vendor's cloud.
Whatever we add must keep the shared folder working and must not fork the data model.

## Options

**What the server is**
1. **A relay and file store**: it keeps accounts, projects, members, every change record a
   copy sends (in arrival order) and the files by hash. It never interprets or merges rows;
   copies apply each other's changes with the rule they already use.
2. A server that holds the project database and applies changes centrally. One source of
   truth, but a second implementation of every table and rule, and copies could no longer
   work offline in the same way.

**How it is hosted**
1. **One binary (Rust, axum, SQLite) the firm runs**, behind its own HTTPS proxy when it is
   reachable from outside. Nothing to install besides it.
2. A hosted service. Costs money to run, needs a privacy agreement with every client, and
   is not what the plan's "local first" rule promised.

**The web viewer**
1. **A separate small React app served by the server**, reusing the viewer and UI
   packages, which reads the change records and rebuilds the issues, comments and
   viewpoints in the browser with the same newest-per-row rule, and writes comments and
   status changes as change records of its own (as a device named `web-…`).
2. Server-side rendering of state. Needs option 2 above.

## Decision

Options 1, 1 and 1.

- `crates/kp-server`: `/api/v1` as described in `kp_sync::protocol`. Passwords are Argon2id
  hashes; sessions are random tokens stored as SHA-256 hashes and last 90 days from last
  use; failed sign-ins are throttled per email. The first account is the administrator;
  afterwards only invited people may sign up unless `--open-signup` is set. Roles are owner,
  editor and viewer; non-members are told a project does not exist. Files are streamed to
  disk, checked against their hash and stored once; a project can read only the files
  uploaded to it.
- `kp_sync::server`: the desktop client, on the HTTP stack the updater already ships
  (reqwest with rustls and the ring provider), so the installer barely grows. A sync
  creates the project on the server on first use, sends this copy's changes, pulls the
  server's from a cursor, and publishes and receives files through the same code as the
  folder transport (`kp_sync::files`).
- Changes carry the remote they arrived through (migration 011). A copy sends a remote its
  own changes and what it received another way, never back where it came from, so a
  project that moves from a shared folder to a server keeps every edit.
- Sign-ins live in the application's configuration folder (`sync-accounts.json`), one per
  server, never in a project. An ended sign-in is forgotten and the panel asks again.
- `apps/web`: sign-in, the user's projects, the latest version of each shared model
  (downloaded once per visit, opened with web-ifc in the browser), issues with viewpoints,
  comments and element highlighting, comments and status changes for editors. GlobalIds
  for highlighting are read from the IFC text with a regular expression rather than a
  second parser. The layout works from phone width up.

## Consequences

- A firm can choose: shared folder (no accounts), its own server (accounts, invitations,
  web access), or move from one to the other without losing anything.
- The server holds no merged state, so it cannot answer "what is the current status of
  issue X" without replaying the log; the web viewer does that replay at each visit. For
  projects with very long logs this costs a few seconds; compaction (ADR 014) would help
  both.
- The server stores every change ever sent; its data folder only grows, like the folder
  transport. Backups are a file copy.
- The web viewer shows the newest model of each file and the review content, not the
  analysis, drawings, schedules or comparisons, which stay desktop features.
- The server speaks plain HTTP; HTTPS is the reverse proxy's job (documented in
  `docs/server.md`). The desktop warns when an address is not encrypted.
- The server sends no email; inviting someone means telling them the address.
