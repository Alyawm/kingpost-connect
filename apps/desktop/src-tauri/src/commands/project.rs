//! Application identity and project lifecycle.

use std::path::PathBuf;

use kp_project::Project;
use serde::Serialize;
use tauri::{AppHandle, Manager, State, path::BaseDirectory};

use super::{AppState, describe, watcher::FolderWatcher};

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

fn adopt(app: &AppHandle, state: &AppState, project: Project) -> Result<ProjectInfo, String> {
    let info = ProjectInfo::from(&project);
    // A watcher that fails to start is not fatal; the Explorer still has its refresh button.
    let watcher = match FolderWatcher::start(app.clone(), project.root()) {
        Ok(watcher) => Some(watcher),
        Err(error) => {
            eprintln!("{error}");
            None
        }
    };
    *state.lock()? = Some(project);
    state.set_watcher(watcher);
    Ok(info)
}

#[tauri::command]
pub fn project_create(
    app: AppHandle,
    state: State<'_, AppState>,
    root: String,
    name: String,
) -> Result<ProjectInfo, String> {
    let project = Project::create(&PathBuf::from(root), &name).map_err(describe)?;
    adopt(&app, &state, project)
}

#[tauri::command]
pub fn project_open(
    app: AppHandle,
    state: State<'_, AppState>,
    root: String,
) -> Result<ProjectInfo, String> {
    let project = Project::open(&PathBuf::from(root)).map_err(describe)?;
    adopt(&app, &state, project)
}

/// File name of the sample model bundled with the application.
const SAMPLE_MODEL: &str = "duplex.ifc";

/// Opens the sample project, creating it first when needed: a "KingPost Sample" folder in
/// the user's Documents holding a copy of the bundled sample model. An existing copy is
/// never overwritten, so work done in the sample project survives.
#[tauri::command]
pub fn project_sample(app: AppHandle, state: State<'_, AppState>) -> Result<ProjectInfo, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| format!("no folder for the sample project: {e}"))?;
    let root = base.join("KingPost Sample");
    std::fs::create_dir_all(&root).map_err(|e| format!("{}: {e}", root.display()))?;
    let target = root.join(SAMPLE_MODEL);
    if !target.exists() {
        let source = app
            .path()
            .resolve(format!("samples/{SAMPLE_MODEL}"), BaseDirectory::Resource)
            .map_err(|e| format!("sample model not found: {e}"))?;
        std::fs::copy(&source, &target).map_err(|e| format!("{}: {e}", source.display()))?;
    }
    let project = if Project::is_project(&root) {
        Project::open(&root)
    } else {
        Project::create(&root, "KingPost Sample")
    }
    .map_err(describe)?;
    adopt(&app, &state, project)
}

#[tauri::command]
pub fn project_close(state: State<'_, AppState>) -> Result<(), String> {
    state.set_watcher(None);
    *state.lock()? = None;
    Ok(())
}

/// The project open at startup (see `AppState::from_environment`) has no watcher yet;
/// the interface calls this once when it first asks for the current project.
#[tauri::command]
pub fn project_current(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<ProjectInfo>, String> {
    let guard = state.lock()?;
    let Some(project) = guard.as_ref() else {
        return Ok(None);
    };
    let info = ProjectInfo::from(project);
    let needs_watcher = state.watcher.lock().map(|w| w.is_none()).unwrap_or(false);
    if needs_watcher {
        match FolderWatcher::start(app, project.root()) {
            Ok(watcher) => state.set_watcher(Some(watcher)),
            Err(error) => eprintln!("{error}"),
        }
    }
    Ok(Some(info))
}
