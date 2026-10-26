-- Sync between copies of a project. Every change to shared project content (issues,
-- comments, statuses, views, notes, links, drawing markups, clash reviews ...) is
-- recorded in change_log by connection-level triggers; copies exchange those records and
-- apply each other's changes, newest first per row. Tables rebuilt from the model files
-- (elements, properties, sheets, comparisons) are not recorded.

CREATE TABLE sync_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE change_log (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  id        TEXT NOT NULL UNIQUE,
  hlc       TEXT NOT NULL,
  device    TEXT NOT NULL,
  tbl       TEXT NOT NULL,
  pk        TEXT NOT NULL,
  op        TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  row_json  TEXT,
  origin    TEXT NOT NULL DEFAULT 'local' CHECK (origin IN ('local', 'remote'))
);
CREATE INDEX change_log_row_idx ON change_log (tbl, pk, hlc);
CREATE INDEX change_log_origin_idx ON change_log (origin, seq);

-- Changes received but not applicable yet (for example a markup on a drawing that has not
-- been imported here). They are tried again after every sync and import.
CREATE TABLE sync_pending (
  id           TEXT PRIMARY KEY,
  change_json  TEXT NOT NULL,
  reason       TEXT NOT NULL,
  received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- How far each remote has been read: remote is the transport and address, peer the device
-- or stream within it, position is transport specific.
CREATE TABLE sync_cursor (
  remote    TEXT NOT NULL,
  peer      TEXT NOT NULL,
  position  TEXT NOT NULL,
  PRIMARY KEY (remote, peer)
) WITHOUT ROWID;

-- File revisions already published to a remote, by content hash.
CREATE TABLE sync_published (
  remote  TEXT NOT NULL,
  sha256  TEXT NOT NULL,
  PRIMARY KEY (remote, sha256)
) WITHOUT ROWID;
