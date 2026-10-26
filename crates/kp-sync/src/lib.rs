//! Sync transports for KingPost Connect.
//!
//! Every copy of a project records its own changes to shared content in the project
//! database (see `kp_store::Change`). A transport moves those records, and the model and
//! drawing files they refer to, between copies:
//!
//! - [`folder`]: any folder all copies can reach — a OneDrive, Dropbox or Google Drive
//!   folder, or a network share. Each copy writes only its own files there, so the cloud
//!   drive never has two writers on one file.

pub mod folder;

use std::{io, path::PathBuf};

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("{path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error(transparent)]
    Store(#[from] kp_store::StoreError),
    #[error("{0}")]
    Invalid(String),
}

impl From<rusqlite::Error> for SyncError {
    fn from(error: rusqlite::Error) -> Self {
        SyncError::Store(error.into())
    }
}

pub type Result<T> = std::result::Result<T, SyncError>;

pub(crate) fn io_error(path: impl Into<PathBuf>) -> impl FnOnce(io::Error) -> SyncError {
    let path = path.into();
    move |source| SyncError::Io { path, source }
}

/// A model or drawing file received from another copy, now in the project folder and
/// waiting to be imported.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReceivedFile {
    pub rel_path: String,
    pub kind: String,
    pub from_user: String,
}

/// Another copy of the project that has synced through the same remote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Peer {
    pub device: String,
    pub user: String,
    pub machine: String,
    pub last_sync: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct SyncReport {
    /// Changes made here and sent.
    pub sent: usize,
    /// Files published for the other copies.
    pub files_sent: usize,
    pub applied: usize,
    pub skipped: usize,
    /// Received changes that wait for something (see `Store::pending_changes`).
    pub pending: usize,
    pub received_files: Vec<ReceivedFile>,
    /// Messages about files changed both here and elsewhere.
    pub conflicts: Vec<String>,
    pub peers: Vec<Peer>,
}

pub(crate) fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A project-relative path from another machine, checked to stay inside the project.
pub(crate) fn safe_relative(rel_path: &str) -> Option<PathBuf> {
    let path = PathBuf::from(rel_path.replace('\\', "/"));
    let ok = !rel_path.is_empty()
        && !rel_path.contains(':')
        && path
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
        && !path.components().any(|c| {
            c.as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case(".kingpost")
        });
    ok.then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths_stay_inside_the_project() {
        assert!(safe_relative("models/frame.ifc").is_some());
        assert!(safe_relative("models\\frame.ifc").is_some());
        assert!(safe_relative("../outside.ifc").is_none());
        assert!(safe_relative("/etc/passwd").is_none());
        assert!(safe_relative("C:/Windows/x.ifc").is_none());
        assert!(safe_relative(".kingpost/project.db").is_none());
        assert!(safe_relative("").is_none());
    }
}
