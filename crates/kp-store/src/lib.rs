//! Project storage for KingPost Connect.
//!
//! One SQLite database lives in every project folder and is owned by a [`Store`].
//! Schema changes are applied as numbered migrations; SQLite's `user_version` pragma
//! records which migration a database has reached, so an older database is upgraded
//! in order the next time it is opened. A database written by a newer build is
//! refused rather than guessed at.

use std::{path::Path, sync::Arc};

use rusqlite::{Connection, OpenFlags, OptionalExtension, params};

mod analysis;
mod clash;
mod content;
mod diff;
mod drawings;
mod migrations;
mod notes;
mod quantity;
mod review;
mod sync;
mod views;

pub use analysis::{AnalysisModelRow, AnalysisModelSummary, LinkSetRow};
pub use clash::{CLASH_STATUSES, ClashFound, ClashRow, ClashTestRow, RunSummary};
pub use content::{ElementRow, ElementSummary, FileRow, PropertyOut, PropertyRow, RevisionRow};
pub use diff::{DiffItemRow, DiffResultRow, PropertyFact};
pub use drawings::{
    ElementSheetLink, NewSheet, NewSheetLink, SheetHit, SheetLinkRow, SheetMarkupRow, SheetRow,
};
pub use notes::{ElementLinkRow, NoteRow};
pub use quantity::{CatalogueEntry, DensityRow, GeometryQuantity, PresetRow};
pub use review::{
    CommentRow, IssuePatch, IssueRow, NewIssue, NewViewpoint, STAGES, StatusRow, ViewpointRow,
};
pub use sync::{ApplyReport, Change, PendingRow, SYNC_TABLES, SyncCounts, SyncTable};
pub use views::SavedViewRow;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("database schema version {found} is newer than this build supports ({supported})")]
    SchemaTooNew { found: i64, supported: i64 },
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// Identity row of the project a database belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectRow {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

pub struct Store {
    conn: Connection,
    sync: Arc<sync::SyncRuntime>,
}

impl Store {
    /// Opens (creating if needed) the database at `path` and brings it to the current schema.
    pub fn open(path: &Path) -> Result<Self> {
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        Self::init(Connection::open_with_flags(path, flags)?)
    }

    /// An in-memory database with the current schema; used by tests and previews.
    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;
        let mut conn = conn;
        migrate(&mut conn)?;
        let sync = sync::setup(&conn)?;
        Ok(Self { conn, sync })
    }

    pub fn schema_version(&self) -> Result<i64> {
        schema_version(&self.conn)
    }

    /// Latest schema version this build knows about.
    pub const fn latest_schema_version() -> i64 {
        migrations::LATEST
    }
}

fn schema_version(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}

fn migrate(conn: &mut Connection) -> Result<()> {
    {
        let current = schema_version(conn)?;
        if current > migrations::LATEST {
            return Err(StoreError::SchemaTooNew {
                found: current,
                supported: migrations::LATEST,
            });
        }
        for (version, sql) in migrations::ALL.iter().skip(current as usize) {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", version)?;
            tx.commit()?;
        }
        Ok(())
    }
}

impl Store {
    /// Records which project this database belongs to. A database holds exactly one.
    pub fn set_project(&self, row: &ProjectRow) -> Result<()> {
        self.conn.execute(
            "INSERT INTO project (id, name, created_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name",
            params![row.id, row.name, row.created_at],
        )?;
        Ok(())
    }

    pub fn project(&self) -> Result<Option<ProjectRow>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id, name, created_at FROM project LIMIT 1",
                [],
                |row| {
                    Ok(ProjectRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        created_at: row.get(2)?,
                    })
                },
            )
            .optional()?)
    }

    /// Direct access for feature crates that own their own SQL.
    pub fn connection(&self) -> &Connection {
        &self.conn
    }
}

impl std::fmt::Debug for Store {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Store")
            .field("path", &self.conn.path())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_row() -> ProjectRow {
        ProjectRow {
            id: "p-1".into(),
            name: "Bridge 7".into(),
            created_at: "2026-10-24T00:00:00Z".into(),
        }
    }

    #[test]
    fn new_database_is_at_latest_schema() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.schema_version().unwrap(), migrations::LATEST);
    }

    #[test]
    fn reopening_a_database_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.db");
        {
            let store = Store::open(&path).unwrap();
            store.set_project(&sample_row()).unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(store.schema_version().unwrap(), migrations::LATEST);
        assert_eq!(store.project().unwrap(), Some(sample_row()));
    }

    #[test]
    fn newer_schema_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.pragma_update(None, "user_version", migrations::LATEST + 1)
                .unwrap();
        }
        match Store::open(&path) {
            Err(StoreError::SchemaTooNew { found, supported }) => {
                assert_eq!(found, migrations::LATEST + 1);
                assert_eq!(supported, migrations::LATEST);
            }
            other => panic!("expected SchemaTooNew, got {other:?}"),
        }
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let store = Store::open_in_memory().unwrap();
        let result = store.connection().execute(
            "INSERT INTO revision (file_id, idx, source_sha256) VALUES (999, 1, 'abc')",
            [],
        );
        assert!(result.is_err(), "insert with dangling file_id must fail");
    }

    #[test]
    fn a_version_1_9_database_gains_the_sync_route_columns() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.db");
        {
            // A database as 1.9.0 left it: migrations up to 010 only.
            let mut conn = Connection::open(&path).unwrap();
            for (version, sql) in migrations::ALL.iter().take(10) {
                let tx = conn.transaction().unwrap();
                tx.execute_batch(sql).unwrap();
                tx.pragma_update(None, "user_version", version).unwrap();
                tx.commit().unwrap();
            }
            conn.execute(
                "INSERT INTO change_log (id, hlc, device, tbl, pk, op, origin)
                 VALUES ('c1', '1', 'd', 'note', '[\"n1\"]', 'upsert', 'remote')",
                [],
            )
            .unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(store.schema_version().unwrap(), migrations::LATEST);
        let via: Option<String> = store
            .connection()
            .query_row("SELECT via FROM change_log WHERE id = 'c1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(via, None, "changes from before keep an unknown route");
        store
            .connection()
            .query_row("SELECT COUNT(via) FROM sync_pending", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap();
    }

    #[test]
    fn every_table_from_the_plan_exists() {
        let store = Store::open_in_memory().unwrap();
        let mut statement = store
            .connection()
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
            )
            .unwrap();
        let tables: Vec<String> = statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        for expected in [
            "project",
            "file",
            "revision",
            "element",
            "property",
            "geometry_ref",
            "saved_view",
            "preset",
            "issue",
            "issue_comment",
            "issue_element",
            "element_status",
            "diff_result",
            "diff_item",
            "analysis_model",
            "analysis_link_set",
            "sheet",
            "sheet_link",
            "sheet_markup",
            "clash_test",
            "clash",
            "material_density",
        ] {
            assert!(
                tables.iter().any(|t| t == expected),
                "missing table {expected}"
            );
        }
    }
}
