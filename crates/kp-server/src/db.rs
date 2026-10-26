//! The server's own database: accounts, sessions, projects and their members, and what
//! the copies of each project have sent (changes, file notices, which files it holds).

use std::path::Path;

use rusqlite::Connection;

/// Ordered schema versions. Append only.
const MIGRATIONS: &[&str] = &[r#"
CREATE TABLE user (
  id             INTEGER PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Tokens are stored hashed; a stolen database does not sign anyone in.
CREATE TABLE session (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at  TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX session_user ON session (user_id);

CREATE TABLE project (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_by  INTEGER REFERENCES user(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) WITHOUT ROWID;

CREATE TABLE member (
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  added_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, user_id)
) WITHOUT ROWID;
CREATE INDEX member_user ON member (user_id);

-- People invited by email before they have an account.
CREATE TABLE invite (
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  email       TEXT NOT NULL COLLATE NOCASE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_by  INTEGER REFERENCES user(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, email)
) WITHOUT ROWID;

-- Every change a copy sent, in arrival order; seq is the cursor copies read from.
CREATE TABLE project_change (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
  device       TEXT NOT NULL,
  user_id      INTEGER REFERENCES user(id) ON DELETE SET NULL,
  body         TEXT NOT NULL,
  received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, id)
);
CREATE INDEX project_change_seq ON project_change (project_id, seq);

-- File contents by hash, stored once however many projects hold them.
CREATE TABLE blob (
  sha256      TEXT PRIMARY KEY,
  size        INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) WITHOUT ROWID;

-- Which project may read which content: only what was uploaded to it.
CREATE TABLE project_blob (
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  sha256      TEXT NOT NULL REFERENCES blob(sha256),
  PRIMARY KEY (project_id, sha256)
) WITHOUT ROWID;

CREATE TABLE file_notice (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  sha256        TEXT NOT NULL,
  rel_path      TEXT NOT NULL,
  kind          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  user_name     TEXT NOT NULL,
  user_id       INTEGER REFERENCES user(id) ON DELETE SET NULL,
  imported_at   TEXT,
  published_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, sha256, rel_path)
);
CREATE INDEX file_notice_project ON file_notice (project_id, seq);

-- The copies that sync a project: who, on which computer, when last.
CREATE TABLE device (
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  device      TEXT NOT NULL,
  user_id     INTEGER REFERENCES user(id) ON DELETE SET NULL,
  machine     TEXT NOT NULL DEFAULT '',
  last_seen   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, device)
) WITHOUT ROWID;
"#];

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if current as usize > MIGRATIONS.len() {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "the server database is from a newer version (schema {current})"
        )));
    }
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (index + 1) as i64)?;
        tx.commit()?;
    }
    Ok(conn)
}
