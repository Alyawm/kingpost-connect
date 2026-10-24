//! Files inside the project folder, IFC import, and reading what an import stored.

use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use kp_ifc::ImportSummary;
use kp_store::{ElementSummary, PropertyOut, RevisionRow};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State, ipc::Response};

use super::{AppState, describe};

const MAX_DEPTH: usize = 5;

#[derive(Serialize, Clone)]
pub struct ProjectFile {
    rel_path: String,
    kind: String,
    size: u64,
    mtime: Option<String>,
    revisions: Vec<RevisionRow>,
}

#[derive(Serialize, Clone)]
pub struct ElementDetails {
    element: ElementSummary,
    properties: Vec<PropertyOut>,
}

#[derive(Serialize, Clone)]
struct ImportStatus<'a> {
    rel_path: &'a str,
    stage: &'a str,
}

/// File kinds the application understands, by extension.
fn kind_of(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "ifc" => Some("ifc"),
        "pdf" => Some("pdf"),
        "e2k" => Some("e2k"),
        "s2k" => Some("s2k"),
        "xlsx" => Some("saf"),
        _ => None,
    }
}

/// Resolves a project-relative path and refuses anything that escapes the root.
pub(crate) fn resolve_in_root(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let rel = Path::new(rel_path);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err(format!("{rel_path} is not a path inside the project"));
    }
    Ok(root.join(rel))
}

fn walk(
    root: &Path,
    dir: &Path,
    depth: usize,
    out: &mut Vec<(String, String, u64, Option<String>)>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            if depth < MAX_DEPTH {
                walk(root, &path, depth + 1, out);
            }
            continue;
        }
        let Some(kind) = kind_of(&path) else { continue };
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let rel_path = rel.to_string_lossy().replace('\\', "/");
        let mtime = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs().to_string());
        out.push((rel_path, kind.to_owned(), metadata.len(), mtime));
    }
}

#[tauri::command]
pub fn project_files(state: State<'_, AppState>) -> Result<Vec<ProjectFile>, String> {
    state.with_project(|project| {
        let mut found = Vec::new();
        walk(project.root(), project.root(), 0, &mut found);
        found.sort_by(|a, b| a.0.cmp(&b.0));

        let store = project.store();
        let tracked: HashMap<String, i64> = store
            .files()
            .map_err(describe)?
            .into_iter()
            .map(|f| (f.rel_path, f.id))
            .collect();
        let mut revisions: HashMap<i64, Vec<RevisionRow>> = HashMap::new();
        for revision in store.revisions(None).map_err(describe)? {
            revisions
                .entry(revision.file_id)
                .or_default()
                .push(revision);
        }

        Ok(found
            .into_iter()
            .map(|(rel_path, kind, size, mtime)| {
                let revisions = tracked
                    .get(&rel_path)
                    .and_then(|id| revisions.remove(id))
                    .unwrap_or_default();
                ProjectFile {
                    rel_path,
                    kind,
                    size,
                    mtime,
                    revisions,
                }
            })
            .collect())
    })
}

/// Parses an IFC file in the project and stores it as a new revision.
/// Runs on a worker thread; the window keeps responding while a large file imports.
#[tauri::command]
pub async fn import_ifc(
    app: AppHandle,
    state: State<'_, AppState>,
    rel_path: String,
) -> Result<ImportSummary, String> {
    let state = state.inner().clone();
    let _ = app.emit(
        "import:status",
        ImportStatus {
            rel_path: &rel_path,
            stage: "started",
        },
    );
    let result = tauri::async_runtime::spawn_blocking(move || {
        state.with_project(|project| {
            let path = resolve_in_root(project.root(), &rel_path)?;
            let summary = kp_ifc::import_file(project.store(), project.root(), &rel_path)
                .map_err(describe)?;
            // A file that carries a structural analysis view is stored as an analysis
            // model of the same revision, so it can be overlaid and matched.
            if let Ok(bytes) = fs::read(&path)
                && let Ok(Some(model)) = kp_analysis::from_ifc_bytes(&bytes)
            {
                super::analysis::save_model(project.store(), summary.revision_id, &model)?;
            }
            Ok(summary)
        })
    })
    .await
    .map_err(|e| format!("import thread failed: {e}"))?;
    let stage = if result.is_ok() { "finished" } else { "failed" };
    let _ = app.emit(
        "import:status",
        ImportStatus {
            rel_path: "",
            stage,
        },
    );
    result
}

/// Raw bytes of a file in the project, for the interface's geometry loader.
#[tauri::command]
pub fn read_project_file(state: State<'_, AppState>, rel_path: String) -> Result<Response, String> {
    state.with_project(|project| {
        let path = resolve_in_root(project.root(), &rel_path)?;
        let bytes = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(Response::new(bytes))
    })
}

#[tauri::command]
pub fn revision_info(state: State<'_, AppState>, revision_id: i64) -> Result<RevisionRow, String> {
    state.with_project(|project| {
        project
            .store()
            .revisions(None)
            .map_err(describe)?
            .into_iter()
            .find(|r| r.id == revision_id)
            .ok_or_else(|| format!("revision {revision_id} does not exist"))
    })
}

#[tauri::command]
pub fn revision_elements(
    state: State<'_, AppState>,
    revision_id: i64,
) -> Result<Vec<ElementSummary>, String> {
    state.with_project(|project| project.store().elements(revision_id).map_err(describe))
}

#[tauri::command]
pub fn element_details(
    state: State<'_, AppState>,
    revision_id: i64,
    express_id: i64,
) -> Result<Option<ElementDetails>, String> {
    state.with_project(|project| {
        let store = project.store();
        let Some(element) = store.element(revision_id, express_id).map_err(describe)? else {
            return Ok(None);
        };
        let properties = store
            .element_properties(revision_id, express_id)
            .map_err(describe)?;
        Ok(Some(ElementDetails {
            element,
            properties,
        }))
    })
}

#[tauri::command]
pub fn search_elements(
    state: State<'_, AppState>,
    revision_id: i64,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<ElementSummary>, String> {
    state.with_project(|project| {
        project
            .store()
            .search_elements(revision_id, &query, limit.unwrap_or(200))
            .map_err(describe)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_that_leave_the_project() {
        // Absolute on every platform; the test must not assume Windows drive letters.
        let root = std::env::temp_dir().join("bridge");
        let outside = std::env::temp_dir().join("elsewhere");
        assert_eq!(
            resolve_in_root(&root, "models/a.ifc").unwrap(),
            root.join("models").join("a.ifc")
        );
        assert!(resolve_in_root(&root, "../secrets.txt").is_err());
        assert!(resolve_in_root(&root, outside.to_str().unwrap()).is_err());
        assert!(resolve_in_root(&root, "models/../../x").is_err());
    }

    #[test]
    fn classifies_known_extensions() {
        assert_eq!(kind_of(Path::new("a/B.IFC")), Some("ifc"));
        assert_eq!(kind_of(Path::new("drawings/GA-01.pdf")), Some("pdf"));
        assert_eq!(kind_of(Path::new("analysis/tower.e2k")), Some("e2k"));
        assert_eq!(kind_of(Path::new("notes.txt")), None);
    }
}
