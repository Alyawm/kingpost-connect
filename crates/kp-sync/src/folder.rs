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
    path::{Path, PathBuf},
};

use kp_store::{Change, Store};
use serde::{Deserialize, Serialize};

use crate::{
    Identity, Peer, Result, SyncError, SyncReport,
    files::{self, BlobSource, FileNotice, copy_atomic, hash_file, is_sha256, write_atomic},
    io_error, now_rfc3339, valid_project_id,
};

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

pub struct FolderRemote {
    root: PathBuf,
    /// Identifies this remote in the project's sync bookkeeping.
    key: String,
}

struct FolderBlobs<'a>(&'a Path);

impl BlobSource for FolderBlobs<'_> {
    fn available(&self, sha256: &str) -> Result<bool> {
        let blob = self.0.join(sha256);
        // The drive may not have finished bringing it down yet.
        Ok(is_sha256(sha256) && blob.is_file() && hash_file(&blob)? == sha256)
    }

    fn fetch(&self, sha256: &str, dest: &Path) -> Result<()> {
        copy_atomic(&self.0.join(sha256), dest)
    }
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
        if !valid_project_id(project_id) {
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

        crate::snapshot_once(store)?;
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

        let mut notices = Vec::new();
        for peer in self.peers(&device)? {
            let dir = self.root.join("devices").join(&peer.device);
            self.pull_changes(store, &dir, &mut report)?;
            notices.extend(read_notices(&dir));
            report.peers.push(peer);
        }
        files::receive(
            store,
            project_root,
            &self.key,
            notices,
            &FolderBlobs(&self.root.join("blobs")),
            &mut report,
        )?;
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
            // Own changes, and what arrived through another remote (a server, say).
            let batch = store.changes_to_send(after, &self.key, false, BATCH)?;
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

    fn push_files(
        &self,
        store: &Store,
        project_root: &Path,
        own: &Path,
        who: &Identity,
    ) -> Result<usize> {
        let outgoing = files::outgoing(store, project_root, &self.key, &who.user)?;
        for file in &outgoing {
            let sha = &file.notice.sha256;
            let blob = self.root.join("blobs").join(sha);
            if !blob.exists() {
                copy_atomic(&file.path, &blob)?;
            }
            write_atomic(
                &own.join("files").join(format!("{sha}.json")),
                &serde_json::to_vec_pretty(&file.notice).unwrap_or_default(),
            )?;
            store.mark_published(&self.key, sha)?;
        }
        Ok(outgoing.len())
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
            let applied = store.apply_changes_from(&changes, &self.key)?;
            report.applied += applied.applied;
            report.skipped += applied.skipped;
            store.mark_published(&read_key, &marker)?;
        }
        Ok(())
    }
}

