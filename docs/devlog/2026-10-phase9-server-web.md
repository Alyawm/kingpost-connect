# Devlog — Sync server and web viewer (v2.0.0)

Date: 2026-10-26
Phase: 9 of the roadmap in `docs/PLAN.md` (cloud and sync), second part; completes the phase

## What was built

**Sync server.** `crates/kp-server` builds `kingpost-server`, one program with its own
SQLite database and a folder of files by hash. Accounts (the first is the administrator;
after that only invited people can sign up unless sign-up is opened), projects with owners,
editors and viewers, invitations by email that turn into membership at sign-up, the change
relay with a cursor, file notices, and streamed, hash-checked uploads. Command line:
`serve`, `add-user`, `set-password`, `list-users`. It serves the web viewer from a `web`
folder next to it. See ADR 015 and `docs/server.md`.

**Desktop.** The Sync panel offers **Shared folder** or **Server**. With a server: address
(with a warning for unencrypted addresses), sign in or create an account, then the same
sync as with a folder, plus a **People** section where owners invite by email with a role
and remove access, and anyone can leave. The Projects page's **Join shared project…** now
offers a shared folder or a server (sign in, list the projects you were given, pick one and
a folder). Sign-ins are kept per server in the application's settings folder.

**Passing changes on.** Received changes now record which remote they came through
(migration 011). A copy that synced through a shared folder and then moves to a server sends
the server what it received from the folder too, so nobody who joins later misses an edit,
and nothing is echoed back where it came from.

**Shared code.** `kp_sync::files` holds publishing and receiving files for both transports
(newest version across all copies, keep both on conflict, retry an interrupted import);
`kp_sync::protocol` holds the request and reply types both the server and the desktop use.

**Web viewer.** `apps/web`, served by the server: sign in, your projects, the latest
version of each shared model in 3D, issues with viewpoints (camera, highlighted elements,
section planes), comments and element highlighting; editors comment and change status, and
those changes reach desktop copies at their next sync. Works from phone width up.

## Measurements (local server, debug desktop build, 22.5 MB sample model)

| Step | Result |
|---|---|
| Connect an existing project to an empty server, first sync | 2.0 s: 6,949 rows and 5 files (22.5 MB IFC included) |
| Pass on the folder copy's edits after moving to the server | 3 rows, once; nothing on the next sync |
| Join from the server into an empty folder | 10.7 s: 6,948 rows applied, 5 files imported, 3 drawing sheets |
| Web viewer: open the project and the model | under 8 s from the click (download and parse in the browser) |
| Comment from the web viewer to a desktop copy | arrived at the next sync (1 row) |
| Server program size | 2.3 MB (Windows, release) |

Server integration tests run the real server on a local port with project copies syncing
through it: invitation and sign-up, viewers kept read-only, strangers and ended sessions
refused, hash-checked uploads, the last owner protected, and the move from a shared folder.

## Problems met

- reqwest 0.13 without its default TLS provider panics when a client is built; the updater
  installs the ring provider itself, so the sync client now does the same when none is set.
- reqwest 0.13 puts query-string building behind a feature; the one query value is encoded
  by hand instead.
- Windows application control blocked freshly built procedural-macro libraries during the
  first server build (os error 4551); cleaning and rebuilding those three crates cleared it.
- The first server sync revealed the edits a copy had received through the shared folder
  were not being sent on, which led to recording the remote on each received change.
- SQLite writes blobs in capital hex; the web viewer's snapshot check expected lower case.
- The People list reloaded on every automatic sync while the panel was open (an effect
  depending on an object rebuilt each time); it now depends on plain values.

## Open items

- Compaction of change logs on copies, in shared folders and on the server.
- Email delivery of invitations, if the client wants the server to send mail.
- Drawings and markups in the web viewer.
