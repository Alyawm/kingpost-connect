//! Sync between copies of a project through a shared folder.
//!
//! A sync opens its own connection to the project database so that copying large model
//! files does not hold the application state; SQLite's write-ahead log lets the rest of
//! the application keep reading and writing meanwhile.

use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

use kp_store::{PendingRow, Store, SyncCounts};
use kp_sync::{SyncReport, folder::FolderRemote, folder::Identity};
use serde::Serialize;
use tauri::State;

use super::{AppState, describe};

static SYNCING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize)]
pub struct SyncStatus {
    pub folder: Option<String>,
    pub auto: bool,
    pub last_sync: Option<String>,
    pub syncing: bool,
    pub counts: SyncCounts,
    pub pending: Vec<PendingRow>,
}

fn status(store: &Store) -> Result<SyncStatus, String> {
    Ok(SyncStatus {
        folder: store.sync_setting("folder").map_err(describe)?,
        auto: store.sync_setting("auto").map_err(describe)?.as_deref() != Some("0"),
        last_sync: store.sync_setting("last_sync").map_err(describe)?,
        syncing: SYNCING.load(Ordering::SeqCst),
        counts: store.sync_counts().map_err(describe)?,
        pending: store.pending_changes().map_err(describe)?,
    })
}

#[tauri::command]
pub fn sync_status(state: State<'_, AppState>) -> Result<SyncStatus, String> {
    state.with_project(|project| status(project.store()))
}

/// Sets (or clears, with `None`) the shared folder this project syncs through.
#[tauri::command]
pub fn sync_set_folder(
    state: State<'_, AppState>,
    folder: Option<String>,
) -> Result<SyncStatus, String> {
    state.with_project(|project| {
        if let Some(folder) = &folder {
            let path = PathBuf::from(folder);
            if !path.is_dir() {
                return Err(format!("{folder} is not a folder that can be reached"));
            }
            if path.starts_with(project.root()) {
                return Err("choose a folder outside the project folder".to_owned());
            }
        }
        project
            .store()
            .set_sync_setting("folder", folder.as_deref())
            .map_err(describe)?;
        status(project.store())
    })
}

#[tauri::command]
pub fn sync_set_auto(state: State<'_, AppState>, on: bool) -> Result<SyncStatus, String> {
    state.with_project(|project| {
        project
            .store()
            .set_sync_setting("auto", Some(if on { "1" } else { "0" }))
            .map_err(describe)?;
        status(project.store())
    })
}

struct Clear;

impl Drop for Clear {
    fn drop(&mut self) {
        SYNCING.store(false, Ordering::SeqCst);
    }
}

/// Sends this copy's changes and files to the shared folder and applies the others'.
/// Received files are copied into the project; the interface imports them.
#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>, user: String) -> Result<SyncReport, String> {
    let (root, database, id, name, folder) = state.with_project(|project| {
        let folder = project
            .store()
            .sync_setting("folder")
            .map_err(describe)?
            .ok_or_else(|| "choose a shared folder first".to_owned())?;
        Ok((
            project.root().to_path_buf(),
            project.data_dir().join(kp_project::DATABASE_FILE),
            project.manifest().id.clone(),
            project.manifest().name.clone(),
            PathBuf::from(folder),
        ))
    })?;
    if SYNCING.swap(true, Ordering::SeqCst) {
        return Err("a sync is already running".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _clear = Clear;
        let store = Store::open(&database).map_err(describe)?;
        let who = Identity {
            user: if user.trim().is_empty() {
                std::env::var("USERNAME").unwrap_or_default()
            } else {
                user.trim().to_owned()
            },
            machine: std::env::var("COMPUTERNAME")
                .or_else(|_| std::env::var("HOSTNAME"))
                .unwrap_or_default(),
        };
        let report = FolderRemote::open(&folder, &id, &name)
            .and_then(|remote| remote.sync(&store, &root, &who))
            .map_err(describe)?;
        let now = time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default();
        store
            .set_sync_setting("last_sync", Some(&now))
            .map_err(describe)?;
        Ok(report)
    })
    .await
    .map_err(describe)?
}

/// Tries kept changes again, after received files were imported.
#[tauri::command]
pub fn sync_retry(state: State<'_, AppState>) -> Result<usize, String> {
    state.with_project(|project| project.store().retry_pending().map_err(describe))
}

#[derive(Debug, Serialize, serde::Deserialize)]
pub struct SharedProject {
    pub id: String,
    pub name: String,
    /// The project's folder inside the shared folder.
    pub path: String,
}

fn read_shared(dir: &std::path::Path) -> Option<SharedProject> {
    #[derive(serde::Deserialize)]
    struct Info {
        id: String,
        name: String,
    }
    let info: Info = serde_json::from_slice(&std::fs::read(dir.join("project.json")).ok()?).ok()?;
    let valid = !info.id.is_empty()
        && info
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
        && dir.file_name().map(|n| n.to_string_lossy() == info.id) == Some(true);
    valid.then(|| SharedProject {
        id: info.id,
        name: info.name,
        path: dir.display().to_string(),
    })
}

/// Projects that sync through `folder`: the folder itself when it is one project's
/// folder, otherwise the project folders directly inside it.
#[tauri::command]
pub fn sync_shared_projects(folder: String) -> Result<Vec<SharedProject>, String> {
    let dir = PathBuf::from(&folder);
    if let Some(project) = read_shared(&dir) {
        return Ok(vec![project]);
    }
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("{folder}: {e}"))?;
    let mut found: Vec<SharedProject> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| read_shared(&e.path()))
        .collect();
    found.sort_by_key(|p| p.name.to_lowercase());
    Ok(found)
}

/// Creates a local copy of a shared project in `target` (an empty folder, or one without
/// a project) and points it at the shared folder. The interface then opens it; the first
/// sync brings the content and the files.
#[tauri::command]
pub fn sync_join(shared_project: String, target: String) -> Result<String, String> {
    let dir = PathBuf::from(&shared_project);
    let project = read_shared(&dir)
        .ok_or_else(|| format!("{shared_project} is not a shared KingPost Connect project"))?;
    let target_dir = PathBuf::from(&target);
    let shared_root = dir
        .parent()
        .ok_or_else(|| "the shared folder is not valid".to_owned())?
        .to_path_buf();
    if target_dir.starts_with(&shared_root) {
        return Err("choose a folder outside the shared folder for your copy".to_owned());
    }
    let created = kp_project::Project::create_with_id(&target_dir, &project.name, &project.id)
        .map_err(describe)?;
    created
        .store()
        .set_sync_setting("folder", Some(&shared_root.display().to_string()))
        .map_err(describe)?;
    Ok(target_dir.display().to_string())
}
