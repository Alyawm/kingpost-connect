//! Helpers for tests of the transports: project copies on disk and imports that only do
//! what an import does to the database.

use std::{
    fs,
    path::{Path, PathBuf},
};

use kp_store::Store;

use crate::{Identity, files::hash_file};

pub struct Copy {
    _dir: tempfile::TempDir,
    pub root: PathBuf,
    pub store: Store,
    pub who: Identity,
}

/// An empty project copy belonging to `user`.
pub fn copy(user: &str) -> Copy {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    fs::create_dir_all(root.join(".kingpost")).unwrap();
    let store = Store::open(&root.join(".kingpost").join("project.db")).unwrap();
    Copy {
        _dir: dir,
        root,
        store,
        who: Identity {
            user: user.into(),
            machine: format!("{user}-pc"),
        },
    }
}

impl Copy {
    /// What importing `rel_path` does to the database, without parsing the file.
    pub fn import(&self, rel_path: &str, kind: &str) {
        let sha = hash_file(&self.root.join(rel_path)).unwrap();
        let conn = self.store.connection();
        conn.execute(
            "INSERT INTO file (rel_path, kind, sha256) VALUES (?1, ?2, ?3)
             ON CONFLICT(rel_path) DO UPDATE SET sha256 = excluded.sha256",
            [rel_path, kind, &sha],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO revision (file_id, idx, source_sha256)
             SELECT id, (SELECT COUNT(*) FROM revision WHERE file_id = file.id) + 1, ?2
             FROM file WHERE rel_path = ?1",
            [rel_path, &sha],
        )
        .unwrap();
    }

    pub fn write(&self, rel_path: &str, text: &str) {
        let path = self.root.join(rel_path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    pub fn read(&self, rel_path: &str) -> String {
        fs::read_to_string(self.root.join(rel_path)).unwrap()
    }

    pub fn sql(&self, sql: &str) {
        self.store.connection().execute_batch(sql).unwrap();
    }

    pub fn count(&self, table: &str) -> i64 {
        self.store
            .connection()
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    pub fn text(&self, sql: &str) -> String {
        self.store
            .connection()
            .query_row(sql, [], |r| r.get(0))
            .unwrap()
    }

    pub fn path(&self, rel_path: &str) -> PathBuf {
        self.root.join(rel_path)
    }

    pub fn exists(&self, rel_path: &str) -> bool {
        Path::new(&self.root.join(rel_path)).exists()
    }
}
