//! The project's model, drawing and analysis files, as they travel between copies.
//!
//! A copy publishes the latest revision of each shared file — when the file on disk is
//! still that revision — as content named by its SHA-256 and a notice saying where it
//! goes and when it was imported. Receiving is the same for every transport; only where
//! the content comes from differs ([`BlobSource`]).

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use kp_store::Store;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{ReceivedFile, Result, SyncReport, hex, io_error, now_rfc3339, safe_relative};

/// File kinds that travel with the project.
pub const SHARED_KINDS: &[&str] = &["ifc", "pdf", "saf", "e2k", "s2k"];

/// "This version of this file is available": published by one copy, read by the others.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileNotice {
    pub rel_path: String,
    pub sha256: String,
    pub kind: String,
    pub size: u64,
    /// Who published it, for messages.
    pub user: String,
    pub published_at: String,
    /// When that version was imported where it came from.
    #[serde(default)]
    pub imported_at: Option<String>,
}

/// A file to publish and where its content is.
pub(crate) struct Outgoing {
    pub notice: FileNotice,
    pub path: PathBuf,
}

/// The latest revision of each shared file not yet published to `remote`, when the file
/// on disk is still that revision (otherwise it goes out after its next import).
pub(crate) fn outgoing(
    store: &Store,
    project_root: &Path,
    remote: &str,
    user: &str,
) -> Result<Vec<Outgoing>> {
    let latest: Vec<(String, String, String, String)> = {
        let mut statement = store.connection().prepare(
            "SELECT f.rel_path, f.kind, r.source_sha256, r.imported_at FROM revision r
             JOIN file f ON f.id = r.file_id
             WHERE r.idx = (SELECT MAX(idx) FROM revision WHERE file_id = r.file_id)",
        )?;
        let rows = statement.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        rows.collect::<std::result::Result<_, _>>()?
    };
    let mut out = Vec::new();
    for (rel_path, kind, sha, imported_at) in latest {
        if !SHARED_KINDS.contains(&kind.as_str()) || store.is_published(remote, &sha)? {
            continue;
        }
        let Some(relative) = safe_relative(&rel_path) else {
            continue;
        };
        let path = project_root.join(relative);
        if !path.is_file() || hash_file(&path)? != sha {
            continue;
        }
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        out.push(Outgoing {
            notice: FileNotice {
                rel_path: rel_path.replace('\\', "/"),
                sha256: sha,
                kind,
                size,
                user: user.to_owned(),
                published_at: now_rfc3339(),
                imported_at: Some(imported_at),
            },
            path,
        });
    }
    Ok(out)
}

/// Where received content comes from.
pub(crate) trait BlobSource {
    /// Whether the content can be fetched now (a cloud drive may still be bringing it).
    fn available(&self, sha256: &str) -> Result<bool>;
    /// Writes the content to `dest`, complete and checked, or fails.
    fn fetch(&self, sha256: &str, dest: &Path) -> Result<()>;
}

