-- 001: initial schema. Mirrors the domain model in docs/PLAN.md §4.
--
-- One database per project folder, so tables do not carry a project_id column;
-- the single `project` row identifies the owner. Timestamps are ISO-8601 UTC text.
-- IFC GlobalIds are kept as text so that issues, statuses and links survive re-imports.

CREATE TABLE project (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  settings_json TEXT NOT NULL DEFAULT '{}'
);

-- Files tracked inside the project folder.
CREATE TABLE file (
  id        INTEGER PRIMARY KEY,
  rel_path  TEXT NOT NULL UNIQUE,
  kind      TEXT NOT NULL CHECK (kind IN ('ifc', 'pdf', 'saf', 'e2k', 's2k', 'other')),
  sha256    TEXT,
  size      INTEGER,
  mtime     TEXT
);

-- Each import of a file is a revision; comparisons run between two revisions.
CREATE TABLE revision (
  id             INTEGER PRIMARY KEY,
  file_id        INTEGER NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  idx            INTEGER NOT NULL,
  imported_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source_sha256  TEXT NOT NULL,
  note           TEXT,
  UNIQUE (file_id, idx)
);

CREATE TABLE element (
  id           INTEGER PRIMARY KEY,
  revision_id  INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  global_id    TEXT NOT NULL,
  ifc_type     TEXT NOT NULL,
  name         TEXT,
  tag          TEXT,
  storey       TEXT,
  system       TEXT,
  parent_id    INTEGER REFERENCES element(id) ON DELETE SET NULL,
  UNIQUE (revision_id, global_id)
);
CREATE INDEX element_type_idx ON element(revision_id, ifc_type);
CREATE INDEX element_storey_idx ON element(revision_id, storey);

CREATE TABLE property (
  element_id  INTEGER NOT NULL REFERENCES element(id) ON DELETE CASCADE,
  pset        TEXT NOT NULL,
  name        TEXT NOT NULL,
  value_text  TEXT,
  value_num   REAL,
  unit        TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('length', 'area', 'volume', 'mass', 'count', 'bool', 'text', 'date')),
  PRIMARY KEY (element_id, pset, name)
) WITHOUT ROWID;
CREATE INDEX property_name_idx ON property(pset, name);

CREATE TABLE geometry_ref (
  element_id    INTEGER PRIMARY KEY REFERENCES element(id) ON DELETE CASCADE,
  fragment_id   TEXT NOT NULL,
  bbox_min_x    REAL, bbox_min_y REAL, bbox_min_z REAL,
  bbox_max_x    REAL, bbox_max_y REAL, bbox_max_z REAL,
  volume        REAL,
  surface_area  REAL,
  length        REAL
);

CREATE TABLE saved_view (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  camera_json          TEXT NOT NULL,
  visibility_json      TEXT NOT NULL DEFAULT '{}',
  section_planes_json  TEXT NOT NULL DEFAULT '[]',
  thumbnail            BLOB,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE preset (
  id               TEXT PRIMARY KEY,
  scope            TEXT NOT NULL CHECK (scope IN ('user', 'project')),
  kind             TEXT NOT NULL CHECK (kind IN ('filter', 'colorize', 'schedule')),
  name             TEXT NOT NULL,
  definition_json  TEXT NOT NULL
);

CREATE TABLE issue (
  id          TEXT PRIMARY KEY,
  bcf_guid    TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  priority    TEXT,
  assignee    TEXT,
  due         TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE issue_comment (
  id            TEXT PRIMARY KEY,
  issue_id      TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  author        TEXT NOT NULL,
  text          TEXT NOT NULL,
  viewpoint_id  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE issue_element (
  issue_id           TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  element_global_id  TEXT NOT NULL,
  PRIMARY KEY (issue_id, element_global_id)
) WITHOUT ROWID;

CREATE TABLE element_status (
  element_global_id  TEXT PRIMARY KEY,
  stage              TEXT NOT NULL CHECK (stage IN ('modelled', 'analysed', 'designed', 'checked', 'approved')),
  set_by             TEXT NOT NULL,
  set_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  note               TEXT
) WITHOUT ROWID;

CREATE TABLE diff_result (
  id                INTEGER PRIMARY KEY,
  from_revision_id  INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  to_revision_id    INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  computed_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  summary_json      TEXT NOT NULL,
  UNIQUE (from_revision_id, to_revision_id)
);

CREATE TABLE diff_item (
  diff_result_id  INTEGER NOT NULL REFERENCES diff_result(id) ON DELETE CASCADE,
  global_id       TEXT NOT NULL,
  change          TEXT NOT NULL CHECK (change IN ('added', 'removed', 'modified')),
  detail_json     TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (diff_result_id, global_id)
) WITHOUT ROWID;

CREATE TABLE analysis_model (
  id          INTEGER PRIMARY KEY,
  file_id     INTEGER NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  format      TEXT NOT NULL,
  units_json  TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE analysis_member (
  id                 INTEGER PRIMARY KEY,
  analysis_model_id  INTEGER NOT NULL REFERENCES analysis_model(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  type               TEXT NOT NULL CHECK (type IN ('beam', 'column', 'brace', 'slab', 'wall', 'other')),
  section            TEXT,
  material           TEXT,
  node_ids_json      TEXT NOT NULL DEFAULT '[]',
  linked_global_id   TEXT
);

CREATE TABLE analysis_result (
  member_id  INTEGER NOT NULL REFERENCES analysis_member(id) ON DELETE CASCADE,
  load_case  TEXT NOT NULL,
  kind       TEXT NOT NULL,
  value_min  REAL,
  value_max  REAL,
  PRIMARY KEY (member_id, load_case, kind)
) WITHOUT ROWID;

CREATE TABLE sheet (
  id         INTEGER PRIMARY KEY,
  file_id    INTEGER NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  page       INTEGER NOT NULL,
  number     TEXT,
  title      TEXT,
  scale      TEXT,
  thumbnail  BLOB,
  UNIQUE (file_id, page)
);

CREATE TABLE sheet_link (
  id                 INTEGER PRIMARY KEY,
  sheet_id           INTEGER NOT NULL REFERENCES sheet(id) ON DELETE CASCADE,
  region_json        TEXT NOT NULL,
  element_global_id  TEXT,
  view_id            TEXT REFERENCES saved_view(id) ON DELETE CASCADE,
  CHECK (element_global_id IS NOT NULL OR view_id IS NOT NULL)
);

CREATE TABLE markup (
  id             TEXT PRIMARY KEY,
  sheet_id       INTEGER REFERENCES sheet(id) ON DELETE CASCADE,
  view_id        TEXT REFERENCES saved_view(id) ON DELETE CASCADE,
  author         TEXT NOT NULL,
  kind           TEXT NOT NULL,
  geometry_json  TEXT NOT NULL,
  text           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (sheet_id IS NOT NULL OR view_id IS NOT NULL)
);
