-- 009: notes placed in the model, and links from elements to web pages or files.
-- Notes keep their point in IFC world coordinates so they stay put across revisions;
-- both tables refer to elements by GlobalId for the same reason.

CREATE TABLE note (
  id          TEXT PRIMARY KEY,
  global_id   TEXT,
  point_json  TEXT NOT NULL,
  text        TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE element_link (
  id          TEXT PRIMARY KEY,
  global_id   TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('url', 'file')),
  target      TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX element_link_global_id ON element_link (global_id);
