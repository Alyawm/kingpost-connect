//! Commands callable from the interface. Each one mirrors a wrapper in
//! `apps/desktop/src/lib/ipc.ts`; keep the two lists identical.
//!
//! Errors cross the boundary as plain strings: the interface shows them in the Output
//! panel and has no use for structured variants yet.

use std::sync::{Arc, Mutex, MutexGuard};

use kp_project::Project;

pub mod analysis;
pub mod cache;
pub mod clash;
pub mod compare;
pub mod diagnostics;
pub mod drawings;
pub mod licence;
pub mod model;
pub mod notes;
pub mod project;
pub mod quantity;
pub mod review;
pub mod sync;
pub mod views;
pub mod watcher;

#[derive(Default, Clone)]
pub struct AppState {
    project: Arc<Mutex<Option<Project>>>,
    watcher: Arc<Mutex<Option<watcher::FolderWatcher>>>,
}

impl AppState {
    /// Starts with the project named by `KINGPOST_PROJECT` already open, when that
    /// variable points at a folder. Used by scripted runs and developer workflows; an
    /// ordinary launch leaves it unset and starts with no project.
    pub fn from_environment() -> Self {
        let state = Self::default();
        if let Some(root) = std::env::var_os("KINGPOST_PROJECT") {
            let root = std::path::PathBuf::from(root);
            let opened = if Project::is_project(&root) {
                Project::open(&root)
            } else {
                let name = root.file_name().map(|n| n.to_string_lossy().into_owned());
                Project::create(&root, name.as_deref().unwrap_or("Project"))
            };
            match opened {
                Ok(project) => {
                    if let Ok(mut guard) = state.project.lock() {
                        *guard = Some(project);
                    }
                }
                Err(error) => eprintln!("KINGPOST_PROJECT not opened: {error}"),
            }
        }
        state
    }

    fn lock(&self) -> Result<MutexGuard<'_, Option<Project>>, String> {
        self.project
            .lock()
            .map_err(|_| "application state is unavailable".to_owned())
    }

    /// Runs `f` against the open project, or fails when none is open.
    fn with_project<T>(&self, f: impl FnOnce(&Project) -> Result<T, String>) -> Result<T, String> {
        let guard = self.lock()?;
        let project = guard
            .as_ref()
            .ok_or_else(|| "no project is open".to_owned())?;
        f(project)
    }

    /// Replaces the folder watcher; `None` stops watching.
    fn set_watcher(&self, watcher: Option<watcher::FolderWatcher>) {
        if let Ok(mut guard) = self.watcher.lock() {
            *guard = watcher;
        }
    }
}

fn describe(error: impl std::fmt::Display) -> String {
    error.to_string()
}
