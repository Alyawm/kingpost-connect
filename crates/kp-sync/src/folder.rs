//! Sync through a shared folder.
//!
//! Layout under the folder the user picks (one subfolder per project, so a single shared
//! folder can serve several projects):
//!
//! ```text
//! <shared>/<project id>/project.json                      name, for people browsing the folder
//! <shared>/<project id>/blobs/<sha256>                     file contents, written once
//! <shared>/<project id>/devices/<device>/device.json       who and where, last sync time
//! <shared>/<project id>/devices/<device>/changes/<first>-<last>.jsonl
//! <shared>/<project id>/devices/<device>/files/<sha256>.json
//! ```
//!
//! A copy writes only inside its own device folder (and adds blobs, which never change),
//! so cloud drives never see two writers on one file. Change files are written under a
//! temporary name and renamed when complete. Readers remember every change file they have
//! applied rather than a position, because cloud drives may deliver files out of order.

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use kp_store::{Change, Store};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    Peer, ReceivedFile, Result, SyncError, SyncReport, hex, io_error, now_rfc3339, safe_relative,
};

/// File kinds that travel with the project.
const SHARED_KINDS: &[&str] = &["ifc", "pdf", "saf", "e2k", "s2k"];
const BATCH: usize = 2_000;

#[derive(Debug, Serialize, Deserialize)]
struct ProjectInfo {
    id: String,
    name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct DeviceInfo {
    device: String,
    user: String,
    machine: String,
    last_sync: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FileNotice {
    rel_path: String,
    sha256: String,
    kind: String,
    size: u64,
    user: String,
    published_at: String,
    /// When that version was imported where it came from.
    #[serde(default)]
    imported_at: Option<String>,
}

/// Who is syncing, shown to the other copies.
#[derive(Debug, Clone)]
pub struct Identity {
    pub user: String,
    pub machine: String,
}

pub struct FolderRemote {
    root: PathBuf,
    /// Identifies this remote in the project's sync bookkeeping.
    key: String,
}

impl FolderRemote {
    /// The project's folder inside `shared`, created if needed.
    pub fn open(shared: &Path, project_id: &str, project_name: &str) -> Result<Self> {
        if !shared.is_dir() {
            return Err(SyncError::Invalid(format!(
                "{} is not a folder that can be reached",
                shared.display()
            )));
        }
        if project_id.is_empty()
            || !project_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err(SyncError::Invalid("the project id is not valid".into()));
        }
        let root = shared.join(project_id);
        fs::create_dir_all(root.join("blobs")).map_err(io_error(&root))?;
        let info = root.join("project.json");
        if !info.exists() {
            write_atomic(
                &info,
                &serde_json::to_vec_pretty(&ProjectInfo {
                    id: project_id.to_owned(),
                    name: project_name.to_owned(),
                })
                .unwrap_or_default(),
            )?;
        }
        Ok(Self {
            key: format!("folder:{}", shared.display()),
            root,
        })
    }

    pub fn key(&self) -> &str {
        &self.key
    }

    /// Sends this copy's new changes and files, then applies what the other copies sent.
    /// Received files are copied into `project_root`; the caller imports them.
    pub fn sync(&self, store: &Store, project_root: &Path, who: &Identity) -> Result<SyncReport> {
        let mut report = SyncReport::default();
        let device = store.device_id().to_owned();
        let own = self.root.join("devices").join(&device);
        fs::create_dir_all(own.join("changes")).map_err(io_error(&own))?;
        fs::create_dir_all(own.join("files")).map_err(io_error(&own))?;

        // Content made before sync was switched on goes out with the first sync.
        if store.sync_setting("snapshot_done")?.is_none() {
            store.snapshot_unlogged()?;
            store.set_sync_setting("snapshot_done", Some("1"))?;
        }
        report.sent = self.push_changes(store, &own)?;
        report.files_sent = self.push_files(store, project_root, &own, who)?;
        write_atomic(
            &own.join("device.json"),
            &serde_json::to_vec_pretty(&DeviceInfo {
                device: device.clone(),
                user: who.user.clone(),
                machine: who.machine.clone(),
                last_sync: now_rfc3339(),
            })
            .unwrap_or_default(),
        )?;

        for peer in self.peers(&device)? {
            let dir = self.root.join("devices").join(&peer.device);
            self.pull_changes(store, &dir, &mut report)?;
            self.pull_files(store, project_root, &dir, &peer, &mut report)?;
            report.peers.push(peer);
        }
        report.applied += store.retry_pending()?;
        report.pending = store.sync_counts()?.pending as usize;
        Ok(report)
    }

    fn push_changes(&self, store: &Store, own: &Path) -> Result<usize> {
        let mut sent = 0;
        loop {
            let after: i64 = store
                .sync_cursor(&self.key, "sent")?
                .and_then(|p| p.parse().ok())
                .unwrap_or(0);
            let batch = store.local_changes_after(after, BATCH)?;
            let (Some((first, _)), Some((last, _))) = (batch.first(), batch.last()) else {
                return Ok(sent);
            };
            let mut text = String::new();
            for (_, change) in &batch {
                text.push_str(&serde_json::to_string(change).unwrap_or_default());
                text.push('\n');
            }
            write_atomic(
                &own.join("changes")
                    .join(format!("{first:012}-{last:012}.jsonl")),
                text.as_bytes(),
            )?;
            store.set_sync_cursor(&self.key, "sent", &last.to_string())?;
            sent += batch.len();
        }
    }

    /// Publishes the latest revision of each shared file, when the file on disk is still
    /// that revision.
    fn push_files(
        &self,
        store: &Store,
        project_root: &Path,
        own: &Path,
        who: &Identity,
    ) -> Result<usize> {
        let latest: Vec<(String, String, String, String)> = {
            let mut statement = store.connection().prepare(
                "SELECT f.rel_path, f.kind, r.source_sha256, r.imported_at FROM revision r
                 JOIN file f ON f.id = r.file_id
                 WHERE r.idx = (SELECT MAX(idx) FROM revision WHERE file_id = r.file_id)",
            )?;
            let rows =
                statement.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
            rows.collect::<std::result::Result<_, _>>()
                .map_err(kp_store::StoreError::from)?
        };
        let mut sent = 0;
        for (rel_path, kind, sha, imported_at) in latest {
            if !SHARED_KINDS.contains(&kind.as_str()) || store.is_published(&self.key, &sha)? {
                continue;
            }
            let Some(relative) = safe_relative(&rel_path) else {
                continue;
            };
            let path = project_root.join(relative);
            if !path.is_file() || hash_file(&path)? != sha {
                // Changed since it was imported; it goes out after the next import.
                continue;
            }
            let blob = self.root.join("blobs").join(&sha);
            if !blob.exists() {
                copy_atomic(&path, &blob)?;
            }
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let notice = FileNotice {
                rel_path: rel_path.replace('\\', "/"),
                sha256: sha.clone(),
                kind,
                size,
                user: who.user.clone(),
                published_at: now_rfc3339(),
                imported_at: Some(imported_at),
            };
            write_atomic(
                &own.join("files").join(format!("{sha}.json")),
                &serde_json::to_vec_pretty(&notice).unwrap_or_default(),
            )?;
            store.mark_published(&self.key, &sha)?;
            sent += 1;
        }
        Ok(sent)
    }

    /// The other copies that have synced here.
    fn peers(&self, own_device: &str) -> Result<Vec<Peer>> {
        let devices = self.root.join("devices");
        let mut peers = Vec::new();
        let Ok(entries) = fs::read_dir(&devices) else {
            return Ok(peers);
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == own_device || !entry.path().is_dir() {
                continue;
            }
            let info: Option<DeviceInfo> = fs::read(entry.path().join("device.json"))
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok());
            peers.push(match info {
                Some(info) => Peer {
                    device: name,
                    user: info.user,
                    machine: info.machine,
                    last_sync: info.last_sync,
                },
                None => Peer {
                    device: name,
                    user: String::new(),
                    machine: String::new(),
                    last_sync: String::new(),
                },
            });
        }
        peers.sort_by(|a, b| a.device.cmp(&b.device));
        Ok(peers)
    }

