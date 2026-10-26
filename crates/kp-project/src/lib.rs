//! A project is a folder on disk. KingPost Connect keeps everything it knows in a
//! `.kingpost/` directory inside that folder: a small JSON manifest and the SQLite
//! database. Nothing is written anywhere else, so a project can be moved, zipped or
//! synced with ordinary tools and still open.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use kp_store::{ProjectRow, Store};
use serde::{Deserialize, Serialize};

pub const DATA_DIR: &str = ".kingpost";
pub const MANIFEST_FILE: &str = "project.json";
pub const DATABASE_FILE: &str = "project.db";
pub const MANIFEST_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    pub manifest_version: u32,
    pub id: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error("{0} is not a directory")]
    NotADirectory(PathBuf),
    #[error("{0} already contains a KingPost Connect project")]
    AlreadyExists(PathBuf),
    #[error("{0} does not contain a KingPost Connect project")]
    NotAProject(PathBuf),
    #[error("project name must not be empty")]
    EmptyName,
    #[error("manifest version {found} is newer than this build supports ({supported})")]
    ManifestTooNew { found: u32, supported: u32 },
    #[error("{path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("manifest is not valid: {0}")]
    Manifest(#[from] serde_json::Error),
    #[error(transparent)]
    Store(#[from] kp_store::StoreError),
}

pub type Result<T> = std::result::Result<T, ProjectError>;

pub struct Project {
    root: PathBuf,
    manifest: Manifest,
    store: Store,
}

impl Project {
    /// Creates a project in an existing, non-project directory.
    pub fn create(root: &Path, name: &str) -> Result<Self> {
        Self::create_with_id(root, name, &uuid::Uuid::new_v4().to_string())
    }

    /// Creates a local copy of a project known elsewhere (joined from a shared folder):
    /// same id, so the copies recognise each other when they sync.
    pub fn create_with_id(root: &Path, name: &str, id: &str) -> Result<Self> {
        let name = name.trim();
        if name.is_empty() {
            return Err(ProjectError::EmptyName);
        }
        if !root.is_dir() {
            return Err(ProjectError::NotADirectory(root.to_path_buf()));
        }
        if Self::is_project(root) {
            return Err(ProjectError::AlreadyExists(root.to_path_buf()));
        }

        let data_dir = root.join(DATA_DIR);
        fs::create_dir_all(&data_dir).map_err(io_error(&data_dir))?;

        let manifest = Manifest {
            manifest_version: MANIFEST_VERSION,
            id: id.to_owned(),
            name: name.to_owned(),
            created_at: now_rfc3339(),
        };
        write_manifest(&data_dir, &manifest)?;

        let store = Store::open(&data_dir.join(DATABASE_FILE))?;
        store.set_project(&ProjectRow {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            created_at: manifest.created_at.clone(),
        })?;

        Ok(Self {
            root: root.to_path_buf(),
            manifest,
            store,
        })
    }

    /// Opens an existing project; the database is migrated forward if needed.
    pub fn open(root: &Path) -> Result<Self> {
        if !root.is_dir() {
            return Err(ProjectError::NotADirectory(root.to_path_buf()));
        }
        let data_dir = root.join(DATA_DIR);
        let manifest_path = data_dir.join(MANIFEST_FILE);
        if !manifest_path.is_file() {
            return Err(ProjectError::NotAProject(root.to_path_buf()));
        }

        let text = fs::read_to_string(&manifest_path).map_err(io_error(&manifest_path))?;
        let manifest: Manifest = serde_json::from_str(&text)?;
        if manifest.manifest_version > MANIFEST_VERSION {
            return Err(ProjectError::ManifestTooNew {
                found: manifest.manifest_version,
                supported: MANIFEST_VERSION,
            });
        }

        let store = Store::open(&data_dir.join(DATABASE_FILE))?;
        // The manifest is the source of truth for identity; the database row follows it.
        store.set_project(&ProjectRow {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            created_at: manifest.created_at.clone(),
        })?;

        Ok(Self {
            root: root.to_path_buf(),
            manifest,
            store,
        })
    }

    /// True when `root` holds a project manifest. Says nothing about whether it opens.
    pub fn is_project(root: &Path) -> bool {
        root.join(DATA_DIR).join(MANIFEST_FILE).is_file()
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    pub fn data_dir(&self) -> PathBuf {
        self.root.join(DATA_DIR)
    }
}

impl std::fmt::Debug for Project {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Project")
            .field("root", &self.root)
            .field("manifest", &self.manifest)
            .finish_non_exhaustive()
    }
}

/// Writes the manifest through a temporary file so a crash never leaves a half-written one.
fn write_manifest(data_dir: &Path, manifest: &Manifest) -> Result<()> {
    let final_path = data_dir.join(MANIFEST_FILE);
    let temp_path = data_dir.join(format!("{MANIFEST_FILE}.tmp"));
    let json = serde_json::to_string_pretty(manifest)?;
    fs::write(&temp_path, json).map_err(io_error(&temp_path))?;
    fs::rename(&temp_path, &final_path).map_err(io_error(&final_path))?;
    Ok(())
}

fn io_error(path: &Path) -> impl FnOnce(io::Error) -> ProjectError + '_ {
    move |source| ProjectError::Io {
        path: path.to_path_buf(),
        source,
    }
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_then_open_round_trips_identity() {
        let dir = tempfile::tempdir().unwrap();
        let created = Project::create(dir.path(), "  Bridge 7  ").unwrap();
        assert_eq!(created.manifest().name, "Bridge 7");
        assert!(dir.path().join(DATA_DIR).join(MANIFEST_FILE).is_file());
        assert!(dir.path().join(DATA_DIR).join(DATABASE_FILE).is_file());
        assert!(Project::is_project(dir.path()));
        drop(created);

        let opened = Project::open(dir.path()).unwrap();
        let row = opened.store().project().unwrap().unwrap();
        assert_eq!(row.id, opened.manifest().id);
        assert_eq!(row.name, "Bridge 7");
    }

    #[test]
    fn creating_twice_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        Project::create(dir.path(), "A").unwrap();
        assert!(matches!(
            Project::create(dir.path(), "B"),
            Err(ProjectError::AlreadyExists(_))
        ));
    }

    #[test]
    fn opening_a_plain_folder_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            Project::open(dir.path()),
            Err(ProjectError::NotAProject(_))
        ));
        assert!(!Project::is_project(dir.path()));
    }

    #[test]
    fn empty_name_is_refused_before_touching_disk() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            Project::create(dir.path(), "   "),
            Err(ProjectError::EmptyName)
        ));
        assert!(!dir.path().join(DATA_DIR).exists());
    }

    #[test]
    fn newer_manifest_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().join(DATA_DIR);
        fs::create_dir_all(&data_dir).unwrap();
        fs::write(
            data_dir.join(MANIFEST_FILE),
            format!(
                r#"{{"manifest_version": {}, "id": "x", "name": "x", "created_at": "x"}}"#,
                MANIFEST_VERSION + 1
            ),
        )
        .unwrap();
        assert!(matches!(
            Project::open(dir.path()),
            Err(ProjectError::ManifestTooNew { found, .. }) if found == MANIFEST_VERSION + 1
        ));
    }
}
