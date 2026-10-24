//! Application identity and project lifecycle.

use std::path::PathBuf;

use kp_project::Project;
use serde::Serialize;
use tauri::State;

use super::{AppState, describe};

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
    let project = Project::create(&PathBuf::from(root), &name).map_err(describe)?;
    let info = ProjectInfo::from(&project);
    *state.lock()? = Some(project);
    Ok(info)
}

#[tauri::command]
pub fn project_open(state: State<'_, AppState>, root: String) -> Result<ProjectInfo, String> {
    let project = Project::open(&PathBuf::from(root)).map_err(describe)?;
    let info = ProjectInfo::from(&project);
    *state.lock()? = Some(project);
    Ok(info)
}

#[tauri::command]
pub fn project_close(state: State<'_, AppState>) -> Result<(), String> {
    *state.lock()? = None;
    Ok(())
}

#[tauri::command]
pub fn project_current(state: State<'_, AppState>) -> Result<Option<ProjectInfo>, String> {
    Ok(state.lock()?.as_ref().map(ProjectInfo::from))
}