fn read_notices(dir: &Path) -> Vec<FileNotice> {
    match fs::read_dir(dir.join("files")) {
        Ok(entries) => entries
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
            .filter_map(|e| fs::read(e.path()).ok())
            .filter_map(|b| serde_json::from_slice(&b).ok())
            .collect(),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    use super::*;
    use crate::{
        ReceivedFile, hex,
        testing::{Copy, copy},
    };

    fn sync(c: &Copy, shared: &Path) -> SyncReport {
        FolderRemote::open(shared, "p-1", "Bridge")
            .unwrap()
            .sync(&c.store, &c.root, &c.who)
            .unwrap()
    }

    #[test]
    fn changes_and_files_reach_the_other_copy() {
        let shared = tempfile::tempdir().unwrap();
        let (ann, sam) = (copy("Ann"), copy("Sam"));
        ann.write("models/frame.ifc", "ISO-10303-21; frame v1");
        ann.import("models/frame.ifc", "ifc");
        ann.sql("INSERT INTO issue (id, bcf_guid, title, created_by) VALUES ('i1', 'g1', 'Check B12', 'Ann');");

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
        assert_eq!(sam.read("models/frame.ifc"), "ISO-10303-21; frame v1");
        assert_eq!(sam.text("SELECT title FROM issue"), "Check B12");

        // Nothing new: nothing moves, and Sam does not send Ann's file back.
        sam.import("models/frame.ifc", "ifc");
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
        ann.write("frame.ifc", "v1");
        ann.import("frame.ifc", "ifc");
        sync(&ann, shared.path());
        sync(&sam, shared.path());
        sam.import("frame.ifc", "ifc");

        ann.write("frame.ifc", "v2");
        ann.import("frame.ifc", "ifc");
        sync(&ann, shared.path());
        let report = sync(&sam, shared.path());
        assert_eq!(report.received_files.len(), 1);
        assert!(report.conflicts.is_empty());
        assert_eq!(sam.read("frame.ifc"), "v2");
    }

    #[test]
    fn the_newest_version_wins_across_copies() {
        let shared = tempfile::tempdir().unwrap();
        let (ann, sam, kim) = (copy("Ann"), copy("Sam"), copy("Kim"));
        ann.write("frame.ifc", "ann's version");
        ann.import("frame.ifc", "ifc");
        sync(&ann, shared.path());
        std::thread::sleep(std::time::Duration::from_millis(20));
        sam.write("frame.ifc", "sam's later version");
        sam.import("frame.ifc", "ifc");
        sync(&sam, shared.path());
        let report = sync(&kim, shared.path());
        assert_eq!(report.received_files.len(), 1);
        assert_eq!(kim.read("frame.ifc"), "sam's later version");
    }

    #[test]
    fn an_interrupted_import_is_offered_again() {
        let shared = tempfile::tempdir().unwrap();
        let (ann, sam) = (copy("Ann"), copy("Sam"));
        ann.write("frame.ifc", "v1");
        ann.import("frame.ifc", "ifc");
        sync(&ann, shared.path());
        assert_eq!(sync(&sam, shared.path()).received_files.len(), 1);
        // Sam's import never happened: the next sync asks again.
        assert_eq!(sync(&sam, shared.path()).received_files.len(), 1);
        sam.import("frame.ifc", "ifc");
        assert!(sync(&sam, shared.path()).received_files.is_empty());
    }

    #[test]
    fn an_older_version_does_not_replace_a_newer_import() {
        let shared = tempfile::tempdir().unwrap();
        let (ann, sam) = (copy("Ann"), copy("Sam"));
        ann.write("frame.ifc", "ann v1");
        ann.import("frame.ifc", "ifc");
        // Pretend Ann imported it long ago.
        ann.sql("UPDATE revision SET imported_at = '2020-01-01T00:00:00.000Z';");
        sync(&ann, shared.path());
        sam.write("frame.ifc", "sam v2");
        sam.import("frame.ifc", "ifc");
        let report = sync(&sam, shared.path());
        assert!(report.received_files.is_empty() && report.conflicts.is_empty());
        assert_eq!(sam.read("frame.ifc"), "sam v2");
    }

    #[test]
    fn a_file_changed_on_both_sides_is_kept_twice() {
        let shared = tempfile::tempdir().unwrap();
        let (ann, sam) = (copy("Ann"), copy("Sam"));
        ann.write("frame.ifc", "ann's");
        ann.import("frame.ifc", "ifc");
        sync(&ann, shared.path());
        sam.write("frame.ifc", "sam's, not imported yet");
        let report = sync(&sam, shared.path());
        assert_eq!(report.conflicts.len(), 1);
        assert_eq!(sam.read("frame.ifc"), "sam's, not imported yet");
        assert_eq!(sam.read("frame (from Ann).ifc"), "ann's");
        assert_eq!(report.received_files[0].rel_path, "frame (from Ann).ifc");
    }

    #[test]
    fn edits_cross_in_both_directions() {
        let shared = tempfile::tempdir().unwrap();
        let (ann, sam) = (copy("Ann"), copy("Sam"));
        ann.sql("INSERT INTO note (id, point_json, text) VALUES ('n1', '[0,0,0]', 'Ann''s note');");
        sam.sql("INSERT INTO note (id, point_json, text) VALUES ('n2', '[1,0,0]', 'Sam''s note');");
        sync(&ann, shared.path());
        sync(&sam, shared.path());
        sync(&ann, shared.path());
        assert_eq!((ann.count("note"), sam.count("note")), (2, 2));
    }

    #[test]
    fn content_from_before_sync_is_sent_once() {
        let shared = tempfile::tempdir().unwrap();
        let ann = copy("Ann");
        ann.sql(
            "INSERT INTO note (id, point_json, text) VALUES ('n1', '[0,0,0]', 'old');
             DELETE FROM change_log;",
        );
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
