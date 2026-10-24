-- 003: review workflow. Issues follow BCF topics so they export and import without
-- loss; viewpoints (camera, components, markup lines, clipping, snapshot) hang off
-- an issue; comments may reference one. Element design status already exists (001).

ALTER TABLE issue ADD COLUMN description TEXT;
ALTER TABLE issue ADD COLUMN topic_type TEXT NOT NULL DEFAULT 'Issue';
ALTER TABLE issue ADD COLUMN labels_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE issue ADD COLUMN stage TEXT;
ALTER TABLE issue ADD COLUMN modified_at TEXT;
ALTER TABLE issue ADD COLUMN modified_by TEXT;
ALTER TABLE issue ADD COLUMN idx INTEGER;

ALTER TABLE issue_comment ADD COLUMN modified_at TEXT;

CREATE TABLE issue_viewpoint (
  id               TEXT PRIMARY KEY,
  issue_id         TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  guid             TEXT NOT NULL,
  camera_json      TEXT NOT NULL,
  components_json  TEXT NOT NULL DEFAULT '{}',
  lines_json       TEXT NOT NULL DEFAULT '[]',
  clipping_json    TEXT NOT NULL DEFAULT '[]',
  snapshot         BLOB,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX issue_viewpoint_issue_idx ON issue_viewpoint(issue_id);
