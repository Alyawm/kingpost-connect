-- 004: analysis models. The initial schema sketched analysis tables before any reader
-- existed (one row per member, results per member and load case); nothing ever wrote to
-- them. Phase 4 stores an analysis file (SAF, ETABS, SAP2000) or the structural view of an
-- IFC file as one JSON document per revision: the interface draws it whole and the
-- matcher reads it whole, so rows per member would only be copied back and forth. Link
-- reports between a physical revision and an analysis revision are stored per pair, like
-- comparisons, and edited in place for manual links.

DROP TABLE analysis_result;
DROP TABLE analysis_member;
DROP TABLE analysis_model;

CREATE TABLE analysis_model (
  revision_id    INTEGER PRIMARY KEY REFERENCES revision(id) ON DELETE CASCADE,
  source         TEXT NOT NULL,
  program        TEXT,
  length_unit    TEXT NOT NULL,
  force_unit     TEXT NOT NULL,
  node_count     INTEGER NOT NULL,
  member_count   INTEGER NOT NULL,
  surface_count  INTEGER NOT NULL,
  load_count     INTEGER NOT NULL,
  result_count   INTEGER NOT NULL,
  model_json     TEXT NOT NULL
);

CREATE TABLE analysis_link_set (
  id                    INTEGER PRIMARY KEY,
  physical_revision_id  INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  analysis_revision_id  INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  computed_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  settings_json         TEXT NOT NULL,
  report_json           TEXT NOT NULL,
  UNIQUE(physical_revision_id, analysis_revision_id)
);
