-- 002: what an import needs to link stored facts back to the file and to geometry.
--
-- express_id ties an element row to the geometry web-ifc produces from the same file.
-- type_name and material are resolved at import so the interface never re-reads the IFC.
-- Property kinds grew past the original CHECK list (number, angle, force, pressure,
-- density); the table is recreated without the constraint. It is empty in every database
-- that exists at this point, so nothing is copied.

ALTER TABLE revision ADD COLUMN schema TEXT;
ALTER TABLE revision ADD COLUMN units_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE revision ADD COLUMN element_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE element ADD COLUMN express_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE element ADD COLUMN type_name TEXT;
ALTER TABLE element ADD COLUMN material TEXT;
ALTER TABLE element ADD COLUMN has_geometry INTEGER NOT NULL DEFAULT 0;
ALTER TABLE element ADD COLUMN is_spatial INTEGER NOT NULL DEFAULT 0;
CREATE INDEX element_express_idx ON element(revision_id, express_id);
CREATE INDEX element_name_idx ON element(revision_id, name);

DROP TABLE property;
CREATE TABLE property (
  element_id  INTEGER NOT NULL REFERENCES element(id) ON DELETE CASCADE,
  pset        TEXT NOT NULL,
  name        TEXT NOT NULL,
  value_text  TEXT,
  value_num   REAL,
  unit        TEXT,
  kind        TEXT NOT NULL,
  PRIMARY KEY (element_id, pset, name)
) WITHOUT ROWID;
CREATE INDEX property_name_idx ON property(pset, name);