    fn pull_changes(&self, store: &Store, dir: &Path, report: &mut SyncReport) -> Result<()> {
        let read_key = format!("{}#changes", self.key);
        let mut names: Vec<String> = match fs::read_dir(dir.join("changes")) {
            Ok(entries) => entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| n.ends_with(".jsonl"))
                .collect(),
            Err(_) => return Ok(()),
        };
        names.sort();
        let device = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        for name in names {
            let marker = format!("{device}/{name}");
            if store.is_published(&read_key, &marker)? {
                continue;
            }
            let Ok(text) = fs::read_to_string(dir.join("changes").join(&name)) else {
                continue;
            };
            let changes: Option<Vec<Change>> = text
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(|l| serde_json::from_str(l).ok())
                .collect();
            // Still arriving or damaged: try again next time.
            let Some(changes) = changes else {
                continue;
            };
            let applied = store.apply_changes(&changes)?;
            report.applied += applied.applied;
            report.skipped += applied.skipped;
            store.mark_published(&read_key, &marker)?;
        }
        Ok(())
    }

    fn pull_files(
        &self,
        store: &Store,
        project_root: &Path,
        dir: &Path,
        peer: &Peer,
        report: &mut SyncReport,
    ) -> Result<()> {
        let read_key = format!("{}#files", self.key);
        let mut notices: Vec<FileNotice> = match fs::read_dir(dir.join("files")) {
            Ok(entries) => entries
                .flatten()
                .filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
                .filter_map(|e| fs::read(e.path()).ok())
                .filter_map(|b| serde_json::from_slice(&b).ok())
                .collect(),
            Err(_) => return Ok(()),
        };
        notices.sort_by(|a, b| a.published_at.cmp(&b.published_at));
        // Only the newest unseen version of each path is worth copying.
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
            let known: bool = store.connection().query_row(
                "SELECT EXISTS (SELECT 1 FROM revision WHERE source_sha256 = ?1)",
                [&notice.sha256],
                |r| r.get(0),
            )?;
            // Marked read once its revision exists here (above), so an import that was
            // interrupted is offered again by the next sync.
            let done = |store: &Store| store.mark_published(&read_key, &notice.sha256);
            if known {
                done(store)?;
                // Do not publish it back.
                store.mark_published(&self.key, &notice.sha256)?;
                continue;
            }
            let Some(relative) = safe_relative(&notice.rel_path) else {
                done(store)?;
                continue;
            };
            let blob = self.root.join("blobs").join(&notice.sha256);
            if !blob.is_file() || hash_file(&blob)? != notice.sha256 {
                // The drive has not finished bringing it down yet.
                continue;
            }
            store.mark_published(&self.key, &notice.sha256)?;
            let target = project_root.join(&relative);
            let received = |rel_path: String| ReceivedFile {
                rel_path,
                kind: notice.kind.clone(),
                from_user: peer.user.clone(),
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
                        done(store)?;
                        continue;
                    }
                    copy_atomic(&blob, &target)?;
                    report
                        .received_files
                        .push(received(notice.rel_path.clone()));
                } else {
                    // Changed here too and not imported: keep both.
                    let beside = beside_name(&relative, &peer.user);
                    copy_atomic(&blob, &project_root.join(&beside))?;
                    let beside = beside.to_string_lossy().replace('\\', "/");
                    report.conflicts.push(format!(
                        "{} was changed here and by {}; their version is saved as {}",
                        notice.rel_path,
                        display_user(&peer.user),
                        beside
                    ));
                    report.received_files.push(received(beside));
                    done(store)?;
                }
            } else {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(io_error(parent))?;
                }
                copy_atomic(&blob, &target)?;
                report
                    .received_files
                    .push(received(notice.rel_path.clone()));
            }
        }
        Ok(())
    }
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

