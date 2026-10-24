-- 007: quantities and schedules. Geometry-derived quantities per element (the interface
-- measures them from the meshes; they fill in when a model carries no base quantities),
-- an editable material density table per project, and the preset table opened up to any
-- kind so schedule definitions can be saved alongside future presets.

CREATE TABLE material_density (
  material  TEXT PRIMARY KEY,
  density   REAL NOT NULL,
  note      TEXT
);

CREATE TABLE preset_new (
  id               TEXT PRIMARY KEY,
  scope            TEXT NOT NULL CHECK (scope IN ('user', 'project')),
  kind             TEXT NOT NULL,
  name             TEXT NOT NULL,
  definition_json  TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO preset_new (id, scope, kind, name, definition_json)
  SELECT id, scope, kind, name, definition_json FROM preset;
DROP TABLE preset;
ALTER TABLE preset_new RENAME TO preset;
CREATE INDEX preset_kind_idx ON preset(kind, name);
