//! Geometry cache: the viewer's merged meshes for a revision, written once after the
//! first load and read instead of running web-ifc again. Keyed by the file's digest so a
//! changed file never gets stale geometry.

use std::{fs, path::PathBuf};

use tauri::{State, ipc::Response};

use super::{AppState, describe};

const CACHE_DIR: &str = "cache";

fn cache_file(project: &kp_project::Project, sha256: &str) -> Result<PathBuf, String> {
    if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("cache key must be a SHA-256 digest".to_owned());
    }
    Ok(project
        .data_dir()
        .join(CACHE_DIR)
        .join(format!("{sha256}.geom")))
}

/// The cached geometry for a digest, or an empty response when there is none.
#[tauri::command]
pub fn geometry_cache_read(state: State<'_, AppState>, sha256: String) -> Result<Response, String> {
    state.with_project(|project| {
        let path = cache_file(project, &sha256)?;
        match fs::read(&path) {
            Ok(bytes) => Ok(Response::new(bytes)),
            Err(_) => Ok(Response::new(Vec::new())),
        }
    })
}

#[tauri::command]
pub fn geometry_cache_write(
    state: State<'_, AppState>,
    sha256: String,
    data: Vec<u8>,
) -> Result<usize, String> {
    state.with_project(|project| {
        let path = cache_file(project, &sha256)?;
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(describe)?;
        }
        fs::write(&path, &data).map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(data.len())
    })
}

/// Removes every cached geometry file of the project; returns how many were deleted.
#[tauri::command]
pub fn geometry_cache_clear(state: State<'_, AppState>) -> Result<usize, String> {
    state.with_project(|project| {
        let dir = project.data_dir().join(CACHE_DIR);
        let Ok(entries) = fs::read_dir(&dir) else {
            return Ok(0);
        };
        let mut removed = 0;
        for entry in entries.filter_map(|e| e.ok()) {
            if entry.path().extension().is_some_and(|e| e == "geom")
                && fs::remove_file(entry.path()).is_ok()
            {
                removed += 1;
            }
        }
        Ok(removed)
    })
}