pub(crate) fn hash_file(path: &Path) -> Result<String> {
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

fn temp_name(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!(".{name}.part"))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let temp = temp_name(path);
    fs::write(&temp, bytes).map_err(io_error(&temp))?;
    fs::rename(&temp, path).map_err(io_error(path))
}

fn copy_atomic(from: &Path, to: &Path) -> Result<()> {
    let temp = temp_name(to);
    fs::copy(from, &temp).map_err(io_error(&temp))?;
    fs::rename(&temp, to).map_err(io_error(to))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Copy {
        _dir: tempfile::TempDir,
        root: PathBuf,
        store: Store,
        who: Identity,
    }

    fn copy(user: &str) -> Copy {
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

    fn sync(c: &Copy, shared: &Path) -> SyncReport {
        FolderRemote::open(shared, "p-1", "Bridge")
            .unwrap()
            .sync(&c.store, &c.root, &c.who)
            .unwrap()
    }

    /// What an import does to the database, without parsing the file.
    fn import(c: &Copy, rel_path: &str, kind: &str) {
        let sha = hash_file(&c.root.join(rel_path)).unwrap();
        let conn = c.store.connection();
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

    fn write(c: &Copy, rel_path: &str, text: &str) {
        let path = c.root.join(rel_path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn changes_and_files_reach_the_other_copy() {
        let shared = tempfile::tempdir().unwrap();
        let (ann, sam) = (copy("Ann"), copy("Sam"));
        write(&ann, "models/frame.ifc", "ISO-10303-21; frame v1");
        import(&ann, "models/frame.ifc", "ifc");
        ann.store
            .connection()
            .execute_batch(
                "INSERT INTO issue (id, bcf_guid, title, created_by) VALUES ('i1', 'g1', 'Check B12', 'Ann');",
            )
            .unwrap();

        let first = sync(&ann, shared.path());
        assert_eq!((first.sent, first.files_sent), (1, 1));
        assert!(first.peers.is_empty());

        let report = sync(&sam, shared.path());
        assert_eq!(report.applied, 1);
        assert_eq!(report.peers[0].user, "Ann");
        assert_eq!(
            report.received_files,
            vec![ReceivedFile {
                rel_path: "models/frame.ifc".into(),
                kind: "ifc".into(),
                from_user: "Ann".into()
            }]
        );
        assert_eq!(
            fs::read_to_string(sam.root.join("models/frame.ifc")).unwrap(),
            "ISO-10303-21; frame v1"
        );
        let title: String = sam
            .store
            .connection()
            .query_row("SELECT title FROM issue", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Check B12");

        // Nothing new: nothing moves, and Sam does not send Ann's file back.
        import(&sam, "models/frame.ifc", "ifc");
        let quiet = sync(&sam, shared.path());
        assert_eq!((quiet.sent, quiet.files_sent, quiet.applied), (0, 0, 0));
        assert!(quiet.received_files.is_empty());
        let back = sync(&ann, shared.path());
        assert_eq!((back.applied, back.received_files.len()), (0, 0));
    }

    #[test]
    fn a_new_version_replaces_an_imported_file() {
        let shared = tempfile::tempdir().unwrap();
        let (ann, sam) = (copy("Ann"), copy("Sam"));
        write(&ann, "frame.ifc", "v1");
        import(&ann, "frame.ifc", "ifc");
        sync(&ann, shared.path());
        sync(&sam, shared.path());
        import(&sam, "frame.ifc", "ifc");

        write(&ann, "frame.ifc", "v2");
        import(&ann, "frame.ifc", "ifc");
        sync(&ann, shared.path());
        let report = sync(&sam, shared.path());
        assert_eq!(report.received_files.len(), 1);
        assert!(report.conflicts.is_empty());
        assert_eq!(
            fs::read_to_string(sam.root.join("frame.ifc")).unwrap(),
            "v2"
        );
    }

    #[test]
    fn an_interrupted_import_is_offered_again() {
        let shared = tempfile::tempdir().unwrap();
        let (ann, sam) = (copy("Ann"), copy("Sam"));
        write(&ann, "frame.ifc", "v1");
        import(&ann, "frame.ifc", "ifc");
        sync(&ann, shared.path());
        assert_eq!(sync(&sam, shared.path()).received_files.len(), 1);
        // Sam's import never happened: the next sync asks again.
        assert_eq!(sync(&sam, shared.path()).received_files.len(), 1);
        import(&sam, "frame.ifc", "ifc");
        assert!(sync(&sam, shared.path()).received_files.is_empty());
    }

    #[test]
    fn an_older_version_does_not_replace_a_newer_import() {
        let shared = tempfile::tempdir().unwrap();
        let (ann, sam) = (copy("Ann"), copy("Sam"));
        write(&ann, "frame.ifc", "ann v1");
        import(&ann, "frame.ifc", "ifc");
        // Pretend Ann imported it long ago.
        ann.store
            .connection()
            .execute_batch("UPDATE revision SET imported_at = '2020-01-01T00:00:00.000Z';")
            .unwrap();
        sync(&ann, shared.path());
        write(&sam, "frame.ifc", "sam v2");
        import(&sam, "frame.ifc", "ifc");
        let report = sync(&sam, shared.path());
        assert!(report.received_files.is_empty() && report.conflicts.is_empty());
        assert_eq!(
            fs::read_to_string(sam.root.join("frame.ifc")).unwrap(),
            "sam v2"
        );
    }

    #[test]
    fn a_file_changed_on_both_sides_is_kept_twice() {
        let shared = tempfile::tempdir().unwrap();
        let (ann, sam) = (copy("Ann"), copy("Sam"));
        write(&ann, "frame.ifc", "ann's");
        import(&ann, "frame.ifc", "ifc");
        sync(&ann, shared.path());
        write(&sam, "frame.ifc", "sam's, not imported yet");
        let report = sync(&sam, shared.path());
        assert_eq!(report.conflicts.len(), 1);
        assert_eq!(
            fs::read_to_string(sam.root.join("frame.ifc")).unwrap(),
            "sam's, not imported yet"
        );
        assert_eq!(
            fs::read_to_string(sam.root.join("frame (from Ann).ifc")).unwrap(),
            "ann's"
        );
        assert_eq!(report.received_files[0].rel_path, "frame (from Ann).ifc");
    }

    #[test]
    fn edits_cross_in_both_directions() {
        let shared = tempfile::tempdir().unwrap();
        let (ann, sam) = (copy("Ann"), copy("Sam"));
        ann.store
            .connection()
            .execute_batch(
                "INSERT INTO note (id, point_json, text) VALUES ('n1', '[0,0,0]', 'Ann''s note');",
            )
            .unwrap();
        sam.store
            .connection()
            .execute_batch(
                "INSERT INTO note (id, point_json, text) VALUES ('n2', '[1,0,0]', 'Sam''s note');",
            )
            .unwrap();
        sync(&ann, shared.path());
        sync(&sam, shared.path());
        sync(&ann, shared.path());
        for c in [&ann, &sam] {
            let count: i64 = c
                .store
                .connection()
                .query_row("SELECT COUNT(*) FROM note", [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 2);
        }
    }

    #[test]
    fn content_from_before_sync_is_sent_once() {
        let shared = tempfile::tempdir().unwrap();
        let ann = copy("Ann");
        ann.store
            .connection()
            .execute_batch(
                "INSERT INTO note (id, point_json, text) VALUES ('n1', '[0,0,0]', 'old');
                 DELETE FROM change_log;",
            )
            .unwrap();
        assert_eq!(sync(&ann, shared.path()).sent, 1);
        assert_eq!(sync(&ann, shared.path()).sent, 0);
    }

    #[test]
    fn half_written_change_files_are_read_later() {
        let shared = tempfile::tempdir().unwrap();
        let (ann, sam) = (copy("Ann"), copy("Sam"));
        sync(&ann, shared.path());
        let changes = shared
            .path()
            .join("p-1/devices")
            .join(ann.store.device_id())
            .join("changes");
        fs::write(
            changes.join("000000000099-000000000099.jsonl"),
            "{\"id\": \"broken",
        )
        .unwrap();
        assert_eq!(sync(&sam, shared.path()).applied, 0);
        let good = Change {
            id: "c1".into(),
            hlc: "0000000000001.000000.dev".into(),
            device: "dev".into(),
            tbl: "note".into(),
            pk: serde_json::json!(["n1"]),
            op: "upsert".into(),
            row: Some(serde_json::json!({"id": "n1", "point_json": "[0,0,0]", "text": "late"})),
        };
        fs::write(
            changes.join("000000000099-000000000099.jsonl"),
            serde_json::to_string(&good).unwrap() + "\n",
        )
        .unwrap();
        assert_eq!(sync(&sam, shared.path()).applied, 1);
    }

    #[test]
    fn file_notices_cannot_write_outside_the_project() {
        let shared = tempfile::tempdir().unwrap();
        let (ann, sam) = (copy("Ann"), copy("Sam"));
        sync(&ann, shared.path());
        let files = shared
            .path()
            .join("p-1/devices")
            .join(ann.store.device_id())
            .join("files");
        let blob = shared.path().join("p-1/blobs");
        let sha = hex(&Sha256::digest(b"evil"));
        fs::write(blob.join(&sha), "evil").unwrap();
        let notice = FileNotice {
            rel_path: "../outside.ifc".into(),
            sha256: sha,
            kind: "ifc".into(),
            size: 4,
            user: "Ann".into(),
            published_at: now_rfc3339(),
            imported_at: None,
        };
        fs::write(files.join("x.json"), serde_json::to_vec(&notice).unwrap()).unwrap();
        let report = sync(&sam, shared.path());
        assert!(report.received_files.is_empty());
        assert!(!sam.root.parent().unwrap().join("outside.ifc").exists());
    }

    #[test]
    fn a_missing_folder_is_refused() {
        let missing = Path::new("Z:/definitely/not/here");
        assert!(FolderRemote::open(missing, "p-1", "x").is_err());
        let shared = tempfile::tempdir().unwrap();
        assert!(FolderRemote::open(shared.path(), "../p", "x").is_err());
    }
}
