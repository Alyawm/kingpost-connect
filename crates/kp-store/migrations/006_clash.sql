-- 006: coordination. A clash test names two sets of elements (by GlobalId) and a rule
-- (hard contact, or a clearance in metres). Each run records the clashes found; a clash is
-- identified by its element pair so its status survives re-runs and new revisions, and a
-- clash that is no longer found is marked resolved rather than deleted.

CREATE TABLE clash_test (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('hard', 'clearance')),
  clearance         REAL NOT NULL DEFAULT 0,
  set_a_json        TEXT NOT NULL,
  set_b_json        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_run_at       TEXT,
  last_revision_id  INTEGER REFERENCES revision(id) ON DELETE SET NULL
);

CREATE TABLE clash (
  id             TEXT PRIMARY KEY,
  test_id        TEXT NOT NULL REFERENCES clash_test(id) ON DELETE CASCADE,
  a_global_id    TEXT NOT NULL,
  b_global_id    TEXT NOT NULL,
  kind           TEXT NOT NULL,
  distance       REAL NOT NULL DEFAULT 0,
  point_json     TEXT NOT NULL DEFAULT '[0,0,0]',
  status         TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new', 'active', 'reviewed', 'approved', 'resolved')),
  note           TEXT,
  first_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at    TEXT,
  UNIQUE (test_id, a_global_id, b_global_id)
);
CREATE INDEX clash_test_idx ON clash(test_id);