/// Places received files in the project. Only the newest unseen version of each path is
/// copied; a notice counts as handled once a revision with its hash exists here, so an
/// import that was interrupted is offered again by the next sync.
pub(crate) fn receive(
    store: &Store,
    project_root: &Path,
    remote: &str,
    mut notices: Vec<FileNotice>,
    source: &dyn BlobSource,
    report: &mut SyncReport,
) -> Result<()> {
    let read_key = format!("{remote}#files");
    notices.sort_by(|a, b| a.published_at.cmp(&b.published_at));
    let mut newest: Vec<FileNotice> = Vec::new();
    for notice in notices {
        if store.is_published(&read_key, &notice.sha256)? {
            continue;
        }
        if let Some(i) = newest.iter().position(|n| n.rel_path == notice.rel_path) {
            store.mark_published(&read_key, &newest[i].sha256)?;
            newest[i] = notice;
        } else {
            newest.push(notice);
        }
    }

    for notice in newest {
        let handled = |store: &Store| store.mark_published(&read_key, &notice.sha256);
        if revision_exists(store, &notice.sha256)? {
            handled(store)?;
            // Do not publish it back.
            store.mark_published(remote, &notice.sha256)?;
            continue;
        }
        let Some(relative) = safe_relative(&notice.rel_path) else {
            handled(store)?;
            continue;
        };
        if !source.available(&notice.sha256)? {
            continue;
        }
        store.mark_published(remote, &notice.sha256)?;
        let target = project_root.join(&relative);
        let received = |rel_path: String| ReceivedFile {
            rel_path,
            kind: notice.kind.clone(),
            from_user: notice.user.clone(),
        };
        if target.is_file() {
            let current = hash_file(&target)?;
            let imported_here: Option<String> = store.connection().query_row(
                "SELECT MAX(imported_at) FROM revision WHERE source_sha256 = ?1",
                [&current],
                |r| r.get(0),
            )?;
            if current == notice.sha256 {
                // Copied by an earlier sync and not imported yet.
                report
                    .received_files
                    .push(received(notice.rel_path.clone()));
            } else if let Some(imported_here) = imported_here {
                let theirs = notice
                    .imported_at
                    .as_deref()
                    .unwrap_or(&notice.published_at);
                if imported_here.as_str() > theirs {
                    // A newer version was imported here since; theirs is older.
                    handled(store)?;
                    continue;
                }
                source.fetch(&notice.sha256, &target)?;
                report
                    .received_files
                    .push(received(notice.rel_path.clone()));
            } else {
                // Changed here too and not imported: keep both.
                let beside = beside_name(&relative, &notice.user);
                source.fetch(&notice.sha256, &project_root.join(&beside))?;
                let beside = beside.to_string_lossy().replace('\\', "/");
                report.conflicts.push(format!(
                    "{} was changed here and by {}; their version is saved as {}",
                    notice.rel_path,
                    display_user(&notice.user),
                    beside
                ));
                report.received_files.push(received(beside));
                handled(store)?;
            }
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(io_error(parent))?;
            }
            source.fetch(&notice.sha256, &target)?;
            report
                .received_files
                .push(received(notice.rel_path.clone()));
        }
    }
    Ok(())
}

fn revision_exists(store: &Store, sha256: &str) -> Result<bool> {
    Ok(store.connection().query_row(
        "SELECT EXISTS (SELECT 1 FROM revision WHERE source_sha256 = ?1)",
        [sha256],
        |r| r.get(0),
    )?)
}

fn display_user(user: &str) -> &str {
    if user.is_empty() {
        "another computer"
    } else {
        user
    }
}

/// `models/frame.ifc` → `models/frame (from Sam).ifc`.
fn beside_name(relative: &Path, user: &str) -> PathBuf {
    let stem = relative
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let clean: String = display_user(user)
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_')
        .collect();
    let name = match relative.extension() {
        Some(ext) => format!("{stem} (from {clean}).{}", ext.to_string_lossy()),
        None => format!("{stem} (from {clean})"),
    };
    relative.with_file_name(name)
}

/// Whether `text` is a SHA-256 in lowercase hex, safe to use as a file name.
pub fn is_sha256(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn hash_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path).map_err(io_error(path))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer).map_err(io_error(path))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

/// `dir/name` → `dir/.name.part`, the name a file has while it is being written.
pub(crate) fn temp_name(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!(".{name}.part"))
}

pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let temp = temp_name(path);
    fs::write(&temp, bytes).map_err(io_error(&temp))?;
    fs::rename(&temp, path).map_err(io_error(path))
}

pub(crate) fn copy_atomic(from: &Path, to: &Path) -> Result<()> {
    let temp = temp_name(to);
    fs::copy(from, &temp).map_err(io_error(&temp))?;
    fs::rename(&temp, to).map_err(io_error(to))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_are_checked_before_use_as_names() {
        assert!(is_sha256(&"a".repeat(64)));
        assert!(!is_sha256(&"A".repeat(64)));
        assert!(!is_sha256("../../etc/passwd"));
        assert!(!is_sha256(&"a".repeat(63)));
    }

    #[test]
    fn a_kept_copy_is_named_after_its_author() {
        assert_eq!(
            beside_name(Path::new("models/frame.ifc"), "Sam O'Neil"),
            PathBuf::from("models/frame (from Sam ONeil).ifc")
        );
        assert_eq!(
            beside_name(Path::new("frame.ifc"), ""),
            PathBuf::from("frame (from another computer).ifc")
        );
    }
}
