-- 005: drawings. The initial schema sketched sheet tables keyed by file; nothing wrote to
-- them. Sheets belong to a revision of a PDF file so a re-issued drawing set gets a new
-- revision and the two can be compared page by page. Links tie a region of a sheet to an
-- element (by GlobalId) or a saved view; markups are drawn on a sheet in page
-- coordinates. The page text is stored for search.

DROP TABLE markup;
DROP TABLE sheet_link;
DROP TABLE sheet;

CREATE TABLE sheet (
  id           INTEGER PRIMARY KEY,
  revision_id  INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  page         INTEGER NOT NULL,
  number       TEXT,
  title        TEXT,
  scale        TEXT,
  width        REAL NOT NULL DEFAULT 0,
  height       REAL NOT NULL DEFAULT 0,
  text         TEXT NOT NULL DEFAULT '',
  thumbnail    BLOB,
  UNIQUE (revision_id, page)
);

CREATE TABLE sheet_link (
  id                 TEXT PRIMARY KEY,
  sheet_id           INTEGER NOT NULL REFERENCES sheet(id) ON DELETE CASCADE,
  region_json        TEXT NOT NULL,
  element_global_id  TEXT,
  view_id            TEXT REFERENCES saved_view(id) ON DELETE CASCADE,
  label              TEXT,
  created_by         TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (element_global_id IS NOT NULL OR view_id IS NOT NULL)
);
CREATE INDEX sheet_link_sheet_idx ON sheet_link(sheet_id);
CREATE INDEX sheet_link_element_idx ON sheet_link(element_global_id);

CREATE TABLE sheet_markup (
  id             TEXT PRIMARY KEY,
  sheet_id       INTEGER NOT NULL REFERENCES sheet(id) ON DELETE CASCADE,
  author         TEXT NOT NULL,
  kind           TEXT NOT NULL,
  geometry_json  TEXT NOT NULL,
  text           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX sheet_markup_sheet_idx ON sheet_markup(sheet_id);
