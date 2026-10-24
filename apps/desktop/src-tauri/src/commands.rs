//! Commands callable from the interface. Each one mirrors a wrapper in
//! `apps/desktop/src/lib/ipc.ts`; keep the two lists identical.
//!
//! Errors cross the boundary as plain strings: the interface shows them in the Output
//! panel and has no use for structured variants yet.

use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};

use kp_project::Project;
use serde::Serialize;
use tauri::State;

#[derive(Default)]
pub struct AppState {
    project: Mutex<Option<Project>>,
}

impl AppState {
    fn project(&self) -> Result<MutexGuard<'_, Option<Project>>, String> {
        self.project
            .lock()
            .map_err(|_| "application state is unavailable".to_owned())
    }
}

#[derive(Serialize, Clone)]
pub struct AppInfo {
    name: &'static str,
    version: &'static str,
}

#[derive(Serialize, Clone)]
pub struct ProjectInfo {
    id: String,
    name: String,
    root: String,
    created_at: String,
}

impl From<&Project> for ProjectInfo {
    fn from(project: &Project) -> Self {
        let manifest = project.manifest();
        Self {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            root: project.root().display().to_string(),
            created_at: manifest.created_at.clone(),
        }
    }
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "KingPost Connect",
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[tauri::command]
pub fn project_is_project(root: String) -> bool {
    Project::is_project(&PathBuf::from(root))
}

#[tauri::command]
pub fn project_create(
    state: State<'_, AppState>,
    root: String,
    name: String,
) -> Result<ProjectInfo, String> {
    let project = Project::create(&PathBuf::from(root), &name).map_err(|e| e.to_string())?;
    let info = ProjectInfo::from(&project);
    *state.project()? = Some(project);
    Ok(info)
}

#[tauri::command]
pub fn project_open(state: State<'_, AppState>, root: String) -> Result<ProjectInfo, String> {
    let project = Project::open(&PathBuf::from(root)).map_err(|e| e.to_string())?;
    let info = ProjectInfo::from(&project);
    *state.project()? = Some(project);
    Ok(info)
}

#[tauri::command]
pub fn project_close(state: State<'_, AppState>) -> Result<(), String> {
    *state.project()? = None;
    Ok(())
}

#[tauri::command]
pub fn project_current(state: State<'_, AppState>) -> Result<Option<ProjectInfo>, String> {
    Ok(state.project()?.as_ref().map(ProjectInfo::from))
}
